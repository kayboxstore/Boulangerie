import { Router } from "express";
import { Prisma } from "@prisma/client";
import type { DemandeApprobationDTO, StatutDemande, TypeActionCritique } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { ErreurAction, executerAction } from "../services/actionsCritiques.js";
import {
  approuverEtAppliquerModificationPermissionsRole,
  ErreurApprobationConcurrente,
} from "../services/permissionsRoleAudit.js";

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

    // Aperçu léger, UNIQUEMENT pour aiguiller vers le bon chemin selon le
    // type d'action — jamais utilisé pour décider si l'approbation doit
    // avoir lieu (ça, c'est l'écriture conditionnelle atomique ci-dessous
    // qui en décide, pour MODIFIER_PERMISSIONS_ROLE).
    const apercu = await prisma.demandeApprobation.findUnique({ where: { id: req.params.id }, select: { type: true } });
    if (!apercu) return res.status(404).json({ erreur: "Demande introuvable" });

    // Correctif P1-02 (Round 2, contre-revue Codex du 24/08/2026) :
    // réservation atomique de la demande + exécution de l'action + écriture
    // de l'audit + transition vers APPROUVEE, LE TOUT dans une seule
    // transaction PostgreSQL Serializable — voir
    // `services/permissionsRoleAudit.ts` pour le mécanisme complet et le P1
    // restant explicitement documenté pour les 4 autres types d'action
    // critique (chemin inchangé juste en dessous).
    if (apercu.type === "MODIFIER_PERMISSIONS_ROLE") {
      try {
        const resultat = await approuverEtAppliquerModificationPermissionsRole(prisma, req.params.id, {
          id: req.utilisateur!.id,
          nom: req.utilisateur!.nom,
        });
        const maj = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: req.params.id }, include: INCLUDE });
        return res.json({ demande: versDTO(maj), message: `Permissions du rôle « ${resultat.roleNom} » mises à jour` });
      } catch (e) {
        if (e instanceof ErreurApprobationConcurrente) {
          return res.status(409).json({ erreur: "Cette demande a déjà été traitée" });
        }
        if (e instanceof ErreurAction) {
          // La transaction entière (réservation incluse) a été annulée par
          // PostgreSQL : la demande est redevenue EN_ATTENTE. Cette écriture
          // de suivi (message d'erreur pour l'UI) est délibérément séparée —
          // ce n'est pas une action métier, aucune atomicité requise avec
          // quoi que ce soit d'autre.
          await prisma.demandeApprobation.update({ where: { id: req.params.id }, data: { erreur: e.message } });
          return res.status(e.status).json({ erreur: `Exécution impossible : ${e.message}` });
        }
        throw e;
      }
    }

    // Chemin EXISTANT, INCHANGÉ, pour les 4 autres types d'action critique
    // (SUPPRIMER_UTILISATEUR, CREER_COMPTE_ADMIN, MODIFIER_TYPE_CLIENT,
    // MODIFIER_TAUX_TAXE) : la même course décrite en tête de
    // `permissionsRoleAudit.ts` reste possible pour eux — P1 restant,
    // signalé explicitement, non traité par ce correctif (hors périmètre
    // strict du Round 2 : « Deux P1 doivent être corrigés », tous deux
    // scopés à MODIFIER_PERMISSIONS_ROLE).
    const demande = await prisma.demandeApprobation.findUnique({ where: { id: req.params.id } });
    if (!demande) return res.status(404).json({ erreur: "Demande introuvable" });
    if (demande.statut !== "EN_ATTENTE") {
      return res.status(409).json({ erreur: "Cette demande a déjà été traitée" });
    }

    // L'action différée est rejouée maintenant. Si l'état a changé et la rend
    // impossible, on renseigne l'erreur et on laisse la demande en attente.
    try {
      const { message } = await executerAction(demande.type as TypeActionCritique, demande.donnees as Record<string, unknown>);
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
