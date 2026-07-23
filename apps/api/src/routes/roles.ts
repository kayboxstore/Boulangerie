import { Router } from "express";
import { rolePermissionsSchema } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { traiterActionCritique } from "../services/actionsCritiques.js";

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

// Modifier les permissions d'un rôle (tâche critique, section 2) — réservé aux
// Admins (écriture Équipe) ; différé pour un Admin secondaire.
rolesRouter.put("/:id/permissions", requireAuth, requirePermission("EQUIPE", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = rolePermissionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const role = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!role) return res.status(404).json({ erreur: "Rôle introuvable" });

    const r = await traiterActionCritique(
      req,
      "MODIFIER_PERMISSIONS_ROLE",
      { roleId: role.id, permissions: parsed.data.permissions },
      `modifier les permissions du rôle « ${role.nom} »`,
    );
    res.status(r.http).json(r.body);
  } catch (e) {
    next(e);
  }
});
