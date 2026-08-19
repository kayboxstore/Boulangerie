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

export const caisseRouter = Router();

caisseRouter.use(requireAuth);

const lecture = requirePermission("CAISSE", "LECTURE");
const ecriture = requirePermission("CAISSE", "ECRITURE");

const versTauxDTO = (t: {
  id: string;
  date: Date;
  valeur: Prisma.Decimal;
  definiPar: { id: string; nom: string } | null;
}): TauxDuJourDTO => ({
  id: t.id,
  date: jourLomoto(t.date),
  valeur: t.valeur.toNumber(),
  definiPar: t.definiPar,
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

/**
 * Verrou OUVERTE -> FERMEE (Lot 6), même idiome que
 * chargerProductionOuverte (apps/api/src/routes/production.ts) : une fois
 * FERMEE, plus aucune modification n'est permise sur la session elle-même
 * (seule /corriger, réservée à l'Admin Principal, y déroge explicitement).
 */
async function chargerSessionCaisseOuverte(id: string) {
  const session = await prisma.sessionCaisse.findUnique({ where: { id }, include: INCLUDE_SESSION });
  if (!session) return { erreur: { status: 404 as const, message: "Session de caisse introuvable" } };
  if (session.statut === "FERMEE") {
    return { erreur: { status: 409 as const, message: "Cette session est clôturée : plus aucune modification possible" } };
  }
  return { session };
}

/**
 * Garde P0-02 : une fois la session d'une date FERMEE, plus aucune écriture
 * n'est permise sur le registre de cette date (taux, dépenses) — c'est ce qui
 * rend soldeTheoriqueFermeture stable pour une éventuelle correction (droit
 * spécial Admin Principal, /sessions/:id/corriger).
 */
async function sessionFermeePourDate(date: string): Promise<boolean> {
  const session = await prisma.sessionCaisse.findUnique({ where: { date: dateSQLDepuisJourLomoto(date) } });
  return session?.statut === "FERMEE";
}

/**
 * Discipline chronologique (correction bug terrain, section 3.1) : oublier de
 * clôturer la caisse un jour ne doit jamais permettre de continuer comme si
 * de rien n'était le jour suivant. Reprend le principe déjà appliqué à
 * l'ouverture d'une nouvelle session (« anterieureOuverte » plus bas) mais
 * l'étend à TOUTE écriture du module — taux, dépenses, remise, confirmation
 * de règlement — pas seulement à l'ouverture d'une session. Renvoie la date
 * de la session bloquante, ou null si la voie est libre.
 */
async function sessionAnterieureOuverteAvant(date: string): Promise<string | null> {
  const anterieure = await prisma.sessionCaisse.findFirst({
    where: { statut: "OUVERTE", date: { lt: dateSQLDepuisJourLomoto(date) } },
    orderBy: { date: "asc" },
  });
  return anterieure ? jourLomoto(anterieure.date) : null;
}

function erreurSessionAnterieure(date: string) {
  return { erreur: `Clôturez d'abord la session de caisse du ${date} avant de continuer` };
}

/** Sacs de farine consommés en production sur la date donnée (source du calcul). */
async function sacsUtilisesLe(date: string): Promise<number> {
  const [debut, fin] = bornesJourLomoto(date);
  const agg = await prisma.production.aggregate({
    where: { date: { gte: debut, lte: fin } },
    _sum: { sacsUtilises: true },
  });
  return agg._sum.sacsUtilises?.toNumber() ?? 0;
}

/**
 * Registre journalier (section 3.1). Les deux postes automatiques sont DISJOINTS
 * par construction, pour qu'aucun franc ne soit compté deux fois :
 *  - Entrées      = argent reçu à la CRÉATION des commandes du jour, soit
 *                   `montantRecu − somme de ses règlements CONFIRME` (le
 *                   montant reçu porté par une commande inclut ses
 *                   règlements ultérieurs, une fois confirmés) ;
 *  - Dettes payées = règlements CONFIRME datés du jour, y compris ceux
 *                   portant sur une commande créée le même jour. Un règlement
 *                   DECLARE (Lot 6, P0-07) n'a pas encore été compté par la
 *                   Caisse : il n'entre dans aucun des deux postes tant qu'il
 *                   n'est pas confirmé — sinon le théorique de clôture
 *                   compterait de l'argent jamais vérifié.
 */
async function construireRegistre(date: string): Promise<RegistreCaisseDTO> {
  const [debut, fin] = bornesJourLomoto(date);

  const commandesDuJour = await prisma.commandeClient.findMany({
    where: { dateCreation: { gte: debut, lte: fin } },
    select: { montantRecu: true, reglements: { where: { statut: "CONFIRME" }, select: { montant: true } } },
  });
  const entrees = commandesDuJour.reduce((somme, c) => {
    const verseALaCreation = c.montantRecu - c.reglements.reduce((s, r) => s + r.montant, 0);
    return somme + Math.max(0, verseALaCreation);
  }, 0);

  const reglementsDuJour = await prisma.paiementCommande.findMany({
    where: { date: { gte: debut, lte: fin }, statut: "CONFIRME" },
    include: {
      commandeClient: { select: { numero: true, client: { select: { nom: true } } } },
    },
    orderBy: { date: "asc" },
  });
  const dettesPayees = reglementsDuJour.reduce((s, r) => s + r.montant, 0);

  const depenses = await prisma.depenseCaisse.findMany({
    where: { date: dateSQLDepuisJourLomoto(date) },
    include: INCLUDE_DEPENSE,
    orderBy: { createdAt: "asc" },
  });
  const totalDepenses = depenses.reduce((s, d) => s + d.montant, 0);

  const taux = await prisma.tauxDuJour.findUnique({
    where: { date: dateSQLDepuisJourLomoto(date) },
    include: INCLUDE_TAUX,
  });
  const sacsUtilisesJour = await sacsUtilisesLe(date);

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
      date: r.date.toISOString(),
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
    res.json({ registre: await construireRegistre(cible) });
  } catch (e) {
    next(e);
  }
});

// Session antérieure restée OUVERTE (correction bug terrain) : interrogée
// indépendamment de la date consultée, pour avertir dès l'ouverture de
// l'écran plutôt qu'à la première écriture refusée.
caisseRouter.get("/session-bloquante", lecture, async (_req, res, next) => {
  try {
    res.json({ date: await sessionAnterieureOuverteAvant(jourLomoto()) });
  } catch (e) {
    next(e);
  }
});

// --- Taux du jour -----------------------------------------------------------

// Une valeur par date : un second envoi sur la même date met à jour la valeur
// (l'UPDATE est tracé par le journal d'audit).
caisseRouter.put("/taux", ecriture, async (req, res, next) => {
  try {
    const parsed = tauxDuJourSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { date, valeur } = parsed.data;
    if (await sessionFermeePourDate(date)) {
      return res.status(409).json({ erreur: "La session de caisse de cette date est clôturée : plus aucune écriture possible" });
    }
    const anterieure = await sessionAnterieureOuverteAvant(date);
    if (anterieure) return res.status(409).json(erreurSessionAnterieure(anterieure));

    const taux = await prisma.$transaction(async (tx) => {
      const existant = await tx.tauxDuJour.findUnique({ where: { date: dateSQLDepuisJourLomoto(date) } });
      if (existant) {
        return tx.tauxDuJour.update({
          where: { id: existant.id },
          data: { valeur, definiParId: req.utilisateur!.id },
          include: INCLUDE_TAUX,
        });
      }
      return tx.tauxDuJour.create({
        data: { date: dateSQLDepuisJourLomoto(date), valeur, definiParId: req.utilisateur!.id },
        include: INCLUDE_TAUX,
      });
    });

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
    next(e);
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
    if (await sessionFermeePourDate(date)) {
      return res.status(409).json({ erreur: "La session de caisse de cette date est clôturée : plus aucune écriture possible" });
    }
    const anterieure = await sessionAnterieureOuverteAvant(date);
    if (anterieure) return res.status(409).json(erreurSessionAnterieure(anterieure));

    const execution = await executerEcritureIdempotente(
      req,
      "POST:/api/caisse/depenses",
      parsed.data,
      async (tx) =>
        tx.depenseCaisse.create({
          data: {
            date: dateSQLDepuisJourLomoto(date),
            motif,
            montant,
            origine: "MANUELLE",
            enregistreParId: req.utilisateur!.id,
          },
          include: INCLUDE_DEPENSE,
        }),
      (depense) => ({ statutHttp: 201, corps: { depense: versDepenseDTO(depense) } }),
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
    if (e instanceof ErreurIdempotence) {
      return res.status(e.statutHttp).json({ erreur: e.message, code: e.code });
    }
    next(e);
  }
});

caisseRouter.delete("/depenses/:id", ecriture, async (req, res, next) => {
  try {
    const depense = await prisma.depenseCaisse.findUnique({ where: { id: req.params.id } });
    if (!depense) return res.status(404).json({ erreur: "Dépense introuvable" });
    if (await sessionFermeePourDate(jourLomoto(depense.date))) {
      return res.status(409).json({ erreur: "La session de caisse de cette date est clôturée : plus aucune écriture possible" });
    }
    const anterieure = await sessionAnterieureOuverteAvant(jourLomoto(depense.date));
    if (anterieure) return res.status(409).json(erreurSessionAnterieure(anterieure));

    await prisma.depenseCaisse.delete({ where: { id: depense.id } });
    busEvenements.emettreEvenement({
      type: "REGISTRE_CAISSE",
      module: "CAISSE",
      emetteurId: req.utilisateur!.id,
      evenementRef: depense.id,
      message: `Dépense retirée du registre du ${jourLomoto(depense.date)} : ${depense.motif} — ${formatFc(depense.montant)}`,
      donnees: { depenseId: depense.id },
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

/**
 * Case à cocher « dépense farine » (section 3.1). Cocher ajoute la ligne
 * automatique au motif figé, décocher la retire. Le montant est figé à
 * l'enregistrement, avec le taux et les sacs utilisés pour rester vérifiable.
 */
caisseRouter.put("/depenses/farine", ecriture, async (req, res, next) => {
  try {
    const parsed = depenseFarineSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { date, active } = parsed.data;
    if (await sessionFermeePourDate(date)) {
      return res.status(409).json({ erreur: "La session de caisse de cette date est clôturée : plus aucune écriture possible" });
    }
    const anterieure = await sessionAnterieureOuverteAvant(date);
    if (anterieure) return res.status(409).json(erreurSessionAnterieure(anterieure));

    const existante = await prisma.depenseCaisse.findFirst({
      where: { date: dateSQLDepuisJourLomoto(date), origine: "FARINE" },
    });

    if (!active) {
      if (existante) await prisma.depenseCaisse.delete({ where: { id: existante.id } });
      return res.json({ registre: await construireRegistre(date) });
    }

    if (existante) {
      return res.status(409).json({ erreur: "La dépense farine est déjà enregistrée pour cette date" });
    }

    const taux = await prisma.tauxDuJour.findUnique({ where: { date: dateSQLDepuisJourLomoto(date) } });
    if (!taux) {
      return res.status(409).json({ erreur: "Définissez d'abord le taux du jour pour cette date" });
    }
    const sacs = await sacsUtilisesLe(date);
    if (sacs <= 0) {
      return res.status(409).json({
        erreur: "Aucune production enregistrée pour cette date : le nombre de sacs utilisés est inconnu",
      });
    }

    const valeurTaux = taux.valeur.toNumber();
    const depense = await prisma.depenseCaisse.create({
      data: {
        date: dateSQLDepuisJourLomoto(date),
        motif: MOTIF_DEPENSE_FARINE,
        montant: calculerDepenseFarine(valeurTaux, sacs),
        origine: "FARINE",
        tauxApplique: valeurTaux,
        sacsUtilises: sacs,
        enregistreParId: req.utilisateur!.id,
      },
      include: INCLUDE_DEPENSE,
    });

    busEvenements.emettreEvenement({
      type: "REGISTRE_CAISSE",
      module: "CAISSE",
      emetteurId: req.utilisateur!.id,
      evenementRef: depense.id,
      message: `Dépense farine le ${date} : ${sacs} sac(s) au taux ${valeurTaux} — ${formatFc(depense.montant)}`,
      donnees: { depenseId: depense.id, montant: depense.montant, sacs, taux: valeurTaux },
    });

    res.status(201).json({ registre: await construireRegistre(date) });
  } catch (e) {
    next(e);
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
// date tant qu'une session antérieure reste OUVERTE — discipline
// chronologique qui corrige l'esprit de P0-02 (« pas d'inclusion implicite
// d'une autre session »).
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
// ni la dette (contrairement à /confirmer-reglements, ci-dessous).
caisseRouter.post("/sessions/:id/remises", ecriture, async (req, res, next) => {
  try {
    const { session, erreur } = await chargerSessionCaisseOuverte(req.params.id);
    if (erreur) return res.status(erreur.status).json({ erreur: erreur.message });
    const anterieure = await sessionAnterieureOuverteAvant(jourLomoto(session!.date));
    if (anterieure) return res.status(409).json(erreurSessionAnterieure(anterieure));

    const parsed = remiseCaisseCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { montant, remisParNom, reference, observation } = parsed.data;

    const execution = await executerEcritureIdempotente(
      req,
      `POST:/api/caisse/sessions/${req.params.id}/remises`,
      parsed.data,
      async (tx) =>
        tx.remiseCaisse.create({
          data: {
            sessionCaisseId: session!.id,
            montant,
            remisParNom,
            recuParId: req.utilisateur!.id,
            enregistreParId: req.utilisateur!.id,
            reference,
            observation,
          },
          include: INCLUDE_REMISE,
        }),
      (remise) => ({ statutHttp: 201, corps: { remise: versRemiseDTO(remise) } }),
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
    if (e instanceof ErreurIdempotence) {
      return res.status(e.statutHttp).json({ erreur: e.message, code: e.code });
    }
    next(e);
  }
});

// Clôture (points 4, 6, 8) : le théorique est calculé côté serveur, jamais
// fourni par le client. Un écart non nul exige un motif — sinon la clôture
// perdrait toute valeur de comptage contradictoire.
caisseRouter.post("/sessions/:id/cloturer", ecriture, async (req, res, next) => {
  try {
    const { session, erreur } = await chargerSessionCaisseOuverte(req.params.id);
    if (erreur) return res.status(erreur.status).json({ erreur: erreur.message });

    const parsed = sessionCaisseFermetureSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { soldeCompteFermeture, motif } = parsed.data;

    const dateStr = jourLomoto(session!.date);
    const registre = await construireRegistre(dateStr);
    const soldeTheoriqueFermeture = session!.soldeOuverture + registre.solde;
    const ecartFermeture = soldeCompteFermeture - soldeTheoriqueFermeture;
    if (ecartFermeture !== 0 && !motif) {
      return res.status(400).json({
        code: "ECART_NON_MOTIVE",
        erreur: `Écart de ${formatFc(ecartFermeture)} entre théorique et compté : un motif est requis pour clôturer`,
      });
    }

    const fermee = await prisma.sessionCaisse.update({
      where: { id: session!.id },
      data: {
        statut: "FERMEE",
        soldeTheoriqueFermeture,
        soldeCompteFermeture,
        ecartFermeture,
        motifEcart: ecartFermeture !== 0 ? motif : null,
        fermeeLe: new Date(),
        fermeeParId: req.utilisateur!.id,
      },
      include: INCLUDE_SESSION,
    });

    const dto = versSessionDTO(fermee);
    busEvenements.emettreEvenement({
      type: "SESSION_CAISSE_CLOTUREE",
      module: "CAISSE",
      emetteurId: req.utilisateur!.id,
      evenementRef: dto.id,
      message:
        `Session de caisse du ${dto.date} clôturée — théorique ${formatFc(soldeTheoriqueFermeture)}, compté ${formatFc(soldeCompteFermeture)}` +
        (ecartFermeture !== 0 ? `, écart ${formatFc(ecartFermeture)}` : ""),
      donnees: { sessionId: dto.id, soldeTheoriqueFermeture, soldeCompteFermeture, ecartFermeture },
    });
    res.json({ session: dto });
  } catch (e) {
    next(e);
  }
});

// Correction post-clôture (point 9) — droit spécial réservé à l'Admin
// Principal, même garde que POST /approbations/:id/approuver. Le théorique
// reste inchangé (stable, puisque la session FERMEE bloque toute nouvelle
// écriture sur le registre de cette date) ; seul le compté peut être corrigé.
caisseRouter.post("/sessions/:id/corriger", ecriture, async (req, res, next) => {
  try {
    if (!req.utilisateur!.estAdminPrincipal) {
      return res.status(403).json({ erreur: "Seul l'Administrateur principal peut corriger une session déjà clôturée" });
    }
    const session = await prisma.sessionCaisse.findUnique({ where: { id: req.params.id }, include: INCLUDE_SESSION });
    if (!session) return res.status(404).json({ erreur: "Session de caisse introuvable" });
    if (session.statut !== "FERMEE") {
      return res.status(409).json({ erreur: "Seule une session déjà clôturée peut être corrigée" });
    }

    const parsed = sessionCaisseCorrectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { soldeCompteFermeture, motif } = parsed.data;
    const ecartFermeture = soldeCompteFermeture - session.soldeTheoriqueFermeture!;

    const corrigee = await prisma.sessionCaisse.update({
      where: { id: session.id },
      data: {
        soldeCompteFermeture,
        ecartFermeture,
        motifEcart: ecartFermeture !== 0 ? motif : null,
        derniereCorrectionLe: new Date(),
        derniereCorrectionParId: req.utilisateur!.id,
        motifCorrection: motif,
      },
      include: INCLUDE_SESSION,
    });

    const dto = versSessionDTO(corrigee);
    busEvenements.emettreEvenement({
      type: "SESSION_CAISSE_CORRIGEE",
      module: "CAISSE",
      emetteurId: req.utilisateur!.id,
      priorite: "HAUTE",
      evenementRef: dto.id,
      message: `Session de caisse du ${dto.date} corrigée par l'Admin Principal — nouveau compté ${formatFc(soldeCompteFermeture)} (${motif})`,
      donnees: { sessionId: dto.id, soldeCompteFermeture, ecartFermeture },
    });
    res.json({ session: dto });
  } catch (e) {
    next(e);
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
// DECLARE d'un même mouvement.
caisseRouter.post("/sessions/:id/confirmer-reglements", ecriture, async (req, res, next) => {
  try {
    const parsed = confirmerReglementsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { paiementCommandeIds, remisParNom, reference, observation } = parsed.data;
    const ids = [...new Set(paiementCommandeIds)];

    const sessionInfo = await prisma.sessionCaisse.findUnique({ where: { id: req.params.id }, select: { date: true } });
    if (sessionInfo) {
      const anterieure = await sessionAnterieureOuverteAvant(jourLomoto(sessionInfo.date));
      if (anterieure) return res.status(409).json(erreurSessionAnterieure(anterieure));
    }

    const execution = await executerEcritureIdempotente<ResultatConfirmation, CorpsConfirmation>(
      req,
      `POST:/api/caisse/sessions/${req.params.id}/confirmer-reglements`,
      parsed.data,
      async (tx) => {
        const session = await tx.sessionCaisse.findUnique({ where: { id: req.params.id } });
        if (!session) return { type: "sessionIntrouvable" as const };
        if (session.statut !== "OUVERTE") return { type: "sessionFermee" as const };

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
          const paiement = await tx.paiementCommande.findUniqueOrThrow({
            where: { id },
            include: { commandeClient: { include: { client: true } } },
          });
          const commande = paiement.commandeClient;
          const calcul = calculerCommande({
            quantiteBacs: commande.quantiteBacs,
            prixParBac: commande.montantBrut / commande.quantiteBacs,
            avanceExistante: commande.avanceUtilisee,
            montantRecu: commande.montantRecu + paiement.montant,
          });
          const deltaAvance = calcul.avanceGeneree - commande.avanceGeneree;

          await tx.commandeClient.update({
            where: { id: commande.id },
            data: {
              montantRecu: commande.montantRecu + paiement.montant,
              dette: calcul.dette,
              avanceGeneree: calcul.avanceGeneree,
              nouvelleAvance: commande.nouvelleAvance + deltaAvance,
            },
          });
          await tx.client.update({
            where: { id: commande.clientId },
            data: { avanceDisponible: commande.client.avanceDisponible + deltaAvance },
          });
          await tx.paiementCommande.update({
            where: { id },
            data: {
              statut: "CONFIRME",
              confirmeLe: new Date(),
              confirmeParId: req.utilisateur!.id,
              remiseCaisseId: remise.id,
            },
          });
          confirmes.push({ commandeId: commande.id, numero: commande.numero, montant: paiement.montant, detteRestante: calcul.dette });
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
    if (e instanceof ErreurIdempotence) {
      return res.status(e.statutHttp).json({ erreur: e.message, code: e.code });
    }
    next(e);
  }
});
