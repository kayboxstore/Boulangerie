import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  calculerCommande,
  calculerDepenseFarine,
  confirmerReglementsSchema,
  dateISOSchema,
  depenseCreateSchema,
  depenseFarineSchema,
  formatFc,
  MOTIF_DEPENSE_FARINE,
  remiseCaisseCreateSchema,
  sessionCaisseCorrectionSchema,
  sessionCaisseFermetureSchema,
  sessionCaisseOuvertureSchema,
  tauxDuJourSchema,
  type BlocageFarine,
  type DepenseCaisseDTO,
  type OrigineDepense,
  type RegistreCaisseDTO,
  type ReglementDeclareDTO,
  type RemiseCaisseDTO,
  type SessionCaisseDTO,
  type TauxDuJourDTO,
} from "@lomoto/shared";
import { prisma, type TxClient } from "../lib/prisma.js";
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
  estViolationContrainteUnique,
  executerAvecReessaiP2034,
  ErreurEcritureCaisseReessayable,
  transactionSerializable,
  verifierAucuneSessionAnterieureOuverte,
  verrouillerSessionFermeeParId,
  verrouillerSessionOuverte,
  verrouillerSessionOuverteParId,
} from "../services/caisseAtomique.js";

export const caisseRouter = Router();

caisseRouter.use(requireAuth);

const lecture = requirePermission("CAISSE", "LECTURE");
const ecriture = requirePermission("CAISSE", "ECRITURE");

/**
 * Erreur locale (jamais partagée hors de ce fichier) : la clôture exige un
 * motif dès que l'écart théorique/compté est non nul — code distinct de
 * `ErreurAction` car le contrat HTTP porte un `code` en plus du message.
 */
class ErreurEcartNonMotive extends Error {
  constructor(message: string) {
    super(message);
  }
}

const versTauxDTO = (t: {
  id: string;
  date: Date;
  valeur: Prisma.Decimal;
  definiPar: { id: string; nom: string } | null;
  updatedAt: Date;
}): TauxDuJourDTO => ({
  id: t.id,
  date: jourLomoto(t.date),
  valeur: t.valeur.toNumber(),
  definiPar: t.definiPar,
  updatedAt: t.updatedAt.toISOString(),
});

const versDepenseDTO = (d: {
  id: string;
  date: Date;
  motif: string;
  montant: number;
  origine: string;
  tauxApplique: Prisma.Decimal | null;
  sacsUtilises: Prisma.Decimal | null;
  enregistrePar: { id: string; nom: string } | null;
}): DepenseCaisseDTO => ({
  id: d.id,
  date: jourLomoto(d.date),
  motif: d.motif,
  montant: d.montant,
  origine: d.origine as OrigineDepense,
  tauxApplique: d.tauxApplique?.toNumber() ?? null,
  sacsUtilises: d.sacsUtilises?.toNumber() ?? null,
  enregistrePar: d.enregistrePar,
});

const INCLUDE_DEPENSE = { enregistrePar: { select: { id: true, nom: true } } } as const;
const INCLUDE_TAUX = { definiPar: { select: { id: true, nom: true } } } as const;
const INCLUDE_SESSION = {
  ouvertePar: { select: { id: true, nom: true } },
  fermeePar: { select: { id: true, nom: true } },
  derniereCorrectionPar: { select: { id: true, nom: true } },
} as const;
const INCLUDE_REMISE = {
  recuPar: { select: { id: true, nom: true } },
  enregistrePar: { select: { id: true, nom: true } },
} as const;

type SessionAvecRelations = Prisma.SessionCaisseGetPayload<{ include: typeof INCLUDE_SESSION }>;

const versSessionDTO = (s: SessionAvecRelations): SessionCaisseDTO => ({
  id: s.id,
  date: jourLomoto(s.date),
  statut: s.statut,
  soldeOuverture: s.soldeOuverture,
  soldeTheoriqueFermeture: s.soldeTheoriqueFermeture,
  soldeCompteFermeture: s.soldeCompteFermeture,
  ecartFermeture: s.ecartFermeture,
  motifEcart: s.motifEcart,
  ouvertePar: s.ouvertePar,
  ouverteLe: s.ouverteLe.toISOString(),
  fermeePar: s.fermeePar,
  fermeeLe: s.fermeeLe ? s.fermeeLe.toISOString() : null,
  derniereCorrectionLe: s.derniereCorrectionLe ? s.derniereCorrectionLe.toISOString() : null,
  derniereCorrectionPar: s.derniereCorrectionPar,
  motifCorrection: s.motifCorrection,
  updatedAt: s.updatedAt.toISOString(),
});

const versRemiseDTO = (
  r: Prisma.RemiseCaisseGetPayload<{ include: typeof INCLUDE_REMISE }>,
): RemiseCaisseDTO => ({
  id: r.id,
  sessionCaisseId: r.sessionCaisseId,
  montant: r.montant,
  remisParNom: r.remisParNom,
  recuPar: r.recuPar,
  reference: r.reference,
  observation: r.observation,
  dateRemise: r.dateRemise.toISOString(),
});

/** Sacs de farine consommés en production sur la date donnée (source du calcul). */
async function sacsUtilisesLe(db: TxClient, date: string): Promise<number> {
  const [debut, fin] = bornesJourLomoto(date);
  const agg = await db.production.aggregate({
    where: { date: { gte: debut, lte: fin } },
    _sum: { sacsUtilises: true },
  });
  return agg._sum.sacsUtilises?.toNumber() ?? 0;
}

/**
 * Registre journalier (section 3.1) — tx-aware (P1-B) : `db` est `prisma`
 * (lecture seule, GET /registre) ou `tx` (à l'intérieur de la transaction de
 * clôture, pour que le théorique figé reflète exactement l'état lu SOUS le
 * verrou de ligne SessionCaisse, jamais un instantané pris avant).
 *
 * Les deux postes automatiques restent DISJOINTS par construction, pour
 * qu'aucun franc ne soit compté deux fois :
 *  - Entrées      = argent reçu à la CRÉATION des commandes du jour, soit
 *                   `montantRecu − somme de ses règlements CONFIRME` (le
 *                   montant reçu porté par une commande inclut ses
 *                   règlements ultérieurs, une fois confirmés), sélectionnées
 *                   par `dateOperationnelle` (repli sur `dateCreation`
 *                   uniquement pour les lignes historiques où elle est
 *                   nulle) — jamais `dateCreation` seule, qui divergerait du
 *                   jour métier réel pour une commande issue d'une
 *                   acceptation C4 (dateOperationnelle = date de livraison,
 *                   potentiellement close, alors que dateCreation = date
 *                   d'acceptation).
 *  - Dettes payées = règlements CONFIRME attribués à CETTE session via la
 *                   relation `paiementCommande.remiseCaisse.sessionCaisse`
 *                   (P1-B, 28/08/2026) — jamais selon `paiementCommande.date`
 *                   (date de DÉCLARATION par le Chargé des commandes, qui
 *                   peut précéder la confirmation par la Caisse de plusieurs
 *                   jours). Une déclaration à J confirmée dans la session
 *                   J+1 compte donc intégralement et exclusivement sur J+1 :
 *                   le théorique déjà figé de J n'est jamais réécrit
 *                   rétroactivement par une confirmation tardive.
 */
async function construireRegistre(db: TxClient, date: string): Promise<RegistreCaisseDTO> {
  const [debut, fin] = bornesJourLomoto(date);
  const dateSQL = dateSQLDepuisJourLomoto(date);

  const commandesDuJour = await db.commandeClient.findMany({
    where: {
      OR: [
        { dateOperationnelle: dateSQL },
        { dateOperationnelle: null, dateCreation: { gte: debut, lte: fin } },
      ],
    },
    select: { montantRecu: true, reglements: { where: { statut: "CONFIRME" }, select: { montant: true } } },
  });
  const entrees = commandesDuJour.reduce((somme, c) => {
    const verseALaCreation = c.montantRecu - c.reglements.reduce((s, r) => s + r.montant, 0);
    return somme + Math.max(0, verseALaCreation);
  }, 0);

  const reglementsDuJour = await db.paiementCommande.findMany({
    where: { statut: "CONFIRME", remiseCaisse: { sessionCaisse: { date: dateSQL } } },
    include: {
      commandeClient: { select: { numero: true, client: { select: { nom: true } } } },
    },
    orderBy: { confirmeLe: "asc" },
  });
  const dettesPayees = reglementsDuJour.reduce((s, r) => s + r.montant, 0);

  const depenses = await db.depenseCaisse.findMany({
    where: { date: dateSQL },
    include: INCLUDE_DEPENSE,
    orderBy: { createdAt: "asc" },
  });
  const totalDepenses = depenses.reduce((s, d) => s + d.montant, 0);

  const taux = await db.tauxDuJour.findUnique({
    where: { date: dateSQL },
    include: INCLUDE_TAUX,
  });
  const sacsUtilisesJour = await sacsUtilisesLe(db, date);

  // Case farine : indisponible tant qu'il manque le taux ou la production du
  // jour — on l'explique plutôt que de calculer sur une valeur absente ou un
  // zéro trompeur.
  let blocage: BlocageFarine | null = null;
  if (!taux) blocage = "TAUX_MANQUANT";
  else if (sacsUtilisesJour <= 0) blocage = "PRODUCTION_MANQUANTE";

  return {
    date,
    entrees,
    dettesPayees,
    detailDettesPayees: reglementsDuJour.map((r) => ({
      id: r.id,
      clientNom: r.commandeClient.client.nom,
      commandeNumero: r.commandeClient.numero,
      montant: r.montant,
      // Date de CONFIRMATION (affichage) — jamais la date de déclaration :
      // confirmeLe est toujours posé de pair avec statut=CONFIRME (invariant
      // applicatif de confirmer-reglements ci-dessous).
      date: (r.confirmeLe ?? r.date).toISOString(),
    })),
    depenses: depenses.map(versDepenseDTO),
    totalDepenses,
    solde: entrees + dettesPayees - totalDepenses,
    taux: taux ? versTauxDTO(taux) : null,
    sacsUtilisesJour,
    farine: {
      active: depenses.some((d) => d.origine === "FARINE"),
      blocage,
      montantEstime: blocage ? null : calculerDepenseFarine(taux!.valeur.toNumber(), sacsUtilisesJour),
    },
  };
}

// --- Registre ---------------------------------------------------------------

caisseRouter.get("/registre", lecture, async (req, res, next) => {
  try {
    const { date } = req.query as Record<string, string | undefined>;
    if (date && !dateISOSchema.safeParse(date).success) {
      return res.status(400).json({ erreur: "Date invalide (AAAA-MM-JJ)" });
    }
    const cible = date ?? jourLomoto();
    res.json({ registre: await construireRegistre(prisma, cible) });
  } catch (e) {
    next(e);
  }
});

// Session antérieure restée OUVERTE (correction bug terrain) : interrogée
// indépendamment de la date consultée, pour avertir dès l'ouverture de
// l'écran plutôt qu'à la première écriture refusée.
caisseRouter.get("/session-bloquante", lecture, async (_req, res, next) => {
  try {
    const anterieure = await prisma.sessionCaisse.findFirst({
      where: { statut: "OUVERTE", date: { lt: dateSQLDepuisJourLomoto(jourLomoto()) } },
      orderBy: { date: "asc" },
    });
    res.json({ date: anterieure ? jourLomoto(anterieure.date) : null });
  } catch (e) {
    next(e);
  }
});

/** Traduit les erreurs communes à toutes les routes d'écriture de ce fichier. */
function traduireErreurEcriture(e: unknown, res: import("express").Response, next: import("express").NextFunction): void {
  if (e instanceof ErreurIdempotence) {
    res.status(e.statutHttp).json({ erreur: e.message, code: e.code });
    return;
  }
  if (e instanceof ErreurEcritureCaisseReessayable) {
    res.status(503).json({ erreur: e.message });
    return;
  }
  if (e instanceof ErreurEcartNonMotive) {
    res.status(400).json({ code: "ECART_NON_MOTIVE", erreur: e.message });
    return;
  }
  if (e instanceof ErreurAction) {
    res.status(e.status).json({ erreur: e.message });
    return;
  }
  next(e);
}

// --- Taux du jour -----------------------------------------------------------

// Une valeur par date : un second envoi sur la même date met à jour la valeur
// (audit manuel transactionnel — voir caisseAtomique.ts). Exige une session
// OUVERTE pour la date (P1-B) : verrou de ligne posé avant toute lecture ou
// écriture pertinente.
caisseRouter.put("/taux", ecriture, async (req, res, next) => {
  try {
    const parsed = tauxDuJourSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { date, valeur, versionAttendue } = parsed.data;

    const taux = await executerAvecReessaiP2034(() =>
      transactionSerializable(prisma, async (tx) => {
        await verrouillerSessionOuverte(tx, date);
        await verifierAucuneSessionAnterieureOuverte(tx, date);

        const existant = await tx.tauxDuJour.findUnique({ where: { date: dateSQLDepuisJourLomoto(date) } });
        if (existant) {
          if (!versionAttendue || existant.updatedAt.toISOString() !== versionAttendue) {
            throw new ErreurAction(409, "Ce taux a été modifié entre-temps — rechargez avant de réessayer.");
          }
          const { count } = await tx.tauxDuJour.updateMany({
            where: { id: existant.id, updatedAt: existant.updatedAt },
            data: { valeur, definiParId: req.utilisateur!.id },
          });
          if (count === 0) {
            throw new ErreurAction(409, "Ce taux a été modifié entre-temps — rechargez avant de réessayer.");
          }
          const maj = await tx.tauxDuJour.findUniqueOrThrow({ where: { id: existant.id }, include: INCLUDE_TAUX });
          await auditerCaisseTx(tx, {
            module: "CAISSE",
            typeEntite: "TauxDuJour",
            entiteId: existant.id,
            action: "MODIFICATION",
            avant: existant,
            apres: maj,
          });
          return maj;
        }

        try {
          return await tx.tauxDuJour.create({
            data: { date: dateSQLDepuisJourLomoto(date), valeur, definiParId: req.utilisateur!.id },
            include: INCLUDE_TAUX,
          });
        } catch (e) {
          if (estViolationContrainteUnique(e)) {
            throw new ErreurAction(409, "Un taux vient d'être défini pour cette date — rechargez la page.");
          }
          throw e;
        }
      }),
    );

    const dto = versTauxDTO(taux);
    busEvenements.emettreEvenement({
      type: "REGISTRE_CAISSE",
      module: "CAISSE",
      emetteurId: req.utilisateur!.id,
      evenementRef: dto.id,
      message: `Taux du jour défini pour le ${dto.date} : ${dto.valeur}`,
      donnees: { date: dto.date, valeur: dto.valeur },
    });

    res.json({ taux: dto });
  } catch (e) {
    traduireErreurEcriture(e, res, next);
  }
});

// --- Dépenses ---------------------------------------------------------------

caisseRouter.post("/depenses", ecriture, async (req, res, next) => {
  try {
    const parsed = depenseCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { date, motif, montant } = parsed.data;

    const execution = await executerAvecReessaiP2034(() =>
      executerEcritureIdempotente(
        req,
        "POST:/api/caisse/depenses",
        parsed.data,
        async (tx) => {
          await verrouillerSessionOuverte(tx, date);
          await verifierAucuneSessionAnterieureOuverte(tx, date);
          return tx.depenseCaisse.create({
            data: {
              date: dateSQLDepuisJourLomoto(date),
              motif,
              montant,
              origine: "MANUELLE",
              enregistreParId: req.utilisateur!.id,
            },
            include: INCLUDE_DEPENSE,
          });
        },
        (depense) => ({ statutHttp: 201, corps: { depense: versDepenseDTO(depense) } }),
      ),
    );

    ajouterEnteteRejeu(res, execution.rejoue);
    if (!execution.rejoue) {
      const dto = execution.corps.depense;
      busEvenements.emettreEvenement({
        type: "REGISTRE_CAISSE",
        module: "CAISSE",
        emetteurId: req.utilisateur!.id,
        evenementRef: dto.id,
        message: `Dépense de caisse le ${dto.date} : ${dto.motif} — ${formatFc(dto.montant)}`,
        donnees: { depenseId: dto.id, montant: dto.montant },
      });
    }

    res.status(execution.statutHttp).json(execution.corps);
  } catch (e) {
    traduireErreurEcriture(e, res, next);
  }
});

caisseRouter.delete("/depenses/:id", ecriture, async (req, res, next) => {
  try {
    const apercu = await prisma.depenseCaisse.findUnique({ where: { id: req.params.id } });
    if (!apercu) return res.status(404).json({ erreur: "Dépense introuvable" });
    const date = jourLomoto(apercu.date);

    const supprimee = await executerAvecReessaiP2034(() =>
      transactionSerializable(prisma, async (tx) => {
        await verrouillerSessionOuverte(tx, date);
        await verifierAucuneSessionAnterieureOuverte(tx, date);
        const depense = await tx.depenseCaisse.findUnique({ where: { id: req.params.id } });
        if (!depense) throw new ErreurAction(404, "Dépense introuvable");
        const { count } = await tx.depenseCaisse.deleteMany({ where: { id: depense.id } });
        if (count === 0) throw new ErreurAction(404, "Dépense introuvable");
        await auditerCaisseTx(tx, {
          module: "CAISSE",
          typeEntite: "DepenseCaisse",
          entiteId: depense.id,
          action: "SUPPRESSION",
          avant: depense,
          apres: null,
        });
        return depense;
      }),
    );

    busEvenements.emettreEvenement({
      type: "REGISTRE_CAISSE",
      module: "CAISSE",
      emetteurId: req.utilisateur!.id,
      evenementRef: supprimee.id,
      message: `Dépense retirée du registre du ${date} : ${supprimee.motif} — ${formatFc(supprimee.montant)}`,
      donnees: { depenseId: supprimee.id },
    });
    res.status(204).end();
  } catch (e) {
    traduireErreurEcriture(e, res, next);
  }
});

/**
 * Case à cocher « dépense farine » (section 3.1). Cocher ajoute la ligne
 * automatique au motif figé, décocher la retire. Le montant est figé à
 * l'enregistrement, avec le taux et les sacs utilisés pour rester vérifiable.
 * Au plus une ligne FARINE par date est garantie par un index unique PARTIEL
 * PostgreSQL déjà existant (`DepenseCaisse_date_farinee_key`, migration
 * 20260813180500) — la violation P2002 qui en résulterait en cas de double
 * activation concurrente est traduite ici en 409 métier.
 */
caisseRouter.put("/depenses/farine", ecriture, async (req, res, next) => {
  try {
    const parsed = depenseFarineSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { date, active } = parsed.data;

    type ResultatFarine =
      | { type: "desactivee"; depense: { id: string; motif: string; montant: number } }
      | { type: "aucun_changement" }
      | { type: "activee"; depense: { id: string; motif: string; montant: number; sacs: number; taux: number } };

    const resultat = await executerAvecReessaiP2034(() =>
      transactionSerializable<ResultatFarine>(prisma, async (tx) => {
        await verrouillerSessionOuverte(tx, date);
        await verifierAucuneSessionAnterieureOuverte(tx, date);

        const existante = await tx.depenseCaisse.findFirst({
          where: { date: dateSQLDepuisJourLomoto(date), origine: "FARINE" },
        });

        if (!active) {
          if (!existante) return { type: "aucun_changement" as const };
          const { count } = await tx.depenseCaisse.deleteMany({ where: { id: existante.id } });
          if (count === 0) return { type: "aucun_changement" as const };
          await auditerCaisseTx(tx, {
            module: "CAISSE",
            typeEntite: "DepenseCaisse",
            entiteId: existante.id,
            action: "SUPPRESSION",
            avant: existante,
            apres: null,
          });
          return { type: "desactivee" as const, depense: { id: existante.id, motif: existante.motif, montant: existante.montant } };
        }

        if (existante) {
          throw new ErreurAction(409, "La dépense farine est déjà enregistrée pour cette date");
        }

        const taux = await tx.tauxDuJour.findUnique({ where: { date: dateSQLDepuisJourLomoto(date) } });
        if (!taux) {
          throw new ErreurAction(409, "Définissez d'abord le taux du jour pour cette date");
        }
        const sacs = await sacsUtilisesLe(tx, date);
        if (sacs <= 0) {
          throw new ErreurAction(
            409,
            "Aucune production enregistrée pour cette date : le nombre de sacs utilisés est inconnu",
          );
        }

        const valeurTaux = taux.valeur.toNumber();
        try {
          const depense = await tx.depenseCaisse.create({
            data: {
              date: dateSQLDepuisJourLomoto(date),
              motif: MOTIF_DEPENSE_FARINE,
              montant: calculerDepenseFarine(valeurTaux, sacs),
              origine: "FARINE",
              tauxApplique: valeurTaux,
              sacsUtilises: sacs,
              enregistreParId: req.utilisateur!.id,
            },
          });
          return { type: "activee" as const, depense: { id: depense.id, motif: depense.motif, montant: depense.montant, sacs, taux: valeurTaux } };
        } catch (e) {
          if (estViolationContrainteUnique(e)) {
            throw new ErreurAction(409, "La dépense farine est déjà enregistrée pour cette date");
          }
          throw e;
        }
      }),
    );

    if (resultat.type === "activee") {
      const { depense } = resultat;
      busEvenements.emettreEvenement({
        type: "REGISTRE_CAISSE",
        module: "CAISSE",
        emetteurId: req.utilisateur!.id,
        evenementRef: depense.id,
        message: `Dépense farine le ${date} : ${depense.sacs} sac(s) au taux ${depense.taux} — ${formatFc(depense.montant)}`,
        donnees: { depenseId: depense.id, montant: depense.montant, sacs: depense.sacs, taux: depense.taux },
      });
    }

    const registre = await construireRegistre(prisma, date);
    res.status(resultat.type === "activee" ? 201 : 200).json({ registre });
  } catch (e) {
    traduireErreurEcriture(e, res, next);
  }
});

// --- Sessions de caisse (section 3.1, Lot 6) --------------------------------

type ResultatOuvertureSession =
  | { type: "existante" }
  | { type: "anterieureOuverte"; date: string }
  | { type: "creee"; session: SessionAvecRelations };

interface CorpsOuvertureSession {
  session?: SessionCaisseDTO;
  erreur?: string;
}

// Une session par date (contrainte SQL). Refuse aussi d'ouvrir une nouvelle
// date tant qu'une session antérieure reste OUVERTE. Non concernée par la
// nouvelle exigence « session OUVERTE requise » (P1-B) : c'est justement
// l'action qui en crée une — déjà atomique (existante/antérieure/création
// dans la même transaction idempotente), inchangée par ce lot.
caisseRouter.post("/sessions", ecriture, async (req, res, next) => {
  try {
    const parsed = sessionCaisseOuvertureSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { date, soldeOuverture } = parsed.data;

    const execution = await executerEcritureIdempotente<ResultatOuvertureSession, CorpsOuvertureSession>(
      req,
      "POST:/api/caisse/sessions",
      parsed.data,
      async (tx) => {
        const existante = await tx.sessionCaisse.findUnique({ where: { date: dateSQLDepuisJourLomoto(date) } });
        if (existante) return { type: "existante" as const };

        const anterieureOuverte = await tx.sessionCaisse.findFirst({
          where: { statut: "OUVERTE", date: { lt: dateSQLDepuisJourLomoto(date) } },
          orderBy: { date: "asc" },
        });
        if (anterieureOuverte) {
          return { type: "anterieureOuverte" as const, date: jourLomoto(anterieureOuverte.date) };
        }

        const session = await tx.sessionCaisse.create({
          data: { date: dateSQLDepuisJourLomoto(date), soldeOuverture, ouverteParId: req.utilisateur!.id },
          include: INCLUDE_SESSION,
        });
        return { type: "creee" as const, session };
      },
      (resultat) => {
        if (resultat.type === "existante") {
          return { statutHttp: 409, corps: { erreur: "Une session de caisse existe déjà pour cette date" } };
        }
        if (resultat.type === "anterieureOuverte") {
          return {
            statutHttp: 409,
            corps: { erreur: `Clôturez d'abord la session du ${resultat.date} avant d'en ouvrir une nouvelle` },
          };
        }
        return { statutHttp: 201, corps: { session: versSessionDTO(resultat.session) } };
      },
    );

    ajouterEnteteRejeu(res, execution.rejoue);
    if (!execution.rejoue && execution.corps.session) {
      const dto = execution.corps.session;
      busEvenements.emettreEvenement({
        type: "SESSION_CAISSE_OUVERTE",
        module: "CAISSE",
        emetteurId: req.utilisateur!.id,
        evenementRef: dto.id,
        message: `Session de caisse ouverte pour le ${dto.date} — solde d'ouverture ${formatFc(dto.soldeOuverture)}`,
        donnees: { sessionId: dto.id, soldeOuverture: dto.soldeOuverture },
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

caisseRouter.get("/sessions/:date", lecture, async (req, res, next) => {
  try {
    if (!dateISOSchema.safeParse(req.params.date).success) {
      return res.status(400).json({ erreur: "Date invalide (AAAA-MM-JJ)" });
    }
    const session = await prisma.sessionCaisse.findUnique({
      where: { date: dateSQLDepuisJourLomoto(req.params.date) },
      include: INCLUDE_SESSION,
    });
    if (!session) return res.status(404).json({ erreur: "Aucune session pour cette date" });
    res.json({ session: versSessionDTO(session) });
  } catch (e) {
    next(e);
  }
});

caisseRouter.get("/sessions/:id/remises", lecture, async (req, res, next) => {
  try {
    const remises = await prisma.remiseCaisse.findMany({
      where: { sessionCaisseId: req.params.id },
      include: INCLUDE_REMISE,
      orderBy: { dateRemise: "desc" },
    });
    res.json({ remises: remises.map(versRemiseDTO) });
  } catch (e) {
    next(e);
  }
});

// Remise contradictoire générale (section 3.1, point 3) — enregistre un
// transfert d'espèces, deux parties (remisParNom en texte libre, recuPar
// l'utilisateur connecté). Purement documentaire : n'affecte ni le registre
// ni la dette (contrairement à /confirmer-reglements, ci-dessous). Exige
// néanmoins une session OUVERTE (P1-B) : l'intégrité de l'audit d'une
// journée déjà close ne doit jamais accueillir une remise nouvelle.
caisseRouter.post("/sessions/:id/remises", ecriture, async (req, res, next) => {
  try {
    const parsed = remiseCaisseCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { montant, remisParNom, reference, observation } = parsed.data;

    const execution = await executerAvecReessaiP2034(() =>
      executerEcritureIdempotente(
        req,
        `POST:/api/caisse/sessions/${req.params.id}/remises`,
        parsed.data,
        async (tx) => {
          const session = await verrouillerSessionOuverteParId(tx, req.params.id);
          await verifierAucuneSessionAnterieureOuverte(tx, jourLomoto(session.date));
          return tx.remiseCaisse.create({
            data: {
              sessionCaisseId: session.id,
              montant,
              remisParNom,
              recuParId: req.utilisateur!.id,
              enregistreParId: req.utilisateur!.id,
              reference,
              observation,
            },
            include: INCLUDE_REMISE,
          });
        },
        (remise) => ({ statutHttp: 201, corps: { remise: versRemiseDTO(remise) } }),
      ),
    );

    ajouterEnteteRejeu(res, execution.rejoue);
    if (!execution.rejoue) {
      const dto = execution.corps.remise;
      busEvenements.emettreEvenement({
        type: "REMISE_CAISSE_ENREGISTREE",
        module: "CAISSE",
        emetteurId: req.utilisateur!.id,
        evenementRef: dto.id,
        message: `Remise de ${formatFc(dto.montant)} par ${dto.remisParNom}`,
        donnees: { remiseId: dto.id, montant: dto.montant },
      });
    }

    res.status(execution.statutHttp).json(execution.corps);
  } catch (e) {
    traduireErreurEcriture(e, res, next);
  }
});

// Clôture (points 4, 6, 8) : le théorique est calculé côté serveur, jamais
// fourni par le client. Un écart non nul exige un motif — sinon la clôture
// perdrait toute valeur de comptage contradictoire. P1-B : verrouille la
// session en premier, reconstruit le registre intégralement avec `tx`,
// vérifie les sessions antérieures, ferme et audite — tout avant le commit.
caisseRouter.post("/sessions/:id/cloturer", ecriture, async (req, res, next) => {
  try {
    const parsed = sessionCaisseFermetureSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { soldeCompteFermeture, motif } = parsed.data;

    const resultat = await executerAvecReessaiP2034(() =>
      transactionSerializable(prisma, async (tx) => {
        const session = await verrouillerSessionOuverteParId(tx, req.params.id);
        const dateStr = jourLomoto(session.date);
        await verifierAucuneSessionAnterieureOuverte(tx, dateStr);

        const registre = await construireRegistre(tx, dateStr);
        const soldeTheoriqueFermeture = session.soldeOuverture + registre.solde;
        const ecartFermeture = soldeCompteFermeture - soldeTheoriqueFermeture;
        if (ecartFermeture !== 0 && !motif) {
          throw new ErreurEcartNonMotive(
            `Écart de ${formatFc(ecartFermeture)} entre théorique et compté : un motif est requis pour clôturer`,
          );
        }

        const { count } = await tx.sessionCaisse.updateMany({
          where: { id: session.id, statut: "OUVERTE" },
          data: {
            statut: "FERMEE",
            soldeTheoriqueFermeture,
            soldeCompteFermeture,
            ecartFermeture,
            motifEcart: ecartFermeture !== 0 ? motif : null,
            fermeeLe: new Date(),
            fermeeParId: req.utilisateur!.id,
          },
        });
        // En pratique inatteignable : le verrou de ligne posé par
        // verrouillerSessionOuverteParId empêche toute autre transaction de
        // modifier `statut` entre la vérification et cet updateMany —
        // conservé par défense en profondeur, jamais un 500 générique.
        if (count === 0) {
          throw new ErreurAction(409, "Cette session vient d'être clôturée ailleurs — rechargez la page");
        }

        const fermee = await tx.sessionCaisse.findUniqueOrThrow({ where: { id: session.id }, include: INCLUDE_SESSION });
        await auditerCaisseTx(tx, {
          module: "CAISSE",
          typeEntite: "SessionCaisse",
          entiteId: session.id,
          action: "MODIFICATION",
          avant: session,
          apres: fermee,
        });
        return { fermee, soldeTheoriqueFermeture, soldeCompteFermeture, ecartFermeture };
      }),
    );

    const dto = versSessionDTO(resultat.fermee);
    busEvenements.emettreEvenement({
      type: "SESSION_CAISSE_CLOTUREE",
      module: "CAISSE",
      emetteurId: req.utilisateur!.id,
      evenementRef: dto.id,
      message:
        `Session de caisse du ${dto.date} clôturée — théorique ${formatFc(resultat.soldeTheoriqueFermeture)}, compté ${formatFc(resultat.soldeCompteFermeture)}` +
        (resultat.ecartFermeture !== 0 ? `, écart ${formatFc(resultat.ecartFermeture)}` : ""),
      donnees: {
        sessionId: dto.id,
        soldeTheoriqueFermeture: resultat.soldeTheoriqueFermeture,
        soldeCompteFermeture: resultat.soldeCompteFermeture,
        ecartFermeture: resultat.ecartFermeture,
      },
    });
    res.json({ session: dto });
  } catch (e) {
    traduireErreurEcriture(e, res, next);
  }
});

// Correction post-clôture (point 9) — droit spécial réservé à l'Admin
// Principal, même garde que POST /approbations/:id/approuver. Le théorique
// reste inchangé (stable, puisque la session FERMEE bloque toute nouvelle
// écriture sur le registre de cette date) ; seul le compté peut être corrigé.
// P1-B : verrou de ligne + jeton de concurrence optimiste transmis par le
// client (`versionAttendue`, l'`updatedAt` affiché) — deux corrections
// concurrentes ne peuvent jamais s'écraser silencieusement : la seconde,
// lue après que la première a committé sous le même verrou, porte une
// version devenue obsolète et échoue en 409.
caisseRouter.post("/sessions/:id/corriger", ecriture, async (req, res, next) => {
  try {
    if (!req.utilisateur!.estAdminPrincipal) {
      return res.status(403).json({ erreur: "Seul l'Administrateur principal peut corriger une session déjà clôturée" });
    }
    const parsed = sessionCaisseCorrectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { soldeCompteFermeture, motif, versionAttendue } = parsed.data;

    const corrigee = await executerAvecReessaiP2034(() =>
      transactionSerializable(prisma, async (tx) => {
        const session = await verrouillerSessionFermeeParId(tx, req.params.id);
        if (session.updatedAt.toISOString() !== versionAttendue) {
          throw new ErreurAction(409, "Cette session a été modifiée entre-temps — rechargez avant de corriger.");
        }
        const ecartFermeture = soldeCompteFermeture - session.soldeTheoriqueFermeture!;

        const { count } = await tx.sessionCaisse.updateMany({
          where: { id: session.id, updatedAt: session.updatedAt },
          data: {
            soldeCompteFermeture,
            ecartFermeture,
            motifEcart: ecartFermeture !== 0 ? motif : null,
            derniereCorrectionLe: new Date(),
            derniereCorrectionParId: req.utilisateur!.id,
            motifCorrection: motif,
          },
        });
        if (count === 0) {
          throw new ErreurAction(409, "Cette session a été modifiée entre-temps — rechargez avant de corriger.");
        }
        const maj = await tx.sessionCaisse.findUniqueOrThrow({ where: { id: session.id }, include: INCLUDE_SESSION });
        await auditerCaisseTx(tx, {
          module: "CAISSE",
          typeEntite: "SessionCaisse",
          entiteId: session.id,
          action: "MODIFICATION",
          avant: session,
          apres: maj,
        });
        return maj;
      }),
    );

    const dto = versSessionDTO(corrigee);
    busEvenements.emettreEvenement({
      type: "SESSION_CAISSE_CORRIGEE",
      module: "CAISSE",
      emetteurId: req.utilisateur!.id,
      priorite: "HAUTE",
      evenementRef: dto.id,
      message: `Session de caisse du ${dto.date} corrigée par l'Admin Principal — nouveau compté ${formatFc(soldeCompteFermeture)} (${motif})`,
      donnees: { sessionId: dto.id, soldeCompteFermeture, ecartFermeture: dto.ecartFermeture },
    });
    res.json({ session: dto });
  } catch (e) {
    traduireErreurEcriture(e, res, next);
  }
});

// --- Règlements déclarés / confirmés (Lot 6 — P0-07) -------------------------

caisseRouter.get("/reglements-declares", lecture, async (_req, res, next) => {
  try {
    const declares = await prisma.paiementCommande.findMany({
      where: { statut: "DECLARE" },
      include: {
        commandeClient: { select: { numero: true, client: { select: { nom: true } } } },
        enregistrePar: { select: { id: true, nom: true } },
      },
      orderBy: { date: "asc" },
    });
    const dto: ReglementDeclareDTO[] = declares.map((p) => ({
      id: p.id,
      commandeId: p.commandeClientId,
      commandeNumero: p.commandeClient.numero,
      clientNom: p.commandeClient.client.nom,
      montant: p.montant,
      date: p.date.toISOString(),
      enregistrePar: p.enregistrePar,
    }));
    res.json({ reglements: dto });
  } catch (e) {
    next(e);
  }
});

type ResultatConfirmation =
  | { type: "sessionIntrouvable" }
  | { type: "sessionFermee" }
  | { type: "reglementInvalide"; id: string }
  | {
      type: "confirme";
      remise: Prisma.RemiseCaisseGetPayload<{ include: typeof INCLUDE_REMISE }>;
      confirmes: { commandeId: string; numero: number; montant: number; detteRestante: number }[];
    };

interface CorpsConfirmation {
  remise?: RemiseCaisseDTO;
  erreur?: string;
  code?: string;
}

// Seule cette route (et elle seule) réduit la dette d'un client pour un
// règlement — la déclaration (POST /commandes/:id/reglements) ne le fait
// jamais. Une remise contradictoire est créée pour matérialiser l'argent
// physiquement reçu par la Caisse, qui confirme un ou plusieurs règlements
// DECLARE d'un même mouvement. P1-B : verrou de session + toutes les
// écritures (PaiementCommande, CommandeClient, Client) en `updateMany` +
// audit manuel transactionnel — plus de simple `update` singulier, qui
// serait intercepté par l'extension d'audit NON transactionnelle.
caisseRouter.post("/sessions/:id/confirmer-reglements", ecriture, async (req, res, next) => {
  try {
    const parsed = confirmerReglementsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { paiementCommandeIds, remisParNom, reference, observation } = parsed.data;
    const ids = [...new Set(paiementCommandeIds)];

    const execution = await executerAvecReessaiP2034(() =>
      executerEcritureIdempotente<ResultatConfirmation, CorpsConfirmation>(
        req,
        `POST:/api/caisse/sessions/${req.params.id}/confirmer-reglements`,
        parsed.data,
        async (tx) => {
          let session;
          try {
            session = await verrouillerSessionOuverteParId(tx, req.params.id);
          } catch (e) {
            if (e instanceof ErreurAction && e.status === 404) return { type: "sessionIntrouvable" as const };
            if (e instanceof ErreurAction && e.status === 409) return { type: "sessionFermee" as const };
            throw e;
          }
          await verifierAucuneSessionAnterieureOuverte(tx, jourLomoto(session.date));

          // Validation d'abord, sans écriture : une sélection invalide ne doit
          // jamais confirmer partiellement les autres règlements du lot.
          for (const id of ids) {
            const p = await tx.paiementCommande.findUnique({ where: { id } });
            if (!p || p.statut !== "DECLARE") return { type: "reglementInvalide" as const, id };
          }

          const declares = await tx.paiementCommande.findMany({ where: { id: { in: ids } }, select: { montant: true } });
          const montantTotal = declares.reduce((s, p) => s + p.montant, 0);

          const remise = await tx.remiseCaisse.create({
            data: {
              sessionCaisseId: session.id,
              montant: montantTotal,
              remisParNom,
              recuParId: req.utilisateur!.id,
              enregistreParId: req.utilisateur!.id,
              reference,
              observation,
            },
            include: INCLUDE_REMISE,
          });

          const confirmes: { commandeId: string; numero: number; montant: number; detteRestante: number }[] = [];
          for (const id of ids) {
            const paiementAvant = await tx.paiementCommande.findUniqueOrThrow({
              where: { id },
              include: { commandeClient: { include: { client: true } } },
            });
            const commande = paiementAvant.commandeClient;
            const calcul = calculerCommande({
              quantiteBacs: commande.quantiteBacs,
              prixParBac: commande.montantBrut / commande.quantiteBacs,
              avanceExistante: commande.avanceUtilisee,
              montantRecu: commande.montantRecu + paiementAvant.montant,
            });
            const deltaAvance = calcul.avanceGeneree - commande.avanceGeneree;

            await tx.commandeClient.updateMany({
              where: { id: commande.id },
              data: {
                montantRecu: commande.montantRecu + paiementAvant.montant,
                dette: calcul.dette,
                avanceGeneree: calcul.avanceGeneree,
                nouvelleAvance: commande.nouvelleAvance + deltaAvance,
              },
            });
            const commandeApres = await tx.commandeClient.findUniqueOrThrow({ where: { id: commande.id } });
            await auditerCaisseTx(tx, {
              module: "COMMANDES",
              typeEntite: "CommandeClient",
              entiteId: commande.id,
              action: "MODIFICATION",
              avant: commande,
              apres: commandeApres,
            });

            await tx.client.updateMany({
              where: { id: commande.clientId },
              data: { avanceDisponible: commande.client.avanceDisponible + deltaAvance },
            });
            const clientApres = await tx.client.findUniqueOrThrow({ where: { id: commande.clientId } });
            await auditerCaisseTx(tx, {
              module: "COMMANDES",
              typeEntite: "Client",
              entiteId: commande.clientId,
              action: "MODIFICATION",
              avant: commande.client,
              apres: clientApres,
            });

            await tx.paiementCommande.updateMany({
              where: { id },
              data: {
                statut: "CONFIRME",
                confirmeLe: new Date(),
                confirmeParId: req.utilisateur!.id,
                remiseCaisseId: remise.id,
              },
            });
            const paiementApres = await tx.paiementCommande.findUniqueOrThrow({ where: { id } });
            await auditerCaisseTx(tx, {
              module: "COMMANDES",
              typeEntite: "PaiementCommande",
              entiteId: id,
              action: "MODIFICATION",
              avant: paiementAvant,
              apres: paiementApres,
            });

            confirmes.push({ commandeId: commande.id, numero: commande.numero, montant: paiementAvant.montant, detteRestante: calcul.dette });
          }

          return { type: "confirme" as const, remise, confirmes };
        },
        (resultat) => {
          if (resultat.type === "sessionIntrouvable") {
            return { statutHttp: 404, corps: { erreur: "Session de caisse introuvable" } };
          }
          if (resultat.type === "sessionFermee") {
            return { statutHttp: 409, corps: { erreur: "Cette session est clôturée : impossible d'y confirmer un règlement" } };
          }
          if (resultat.type === "reglementInvalide") {
            return {
              statutHttp: 409,
              corps: { erreur: "Un règlement sélectionné est introuvable ou déjà confirmé", code: "REGLEMENT_INVALIDE" },
            };
          }
          return { statutHttp: 201, corps: { remise: versRemiseDTO(resultat.remise) } };
        },
      ),
    );

    ajouterEnteteRejeu(res, execution.rejoue);
    if (!execution.rejoue && execution.valeur?.type === "confirme") {
      const { remise, confirmes } = execution.valeur;
      const remiseDto = versRemiseDTO(remise);
      busEvenements.emettreEvenement({
        type: "REMISE_CAISSE_ENREGISTREE",
        module: "CAISSE",
        emetteurId: req.utilisateur!.id,
        evenementRef: remiseDto.id,
        message: `Remise de ${formatFc(remiseDto.montant)} par ${remiseDto.remisParNom} — ${confirmes.length} règlement(s) confirmé(s)`,
        donnees: { remiseId: remiseDto.id, montant: remiseDto.montant, nombreReglements: confirmes.length },
      });
      for (const c of confirmes) {
        busEvenements.emettreEvenement({
          type: "REGLEMENT_CONFIRME",
          module: "COMMANDES",
          emetteurId: req.utilisateur!.id,
          evenementRef: c.commandeId,
          message:
            `Règlement de ${formatFc(c.montant)} confirmé sur la commande n°${c.numero}` +
            (c.detteRestante > 0 ? ` — dette restante ${formatFc(c.detteRestante)}` : " — dette soldée"),
          donnees: { commandeId: c.commandeId, numero: c.numero, montant: c.montant },
        });
      }
    }

    res.status(execution.statutHttp).json(execution.corps);
  } catch (e) {
    traduireErreurEcriture(e, res, next);
  }
});
