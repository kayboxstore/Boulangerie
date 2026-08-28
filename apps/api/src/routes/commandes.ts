import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  avanceAvantCommande,
  calculerCommande,
  calculerCommission,
  commandeCreateSchema,
  dateISOSchema,
  formatFc,
  reglementCreateSchema,
  sommeDeclarationsEnAttente,
  type AlerteDetteDTO,
  type CommandeDTO,
  type LivraisonsDuJourDTO,
  type ResumeCommandesJourDTO,
  type StrategieDoublon,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";
import {
  ajouterEnteteRejeu,
  ErreurIdempotence,
  executerEcritureIdempotente,
} from "../lib/idempotence.js";
import {
  bornesJourLomoto,
  dateSQLDepuisJourLomoto,
  jourLomoto,
} from "../lib/temps.js";
import { ErreurAction } from "../lib/erreurAction.js";
import {
  auditerCaisseTx,
  ErreurEcritureCaisseReessayable,
  executerAvecReessaiP2034,
  verifierAucuneSessionAnterieureOuverte,
  verrouillerSessionOuverte,
} from "../services/caisseAtomique.js";

export const commandesRouter = Router();

commandesRouter.use(requireAuth);

type CommandeAvecRelations = Prisma.CommandeClientGetPayload<{
  include: {
    client: { select: { id: true; nom: true; typeClient: { select: { nom: true } } } };
    creePar: { select: { id: true; nom: true } };
    reglements: {
      include: {
        enregistrePar: { select: { id: true; nom: true } };
        confirmePar: { select: { id: true; nom: true } };
      };
      orderBy: { date: "asc" };
    };
    cycleLivraison: { select: { id: true } };
  };
}>;

type ResultatCommandeEcriture =
  | { type: "creee"; commande: CommandeAvecRelations }
  | { type: "miseAJour"; commande: CommandeAvecRelations; strategie: StrategieDoublon }
  | { type: "conflit"; existante: CommandeAvecRelations }
  | { type: "cycleImmuable"; existante: CommandeAvecRelations }
  | { type: "reglementsPresents"; existante: CommandeAvecRelations };

interface CorpsCommandeEcriture {
  commande?: CommandeDTO;
  erreur?: string;
  code?: string;
  conflit?: boolean;
  commandeExistante?: CommandeDTO;
  apercu?: {
    MODIFIER: { quantiteBacs: number; montantRecu: number };
    REMPLACER: { quantiteBacs: number; montantRecu: number };
  };
}

type ResultatReglementEcriture =
  | { type: "introuvable" }
  | { type: "sansDette" }
  | { type: "reglee"; commande: CommandeAvecRelations };

interface CorpsReglementEcriture {
  commande?: CommandeDTO;
  erreur?: string;
}

const versCommandeDTO = (c: CommandeAvecRelations): CommandeDTO => ({
  id: c.id,
  numero: c.numero,
  dateCreation: c.dateCreation.toISOString(),
  client: { id: c.client.id, nom: c.client.nom },
  qualite: c.client.typeClient.nom,
  quantiteBacs: c.quantiteBacs,
  montantBrut: c.montantBrut,
  avanceUtilisee: c.avanceUtilisee,
  montantAPercevoir: c.montantAPercevoir,
  montantRecu: c.montantRecu,
  dette: c.dette,
  avanceGeneree: c.avanceGeneree,
  nouvelleAvance: c.nouvelleAvance,
  creePar: c.creePar ? { id: c.creePar.id, nom: c.creePar.nom } : null,
  reglements: c.reglements.map((r) => ({
    id: r.id,
    montant: r.montant,
    date: r.date.toISOString(),
    enregistrePar: r.enregistrePar ? { id: r.enregistrePar.id, nom: r.enregistrePar.nom } : null,
    statut: r.statut,
    confirmeLe: r.confirmeLe ? r.confirmeLe.toISOString() : null,
    confirmePar: r.confirmePar ? { id: r.confirmePar.id, nom: r.confirmePar.nom } : null,
  })),
  montantDeclareEnAttente: sommeDeclarationsEnAttente(c.reglements),
});

const INCLUDE_RELATIONS = {
  client: { select: { id: true, nom: true, typeClient: { select: { nom: true } } } },
  creePar: { select: { id: true, nom: true } },
  reglements: {
    include: {
      enregistrePar: { select: { id: true, nom: true } },
      confirmePar: { select: { id: true, nom: true } },
    },
    orderBy: { date: "asc" },
  },
  cycleLivraison: { select: { id: true } },
} as const;

// Résumé du jour (section 3.4) — accessible en lecture à tous les rôles ayant
// accès au module Commandes (Chargé des commandes, Caissier(ère), DG).
commandesRouter.get("/resume-jour", requirePermission("COMMANDES", "LECTURE"), async (_req, res, next) => {
  try {
    const [debut, fin] = bornesJourLomoto();
    const duJour = await prisma.commandeClient.findMany({
      where: { dateCreation: { gte: debut, lte: fin } },
      select: { quantiteBacs: true, montantAPercevoir: true, montantRecu: true, dette: true },
    });
    const somme = (f: (c: (typeof duJour)[number]) => number) => duJour.reduce((s, c) => s + f(c), 0);
    const avecDette = duJour.filter((c) => c.dette > 0);

    const dto: ResumeCommandesJourDTO = {
      date: jourLomoto(debut),
      nombreCommandes: duJour.length,
      totalBacs: somme((c) => c.quantiteBacs),
      totalAPercevoir: somme((c) => c.montantAPercevoir),
      totalRecu: somme((c) => c.montantRecu),
      nbSoldees: duJour.length - avecDette.length,
      nbAvecDette: avecDette.length,
      totalDettes: avecDette.reduce((s, c) => s + c.dette, 0),
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});

// Totaux livrés du jour par client (Bon de livraison — module Production),
// pour pré-remplir « Nombre de bacs reçus » à la création d'une commande. Pas
// de lien rigide entre les deux modules : simple indice, modifiable par
// l'utilisateur. ?date= optionnel (AAAA-MM-JJ), sinon aujourd'hui.
commandesRouter.get("/livraisons-du-jour", requirePermission("COMMANDES", "LECTURE"), async (req, res, next) => {
  try {
    const { date } = req.query as Record<string, string | undefined>;
    if (date && !dateISOSchema.safeParse(date).success) {
      return res.status(400).json({ erreur: "Date invalide (AAAA-MM-JJ)" });
    }
    const dateStr = date ?? jourLomoto();
    const dateObj = dateSQLDepuisJourLomoto(dateStr);

    const bons = await prisma.bonLivraison.findMany({
      where: { date: dateObj },
      include: { lignes: true },
    });

    const totauxParClientId: Record<string, number> = {};
    for (const bon of bons) {
      totauxParClientId[bon.clientId] = bon.lignes.reduce((s, l) => s + l.quantite, 0);
    }

    const dto: LivraisonsDuJourDTO = { date: dateStr, totauxParClientId };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});

/**
 * Alerte « dette non payée » (section 3.4) — vérification PARESSEUSE : elle
 * tourne au chargement de l'app pour les rôles ayant accès à Commandes, sur
 * le même principe que l'expiration des délégations (évaluée à la date
 * plutôt que par un cron). Exportée pour être aussi rejouée par le balayage
 * périodique (`services/planificateurAlertes.ts`, Lot 7 pt 2) — un filet de
 * sécurité pour les commandes en dette qu'aucun écran n'a rouvertes.
 *
 * Sont concernées les commandes créées AVANT aujourd'hui dont la dette reste
 * ouverte. La notification part une seule fois par commande : `updateMany`
 * gardé sur `alerteDetteEnvoyeeLe: null` fait office de compare-and-set atomique,
 * donc deux connexions simultanées ne peuvent pas produire de doublon.
 *
 * L'événement est SYSTÈME (aucun émetteur humain) : les destinataires sont tous
 * les rôles ayant lecture sur Commandes — Chargé des commandes, Caissier(ère)
 * et DG.
 */
export async function verifierAlertesDette(): Promise<void> {
  const [debutAujourdhui] = bornesJourLomoto();

  const enRetard = await prisma.commandeClient.findMany({
    where: {
      dette: { gt: 0 },
      dateCreation: { lt: debutAujourdhui },
      alerteDetteEnvoyeeLe: null,
    },
    include: { client: { select: { nom: true } } },
    take: 200,
  });

  for (const c of enRetard) {
    // Compare-and-set : seule la première tentative passe.
    const { count } = await prisma.commandeClient.updateMany({
      where: { id: c.id, alerteDetteEnvoyeeLe: null },
      data: { alerteDetteEnvoyeeLe: new Date() },
    });
    if (count !== 1) continue;

    busEvenements.emettreEvenement({
      type: "DETTE_NON_PAYEE",
      module: "COMMANDES",
      emetteurId: null, // déclenchée par le système
      evenementRef: c.id,
      priorite: "HAUTE",
      message: `Dette non payée — commande n°${c.numero} (${c.client.nom}) : ${formatFc(c.dette)} restant dû depuis le ${jourLomoto(c.dateCreation)}`,
      donnees: { commandeId: c.id, numero: c.numero, dette: c.dette },
    });
  }
}

/**
 * Déclenche la vérification paresseuse puis renvoie les dettes en retard encore
 * ouvertes. La notification ne part qu'une fois ; la liste, elle, reste affichée
 * dans le module tant que la dette n'est pas soldée.
 */
commandesRouter.get("/alertes-dette", requirePermission("COMMANDES", "LECTURE"), async (_req, res, next) => {
  try {
    await verifierAlertesDette();

    const [debutAujourdhui] = bornesJourLomoto();
    const enRetard = await prisma.commandeClient.findMany({
      where: { dette: { gt: 0 }, dateCreation: { lt: debutAujourdhui } },
      include: { client: { select: { nom: true } } },
      orderBy: { dateCreation: "asc" },
      take: 100,
    });

    const alertes: AlerteDetteDTO[] = enRetard.map((c) => ({
      commandeId: c.id,
      numero: c.numero,
      clientNom: c.client.nom,
      dette: c.dette,
      dateCreation: c.dateCreation.toISOString(),
      joursDepuis: Math.max(
        1,
        Math.floor((debutAujourdhui.getTime() - bornesJourLomoto(jourLomoto(c.dateCreation))[0].getTime()) / 86_400_000),
      ),
      alerteEnvoyeeLe: c.alerteDetteEnvoyeeLe?.toISOString() ?? null,
    }));
    res.json({ alertes });
  } catch (e) {
    next(e);
  }
});

// Liste avec filtres : ?typeClientId= (Qualité), ?du=AAAA-MM-JJ, ?au=AAAA-MM-JJ.
// Sans filtre : tout afficher (les plus récentes d'abord).
commandesRouter.get("/", requirePermission("COMMANDES", "LECTURE"), async (req, res, next) => {
  try {
    const { typeClientId, du, au } = req.query as Record<string, string | undefined>;

    if (du && !dateISOSchema.safeParse(du).success) {
      return res.status(400).json({ erreur: "Date de début invalide (AAAA-MM-JJ)" });
    }
    if (au && !dateISOSchema.safeParse(au).success) {
      return res.status(400).json({ erreur: "Date de fin invalide (AAAA-MM-JJ)" });
    }
    if (du && au && du > au) {
      return res.status(400).json({ erreur: "La date de fin doit suivre la date de début" });
    }

    const dateCreation: Prisma.DateTimeFilter = {};
    if (du) dateCreation.gte = bornesJourLomoto(du)[0];
    if (au) dateCreation.lte = bornesJourLomoto(au)[1];

    const commandes = await prisma.commandeClient.findMany({
      where: {
        ...(typeClientId ? { client: { typeClientId } } : {}),
        ...(du || au ? { dateCreation } : {}),
      },
      include: INCLUDE_RELATIONS,
      orderBy: { numero: "desc" },
    });
    res.json({ commandes: commandes.map(versCommandeDTO) });
  } catch (e) {
    next(e);
  }
});

/**
 * Enregistrement d'une commande (section 3.4). Tous les montants sont calculés
 * automatiquement — l'avance du client est déduite en premier, puis son solde
 * est mis à jour, le tout atomiquement.
 *
 * UNE SEULE COMMANDE PAR CLIENT ET PAR JOUR : si le client a déjà une commande
 * aujourd'hui, on ne crée jamais de seconde ligne.
 *  - sans `strategie` → 409 portant la commande en conflit, pour que l'UI
 *    propose le choix à l'utilisateur ;
 *  - avec `strategie` → UPDATE de la commande existante (même numéro) :
 *    MODIFIER additionne la saisie, REMPLACER l'écrase.
 *
 * P1-B (28/08/2026) : cette route modifie `montantRecu`, qui alimente
 * directement le registre de caisse (`entrées`) — elle exige donc désormais
 * une session de caisse OUVERTE pour aujourd'hui, verrou de ligne posé avant
 * toute lecture pertinente, exactement comme les écritures de caisse.ts.
 * Sans quoi une commande créée ou modifiée après la clôture du jour
 * corromprait silencieusement un théorique déjà figé. La conversion C4
 * (cycles-livraison.ts) reste hors périmètre : montantRecu = 0 à la
 * création, aucun impact comptable démontré (voir cartographie P1-B).
 */
commandesRouter.post("/", requirePermission("COMMANDES", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = commandeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { clientId, quantiteBacs, montantRecu, strategie } = parsed.data;

    const execution = await executerAvecReessaiP2034(() =>
      executerEcritureIdempotente<ResultatCommandeEcriture, CorpsCommandeEcriture>(
        req,
        "POST:/api/commandes",
        parsed.data,
        async (tx) => {
          const jour = jourLomoto();
          await verrouillerSessionOuverte(tx, jour);
          await verifierAucuneSessionAnterieureOuverte(tx, jour);

          const client = await tx.client.findUnique({
            where: { id: clientId },
            include: { typeClient: true },
          });
          if (!client) throw new ErreurClientInconnu();

          const dateOperationnelle = dateSQLDepuisJourLomoto(jour);
          const [debut, fin] = bornesJourLomoto(jour);
          const existante = await tx.commandeClient.findFirst({
            where: {
              clientId: client.id,
              OR: [
                { dateOperationnelle },
                { dateOperationnelle: null, dateCreation: { gte: debut, lte: fin } },
              ],
            },
            include: INCLUDE_RELATIONS,
            orderBy: { numero: "asc" },
          });

          if (!existante) {
            const calcul = calculerCommande({
              quantiteBacs,
              prixParBac: client.typeClient.prixParBac,
              avanceExistante: client.avanceDisponible,
              montantRecu,
            });
            const creee = await tx.commandeClient.create({
              data: {
                clientId: client.id,
                quantiteBacs,
                montantBrut: calcul.montantBrut,
                commission: calculerCommission({ quantiteBacs, commissionParBac: client.typeClient.commissionParBac }),
                avanceUtilisee: calcul.avanceUtilisee,
                montantAPercevoir: calcul.montantAPercevoir,
                montantRecu,
                dette: calcul.dette,
                avanceGeneree: calcul.avanceGeneree,
                nouvelleAvance: calcul.nouvelleAvance,
                creeParId: req.utilisateur!.id,
                dateOperationnelle,
              },
              include: INCLUDE_RELATIONS,
            });
            // Création : ni CommandeClient ni Client ne sont audités ici — même
            // convention que le reste du dépôt (lib/audit.ts) : les créations ne
            // sont jamais journalisées, déjà tracées via creeParId/enregistrePar.
            await tx.client.update({
              where: { id: client.id },
              data: { avanceDisponible: calcul.nouvelleAvance },
            });
            return { type: "creee" as const, commande: creee };
          }

          if (!strategie) return { type: "conflit" as const, existante };
          // Une commande issue d'une acceptation C4 est immuable : les paiements
          // restent permis, mais l'ancien flux manuel ne peut ni l'additionner ni
          // la remplacer et donc altérer la quantité acceptée.
          if (existante.cycleLivraison) return { type: "cycleImmuable" as const, existante };
          if (strategie === "REMPLACER" && existante.reglements.length > 0) {
            return { type: "reglementsPresents" as const, existante };
          }

          const totaux =
            strategie === "MODIFIER"
              ? {
                  quantiteBacs: existante.quantiteBacs + quantiteBacs,
                  montantRecu: existante.montantRecu + montantRecu,
                }
              : { quantiteBacs, montantRecu };

          const avanceExistante = avanceAvantCommande({
            avanceDisponibleClient: client.avanceDisponible,
            avanceUtilisee: existante.avanceUtilisee,
            avanceGeneree: existante.avanceGeneree,
          });
          const calcul = calculerCommande({
            quantiteBacs: totaux.quantiteBacs,
            prixParBac: client.typeClient.prixParBac,
            avanceExistante,
            montantRecu: totaux.montantRecu,
          });

          // MODIFIER/REMPLACER : mise à jour d'une commande EXISTANTE — donc
          // auditée. `updateMany` (jamais `update` singulier) pour ne pas être
          // intercepté par l'extension d'audit automatique, non transactionnelle
          // (voir services/caisseAtomique.ts) ; audit manuel dans la même tx.
          await tx.commandeClient.updateMany({
            where: { id: existante.id },
            data: {
              quantiteBacs: totaux.quantiteBacs,
              montantBrut: calcul.montantBrut,
              commission: calculerCommission({
                quantiteBacs: totaux.quantiteBacs,
                commissionParBac: client.typeClient.commissionParBac,
              }),
              avanceUtilisee: calcul.avanceUtilisee,
              montantAPercevoir: calcul.montantAPercevoir,
              montantRecu: totaux.montantRecu,
              dette: calcul.dette,
              avanceGeneree: calcul.avanceGeneree,
              nouvelleAvance: calcul.nouvelleAvance,
            },
          });
          const maj = await tx.commandeClient.findUniqueOrThrow({ where: { id: existante.id }, include: INCLUDE_RELATIONS });
          await auditerCaisseTx(tx, {
            module: "COMMANDES",
            typeEntite: "CommandeClient",
            entiteId: existante.id,
            action: "MODIFICATION",
            avant: existante,
            apres: maj,
          });

          const clientAvant = client;
          await tx.client.updateMany({
            where: { id: client.id },
            data: { avanceDisponible: calcul.nouvelleAvance },
          });
          const clientApres = await tx.client.findUniqueOrThrow({ where: { id: client.id } });
          await auditerCaisseTx(tx, {
            module: "COMMANDES",
            typeEntite: "Client",
            entiteId: client.id,
            action: "MODIFICATION",
            avant: clientAvant,
            apres: clientApres,
          });

          return { type: "miseAJour" as const, commande: maj, strategie };
        },
        (resultat) => {
        if (resultat.type === "conflit") {
          const existant = versCommandeDTO(resultat.existante);
          return {
            statutHttp: 409,
            corps: {
              erreur: `${existant.client.nom} a déjà la commande n°${existant.numero} aujourd'hui (${existant.quantiteBacs} bac(s), reçu ${formatFc(existant.montantRecu)}). Choisissez Modifier ou Remplacer.`,
              conflit: true,
              commandeExistante: existant,
              apercu: {
                MODIFIER: {
                  quantiteBacs: existant.quantiteBacs + quantiteBacs,
                  montantRecu: existant.montantRecu + montantRecu,
                },
                REMPLACER: { quantiteBacs, montantRecu },
              },
            },
          };
        }
        if (resultat.type === "reglementsPresents") {
          return {
            statutHttp: 409,
            corps: {
              erreur: `La commande n°${resultat.existante.numero} a déjà reçu ${resultat.existante.reglements.length} règlement(s) : elle ne peut pas être remplacée. Utilisez « Modifier ».`,
            },
          };
        }
        if (resultat.type === "cycleImmuable") {
          return {
            statutHttp: 409,
            corps: {
              code: "ACCEPTATION_DEJA_CONVERTIE",
              erreur: `La commande n°${resultat.existante.numero} provient d'une acceptation de livraison et ne peut pas être modifiée manuellement.`,
            },
          };
        }
        return {
          statutHttp: resultat.type === "creee" ? 201 : 200,
          corps: { commande: versCommandeDTO(resultat.commande) },
        };
      },
      ),
    );

    ajouterEnteteRejeu(res, execution.rejoue);
    if (
      !execution.rejoue &&
      execution.valeur &&
      (execution.valeur.type === "creee" || execution.valeur.type === "miseAJour") &&
      execution.corps.commande
    ) {
      const dto = execution.corps.commande;
      const valeur = execution.valeur;
      const prefixe =
        valeur.type === "creee"
          ? `Commande n°${dto.numero}`
          : `Commande n°${dto.numero} ${(valeur.strategie as StrategieDoublon) === "MODIFIER" ? "modifiée" : "remplacée"}`;

      busEvenements.emettreEvenement({
        type: "NOUVELLE_COMMANDE",
        module: "COMMANDES",
        emetteurId: req.utilisateur!.id,
        evenementRef: dto.id,
        message:
          `${prefixe} — ${dto.client.nom} (${dto.qualite}) : ${dto.quantiteBacs} bac(s), ` +
          `à percevoir ${formatFc(dto.montantAPercevoir)}, reçu ${formatFc(dto.montantRecu)}` +
          (dto.dette > 0 ? ` — dette ${formatFc(dto.dette)}` : "") +
          (dto.avanceGeneree > 0 ? ` — avance générée ${formatFc(dto.avanceGeneree)}` : ""),
        donnees: {
          commandeId: dto.id,
          numero: dto.numero,
          strategie: valeur.type === "miseAJour" ? valeur.strategie : null,
        },
      });
    }

    res.status(execution.statutHttp).json(execution.corps);
  } catch (e) {
    if (e instanceof ErreurClientInconnu) {
      return res.status(400).json({ erreur: "Client inconnu" });
    }
    if (e instanceof ErreurIdempotence) {
      return res.status(e.statutHttp).json({ erreur: e.message, code: e.code });
    }
    if (e instanceof ErreurEcritureCaisseReessayable) {
      return res.status(503).json({ erreur: e.message });
    }
    if (e instanceof ErreurAction) {
      return res.status(e.status).json({ erreur: e.message });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return res.status(409).json({
        erreur: "Une commande existe déjà pour ce client et ce jour à Kinshasa",
        code: "COMMANDE_JOUR_EXISTANTE",
      });
    }
    next(e);
  }
});

// Déclaration d'un règlement (section 3.4, Lot 6 — correction P0-07) : le
// Chargé des commandes déclare l'argent qu'il dit avoir reçu, mais la dette
// n'est PAS réduite ici — seule sa confirmation par la Caisse
// (POST /api/caisse/sessions/:id/confirmer-reglements, comptage
// contradictoire) applique l'effet sur montantRecu/dette/avance. La garde
// compare au restant dû APRÈS déclarations déjà en attente, pour ne jamais
// permettre de déclarer plus que ce qui reste réellement à percevoir.
commandesRouter.post("/:id/reglements", requirePermission("COMMANDES", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = reglementCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { montant } = parsed.data;

    const execution = await executerEcritureIdempotente<
      ResultatReglementEcriture,
      CorpsReglementEcriture
    >(
      req,
      `POST:/api/commandes/${req.params.id}/reglements`,
      parsed.data,
      async (tx) => {
        const commande = await tx.commandeClient.findUnique({
          where: { id: req.params.id },
          include: { reglements: { select: { statut: true, montant: true } } },
        });
        if (!commande) return { type: "introuvable" as const };
        const detteRestante = commande.dette - sommeDeclarationsEnAttente(commande.reglements);
        if (montant > detteRestante) return { type: "sansDette" as const };

        await tx.paiementCommande.create({
          data: {
            commandeClientId: commande.id,
            montant,
            enregistreParId: req.utilisateur!.id,
          },
        });
        const maj = await tx.commandeClient.findUniqueOrThrow({
          where: { id: commande.id },
          include: INCLUDE_RELATIONS,
        });
        return { type: "reglee" as const, commande: maj };
      },
      (resultat) => {
        if (resultat.type === "introuvable") {
          return { statutHttp: 404, corps: { erreur: "Commande introuvable" } };
        }
        if (resultat.type === "sansDette") {
          return { statutHttp: 409, corps: { erreur: "Ce montant dépasse la dette restant à déclarer sur cette commande" } };
        }
        return { statutHttp: 201, corps: { commande: versCommandeDTO(resultat.commande) } };
      },
    );

    ajouterEnteteRejeu(res, execution.rejoue);
    if (!execution.rejoue && execution.valeur?.type === "reglee" && execution.corps.commande) {
      const dto = execution.corps.commande;
      busEvenements.emettreEvenement({
        type: "REGLEMENT_COMMANDE",
        module: "COMMANDES",
        emetteurId: req.utilisateur!.id,
        evenementRef: dto.id,
        message: `Règlement de ${formatFc(montant)} déclaré sur la commande n°${dto.numero} — ${dto.client.nom} — en attente de confirmation par la Caisse`,
        donnees: { commandeId: dto.id, numero: dto.numero, montant },
      });
    }

    res.status(execution.statutHttp).json(execution.corps);
  } catch (e) {
    if (e instanceof ErreurIdempotence) {
      return res.status(e.statutHttp).json({ erreur: e.message, code: e.code });
    }
    next(e);
  }
});

class ErreurClientInconnu extends Error {}
