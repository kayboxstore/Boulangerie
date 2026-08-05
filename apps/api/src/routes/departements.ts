import { Router } from "express";
import {
  departementCreateSchema,
  departementUpdateSchema,
  groupeCreateSchema,
  groupeUpdateSchema,
  type DepartementDTO,
  type GroupeDTO,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

/**
 * Départements & Groupes (section 3.18, nouveau) : purement organisationnel,
 * aucune permission propre — gouverné par le module TRAVAILLEURS (Admin
 * secondaire/Principal en écriture, comme le reste du module).
 */
export const departementsRouter = Router();
export const groupesRouter = Router();

departementsRouter.use(requireAuth);
groupesRouter.use(requireAuth);

const INCLUDE_DEPARTEMENT = {
  chefTravailleur: { select: { id: true, nom: true } },
  groupes: { include: { _count: { select: { travailleurs: true } } }, orderBy: { nom: "asc" as const } },
  _count: { select: { travailleurs: true } },
} as const;

type DepartementAvecRelations = Awaited<ReturnType<typeof chargerDepartement>>;

async function chargerDepartement(id: string) {
  return prisma.departement.findUnique({ where: { id }, include: INCLUDE_DEPARTEMENT });
}

const versGroupeDTO = (g: { id: string; departementId: string; nom: string; _count: { travailleurs: number } }): GroupeDTO => ({
  id: g.id,
  departementId: g.departementId,
  nom: g.nom,
  nombreTravailleurs: g._count.travailleurs,
});

function versDepartementDTO(d: NonNullable<DepartementAvecRelations>): DepartementDTO {
  return {
    id: d.id,
    nom: d.nom,
    chef: d.chefTravailleur,
    groupes: d.groupes.map(versGroupeDTO),
    nombreTravailleurs: d._count.travailleurs,
  };
}

// --- Départements ------------------------------------------------------------

departementsRouter.get("/", requirePermission("TRAVAILLEURS", "LECTURE"), async (_req, res, next) => {
  try {
    const departements = await prisma.departement.findMany({
      include: INCLUDE_DEPARTEMENT,
      orderBy: { nom: "asc" },
    });
    res.json({ departements: departements.map(versDepartementDTO) });
  } catch (e) {
    next(e);
  }
});

departementsRouter.post("/", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = departementCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { nom, chefTravailleurId } = parsed.data;

    // Un département naissant n'a encore aucun membre : le chef désigné à la
    // création ne peut donc pas déjà appartenir à un AUTRE département —
    // il est automatiquement rattaché à celui-ci en même temps qu'il en
    // devient le chef (sinon la contrainte « chef = membre du département »
    // serait impossible à satisfaire au tout premier enregistrement).
    if (chefTravailleurId) {
      const chef = await prisma.travailleur.findUnique({ where: { id: chefTravailleurId } });
      if (!chef) return res.status(404).json({ erreur: "Travailleur (chef) introuvable" });
      if (chef.departementId) {
        return res.status(409).json({ erreur: `${chef.nom} appartient déjà à un autre département` });
      }
    }

    const departement = await prisma.departement.create({
      data: { nom, chefTravailleurId: chefTravailleurId ?? null },
    });
    if (chefTravailleurId) {
      await prisma.travailleur.update({ where: { id: chefTravailleurId }, data: { departementId: departement.id } });
    }

    const complet = await chargerDepartement(departement.id);
    res.status(201).json({ departement: versDepartementDTO(complet!) });
  } catch (e) {
    next(e);
  }
});

departementsRouter.put("/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = departementUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existant = await prisma.departement.findUnique({ where: { id: req.params.id } });
    if (!existant) return res.status(404).json({ erreur: "Département introuvable" });

    const { nom, chefTravailleurId } = parsed.data;

    // Le chef ne peut être choisi que parmi les Travailleurs déjà membres de
    // CE département (spec 3.18) — pas d'auto-rattachement ici, contrairement
    // à la création : le département a déjà des membres potentiels.
    if (chefTravailleurId) {
      const chef = await prisma.travailleur.findUnique({ where: { id: chefTravailleurId } });
      if (!chef) return res.status(404).json({ erreur: "Travailleur (chef) introuvable" });
      if (chef.departementId !== existant.id) {
        return res.status(400).json({ erreur: "Le chef doit être un membre de ce département" });
      }
    }

    await prisma.departement.update({
      where: { id: existant.id },
      data: { nom, chefTravailleurId },
    });
    const complet = await chargerDepartement(existant.id);
    res.json({ departement: versDepartementDTO(complet!) });
  } catch (e) {
    next(e);
  }
});

// Suppression : les Groupes du département disparaissent en cascade, les
// Travailleurs qui y étaient rattachés voient leur départementId/groupeId
// remis à null (ON DELETE SET NULL) — la fiche subsiste, seul le lien tombe.
departementsRouter.delete("/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const existant = await prisma.departement.findUnique({ where: { id: req.params.id } });
    if (!existant) return res.status(404).json({ erreur: "Département introuvable" });
    await prisma.departement.delete({ where: { id: existant.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// --- Groupes (sous-collection d'un département) ------------------------------

departementsRouter.post("/:id/groupes", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const departement = await prisma.departement.findUnique({ where: { id: req.params.id } });
    if (!departement) return res.status(404).json({ erreur: "Département introuvable" });

    const parsed = groupeCreateSchema.safeParse({ ...req.body, departementId: departement.id });
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }

    const existant = await prisma.groupe.findFirst({ where: { departementId: departement.id, nom: parsed.data.nom } });
    if (existant) return res.status(409).json({ erreur: `Un groupe « ${parsed.data.nom} » existe déjà dans ce département` });

    const groupe = await prisma.groupe.create({
      data: { departementId: departement.id, nom: parsed.data.nom },
      include: { _count: { select: { travailleurs: true } } },
    });
    res.status(201).json({ groupe: versGroupeDTO(groupe) });
  } catch (e) {
    next(e);
  }
});

groupesRouter.put("/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = groupeUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existant = await prisma.groupe.findUnique({ where: { id: req.params.id } });
    if (!existant) return res.status(404).json({ erreur: "Groupe introuvable" });

    const doublon = await prisma.groupe.findFirst({
      where: { departementId: existant.departementId, nom: parsed.data.nom, id: { not: existant.id } },
    });
    if (doublon) return res.status(409).json({ erreur: `Un groupe « ${parsed.data.nom} » existe déjà dans ce département` });

    const groupe = await prisma.groupe.update({
      where: { id: existant.id },
      data: { nom: parsed.data.nom },
      include: { _count: { select: { travailleurs: true } } },
    });
    res.json({ groupe: versGroupeDTO(groupe) });
  } catch (e) {
    next(e);
  }
});

// La suppression retire aussi le rattachement des Travailleurs du groupe
// (ON DELETE SET NULL) — leur département, lui, n'est pas touché.
groupesRouter.delete("/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const existant = await prisma.groupe.findUnique({ where: { id: req.params.id } });
    if (!existant) return res.status(404).json({ erreur: "Groupe introuvable" });
    await prisma.groupe.delete({ where: { id: existant.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
