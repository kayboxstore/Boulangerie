import { Prisma } from "@prisma/client";
import { MODULES } from "@lomoto/shared";
import type { Module, NiveauAcces } from "@lomoto/shared";
import type { prisma as prismaApp, TxClient } from "../lib/prisma.js";
import { contexteRequete } from "../lib/contexteRequete.js";
import { ErreurAction } from "../lib/erreurAction.js";
import { ErreurDecisionConcurrente } from "./demandeApprobation.js";

/**
 * Piste d'audit ET atomicité d'approbation, dédiées à l'action critique
 * `MODIFIER_PERMISSIONS_ROLE` (correctifs P1, contre-revue Codex de l'audit
 * complet du 24/08/2026 — Round 1 : piste d'audit ; Round 2 : métadonnées de
 * traçabilité enrichies + atomicité réservation/exécution/audit/approbation).
 *
 * Round 1 — défaut corrigé : `EXECUTEURS.MODIFIER_PERMISSIONS_ROLE`
 * (`actionsCritiques.ts`) écrit `RolePermission` via `upsert`/`deleteMany`.
 * L'extension Prisma générale d'audit (`lib/audit.ts`) n'intercepte que
 * `update`/`delete` singuliers — jamais `upsert`, jamais `*Many`, jamais
 * `create` — donc aucune de ces écritures n'était journalisée.
 *
 * Round 2 — défaut corrigé : le parcours d'approbation
 * (`routes/approbations.ts`, `POST /:id/approuver`) lisait le statut de la
 * `DemandeApprobation` (`EN_ATTENTE` ?) SÉPARÉMENT de l'exécution de l'action
 * ET de la transition vers `APPROUVEE` — trois écritures/lectures non
 * atomiques entre elles :
 *  (a) deux approbations concurrentes pouvaient toutes deux lire
 *      `EN_ATTENTE` et exécuter l'action deux fois ;
 *  (b) un crash entre l'exécution (permissions + audit déjà committés,
 *      transaction indépendante) et la mise à jour du statut laissait la
 *      demande éternellement `EN_ATTENTE` alors que l'action avait bien eu
 *      lieu — un nouvel essai l'aurait rejouée une seconde fois.
 * Corrigé pour `MODIFIER_PERMISSIONS_ROLE` par
 * `approuverEtAppliquerModificationPermissionsRole` : réservation
 * atomique de la demande (écriture conditionnelle `WHERE statut =
 * 'EN_ATTENTE'`), exécution de l'action, écriture de l'audit et passage à
 * `APPROUVEE` — LE TOUT dans une seule transaction PostgreSQL Serializable.
 * Voir son en-tête pour le détail du mécanisme.
 *
 * P1 restant, explicitement non traité ici (voir rapport de livraison) : les
 * 4 AUTRES types d'action critique (`SUPPRIMER_UTILISATEUR`,
 * `CREER_COMPTE_ADMIN`, `MODIFIER_TYPE_CLIENT`, `MODIFIER_TAUX_TAXE`)
 * continuent de transiter par l'ANCIEN chemin non atomique dans
 * `routes/approbations.ts` — la même course (a)/(b) ci-dessus reste
 * possible pour eux. Une correction générique aurait exigé de rendre les
 * QUATRE autres exécuteurs de `actionsCritiques.ts` « tx-aware » (accepter
 * un client transactionnel déjà ouvert plutôt que d'utiliser chacun leur
 * propre `prisma.$transaction` ou écriture directe) — un refactor plus
 * large, hors du périmètre strict de ce Round 2 (« Deux P1 doivent être
 * corrigés », tous deux scopés à `MODIFIER_PERMISSIONS_ROLE`). Signalé
 * explicitement plutôt que prétendu résolu.
 *
 * Choix de conception (voir contraintes de la mission) :
 *  - AUCUN changement de schéma Prisma : réutilise `AuditLog` (mêmes
 *    colonnes, champs JSON `avant`/`apres`) ET `DemandeApprobation` (mêmes
 *    colonnes : `statut`, `approuveParId`, `dateDecision`, `erreur` déjà
 *    présents) tels quels.
 *  - `lib/audit.ts` (l'extension générale) n'est PAS modifiée.
 *  - Une SEULE ligne `AuditLog` par exécution réussie, portant l'état COMPLET
 *    (10 modules, y compris `AUCUN`) avant/après, trié par ordre alphabétique
 *    de module — déterministe, indépendant de l'ordre de retour PostgreSQL —
 *    PLUS les métadonnées de traçabilité exigées par le Round 2 :
 *    `typeActionCritique`, `modeExecution` (`"DIRECTE"` ou `"APPROBATION"`),
 *    `demandeApprobationId` (corrèle sans ambiguïté deux demandes distinctes
 *    du même utilisateur visant le même rôle), et `demandePar` (le demandeur
 *    d'origine, distinct de l'acteur qui a exécuté/approuvé).
 *  - Transactions imbriquées indépendantes évitées : la logique d'écriture
 *    (`appliquerModificationPermissionsRoleTx`) est une fonction INTERNE
 *    acceptant un client transactionnel déjà ouvert (`TxClient`) — elle
 *    n'ouvre jamais elle-même de transaction. Deux wrappers PUBLICS l'ouvrent
 *    chacun une seule fois : `appliquerModificationPermissionsRole` (exécution
 *    directe par l'Admin Principal) et
 *    `approuverEtAppliquerModificationPermissionsRole` (approbation — qui y
 *    ajoute la réservation atomique et la transition d'état, dans la MÊME
 *    transaction).
 */

export interface EntreePermission {
  module: Module;
  niveauAcces: NiveauAcces;
}

export interface DiffPermissions {
  ajouts: EntreePermission[];
  retraits: EntreePermission[];
  modifications: { module: Module; avant: NiveauAcces; apres: NiveauAcces }[];
}

export interface InstantanePermissionsRole {
  roleId: string;
  roleNom: string;
  permissions: EntreePermission[];
}

export interface IdentiteActeur {
  id: string;
  nom: string;
}

export interface ResultatModificationPermissionsRole {
  roleNom: string;
  avant: EntreePermission[];
  apres: EntreePermission[];
  diff: DiffPermissions;
}

/**
 * Contexte d'exécution de l'action, sous forme d'union discriminée plutôt que
 * de paramètres optionnels indépendants : rend IMPOSSIBLE de représenter un
 * état invalide (ex. `modeExecution = "APPROBATION"` sans `demandeParId`, ou
 * `demandeApprobationId` renseigné en exécution directe).
 */
export type ContexteExecutionAction =
  | { mode: "DIRECTE" }
  | { mode: "APPROBATION"; demandeApprobationId: string; demandePar: IdentiteActeur };

/**
 * Levée quand l'action s'exécute hors contexte de requête authentifiée
 * (`contexteRequete` vide). Sans acteur identifié, aucune piste d'audit
 * fiable n'est possible : l'action entière est refusée plutôt que
 * silencieusement non tracée.
 */
export class ErreurActeurRequisPourAudit extends Error {
  constructor() {
    super(
      "Modification des permissions d'un rôle refusée : aucun acteur authentifié dans le contexte de requête — " +
        "impossible de produire une piste d'audit fiable pour cette action sensible.",
    );
  }
}

/**
 * Levée quand la réservation atomique de la `DemandeApprobation` n'affecte
 * aucune ligne — la demande a RÉELLEMENT déjà été traitée (approuvée,
 * rejetée) par une requête concurrente qui a gagné la course — OU quand,
 * après épuisement des tentatives de réessai sur un P2034 persistant, une
 * relecture RÉELLE (hors de toute transaction avortée) confirme que la
 * demande est bien devenue TERMINALE entre-temps (voir
 * `approuverEtAppliquerModificationPermissionsRole`, correctif Round 4).
 * Mappée en 409 par l'appelant (`routes/approbations.ts`) — jamais affirmée
 * sans cette relecture réelle : voir `ErreurConflitApprobationReessayable`
 * pour le cas distinct où la demande reste `EN_ATTENTE` malgré l'échec.
 *
 * Étend `ErreurDecisionConcurrente` (mécanisme générique,
 * `services/demandeApprobation.ts`) : un `instanceof ErreurDecisionConcurrente`
 * dans le routeur reconnaît donc aussi bien ce cas spécifique à
 * `MODIFIER_PERMISSIONS_ROLE` que le rejet/l'approbation générique des 4
 * autres types — sans rien changer pour le code existant qui teste
 * spécifiquement `instanceof ErreurApprobationConcurrente` (toujours vrai).
 */
export class ErreurApprobationConcurrente extends ErreurDecisionConcurrente {
  constructor() {
    super("Cette demande a déjà été traitée — approuvée, rejetée, ou approuvée par une requête concurrente entre-temps.");
  }
}

/**
 * Levée quand les tentatives de réessai sur un P2034 (conflit de
 * sérialisation PostgreSQL) sont épuisées ALORS QUE la demande, relue
 * RÉELLEMENT hors de toute transaction avortée, est encore `EN_ATTENTE` —
 * correctif Round 4 (contre-revue Codex du 25/08/2026) : distincte
 * d'`ErreurApprobationConcurrente`, qui affirme qu'une AUTRE décision a
 * réellement gagné (constaté par cette même relecture). Ici, personne n'a
 * gagné : c'est un conflit de sérialisation RÉEL et PERSISTANT (contention
 * élevée sur cette ressource, par exemple), pas une décision concurrente
 * terminale — la demande reste traitable, un nouvel essai a de bonnes
 * chances d'aboutir. Mappée en 503 (temporairement indisponible, réessayer)
 * par l'appelant, jamais en 500 brut ni en 409 « déjà traitée » (ce serait
 * un mensonge : l'action n'a PAS été décidée par quelqu'un d'autre).
 */
export class ErreurConflitApprobationReessayable extends Error {
  constructor() {
    super(
      "Conflit de sérialisation PostgreSQL persistant après plusieurs tentatives — la demande est toujours en attente, réessayez.",
    );
  }
}

// Ordre alphabétique fixe, calculé une seule fois : source unique de
// déterminisme pour tous les instantanés et diffs de ce module.
const MODULES_TRIES = [...MODULES].sort() as Module[];

/**
 * Reconstruit l'état COMPLET des permissions d'un rôle : les 10 modules,
 * y compris ceux sans ligne `RolePermission` (implicitement `AUCUN`), triés
 * par ordre alphabétique de module.
 */
async function instantane(tx: TxClient, roleId: string, roleNom: string): Promise<InstantanePermissionsRole> {
  const lignes = await tx.rolePermission.findMany({ where: { roleId }, select: { module: true, niveauAcces: true } });
  const parModule = new Map<string, string>(lignes.map((l) => [l.module, l.niveauAcces]));
  const permissions: EntreePermission[] = MODULES_TRIES.map((module) => ({
    module,
    niveauAcces: (parModule.get(module) ?? "AUCUN") as NiveauAcces,
  }));
  return { roleId, roleNom, permissions };
}

/**
 * Partition déterministe et exhaustive (ajout / retrait / modification),
 * calculée UNIQUEMENT par comparaison des deux instantanés complets — jamais
 * stockée séparément de `avant`/`apres`, toujours dérivable d'eux.
 */
export function calculerDiffPermissions(avant: EntreePermission[], apres: EntreePermission[]): DiffPermissions {
  const avantParModule = new Map(avant.map((p) => [p.module, p.niveauAcces]));
  const apresParModule = new Map(apres.map((p) => [p.module, p.niveauAcces]));
  const diff: DiffPermissions = { ajouts: [], retraits: [], modifications: [] };
  for (const module of MODULES_TRIES) {
    const av = avantParModule.get(module) ?? "AUCUN";
    const ap = apresParModule.get(module) ?? "AUCUN";
    if (av === ap) continue;
    if (av === "AUCUN") diff.ajouts.push({ module, niveauAcces: ap });
    else if (ap === "AUCUN") diff.retraits.push({ module, niveauAcces: av });
    else diff.modifications.push({ module, avant: av, apres: ap });
  }
  return diff;
}

/**
 * Cœur transactionnel : applique la matrice de permissions ET journalise
 * l'opération, en utilisant un client transactionnel DÉJÀ OUVERT (`tx`) —
 * n'ouvre jamais elle-même de transaction (voir l'en-tête du fichier). Lève
 * `ErreurAction(404, ...)` si le rôle a disparu depuis (ex. supprimé entre la
 * création d'une demande d'approbation et son traitement) — vérifié DANS la
 * transaction, donc sans fenêtre de course avec les écritures qui suivent.
 */
async function appliquerModificationPermissionsRoleTx(
  tx: TxClient,
  roleId: string,
  permissions: EntreePermission[],
  contexte: ContexteExecutionAction,
): Promise<ResultatModificationPermissionsRole> {
  const role = await tx.role.findUnique({ where: { id: roleId } });
  if (!role) throw new ErreurAction(404, "Rôle introuvable");

  const avantSnap = await instantane(tx, roleId, role.nom);

  for (const p of permissions) {
    await tx.rolePermission.upsert({
      where: { roleId_module: { roleId, module: p.module } },
      update: { niveauAcces: p.niveauAcces },
      create: { roleId, module: p.module, niveauAcces: p.niveauAcces },
    });
  }
  // Les modules absents de la liste (ou passés à AUCUN) sont retirés —
  // comportement métier inchangé, identique à l'original.
  const gardes = permissions.filter((p) => p.niveauAcces !== "AUCUN").map((p) => p.module);
  await tx.rolePermission.deleteMany({
    where: { roleId, module: { notIn: gardes.length ? gardes : ["CAISSE"] } },
  });
  if (!gardes.length) await tx.rolePermission.deleteMany({ where: { roleId } });

  const apresSnap = await instantane(tx, roleId, role.nom);
  const diff = calculerDiffPermissions(avantSnap.permissions, apresSnap.permissions);

  // Toujours journalisé, même quand `diff` est entièrement vide (aucun
  // changement réel — ex. resoumission exacte de l'état courant) : l'audit
  // enregistre alors fidèlement « cette personne a confirmé cet état à cette
  // date », plutôt que de faire dépendre l'existence d'une trace d'un calcul
  // de no-op. Comportement volontaire, prouvé par un test dédié.
  const acteur = contexteRequete.getStore();
  if (!acteur) throw new ErreurActeurRequisPourAudit();

  await tx.auditLog.create({
    data: {
      utilisateurId: acteur.id,
      utilisateurNom: acteur.nom,
      module: "EQUIPE" as Prisma.AuditLogCreateInput["module"],
      typeEntite: "Role",
      entiteId: roleId,
      action: "MODIFICATION",
      avant: avantSnap as unknown as Prisma.InputJsonValue,
      apres: {
        ...apresSnap,
        typeActionCritique: "MODIFIER_PERMISSIONS_ROLE",
        modeExecution: contexte.mode,
        demandeApprobationId: contexte.mode === "APPROBATION" ? contexte.demandeApprobationId : null,
        demandePar: contexte.mode === "APPROBATION" ? contexte.demandePar : null,
        diff,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return { roleNom: role.nom, avant: avantSnap.permissions, apres: apresSnap.permissions, diff };
}

/**
 * Exécution DIRECTE (Admin Principal, sans workflow d'approbation) : ouvre sa
 * propre transaction Serializable et délègue tout le travail à
 * `appliquerModificationPermissionsRoleTx`. Appelée par
 * `EXECUTEURS.MODIFIER_PERMISSIONS_ROLE` (`actionsCritiques.ts`) — et par
 * `scripts/verifier-audit-permissions-role-ci.ts`, qui l'exerce telle quelle
 * contre une vraie base PostgreSQL (même convention que `services/principal.ts`
 * pour `scripts/verifier-concurrence-equipe-ci.ts` : jamais de
 * réimplémentation parallèle qui pourrait diverger du code de production).
 */
export async function appliquerModificationPermissionsRole(
  db: typeof prismaApp,
  roleId: string,
  permissions: EntreePermission[],
): Promise<ResultatModificationPermissionsRole> {
  return db.$transaction(
    (tx) => appliquerModificationPermissionsRoleTx(tx, roleId, permissions, { mode: "DIRECTE" }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export interface ResultatApprobationPermissionsRole {
  roleNom: string;
  avant: EntreePermission[];
  apres: EntreePermission[];
  diff: DiffPermissions;
  demandeStatut: "APPROUVEE";
  demandeApprouveParId: string;
  demandeDateDecision: Date;
}

/**
 * Réservation atomique + exécution + audit + transition `APPROUVEE`, LE TOUT
 * dans une seule transaction PostgreSQL Serializable (correctif Round 2,
 * P1-02).
 *
 * Mécanisme de réservation : `updateMany({ where: { id, statut:
 * "EN_ATTENTE" }, data: { statut: "APPROUVEE", ... } })` — une écriture
 * CONDITIONNELLE, jamais une pré-lecture séparée (même principe que
 * `services/principal.ts`, déjà établi dans ce dépôt pour le même problème de
 * classe). Sous le verrouillage de ligne PostgreSQL standard :
 *  - Deux approbations concurrentes sur la MÊME demande : la seconde
 *    transaction bloque sur le verrou de ligne jusqu'à ce que la première
 *    committe (ou échoue) ; une fois la première committée, le `WHERE
 *    statut = 'EN_ATTENTE'` de la seconde ne trouve plus rien (déjà
 *    `APPROUVEE`) → `count = 0` → `ErreurApprobationConcurrente` → 409,
 *    sans jamais exécuter l'action une seconde fois.
 *  - `count === 1` : cette transaction a gagné la réservation, seule
 *    habilitée à poursuivre — exécute l'action et écrit l'audit avec le
 *    client transactionnel DÉJÀ OUVERT (jamais une transaction imbriquée
 *    indépendante).
 *  - Si l'exécution de l'action (ou l'écriture d'audit) échoue APRÈS la
 *    réservation, PostgreSQL annule TOUTE la transaction — y compris la
 *    réservation elle-même : la demande redevient `EN_ATTENTE` comme avant
 *    l'appel (jamais d'approbation faussement réussie, jamais d'audit
 *    orphelin).
 *
 * Correctif Round 3, P2-02 — gestion complète de P2034 : sous isolation
 * Serializable, PostgreSQL peut ABORTER la transaction perdante avec une
 * erreur de sérialisation (SQLSTATE 40001, P2034 côté Prisma) à N'IMPORTE
 * QUEL MOMENT de la transaction — pas seulement sur le premier `updateMany`
 * de réservation. Un conflit peut survenir plus tard (l'`upsert`/`deleteMany`
 * de `RolePermission`, par exemple si une AUTRE demande concurrente vise le
 * MÊME rôle) ou même au COMMIT lui-même. La Round 2 ne catchait le P2034
 * qu'autour du premier `updateMany`, ce qui manquait tous les autres cas et
 * les laissait remonter en erreur Prisma brute (500 via le handler générique
 * Express) plutôt qu'en `ErreurApprobationConcurrente` (409). Corrigé en
 * enveloppant l'appel COMPLET à `$transaction` dans une boucle de réessai
 * BORNÉE (`NB_TENTATIVES_MAX_P2034`, jamais infinie) : un P2034, où qu'il
 * survienne, déclenche une TOUTE NOUVELLE transaction (une transaction
 * avortée par PostgreSQL ne peut pas être « reprise » — il faut en rouvrir
 * une) ; au nouvel essai, la réservation conditionnelle re-décide HONNÊTEMENT
 * si la demande est toujours `EN_ATTENTE` (jamais une supposition).
 *
 * Correctif Round 4 (contre-revue Codex du 25/08/2026) — message honnête
 * après épuisement : la Round 3 mappait systématiquement l'épuisement des
 * tentatives en `ErreurApprobationConcurrente` (« déjà traitée »), ce qui
 * pouvait être un MENSONGE — un P2034 persistant (forte contention, par
 * exemple) ne signifie PAS forcément qu'une autre décision a gagné, la
 * demande peut très bien être encore `EN_ATTENTE`. Corrigé en relisant
 * l'état RÉEL de la `DemandeApprobation` (hors de toute transaction
 * avortée) après épuisement : si elle est devenue terminale,
 * `ErreurApprobationConcurrente` (409, une décision a réellement gagné) ;
 * si elle est toujours `EN_ATTENTE`, `ErreurConflitApprobationReessayable`
 * (503, conflit réel mais PERSONNE n'a encore gagné — réessayer a de bonnes
 * chances d'aboutir). Jamais un 500 brut dans les deux cas.
 */
const NB_TENTATIVES_MAX_P2034 = 3;
export interface CrochetsTestApprobation {
  /**
   * Appelé (si fourni) juste AVANT la réservation conditionnelle
   * (`updateMany` sur `DemandeApprobation`) — jamais utilisé en production.
   * Correctif Round 4 (contre-revue Codex du 25/08/2026, P1) : quand CETTE
   * transaction est censée être celle qui se heurte réellement au verrou
   * d'une autre transaction concurrente déjà en cours (le blocage survient
   * PENDANT la réservation elle-même, ex. deux tentatives sur la MÊME
   * `DemandeApprobation`), c'est ICI — et seulement ici, depuis `tx` — que
   * le pid PostgreSQL réel de CETTE transaction doit être capturé, JAMAIS
   * via un `PrismaClient` interrogé séparément avant l'appel : Prisma
   * multiplexe ses requêtes sur un pool de connexions et rien ne garantit
   * qu'une requête hors transaction et la transaction ouverte juste après
   * réutilisent la même connexion physique — un tel pid capturé « avant »
   * peut donc être celui d'une connexion totalement différente de celle qui
   * se bloque réellement, rendant l'observation `pg_blocking_pids` ultérieure
   * non probante. Voir `apresReservationAvantExecution` ci-dessous pour le
   * cas symétrique (blocage survenant APRÈS une réservation qui, elle,
   * réussit sans conflit).
   */
  avantReservation?: (tx: TxClient) => Promise<void>;
  /**
   * Appelé (si fourni) juste après que la réservation a réussi, AVANT la
   * lecture/exécution de l'action — jamais utilisé par la route de
   * production (`routes/approbations.ts` ne le passe jamais). Sert
   * uniquement à `scripts/verifier-audit-permissions-role-ci.ts` pour
   * garantir un chevauchement RÉEL et déterministe avec une seconde
   * tentative concurrente (elle-même lancée DEPUIS ce crochet, sur une
   * connexion séparée) — pas un simple pari sur le hasard du timing de
   * `Promise.allSettled`. Même principe que
   * `CrochetsTestTransfert.apresRetraitAvantAttribution` dans
   * `services/principal.ts`. Reçoit `tx` (le client transactionnel en
   * cours) pour permettre au script d'interroger `pg_backend_pid()` SUR LA
   * CONNEXION RÉELLE de cette transaction — indispensable pour observer
   * ensuite, depuis une troisième connexion, qu'une autre session est
   * RÉELLEMENT bloquée sur CE pid précis (`pg_blocking_pids`), plutôt que de
   * supposer un pid obtenu hors transaction.
   */
  apresReservationAvantExecution?: (tx: TxClient) => Promise<void>;
  /**
   * Appelé (si fourni) juste après que l'action a été exécutée (permissions
   * écrites, audit journalisé) MAIS AVANT que la transaction ne committe —
   * jamais utilisé en production. Correctif Round 3, P2-02 : permet de
   * prouver qu'un conflit de sérialisation PostgreSQL (P2034) survenant
   * APRÈS la réservation — sur l'écriture RolePermission elle-même, pas sur
   * le premier `updateMany` — est lui aussi couvert par le réessai borné
   * (voir plus bas). Même règle : reçoit `tx` pour obtenir le pid réel de
   * cette transaction.
   */
  apresExecutionAvantRetour?: (tx: TxClient) => Promise<void>;
}

export async function approuverEtAppliquerModificationPermissionsRole(
  db: typeof prismaApp,
  demandeApprobationId: string,
  approbateur: IdentiteActeur,
  crochets?: CrochetsTestApprobation,
): Promise<ResultatApprobationPermissionsRole> {
  for (let tentative = 1; tentative <= NB_TENTATIVES_MAX_P2034; tentative++) {
    try {
      // Chaque tentative ouvre une TOUTE NOUVELLE transaction : une
      // transaction PostgreSQL avortée par un P2034 ne peut pas être
      // « reprise » — elle doit être entièrement rejouée, réservation
      // conditionnelle comprise, pour re-décider honnêtement de l'état
      // réellement en vigueur au moment du nouvel essai.
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
          if (demande.type !== "MODIFIER_PERMISSIONS_ROLE") {
            // Ne devrait jamais se produire : l'appelant
            // (routes/approbations.ts) n'aiguille vers cette fonction que
            // pour ce type précis. Garde défensive plutôt qu'une hypothèse
            // silencieuse.
            throw new Error(
              `approuverEtAppliquerModificationPermissionsRole appelée pour un type d'action inattendu : ${demande.type}`,
            );
          }
          const { roleId, permissions } = demande.donnees as unknown as {
            roleId: string;
            permissions: EntreePermission[];
          };

          const resultat = await appliquerModificationPermissionsRoleTx(tx, roleId, permissions, {
            mode: "APPROBATION",
            demandeApprobationId,
            demandePar: demande.demandePar,
          });

          if (crochets?.apresExecutionAvantRetour) {
            await crochets.apresExecutionAvantRetour(tx);
          }

          return {
            roleNom: resultat.roleNom,
            avant: resultat.avant,
            apres: resultat.apres,
            diff: resultat.diff,
            demandeStatut: "APPROUVEE",
            demandeApprouveParId: approbateur.id,
            demandeDateDecision: dateDecision,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      // Sous isolation Serializable, PostgreSQL peut ABORTER la transaction
      // perdante avec une erreur de sérialisation (SQLSTATE 40001, P2034
      // côté Prisma) à N'IMPORTE QUEL MOMENT de la transaction — pas
      // seulement sur le premier `updateMany` de réservation (voir l'en-tête
      // de cette fonction, correctif Round 3 P2-02). D'où l'enveloppe autour
      // de l'appel COMPLET à `$transaction`, pas d'un seul `await` interne.
      const estP2034 = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";
      if (!estP2034) throw e;
      if (tentative < NB_TENTATIVES_MAX_P2034) continue;
      // Tentatives épuisées avec un P2034 persistant : chaque tentative a
      // avorté SA PROPRE transaction (réservation comprise), donc rien ici
      // ne permet de SUPPOSER que la demande a été tranchée par quelqu'un
      // d'autre — correctif Round 4 (contre-revue Codex du 25/08/2026) :
      // relit l'état RÉEL, hors de toute transaction avortée, pour décider
      // honnêtement laquelle des deux erreurs distinctes renvoyer.
      const demandeReelle = await db.demandeApprobation.findUnique({
        where: { id: demandeApprobationId },
        select: { statut: true },
      });
      if (!demandeReelle || demandeReelle.statut !== "EN_ATTENTE") {
        // Devenue terminale (ou introuvable — cas défensif, aucune route ne
        // supprime de DemandeApprobation) : une décision concurrente a
        // RÉELLEMENT gagné pendant nos tentatives.
        throw new ErreurApprobationConcurrente();
      }
      // Toujours EN_ATTENTE malgré l'épuisement des tentatives : conflit de
      // sérialisation RÉEL et PERSISTANT, PAS une décision concurrente
      // gagnante — jamais affirmer « déjà traitée » quand ce n'est pas le
      // cas, et jamais remonter le P2034 brut (500).
      throw new ErreurConflitApprobationReessayable();
    }
  }
  // Inatteignable : la boucle retourne ou lève à chaque itération, et
  // `NB_TENTATIVES_MAX_P2034 >= 1`. Présent uniquement pour satisfaire le
  // vérificateur de type (toutes les branches ne renvoient pas explicitement
  // depuis le corps de la boucle du point de vue du compilateur).
  throw new ErreurApprobationConcurrente();
}
