import { Router } from "express";
import { Prisma } from "@prisma/client";
import { dateISOSchema } from "@lomoto/shared";
import type {
  GranulariteTendance,
  MargeParProduitDTO,
  ProjectionDashboardDTO,
  RapportCaisseDTO,
  RapportCommandesDTO,
  RapportCommissionsDTO,
  RapportFournisseursDTO,
  RapportProductionDTO,
  RapportStockDTO,
  RapportTravailleursDTO,
  ResumeClotureDTO,
  StatutCommandeFournisseur,
  TendancesDashboardDTO,
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
// Lecture sur RAPPORTS (matrice section 2) : le DG (lecture partout sauf
// Paramètres) et les deux niveaux d'Administrateur (lecture sur tout module
// hors Paramètres/Équipe/Travailleurs, où ils ont l'écriture) y ont accès.
//
// ?date= optionnel (AAAA-MM-JJ, jour civil Africa/Kinshasa), sinon aujourd'hui
// (Lot 7 pt 1) : permet de consulter le résumé d'un jour déjà passé, pas
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

// --- Widget « Marge par produit » (3.8, resté en suspens depuis l'audit) ----
// PAS une vraie marge (voir MargeParProduitDTO) : volume livré (BonLivraisonLigne,
// la seule source avec le triplet date réelle × produit × quantité — CommandeClient
// ne track qu'un total de bacs, jamais un détail par produit) × Produit.prixVente
// COURANT pour un CA estimé. La limitation est portée par le frontend (aucun
// texte pré-rendu ici, comme tous les autres DTO de ce fichier).

rapportsRouter.get("/marge-produit", requirePermission("RAPPORTS", "LECTURE"), async (req, res, next) => {
  try {
    const joursParam = Number.parseInt(String(req.query.jours ?? "30"), 10);
    const jours: 7 | 30 = joursParam === 7 ? 7 : 30;
    const depuis = ilYAJours(jours - 1);

    const lignes = await prisma.bonLivraisonLigne.groupBy({
      by: ["produitId"],
      where: { bonLivraison: { date: { gte: depuis } } },
      _sum: { quantite: true },
    });
    const produits = await prisma.produit.findMany({ where: { id: { in: lignes.map((l) => l.produitId) } } });
    const parId = new Map(produits.map((p) => [p.id, p]));

    const dto: MargeParProduitDTO = {
      jours,
      produits: lignes
        .map((l) => {
          const p = parId.get(l.produitId);
          const quantiteLivree = l._sum.quantite ?? 0;
          return p ? { produitId: p.id, nom: p.nom, quantiteLivree, caEstime: quantiteLivree * p.prixVente } : null;
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .sort((a, b) => b.caEstime - a.caEstime),
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});

// --- Tableau de bord analytique v2 : tendances historiques ------------------
// CA/bacs : groupés sur CommandeClient.dateCreation, même champ que les
// widgets Caisse/Commandes ci-dessus (jamais dateOperationnelle, nulle pour
// l'historique pré-C4). Volume par produit : groupé sur BonLivraison.date
// (date de livraison réelle), même source que /marge-produit.
//
// La granularité choisit LEQUEL des 3 littéraux SQL fixes ('day'/'week'/
// 'month') est inséré dans date_trunc via Prisma.raw — jamais la valeur brute
// de req.query, qui est d'abord validée contre une liste blanche de 3 valeurs
// exactes (sinon repli silencieux sur "jour", un mauvais paramètre d'URL ne
// doit pas casser tout le widget).

const TRONCATURE_SQL: Record<GranulariteTendance, string> = { jour: "day", semaine: "week", mois: "month" };

function granulariteDepuisRequete(valeur: unknown): GranulariteTendance {
  return valeur === "semaine" || valeur === "mois" ? valeur : "jour";
}

function debutFenetreTendance(granularite: GranulariteTendance): Date {
  const d = debutJour();
  if (granularite === "jour") d.setDate(d.getDate() - 29); // 30 derniers jours
  else if (granularite === "semaine") d.setDate(d.getDate() - 7 * 11); // 12 dernières semaines
  else d.setMonth(d.getMonth() - 11); // 12 derniers mois
  return d;
}

rapportsRouter.get("/tendances", requirePermission("RAPPORTS", "LECTURE"), async (req, res, next) => {
  try {
    const granularite = granulariteDepuisRequete(req.query.granularite);
    const trunc = TRONCATURE_SQL[granularite];
    const depuis = debutFenetreTendance(granularite);

    const lignesCommandes = await prisma.$queryRaw<{ periode: Date; ca: bigint; bacs: bigint }[]>`
      SELECT date_trunc(${Prisma.raw(`'${trunc}'`)}, "dateCreation") AS periode,
             SUM("montantBrut")::bigint AS ca,
             SUM("quantiteBacs")::bigint AS bacs
      FROM "CommandeClient"
      WHERE "dateCreation" >= ${depuis}
      GROUP BY periode ORDER BY periode`;

    const lignesVolume = await prisma.$queryRaw<{ periode: Date; produitId: string; quantite: bigint }[]>`
      SELECT date_trunc(${Prisma.raw(`'${trunc}'`)}, b."date") AS periode,
             l."produitId" AS "produitId",
             SUM(l."quantite")::bigint AS quantite
      FROM "BonLivraisonLigne" l
      JOIN "BonLivraison" b ON b.id = l."bonLivraisonId"
      WHERE b."date" >= ${depuis}
      GROUP BY periode, l."produitId" ORDER BY periode`;

    const parPeriode = new Map<string, { produitId: string; quantite: number }[]>();
    for (const l of lignesVolume) {
      const cle = l.periode.toISOString().slice(0, 10);
      const liste = parPeriode.get(cle) ?? [];
      liste.push({ produitId: l.produitId, quantite: Number(l.quantite) });
      parPeriode.set(cle, liste);
    }

    const produitsCatalogue = await prisma.produit.findMany({
      where: { actif: true },
      select: { id: true, nom: true },
      orderBy: { nom: "asc" },
    });

    const dto: TendancesDashboardDTO = {
      granularite,
      produitsCatalogue,
      ca: lignesCommandes.map((l) => ({ periode: l.periode.toISOString().slice(0, 10), total: Number(l.ca) })),
      bacs: lignesCommandes.map((l) => ({ periode: l.periode.toISOString().slice(0, 10), total: Number(l.bacs) })),
      volumeParProduit: [...parPeriode.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([periode, produits]) => ({ periode, produits })),
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});

// --- Tableau de bord analytique v2 : projection simple ----------------------
// Simple heuristique statistique (moyenne mobile + comparaison au même jour la
// semaine précédente) — JAMAIS un modèle prédictif. Le frontend doit le dire
// explicitement (aucun texte pré-rendu ici, comme le reste de ce fichier).

function bornesJourAvant(joursAvant: number): [Date, Date] {
  const debut = debutJour();
  debut.setDate(debut.getDate() - joursAvant);
  const fin = new Date(debut);
  fin.setDate(fin.getDate() + 1);
  return [debut, fin];
}

async function totalJourAvant(joursAvant: number): Promise<{ date: string; ca: number; bacs: number }> {
  const [debut, fin] = bornesJourAvant(joursAvant);
  const agg = await prisma.commandeClient.aggregate({
    where: { dateCreation: { gte: debut, lt: fin } },
    _sum: { montantBrut: true, quantiteBacs: true },
  });
  return { date: debut.toISOString().slice(0, 10), ca: agg._sum.montantBrut ?? 0, bacs: agg._sum.quantiteBacs ?? 0 };
}

function variationPourcent(actuel: number, precedent: number): number | null {
  if (precedent === 0) return null;
  return Math.round(((actuel - precedent) / precedent) * 1000) / 10;
}

rapportsRouter.get("/projection", requirePermission("RAPPORTS", "LECTURE"), async (_req, res, next) => {
  try {
    // Moyenne mobile : total des 7 derniers jours complets (hier inclus,
    // aujourd'hui exclu — encore en cours) divisé par 7.
    const agg7Jours = await prisma.commandeClient.aggregate({
      where: { dateCreation: { gte: ilYAJours(7), lt: debutJour() } },
      _sum: { montantBrut: true, quantiteBacs: true },
    });

    // Comparaison : le dernier jour ENTIÈREMENT écoulé (hier, joursAvant=1),
    // jamais aujourd'hui (encore en cours, comparaison biaisée), contre le
    // même jour de la semaine précédente (joursAvant=8).
    const hier = await totalJourAvant(1);
    const ilYA8Jours = await totalJourAvant(8);

    const dto: ProjectionDashboardDTO = {
      moyenneMobile7JoursCa: Math.round((agg7Jours._sum.montantBrut ?? 0) / 7),
      moyenneMobile7JoursBacs: Math.round((agg7Jours._sum.quantiteBacs ?? 0) / 7),
      comparaisonCa: {
        jourReference: hier.date,
        valeurReference: hier.ca,
        jourComparaison: ilYA8Jours.date,
        valeurComparaison: ilYA8Jours.ca,
        variationPourcent: variationPourcent(hier.ca, ilYA8Jours.ca),
      },
      comparaisonBacs: {
        jourReference: hier.date,
        valeurReference: hier.bacs,
        jourComparaison: ilYA8Jours.date,
        valeurComparaison: ilYA8Jours.bacs,
        variationPourcent: variationPourcent(hier.bacs, ilYA8Jours.bacs),
      },
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});
