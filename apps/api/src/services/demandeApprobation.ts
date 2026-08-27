import type { prisma as prismaApp, TxClient } from "../lib/prisma.js";

/**
 * Mécanisme GÉNÉRIQUE de transition atomique de `DemandeApprobation`, valable
 * pour les 5 types d'action critique (correctif P1-01, Round 3, contre-revue
 * Codex du 24/08/2026).
 *
 * Défaut corrigé : `POST /:id/rejeter` (`routes/approbations.ts`) faisait une
 * pré-lecture du statut `EN_ATTENTE` puis un `update` INCONDITIONNEL — course
 * possible avec une approbation concurrente :
 *  1. Le rejet lit la demande encore `EN_ATTENTE`.
 *  2. L'approbation réserve la demande, applique les permissions, écrit
 *     l'AuditLog et committe `APPROUVEE`.
 *  3. Le rejet reprend ensuite et remplace le statut par `REJETEE` —
 *     ÉCRASANT une décision déjà terminale, alors que l'action a
 *     RÉELLEMENT été exécutée et auditée. Résultat incohérent : demande
 *     affichée comme rejetée alors que les permissions ont été appliquées.
 *
 * Ce module protège la TRANSITION D'ÉTAT de `DemandeApprobation` elle-même
 * (écriture conditionnelle `WHERE id + statut = 'EN_ATTENTE'`, jamais une
 * pré-lecture séparée) :
 *  - Pour `MODIFIER_PERMISSIONS_ROLE`, l'exécution ET la transition sont
 *    ENTIÈREMENT transactionnelles ensemble
 *    (`services/permissionsRoleAudit.ts`, `approuverEtAppliquerModificationPermissionsRole`).
 *  - Pour les 4 autres types d'action critique (`SUPPRIMER_UTILISATEUR`,
 *    `CREER_COMPTE_ADMIN`, `MODIFIER_TYPE_CLIENT`, `MODIFIER_TAUX_TAXE`),
 *    même mécanisme désormais : `services/actionsCritiques.ts`,
 *    `approuverEtExecuterActionCritique` réserve la demande PUIS exécute
 *    l'action, dans la MÊME transaction Serializable — la dette documentée
 *    dans les rounds précédents (exécution non transactionnelle avec la
 *    transition) est corrigée. `ErreurConflitDecisionReessayable` ci-dessous
 *    est l'équivalent générique d'`ErreurConflitApprobationReessayable`
 *    (`permissionsRoleAudit.ts`), utilisé par ce nouveau chemin.
 *
 * Sérialisation : un simple `UPDATE ... WHERE id = ? AND statut = 'EN_ATTENTE'`
 * sur UNE SEULE ligne se sérialise déjà correctement sous le niveau
 * d'isolation PAR DÉFAUT (Read Committed) grâce au verrouillage de ligne
 * PostgreSQL standard — deux écritures concurrentes sur la même ligne
 * s'ordonnent au niveau du verrou, la seconde réévaluant son `WHERE` contre
 * l'état réellement committé par la première. Aucune transaction Serializable
 * explicite n'est donc nécessaire ici (contrairement à
 * `approuverEtAppliquerModificationPermissionsRole`, qui lit et écrit
 * PLUSIEURS entités liées dans la même transaction et a besoin de
 * Serializable pour cette raison) — et donc aucun risque de P2034 sur ces
 * fonctions.
 */

export class ErreurDecisionConcurrente extends Error {
  constructor(
    message = "Cette demande a déjà été traitée — approuvée, rejetée, ou décidée par une requête concurrente entre-temps.",
  ) {
    super(message);
  }
}

/**
 * Levée par `approuverEtExecuterActionCritique` (`actionsCritiques.ts`)
 * quand les tentatives de réessai sur un P2034 (conflit de sérialisation
 * PostgreSQL) sont épuisées ALORS QUE la demande, relue RÉELLEMENT hors de
 * toute transaction avortée, est encore `EN_ATTENTE` — même distinction
 * qu'`ErreurConflitApprobationReessayable` (`permissionsRoleAudit.ts`) :
 * personne n'a gagné, c'est un conflit de sérialisation réel et persistant,
 * pas une décision concurrente terminale. Mappée en 503 par l'appelant,
 * jamais en 500 brut ni en 409 « déjà traitée ».
 */
export class ErreurConflitDecisionReessayable extends Error {
  constructor() {
    super("Conflit de sérialisation PostgreSQL persistant après plusieurs tentatives — la demande est toujours en attente, réessayez.");
  }
}

export interface IdentiteDecideur {
  id: string;
  nom: string;
}

export interface CrochetsTestDecision {
  /**
   * Appelé (si fourni) juste AVANT la réservation conditionnelle
   * (`updateMany`) — jamais utilisé en production. Correctif Round 4
   * (contre-revue Codex du 25/08/2026, P1) : à utiliser quand CETTE
   * transaction est censée se heurter réellement au verrou d'une autre
   * transaction déjà en cours (blocage PENDANT la réservation elle-même) —
   * capture le pid PostgreSQL réel de CETTE transaction depuis `tx`, jamais
   * via un `PrismaClient` interrogé séparément avant l'appel (le pool de
   * connexions de Prisma ne garantit pas la réutilisation de la même
   * connexion physique entre une requête hors transaction et la transaction
   * ouverte juste après).
   */
  avantReservation?: (tx: TxClient) => Promise<void>;
  /**
   * Appelé (si fourni) juste après que la réservation a réussi, AVANT le
   * commit — jamais utilisé par les routes de production. Sert uniquement
   * aux scripts de vérification PostgreSQL réelle pour garantir un
   * chevauchement RÉEL et observé (pas un pari sur le hasard du timing) avec
   * une décision concurrente. Même principe que `CrochetsTestApprobation`
   * dans `permissionsRoleAudit.ts`. Reçoit `tx` (le client transactionnel en
   * cours), pour permettre d'obtenir le pid PostgreSQL RÉEL de cette
   * transaction (`SELECT pg_backend_pid()`) — indispensable pour observer
   * ensuite, depuis une troisième connexion, qu'une décision concurrente est
   * RÉELLEMENT bloquée sur CE pid précis (`pg_blocking_pids`).
   */
  apresReservationAvantCommit?: (tx: TxClient) => Promise<void>;
}

/**
 * Rejette atomiquement une demande, QUEL QUE SOIT son type d'action
 * critique. Enveloppée dans une transaction uniquement pour offrir un point
 * d'ancrage de test (`crochets`) — un `updateMany` conditionnel seul,
 * hors transaction explicite, aurait un comportement de production identique
 * (chaque instruction Prisma autonome s'exécute déjà dans sa propre
 * transaction implicite PostgreSQL).
 */
export async function rejeterDemandeApprobationAtomique(
  db: typeof prismaApp,
  demandeApprobationId: string,
  rejeteur: IdentiteDecideur,
  crochets?: CrochetsTestDecision,
): Promise<void> {
  await db.$transaction(async (tx) => {
    if (crochets?.avantReservation) await crochets.avantReservation(tx);
    const { count } = await tx.demandeApprobation.updateMany({
      where: { id: demandeApprobationId, statut: "EN_ATTENTE" },
      data: { statut: "REJETEE", approuveParId: rejeteur.id, dateDecision: new Date() },
    });
    if (count !== 1) throw new ErreurDecisionConcurrente();
    if (crochets?.apresReservationAvantCommit) await crochets.apresReservationAvantCommit(tx);
  });
}

/**
 * Écrit le champ `erreur` d'une demande UNIQUEMENT si elle est encore
 * `EN_ATTENTE` — jamais sur une demande déjà décidée (`APPROUVEE` ou
 * `REJETEE`) par une requête concurrente entre-temps, pour ne jamais faire
 * apparaître un message d'erreur périmé sur une décision déjà terminale.
 * Silencieuse si la demande n'est plus `EN_ATTENTE` (rien à corriger dans ce
 * cas — la décision terminale prime).
 */
export async function enregistrerErreurSiEncoreEnAttente(
  db: typeof prismaApp,
  demandeApprobationId: string,
  message: string,
): Promise<void> {
  await db.demandeApprobation.updateMany({
    where: { id: demandeApprobationId, statut: "EN_ATTENTE" },
    data: { erreur: message },
  });
}
