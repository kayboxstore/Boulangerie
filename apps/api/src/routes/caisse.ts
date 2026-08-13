import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  calculerDepenseFarine,
  dateISOSchema,
  depenseCreateSchema,
  depenseFarineSchema,
  formatFc,
  MOTIF_DEPENSE_FARINE,
  tauxDuJourSchema,
  type BlocageFarine,
  type DepenseCaisseDTO,
  type OrigineDepense,
  type RegistreCaisseDTO,
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
 *                   `montantRecu − somme de ses règlements` (le montant reçu
 *                   porté par une commande inclut ses règlements ultérieurs) ;
 *  - Dettes payées = TOUS les règlements datés du jour, y compris ceux portant
 *                   sur une commande créée le même jour.
 */
async function construireRegistre(date: string): Promise<RegistreCaisseDTO> {
  const [debut, fin] = bornesJourLomoto(date);

  const commandesDuJour = await prisma.commandeClient.findMany({
    where: { dateCreation: { gte: debut, lte: fin } },
    select: { montantRecu: true, reglements: { select: { montant: true } } },
  });
  const entrees = commandesDuJour.reduce((somme, c) => {
    const verseALaCreation = c.montantRecu - c.reglements.reduce((s, r) => s + r.montant, 0);
    return somme + Math.max(0, verseALaCreation);
  }, 0);

  const reglementsDuJour = await prisma.paiementCommande.findMany({
    where: { date: { gte: debut, lte: fin } },
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
