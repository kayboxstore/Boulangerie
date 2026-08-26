import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import type { Request } from "express";
import type { Module, NiveauAcces, ResultatActionCritique, TypeActionCritique } from "@lomoto/shared";
import { prisma, type TxClient } from "../lib/prisma.js";
import { busEvenements } from "../lib/events.js";
import { ErreurAction } from "../lib/erreurAction.js";
import { appliquerModificationPermissionsRole } from "./permissionsRoleAudit.js";
import { ErreurConflitDecisionReessayable, ErreurDecisionConcurrente } from "./demandeApprobation.js";

export { ErreurAction } from "../lib/erreurAction.js";

const ROLE_ADMINISTRATEUR = "Administrateur";
const MAX_COMPTES_ADMIN = 3;

// ---------------------------------------------------------------------------
// Exécuteurs — source unique de vérité pour chaque tâche critique. Rejoués tels
// quels à l'approbation (donc revérifient l'état, qui a pu changer entre-temps).
//
// Les 4 exécuteurs SUPPRIMER_UTILISATEUR / CREER_COMPTE_ADMIN /
// MODIFIER_TYPE_CLIENT / MODIFIER_TAUX_TAXE existent en une seule version
// « tx-aware » (`EXECUTEURS_TX`, accepte un client transactionnel déjà
// ouvert) — jamais dupliquée : l'exécution DIRECTE (`EXECUTEURS`, Admin
// Principal) ouvre sa propre transaction et y délègue tout le travail ;
// l'exécution par APPROBATION (`approuverEtExecuterActionCritique`
// ci-dessous) réutilise la MÊME fonction dans la transaction qui réserve
// déjà la demande — même convention que
// `appliquerModificationPermissionsRoleTx` (`permissionsRoleAudit.ts`).
// MODIFIER_PERMISSIONS_ROLE (5ᵉ type) a son propre mécanisme complet
// (piste d'audit dédiée) et n'entre pas dans ce moule tx-aware générique.
// ---------------------------------------------------------------------------

type Donnees = Record<string, unknown>;
type Executeur = (donnees: Donnees) => Promise<{ message: string }>;
type TypeActionTx = Exclude<TypeActionCritique, "MODIFIER_PERMISSIONS_ROLE">;
type ExecuteurTx = (tx: TxClient, donnees: Donnees) => Promise<{ message: string }>;

const EXECUTEURS_TX: Record<TypeActionTx, ExecuteurTx> = {
  SUPPRIMER_UTILISATEUR: async (tx, { utilisateurId }) => {
    const compte = await tx.utilisateur.findUnique({ where: { id: utilisateurId as string } });
    if (!compte) throw new ErreurAction(404, "Compte introuvable");
    if (compte.estAdminPrincipal) {
      throw new ErreurAction(409, "Transférez d'abord le statut d'Administrateur principal");
    }
    try {
      await tx.utilisateur.delete({ where: { id: compte.id } });
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

  CREER_COMPTE_ADMIN: async (tx, { nom, email, roleId, motDePasseHash, travailleurId }) => {
    const existant = await tx.utilisateur.findUnique({ where: { email: email as string } });
    if (existant) throw new ErreurAction(409, "Un compte utilise déjà cette adresse e-mail");
    const nbAdmins = await tx.utilisateur.count({ where: { role: { nom: ROLE_ADMINISTRATEUR } } });
    if (nbAdmins >= MAX_COMPTES_ADMIN) {
      throw new ErreurAction(409, `Limite atteinte : au plus ${MAX_COMPTES_ADMIN} comptes Administrateur`);
    }
    const compte = await tx.utilisateur.create({
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
    if (travailleurId) await tx.travailleur.update({ where: { id: travailleurId as string }, data: { utilisateurId: compte.id } });
    return { message: `Compte Administrateur « ${compte.nom} » créé` };
  },

  MODIFIER_TYPE_CLIENT: async (tx, { typeClientId, data }) => {
    const d = data as { nom?: string; prixParBac?: number; commissionParBac?: number };
    const existant = await tx.typeClient.findUnique({ where: { id: typeClientId as string } });
    if (!existant) throw new ErreurAction(404, "Qualité introuvable");
    if (d.nom && d.nom !== existant.nom) {
      const doublon = await tx.typeClient.findUnique({ where: { nom: d.nom } });
      if (doublon) throw new ErreurAction(409, "Une qualité porte déjà ce nom");
    }
    const tc = await tx.typeClient.update({ where: { id: existant.id }, data: d });
    return { message: `Qualité « ${tc.nom} » mise à jour` };
  },

  MODIFIER_TAUX_TAXE: async (tx, { produitId, data }) => {
    const existant = await tx.produit.findUnique({ where: { id: produitId as string } });
    if (!existant) throw new ErreurAction(404, "Produit introuvable");
    const produit = await tx.produit.update({
      where: { id: existant.id },
      data: data as Prisma.ProduitUpdateInput,
    });
    return { message: `Produit « ${produit.nom} » — taux de taxe fixé à ${produit.tauxTaxe} %` };
  },
};

/** Rejoue, à l'intérieur d'une transaction DÉJÀ OUVERTE, l'un des 4 exécuteurs tx-aware. */
export function executerActionTx(tx: TxClient, type: TypeActionTx, donnees: Donnees): Promise<{ message: string }> {
  return EXECUTEURS_TX[type](tx, donnees);
}

const EXECUTEURS: Record<TypeActionCritique, Executeur> = {
  SUPPRIMER_UTILISATEUR: (donnees) => prisma.$transaction((tx) => EXECUTEURS_TX.SUPPRIMER_UTILISATEUR(tx, donnees)),
  CREER_COMPTE_ADMIN: (donnees) => prisma.$transaction((tx) => EXECUTEURS_TX.CREER_COMPTE_ADMIN(tx, donnees)),
  MODIFIER_TYPE_CLIENT: (donnees) => prisma.$transaction((tx) => EXECUTEURS_TX.MODIFIER_TYPE_CLIENT(tx, donnees)),
  MODIFIER_TAUX_TAXE: (donnees) => prisma.$transaction((tx) => EXECUTEURS_TX.MODIFIER_TAUX_TAXE(tx, donnees)),

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

/** Rejoue une action critique à partir de son payload (exécution DIRECTE par l'Admin Principal). */
export function executerAction(type: TypeActionCritique, donnees: Donnees): Promise<{ message: string }> {
  return EXECUTEURS[type](donnees);
}

/**
 * Réservation atomique + exécution + transition `APPROUVEE`, LE TOUT dans une
 * seule transaction PostgreSQL Serializable — pour les 4 types d'action
 * critique dont l'exécution est tx-aware (`EXECUTEURS_TX` ci-dessus). Corrige
 * la dette documentée dans `services/demandeApprobation.ts` et
 * `services/permissionsRoleAudit.ts` (rounds précédents) : jusqu'ici,
 * l'exécution métier de ces 4 types et la transition d'état de la
 * `DemandeApprobation` étaient deux écritures SÉPARÉES — une décision
 * concurrente (rejet) pouvait gagner la transition APRÈS que l'action ait
 * réellement eu lieu, laissant une demande affichée REJETEE alors que
 * l'action (ex. suppression de compte) avait pourtant été exécutée.
 *
 * Mécanisme, identique à `approuverEtAppliquerModificationPermissionsRole`
 * (`permissionsRoleAudit.ts`) :
 *  - réservation CONDITIONNELLE (`updateMany({ where: { id, statut:
 *    "EN_ATTENTE" } } })`), jamais une pré-lecture séparée ;
 *  - `count !== 1` → `ErreurDecisionConcurrente`, la transaction avorte
 *    ENTIÈREMENT SANS AVOIR TENTÉ L'ACTION MÉTIER (contrairement à l'ancien
 *    chemin, où l'action pouvait déjà avoir eu lieu avant que la transition
 *    échoue) ;
 *  - `count === 1` : cette transaction a gagné, exécute l'action avec le
 *    client transactionnel DÉJÀ OUVERT (jamais une transaction imbriquée
 *    indépendante) ;
 *  - une erreur métier (`ErreurAction`, ex. 404 « Compte introuvable ») fait
 *    avorter TOUTE la transaction, réservation comprise : la demande
 *    redevient EN_ATTENTE comme avant l'appel ;
 *  - sous Serializable, un P2034 peut survenir à n'importe quel moment de la
 *    transaction (pas seulement la réservation) — réessai borné
 *    (`NB_TENTATIVES_MAX_P2034`), puis relecture RÉELLE de l'état (hors de
 *    toute transaction avortée) pour décider honnêtement entre
 *    `ErreurDecisionConcurrente` (une autre décision a réellement gagné) et
 *    `ErreurConflitDecisionReessayable` (conflit réel mais personne n'a
 *    encore gagné) — jamais un 500 brut, jamais une affirmation fausse.
 */
const NB_TENTATIVES_MAX_P2034 = 3;

export interface IdentiteApprobateur {
  id: string;
  nom: string;
}

export interface CrochetsTestApprobationAction {
  /** Appelé juste AVANT la réservation conditionnelle — jamais en production. */
  avantReservation?: (tx: TxClient) => Promise<void>;
  /** Appelé juste après la réservation réussie, AVANT l'exécution de l'action — jamais en production. */
  apresReservationAvantExecution?: (tx: TxClient) => Promise<void>;
  /** Appelé juste après l'exécution de l'action, AVANT le commit — jamais en production. */
  apresExecutionAvantRetour?: (tx: TxClient) => Promise<void>;
}

export async function approuverEtExecuterActionCritique(
  db: typeof prisma,
  demandeApprobationId: string,
  approbateur: IdentiteApprobateur,
  crochets?: CrochetsTestApprobationAction,
): Promise<{ message: string }> {
  for (let tentative = 1; tentative <= NB_TENTATIVES_MAX_P2034; tentative++) {
    try {
      return await db.$transaction(
        async (tx) => {
          if (crochets?.avantReservation) await crochets.avantReservation(tx);
          const reservation = await tx.demandeApprobation.updateMany({
            where: { id: demandeApprobationId, statut: "EN_ATTENTE" },
            data: { statut: "APPROUVEE", approuveParId: approbateur.id, dateDecision: new Date(), erreur: null },
          });
          if (reservation.count !== 1) throw new ErreurDecisionConcurrente();

          if (crochets?.apresReservationAvantExecution) await crochets.apresReservationAvantExecution(tx);

          const demande = await tx.demandeApprobation.findUniqueOrThrow({ where: { id: demandeApprobationId } });
          const resultat = await executerActionTx(
            tx,
            demande.type as TypeActionTx,
            demande.donnees as Donnees,
          );

          if (crochets?.apresExecutionAvantRetour) await crochets.apresExecutionAvantRetour(tx);

          return resultat;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      const estP2034 = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";
      if (!estP2034) throw e;
      if (tentative < NB_TENTATIVES_MAX_P2034) continue;
      const demandeReelle = await db.demandeApprobation.findUnique({
        where: { id: demandeApprobationId },
        select: { statut: true },
      });
      if (!demandeReelle || demandeReelle.statut !== "EN_ATTENTE") {
        throw new ErreurDecisionConcurrente();
      }
      throw new ErreurConflitDecisionReessayable();
    }
  }
  // Inatteignable : voir le raisonnement identique dans
  // `approuverEtAppliquerModificationPermissionsRole` (permissionsRoleAudit.ts).
  throw new ErreurDecisionConcurrente();
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
