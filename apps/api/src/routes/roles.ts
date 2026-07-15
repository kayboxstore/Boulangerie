import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const rolesRouter = Router();

// Consultation de la hiérarchie et de la matrice de permissions.
// Réservée à ceux qui ont au moins la lecture sur Équipe & droits d'accès
// (Administrateur en écriture, DG en lecture).
rolesRouter.get("/", requireAuth, requirePermission("EQUIPE", "LECTURE"), async (_req, res, next) => {
  try {
    const roles = await prisma.role.findMany({
      include: { permissions: true, roleParent: { select: { nom: true } } },
      orderBy: { nom: "asc" },
    });
    res.json({
      roles: roles.map((r) => ({
        id: r.id,
        nom: r.nom,
        roleParentId: r.roleParentId,
        roleParentNom: r.roleParent?.nom ?? null,
        permissions: r.permissions.map((p) => ({ module: p.module, niveauAcces: p.niveauAcces })),
      })),
    });
  } catch (e) {
    next(e);
  }
});
