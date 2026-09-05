/**
 * Vérification CI, contre une VRAIE base PostgreSQL éphémère, des correctifs
 * P1 « piste d'audit et atomicité d'approbation de MODIFIER_PERMISSIONS_ROLE »
 * (contre-revue Codex de l'audit complet du 24/08/2026 — Round 1 : piste
 * d'audit ; Round 2 : métadonnées enrichies + atomicité du parcours
 * d'approbation).
 *
 * `apps/api/src/services/permissionsRoleAudit.test.ts` prouve déjà la LOGIQUE
 * (mockée) : quelles écritures ont lieu, dans quel ordre, avec quel contenu,
 * et une simulation structurelle du tout-ou-rien. Un mock ne peut PAS prouver :
 *  (a) un vrai ROLLBACK PostgreSQL — `$transaction` y est un simple appel de
 *      fonction avec copie manuelle d'état, jamais un vrai moteur
 *      transactionnel ;
 *  (b) une vraie CONCURRENCE — deux connexions Prisma séparées, un vrai
 *      verrou de ligne PostgreSQL, un vrai blocage/déblocage.
 * Seule une vraie base peut prouver que :
 *  (1) un échec d'écriture de permission annule RÉELLEMENT toute la
 *      transaction, y compris les écritures déjà appliquées plus tôt dans la
 *      MÊME transaction (scénario 6) ;
 *  (2) un échec de l'écriture d'audit annule RÉELLEMENT toutes les écritures
 *      de permission déjà appliquées (scénario 7) ;
 *  (3) deux approbations RÉELLEMENT concurrentes — blocage RÉELLEMENT
 *      observé depuis une troisième connexion (`pg_blocking_pids`), jamais
 *      un délai arbitraire — sur la même demande produisent exactement un
 *      succès et un rejet contrôlé, sans double exécution ni doublon
 *      d'audit (scénario 10) ;
 *  (4) un échec injecté APRÈS la réservation atomique de la demande annule
 *      RÉELLEMENT la réservation elle-même (la demande redevient EN_ATTENTE),
 *      en plus des permissions et de l'audit (scénario 14).
 * Round 3 (correctifs P1-01, P1-02, P2-02, contre-revue Codex du 24/08/2026)
 * ajoute la preuve, contre la même vraie base, que :
 *  (5) une approbation et un rejet RÉELLEMENT concurrents sur la même
 *      demande se départagent de façon atomique dans les DEUX ordres — quand
 *      l'approbation réserve en premier, le rejet concurrent échoue sans
 *      jamais écraser la décision APPROUVEE (scénario 11) ; quand c'est le
 *      rejet qui réserve en premier, l'approbation concurrente échoue SANS
 *      JAMAIS exécuter l'action (scénario 12) ;
 *  (6) un conflit de sérialisation PostgreSQL RÉEL (P2034) survenant APRÈS
 *      la réservation — sur l'écriture RolePermission elle-même, pas sur le
 *      premier `updateMany` — déclenche un réessai RÉEL (nouvelle
 *      transaction rouverte), jamais un 500 brut, jamais de doublon d'audit
 *      (scénario 13).
 * Toutes les preuves de concurrence (scénarios 10 à 13) reposent désormais
 * sur une observation RÉELLE du verrou PostgreSQL en jeu, depuis une
 * troisième connexion (`pg_blocking_pids`), et non plus sur un délai
 * arbitraire après lancement de la transaction concurrente — voir
 * `pidDeLaTransaction` / `attendreBlocageReel` ci-dessous.
 *
 * Round 4 (contre-revue Codex du 25/08/2026, P1) — défaut corrigé : le pid du
 * participant B (ou du rejet/de l'approbation concurrente) était obtenu via
 * `pidDeLaTransaction(clientB)` **avant** l'ouverture de sa propre
 * transaction — un `PrismaClient` multiplexe ses requêtes sur un pool de
 * connexions et rien ne garantit qu'une requête hors transaction et la
 * transaction ouverte juste après réutilisent la MÊME connexion physique.
 * Le pid observé pouvait donc désigner une connexion totalement différente
 * de celle réellement bloquée, rendant l'observation `pg_blocking_pids`
 * ultérieure non probante (elle pouvait passer même si aucun conflit réel
 * n'affectait la connexion observée). Corrigé en capturant chaque pid
 * EXCLUSIVEMENT depuis le client transactionnel `tx` de la transaction
 * réellement susceptible de se bloquer — via de nouveaux crochets de test
 * `avantReservation` (`permissionsRoleAudit.ts`, `demandeApprobation.ts`),
 * déclenchés juste avant la réservation conditionnelle pour les scénarios
 * 10-12 (le blocage y survient PENDANT la réservation elle-même), et via le
 * crochet existant `apresReservationAvantExecution` de B pour le scénario 13
 * (le blocage y survient APRÈS une réservation qui, elle, réussit sans
 * conflit — sur l'écriture RolePermission qui suit). Chaque capture est
 * synchronisée avec le reste du scénario par une barrière déterministe
 * (`Promise` résolue explicitement depuis le crochet), jamais par un délai :
 * le scénario n'avance vers `attendreBlocageReel` qu'une fois le pid
 * RÉELLEMENT capturé depuis la transaction concernée.
 * C'est l'objet de ce script — il exerce EXACTEMENT le code de production,
 * `appliquerModificationPermissionsRole`,
 * `approuverEtAppliquerModificationPermissionsRole` et
 * `rejeterDemandeApprobationAtomique`, importées telles quelles depuis
 * `apps/api/src/services/permissionsRoleAudit.js` et
 * `apps/api/src/services/demandeApprobation.js` (jamais réimplémentées ici).
 *
 * SÉCURITÉ : même garde que les scripts P0-01 — `verifierEnvironnementIntegrationCI`
 * (réutilisée telle quelle, pas dupliquée) exige simultanément un hôte local,
 * le nom de base EXACT `lomoto_ci`, et la confirmation explicite propre à
 * cette famille de scripts. Voir `scripts/garde-integration-ci.ts`.
 *
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-audit-permissions-role-ci.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  appliquerModificationPermissionsRole,
  approuverEtAppliquerModificationPermissionsRole,
  ErreurActeurRequisPourAudit,
  ErreurApprobationConcurrente,
  type EntreePermission,
} from "../apps/api/src/services/permissionsRoleAudit.js";
import {
  ErreurDecisionConcurrente,
  rejeterDemandeApprobationAtomique,
} from "../apps/api/src/services/demandeApprobation.js";
import { contexteRequete } from "../apps/api/src/lib/contexteRequete.js";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

// --- Garde — voir l'en-tête. Toute première instruction, avant tout accès
// Prisma : aucun des modules importés ci-dessus ne construit de PrismaClient
// à l'import (même convention que verifier-integration-bootstrap-ci.ts et
// verifier-concurrence-equipe-ci.ts) — seule la ligne suivante en ouvrirait
// une, donc la garde s'exécute avant toute connexion réelle. ---
verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-audit-permissions-role-ci.ts");

const prisma = new PrismaClient();
// Même convention que verifier-concurrence-equipe-ci.ts : un `new PrismaClient()`
// nu est structurellement identique à l'exécution à `typeof prisma` (client
// applicatif étendu) — seul le type TypeScript diffère à cause de l'extension
// d'audit générale, qui n'intercepte de toute façon ni upsert ni deleteMany
// ni create (voir permissionsRoleAudit.ts). Le cast est donc sûr.
const dbPourAudit = prisma as unknown as Parameters<typeof appliquerModificationPermissionsRole>[0];

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification PostgreSQL réelle du correctif P1 (audit permissions rôle) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function reinitialiserBase() {
  await prisma.auditLog.deleteMany();
  await prisma.demandeApprobation.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.utilisateur.deleteMany();
  await prisma.role.deleteMany();
}

async function creerRoleEtActeur(nomRole: string, emailActeur: string) {
  const role = await prisma.role.create({ data: { nom: nomRole, roleParentId: null } });
  const acteur = await prisma.utilisateur.create({
    data: { nom: "Actrice Test", email: emailActeur, roleId: role.id, motDePasseHash: "x", actif: true },
  });
  return { role, acteur };
}

async function permissionsReelles(roleId: string) {
  const lignes = await prisma.rolePermission.findMany({ where: { roleId }, orderBy: { module: "asc" } });
  return lignes.map((l) => ({ module: l.module, niveauAcces: l.niveauAcces }));
}

async function compterAuditLogsRole(roleId: string) {
  return prisma.auditLog.count({ where: { typeEntite: "Role", entiteId: roleId } });
}

// --- Preuve de verrou DÉTERMINISTE (correctif Round 3, P1-02) --------------
//
// Défaut corrigé : le scénario 10 (Round 2) lançait B DEPUIS le crochet de A
// (transaction encore ouverte, verrou de ligne réellement tenu), mais
// utilisait ensuite `await new Promise((resolve) => setTimeout(resolve,
// 300))` pour « laisser le temps » à la requête de B d'atteindre PostgreSQL
// et de se heurter au verrou — un DÉLAI ARBITRAIRE ne prouve PAS que B a
// réellement atteint PostgreSQL et s'y trouve réellement en attente : le
// scénario aurait pu passer même avec des opérations strictement
// séquentielles (si B avait par exemple été anormalement lent à démarrer,
// rien ne l'aurait détecté ; à l'inverse, un délai insuffisant sur une
// machine chargée aurait pu laisser filer une fausse preuve de non-blocage).
//
// Remplacé par une observation RÉELLE, depuis une TROISIÈME connexion
// PostgreSQL, du fait que la session de B est GÉNUINEMENT en attente d'un
// verrou détenu par la session de A — via les vues système `pg_stat_activity`
// / `pg_locks` de PostgreSQL (fonction native `pg_blocking_pids`), jamais un
// pari sur le timing. Le délai maximal ci-dessous n'est utilisé QUE comme
// garde-fou d'ÉCHEC de test (le scénario échoue explicitement si l'attente
// n'est jamais observée) — JAMAIS comme mécanisme de synchronisation : la
// boucle se termine dès que l'observation réussit, souvent en quelques
// millisecondes.

/**
 * Pid PostgreSQL RÉEL de la connexion physique utilisée par CETTE
 * transaction précise — interrogé SUR `tx` lui-même (jamais sur le client
 * parent hors transaction, dont le pool pourrait allouer une connexion
 * différente).
 */
async function pidDeLaTransaction(tx: { $queryRaw: PrismaClient["$queryRaw"] }): Promise<number> {
  const lignes = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  const pid = lignes[0]?.pid;
  if (typeof pid !== "number") throw new Error("pidDeLaTransaction : pg_backend_pid() n'a renvoyé aucun pid exploitable");
  return pid;
}

/**
 * Bloque jusqu'à observer, depuis `observateur` (une TROISIÈME connexion,
 * distincte des deux transactions en course), que la session PostgreSQL
 * `pidBloque` est RÉELLEMENT en attente d'un verrou détenu par la session
 * `pidBloquant` — via la fonction native `pg_blocking_pids(pid)`, qui liste
 * les pid bloquant réellement une session donnée. Ne renvoie JAMAIS avant
 * cette observation réelle ; lève un échec de test explicite si elle n'a
 * jamais lieu avant `delaiMaxMs` (garde-fou, jamais la synchronisation
 * elle-même).
 */
async function attendreBlocageReel(
  observateur: PrismaClient,
  pidBloque: number,
  pidBloquant: number,
  description: string,
  delaiMaxMs = 5000,
): Promise<void> {
  const debut = Date.now();
  for (;;) {
    const lignes = await observateur.$queryRaw<{ bloquants: number[] }[]>`
      SELECT pg_blocking_pids(${pidBloque}::int) AS bloquants
    `;
    const bloquants = (lignes[0]?.bloquants ?? []).map(Number);
    if (bloquants.includes(pidBloquant)) return; // observation RÉELLE et positive — synchronisation terminée
    if (Date.now() - debut > delaiMaxMs) {
      throw new Error(
        `${description} : jamais observé, depuis une connexion tierce, que la session pid=${pidBloque} est ` +
          `réellement bloquée par la session pid=${pidBloquant} (pg_blocking_pids) dans les ${delaiMaxMs}ms — ce ` +
          "délai est un GARDE-FOU D'ÉCHEC DE TEST, jamais un mécanisme de synchronisation ; son expiration signifie " +
          "soit que le scénario est mal construit, soit qu'aucun conflit réel n'a eu lieu entre les deux sessions.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function main() {
  console.log("→ Scénario 1/14 : ajout d'une permission, exécution DIRECTE (base PostgreSQL réelle)…");
  let roleId!: string;
  let acteurId!: string;
  let acteurNom!: string;
  {
    await reinitialiserBase();
    const { role, acteur } = await creerRoleEtActeur("Rôle Test 1", "acteur1@test.local");
    roleId = role.id;
    acteurId = acteur.id;
    acteurNom = acteur.nom;

    const resultat = await contexteRequete.run({ id: acteur.id, nom: acteur.nom }, () =>
      appliquerModificationPermissionsRole(dbPourAudit, role.id, [{ module: "CAISSE", niveauAcces: "LECTURE" }]),
    );

    if (resultat.diff.ajouts.length !== 1 || resultat.diff.ajouts[0]?.module !== "CAISSE") {
      echouer("scénario 1 : diff.ajouts attendu = [{CAISSE, LECTURE}]");
    }
    const reel = await permissionsReelles(roleId);
    if (reel.length !== 1 || reel[0]?.module !== "CAISSE" || reel[0]?.niveauAcces !== "LECTURE") {
      echouer(`scénario 1 : RolePermission réelle attendue = [CAISSE:LECTURE], trouvé ${JSON.stringify(reel)}`);
    }
    const nbAudit = await compterAuditLogsRole(roleId);
    if (nbAudit !== 1) echouer(`scénario 1 : attendu 1 AuditLog, trouvé ${nbAudit}`);
    console.log("  ✓ RolePermission réellement créée, exactement 1 AuditLog écrit.");
  }

  console.log("→ Scénario 2/14 : modification + ajout combinés (base réelle)…");
  {
    const resultat = await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
      appliquerModificationPermissionsRole(dbPourAudit, roleId, [
        { module: "CAISSE", niveauAcces: "ECRITURE" },
        { module: "STOCKS", niveauAcces: "LECTURE" },
      ]),
    );
    if (resultat.diff.modifications.length !== 1 || resultat.diff.modifications[0]?.module !== "CAISSE") {
      echouer("scénario 2 : diff.modifications attendu = [{CAISSE, LECTURE→ECRITURE}]");
    }
    if (resultat.diff.ajouts.length !== 1 || resultat.diff.ajouts[0]?.module !== "STOCKS") {
      echouer("scénario 2 : diff.ajouts attendu = [{STOCKS, LECTURE}]");
    }
    const reel = await permissionsReelles(roleId);
    if (reel.length !== 2) echouer(`scénario 2 : attendu 2 RolePermission réelles, trouvé ${reel.length}`);
    console.log("  ✓ modification ET ajout réels, tous deux visibles en base.");
  }

  console.log("→ Scénario 3/14 : retrait total (liste vide) — base réelle…");
  {
    const resultat = await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
      appliquerModificationPermissionsRole(dbPourAudit, roleId, []),
    );
    if (resultat.diff.retraits.length !== 2) {
      echouer(`scénario 3 : attendu 2 retraits (CAISSE + STOCKS), trouvé ${resultat.diff.retraits.length}`);
    }
    const reel = await permissionsReelles(roleId);
    if (reel.length !== 0) echouer(`scénario 3 : attendu 0 RolePermission réelle après retrait total, trouvé ${reel.length}`);
    console.log("  ✓ toutes les RolePermission réellement supprimées, diff.retraits exact.");
  }

  console.log("→ Scénario 4/14 : absence de doublon d'audit sur un appel à plusieurs changements…");
  {
    const nbAvant = await compterAuditLogsRole(roleId);
    await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
      appliquerModificationPermissionsRole(dbPourAudit, roleId, [
        { module: "CAISSE", niveauAcces: "LECTURE" },
        { module: "STOCKS", niveauAcces: "ECRITURE" },
        { module: "PRODUCTION", niveauAcces: "LECTURE" },
      ]),
    );
    const nbApres = await compterAuditLogsRole(roleId);
    if (nbApres - nbAvant !== 1) {
      echouer(`scénario 4 : attendu exactement +1 AuditLog pour 3 permissions changées en un appel, trouvé +${nbApres - nbAvant}`);
    }
    console.log("  ✓ une seule ligne AuditLog pour 3 permissions changées dans le même appel.");
  }

  console.log("→ Scénario 5/14 : répétition idempotente (même matrice deux fois) — diff vide au 2e appel réel…");
  {
    const permsActuelles = (await permissionsReelles(roleId)).map((p) => ({
      module: p.module,
      niveauAcces: p.niveauAcces,
    })) as EntreePermission[];
    const nbAvant = await compterAuditLogsRole(roleId);
    const resultat = await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
      appliquerModificationPermissionsRole(dbPourAudit, roleId, permsActuelles),
    );
    const nbApres = await compterAuditLogsRole(roleId);
    if (nbApres - nbAvant !== 1) echouer("scénario 5 : la répétition doit tout de même écrire une ligne d'audit (comportement documenté)");
    if (resultat.diff.ajouts.length || resultat.diff.retraits.length || resultat.diff.modifications.length) {
      echouer(`scénario 5 : diff attendu entièrement vide sur resoumission exacte, trouvé ${JSON.stringify(resultat.diff)}`);
    }
    console.log("  ✓ resoumission exacte : 1 nouvelle ligne d'audit quand même écrite, diff vide comme documenté.");
  }

  console.log("→ Scénario 6/14 : ÉCHEC RÉEL d'une écriture de permission (valeur de module invalide) → ROLLBACK réel…");
  {
    // Le rejet d'une valeur de module hors énumération a lieu côté client
    // Prisma (validation contre le type généré), AVANT le réseau. Ce qui
    // reste entièrement réel : la transaction PostgreSQL elle-même (un vrai
    // BEGIN a eu lieu, la première écriture — FOURNISSEURS — a réellement été
    // appliquée dans cette transaction avant l'exception), et le ROLLBACK qui
    // suit est exécuté par le vrai moteur PostgreSQL sur cette transaction
    // réelle. La preuve porte sur l'état relu depuis une connexion séparée.
    const avant = await permissionsReelles(roleId);
    const nbAuditAvant = await compterAuditLogsRole(roleId);

    let leve = false;
    try {
      await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
        appliquerModificationPermissionsRole(dbPourAudit, roleId, [
          { module: "FOURNISSEURS", niveauAcces: "ECRITURE" }, // écrirait avec succès seule
          { module: "MODULE_INEXISTANT" as EntreePermission["module"], niveauAcces: "LECTURE" }, // rejeté (validation Prisma)
        ]),
      );
    } catch (e) {
      leve = true;
      if (!(e instanceof Error) || !/Expected Module|Invalid value for argument `module`/i.test(e.message)) {
        echouer(`scénario 6 : attendu un rejet de valeur de module invalide, reçu : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!leve) echouer("scénario 6 : l'appel aurait dû lever une erreur (module invalide)");

    // Relecture depuis une CONNEXION SÉPARÉE, pour ne dépendre d'aucun cache
    // du client `prisma` principal — preuve indépendante de l'état réellement
    // committé en base.
    const clientVerif = new PrismaClient();
    let apres: Awaited<ReturnType<typeof permissionsReelles>>;
    let nbAuditApres: number;
    try {
      apres = await clientVerif.rolePermission.findMany({ where: { roleId }, orderBy: { module: "asc" } });
      nbAuditApres = await clientVerif.auditLog.count({ where: { typeEntite: "Role", entiteId: roleId } });
    } finally {
      await clientVerif.$disconnect();
    }
    if (JSON.stringify(apres.map((p) => ({ module: p.module, niveauAcces: p.niveauAcces }))) !== JSON.stringify(avant)) {
      echouer(
        "scénario 6 : ROLLBACK ATTENDU MAIS ABSENT — l'écriture FOURNISSEURS (première de la transaction, aurait " +
          "réussi seule) a survécu à l'échec de la seconde écriture ; l'état RolePermission doit être strictement " +
          "identique à avant l'appel",
      );
    }
    if (nbAuditApres !== nbAuditAvant) {
      echouer("scénario 6 : aucune ligne d'audit ne doit être créée quand une écriture de permission échoue (audit menteur)");
    }
    console.log("  ✓ échec PostgreSQL réel (enum invalide) → ROLLBACK réel de toute la transaction, zéro audit menteur.");
  }

  console.log("→ Scénario 7/14 : ÉCHEC RÉEL de l'écriture d'audit (FK utilisateur inexistant) → ROLLBACK réel des permissions…");
  {
    const avant = await permissionsReelles(roleId);
    const nbAuditAvant = await compterAuditLogsRole(roleId);

    let leve = false;
    try {
      // Acteur factice dont l'id ne référence AUCUN Utilisateur réel : les
      // écritures RolePermission (qui n'ont aucune FK vers Utilisateur)
      // réussiraient normalement dans la transaction — seule l'écriture
      // AuditLog, en fin de transaction, viole réellement la contrainte de
      // clé étrangère `AuditLog.utilisateurId → Utilisateur.id`.
      await contexteRequete.run({ id: "id-utilisateur-totalement-inexistant-xyz", nom: "Fantôme" }, () =>
        appliquerModificationPermissionsRole(dbPourAudit, roleId, [{ module: "TRAVAILLEURS", niveauAcces: "ECRITURE" }]),
      );
    } catch (e) {
      leve = true;
      if (!(e instanceof Error) || !/foreign key constraint/i.test(e.message)) {
        echouer(`scénario 7 : attendu une violation de clé étrangère PostgreSQL, reçu : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!leve) echouer("scénario 7 : l'appel aurait dû lever une erreur (acteur inexistant → FK AuditLog)");

    const clientVerif = new PrismaClient();
    let apres: Awaited<ReturnType<typeof permissionsReelles>>;
    let nbAuditApres: number;
    try {
      apres = await clientVerif.rolePermission.findMany({ where: { roleId }, orderBy: { module: "asc" } });
      nbAuditApres = await clientVerif.auditLog.count({ where: { typeEntite: "Role", entiteId: roleId } });
    } finally {
      await clientVerif.$disconnect();
    }
    if (JSON.stringify(apres.map((p) => ({ module: p.module, niveauAcces: p.niveauAcces }))) !== JSON.stringify(avant)) {
      echouer(
        "scénario 7 : ROLLBACK ATTENDU MAIS ABSENT — l'écriture RolePermission (qui aurait réussi seule, aucune FK " +
          "vers Utilisateur) a survécu à l'échec de l'écriture d'audit qui la suit dans la même transaction",
      );
    }
    if (nbAuditApres !== nbAuditAvant) echouer("scénario 7 : aucune ligne d'audit ne peut avoir été créée (c'est elle qui a échoué)");
    console.log("  ✓ échec PostgreSQL réel sur l'écriture d'audit → ROLLBACK réel de TOUTES les permissions déjà appliquées.");
  }

  console.log("→ Scénario 8/14 : hors contexte de requête authentifiée → refus, aucune écriture committée…");
  {
    const avant = await permissionsReelles(roleId);
    const nbAuditAvant = await compterAuditLogsRole(roleId);
    let leve = false;
    try {
      await appliquerModificationPermissionsRole(dbPourAudit, roleId, [{ module: "RAPPORTS", niveauAcces: "LECTURE" }]);
    } catch (e) {
      leve = true;
      if (!(e instanceof ErreurActeurRequisPourAudit)) echouer(`scénario 8 : attendu ErreurActeurRequisPourAudit, reçu ${e}`);
    }
    if (!leve) echouer("scénario 8 : l'appel hors contexte authentifié aurait dû être refusé");
    const apres = await permissionsReelles(roleId);
    const nbAuditApres = await compterAuditLogsRole(roleId);
    if (JSON.stringify(apres) !== JSON.stringify(avant) || nbAuditApres !== nbAuditAvant) {
      echouer("scénario 8 : aucune écriture (permission ou audit) ne doit survivre à ce refus");
    }
    console.log("  ✓ refus propre hors contexte authentifié, aucune écriture committée.");
  }

  console.log("→ Scénario 9/14 : parcours APPROBATION réel — métadonnées Round 2 (base PostgreSQL réelle)…");
  let roleApprobationId!: string;
  {
    await reinitialiserBase();
    const { role: roleApprobation } = await creerRoleEtActeur("Rôle Test Approbation", "acteur-approbation@test.local");
    roleApprobationId = roleApprobation.id;
    const principal = await prisma.utilisateur.create({
      data: { nom: "Principal Test", email: "principal@test.local", roleId: roleApprobation.id, motDePasseHash: "x", actif: true },
    });
    const secondaire = await prisma.utilisateur.create({
      data: { nom: "Secondaire Test", email: "secondaire@test.local", roleId: roleApprobation.id, motDePasseHash: "x", actif: true },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "MODIFIER_PERMISSIONS_ROLE",
        donnees: { roleId: roleApprobationId, permissions: [{ module: "CAISSE", niveauAcces: "LECTURE" }] },
        resume: "modifier les permissions du rôle « Rôle Test Approbation »",
        demandeParId: secondaire.id,
      },
    });

    const resultat = await contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
      approuverEtAppliquerModificationPermissionsRole(dbPourAudit, demande.id, { id: principal.id, nom: principal.nom }),
    );

    if (resultat.demandeStatut !== "APPROUVEE" || resultat.demandeApprouveParId !== principal.id) {
      echouer("scénario 9 : la demande aurait dû passer à APPROUVEE avec l'approbateur exact");
    }
    const demandeReelle = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    if (demandeReelle.statut !== "APPROUVEE" || demandeReelle.approuveParId !== principal.id) {
      echouer(`scénario 9 : DemandeApprobation réelle attendue APPROUVEE par ${principal.id}, trouvé ${JSON.stringify(demandeReelle)}`);
    }
    const ligneAudit = await prisma.auditLog.findFirstOrThrow({ where: { typeEntite: "Role", entiteId: roleApprobationId } });
    const apres = ligneAudit.apres as {
      typeActionCritique: string;
      modeExecution: string;
      demandeApprobationId: string;
      demandePar: { id: string; nom: string } | null;
    };
    if (apres.typeActionCritique !== "MODIFIER_PERMISSIONS_ROLE") echouer("scénario 9 : typeActionCritique attendu MODIFIER_PERMISSIONS_ROLE");
    if (apres.modeExecution !== "APPROBATION") echouer("scénario 9 : modeExecution attendu APPROBATION");
    if (apres.demandeApprobationId !== demande.id) echouer("scénario 9 : demandeApprobationId attendu exact");
    if (apres.demandePar?.id !== secondaire.id) echouer("scénario 9 : demandePar attendu = l'Admin secondaire, distinct de l'approbateur");
    if (ligneAudit.utilisateurId !== principal.id) echouer("scénario 9 : utilisateurId (acteur) attendu = le Principal qui approuve");
    console.log("  ✓ métadonnées réelles exactes : typeActionCritique, modeExecution=APPROBATION, demandeApprobationId, demandePar≠acteur.");
  }

  console.log("→ Scénario 10/14 : DEUX APPROBATIONS RÉELLEMENT CONCURRENTES (connexions séparées, verrou RÉELLEMENT observé)…");
  {
    const { role } = await creerRoleEtActeur("Rôle Test Concurrence", "acteur-concurrence@test.local");
    const principal = await prisma.utilisateur.create({
      data: { nom: "Principal Concurrence", email: "principal-concurrence@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const secondaire = await prisma.utilisateur.create({
      data: { nom: "Secondaire Concurrence", email: "secondaire-concurrence@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "MODIFIER_PERMISSIONS_ROLE",
        donnees: { roleId: role.id, permissions: [{ module: "STOCKS", niveauAcces: "ECRITURE" }] },
        resume: "modifier les permissions du rôle « Rôle Test Concurrence »",
        demandeParId: secondaire.id,
      },
    });
    // Connexions B (participante à la course) et Observatrice (la preuve
    // elle-même) — toutes deux SÉPARÉES de A, préconnectées.
    const clientB = new PrismaClient();
    const clientObservateur = new PrismaClient();
    await Promise.all([clientB.$connect(), clientObservateur.$connect()]);
    const dbPourAuditB = clientB as unknown as Parameters<typeof approuverEtAppliquerModificationPermissionsRole>[0];

    let promesseB: Promise<unknown> | undefined;
    let pidB: number | undefined;
    // Barrière déterministe (correctif Round 4, P1) : ne PAS interroger le
    // pid de B via `clientB` hors transaction (le pool Prisma ne garantit
    // pas la réutilisation de la même connexion physique pour la transaction
    // ouverte juste après — un tel pid pourrait désigner une connexion
    // totalement différente de celle qui se bloque réellement). `pidB` est
    // donc capturé DEPUIS `txB`, à l'intérieur même de la transaction de B,
    // au point précis où B est sur le point de tenter sa réservation
    // (bloquante ici, puisque même id de demande que A) — voir le crochet
    // `avantReservation` de B ci-dessous. `pidBPret` ne se résout qu'une
    // fois cette capture réellement effectuée.
    let resolverPidBPret!: () => void;
    const pidBPret = new Promise<void>((resolve) => {
      resolverPidBPret = resolve;
    });

    // A s'exécute avec le crochet `apresReservationAvantExecution` : au
    // moment précis où A a RÉELLEMENT réservé la ligne (transaction encore
    // OUVERTE, verrou de ligne PostgreSQL RÉELLEMENT tenu, rien n'est encore
    // committé), on lance B — sur sa propre connexion. Le crochet NE DOIT PAS
    // attendre que B se termine : B ne peut se débloquer que lorsque A
    // committe, et A ne peut committer qu'après que son crochet soit revenu
    // — attendre B ici créerait un blocage mutuel (piège découvert et
    // corrigé pendant l'écriture initiale de ce script). Ce que le crochet
    // ATTEND réellement, avant de laisser A committer : d'abord la barrière
    // `pidBPret` (pid RÉEL de B capturé depuis sa propre transaction), puis
    // la CONFIRMATION, depuis `clientObservateur` (une troisième connexion),
    // que la session de B est GÉNUINEMENT bloquée sur le verrou de A
    // (`pg_blocking_pids`) — jamais un délai arbitraire.
    const resultatA = await contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
      approuverEtAppliquerModificationPermissionsRole(
        dbPourAudit,
        demande.id,
        { id: principal.id, nom: principal.nom },
        {
          apresReservationAvantExecution: async (tx) => {
            const pidA = await pidDeLaTransaction(tx);
            promesseB = contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
              approuverEtAppliquerModificationPermissionsRole(dbPourAuditB, demande.id, { id: principal.id, nom: principal.nom }, {
                // Le blocage de B survient PENDANT sa propre réservation
                // (même id de demande que A, verrou de ligne déjà tenu par
                // A) : le pid doit donc être capturé JUSTE AVANT cette
                // réservation, depuis `txB` lui-même.
                avantReservation: async (txB) => {
                  pidB = await pidDeLaTransaction(txB);
                  resolverPidBPret();
                },
              }),
            );
            await pidBPret;
            await attendreBlocageReel(clientObservateur, pidB!, pidA, "scénario 10 (approbation vs approbation)");
          },
        },
      ),
    );
    // À cet instant, l'observation ci-dessus a RÉELLEMENT eu lieu : B était
    // bloquée sur le verrou de A au moment où A a poursuivi vers son commit —
    // pas une hypothèse de timing. A committe maintenant, relâche son verrou,
    // et B (qui attendait ce verrou depuis l'intérieur de sa propre
    // transaction) peut se débloquer, réévaluer son WHERE contre l'état
    // réellement committé (déjà APPROUVEE), et se rejeter.
    const resultatB = await Promise.allSettled([promesseB]).then(([r]) => r);
    await Promise.all([clientB.$disconnect(), clientObservateur.$disconnect()]);

    if (resultatA.demandeStatut !== "APPROUVEE") echouer("scénario 10 : A (gagnant) aurait dû réussir et passer la demande à APPROUVEE");
    if (!resultatB || resultatB.status !== "rejected") {
      echouer(`scénario 10 : B (perdant) aurait dû échouer, résultat = ${JSON.stringify(resultatB)}`);
    }
    const erreurB = (resultatB as PromiseRejectedResult).reason;
    if (!(erreurB instanceof ErreurApprobationConcurrente)) {
      echouer(`scénario 10 : B aurait dû échouer précisément avec ErreurApprobationConcurrente, reçu : ${erreurB}`);
    }
    if (typeof pidB !== "number") echouer("scénario 10 : le pid de B aurait dû être capturé avant l'observation du blocage");

    const demandeReelle = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    if (demandeReelle.statut !== "APPROUVEE" || demandeReelle.approuveParId !== principal.id) {
      echouer("scénario 10 : la demande doit être APPROUVEE exactement une fois, par le gagnant");
    }
    const nbAudit = await prisma.auditLog.count({ where: { typeEntite: "Role", entiteId: role.id } });
    if (nbAudit !== 1) echouer(`scénario 10 : attendu exactement 1 AuditLog malgré 2 tentatives concurrentes, trouvé ${nbAudit}`);
    const permsFinales = await permissionsReelles(role.id);
    if (permsFinales.length !== 1 || permsFinales[0]?.module !== "STOCKS" || permsFinales[0]?.niveauAcces !== "ECRITURE") {
      echouer(`scénario 10 : permissions finales attendues = [STOCKS:ECRITURE], trouvé ${JSON.stringify(permsFinales)}`);
    }
    console.log(
      "  ✓ deux approbations RÉELLEMENT concurrentes : le blocage de B sur le verrou de A a été OBSERVÉ (troisième " +
        "connexion, pg_blocking_pids), jamais supposé par un délai — exactement 1 succès, 1 rejet contrôlé " +
        "(ErreurApprobationConcurrente), 1 seul AuditLog, permissions correctes, demande approuvée une seule fois.",
    );
  }

  console.log("→ Scénario 11/14 : APPROBATION vs REJET concurrents — l'APPROBATION gagne (verrou RÉELLEMENT observé)…");
  {
    const { role } = await creerRoleEtActeur("Rôle Test Approb-gagne", "acteur-approb-gagne@test.local");
    const principal = await prisma.utilisateur.create({
      data: { nom: "Principal Approb-gagne", email: "principal-approb-gagne@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const secondaire = await prisma.utilisateur.create({
      data: { nom: "Secondaire Approb-gagne", email: "secondaire-approb-gagne@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "MODIFIER_PERMISSIONS_ROLE",
        donnees: { roleId: role.id, permissions: [{ module: "PRODUCTION", niveauAcces: "LECTURE" }] },
        resume: "modifier les permissions du rôle « Rôle Test Approb-gagne »",
        demandeParId: secondaire.id,
      },
    });
    const clientRejet = new PrismaClient();
    const clientObservateur = new PrismaClient();
    await Promise.all([clientRejet.$connect(), clientObservateur.$connect()]);
    const dbPourRejet = clientRejet as unknown as Parameters<typeof rejeterDemandeApprobationAtomique>[0];

    let promesseRejet: Promise<unknown> | undefined;
    let pidRejet: number | undefined;
    // Barrière déterministe (correctif Round 4, P1) — voir scénario 10 :
    // `pidRejet` doit être capturé DEPUIS la transaction du rejet elle-même
    // (`avantReservation`), jamais via `clientRejet` hors transaction.
    let resolverPidRejetPret!: () => void;
    const pidRejetPret = new Promise<void>((resolve) => {
      resolverPidRejetPret = resolve;
    });

    const resultatApprobation = await contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
      approuverEtAppliquerModificationPermissionsRole(
        dbPourAudit,
        demande.id,
        { id: principal.id, nom: principal.nom },
        {
          apresReservationAvantExecution: async (tx) => {
            const pidApprobation = await pidDeLaTransaction(tx);
            promesseRejet = rejeterDemandeApprobationAtomique(dbPourRejet, demande.id, { id: principal.id, nom: principal.nom }, {
              // Le rejet se heurte au verrou de l'approbation PENDANT sa
              // propre réservation (même id de demande) : pid capturé juste
              // avant, depuis sa transaction.
              avantReservation: async (txRejet) => {
                pidRejet = await pidDeLaTransaction(txRejet);
                resolverPidRejetPret();
              },
            });
            await pidRejetPret;
            await attendreBlocageReel(clientObservateur, pidRejet!, pidApprobation, "scénario 11 (rejet bloqué par approbation)");
          },
        },
      ),
    );
    const resultatRejet = await Promise.allSettled([promesseRejet]).then(([r]) => r);
    await Promise.all([clientRejet.$disconnect(), clientObservateur.$disconnect()]);

    if (resultatApprobation.demandeStatut !== "APPROUVEE") {
      echouer("scénario 11 : l'approbation (gagnante) aurait dû réussir et passer la demande à APPROUVEE");
    }
    if (!resultatRejet || resultatRejet.status !== "rejected") {
      echouer(`scénario 11 : le rejet (perdant) aurait dû échouer, résultat = ${JSON.stringify(resultatRejet)}`);
    }
    if (!((resultatRejet as PromiseRejectedResult).reason instanceof ErreurDecisionConcurrente)) {
      echouer(`scénario 11 : le rejet aurait dû échouer précisément avec ErreurDecisionConcurrente, reçu : ${(resultatRejet as PromiseRejectedResult).reason}`);
    }
    if (typeof pidRejet !== "number") echouer("scénario 11 : le pid du rejet aurait dû être capturé avant l'observation du blocage");

    const demandeReelle = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    if (demandeReelle.statut !== "APPROUVEE" || demandeReelle.approuveParId !== principal.id) {
      echouer("scénario 11 : la demande doit rester APPROUVEE — jamais écrasée en REJETEE par le rejet concurrent perdant");
    }
    const nbAudit = await prisma.auditLog.count({ where: { typeEntite: "Role", entiteId: role.id } });
    if (nbAudit !== 1) echouer(`scénario 11 : attendu exactement 1 AuditLog, trouvé ${nbAudit}`);
    const permsFinales = await permissionsReelles(role.id);
    if (permsFinales.length !== 1 || permsFinales[0]?.module !== "PRODUCTION") {
      echouer(`scénario 11 : permissions attendues = [PRODUCTION:LECTURE], trouvé ${JSON.stringify(permsFinales)}`);
    }
    console.log(
      "  ✓ approbation vs rejet concurrents, blocage du rejet sur le verrou de l'approbation RÉELLEMENT observé " +
        "(pg_blocking_pids) : l'approbation gagne, permissions appliquées, 1 seul AuditLog, statut final APPROUVEE, " +
        "jamais écrasé.",
    );
  }

  console.log("→ Scénario 12/14 : APPROBATION vs REJET concurrents — le REJET gagne (verrou RÉELLEMENT observé)…");
  {
    const { role } = await creerRoleEtActeur("Rôle Test Rejet-gagne", "acteur-rejet-gagne@test.local");
    const principal = await prisma.utilisateur.create({
      data: { nom: "Principal Rejet-gagne", email: "principal-rejet-gagne@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const secondaire = await prisma.utilisateur.create({
      data: { nom: "Secondaire Rejet-gagne", email: "secondaire-rejet-gagne@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "MODIFIER_PERMISSIONS_ROLE",
        donnees: { roleId: role.id, permissions: [{ module: "COMMANDES", niveauAcces: "ECRITURE" }] },
        resume: "modifier les permissions du rôle « Rôle Test Rejet-gagne »",
        demandeParId: secondaire.id,
      },
    });
    const clientApprobation = new PrismaClient();
    const clientObservateur = new PrismaClient();
    await Promise.all([clientApprobation.$connect(), clientObservateur.$connect()]);
    const dbPourApprobation = clientApprobation as unknown as Parameters<typeof approuverEtAppliquerModificationPermissionsRole>[0];

    let promesseApprobation: Promise<unknown> | undefined;
    let pidApprobation: number | undefined;
    // Barrière déterministe (correctif Round 4, P1) — voir scénario 10 :
    // `pidApprobation` doit être capturé DEPUIS la transaction de
    // l'approbation elle-même (`avantReservation`), jamais via
    // `clientApprobation` hors transaction.
    let resolverPidApprobationPret!: () => void;
    const pidApprobationPret = new Promise<void>((resolve) => {
      resolverPidApprobationPret = resolve;
    });

    // Symétrique du scénario 11 : cette fois c'est le REJET qui réserve en
    // premier (via son nouveau crochet `apresReservationAvantCommit`,
    // `services/demandeApprobation.ts`) et l'APPROBATION concurrente qui se
    // heurte réellement à son verrou.
    await rejeterDemandeApprobationAtomique(
      prisma as unknown as Parameters<typeof rejeterDemandeApprobationAtomique>[0],
      demande.id,
      { id: principal.id, nom: principal.nom },
      {
        apresReservationAvantCommit: async (tx) => {
          const pidRejet = await pidDeLaTransaction(tx);
          promesseApprobation = contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
            approuverEtAppliquerModificationPermissionsRole(dbPourApprobation, demande.id, { id: principal.id, nom: principal.nom }, {
              // L'approbation se heurte au verrou du rejet PENDANT sa propre
              // réservation (même id de demande) : pid capturé juste avant,
              // depuis sa transaction.
              avantReservation: async (txApprobation) => {
                pidApprobation = await pidDeLaTransaction(txApprobation);
                resolverPidApprobationPret();
              },
            }),
          );
          await pidApprobationPret;
          await attendreBlocageReel(clientObservateur, pidApprobation!, pidRejet, "scénario 12 (approbation bloquée par rejet)");
        },
      },
    );
    const resultatApprobation = await Promise.allSettled([promesseApprobation]).then(([r]) => r);
    await Promise.all([clientApprobation.$disconnect(), clientObservateur.$disconnect()]);

    if (!resultatApprobation || resultatApprobation.status !== "rejected") {
      echouer(`scénario 12 : l'approbation (perdante) aurait dû échouer, résultat = ${JSON.stringify(resultatApprobation)}`);
    }
    if (!((resultatApprobation as PromiseRejectedResult).reason instanceof ErreurApprobationConcurrente)) {
      echouer(
        `scénario 12 : l'approbation aurait dû échouer précisément avec ErreurApprobationConcurrente, reçu : ${(resultatApprobation as PromiseRejectedResult).reason}`,
      );
    }
    if (typeof pidApprobation !== "number") echouer("scénario 12 : le pid de l'approbation aurait dû être capturé avant l'observation du blocage");

    const demandeReelle = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    if (demandeReelle.statut !== "REJETEE" || demandeReelle.approuveParId !== principal.id) {
      echouer("scénario 12 : la demande doit rester REJETEE — l'approbation concurrente perdante ne doit jamais l'écraser en APPROUVEE");
    }
    const nbAudit = await prisma.auditLog.count({ where: { typeEntite: "Role", entiteId: role.id } });
    if (nbAudit !== 0) echouer(`scénario 12 : aucune permission n'aurait dû être appliquée (rejet gagnant) — attendu 0 AuditLog, trouvé ${nbAudit}`);
    const permsFinales = await permissionsReelles(role.id);
    if (permsFinales.length !== 0) {
      echouer(`scénario 12 : aucune RolePermission n'aurait dû être écrite (rejet gagnant), trouvé ${JSON.stringify(permsFinales)}`);
    }
    console.log(
      "  ✓ rejet vs approbation concurrents, blocage de l'approbation sur le verrou du rejet RÉELLEMENT observé " +
        "(pg_blocking_pids) : le rejet gagne, ZÉRO permission appliquée, ZÉRO AuditLog, statut final REJETEE, " +
        "jamais écrasé — l'action n'est jamais exécutée pour une demande déjà rejetée.",
    );
  }

  console.log("→ Scénario 13/14 : P2034 RÉEL pendant l'écriture RolePermission (pas la réservation) → réessai borné réel…");
  {
    // Correctif Round 3, P2-02 : la Round 2 ne prouvait un P2034 réel QUE sur
    // le premier `updateMany` de réservation (deux approbations visant la
    // MÊME DemandeApprobation, scénario 10). Ce scénario-ci force un P2034
    // RÉEL à un point DIFFÉRENT de la transaction — l'écriture RolePermission
    // elle-même — en faisant collisionner DEUX demandes DISTINCTES (donc dont
    // les réservations, sur deux id différents, ne se bloquent PAS entre
    // elles) ciblant le MÊME rôle et le MÊME module. A réserve, exécute (donc
    // écrit RolePermission pour CAISSE) puis se met en pause dans le nouveau
    // crochet `apresExecutionAvantRetour`, transaction encore ouverte. B
    // réserve alors SA PROPRE demande (id différent → succès), puis tente le
    // MÊME upsert RolePermission(role, CAISSE) → verrou réel de la ligne déjà
    // modifiée par A, observé depuis une troisième connexion. Quand A
    // committe, PostgreSQL détecte le conflit de sérialisation réel sur B
    // (SQLSTATE 40001 / P2034 côté Prisma) — B réessaie automatiquement
    // (boucle bornée de `approuverEtAppliquerModificationPermissionsRole`) et
    // réussit à la tentative suivante, contre l'état désormais committé par A.
    const { role } = await creerRoleEtActeur("Rôle Test P2034 réel", "acteur-p2034@test.local");
    const principal = await prisma.utilisateur.create({
      data: { nom: "Principal P2034", email: "principal-p2034@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const secondaire = await prisma.utilisateur.create({
      data: { nom: "Secondaire P2034", email: "secondaire-p2034@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const demandeA = await prisma.demandeApprobation.create({
      data: {
        type: "MODIFIER_PERMISSIONS_ROLE",
        donnees: { roleId: role.id, permissions: [{ module: "CAISSE", niveauAcces: "LECTURE" }] },
        resume: "modifier les permissions du rôle « Rôle Test P2034 réel » (A)",
        demandeParId: secondaire.id,
      },
    });
    const demandeB = await prisma.demandeApprobation.create({
      data: {
        type: "MODIFIER_PERMISSIONS_ROLE",
        donnees: { roleId: role.id, permissions: [{ module: "CAISSE", niveauAcces: "ECRITURE" }] },
        resume: "modifier les permissions du rôle « Rôle Test P2034 réel » (B)",
        demandeParId: secondaire.id,
      },
    });

    const clientB = new PrismaClient();
    const clientObservateur = new PrismaClient();
    await Promise.all([clientB.$connect(), clientObservateur.$connect()]);
    const dbPourAuditB = clientB as unknown as Parameters<typeof approuverEtAppliquerModificationPermissionsRole>[0];

    let promesseB: Promise<unknown> | undefined;
    let pidB: number | undefined;
    let nbAppelsTransactionB = 0;
    const clientBAvecCompteur = new Proxy(dbPourAuditB, {
      get(cible, propriete, recepteur) {
        if (propriete === "$transaction") {
          return (...args: unknown[]) => {
            nbAppelsTransactionB++;
            return (cible.$transaction as (...a: unknown[]) => unknown)(...args);
          };
        }
        return Reflect.get(cible, propriete, recepteur);
      },
    });
    // Barrière déterministe (correctif Round 4, P1) : contrairement aux
    // scénarios 10-12, le blocage de B ne survient PAS pendant sa réservation
    // (demandeB a un id DIFFÉRENT de demandeA — aucun conflit à cette étape)
    // mais PENDANT l'écriture RolePermission qui suit. `pidB` doit donc être
    // capturé APRÈS que la réservation de B a RÉUSSI mais AVANT que
    // l'écriture RolePermission ne démarre — exactement le point où
    // `apresReservationAvantExecution` de B s'exécute — jamais via `clientB`
    // hors transaction (interrogé avant même que B n'ouvre sa transaction).
    let resolverPidBPret!: () => void;
    const pidBPret = new Promise<void>((resolve) => {
      resolverPidBPret = resolve;
    });

    const resultatA = await contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
      approuverEtAppliquerModificationPermissionsRole(
        dbPourAudit,
        demandeA.id,
        { id: principal.id, nom: principal.nom },
        {
          apresExecutionAvantRetour: async (tx) => {
            const pidA = await pidDeLaTransaction(tx);
            promesseB = contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
              approuverEtAppliquerModificationPermissionsRole(
                clientBAvecCompteur as unknown as Parameters<typeof approuverEtAppliquerModificationPermissionsRole>[0],
                demandeB.id,
                { id: principal.id, nom: principal.nom },
                {
                  // La réservation de B (id distinct de A) réussit sans
                  // conflit — c'est ICI, juste après, que son pid réel doit
                  // être capturé : le blocage réel survient juste après,
                  // pendant l'upsert RolePermission (même ligne que A).
                  apresReservationAvantExecution: async (txB) => {
                    pidB = await pidDeLaTransaction(txB);
                    resolverPidBPret();
                  },
                },
              ),
            );
            await pidBPret;
            // B doit se heurter au verrou RÉEL posé par l'upsert RolePermission
            // de A (même ligne : roleId+module CAISSE), PAS à la réservation
            // (deux id de demande différents, aucun conflit à cette étape).
            await attendreBlocageReel(clientObservateur, pidB!, pidA, "scénario 13 (P2034 réel sur l'upsert RolePermission)");
          },
        },
      ),
    );
    const resultatB = await Promise.allSettled([promesseB]).then(([r]) => r);
    await Promise.all([clientB.$disconnect(), clientObservateur.$disconnect()]);

    if (resultatA.demandeStatut !== "APPROUVEE") echouer("scénario 13 : A aurait dû réussir dès la première tentative");
    if (!resultatB || resultatB.status !== "fulfilled") {
      echouer(`scénario 13 : B aurait dû finir par réussir après réessai(s), résultat = ${JSON.stringify(resultatB)}`);
    }
    if (nbAppelsTransactionB < 2) {
      echouer(
        `scénario 13 : B aurait dû avoir besoin d'AU MOINS 2 tentatives ($transaction rouvert après un P2034 réel), ` +
          `trouvé ${nbAppelsTransactionB} — sans second appel, le P2034 réel de l'upsert n'a probablement pas eu lieu`,
      );
    }

    const demandeAReelle = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: demandeA.id } });
    const demandeBReelle = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: demandeB.id } });
    if (demandeAReelle.statut !== "APPROUVEE" || demandeBReelle.statut !== "APPROUVEE") {
      echouer("scénario 13 : les deux demandes doivent finir APPROUVEES (A directement, B après réessai)");
    }
    // B a committé APRÈS A (rouvert après le P2034 de A) : sa valeur gagne.
    const permsFinales = await permissionsReelles(role.id);
    if (permsFinales.length !== 1 || permsFinales[0]?.module !== "CAISSE" || permsFinales[0]?.niveauAcces !== "ECRITURE") {
      echouer(`scénario 13 : permission finale attendue = [CAISSE:ECRITURE] (valeur de B, committée en dernier), trouvé ${JSON.stringify(permsFinales)}`);
    }
    // Exactement 2 AuditLog : l'essai avorté de B (P2034) ne committe RIEN,
    // donc aucun AuditLog orphelin malgré le(s) réessai(s).
    const nbAudit = await prisma.auditLog.count({ where: { typeEntite: "Role", entiteId: role.id } });
    if (nbAudit !== 2) echouer(`scénario 13 : attendu exactement 2 AuditLog (1 par demande, aucun doublon malgré le réessai), trouvé ${nbAudit}`);
    console.log(
      `  ✓ P2034 RÉEL observé pendant l'upsert RolePermission (pas la réservation) : B a rouvert une TOUTE NOUVELLE ` +
        `transaction (${nbAppelsTransactionB} appels à $transaction) et a fini par réussir, jamais de 500 brut, jamais ` +
        "de doublon d'audit — la couverture P2034 s'étend bien à la transaction COMPLÈTE.",
    );
  }

  console.log("→ Scénario 14/14 : ÉCHEC INJECTÉ après réservation (parcours APPROBATION) → ROLLBACK réel COMPLET…");
  {
    const { role } = await creerRoleEtActeur("Rôle Test Rollback Approbation", "acteur-rollback-approbation@test.local");
    const secondaire = await prisma.utilisateur.create({
      data: { nom: "Secondaire Rollback", email: "secondaire-rollback@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "MODIFIER_PERMISSIONS_ROLE",
        donnees: { roleId: role.id, permissions: [{ module: "COMMISSIONS", niveauAcces: "LECTURE" }] },
        resume: "modifier les permissions du rôle « Rôle Test Rollback Approbation »",
        demandeParId: secondaire.id,
      },
    });

    const avantPerms = await permissionsReelles(role.id);
    const nbAuditAvant = await compterAuditLogsRole(role.id);

    let leve = false;
    try {
      // Même technique que le scénario 7 : acteur inexistant → l'écriture
      // d'AuditLog viole réellement la contrainte de clé étrangère, APRÈS
      // que la réservation de la demande a déjà eu lieu dans la même
      // transaction.
      await contexteRequete.run({ id: "id-utilisateur-totalement-inexistant-xyz", nom: "Fantôme" }, () =>
        approuverEtAppliquerModificationPermissionsRole(dbPourAudit, demande.id, {
          id: "id-utilisateur-totalement-inexistant-xyz",
          nom: "Fantôme",
        }),
      );
    } catch (e) {
      leve = true;
      if (!(e instanceof Error) || !/foreign key constraint/i.test(e.message)) {
        echouer(`scénario 14 : attendu une violation de clé étrangère PostgreSQL, reçu : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!leve) echouer("scénario 14 : l'appel aurait dû lever une erreur (acteur inexistant → FK AuditLog)");

    const clientVerif = new PrismaClient();
    let demandeApres: Awaited<ReturnType<typeof prisma.demandeApprobation.findUniqueOrThrow>>;
    let apresPerms: Awaited<ReturnType<typeof permissionsReelles>>;
    let nbAuditApres: number;
    try {
      demandeApres = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
      apresPerms = await clientVerif.rolePermission.findMany({ where: { roleId: role.id }, orderBy: { module: "asc" } });
      nbAuditApres = await clientVerif.auditLog.count({ where: { typeEntite: "Role", entiteId: role.id } });
    } finally {
      await clientVerif.$disconnect();
    }

    if (demandeApres.statut !== "EN_ATTENTE" || demandeApres.approuveParId !== null) {
      echouer(
        `scénario 14 : ROLLBACK ATTENDU MAIS ABSENT — la RÉSERVATION (statut → APPROUVEE) a survécu à l'échec de ` +
          `l'écriture d'audit qui la suit dans la même transaction ; la demande doit redevenir EN_ATTENTE, trouvé ${JSON.stringify(demandeApres)}`,
      );
    }
    if (JSON.stringify(apresPerms.map((p) => ({ module: p.module, niveauAcces: p.niveauAcces }))) !== JSON.stringify(avantPerms)) {
      echouer("scénario 14 : les écritures de permission auraient dû être annulées elles aussi");
    }
    if (nbAuditApres !== nbAuditAvant) echouer("scénario 14 : aucune ligne d'audit ne peut avoir été créée (c'est elle qui a échoué)");
    console.log(
      "  ✓ échec injecté après réservation → ROLLBACK réel COMPLET : demande redevenue EN_ATTENTE, permissions " +
        "inchangées, aucun audit orphelin.",
    );
  }

  await reinitialiserBase();
  console.log(
    "\n✅ Vérification PostgreSQL réelle des correctifs P1 (piste d'audit + atomicité d'approbation/rejet de " +
      "MODIFIER_PERMISSIONS_ROLE, Rounds 1 à 3) : 14 scénarios passent contre une vraie base, dont 3 preuves de " +
      "ROLLBACK réel (échec de permission, échec d'audit en direct, échec d'audit après réservation d'approbation), " +
      "4 preuves de VRAIE concurrence PostgreSQL — approbation vs approbation, approbation vs rejet (les deux ordres), " +
      "P2034 réel pendant l'écriture RolePermission — dont le blocage a été RÉELLEMENT OBSERVÉ depuis une troisième " +
      "connexion (`pg_blocking_pids`), jamais supposé par un délai arbitraire, et 1 preuve de refus hors contexte " +
      "authentifié — jamais d'état partiel, jamais d'audit menteur, jamais de doublon, jamais de double approbation, " +
      "jamais de décision terminale écrasée, jamais de 500 brut sur un conflit de sérialisation attendu.\n",
  );
}

main()
  .catch((e) => {
    process.exitCode = 1;
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
