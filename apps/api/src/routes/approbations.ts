import { Router } from "express";
import { Prisma } from "@prisma/client";
import type { DemandeApprobationDTO, StatutDemande, TypeActionCritique } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { ErreurAction, executerAction } from "../services/actionsCritiques.js";

export const approbationsRouter = Router();

approbationsRouter.use(requireAuth, requirePermission("EQUIPE", "ECRITURE"));

type DemandeAvecRelations = Prisma.DemandeApprobationGetPayload<{
  include: {
    demandePar: { select: { id: true; nom: true } };
    approuvePar: { select: { id: true; nom: true } };
  };
}>;

const INCLUDE = {
  demandePar: { select: { id: true, nom: true } },
  approuvePar: { select: { id: true, nom: true } },
} as const;

const versDTO = (d: DemandeAvecRelations): DemandeApprobationDTO => ({
  id: d.id,
  type: d.type as TypeActionCritique,
  resume: d.resume,
  statut: d.statut as StatutDemande,
  demandePar: d.demandePar,
  approuvePar: d.approuvePar,
  erreur: d.erreur,
  dateDemande: d.dateDemande.toISOString(),
  dateDecision: d.dateDecision?.toISOString() ?? null,
});

// File d'attente : l'Admin Principal voit toutes les demandes, un Admin
// secondaire voit seulement les siennes (pour suivre leur statut).
approbationsRouter.get("/", async (req, res, next) => {
  try {
    const demandes = await prisma.demandeApprobation.findMany({
      where: req.utilisateur!.estAdminPrincipal ? {} : { demandeParId: req.utilisateur!.id },
      include: INCLUDE,
      orderBy: [{ statut: "asc" }, { dateDemande: "desc" }],
      take: 100,
    });
    res.json({ demandes: demandes.map(versDTO) });
  } catch (e) {
    next(e);
  }
});

approbationsRouter.post("/:id/approuver", async (req, res, next) => {
  try {
    // Seul l'Admin Principal décide (section 2).
    if (!req.utilisateur!.estAdminPrincipal) {
      return res.status(403).json({ erreur: "Seul l'Administrateur principal peut approuver une demande" });
    }
    // `demandePar` inclus explicitement : c'est l'identité du demandeur
    // d'origine, distincte de l'Admin Principal qui approuve — voir
    // `services/permissionsRoleAudit.ts`, seul exécuteur qui l'exploite
    // aujourd'hui (piste d'audit de MODIFIER_PERMISSIONS_ROLE).
    const demande = await prisma.demandeApprobation.findUnique({
      where: { id: req.params.id },
      include: { demandePar: { select: { id: true, nom: true } } },
    });
    if (!demande) return res.status(404).json({ erreur: "Demande introuvable" });
    if (demande.statut !== "EN_ATTENTE") {
      return res.status(409).json({ erreur: "Cette demande a déjà été traitée" });
    }

    // L'action différée est rejouée maintenant. Si l'état a changé et la rend
    // impossible, on renseigne l'erreur et on laisse la demande en attente.
    try {
      const { message } = await executerAction(
        demande.type as TypeActionCritique,
        demande.donnees as Record<string, unknown>,
        demande.demandePar,
      );
      const maj = await prisma.demandeApprobation.update({
        where: { id: demande.id },
        data: { statut: "APPROUVEE", approuveParId: req.utilisateur!.id, dateDecision: new Date(), erreur: null },
        include: INCLUDE,
      });
      res.json({ demande: versDTO(maj), message });
    } catch (e) {
      if (e instanceof ErreurAction) {
        await prisma.demandeApprobation.update({ where: { id: demande.id }, data: { erreur: e.message } });
        return res.status(e.status).json({ erreur: `Exécution impossible : ${e.message}` });
      }
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

approbationsRouter.post("/:id/rejeter", async (req, res, next) => {
  try {
    if (!req.utilisateur!.estAdminPrincipal) {
      return res.status(403).json({ erreur: "Seul l'Administrateur principal peut rejeter une demande" });
    }
    const demande = await prisma.demandeApprobation.findUnique({ where: { id: req.params.id } });
    if (!demande) return res.status(404).json({ erreur: "Demande introuvable" });
    if (demande.statut !== "EN_ATTENTE") {
      return res.status(409).json({ erreur: "Cette demande a déjà été traitée" });
    }
    const maj = await prisma.demandeApprobation.update({
      where: { id: demande.id },
      data: { statut: "REJETEE", approuveParId: req.utilisateur!.id, dateDecision: new Date() },
      include: INCLUDE,
    });
    res.json({ demande: versDTO(maj) });
  } catch (e) {
    next(e);
  }
});
