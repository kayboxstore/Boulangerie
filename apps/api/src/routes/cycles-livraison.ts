import { Router, type NextFunction, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import {
  aAcces,
  calculerCommande,
  calculerCommission,
} from "@lomoto/shared";
import {
  anomalieCycleCreateSchema,
  anomalieCycleResoudreSchema,
  bonRetourneCycleSchema,
  transitionCycleLivraisonSchema,
  type AnomalieCycleDTO,
  type CycleLivraisonDTO,
  type CycleLivraisonLigneDTO,
  type TransitionCycleLivraisonDTO,
  type TransitionCycleLivraisonInput,
} from "@lomoto/shared/cycles-livraison";
import { prisma, type TxClient } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import {
  ajouterEnteteRejeu,
  ErreurIdempotence,
  executerEcritureIdempotente,
  lireCleIdempotence,
} from "../lib/idempotence.js";
import { bornesJourLomoto } from "../lib/temps.js";
import { busEvenements } from "../lib/events.js";
import { auditerCaisseTx } from "../services/caisseAtomique.js";
import {
  calculerQuantiteManquante,
  donneesTransitionPourJournal,
  ErreurCycleLivraison,
  peutExecuterActionCycle,
  statutAttenduPourAction,
  statutSuivantPourAction,
  validerLignesAcceptation,
  validerLignesQuantite,
  validerResultatAcceptation,
  type LigneResultatAcceptation,
} from "../services/cyclesLivraison.js";

export const cyclesLivraisonRouter = Router();

cyclesLivraisonRouter.use(requireAuth);

const INCLUDE_CYCLE = {
  schemaCommande: {
    include: {
      client: { include: { typeClient: true, zoneDepositaire: true } },
      lignes: { include: { produit: true } },
    },
  },
  lignes: true,
  commande: { select: { id: true, numero: true, quantiteBacs: true } },
  anomalies: { where: { resolueLe: null }, select: { type: true } },
  transitions: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
} as const;

type CycleComplet = Prisma.CycleLivraisonGetPayload<{ include: typeof INCLUDE_CYCLE }>;

function aPermission(req: Request, module: "PRODUCTION" | "COMMANDES", niveau: "LECTURE" | "ECRITURE") {
  return aAcces(req.utilisateur?.role.permissions ?? [], module, niveau);
}

function autoriserLecture(req: Request, res: Response, next: NextFunction) {
  if (aPermission(req, "PRODUCTION", "LECTURE") || aPermission(req, "COMMANDES", "LECTURE")) return next();
  return res.status(403).json({ code: "ACTION_NON_AUTORISEE", erreur: "Lecture Production ou Commandes requise" });
}

function autoriserEcriturePartagee(req: Request) {
  return aPermission(req, "PRODUCTION", "ECRITURE") || aPermission(req, "COMMANDES", "ECRITURE");
}

const jour = (date: Date) => date.toISOString().slice(0, 10);

function totalOuNull(
  lignes: CycleLivraisonLigneDTO[],
  champ: Exclude<keyof CycleLivraisonLigneDTO, "produitId" | "produitNom" | "quantitePrevue">,
) {
  return lignes.some((ligne) => ligne[champ] !== null)
    ? lignes.reduce((somme, ligne) => somme + (ligne[champ] ?? 0), 0)
    : null;
}

function versCycleDTO(cycle: CycleComplet): CycleLivraisonDTO {
  const avalParProduit = new Map(cycle.lignes.map((ligne) => [ligne.produitId, ligne]));
  const lignes: CycleLivraisonLigneDTO[] = cycle.schemaCommande.lignes
    .map((prevision) => {
      const aval = avalParProduit.get(prevision.produitId);
      return {
        produitId: prevision.produitId,
        produitNom: prevision.produit.nom,
        quantitePrevue: prevision.quantite,
        quantiteRetenueProduction: aval?.quantiteRetenueProduction ?? null,
        quantitePreparee: aval?.quantitePreparee ?? null,
        quantiteRemiseMagasin: aval?.quantiteRemiseMagasin ?? null,
        quantiteChargee: aval?.quantiteChargee ?? null,
        quantiteDeposee: aval?.quantiteDeposee ?? null,
        quantiteAcceptee: aval?.quantiteAcceptee ?? null,
        quantiteRetournee: aval?.quantiteRetournee ?? null,
        quantiteManquante: aval?.quantiteManquante ?? null,
      };
    })
    .sort((a, b) => a.produitNom.localeCompare(b.produitNom, "fr"));
  const client = cycle.schemaCommande.client;
  const typesAnomalie = [...new Set(cycle.anomalies.map((anomalie) => anomalie.type))];

  return {
    id: cycle.id,
    dateLivraison: jour(cycle.schemaCommande.date),
    client: {
      id: client.id,
      nom: client.nom,
      typeClientNom: client.typeClient.nom,
      zoneDepositaireId: client.zoneDepositaireId,
      zoneDepositaireNom: client.zoneDepositaire?.nom ?? null,
    },
    statut: cycle.statut,
    version: cycle.version,
    lignes,
    totaux: {
      prevu: lignes.reduce((somme, ligne) => somme + ligne.quantitePrevue, 0),
      retenuProduction: totalOuNull(lignes, "quantiteRetenueProduction"),
      prepare: totalOuNull(lignes, "quantitePreparee"),
      remisMagasin: totalOuNull(lignes, "quantiteRemiseMagasin"),
      charge: totalOuNull(lignes, "quantiteChargee"),
      depose: totalOuNull(lignes, "quantiteDeposee"),
      accepte: totalOuNull(lignes, "quantiteAcceptee"),
      retourne: totalOuNull(lignes, "quantiteRetournee"),
      manquant: totalOuNull(lignes, "quantiteManquante"),
    },
    livrePar: cycle.livrePar,
    bonRetourne: cycle.bonRetourne,
    anomalieOuverte: cycle.anomalies.length > 0,
    typesAnomalie,
    estFacturable: cycle.commande !== null,
    commande: cycle.commande,
    derniereTransitionLe: cycle.transitions[0]?.createdAt.toISOString() ?? null,
  };
}

async function chargerCycle(client: TxClient, id: string): Promise<CycleComplet | null> {
  return client.cycleLivraison.findUnique({ where: { id }, include: INCLUDE_CYCLE });
}

function verifierVersionEtEtat(cycle: CycleComplet, input: TransitionCycleLivraisonInput) {
  if (cycle.version !== input.version) {
    throw new ErreurCycleLivraison(
      "Le cycle a été modifié. Rechargez les données avant de réessayer.",
      409,
      "VERSION_OBSOLETE",
      cycle.version,
    );
  }
  const attendu = statutAttenduPourAction(input.action);
  if (cycle.statut !== attendu) {
    if (input.action === "CONFIRMER_ACCEPTATION" && cycle.commandeId) {
      throw new ErreurCycleLivraison(
        "Cette acceptation est déjà liée à une commande",
        409,
        "ACCEPTATION_DEJA_CONVERTIE",
        cycle.version,
      );
    }
    throw new ErreurCycleLivraison(
      `La transition ${input.action} est impossible depuis l'état ${cycle.statut}`,
      409,
      "TRANSITION_INTERDITE",
      cycle.version,
    );
  }
}

async function reclamerVersion(
  tx: TxClient,
  cycle: CycleComplet,
  input: TransitionCycleLivraisonInput,
  statut: CycleComplet["statut"],
  donnees: Prisma.CycleLivraisonUpdateManyMutationInput = {},
) {
  const resultat = await tx.cycleLivraison.updateMany({
    where: { id: cycle.id, version: input.version, statut: cycle.statut },
    data: { ...donnees, statut, version: { increment: 1 } },
  });
  if (resultat.count === 1) return;
  const courant = await tx.cycleLivraison.findUnique({ where: { id: cycle.id }, select: { version: true } });
  if (!courant) throw new ErreurCycleLivraison("Cycle introuvable", 404, "CYCLE_INTROUVABLE");
  throw new ErreurCycleLivraison(
    "Le cycle a été modifié. Rechargez les données avant de réessayer.",
    409,
    "VERSION_OBSOLETE",
    courant.version,
  );
}

async function appliquerLignesSimples(
  tx: TxClient,
  cycle: CycleComplet,
  lignes: readonly { produitId: string; quantite: number }[],
  champ:
    | "quantiteRetenueProduction"
    | "quantitePreparee"
    | "quantiteRemiseMagasin"
    | "quantiteChargee"
    | "quantiteDeposee",
) {
  const valeurs = validerLignesQuantite(cycle.lignes.map((ligne) => ligne.produitId), lignes);
  if (champ === "quantiteDeposee") {
    for (const ligne of cycle.lignes) {
      const chargee = ligne.quantiteChargee;
      if (chargee === null) {
        throw new ErreurCycleLivraison("Le chargement doit être confirmé avant le dépôt", 409, "TRANSITION_INTERDITE");
      }
      calculerQuantiteManquante(chargee, valeurs.get(ligne.produitId)!);
    }
  }
  for (const [produitId, quantite] of valeurs) {
    await tx.cycleLivraisonLigne.update({
      where: { cycleId_produitId: { cycleId: cycle.id, produitId } },
      data: { [champ]: quantite },
    });
  }
}

interface CommandeCycleReponse {
  id: string;
  numero: number;
  quantiteBacs: number;
  montantRecu: number;
}

interface CorpsTransition {
  cycle: CycleLivraisonDTO;
  commande: CommandeCycleReponse | null;
}

/**
 * Crochet de TEST UNIQUEMENT (jamais appelé par un chemin de production —
 * aucun appelant réel n'en fournit) : même idiome que `CrochetsTestVerrouCaisse`
 * (services/caisseAtomique.ts). Appelé juste après la lecture initiale du
 * cycle (donc après que CETTE transaction a fixé son instantané PostgreSQL
 * SERIALIZABLE), avant toute écriture — permet à un scénario de concurrence
 * réel (scripts/verifier-integrite-c4-ci.ts) de garantir un entrelacement
 * déterministe avec une transaction concurrente touchant le même Client
 * (jamais un délai comme synchronisation).
 */
export interface CrochetsTestTransitionCycle {
  apresLectureAvantEcriture?: () => Promise<void>;
}

export async function appliquerTransition(
  tx: TxClient,
  cycleId: string,
  input: TransitionCycleLivraisonInput,
  utilisateurId: string,
  crochets?: CrochetsTestTransitionCycle,
): Promise<CorpsTransition> {
  const cycle = await chargerCycle(tx, cycleId);
  if (!cycle) throw new ErreurCycleLivraison("Cycle introuvable", 404, "CYCLE_INTROUVABLE");
  verifierVersionEtEtat(cycle, input);
  await crochets?.apresLectureAvantEcriture?.();

  let statutSuivant: CycleComplet["statut"];
  let commande: CommandeCycleReponse | null = null;

  if (input.action === "CONFIRMER_ACCEPTATION") {
    const valeurs = validerLignesAcceptation(cycle.lignes.map((ligne) => ligne.produitId), input.lignes);
    const lignesFinales: LigneResultatAcceptation[] = [];
    for (const ligne of cycle.lignes) {
      const deposee = ligne.quantiteDeposee;
      const chargee = ligne.quantiteChargee;
      if (deposee === null || chargee === null) {
        throw new ErreurCycleLivraison("Le dépôt doit être confirmé avant l'acceptation", 409, "TRANSITION_INTERDITE");
      }
      const finale = valeurs.get(ligne.produitId)!;
      lignesFinales.push({
        produitId: ligne.produitId,
        quantiteChargee: chargee,
        quantiteDeposee: deposee,
        quantiteAcceptee: finale.quantiteAcceptee,
        quantiteRetournee: finale.quantiteRetournee,
      });
    }
    const resultatFinal = validerResultatAcceptation(lignesFinales);
    const { totalAccepte } = resultatFinal;
    statutSuivant = resultatFinal.statut;
    await reclamerVersion(tx, cycle, input, statutSuivant, {
      ...(input.bonRetourne
        ? { bonRetourne: true, bonRetourneLe: new Date(), bonRetourneParId: utilisateurId }
        : {}),
    });

    // `updateMany` + audit manuel dans `tx` (jamais `update()` singulier) :
    // CycleLivraisonLigne est un modèle audité (lib/audit.ts, module
    // PRODUCTION) — un `update()` ici serait intercepté par l'extension
    // d'audit automatique, qui écrit via un client NON transactionnel
    // (voir services/caisseAtomique.ts) et laisserait un AuditLog mensonger
    // si la transaction C4 était annulée plus loin (round correctif Codex,
    // 29/08/2026 — la conversion C4 modifie bien des données financières :
    // avance/dette client, jamais les espèces ni le solde de caisse).
    for (const ligne of cycle.lignes) {
      const finale = valeurs.get(ligne.produitId)!;
      const { count } = await tx.cycleLivraisonLigne.updateMany({
        where: { id: ligne.id },
        data: {
          quantiteAcceptee: finale.quantiteAcceptee,
          quantiteRetournee: finale.quantiteRetournee,
          // Le manquant est logistique : chargé - déposé. Il ne dépend ni de
          // l'accepté ni du retourné, qui restent deux résultats parallèles.
          quantiteManquante: resultatFinal.manquants.get(ligne.produitId)!,
        },
      });
      // En pratique inatteignable : `ligne` vient d'être lue dans CETTE
      // transaction (chargerCycle, avant toute écriture) et sa ligne
      // n'est ni supprimable ni réattribuable à un autre cycle — conservé
      // par défense en profondeur, jamais un 500 générique.
      if (count !== 1) {
        throw new ErreurCycleLivraison(
          "Le cycle a été modifié. Rechargez les données avant de réessayer.",
          409,
          "VERSION_OBSOLETE",
          cycle.version,
        );
      }
      const ligneApres = await tx.cycleLivraisonLigne.findUniqueOrThrow({ where: { id: ligne.id } });
      await auditerCaisseTx(tx, {
        module: "PRODUCTION",
        typeEntite: "CycleLivraisonLigne",
        entiteId: ligne.id,
        action: "MODIFICATION",
        avant: ligne,
        apres: ligneApres,
      });
    }

    if (!input.bonRetourne) {
      await tx.anomalieCycleLivraison.create({
        data: {
          cycleId: cycle.id,
          type: "BON_NON_RETOURNE",
          description: "Le bon physique n'a pas encore été retourné après la confirmation client",
          signaleeParId: utilisateurId,
        },
      });
    }

    if (totalAccepte > 0) {
      const dateOperationnelle = cycle.schemaCommande.date;
      const [debut, fin] = bornesJourLomoto(jour(dateOperationnelle));
      const commandeExistante = await tx.commandeClient.findFirst({
        where: {
          clientId: cycle.schemaCommande.clientId,
          OR: [
            { dateOperationnelle },
            { dateOperationnelle: null, dateCreation: { gte: debut, lte: fin } },
          ],
        },
        select: { id: true },
      });
      if (commandeExistante) {
        throw new ErreurCycleLivraison(
          "Une commande existe déjà pour ce client et ce jour",
          409,
          "COMMANDE_JOUR_EXISTANTE",
        );
      }

      const client = cycle.schemaCommande.client;
      const calcul = calculerCommande({
        quantiteBacs: totalAccepte,
        prixParBac: client.typeClient.prixParBac,
        avanceExistante: client.avanceDisponible,
        montantRecu: 0,
      });
      const creee = await tx.commandeClient.create({
        data: {
          clientId: client.id,
          quantiteBacs: totalAccepte,
          montantBrut: calcul.montantBrut,
          commission: calculerCommission({
            quantiteBacs: totalAccepte,
            commissionParBac: client.typeClient.commissionParBac,
          }),
          avanceUtilisee: calcul.avanceUtilisee,
          montantAPercevoir: calcul.montantAPercevoir,
          montantRecu: 0,
          dette: calcul.dette,
          avanceGeneree: calcul.avanceGeneree,
          nouvelleAvance: calcul.nouvelleAvance,
          creeParId: utilisateurId,
          dateOperationnelle,
        },
        select: { id: true, numero: true, quantiteBacs: true, montantRecu: true },
      });

      // Client et CycleLivraison sont tous deux des modèles audités
      // (COMMANDES / PRODUCTION) : mêmes raisons que ci-dessus,
      // `updateMany` + audit manuel dans `tx`, jamais `update()` singulier.
      // La conversion C4 elle-même reste neutre pour les espèces et le
      // solde du registre de caisse (montantRecu = 0 à la création), mais
      // modifie réellement l'avance et la dette du client — d'où l'audit.
      const clientAvant = client;
      const { count: countClient } = await tx.client.updateMany({
        where: { id: client.id },
        data: { avanceDisponible: calcul.nouvelleAvance },
      });
      if (countClient !== 1) {
        throw new ErreurCycleLivraison("Client introuvable", 404, "CYCLE_INTROUVABLE");
      }
      const clientApres = await tx.client.findUniqueOrThrow({ where: { id: client.id } });
      await auditerCaisseTx(tx, {
        module: "COMMANDES",
        typeEntite: "Client",
        entiteId: client.id,
        action: "MODIFICATION",
        avant: clientAvant,
        apres: clientApres,
      });

      const cycleAvantLien = await tx.cycleLivraison.findUniqueOrThrow({ where: { id: cycle.id } });
      const { count: countCycle } = await tx.cycleLivraison.updateMany({
        where: { id: cycle.id },
        data: { commandeId: creee.id },
      });
      // En pratique inatteignable : le cycle vient d'être verrouillé par
      // `reclamerVersion` (CAS optimiste par version) plus haut dans CETTE
      // même transaction — conservé par défense en profondeur, jamais un
      // 500 générique.
      if (countCycle !== 1) {
        throw new ErreurCycleLivraison("Cycle introuvable", 404, "CYCLE_INTROUVABLE");
      }
      const cycleApresLien = await tx.cycleLivraison.findUniqueOrThrow({ where: { id: cycle.id } });
      await auditerCaisseTx(tx, {
        module: "PRODUCTION",
        typeEntite: "CycleLivraison",
        entiteId: cycle.id,
        action: "MODIFICATION",
        avant: cycleAvantLien,
        apres: cycleApresLien,
      });

      commande = creee;
    }
  } else {
    statutSuivant = statutSuivantPourAction(input.action);
    await reclamerVersion(tx, cycle, input, statutSuivant, {
      ...(input.action === "CONFIRMER_CHARGEMENT" ? { livrePar: input.livrePar } : {}),
    });
    if (input.action !== "CONFIRMER_DEPART") {
      const champ = {
        RETENIR_PRODUCTION: "quantiteRetenueProduction",
        CONFIRMER_PREPARATION: "quantitePreparee",
        CONFIRMER_REMISE_MAGASIN: "quantiteRemiseMagasin",
        CONFIRMER_CHARGEMENT: "quantiteChargee",
        SIGNALER_DEPOT: "quantiteDeposee",
      }[input.action] as Parameters<typeof appliquerLignesSimples>[3];
      await appliquerLignesSimples(tx, cycle, input.lignes, champ);
    }
  }

  await tx.transitionCycleLivraison.create({
    data: {
      cycleId: cycle.id,
      action: input.action,
      versionAvant: input.version,
      versionApres: input.version + 1,
      utilisateurId,
      observations: input.observations || null,
      donnees: donneesTransitionPourJournal(input),
    },
  });
  const misAJour = await chargerCycle(tx, cycle.id);
  if (!misAJour) throw new ErreurCycleLivraison("Cycle introuvable", 404, "CYCLE_INTROUVABLE");
  return { cycle: versCycleDTO(misAJour), commande };
}

function repondreErreur(res: Response, erreur: unknown, next: NextFunction) {
  if (erreur instanceof ErreurCycleLivraison) {
    return res.status(erreur.statutHttp).json({
      code: erreur.code,
      erreur: erreur.message,
      ...(erreur.versionCourante === undefined ? {} : { versionCourante: erreur.versionCourante }),
    });
  }
  if (erreur instanceof ErreurIdempotence) {
    return res.status(erreur.statutHttp).json({ code: erreur.code, erreur: erreur.message });
  }
  if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
    return res.status(409).json({ code: "COMMANDE_JOUR_EXISTANTE", erreur: "Une commande existe déjà pour ce client et ce jour" });
  }
  if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2034") {
    return res.status(409).json({
      code: "VERSION_OBSOLETE",
      erreur: "Le cycle a été modifié simultanément. Rechargez les données avant de réessayer.",
    });
  }
  next(erreur);
}

cyclesLivraisonRouter.get("/cycles-livraison", autoriserLecture, async (req, res, next) => {
  try {
    const { date } = req.query as Record<string, string | undefined>;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ code: "DONNEES_INVALIDES", erreur: "Date requise (AAAA-MM-JJ)" });
    }
    const cycles = await prisma.cycleLivraison.findMany({
      where: { schemaCommande: { date: new Date(date) } },
      include: INCLUDE_CYCLE,
      orderBy: { schemaCommande: { client: { nom: "asc" } } },
    });
    const dtos = cycles.map(versCycleDTO);
    res.json({
      date,
      cycles: dtos,
      totaux: {
        prevu: dtos.reduce((somme, cycle) => somme + cycle.totaux.prevu, 0),
        charge: dtos.reduce((somme, cycle) => somme + (cycle.totaux.charge ?? 0), 0),
        accepte: dtos.reduce((somme, cycle) => somme + (cycle.totaux.accepte ?? 0), 0),
        facturable: dtos.reduce((somme, cycle) => somme + (cycle.commande?.quantiteBacs ?? 0), 0),
      },
    });
  } catch (erreur) {
    next(erreur);
  }
});

cyclesLivraisonRouter.get("/cycles-livraison/:id", autoriserLecture, async (req, res, next) => {
  try {
    const cycle = await chargerCycle(prisma, req.params.id);
    if (!cycle) return res.status(404).json({ code: "CYCLE_INTROUVABLE", erreur: "Cycle introuvable" });
    const historique = await prisma.transitionCycleLivraison.findMany({
      where: { cycleId: cycle.id },
      include: { utilisateur: { select: { id: true, nom: true } } },
      orderBy: { createdAt: "asc" },
    });
    const historiqueDTO: TransitionCycleLivraisonDTO[] = historique.map((transition) => ({
      id: transition.id,
      action: transition.action,
      versionAvant: transition.versionAvant,
      versionApres: transition.versionApres,
      utilisateur: transition.utilisateur,
      date: transition.createdAt.toISOString(),
      observations: transition.observations,
      donnees: transition.donnees,
    }));
    res.json({ cycle: versCycleDTO(cycle), historique: historiqueDTO });
  } catch (erreur) {
    next(erreur);
  }
});

cyclesLivraisonRouter.post("/cycles-livraison/:id/transitions", async (req, res, next) => {
  try {
    const parsed = transitionCycleLivraisonSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ code: "DONNEES_INVALIDES", erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const input = parsed.data;
    if (!peutExecuterActionCycle(req.utilisateur?.role.permissions ?? [], input.action)) {
      return res.status(403).json({ code: "ACTION_NON_AUTORISEE", erreur: "Action non autorisée pour ce rôle" });
    }
    if (input.action === "CONFIRMER_ACCEPTATION" && !lireCleIdempotence(req)) {
      throw new ErreurIdempotence(
        "L'en-tête Idempotency-Key est obligatoire pour confirmer une acceptation",
        400,
        "CLE_IDEMPOTENCE_INVALIDE",
      );
    }

    const execution = await executerEcritureIdempotente<CorpsTransition, CorpsTransition>(
      req,
      `POST:/api/production/cycles-livraison/${req.params.id}/transitions`,
      input,
      (tx) => appliquerTransition(tx, req.params.id, input, req.utilisateur!.id),
      (corps) => ({ statutHttp: input.action === "CONFIRMER_ACCEPTATION" ? 201 : 200, corps }),
    );
    ajouterEnteteRejeu(res, execution.rejoue);

    if (!execution.rejoue && execution.valeur) {
      const cycle = execution.valeur.cycle;
      if (input.action === "SIGNALER_DEPOT") {
        busEvenements.emettreEvenement({
          type: "LIVRAISON_EN_ATTENTE_CONFIRMATION",
          module: "PRODUCTION",
          emetteurId: req.utilisateur!.id,
          evenementRef: cycle.id,
          message: `Livraison de ${cycle.client.nom} en attente de confirmation`,
          donnees: { cycleId: cycle.id },
        });
      } else if (input.action === "CONFIRMER_ACCEPTATION") {
        busEvenements.emettreEvenement({
          type: "ACCEPTATION_CONVERTIE",
          module: "COMMANDES",
          emetteurId: req.utilisateur!.id,
          evenementRef: cycle.id,
          message: execution.valeur.commande
            ? `Acceptation de ${cycle.client.nom} convertie en commande n°${execution.valeur.commande.numero}`
            : `Retour total confirmé pour ${cycle.client.nom} — aucune commande créée`,
          donnees: { cycleId: cycle.id, commandeId: execution.valeur.commande?.id ?? null },
        });
        if (cycle.typesAnomalie.includes("BON_NON_RETOURNE")) {
          busEvenements.emettreEvenement({
            type: "BON_NON_RETOURNE",
            module: "PRODUCTION",
            emetteurId: req.utilisateur!.id,
            evenementRef: cycle.id,
            message: `Bon non retourné pour ${cycle.client.nom}`,
            donnees: { cycleId: cycle.id },
            priorite: "HAUTE",
          });
        }
      }
    }

    // Le premier résultat d'une conversion est 201 ; un rejeu explicite est
    // un succès 200 et renvoie exactement le même corps métier.
    res.status(execution.rejoue && input.action === "CONFIRMER_ACCEPTATION" ? 200 : execution.statutHttp).json(execution.corps);
  } catch (erreur) {
    repondreErreur(res, erreur, next);
  }
});

cyclesLivraisonRouter.post("/cycles-livraison/:id/bon-retourne", async (req, res, next) => {
  try {
    if (!autoriserEcriturePartagee(req)) {
      return res.status(403).json({ code: "ACTION_NON_AUTORISEE", erreur: "Écriture Production ou Commandes requise" });
    }
    const parsed = bonRetourneCycleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "DONNEES_INVALIDES", erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    const cycle = await prisma.$transaction(async (tx) => {
      const courant = await chargerCycle(tx, req.params.id);
      if (!courant) throw new ErreurCycleLivraison("Cycle introuvable", 404, "CYCLE_INTROUVABLE");
      if (courant.version !== parsed.data.version) {
        throw new ErreurCycleLivraison("Le cycle a été modifié", 409, "VERSION_OBSOLETE", courant.version);
      }
      if (!courant.bonRetourne) {
        const retourneLe = new Date();
        const maj = await tx.cycleLivraison.updateMany({
          where: { id: courant.id, version: courant.version },
          data: {
            bonRetourne: true,
            bonRetourneLe: retourneLe,
            bonRetourneParId: req.utilisateur!.id,
            version: { increment: 1 },
          },
        });
        if (maj.count !== 1) throw new ErreurCycleLivraison("Le cycle a été modifié", 409, "VERSION_OBSOLETE");
        await tx.anomalieCycleLivraison.updateMany({
          where: { cycleId: courant.id, type: "BON_NON_RETOURNE", resolueLe: null },
          data: {
            resolueLe: retourneLe,
            resolueParId: req.utilisateur!.id,
            commentaireResolution: "Bon physique retourné et attribué par le serveur",
          },
        });
      }
      const resultat = await chargerCycle(tx, courant.id);
      if (!resultat) throw new ErreurCycleLivraison("Cycle introuvable", 404, "CYCLE_INTROUVABLE");
      return resultat;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ cycle: versCycleDTO(cycle) });
  } catch (erreur) {
    repondreErreur(res, erreur, next);
  }
});

cyclesLivraisonRouter.post("/cycles-livraison/:id/anomalies", async (req, res, next) => {
  try {
    if (!autoriserEcriturePartagee(req)) {
      return res.status(403).json({ code: "ACTION_NON_AUTORISEE", erreur: "Écriture Production ou Commandes requise" });
    }
    const parsed = anomalieCycleCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "DONNEES_INVALIDES", erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    const resultat = await prisma.$transaction(async (tx) => {
      const cycle = await chargerCycle(tx, req.params.id);
      if (!cycle) throw new ErreurCycleLivraison("Cycle introuvable", 404, "CYCLE_INTROUVABLE");
      if (cycle.version !== parsed.data.version) {
        throw new ErreurCycleLivraison("Le cycle a été modifié", 409, "VERSION_OBSOLETE", cycle.version);
      }
      const reclame = await tx.cycleLivraison.updateMany({
        where: { id: cycle.id, version: cycle.version },
        data: { version: { increment: 1 } },
      });
      if (reclame.count !== 1) throw new ErreurCycleLivraison("Le cycle a été modifié", 409, "VERSION_OBSOLETE");
      const anomalie = await tx.anomalieCycleLivraison.create({
        data: {
          cycleId: cycle.id,
          type: parsed.data.type,
          description: parsed.data.description,
          signaleeParId: req.utilisateur!.id,
        },
        include: {
          signaleePar: { select: { id: true, nom: true } },
          resoluePar: { select: { id: true, nom: true } },
        },
      });
      const maj = await chargerCycle(tx, cycle.id);
      if (!maj) throw new ErreurCycleLivraison("Cycle introuvable", 404, "CYCLE_INTROUVABLE");
      const dto: AnomalieCycleDTO = {
        id: anomalie.id,
        type: anomalie.type,
        description: anomalie.description,
        signaleeLe: anomalie.signaleeLe.toISOString(),
        signaleePar: anomalie.signaleePar,
        resolueLe: anomalie.resolueLe?.toISOString() ?? null,
        resoluePar: anomalie.resoluePar,
        commentaireResolution: anomalie.commentaireResolution,
      };
      return { cycle: versCycleDTO(maj), anomalie: dto };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    busEvenements.emettreEvenement({
      type: parsed.data.type === "BON_NON_RETOURNE" ? "BON_NON_RETOURNE" : "ANOMALIE_LIVRAISON",
      module: "PRODUCTION",
      emetteurId: req.utilisateur!.id,
      evenementRef: resultat.cycle.id,
      message: `Anomalie ${parsed.data.type} signalée pour ${resultat.cycle.client.nom}`,
      donnees: { cycleId: resultat.cycle.id, anomalieId: resultat.anomalie.id, type: parsed.data.type },
      priorite: "HAUTE",
    });
    res.status(201).json(resultat);
  } catch (erreur) {
    repondreErreur(res, erreur, next);
  }
});

cyclesLivraisonRouter.post("/cycles-livraison/:id/anomalies/:anomalieId/resoudre", async (req, res, next) => {
  try {
    if (!autoriserEcriturePartagee(req)) {
      return res.status(403).json({ code: "ACTION_NON_AUTORISEE", erreur: "Écriture Production ou Commandes requise" });
    }
    const parsed = anomalieCycleResoudreSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ code: "DONNEES_INVALIDES", erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    const resultat = await prisma.$transaction(async (tx) => {
      const cycle = await chargerCycle(tx, req.params.id);
      if (!cycle) throw new ErreurCycleLivraison("Cycle introuvable", 404, "CYCLE_INTROUVABLE");
      if (cycle.version !== parsed.data.version) {
        throw new ErreurCycleLivraison("Le cycle a été modifié", 409, "VERSION_OBSOLETE", cycle.version);
      }
      const anomalie = await tx.anomalieCycleLivraison.findFirst({
        where: { id: req.params.anomalieId, cycleId: cycle.id },
      });
      if (!anomalie) throw new ErreurCycleLivraison("Anomalie introuvable", 404, "ANOMALIE_INTROUVABLE");
      if (anomalie.resolueLe) throw new ErreurCycleLivraison("Cette anomalie est déjà résolue", 409, "ANOMALIE_DEJA_RESOLUE");
      const reclame = await tx.cycleLivraison.updateMany({
        where: { id: cycle.id, version: cycle.version },
        data: { version: { increment: 1 } },
      });
      if (reclame.count !== 1) throw new ErreurCycleLivraison("Le cycle a été modifié", 409, "VERSION_OBSOLETE");
      await tx.anomalieCycleLivraison.update({
        where: { id: anomalie.id },
        data: {
          resolueLe: new Date(),
          resolueParId: req.utilisateur!.id,
          commentaireResolution: parsed.data.commentaire,
        },
      });
      const maj = await chargerCycle(tx, cycle.id);
      if (!maj) throw new ErreurCycleLivraison("Cycle introuvable", 404, "CYCLE_INTROUVABLE");
      return versCycleDTO(maj);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.json({ cycle: resultat });
  } catch (erreur) {
    repondreErreur(res, erreur, next);
  }
});
