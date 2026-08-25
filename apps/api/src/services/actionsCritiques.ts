import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import type { Request } from "express";
import type { Module, NiveauAcces, ResultatActionCritique, TypeActionCritique } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { busEvenements } from "../lib/events.js";
import { ErreurAction } from "../lib/erreurAction.js";
import { appliquerModificationPermissionsRole } from "./permissionsRoleAudit.js";
import {
  creerCompteAdminDirect,
  modifierTauxTaxeDirect,
  modifierTypeClientDirect,
  supprimerUtilisateurDirect,
  type DonneesCreerCompteAdmin,
  type DonneesModifierTypeClient,
} from "./actionsCritiquesMetier.js";

export { ErreurAction } from "../lib/erreurAction.js";

// ---------------------------------------------------------------------------
// Exécuteurs — source unique de vérité pour chaque tâche critique. Rejoués tels
// quels à l'approbation (donc revérifient l'état, qui a pu changer entre-temps).
//
// SUPPRIMER_UTILISATEUR, CREER_COMPTE_ADMIN, MODIFIER_TYPE_CLIENT et
// MODIFIER_TAUX_TAXE (mission P1 « atomicité exécution métier », 25/08/2026) :
// délèguent désormais aux wrappers « Direct » de `actionsCritiquesMetier.ts`,
// qui ouvrent chacun leur propre transaction Serializable et appellent la
// MÊME fonction tx-aware que le chemin d'approbation
// (`approuverEtExecuterActionMetier`, appelée par `routes/approbations.ts`)
// — exigence #8 de la mission : le chemin direct de l'Admin Principal utilise
// le même code métier, sans changement du contrat HTTP de ce fichier
// (`executerAction`/`traiterActionCritique` inchangés pour leurs appelants).
// ---------------------------------------------------------------------------

type Donnees = Record<string, unknown>;
type Executeur = (donnees: Donnees) => Promise<{ message: string }>;

const EXECUTEURS: Record<TypeActionCritique, Executeur> = {
  SUPPRIMER_UTILISATEUR: ({ utilisateurId }) => supprimerUtilisateurDirect(prisma, utilisateurId as string),

  CREER_COMPTE_ADMIN: (donnees) => creerCompteAdminDirect(prisma, donnees as unknown as DonneesCreerCompteAdmin),

  MODIFIER_TYPE_CLIENT: ({ typeClientId, data }) =>
    modifierTypeClientDirect(prisma, typeClientId as string, data as DonneesModifierTypeClient),

  MODIFIER_TAUX_TAXE: ({ produitId, data }) =>
    modifierTauxTaxeDirect(prisma, produitId as string, data as Prisma.ProduitUpdateManyMutationInput),

  // Correctif P1 (contre-revue Codex, audit du 24/08/2026 — Round 1 et 2) :
  // les écritures `RolePermission` restent des `upsert`/`deleteMany`
  // inchangés (comportement métier préservé à l'identique) ; c'est désormais
  // `appliquerModificationPermissionsRole` qui les enveloppe dans UNE SEULE
  // transaction Serializable avec une piste d'audit explicite, complète et
  // déterministe (y compris le 404 « Rôle introuvable », vérifié DANS la
  // transaction — plus de pré-lecture séparée ici) — voir
  // `services/permissionsRoleAudit.ts` pour le détail. Ce chemin ne sert que
  // l'exécution DIRECTE par l'Admin Principal ; l'approbation d'une demande
  // différée passe par `approuverEtAppliquerModificationPermissionsRole`,
  // appelée directement par `routes/approbations.ts` (atomicité
  // réservation+exécution+audit+transition, Round 2, P1-02).
  MODIFIER_PERMISSIONS_ROLE: async ({ roleId, permissions }) => {
    const perms = permissions as { module: Module; niveauAcces: NiveauAcces }[];
    const { roleNom } = await appliquerModificationPermissionsRole(prisma, roleId as string, perms);
    return { message: `Permissions du rôle « ${roleNom} » mises à jour` };
  },
};

/** Rejoue une action critique à partir de son payload (utilisé à l'approbation des 4 autres types). */
export function executerAction(type: TypeActionCritique, donnees: Donnees): Promise<{ message: string }> {
  return EXECUTEURS[type](donnees);
}

/**
 * Aiguillage direct vs différé (section 2/3.16) :
 *  - Admin Principal → l'action s'exécute immédiatement (pas d'auto-approbation) ;
 *  - Admin secondaire → l'action est mise en attente (DemandeApprobation) et
 *    l'Admin Principal est notifié en temps réel.
 * Retourne le statut HTTP et le corps à renvoyer.
 */
export async function traiterActionCritique(
  req: Request,
  type: TypeActionCritique,
  donnees: Donnees,
  resume: string,
): Promise<{ http: number; body: ResultatActionCritique | { erreur: string } }> {
  const auteur = req.utilisateur!;

  if (auteur.estAdminPrincipal) {
    try {
      const { message } = await executerAction(type, donnees);
      return { http: 200, body: { statut: "execute", message } };
    } catch (e) {
      if (e instanceof ErreurAction) return { http: e.status, body: { erreur: e.message } };
      throw e;
    }
  }

  // Admin secondaire → demande d'approbation + notification à l'Admin Principal.
  const demande = await prisma.demandeApprobation.create({
    data: { type, donnees: donnees as Prisma.InputJsonValue, resume, demandeParId: auteur.id },
  });
  const principal = await prisma.utilisateur.findFirst({
    where: { estAdminPrincipal: true },
    select: { id: true },
  });
  busEvenements.emettreEvenement({
    type: "DEMANDE_APPROBATION",
    module: "EQUIPE",
    emetteurId: auteur.id,
    evenementRef: demande.id,
    priorite: "HAUTE",
    destinataireIdsDirects: principal ? [principal.id] : [],
    message: `Demande d'approbation — ${auteur.nom} souhaite : ${resume}`,
    donnees: { demandeId: demande.id, type },
  });

  return {
    http: 202,
    body: {
      statut: "en_attente_approbation",
      message: `Action soumise à l'approbation de l'Administrateur principal — ${resume}`,
    },
  };
}
