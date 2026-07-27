import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  formatQuantite,
  planningCreateSchema,
  productionCreateSchema,
  totalDestinationsBacs,
  type CodeIngredient,
  type EcartsProductionDTO,
  type LigneEcartDTO,
  type MotifDonDTO,
  type PlanningProductionDTO,
  type ProductionDTO,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";
import { appliquerMouvement, emettreAlerteSeuil, ErreurStock } from "../services/stocks.js";

export const productionRouter = Router();

productionRouter.use(requireAuth);

const lecture = requirePermission("PRODUCTION", "LECTURE");
const ecriture = requirePermission("PRODUCTION", "ECRITURE");

const dec = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
const jour = (d: Date) => d.toISOString().slice(0, 10);

// --- Planning de production (section 3.3 a) ---------------------------------

type PlanningAvecRelations = Prisma.PlanningProductionGetPayload<{
  include: {
    lignes: { include: { produit: { select: { id: true; nom: true } } } };
    creePar: { select: { id: true; nom: true } };
  };
}>;

const INCLUDE_PLANNING = {
  lignes: { include: { produit: { select: { id: true, nom: true } } } },
  creePar: { select: { id: true, nom: true } },
} as const;

const versPlanningDTO = (p: PlanningAvecRelations): PlanningProductionDTO => ({
  id: p.id,
  datePrevue: jour(p.datePrevue),
  nombreBacsCommandes: p.nombreBacsCommandes,
  lignes: p.lignes.map((l) => ({
    produitId: l.produitId,
    produitNom: l.produit.nom,
    quantitePrevue: l.quantitePrevue,
  })),
  sacsFarinePrevus: p.sacsFarinePrevus.toNumber(),
  paquetsLevurePrevus: p.paquetsLevurePrevus.toNumber(),
  quantiteHuilePrevue: p.quantiteHuilePrevue.toNumber(),
  kgSelPrevus: p.kgSelPrevus.toNumber(),
  observations: p.observations,
  creePar: p.creePar,
});

productionRouter.get("/planning", lecture, async (req, res, next) => {
  try {
    const { du, au } = req.query as Record<string, string | undefined>;
    const datePrevue: Prisma.DateTimeFilter = {};
    if (du) datePrevue.gte = new Date(du);
    if (au) datePrevue.lte = new Date(au);

    const plannings = await prisma.planningProduction.findMany({
      where: du || au ? { datePrevue } : {},
      include: INCLUDE_PLANNING,
      orderBy: { datePrevue: "desc" },
      take: 60,
    });
    res.json({ plannings: plannings.map(versPlanningDTO) });
  } catch (e) {
    next(e);
  }
});

// Une seule planification par date (contrainte d'unicité) : un envoi sur une
// date déjà planifiée met à jour la planification existante plutôt que d'échouer.
productionRouter.post("/planning", ecriture, async (req, res, next) => {
  try {
    const parsed = planningCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { datePrevue, lignes, observations, ...previsions } = parsed.data;

    const produitIds = lignes.map((l) => l.produitId);
    if (new Set(produitIds).size !== produitIds.length) {
      return res.status(400).json({ erreur: "Un produit apparaît deux fois dans le détail" });
    }
    if (produitIds.length > 0) {
      const connus = await prisma.produit.count({ where: { id: { in: produitIds } } });
      if (connus !== produitIds.length) {
        return res.status(400).json({ erreur: "Produit inconnu dans le détail du planning" });
      }
    }

    const date = new Date(datePrevue);
    const donnees = { ...previsions, nombreBacsCommandes: parsed.data.nombreBacsCommandes, observations: observations ?? null };

    const planning = await prisma.$transaction(async (tx) => {
      const existant = await tx.planningProduction.findUnique({ where: { datePrevue: date } });
      if (existant) {
        await tx.planningLigneProduit.deleteMany({ where: { planningId: existant.id } });
        return tx.planningProduction.update({
          where: { id: existant.id },
          data: { ...donnees, lignes: { create: lignes } },
          include: INCLUDE_PLANNING,
        });
      }
      return tx.planningProduction.create({
        data: { ...donnees, datePrevue: date, creeParId: req.utilisateur!.id, lignes: { create: lignes } },
        include: INCLUDE_PLANNING,
      });
    });

    res.status(201).json({ planning: versPlanningDTO(planning) });
  } catch (e) {
    next(e);
  }
});

productionRouter.delete("/planning/:id", ecriture, async (req, res, next) => {
  try {
    const planning = await prisma.planningProduction.findUnique({ where: { id: req.params.id } });
    if (!planning) return res.status(404).json({ erreur: "Planification introuvable" });
    await prisma.planningProduction.delete({ where: { id: planning.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// --- Motifs de don (liste fixe extensible, section 3.3 b) -------------------

productionRouter.get("/motifs-don", lecture, async (_req, res, next) => {
  try {
    const motifs = await prisma.motifDon.findMany({ orderBy: { nom: "asc" } });
    res.json({ motifs: motifs.map((m): MotifDonDTO => ({ id: m.id, nom: m.nom })) });
  } catch (e) {
    next(e);
  }
});

// --- Productions enregistrées (section 3.3 b + c) ---------------------------

type ProductionAvecRelations = Prisma.ProductionGetPayload<{
  include: {
    dons: { include: { motifDon: { select: { id: true; nom: true } } } };
    enregistrePar: { select: { id: true; nom: true } };
    mouvements: { include: { matierePremiere: { select: { nom: true; unite: true } } } };
  };
}>;

const INCLUDE_PRODUCTION = {
  dons: { include: { motifDon: { select: { id: true, nom: true } } } },
  enregistrePar: { select: { id: true, nom: true } },
  mouvements: { include: { matierePremiere: { select: { nom: true, unite: true } } } },
} as const;

const versProductionDTO = (p: ProductionAvecRelations): ProductionDTO => {
  const dons = p.dons.map((d) => ({
    motifDonId: d.motifDonId,
    motifNom: d.motifDon.nom,
    nombreBacs: d.nombreBacs,
  }));
  const totalDestinations = totalDestinationsBacs({
    bacsLivresDepositaires: p.bacsLivresDepositaires,
    bacsLivresMamans: p.bacsLivresMamans,
    bacsVendusVC: p.bacsVendusVC,
    bacsRestants: p.bacsRestants,
    bacsFoutus: p.bacsFoutus,
    dons,
  });
  return {
    id: p.id,
    numero: p.numero,
    date: p.date.toISOString(),
    bacsProduits: p.bacsProduits,
    bacsLivresDepositaires: p.bacsLivresDepositaires,
    bacsLivresMamans: p.bacsLivresMamans,
    bacsVendusVC: p.bacsVendusVC,
    bacsRestants: p.bacsRestants,
    bacsFoutus: p.bacsFoutus,
    dons,
    totalDonnes: dons.reduce((s, d) => s + d.nombreBacs, 0),
    kgFarineAbimes: dec(p.kgFarineAbimes),
    sacsUtilises: p.sacsUtilises.toNumber(),
    paquetsLevureUtilises: p.paquetsLevureUtilises.toNumber(),
    kgSelUtilises: p.kgSelUtilises.toNumber(),
    quantiteHuileUtilisee: p.quantiteHuileUtilisee.toNumber(),
    observations: p.observations,
    enregistrePar: p.enregistrePar,
    consommations: p.mouvements.map((m) => ({
      matiereNom: m.matierePremiere.nom,
      unite: m.matierePremiere.unite,
      quantite: m.quantite.toNumber(),
    })),
    totalDestinations,
    ecartReconciliation: totalDestinations - p.bacsProduits,
  };
};

productionRouter.get("/productions", lecture, async (req, res, next) => {
  try {
    const { du, au } = req.query as Record<string, string | undefined>;
    const date: Prisma.DateTimeFilter = {};
    if (du) date.gte = new Date(`${du}T00:00:00.000Z`);
    if (au) date.lte = new Date(`${au}T23:59:59.999Z`);

    const productions = await prisma.production.findMany({
      where: du || au ? { date } : {},
      include: INCLUDE_PRODUCTION,
      orderBy: { numero: "desc" },
      take: 60,
    });
    res.json({ productions: productions.map(versProductionDTO) });
  } catch (e) {
    next(e);
  }
});

productionRouter.post("/productions", ecriture, async (req, res, next) => {
  try {
    const parsed = productionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const d = parsed.data;

    const motifIds = d.dons.map((x) => x.motifDonId);
    if (new Set(motifIds).size !== motifIds.length) {
      return res.status(400).json({ erreur: "Un motif de don apparaît deux fois" });
    }
    if (motifIds.length > 0) {
      const connus = await prisma.motifDon.count({ where: { id: { in: motifIds } } });
      if (connus !== motifIds.length) {
        return res.status(400).json({ erreur: "Motif de don inconnu" });
      }
    }

    // Ingrédients utilisés → matières premières à décrémenter. La correspondance
    // passe par le code de la matière (pas par son nom). Une matière non
    // configurée n'empêche pas l'enregistrement : elle est signalée en retour.
    const quantitesParCode: [CodeIngredient, number][] = [
      ["FARINE", d.sacsUtilises],
      ["LEVURE", d.paquetsLevureUtilises],
      ["SEL", d.kgSelUtilises],
      ["HUILE", d.quantiteHuileUtilisee],
    ];
    const aConsommer = quantitesParCode.filter(([, q]) => q > 0);
    const matieres = await prisma.matierePremiere.findMany({
      where: { code: { in: aConsommer.map(([c]) => c) } },
    });
    const parCode = new Map(matieres.map((m) => [m.code as CodeIngredient, m]));
    const avertissements = aConsommer
      .filter(([code]) => !parCode.has(code))
      .map(
        ([code]) =>
          `Aucune matière première n'est reliée au code ${code} : le stock correspondant n'a pas été décrémenté.`,
      );

    // Production + mouvements SORTIE dans UNE transaction : la décrémentation
    // reste automatique et atomique (un stock insuffisant annule l'ensemble),
    // exactement comme l'ancien mécanisme fondé sur la recette.
    const resultat = await prisma.$transaction(
      async (tx) => {
        const production = await tx.production.create({
          data: {
            bacsProduits: d.bacsProduits,
            bacsLivresDepositaires: d.bacsLivresDepositaires,
            bacsLivresMamans: d.bacsLivresMamans,
            bacsVendusVC: d.bacsVendusVC,
            bacsRestants: d.bacsRestants,
            bacsFoutus: d.bacsFoutus,
            kgFarineAbimes: d.kgFarineAbimes ?? null,
            sacsUtilises: d.sacsUtilises,
            paquetsLevureUtilises: d.paquetsLevureUtilises,
            kgSelUtilises: d.kgSelUtilises,
            quantiteHuileUtilisee: d.quantiteHuileUtilisee,
            observations: d.observations ?? null,
            enregistreParId: req.utilisateur!.id,
            dons: { create: d.dons },
          },
        });

        const sousSeuil = [];
        for (const [code, quantite] of aConsommer) {
          const matiere = parCode.get(code);
          if (!matiere) continue;
          const { matiere: maj, franchitSeuil } = await appliquerMouvement(tx, {
            matierePremiereId: matiere.id,
            type: "SORTIE",
            quantite,
            reference: `Production n°${production.numero}`,
            productionId: production.id,
            auteurId: req.utilisateur!.id,
          });
          if (franchitSeuil) sousSeuil.push(maj);
        }

        const complete = await tx.production.findUniqueOrThrow({
          where: { id: production.id },
          include: INCLUDE_PRODUCTION,
        });
        return { production: complete, sousSeuil };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const dto = versProductionDTO(resultat.production);

    // Réconciliation : signalée, jamais bloquante (section 3.3 b).
    if (dto.ecartReconciliation !== 0) {
      const signe = dto.ecartReconciliation > 0 ? "de plus que" : "de moins que";
      avertissements.unshift(
        `Réconciliation : ${dto.totalDestinations} bac(s) répartis, soit ${Math.abs(dto.ecartReconciliation)} ${signe} les ${dto.bacsProduits} bac(s) produits.`,
      );
    }

    const detailConsommations = dto.consommations
      .map((c) => `${formatQuantite(c.quantite, c.unite)} ${c.matiereNom}`)
      .join(", ");
    busEvenements.emettreEvenement({
      type: "PRODUCTION_ENREGISTREE",
      module: "PRODUCTION",
      emetteurId: req.utilisateur!.id,
      evenementRef: dto.id,
      message: `Production n°${dto.numero} — ${dto.bacsProduits} bac(s) produits${detailConsommations ? ` (consommé : ${detailConsommations})` : ""}`,
      donnees: { productionId: dto.id, numero: dto.numero, bacsProduits: dto.bacsProduits },
    });
    // Alerte seuil critique déclenchée par la décrémentation : même canal que
    // pour un mouvement manuel (mécanisme réutilisé, non dupliqué).
    for (const matiere of resultat.sousSeuil) emettreAlerteSeuil(matiere, req.utilisateur!.id);

    res.status(201).json({ production: dto, avertissements });
  } catch (e) {
    if (e instanceof ErreurStock) return res.status(e.status).json({ erreur: e.message });
    next(e);
  }
});

// --- Écarts prévu / réalisé pour une date (section 3.3) ---------------------

productionRouter.get("/ecarts", lecture, async (req, res, next) => {
  try {
    const { date } = req.query as Record<string, string | undefined>;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ erreur: "Date requise (AAAA-MM-JJ)" });
    }

    const planning = await prisma.planningProduction.findUnique({
      where: { datePrevue: new Date(date) },
      include: INCLUDE_PLANNING,
    });
    // Réalisé = cumul des productions enregistrées ce jour-là.
    const productions = await prisma.production.findMany({
      where: { date: { gte: new Date(`${date}T00:00:00.000Z`), lte: new Date(`${date}T23:59:59.999Z`) } },
    });

    const somme = (f: (p: (typeof productions)[number]) => number) => productions.reduce((s, p) => s + f(p), 0);
    const ligne = (cle: LigneEcartDTO["cle"], prevu: number, realise: number): LigneEcartDTO => ({
      cle,
      prevu,
      realise,
      ecart: Math.round((realise - prevu) * 1000) / 1000,
    });

    const dto: EcartsProductionDTO = {
      date,
      planning: planning ? versPlanningDTO(planning) : null,
      nbProductions: productions.length,
      lignes: [
        ligne("bacs", planning?.nombreBacsCommandes ?? 0, somme((p) => p.bacsProduits)),
        ligne("sacsFarine", planning?.sacsFarinePrevus.toNumber() ?? 0, somme((p) => p.sacsUtilises.toNumber())),
        ligne("paquetsLevure", planning?.paquetsLevurePrevus.toNumber() ?? 0, somme((p) => p.paquetsLevureUtilises.toNumber())),
        ligne("quantiteHuile", planning?.quantiteHuilePrevue.toNumber() ?? 0, somme((p) => p.quantiteHuileUtilisee.toNumber())),
        ligne("kgSel", planning?.kgSelPrevus.toNumber() ?? 0, somme((p) => p.kgSelUtilises.toNumber())),
      ],
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});
