import { Router } from "express";
import { Prisma } from "@prisma/client";
import { delegationCreateSchema, type DelegationDTO, type Module } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { dateSQLDepuisJourLomoto, jourLomoto } from "../lib/temps.js";

export const delegationsRouter = Router();

// Délégation temporaire de rôle (section 3.7) — gérée par les Admins (pas une
// tâche critique) : accorder à un utilisateur les droits d'écriture d'un module
// sur une période. Principal ET secondaire peuvent le faire.
delegationsRouter.use(requireAuth, requirePermission("EQUIPE", "ECRITURE"));

type DelegationAvecRelations = Prisma.DelegationRoleGetPayload<{
  include: {
    utilisateur: { select: { id: true; nom: true; role: { select: { nom: true } } } };
    creePar: { select: { id: true; nom: true } };
  };
}>;

const INCLUDE = {
  utilisateur: { select: { id: true, nom: true, role: { select: { nom: true } } } },
  creePar: { select: { id: true, nom: true } },
} as const;

const versDTO = (d: DelegationAvecRelations): DelegationDTO => {
  const debut = jourLomoto(d.dateDebut);
  const fin = jourLomoto(d.dateFin);
  const auj = jourLomoto();
  return {
    id: d.id,
    utilisateur: { id: d.utilisateur.id, nom: d.utilisateur.nom, roleNom: d.utilisateur.role.nom },
    module: d.module as Module,
    dateDebut: debut,
    dateFin: fin,
    active: debut <= auj && auj <= fin,
    creePar: d.creePar,
  };
};

delegationsRouter.get("/", async (_req, res, next) => {
  try {
    const delegations = await prisma.delegationRole.findMany({
      include: INCLUDE,
      orderBy: { dateFin: "desc" },
      take: 100,
    });
    res.json({ delegations: delegations.map(versDTO) });
  } catch (e) {
    next(e);
  }
});

delegationsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = delegationCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { utilisateurId, module, dateDebut, dateFin } = parsed.data;

    const utilisateur = await prisma.utilisateur.findUnique({ where: { id: utilisateurId } });
    if (!utilisateur) return res.status(404).json({ erreur: "Utilisateur introuvable" });

    const delegation = await prisma.delegationRole.create({
      data: {
        utilisateurId,
        module,
        dateDebut: dateSQLDepuisJourLomoto(dateDebut),
        dateFin: dateSQLDepuisJourLomoto(dateFin),
        creeParId: req.utilisateur!.id,
      },
      include: INCLUDE,
    });
    res.status(201).json({ delegation: versDTO(delegation) });
  } catch (e) {
    next(e);
  }
});

delegationsRouter.delete("/:id", async (req, res, next) => {
  try {
    const delegation = await prisma.delegationRole.findUnique({ where: { id: req.params.id } });
    if (!delegation) return res.status(404).json({ erreur: "Délégation introuvable" });
    await prisma.delegationRole.delete({ where: { id: delegation.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
