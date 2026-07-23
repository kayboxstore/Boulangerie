import { Router } from "express";
import { Prisma } from "@prisma/client";
import { MODULES, type AuditLogDTO, type ActionAudit, type Module } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const auditRouter = Router();

// Journal d'audit (section 3.17) — LECTURE SEULE, réservé au DG et aux Admins
// (lecture sur Équipe & droits d'accès). Aucune route d'écriture n'existe : le
// journal est immuable, alimenté uniquement par l'extension Prisma (lib/audit).
auditRouter.use(requireAuth, requirePermission("EQUIPE", "LECTURE"));

type AuditAvecRelation = Prisma.AuditLogGetPayload<{
  include: { utilisateur: { select: { id: true; nom: true } } };
}>;

const versDTO = (a: AuditAvecRelation): AuditLogDTO => ({
  id: a.id,
  // Le nom est un instantané figé (utilisateurNom) : il survit à la suppression
  // du compte auteur ; l'id relationnel n'est fourni que s'il existe encore.
  utilisateur: { id: a.utilisateur?.id ?? null, nom: a.utilisateurNom },
  module: a.module as Module,
  typeEntite: a.typeEntite,
  entiteId: a.entiteId,
  action: a.action as ActionAudit,
  avant: (a.avant as Record<string, unknown> | null) ?? null,
  apres: (a.apres as Record<string, unknown> | null) ?? null,
  date: a.createdAt.toISOString(),
});

// Filtres : par utilisateur, par module, par période (section 3.17).
auditRouter.get("/", async (req, res, next) => {
  try {
    const { utilisateurId, module, dateDebut, dateFin } = req.query as Record<string, string | undefined>;

    const where: Prisma.AuditLogWhereInput = {};
    if (utilisateurId) where.utilisateurId = utilisateurId;
    if (module && (MODULES as readonly string[]).includes(module)) {
      where.module = module as Module;
    }
    if (dateDebut || dateFin) {
      where.createdAt = {};
      if (dateDebut) where.createdAt.gte = new Date(`${dateDebut}T00:00:00.000Z`);
      // Borne de fin inclusive : jusqu'à la fin de la journée indiquée.
      if (dateFin) where.createdAt.lte = new Date(`${dateFin}T23:59:59.999Z`);
    }

    const entrees = await prisma.auditLog.findMany({
      where,
      include: { utilisateur: { select: { id: true, nom: true } } },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ entrees: entrees.map(versDTO) });
  } catch (e) {
    next(e);
  }
});
