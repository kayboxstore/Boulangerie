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
 * Ce module protège UNIQUEMENT la TRANSITION D'ÉTAT de `DemandeApprobation`
 * elle-même (écriture conditionnelle `WHERE id + statut = 'EN_ATTENTE'`,
 * jamais une pré-lecture séparée) — il n'exécute et ne protège AUCUNE action
 * métier :
 *  - Pour `MODIFIER_PERMISSIONS_ROLE`, l'exécution ET la transition sont déjà
 *    ENTIÈREMENT transactionnelles ensemble
 *    (`services/permissionsRoleAudit.ts`, `approuverEtAppliquerModificationPermissionsRole`).
 *  - Pour les 4 autres types d'action critique (`SUPPRIMER_UTILISATEUR`,
 *    `CREER_COMPTE_ADMIN`, `MODIFIER_TYPE_CLIENT`, `MODIFIER_TAUX_TAXE`),
 *    `marquerApprouveeSiEncoreEnAttente` protège seulement CETTE écriture
 *    finale contre un rejet concurrent déjà gagnant — l'exécution métier qui
 *    la précède dans `routes/approbations.ts` reste, elle, NON
 *    transactionnelle avec cette transition : dette documentée séparément
 *    (voir `permissionsRoleAudit.ts`), non traitée ici. Ne prétend PAS que
 *    tout le système générique d'approbation est corrigé — seule la
 *    transition d'état l'est, pour les 5 types.
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

export interface IdentiteDecideur {
  id: string;
  nom: string;
}

export interface CrochetsTestDecision {
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
    const { count } = await tx.demandeApprobation.updateMany({
      where: { id: demandeApprobationId, statut: "EN_ATTENTE" },
      data: { statut: "REJETEE", approuveParId: rejeteur.id, dateDecision: new Date() },
    });
    if (count !== 1) throw new ErreurDecisionConcurrente();
    if (crochets?.apresReservationAvantCommit) await crochets.apresReservationAvantCommit(tx);
  });
}

/**
 * Transition conditionnelle vers `APPROUVEE`, pour le chemin NON
 * transactionnel des 4 exécuteurs métier restants (voir l'en-tête). Protège
 * seulement CETTE écriture contre un rejet concurrent déjà gagnant.
 */
export async function marquerApprouveeSiEncoreEnAttente(
  db: typeof prismaApp,
  demandeApprobationId: string,
  approbateur: IdentiteDecideur,
): Promise<void> {
  const { count } = await db.demandeApprobation.updateMany({
    where: { id: demandeApprobationId, statut: "EN_ATTENTE" },
    data: { statut: "APPROUVEE", approuveParId: approbateur.id, dateDecision: new Date(), erreur: null },
  });
  if (count !== 1) throw new ErreurDecisionConcurrente();
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
