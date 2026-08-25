import { Router } from "express";
import { Prisma } from "@prisma/client";
import type { DemandeApprobationDTO, StatutDemande, TypeActionCritique } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { ErreurAction, executerAction } from "../services/actionsCritiques.js";
import {
  approuverEtAppliquerModificationPermissionsRole,
  ErreurApprobationConcurrente,
  ErreurConflitApprobationReessayable,
} from "../services/permissionsRoleAudit.js";
import {
  enregistrerErreurSiEncoreEnAttente,
  ErreurDecisionConcurrente,
  marquerApprouveeSiEncoreEnAttente,
  rejeterDemandeApprobationAtomique,
} from "../services/demandeApprobation.js";

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
        if (e instanceof ErreurConflitApprobationReessayable) {
          // Distinct du 409 ci-dessus (correctif Round 4) : ici, PERSONNE
          // n'a gagné — un conflit de sérialisation PostgreSQL réel et
          // persistant a empêché de trancher, la demande reste EN_ATTENTE.
          // Un 409 « déjà traitée » serait un mensonge ; 503 signale un état
          // temporaire, réessayable.
          return res.status(503).json({ erreur: e.message });
        }
        if (e instanceof ErreurAction) {
          // La transaction entière (réservation incluse) a été annulée par
          // PostgreSQL : la demande est redevenue EN_ATTENTE. Cette écriture
          // de suivi (message d'erreur pour l'UI) est délibérément séparée —
          // ce n'est pas une action métier, aucune atomicité requise avec
          // quoi que ce soit d'autre. Conditionnée sur EN_ATTENTE (correctif
          // Round 3, P1-01) : jamais poser un message d'erreur périmé sur une
          // demande déjà décidée (rejetée) entre-temps par une requête
          // concurrente.
          await enregistrerErreurSiEncoreEnAttente(prisma, req.params.id, e.message);
          return res.status(e.status).json({ erreur: `Exécution impossible : ${e.message}` });
        }
        throw e;
      }
    }

    // Chemin EXISTANT pour les 4 autres types d'action critique
    // (SUPPRIMER_UTILISATEUR, CREER_COMPTE_ADMIN, MODIFIER_TYPE_CLIENT,
    // MODIFIER_TAUX_TAXE) : l'EXÉCUTION métier elle-même reste
    // NON transactionnelle avec la transition d'état — P1 restant, signalé
    // explicitement, non traité par ce correctif (refactor des 4 exécuteurs
    // en « tx-aware », hors périmètre de ce Round 3 — voir
    // `services/demandeApprobation.ts`). Ce qui EST corrigé ici (Round 3,
    // P1-01) : la transition finale vers APPROUVEE est désormais une
    // écriture CONDITIONNELLE (`marquerApprouveeSiEncoreEnAttente`), jamais
    // un `update` inconditionnel — elle ne peut plus écraser un rejet
    // concurrent déjà gagnant.
    const demande = await prisma.demandeApprobation.findUnique({ where: { id: req.params.id } });
    if (!demande) return res.status(404).json({ erreur: "Demande introuvable" });
    if (demande.statut !== "EN_ATTENTE") {
      return res.status(409).json({ erreur: "Cette demande a déjà été traitée" });
    }

    // L'action différée est rejouée maintenant. Si l'état a changé et la rend
    // impossible, on renseigne l'erreur et on laisse la demande en attente.
    try {
      const { message } = await executerAction(demande.type as TypeActionCritique, demande.donnees as Record<string, unknown>);
      try {
        await marquerApprouveeSiEncoreEnAttente(prisma, demande.id, {
          id: req.utilisateur!.id,
          nom: req.utilisateur!.nom,
        });
      } catch (e) {
        if (e instanceof ErreurDecisionConcurrente) {
          // L'action métier a RÉELLEMENT été exécutée ci-dessus, mais une
          // décision concurrente (rejet) a entre-temps gagné la transition
          // d'état — incohérence de fond inhérente au caractère NON
          // transactionnel de ce chemin (dette documentée ci-dessus), pas
          // masquée : message honnête plutôt qu'un succès ou un 409 muet.
          return res.status(409).json({
            erreur:
              "Cette demande a été rejetée entre-temps par une requête concurrente, alors que l'action venait d'être exécutée — vérification manuelle nécessaire.",
          });
        }
        throw e;
      }
      const maj = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id }, include: INCLUDE });
      res.json({ demande: versDTO(maj), message });
    } catch (e) {
      if (e instanceof ErreurAction) {
        await enregistrerErreurSiEncoreEnAttente(prisma, demande.id, e.message);
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

    // Pré-check LÉGER, uniquement pour un 404 honnête si la demande n'existe
    // pas du tout — JAMAIS utilisé comme garantie de concurrence (correctif
    // Round 3, P1-01) : la décision réelle appartient exclusivement à
    // l'écriture conditionnelle atomique ci-dessous
    // (`rejeterDemandeApprobationAtomique`, `services/demandeApprobation.ts`).
    const existe = await prisma.demandeApprobation.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!existe) return res.status(404).json({ erreur: "Demande introuvable" });

    try {
      await rejeterDemandeApprobationAtomique(prisma, req.params.id, {
        id: req.utilisateur!.id,
        nom: req.utilisateur!.nom,
      });
    } catch (e) {
      if (e instanceof ErreurDecisionConcurrente) {
        return res.status(409).json({ erreur: "Cette demande a déjà été traitée" });
      }
      throw e;
    }

    // Relecture APRÈS la réservation réussie et committée : le statut
    // REJETEE est désormais terminal (aucune écriture concurrente, y compris
    // une approbation qui gagnerait la course, ne peut plus le modifier —
    // toutes passent par la même écriture conditionnelle `WHERE statut =
    // 'EN_ATTENTE'`) — aucune fenêtre où cette relecture pourrait exposer un
    // état ensuite écrasé.
    const maj = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: req.params.id }, include: INCLUDE });
    res.json({ demande: versDTO(maj) });
  } catch (e) {
    next(e);
  }
});
