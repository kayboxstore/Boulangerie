import { Prisma } from "@prisma/client";
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
 *  - `rejeterDemandeApprobationAtomique` / `marquerApprouveeSiEncoreEnAttente`
 *    / `enregistrerErreurSiEncoreEnAttente` : protègent SEULEMENT cette
 *    transition, sans rien connaître de l'exécution métier qui l'entoure.
 *  - `approuverEtExecuterDemandeAtomique` (ajouté mission P1 « atomicité
 *    exécution métier », 25/08/2026) : mécanisme GÉNÉRIQUE qui enveloppe la
 *    réservation conditionnelle, l'exécution métier (fournie par l'appelant)
 *    ET la transition finale vers `APPROUVEE` dans UNE SEULE transaction
 *    PostgreSQL Serializable, avec réessai borné sur P2034 — utilisé par les
 *    5 types d'action critique :
 *     - `MODIFIER_PERMISSIONS_ROLE` (`services/permissionsRoleAudit.ts`,
 *       `approuverEtAppliquerModificationPermissionsRole` — refactorisée pour
 *       déléguer ici, comportement inchangé) ;
 *     - `SUPPRIMER_UTILISATEUR`, `CREER_COMPTE_ADMIN`, `MODIFIER_TYPE_CLIENT`,
 *       `MODIFIER_TAUX_TAXE` (`services/actionsCritiquesMetier.ts`,
 *       `approuverEtExecuterActionMetier` — corrige le P1 documenté ici :
 *       l'exécution métier de ces 4 types est désormais, elle aussi,
 *       ENTIÈREMENT transactionnelle avec la réservation et la transition).
 *    `marquerApprouveeSiEncoreEnAttente` reste utilisée par ailleurs (aucun
 *    appelant de production restant pour les 5 types après ce correctif, mais
 *    conservée : mécanisme générique toujours valide pour un futur type
 *    d'action qui n'aurait pas besoin d'atomicité avec son exécution).
 *
 * Sérialisation de la réservation SEULE (les 3 fonctions à écriture unique
 * ci-dessus) : un simple `UPDATE ... WHERE id = ? AND statut = 'EN_ATTENTE'`
 * sur UNE SEULE ligne se sérialise déjà correctement sous le niveau
 * d'isolation PAR DÉFAUT (Read Committed) grâce au verrouillage de ligne
 * PostgreSQL standard. `approuverEtExecuterDemandeAtomique`, elle, lit et
 * écrit PLUSIEURS entités liées dans la même transaction (réservation +
 * exécution métier) et a donc besoin de Serializable — d'où le réessai borné
 * sur P2034 qu'elle intègre.
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

/**
 * Levée quand la réservation atomique de la `DemandeApprobation` n'affecte
 * aucune ligne — la demande a RÉELLEMENT déjà été traitée (approuvée,
 * rejetée) par une requête concurrente qui a gagné la course — OU quand,
 * après épuisement des tentatives de réessai sur un P2034 persistant, une
 * relecture RÉELLE (hors de toute transaction avortée) confirme que la
 * demande est bien devenue TERMINALE entre-temps. Mappée en 409 par
 * l'appelant (`routes/approbations.ts`) — jamais affirmée sans cette
 * relecture réelle : voir `ErreurConflitApprobationReessayable` pour le cas
 * distinct où la demande reste `EN_ATTENTE` malgré l'échec.
 */
export class ErreurApprobationConcurrente extends ErreurDecisionConcurrente {
  constructor() {
    super("Cette demande a déjà été traitée — approuvée, rejetée, ou approuvée par une requête concurrente entre-temps.");
  }
}

/**
 * Levée quand les tentatives de réessai sur un P2034 (conflit de
 * sérialisation PostgreSQL) sont épuisées ALORS QUE la demande, relue
 * RÉELLEMENT hors de toute transaction avortée, est encore `EN_ATTENTE` :
 * distincte d'`ErreurApprobationConcurrente`, qui affirme qu'une AUTRE
 * décision a réellement gagné (constaté par cette même relecture). Ici,
 * personne n'a gagné : c'est un conflit de sérialisation RÉEL et PERSISTANT
 * (contention élevée sur cette ressource, par exemple), pas une décision
 * concurrente terminale — la demande reste traitable, un nouvel essai a de
 * bonnes chances d'aboutir. Mappée en 503 (temporairement indisponible,
 * réessayer) par l'appelant, jamais en 500 brut ni en 409 « déjà traitée »
 * (ce serait un mensonge : l'action n'a PAS été décidée par quelqu'un
 * d'autre).
 */
export class ErreurConflitApprobationReessayable extends Error {
  constructor() {
    super(
      "Conflit de sérialisation PostgreSQL persistant après plusieurs tentatives — la demande est toujours en attente, réessayez.",
    );
  }
}

type DemandeApprobationAvecDemandeur = Prisma.DemandeApprobationGetPayload<{
  include: { demandePar: { select: { id: true; nom: true } } };
}>;

export interface CrochetsTestApprobationAtomique {
  /**
   * Appelé (si fourni) juste AVANT la réservation conditionnelle
   * (`updateMany` sur `DemandeApprobation`) — jamais utilisé en production.
   * À utiliser quand CETTE transaction est censée être celle qui se heurte
   * réellement au verrou d'une autre transaction concurrente déjà en cours
   * (le blocage survient PENDANT la réservation elle-même) — capture ICI,
   * depuis `tx`, le pid PostgreSQL réel de cette transaction (jamais via un
   * `PrismaClient` interrogé séparément avant l'appel : le pool de
   * connexions de Prisma ne garantit pas la réutilisation de la même
   * connexion physique entre une requête hors transaction et la transaction
   * ouverte juste après).
   */
  avantReservation?: (tx: TxClient) => Promise<void>;
  /**
   * Appelé (si fourni) juste après que la réservation a réussi, AVANT
   * l'exécution métier — jamais utilisé par les routes de production. Sert
   * uniquement aux scripts de vérification PostgreSQL réelle pour garantir un
   * chevauchement RÉEL et déterministe avec une seconde tentative concurrente
   * (elle-même lancée DEPUIS ce crochet, sur une connexion séparée). Reçoit
   * `tx` pour permettre au script d'interroger `pg_backend_pid()` SUR LA
   * CONNEXION RÉELLE de cette transaction.
   */
  apresReservationAvantExecution?: (tx: TxClient) => Promise<void>;
  /**
   * Appelé (si fourni) juste après l'exécution métier (écritures + audit
   * éventuel) MAIS AVANT que la transaction ne committe — jamais utilisé en
   * production. Permet de prouver qu'un conflit de sérialisation PostgreSQL
   * (P2034) survenant APRÈS la réservation — sur l'exécution métier
   * elle-même, pas sur le premier `updateMany` — est lui aussi couvert par le
   * réessai borné.
   */
  apresExecutionAvantRetour?: (tx: TxClient) => Promise<void>;
}

const NB_TENTATIVES_MAX_P2034 = 3;

/**
 * Réservation atomique + exécution métier (fournie par l'appelant) +
 * transition `APPROUVEE`, LE TOUT dans une seule transaction PostgreSQL
 * Serializable, avec réessai borné sur P2034 — mécanisme GÉNÉRIQUE partagé
 * par les 5 types d'action critique (voir l'en-tête du fichier).
 *
 * Mécanisme de réservation : `updateMany({ where: { id, statut:
 * "EN_ATTENTE" }, data: { statut: "APPROUVEE", ... } })` — une écriture
 * CONDITIONNELLE, jamais une pré-lecture séparée. Sous le verrouillage de
 * ligne PostgreSQL standard :
 *  - Deux approbations concurrentes sur la MÊME demande : la seconde
 *    transaction bloque sur le verrou de ligne jusqu'à ce que la première
 *    committe (ou échoue) ; une fois la première committée, le `WHERE statut
 *    = 'EN_ATTENTE'` de la seconde ne trouve plus rien → `count = 0` →
 *    `ErreurApprobationConcurrente` → 409, sans jamais exécuter l'action une
 *    seconde fois.
 *  - `count === 1` : cette transaction a gagné la réservation, seule
 *    habilitée à poursuivre — `executer` reçoit le client transactionnel
 *    DÉJÀ OUVERT (jamais de transaction imbriquée indépendante).
 *  - Si l'exécution métier (fournie par `executer`) échoue APRÈS la
 *    réservation, PostgreSQL annule TOUTE la transaction — y compris la
 *    réservation elle-même : la demande redevient `EN_ATTENTE` comme avant
 *    l'appel.
 *
 * P2034 : sous isolation Serializable, PostgreSQL peut ABORTER la
 * transaction perdante avec une erreur de sérialisation (SQLSTATE 40001,
 * P2034 côté Prisma) à N'IMPORTE QUEL MOMENT de la transaction — pas
 * seulement sur le premier `updateMany` de réservation. D'où l'enveloppe
 * autour de l'appel COMPLET à `$transaction`, avec réessai BORNÉ
 * (`NB_TENTATIVES_MAX_P2034`, jamais infini) : chaque tentative ouvre une
 * TOUTE NOUVELLE transaction (une transaction avortée ne peut pas être
 * « reprise »). Après épuisement, une relecture RÉELLE (hors de toute
 * transaction avortée) décide honnêtement entre `ErreurApprobationConcurrente`
 * (409, une décision a réellement gagné) et `ErreurConflitApprobationReessayable`
 * (503, conflit réel mais personne n'a encore gagné) — jamais un 500 brut, ni
 * une affirmation « déjà traitée » qui serait un mensonge.
 */
export async function approuverEtExecuterDemandeAtomique<T>(
  db: typeof prismaApp,
  demandeApprobationId: string,
  approbateur: IdentiteDecideur,
  executer: (tx: TxClient, demande: DemandeApprobationAvecDemandeur, dateDecision: Date) => Promise<T>,
  crochets?: CrochetsTestApprobationAtomique,
): Promise<T> {
  for (let tentative = 1; tentative <= NB_TENTATIVES_MAX_P2034; tentative++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const dateDecision = new Date();
          if (crochets?.avantReservation) {
            await crochets.avantReservation(tx);
          }
          const reservation = await tx.demandeApprobation.updateMany({
            where: { id: demandeApprobationId, statut: "EN_ATTENTE" },
            data: { statut: "APPROUVEE", approuveParId: approbateur.id, dateDecision, erreur: null },
          });
          if (reservation.count !== 1) throw new ErreurApprobationConcurrente();

          if (crochets?.apresReservationAvantExecution) {
            await crochets.apresReservationAvantExecution(tx);
          }

          const demande = await tx.demandeApprobation.findUniqueOrThrow({
            where: { id: demandeApprobationId },
            include: { demandePar: { select: { id: true, nom: true } } },
          });

          const resultat = await executer(tx, demande, dateDecision);

          if (crochets?.apresExecutionAvantRetour) {
            await crochets.apresExecutionAvantRetour(tx);
          }

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
        throw new ErreurApprobationConcurrente();
      }
      throw new ErreurConflitApprobationReessayable();
    }
  }
  // Inatteignable : la boucle retourne ou lève à chaque itération, et
  // `NB_TENTATIVES_MAX_P2034 >= 1`. Présent uniquement pour satisfaire le
  // vérificateur de type.
  throw new ErreurApprobationConcurrente();
}
