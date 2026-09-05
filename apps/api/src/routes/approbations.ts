import { Router } from "express";
import { Prisma } from "@prisma/client";
import type { DemandeApprobationDTO, StatutDemande, TypeActionCritique } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { ErreurAction } from "../services/actionsCritiques.js";
import { approuverEtExecuterActionMetier } from "../services/actionsCritiquesMetier.js";
import {
  approuverEtAppliquerModificationPermissionsRole,
  ErreurApprobationConcurrente,
  ErreurConflitApprobationReessayable,
} from "../services/permissionsRoleAudit.js";
import {
  enregistrerErreurSiEncoreEnAttente,
  ErreurDecisionConcurrente,
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
    // avoir lieu (ça, c'est l'écriture conditionnelle atomique ci-dessous qui
    // en décide, pour les 5 types).
    const apercu = await prisma.demandeApprobation.findUnique({ where: { id: req.params.id }, select: { type: true } });
    if (!apercu) return res.status(404).json({ erreur: "Demande introuvable" });

    // Correctif P1 (mission « atomicité exécution métier + décision pour les
    // 4 autres approbations », 25/08/2026) : les 5 types d'action critique
    // passent désormais TOUS par le même mécanisme générique atomique —
    // réservation conditionnelle de la demande + exécution métier +
    // transition vers APPROUVEE, LE TOUT dans une seule transaction
    // PostgreSQL Serializable, avec réessai borné sur P2034 (voir
    // `services/demandeApprobation.ts`, `approuverEtExecuterDemandeAtomique`).
    // `MODIFIER_PERMISSIONS_ROLE` (Round 2, contre-revue Codex du 24/08/2026)
    // et les 4 autres types (`SUPPRIMER_UTILISATEUR`, `CREER_COMPTE_ADMIN`,
    // `MODIFIER_TYPE_CLIENT`, `MODIFIER_TAUX_TAXE`, corrigés par cette
    // mission) fournissent chacun leur propre callback d'exécution métier au
    // même mécanisme — l'ancien P1 documenté ici (exécution métier non
    // transactionnelle avec la transition pour ces 4 types) n'existe plus.
    try {
      let message: string;
      if (apercu.type === "MODIFIER_PERMISSIONS_ROLE") {
        const resultat = await approuverEtAppliquerModificationPermissionsRole(prisma, req.params.id, {
          id: req.utilisateur!.id,
          nom: req.utilisateur!.nom,
        });
        message = `Permissions du rôle « ${resultat.roleNom} » mises à jour`;
      } else {
        const resultat = await approuverEtExecuterActionMetier(prisma, req.params.id, {
          id: req.utilisateur!.id,
          nom: req.utilisateur!.nom,
        });
        message = resultat.message;
      }
      const maj = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: req.params.id }, include: INCLUDE });
      return res.json({ demande: versDTO(maj), message });
    } catch (e) {
      if (e instanceof ErreurApprobationConcurrente) {
        return res.status(409).json({ erreur: "Cette demande a déjà été traitée" });
      }
      if (e instanceof ErreurConflitApprobationReessayable) {
        // Distinct du 409 ci-dessus : ici, PERSONNE n'a gagné — un conflit de
        // sérialisation PostgreSQL réel et persistant a empêché de trancher,
        // la demande reste EN_ATTENTE. Un 409 « déjà traitée » serait un
        // mensonge ; 503 signale un état temporaire, réessayable.
        return res.status(503).json({ erreur: e.message });
      }
      if (e instanceof ErreurAction) {
        // La transaction entière (réservation + exécution métier incluses) a
        // été annulée par PostgreSQL : la demande est redevenue EN_ATTENTE,
        // aucune écriture métier partielle ne survit. Cette écriture de
        // suivi (message d'erreur pour l'UI) est délibérément séparée — ce
        // n'est pas une action métier, aucune atomicité requise avec quoi que
        // ce soit d'autre. Conditionnée sur EN_ATTENTE : jamais poser un
        // message d'erreur périmé sur une demande déjà décidée (rejetée)
        // entre-temps par une requête concurrente.
        await enregistrerErreurSiEncoreEnAttente(prisma, req.params.id, e.message);
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
