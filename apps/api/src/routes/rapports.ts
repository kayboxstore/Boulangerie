import { Router } from "express";
import { Prisma } from "@prisma/client";
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

// --- Widget CA / Caisse -----------------------------------------------------

rapportsRouter.get("/caisse", requirePermission("CAISSE", "LECTURE"), async (_req, res, next) => {
  try {
    const caDepuis = async (depuis: Date) => {
      const agg = await prisma.vente.aggregate({ where: { date: { gte: depuis } }, _sum: { total: true }, _count: { _all: true } });
      return { total: agg._sum.total ?? 0, nombre: agg._count._all };
    };
    const jour = await caDepuis(debutJour());
    const semaine = await caDepuis(ilYAJours(6));
    const mois = await caDepuis(ilYAJours(29));

    // CA par jour sur 30 jours (les jours sans vente n'apparaissent pas — le
    // front comble les trous à zéro pour la courbe).
    const lignesSerie = await prisma.$queryRaw<{ jour: Date; total: bigint }[]>`
      SELECT date_trunc('day', "date") AS jour, SUM("total")::bigint AS total
      FROM "Vente" WHERE "date" >= ${ilYAJours(29)}
      GROUP BY 1 ORDER BY 1`;
    const serie30Jours = lignesSerie.map((l) => ({
      date: l.jour.toISOString().slice(0, 10),
      total: Number(l.total),
    }));

    const parProduit = await prisma.ligneVente.groupBy({
      by: ["produitId"],
      where: { vente: { date: { gte: ilYAJours(29) } } },
      _sum: { quantite: true },
    });
    const produits = await prisma.produit.findMany({
      where: { id: { in: parProduit.map((p) => p.produitId) } },
      select: { id: true, nom: true },
    });
    const nomParId = new Map(produits.map((p) => [p.id, p.nom]));
    // CA par produit = somme des prix figés sur les lignes (pas le prix actuel).
    const caParProduit = await prisma.$queryRaw<{ produitId: string; ca: bigint }[]>`
      SELECT lv."produitId", SUM(lv."quantite" * lv."prixUnitaire")::bigint AS ca
      FROM "LigneVente" lv JOIN "Vente" v ON v."id" = lv."venteId"
      WHERE v."date" >= ${ilYAJours(29)}
      GROUP BY lv."produitId"`;
    const caParId = new Map(caParProduit.map((l) => [l.produitId, Number(l.ca)]));

    const meilleuresVentes = parProduit
      .map((p) => ({
        produitNom: nomParId.get(p.produitId) ?? "?",
        quantite: p._sum.quantite ?? 0,
        ca: caParId.get(p.produitId) ?? 0,
      }))
      .sort((a, b) => b.quantite - a.quantite)
      .slice(0, 8);

    const dto: RapportCaisseDTO = {
      caJour: jour.total,
      ca7Jours: semaine.total,
      ca30Jours: mois.total,
      nbVentesJour: jour.nombre,
      serie30Jours,
      meilleuresVentes,
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

rapportsRouter.get("/commissions", requirePermission("COMMISSIONS", "LECTURE"), async (_req, res, next) => {
  try {
    const commandes = await prisma.commandeClient.findMany({
      where: {
        dateCreation: { gte: ilYAJours(29) },
        client: { typeClient: { commissionParBac: { gt: 0 } } },
      },
      include: { client: { select: { typeClient: { select: { commissionParBac: true } } } } },
    });
    const dto: RapportCommissionsDTO = {
      totalCommissions30Jours: commandes.reduce(
        (s, c) => s + c.quantiteBacs * c.client.typeClient.commissionParBac,
        0,
      ),
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
      include: { recette: { include: { produit: { select: { nom: true } } } } },
      orderBy: { numero: "desc" },
      take: 8,
    });
    const dto: RapportProductionDTO = {
      nbProductions30Jours: await prisma.production.count({ where: { date: { gte: ilYAJours(29) } } }),
      dernieres: dernieres.map((p) => ({
        numero: p.numero,
        produitNom: p.recette.produit.nom,
        quantiteProduite: p.quantiteProduite,
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

rapportsRouter.get("/travailleurs", requirePermission("TRAVAILLEURS", "LECTURE"), async (_req, res, next) => {
  try {
    const attendus = await prisma.travailleur.count();
    const duJour = await prisma.presence.groupBy({
      by: ["statut"],
      where: { date: debutJour() },
      _count: { _all: true },
    });
    const nb = (statut: string) => duJour.find((p) => p.statut === statut)?._count._all ?? 0;
    const presents = nb("PRESENT");
    const retards = nb("RETARD");
    const absents = nb("ABSENT");
    const dto: RapportTravailleursDTO = {
      attendus,
      presents,
      retards,
      absents,
      nonPointes: Math.max(0, attendus - presents - retards - absents),
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

rapportsRouter.get("/cloture-quotidienne", requirePermission("RAPPORTS", "LECTURE"), async (_req, res, next) => {
  try {
    const aggVentes = await prisma.vente.aggregate({
      where: { date: { gte: debutJour() } },
      _sum: { total: true },
      _count: { _all: true },
    });
    const nbCommandesJour = await prisma.commandeClient.count({
      where: { dateCreation: { gte: debutJour() } },
    });
    const dto: ResumeClotureDTO = {
      date: new Date().toISOString().slice(0, 10),
      caJour: aggVentes._sum.total ?? 0,
      nbVentesJour: aggVentes._count._all,
      nbCommandesJour,
      dettesEnCours: await dettesEnCours(),
      alertesStock: (await alertesStock()).map(({ id: _id, ...reste }) => reste),
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});
