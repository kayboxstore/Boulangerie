import { Router } from "express";
import { Prisma } from "@prisma/client";
import { dateISOSchema } from "@lomoto/shared";
import type {
  RapportCaisseDTO,
  RapportCommandesDTO,
  RapportCommissionsDTO,
  RapportFournisseursDTO,
  RapportProductionDTO,
  RapportStockDTO,
  RapportTravailleursDTO,
  ResumeClotureDTO,
  StatutCommandeFournisseur,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { bornesJourLomoto, jourLomoto } from "../lib/temps.js";

export const rapportsRouter = Router();

rapportsRouter.use(requireAuth);

const debutJour = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};
const ilYAJours = (n: number) => {
  const d = debutJour();
  d.setDate(d.getDate() - n);
  return d;
};

async function dettesEnCours(): Promise<{ nombre: number; total: number }> {
  const agg = await prisma.commandeClient.aggregate({
    where: { dette: { gt: 0 } },
    _count: { _all: true },
    _sum: { dette: true },
  });
  return { nombre: agg._count._all, total: agg._sum.dette ?? 0 };
}

async function alertesStock() {
  const matieres = await prisma.matierePremiere.findMany({ orderBy: { nom: "asc" } });
  return matieres
    .filter((m) => m.quantiteStock.toNumber() < m.seuilAlerte.toNumber())
    .map((m) => ({
      id: m.id,
      nom: m.nom,
      unite: m.unite,
      quantiteStock: m.quantiteStock.toNumber(),
      seuilAlerte: m.seuilAlerte.toNumber(),
    }));
}

// --- Widget Caisse (registre journalier, section 3.1) ------------------------
// Depuis la refonte, ce widget reflète le REGISTRE (entrées / dettes payées /
// dépenses / solde) et non plus une somme de ventes, qui n'existent plus.

/**
 * Encaissements et dépenses agrégés sur une période, avec la même règle de
 * non-double-comptage que le registre : les entrées ne retiennent que l'argent
 * versé à la création des commandes, les règlements étant comptés à part.
 */
async function registreSur(depuis: Date, jusqua?: Date) {
  const dateCreation: Prisma.DateTimeFilter = { gte: depuis };
  if (jusqua) dateCreation.lte = jusqua;
  const dateFiltre: Prisma.DateTimeFilter = { gte: depuis };
  if (jusqua) dateFiltre.lte = jusqua;

  const commandes = await prisma.commandeClient.findMany({
    where: { dateCreation },
    select: { montantRecu: true, reglements: { select: { montant: true } } },
  });
  const entrees = commandes.reduce((somme, c) => {
    const aLaCreation = c.montantRecu - c.reglements.reduce((s, r) => s + r.montant, 0);
    return somme + Math.max(0, aLaCreation);
  }, 0);

  const aggReglements = await prisma.paiementCommande.aggregate({
    where: { date: dateFiltre },
    _sum: { montant: true },
  });
  const aggDepenses = await prisma.depenseCaisse.aggregate({
    where: { date: dateFiltre },
    _sum: { montant: true },
  });

  const dettesPayees = aggReglements._sum.montant ?? 0;
  const depenses = aggDepenses._sum.montant ?? 0;
  return { entrees, dettesPayees, depenses, solde: entrees + dettesPayees - depenses };
}

rapportsRouter.get("/caisse", requirePermission("CAISSE", "LECTURE"), async (_req, res, next) => {
  try {
    const duJour = await registreSur(debutJour());
    const semaine = await registreSur(ilYAJours(6));
    const mois = await registreSur(ilYAJours(29));

    // Solde par jour sur 30 jours : encaissements (créations + règlements) moins
    // dépenses. Les jours sans mouvement n'apparaissent pas — le front comble
    // les trous à zéro pour la courbe.
    const lignesSerie = await prisma.$queryRaw<{ jour: Date; total: bigint }[]>`
      SELECT jour, SUM(total)::bigint AS total FROM (
        SELECT date_trunc('day', c."dateCreation") AS jour,
               c."montantRecu" - COALESCE((SELECT SUM(p."montant") FROM "PaiementCommande" p
                                           WHERE p."commandeClientId" = c."id"), 0) AS total
        FROM "CommandeClient" c WHERE c."dateCreation" >= ${ilYAJours(29)}
        UNION ALL
        SELECT date_trunc('day', p."date"), p."montant"
        FROM "PaiementCommande" p WHERE p."date" >= ${ilYAJours(29)}
        UNION ALL
        SELECT date_trunc('day', d."date"), -d."montant"
        FROM "DepenseCaisse" d WHERE d."date" >= ${ilYAJours(29)}
      ) mouvements GROUP BY jour ORDER BY jour`;
    const serie30Jours = lignesSerie.map((l) => ({
      date: l.jour.toISOString().slice(0, 10),
      total: Number(l.total),
    }));

    const parMotif = await prisma.depenseCaisse.groupBy({
      by: ["motif"],
      where: { date: { gte: ilYAJours(29) } },
      _sum: { montant: true },
    });
    const principalesDepenses = parMotif
      .map((d) => ({ motif: d.motif, total: d._sum.montant ?? 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    const dto: RapportCaisseDTO = {
      entreesJour: duJour.entrees,
      dettesPayeesJour: duJour.dettesPayees,
      depensesJour: duJour.depenses,
      soldeJour: duJour.solde,
      solde7Jours: semaine.solde,
      solde30Jours: mois.solde,
      serie30Jours,
      principalesDepenses,
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});

// --- Widget Commandes clients -----------------------------------------------

rapportsRouter.get("/commandes", requirePermission("COMMANDES", "LECTURE"), async (_req, res, next) => {
  try {
    const agg = await prisma.commandeClient.aggregate({
      where: { dateCreation: { gte: ilYAJours(29) } },
      _count: { _all: true },
      _sum: { montantBrut: true, montantRecu: true },
    });
    const dto: RapportCommandesDTO = {
      nbCommandes30Jours: agg._count._all,
      montantBrut30Jours: agg._sum.montantBrut ?? 0,
      montantRecu30Jours: agg._sum.montantRecu ?? 0,
      dettesEnCours: await dettesEnCours(),
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});

// --- Widget Commissions -----------------------------------------------------

// Commission figée au taux en vigueur à l'enregistrement (Lot 7 pt 6) : lire
// CommandeClient.commission, jamais recalculer avec le taux courant du
// TypeClient — voir le même commentaire dans commissions.ts.
rapportsRouter.get("/commissions", requirePermission("COMMISSIONS", "LECTURE"), async (_req, res, next) => {
  try {
    const commandes = await prisma.commandeClient.findMany({
      where: {
        dateCreation: { gte: ilYAJours(29) },
        commission: { gt: 0 },
      },
      select: { commission: true },
    });
    const dto: RapportCommissionsDTO = {
      totalCommissions30Jours: commandes.reduce((s, c) => s + c.commission, 0),
      nbCommandesACommission30Jours: commandes.length,
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});

// --- Widget Stock -----------------------------------------------------------

rapportsRouter.get("/stock", requirePermission("STOCKS", "LECTURE"), async (_req, res, next) => {
  try {
    const dto: RapportStockDTO = {
      alertes: await alertesStock(),
      nbMatieres: await prisma.matierePremiere.count(),
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});

// --- Widget Production ------------------------------------------------------

rapportsRouter.get("/production", requirePermission("PRODUCTION", "LECTURE"), async (_req, res, next) => {
  try {
    const dernieres = await prisma.production.findMany({
      orderBy: { numero: "desc" },
      take: 8,
    });
    const dto: RapportProductionDTO = {
      nbProductions30Jours: await prisma.production.count({ where: { date: { gte: ilYAJours(29) } } }),
      dernieres: dernieres.map((p) => ({
        numero: p.numero,
        bacsProduits: p.bacsProduits,
        date: p.date.toISOString(),
      })),
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});

// --- Widget Fournisseurs ----------------------------------------------------

rapportsRouter.get("/fournisseurs", requirePermission("FOURNISSEURS", "LECTURE"), async (_req, res, next) => {
  try {
    const recentes = await prisma.commandeFournisseur.findMany({
      include: {
        fournisseur: { select: { nom: true } },
        lignes: true,
      },
      orderBy: { numero: "desc" },
      take: 8,
    });
    const total = (c: { lignes: { quantite: Prisma.Decimal; prixUnitaire: number }[] }) =>
      c.lignes.reduce((s, l) => s + Math.round(l.quantite.toNumber() * l.prixUnitaire), 0);

    const recues30j = await prisma.commandeFournisseur.findMany({
      where: { statut: "RECUE", dateReception: { gte: ilYAJours(29) } },
      include: { lignes: true },
    });

    const dto: RapportFournisseursDTO = {
      totalRecu30Jours: recues30j.reduce((s, c) => s + total(c), 0),
      enAttente: await prisma.commandeFournisseur.count({ where: { statut: "EN_ATTENTE" } }),
      achatsRecents: recentes.map((c) => ({
        numero: c.numero,
        fournisseurNom: c.fournisseur.nom,
        statut: c.statut as StatutCommandeFournisseur,
        total: total(c),
        date: c.date.toISOString(),
      })),
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});

// --- Widget Travailleurs / présence du jour ---------------------------------
// Depuis la refonte 3.18 (Pointage horodaté + Absence séparée) : « présent »
// = un Pointage actif aujourd'hui, entré aujourd'hui OU entré avant et encore
// ouvert (équipe de nuit à cheval sur deux jours). « Absent » = une Absence
// déclarée pour la date du jour, quel que soit le statut de décision.

rapportsRouter.get("/travailleurs", requirePermission("TRAVAILLEURS", "LECTURE"), async (_req, res, next) => {
  try {
    const debut = debutJour();
    const fin = new Date(debut);
    fin.setDate(fin.getDate() + 1);

    const attendus = await prisma.travailleur.count();
    // Masse salariale (3.8, nouveau) : somme brute des salaireMensuel — les
    // fiches sans salaire renseigné (créées avant cette fonctionnalité, ou
    // valeur explicitement retirée) comptent pour 0, pas d'erreur.
    const salaires = await prisma.travailleur.aggregate({ _sum: { salaireMensuel: true } });
    const pointagesActifs = await prisma.pointage.findMany({
      where: {
        OR: [
          { horodatageEntree: { gte: debut, lt: fin } },
          { AND: [{ horodatageEntree: { lt: debut } }, { OR: [{ horodatageSortie: null }, { horodatageSortie: { gte: debut } }] }] },
        ],
      },
      select: { travailleurId: true },
      distinct: ["travailleurId"],
    });
    const absencesDuJour = await prisma.absence.findMany({
      where: { date: debut },
      select: { travailleurId: true },
      distinct: ["travailleurId"],
    });

    const presents = pointagesActifs.length;
    const absents = absencesDuJour.length;
    const dto: RapportTravailleursDTO = {
      attendus,
      presents,
      absents,
      nonPointes: Math.max(0, attendus - presents - absents),
      masseSalariale: salaires._sum.salaireMensuel ?? 0,
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});

// --- Résumé de clôture quotidien (3.8) --------------------------------------
// Réservé au DG via la matrice : seul son rôle a la lecture sur RAPPORTS
// (les Admins n'ont aucune permission métier — leur équivalent est l'État
// système, 3.15).
//
// ?date= optionnel (AAAA-MM-JJ, jour civil Africa/Kinshasa), sinon aujourd'hui
// (Lot 7 pt 1) : permet au DG de consulter le résumé d'un jour déjà passé, pas
// seulement celui du jour courant — même convention que /livraisons-du-jour.

rapportsRouter.get("/cloture-quotidienne", requirePermission("RAPPORTS", "LECTURE"), async (req, res, next) => {
  try {
    const { date } = req.query as Record<string, string | undefined>;
    if (date && !dateISOSchema.safeParse(date).success) {
      return res.status(400).json({ erreur: "Date invalide (AAAA-MM-JJ)" });
    }
    const dateStr = date ?? jourLomoto();
    const [debut, fin] = bornesJourLomoto(dateStr);

    // Le résumé reflète désormais le registre de caisse (3.1), plus le CA issu
    // des ventes, qui n'existent plus.
    const registre = await registreSur(debut, fin);
    const nbCommandesJour = await prisma.commandeClient.count({
      where: { dateCreation: { gte: debut, lte: fin } },
    });
    const dto: ResumeClotureDTO = {
      date: dateStr,
      entreesJour: registre.entrees,
      dettesPayeesJour: registre.dettesPayees,
      depensesJour: registre.depenses,
      soldeJour: registre.solde,
      nbCommandesJour,
      dettesEnCours: await dettesEnCours(),
      alertesStock: (await alertesStock()).map(({ id: _id, ...reste }) => reste),
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});
