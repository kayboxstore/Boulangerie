import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  formatQuantite,
  planningCreateSchema,
  productionCreateSchema,
  recetteCreateSchema,
  recetteUpdateSchema,
  type PlanningProductionDTO,
  type ProductionDTO,
  type RecetteDTO,
  type StatutPlanning,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";
import { appliquerMouvement, emettreAlerteSeuil, ErreurStock } from "../services/stocks.js";

export const productionRouter = Router();

productionRouter.use(requireAuth);

type RecetteAvecRelations = Prisma.RecetteGetPayload<{
  include: {
    produit: { select: { id: true; nom: true } };
    ingredients: {
      include: {
        matierePremiere: { select: { id: true; nom: true; unite: true; quantiteStock: true } };
      };
    };
  };
}>;

const INCLUDE_RECETTE = {
  produit: { select: { id: true, nom: true } },
  ingredients: {
    include: { matierePremiere: { select: { id: true, nom: true, unite: true, quantiteStock: true } } },
  },
} as const;

const versRecetteDTO = (r: RecetteAvecRelations): RecetteDTO => ({
  id: r.id,
  produit: r.produit,
  instructions: r.instructions,
  ingredients: r.ingredients.map((i) => ({
    id: i.id,
    matierePremiere: {
      id: i.matierePremiere.id,
      nom: i.matierePremiere.nom,
      unite: i.matierePremiere.unite,
      quantiteStock: i.matierePremiere.quantiteStock.toNumber(),
    },
    quantite: i.quantite.toNumber(),
  })),
});

type PlanningAvecRelations = Prisma.PlanningProductionGetPayload<{
  include: {
    recette: { include: { produit: { select: { nom: true } } } };
    creePar: { select: { id: true; nom: true } };
  };
}>;

const INCLUDE_PLANNING = {
  recette: { include: { produit: { select: { nom: true } } } },
  creePar: { select: { id: true, nom: true } },
} as const;

const versPlanningDTO = (p: PlanningAvecRelations): PlanningProductionDTO => ({
  id: p.id,
  datePrevue: p.datePrevue.toISOString().slice(0, 10),
  recette: { id: p.recetteId, produitNom: p.recette.produit.nom },
  quantitePrevue: p.quantitePrevue,
  statut: p.statut as StatutPlanning,
  creePar: p.creePar,
});

type ProductionAvecRelations = Prisma.ProductionGetPayload<{
  include: {
    recette: { include: { produit: { select: { nom: true } } } };
    enregistrePar: { select: { id: true; nom: true } };
    mouvements: { include: { matierePremiere: { select: { nom: true; unite: true } } } };
  };
}>;

const INCLUDE_PRODUCTION = {
  recette: { include: { produit: { select: { nom: true } } } },
  enregistrePar: { select: { id: true, nom: true } },
  mouvements: { include: { matierePremiere: { select: { nom: true, unite: true } } } },
} as const;

const versProductionDTO = (p: ProductionAvecRelations): ProductionDTO => ({
  id: p.id,
  numero: p.numero,
  date: p.date.toISOString(),
  recette: { id: p.recetteId, produitNom: p.recette.produit.nom },
  quantiteProduite: p.quantiteProduite,
  enregistrePar: p.enregistrePar,
  consommations: p.mouvements.map((m) => ({
    matiereNom: m.matierePremiere.nom,
    unite: m.matierePremiere.unite,
    quantite: m.quantite.toNumber(),
  })),
});

// --- Recettes ---------------------------------------------------------------

productionRouter.get("/recettes", requirePermission("PRODUCTION", "LECTURE"), async (_req, res, next) => {
  try {
    const recettes = await prisma.recette.findMany({
      include: INCLUDE_RECETTE,
      orderBy: { produit: { nom: "asc" } },
    });
    res.json({ recettes: recettes.map(versRecetteDTO) });
  } catch (e) {
    next(e);
  }
});

productionRouter.post("/recettes", requirePermission("PRODUCTION", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = recetteCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { produitId, instructions, ingredients } = parsed.data;

    const produit = await prisma.produit.findUnique({ where: { id: produitId } });
    if (!produit) return res.status(404).json({ erreur: "Produit introuvable" });
    const existante = await prisma.recette.findUnique({ where: { produitId } });
    if (existante) return res.status(409).json({ erreur: `Une recette existe déjà pour ${produit.nom}` });

    const matiereIds = ingredients.map((i) => i.matierePremiereId);
    if (new Set(matiereIds).size !== matiereIds.length) {
      return res.status(400).json({ erreur: "Une matière première apparaît deux fois dans la recette" });
    }
    const matieres = await prisma.matierePremiere.count({ where: { id: { in: matiereIds } } });
    if (matieres !== matiereIds.length) {
      return res.status(400).json({ erreur: "Matière première inconnue dans la recette" });
    }

    const recette = await prisma.recette.create({
      data: {
        produitId,
        instructions: instructions ?? null,
        ingredients: { create: ingredients },
      },
      include: INCLUDE_RECETTE,
    });
    res.status(201).json({ recette: versRecetteDTO(recette) });
  } catch (e) {
    next(e);
  }
});

productionRouter.put("/recettes/:id", requirePermission("PRODUCTION", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = recetteUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { instructions, ingredients } = parsed.data;

    const existante = await prisma.recette.findUnique({ where: { id: req.params.id } });
    if (!existante) return res.status(404).json({ erreur: "Recette introuvable" });

    const matiereIds = ingredients.map((i) => i.matierePremiereId);
    if (new Set(matiereIds).size !== matiereIds.length) {
      return res.status(400).json({ erreur: "Une matière première apparaît deux fois dans la recette" });
    }
    const matieres = await prisma.matierePremiere.count({ where: { id: { in: matiereIds } } });
    if (matieres !== matiereIds.length) {
      return res.status(400).json({ erreur: "Matière première inconnue dans la recette" });
    }

    const recette = await prisma.$transaction(async (tx) => {
      await tx.ingredientRecette.deleteMany({ where: { recetteId: existante.id } });
      return tx.recette.update({
        where: { id: existante.id },
        data: { instructions: instructions ?? null, ingredients: { create: ingredients } },
        include: INCLUDE_RECETTE,
      });
    });
    res.json({ recette: versRecetteDTO(recette) });
  } catch (e) {
    next(e);
  }
});

productionRouter.delete("/recettes/:id", requirePermission("PRODUCTION", "ECRITURE"), async (req, res, next) => {
  try {
    const recette = await prisma.recette.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { productions: true } } },
    });
    if (!recette) return res.status(404).json({ erreur: "Recette introuvable" });
    if (recette._count.productions > 0) {
      return res.status(409).json({ erreur: "Suppression impossible : des productions ont été enregistrées avec cette recette" });
    }
    await prisma.recette.delete({ where: { id: recette.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// --- Planning de production journalier --------------------------------------

productionRouter.get("/planning", requirePermission("PRODUCTION", "LECTURE"), async (req, res, next) => {
  try {
    const { du, au } = req.query as Record<string, string | undefined>;
    const datePrevue: Prisma.DateTimeFilter = {};
    if (du) datePrevue.gte = new Date(du);
    if (au) datePrevue.lte = new Date(au);

    const plannings = await prisma.planningProduction.findMany({
      where: du || au ? { datePrevue } : {},
      include: INCLUDE_PLANNING,
      orderBy: [{ datePrevue: "desc" }, { createdAt: "asc" }],
      take: 60,
    });
    res.json({ plannings: plannings.map(versPlanningDTO) });
  } catch (e) {
    next(e);
  }
});

productionRouter.post("/planning", requirePermission("PRODUCTION", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = planningCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { recetteId, quantitePrevue, datePrevue } = parsed.data;

    const recette = await prisma.recette.findUnique({ where: { id: recetteId } });
    if (!recette) return res.status(404).json({ erreur: "Recette introuvable" });

    const planning = await prisma.planningProduction.create({
      data: {
        recetteId,
        quantitePrevue,
        datePrevue: new Date(datePrevue),
        creeParId: req.utilisateur!.id,
      },
      include: INCLUDE_PLANNING,
    });
    res.status(201).json({ planning: versPlanningDTO(planning) });
  } catch (e) {
    next(e);
  }
});

productionRouter.delete("/planning/:id", requirePermission("PRODUCTION", "ECRITURE"), async (req, res, next) => {
  try {
    const planning = await prisma.planningProduction.findUnique({ where: { id: req.params.id } });
    if (!planning) return res.status(404).json({ erreur: "Planification introuvable" });
    if (planning.statut === "FAIT") {
      return res.status(409).json({ erreur: "Cette planification a déjà été produite" });
    }
    await prisma.planningProduction.delete({ where: { id: planning.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// --- Productions (décrémentation automatique du stock, section 3.3) ---------

productionRouter.get("/productions", requirePermission("PRODUCTION", "LECTURE"), async (_req, res, next) => {
  try {
    const productions = await prisma.production.findMany({
      include: INCLUDE_PRODUCTION,
      orderBy: { numero: "desc" },
      take: 60,
    });
    res.json({ productions: productions.map(versProductionDTO) });
  } catch (e) {
    next(e);
  }
});

productionRouter.post("/productions", requirePermission("PRODUCTION", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = productionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { recetteId, quantiteProduite, planningId } = parsed.data;

    const recette = await prisma.recette.findUnique({ where: { id: recetteId }, include: INCLUDE_RECETTE });
    if (!recette) return res.status(404).json({ erreur: "Recette introuvable" });
    if (recette.ingredients.length === 0) {
      return res.status(400).json({ erreur: "La recette n'a aucun ingrédient" });
    }
    if (planningId) {
      const planning = await prisma.planningProduction.findUnique({ where: { id: planningId } });
      if (!planning || planning.recetteId !== recetteId) {
        return res.status(400).json({ erreur: "Planification invalide pour cette recette" });
      }
    }

    // Production + mouvements SORTIE dans UNE transaction : la décrémentation
    // du stock est automatique et atomique (tout ou rien — un stock
    // insuffisant annule aussi l'enregistrement de la production).
    const resultat = await prisma.$transaction(
      async (tx) => {
        const production = await tx.production.create({
          data: {
            recetteId,
            quantiteProduite,
            planningId: planningId ?? null,
            enregistreParId: req.utilisateur!.id,
          },
        });

        const sousSeuil = [];
        for (const ingredient of recette.ingredients) {
          const consommation = Math.round(ingredient.quantite.toNumber() * quantiteProduite * 1000) / 1000;
          const { matiere, franchitSeuil } = await appliquerMouvement(tx, {
            matierePremiereId: ingredient.matierePremiereId,
            type: "SORTIE",
            quantite: consommation,
            reference: `Production n°${production.numero}`,
            productionId: production.id,
            auteurId: req.utilisateur!.id,
          });
          if (franchitSeuil) sousSeuil.push(matiere);
        }

        if (planningId) {
          await tx.planningProduction.update({ where: { id: planningId }, data: { statut: "FAIT" } });
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
    const detailConsommations = dto.consommations
      .map((c) => `${formatQuantite(c.quantite, c.unite)} ${c.matiereNom}`)
      .join(", ");
    busEvenements.emettreEvenement({
      type: "PRODUCTION_ENREGISTREE",
      module: "PRODUCTION",
      emetteurId: req.utilisateur!.id,
      evenementRef: dto.id,
      message: `Production n°${dto.numero} — ${dto.quantiteProduite} × ${dto.recette.produitNom} (consommé : ${detailConsommations})`,
      donnees: { productionId: dto.id, numero: dto.numero, quantiteProduite: dto.quantiteProduite },
    });
    // Alerte seuil critique déclenchée par la décrémentation automatique :
    // même canal que pour un mouvement manuel (point 9 de la section 3.3).
    for (const matiere of resultat.sousSeuil) emettreAlerteSeuil(matiere, req.utilisateur!.id);

    res.status(201).json({ production: dto });
  } catch (e) {
    if (e instanceof ErreurStock) return res.status(e.status).json({ erreur: e.message });
    next(e);
  }
});
