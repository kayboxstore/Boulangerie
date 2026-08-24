/**
 * Vérification CI, contre une VRAIE base PostgreSQL éphémère, du correctif
 * P1 « piste d'audit de MODIFIER_PERMISSIONS_ROLE » (contre-revue Codex de
 * l'audit complet du 24/08/2026).
 *
 * `apps/api/src/services/permissionsRoleAudit.test.ts` prouve déjà la LOGIQUE
 * (mockée) : quelles écritures ont lieu, dans quel ordre, avec quel contenu,
 * et une simulation structurelle du tout-ou-rien. Un mock ne peut PAS prouver
 * un vrai ROLLBACK PostgreSQL — `$transaction` y est un simple appel de
 * fonction avec copie manuelle d'état, jamais un vrai moteur transactionnel.
 * Seule une vraie base, avec de vraies contraintes (enum, clé étrangère) et
 * un vrai moteur MVCC, peut prouver que :
 *  (a) un échec d'écriture de permission (valeur de module invalide, rejetée
 *      par la validation du client Prisma généré) annule RÉELLEMENT toute la
 *      transaction PostgreSQL déjà ouverte, y compris les écritures de
 *      permission déjà réellement appliquées plus tôt dans cette MÊME
 *      transaction ;
 *  (b) un échec de l'écriture d'audit elle-même (violation de la contrainte
 *      de clé étrangère `AuditLog.utilisateurId → Utilisateur`) annule
 *      RÉELLEMENT toutes les écritures de permission déjà appliquées.
 * C'est l'objet de ce script — il exerce EXACTEMENT le code de production,
 * `appliquerModificationPermissionsRole`, importé tel quel depuis
 * `apps/api/src/services/permissionsRoleAudit.js` (jamais réimplémenté ici).
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
  ErreurActeurRequisPourAudit,
  type EntreePermission,
} from "../apps/api/src/services/permissionsRoleAudit.js";
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

async function main() {
  console.log("→ Scénario 1/8 : ajout d'une permission (base PostgreSQL réelle)…");
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
      appliquerModificationPermissionsRole(dbPourAudit, role.id, [{ module: "CAISSE", niveauAcces: "LECTURE" }], null),
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

  console.log("→ Scénario 2/8 : modification + ajout combinés (base réelle)…");
  {
    const resultat = await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
      appliquerModificationPermissionsRole(dbPourAudit, roleId, [
        { module: "CAISSE", niveauAcces: "ECRITURE" },
        { module: "STOCKS", niveauAcces: "LECTURE" },
      ], null),
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

  console.log("→ Scénario 3/8 : retrait total (liste vide) — base réelle…");
  {
    const resultat = await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
      appliquerModificationPermissionsRole(dbPourAudit, roleId, [], null),
    );
    if (resultat.diff.retraits.length !== 2) {
      echouer(`scénario 3 : attendu 2 retraits (CAISSE + STOCKS), trouvé ${resultat.diff.retraits.length}`);
    }
    const reel = await permissionsReelles(roleId);
    if (reel.length !== 0) echouer(`scénario 3 : attendu 0 RolePermission réelle après retrait total, trouvé ${reel.length}`);
    console.log("  ✓ toutes les RolePermission réellement supprimées, diff.retraits exact.");
  }

  console.log("→ Scénario 4/8 : absence de doublon d'audit sur un appel à plusieurs changements…");
  {
    const nbAvant = await compterAuditLogsRole(roleId);
    await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
      appliquerModificationPermissionsRole(dbPourAudit, roleId, [
        { module: "CAISSE", niveauAcces: "LECTURE" },
        { module: "STOCKS", niveauAcces: "ECRITURE" },
        { module: "PRODUCTION", niveauAcces: "LECTURE" },
      ], null),
    );
    const nbApres = await compterAuditLogsRole(roleId);
    if (nbApres - nbAvant !== 1) {
      echouer(`scénario 4 : attendu exactement +1 AuditLog pour 3 permissions changées en un appel, trouvé +${nbApres - nbAvant}`);
    }
    console.log("  ✓ une seule ligne AuditLog pour 3 permissions changées dans le même appel.");
  }

  console.log("→ Scénario 5/8 : répétition idempotente (même matrice deux fois) — diff vide au 2e appel réel…");
  {
    const permsActuelles = (await permissionsReelles(roleId)).map((p) => ({
      module: p.module,
      niveauAcces: p.niveauAcces,
    })) as EntreePermission[];
    const nbAvant = await compterAuditLogsRole(roleId);
    const resultat = await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
      appliquerModificationPermissionsRole(dbPourAudit, roleId, permsActuelles, null),
    );
    const nbApres = await compterAuditLogsRole(roleId);
    if (nbApres - nbAvant !== 1) echouer("scénario 5 : la répétition doit tout de même écrire une ligne d'audit (comportement documenté)");
    if (resultat.diff.ajouts.length || resultat.diff.retraits.length || resultat.diff.modifications.length) {
      echouer(`scénario 5 : diff attendu entièrement vide sur resoumission exacte, trouvé ${JSON.stringify(resultat.diff)}`);
    }
    console.log("  ✓ resoumission exacte : 1 nouvelle ligne d'audit quand même écrite, diff vide comme documenté.");
  }

  console.log("→ Scénario 6/8 : ÉCHEC RÉEL d'une écriture de permission (valeur de module invalide) → ROLLBACK réel…");
  {
    // Le rejet d'une valeur de module hors énumération a lieu côté client
    // Prisma (validation contre le type généré), AVANT le réseau — Prisma
    // empêche par conception qu'une valeur d'enum invalide atteigne le moteur
    // PostgreSQL via son client généré. Ce qui reste entièrement réel et non
    // simulé : la transaction PostgreSQL elle-même (un vrai BEGIN a eu lieu,
    // la première écriture — FOURNISSEURS — a réellement été appliquée dans
    // cette transaction avant l'exception), et le ROLLBACK qui suit
    // l'exception est exécuté par le vrai moteur PostgreSQL sur cette
    // transaction réelle. La preuve porte sur l'état relu depuis une
    // connexion séparée, pas sur la nature de la cause de l'exception.
    const avant = await permissionsReelles(roleId);
    const nbAuditAvant = await compterAuditLogsRole(roleId);

    let leve = false;
    try {
      await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
        appliquerModificationPermissionsRole(
          dbPourAudit,
          roleId,
          [
            { module: "FOURNISSEURS", niveauAcces: "ECRITURE" }, // écrirait avec succès seule
            { module: "MODULE_INEXISTANT" as EntreePermission["module"], niveauAcces: "LECTURE" }, // rejeté (validation Prisma)
          ],
          null,
        ),
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

  console.log("→ Scénario 7/8 : ÉCHEC RÉEL de l'écriture d'audit (FK utilisateur inexistant) → ROLLBACK réel des permissions…");
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
        appliquerModificationPermissionsRole(dbPourAudit, roleId, [{ module: "TRAVAILLEURS", niveauAcces: "ECRITURE" }], null),
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

  console.log("→ Scénario 8/8 : hors contexte de requête authentifiée → refus, aucune écriture committée…");
  {
    const avant = await permissionsReelles(roleId);
    const nbAuditAvant = await compterAuditLogsRole(roleId);
    let leve = false;
    try {
      await appliquerModificationPermissionsRole(dbPourAudit, roleId, [{ module: "RAPPORTS", niveauAcces: "LECTURE" }], null);
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

  await reinitialiserBase();
  console.log(
    "\n✅ Vérification PostgreSQL réelle du correctif P1 (piste d'audit MODIFIER_PERMISSIONS_ROLE) : 8 scénarios " +
      "passent contre une vraie base, dont 2 preuves de ROLLBACK réel (échec de permission, échec d'audit) et 1 " +
      "preuve de refus hors contexte authentifié — jamais d'état partiel, jamais d'audit menteur, jamais de doublon.\n",
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
