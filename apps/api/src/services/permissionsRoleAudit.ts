import { Prisma } from "@prisma/client";
import { MODULES } from "@lomoto/shared";
import type { Module, NiveauAcces } from "@lomoto/shared";
import type { prisma as prismaApp, TxClient } from "../lib/prisma.js";
import { contexteRequete } from "../lib/contexteRequete.js";
import { ErreurAction } from "../lib/erreurAction.js";
import {
  approuverEtExecuterDemandeAtomique,
  ErreurApprobationConcurrente,
  ErreurConflitApprobationReessayable,
  type CrochetsTestApprobationAtomique,
} from "./demandeApprobation.js";

// Ré-exportées pour compatibilité : ces deux classes ont été rendues
// GÉNÉRIQUES (mission P1 « atomicité exécution métier », 25/08/2026) et
// déplacées dans `demandeApprobation.ts`, d'où `approuverEtExecuterActionMetier`
// (`services/actionsCritiquesMetier.ts`) les importe aussi désormais — mais
// tout le code existant (`routes/approbations.ts`, les tests) continue de les
// importer d'ICI sans aucun changement.
export { ErreurApprobationConcurrente, ErreurConflitApprobationReessayable };

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
 * P1 des 4 AUTRES types d'action critique — CORRIGÉ (mission « atomicité
 * exécution métier + décision pour les 4 autres approbations », 25/08/2026) :
 * au moment du Round 2 ci-dessus, `SUPPRIMER_UTILISATEUR`,
 * `CREER_COMPTE_ADMIN`, `MODIFIER_TYPE_CLIENT` et `MODIFIER_TAUX_TAXE`
 * continuaient de transiter par un chemin non atomique dans
 * `routes/approbations.ts` — la même course (a)/(b) ci-dessus restait
 * possible pour eux. Corrigé en rendant les QUATRE exécuteurs
 * « tx-aware » (`services/actionsCritiquesMetier.ts` : `supprimerUtilisateurTx`,
 * `creerCompteAdminTx`, `modifierTypeClientTx`, `modifierTauxTaxeTx`),
 * réutilisant le même mécanisme générique que ci-dessous — désormais extrait
 * dans `services/demandeApprobation.ts`
 * (`approuverEtExecuterDemandeAtomique`), dont
 * `approuverEtAppliquerModificationPermissionsRole` elle-même délègue
 * maintenant l'essentiel (voir plus bas).
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

// `ErreurApprobationConcurrente` et `ErreurConflitApprobationReessayable`
// sont désormais définies et exportées par `demandeApprobation.ts` (mécanisme
// générique, mission P1 du 25/08/2026) — importées et ré-exportées en tête de
// ce fichier pour compatibilité totale avec le code existant.

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
 *
 * Mission P1 « atomicité exécution métier » (25/08/2026) : le mécanisme de
 * réservation + réessai borné P2034 ci-dessus (jusqu'ici dupliqué ici) a été
 * extrait en une fonction GÉNÉRIQUE, `approuverEtExecuterDemandeAtomique`
 * (`services/demandeApprobation.ts`), désormais partagée avec les 4 autres
 * types d'action critique (`services/actionsCritiquesMetier.ts`). Cette
 * fonction ne fait plus que fournir le callback d'exécution métier propre à
 * `MODIFIER_PERMISSIONS_ROLE` — comportement observable strictement
 * inchangé (mêmes erreurs, mêmes crochets de test, même isolation
 * Serializable, même réessai borné à 3 tentatives).
 */
export type CrochetsTestApprobation = CrochetsTestApprobationAtomique;

export async function approuverEtAppliquerModificationPermissionsRole(
  db: typeof prismaApp,
  demandeApprobationId: string,
  approbateur: IdentiteActeur,
  crochets?: CrochetsTestApprobation,
): Promise<ResultatApprobationPermissionsRole> {
  return approuverEtExecuterDemandeAtomique(db, demandeApprobationId, approbateur, async (tx, demande, dateDecision) => {
    if (demande.type !== "MODIFIER_PERMISSIONS_ROLE") {
      // Ne devrait jamais se produire : l'appelant (routes/approbations.ts)
      // n'aiguille vers cette fonction que pour ce type précis. Garde
      // défensive plutôt qu'une hypothèse silencieuse.
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

    return {
      roleNom: resultat.roleNom,
      avant: resultat.avant,
      apres: resultat.apres,
      diff: resultat.diff,
      demandeStatut: "APPROUVEE" as const,
      demandeApprouveParId: approbateur.id,
      demandeDateDecision: dateDecision,
    };
  }, crochets);
}
