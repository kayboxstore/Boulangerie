import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import type { Request } from "express";
import type { Module, NiveauAcces, ResultatActionCritique, TypeActionCritique } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { busEvenements } from "../lib/events.js";
import { appliquerModificationPermissionsRole, type IdentiteActeur } from "./permissionsRoleAudit.js";

/** Erreur métier d'une action critique, mappée en statut HTTP par l'appelant. */
export class ErreurAction extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const ROLE_ADMINISTRATEUR = "Administrateur";
const MAX_COMPTES_ADMIN = 3;

// ---------------------------------------------------------------------------
// Exécuteurs — source unique de vérité pour chaque tâche critique. Rejoués tels
// quels à l'approbation (donc revérifient l'état, qui a pu changer entre-temps).
// ---------------------------------------------------------------------------

type Donnees = Record<string, unknown>;
// `demandePar` : identité du demandeur d'origine quand l'exécution provient
// de l'approbation d'une `DemandeApprobation` (Admin secondaire), `null`/absent
// en exécution directe par l'Admin Principal. Seul `MODIFIER_PERMISSIONS_ROLE`
// l'exploite pour l'instant (voir `permissionsRoleAudit.ts`) ; les autres
// exécuteurs, à un seul paramètre, restent valides sans modification (une
// fonction déclarant moins de paramètres que le type `Executeur` reste
// assignable à ce type).
type Executeur = (donnees: Donnees, demandePar?: IdentiteActeur | null) => Promise<{ message: string }>;

const EXECUTEURS: Record<TypeActionCritique, Executeur> = {
  SUPPRIMER_UTILISATEUR: async ({ utilisateurId }) => {
    const compte = await prisma.utilisateur.findUnique({ where: { id: utilisateurId as string } });
    if (!compte) throw new ErreurAction(404, "Compte introuvable");
    if (compte.estAdminPrincipal) {
      throw new ErreurAction(409, "Transférez d'abord le statut d'Administrateur principal");
    }
    try {
      await prisma.utilisateur.delete({ where: { id: compte.id } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new ErreurAction(
          409,
          "Suppression impossible : ce compte a de l'activité enregistrée (ventes, commandes…).",
        );
      }
      throw e;
    }
    return { message: `Compte « ${compte.nom} » supprimé` };
  },

  CREER_COMPTE_ADMIN: async ({ nom, email, roleId, motDePasseHash, travailleurId }) => {
    const existant = await prisma.utilisateur.findUnique({ where: { email: email as string } });
    if (existant) throw new ErreurAction(409, "Un compte utilise déjà cette adresse e-mail");
    const nbAdmins = await prisma.utilisateur.count({ where: { role: { nom: ROLE_ADMINISTRATEUR } } });
    if (nbAdmins >= MAX_COMPTES_ADMIN) {
      throw new ErreurAction(409, `Limite atteinte : au plus ${MAX_COMPTES_ADMIN} comptes Administrateur`);
    }
    const compte = await prisma.$transaction(async (tx) => {
      const c = await tx.utilisateur.create({
        data: {
          nom: nom as string,
          email: email as string,
          roleId: roleId as string,
          motDePasseHash: motDePasseHash as string,
          motDePasseDoitChanger: true,
        },
      });
      // Identifiant de connexion issu de Travailleurs (section 3.7) : la fiche
      // d'origine reste liée au compte qu'elle vient de générer.
      if (travailleurId) await tx.travailleur.update({ where: { id: travailleurId as string }, data: { utilisateurId: c.id } });
      return c;
    });
    return { message: `Compte Administrateur « ${compte.nom} » créé` };
  },

  MODIFIER_TYPE_CLIENT: async ({ typeClientId, data }) => {
    const d = data as { nom?: string; prixParBac?: number; commissionParBac?: number };
    const existant = await prisma.typeClient.findUnique({ where: { id: typeClientId as string } });
    if (!existant) throw new ErreurAction(404, "Qualité introuvable");
    if (d.nom && d.nom !== existant.nom) {
      const doublon = await prisma.typeClient.findUnique({ where: { nom: d.nom } });
      if (doublon) throw new ErreurAction(409, "Une qualité porte déjà ce nom");
    }
    const tc = await prisma.typeClient.update({ where: { id: existant.id }, data: d });
    return { message: `Qualité « ${tc.nom} » mise à jour` };
  },

  MODIFIER_TAUX_TAXE: async ({ produitId, data }) => {
    const existant = await prisma.produit.findUnique({ where: { id: produitId as string } });
    if (!existant) throw new ErreurAction(404, "Produit introuvable");
    const produit = await prisma.produit.update({
      where: { id: existant.id },
      data: data as Prisma.ProduitUpdateInput,
    });
    return { message: `Produit « ${produit.nom} » — taux de taxe fixé à ${produit.tauxTaxe} %` };
  },

  // Correctif P1 (contre-revue Codex, audit du 24/08/2026) : les écritures
  // `RolePermission` restent des `upsert`/`deleteMany` inchangés (comportement
  // métier préservé à l'identique) ; c'est désormais
  // `appliquerModificationPermissionsRole` qui les enveloppe dans UNE SEULE
  // transaction Serializable avec une piste d'audit explicite, complète et
  // déterministe — voir `services/permissionsRoleAudit.ts` pour le détail
  // et la justification du défaut corrigé.
  MODIFIER_PERMISSIONS_ROLE: async ({ roleId, permissions }, demandePar) => {
    const role = await prisma.role.findUnique({ where: { id: roleId as string } });
    if (!role) throw new ErreurAction(404, "Rôle introuvable");
    const perms = permissions as { module: Module; niveauAcces: NiveauAcces }[];
    const { roleNom } = await appliquerModificationPermissionsRole(prisma, role.id, perms, demandePar ?? null);
    return { message: `Permissions du rôle « ${roleNom} » mises à jour` };
  },
};

/** Rejoue une action critique à partir de son payload (utilisé à l'approbation). */
export function executerAction(
  type: TypeActionCritique,
  donnees: Donnees,
  demandePar?: IdentiteActeur | null,
): Promise<{ message: string }> {
  return EXECUTEURS[type](donnees, demandePar);
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
