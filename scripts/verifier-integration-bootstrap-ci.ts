/**
 * Vérification d'intégration CI du correctif P0-01 (round 2 « P1-03 »,
 * complétée round 3 « point 4 », puis round 4 « point 2 » après revues
 * Codex successives), contre une VRAIE base PostgreSQL éphémère — le
 * service `postgres` de `.github/workflows/ci.yml`. Additif : ne remplace
 * ni `npm test` ni les tests unitaires mockés
 * (`prisma/bootstrap-production.test.ts`, `prisma/garde-environnement-seed-demo.test.ts`)
 * — prouve la même chose contre une base réelle plutôt qu'un client Prisma
 * simulé, PLUS des scénarios que seule une vraie base peut prouver
 * (transaction réellement avortée AVEC de vraies écritures préalables,
 * rejeu après échec).
 *
 * Suppose que les migrations viennent déjà d'être appliquées sur une base
 * vide (étape CI précédente : `npx prisma migrate deploy`).
 *
 * SÉCURITÉ (round 3, point 3) : ce script effectue de VRAIES écritures
 * destructives volontaires (modification/suppression de permission, échec de
 * transaction injecté). `verifierEnvironnementIntegrationCI` — appelée AVANT
 * toute construction de `PrismaClient` — exige simultanément un hôte local,
 * le nom de base EXACT `lomoto_ci`, et une confirmation explicite propre à ce
 * script. Voir `scripts/garde-integration-ci.ts`.
 *
 * Round 4 (revue Codex, point 2) : le scénario de rollback round 3
 * s'exécutait APRÈS que les 6 vrais rôles aient déjà été installés — les
 * entrées de la matrice réelle étaient donc toutes déjà présentes et
 * ignorées (`installerRoleSiAbsent` les saute sans écrire), si bien
 * qu'AUCUNE écriture réelle ne précédait le rejet : le rollback n'était
 * jamais vraiment mis à l'épreuve. Corrigé : ce scénario tourne désormais
 * EN PREMIER, sur une base structurellement vide, avec deux rôles inédits
 * (jamais vus par cette base) qui sont réellement créés — avec leurs
 * permissions — À L'INTÉRIEUR de la transaction avant que le troisième rôle
 * (cassé) ne déclenche le rejet. Le bootstrap réel (vrai chemin
 * `npm run db:bootstrap:production`) s'exécute juste après, sur cette même
 * base toujours vide : son résultat annonce alors réellement l'installation
 * des 6 rôles (jamais 0), prouvant à la fois le rollback ET la reprise
 * normale après un échec, sans étape redondante.
 *
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-integration-bootstrap-ci.ts
 */
import { execFileSync } from "node:child_process";
import { Module, NiveauAcces, PrismaClient } from "@prisma/client";
import { bootstrapProduction, MATRICE_ROLES, MOTIFS_DON, MOTIFS_PERTE, MOTIFS_NON_CONFORMITE } from "../prisma/bootstrap-production.js";
import type { RolePermissionSpec } from "../prisma/bootstrap-production.js";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

// --- Garde — voir l'en-tête. Toute première instruction, avant tout accès
// Prisma : les imports ci-dessus n'ouvrent eux-mêmes aucune connexion (même
// convention que prisma/seed-demo.ts), seule la ligne suivante en ouvrirait
// une, donc la garde s'exécute avant toute connexion réelle. ---
verifierEnvironnementIntegrationCI(process.env);

const prisma = new PrismaClient();
const NB_MOTIFS_ATTENDUS = MOTIFS_DON.length + MOTIFS_PERTE.length + MOTIFS_NON_CONFORMITE.length;

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification d'intégration CI (P0-01 / round 4) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function verifierZeroUtilisateur(etape: string) {
  const n = await prisma.utilisateur.count();
  if (n !== 0) echouer(`${etape} : la base contient ${n} utilisateur(s), attendu 0`);
}

async function compterStructurel() {
  const [roles, permissions, motifsDon, motifsPerte, motifsNC] = await Promise.all([
    prisma.role.count(),
    prisma.rolePermission.count(),
    prisma.motifDon.count(),
    prisma.motifPerte.count(),
    prisma.motifNonConformite.count(),
  ]);
  return { roles, permissions, motifs: motifsDon + motifsPerte + motifsNC };
}

/** Exécute une commande et capture sa sortie SANS jamais lever — pour inspecter le message exact en cas d'échec attendu. */
function executerEtCapturer(commande: string, args: string[], envSupplementaire: Record<string, string>) {
  try {
    const sortie = execFileSync(commande, args, {
      env: { ...process.env, ...envSupplementaire },
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { succes: true, sortie };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { succes: false, sortie: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

async function main() {
  // 0bis. Défense en profondeur : re-vérifier ce à quoi PostgreSQL a
  // RÉELLEMENT connecté Prisma (pas seulement la chaîne DATABASE_URL déjà
  // validée par la garde) — au cas où une variable d'environnement
  // intermédiaire ou un pooler la réécrirait avant que Prisma ne l'utilise.
  const [{ current_database: baseReelle }] = await prisma.$queryRaw<
    [{ current_database: string }]
  >`SELECT current_database()`;
  if (baseReelle !== "lomoto_ci") {
    echouer(`connecté à la base "${baseReelle}", attendu "lomoto_ci" — garde contournée ou DATABASE_URL modifié après coup`);
  }

  // 1. Base fraîchement migrée → structurellement vide (pas seulement 0 utilisateur).
  const avantTout = await compterStructurel();
  if (avantTout.roles !== 0 || avantTout.permissions !== 0 || avantTout.motifs !== 0) {
    echouer(`la base n'est pas structurellement vide avant tout scénario : ${JSON.stringify(avantTout)}`);
  }
  await verifierZeroUtilisateur("avant tout scénario");
  console.log("✓ base structurellement vide confirmée (0 rôle, 0 permission, 0 motif, 0 utilisateur)");

  // 2. ROLLBACK avec de VRAIES écritures préalables (round 4, point 2) : deux
  //    rôles inédits, valides, créés — avec leurs permissions — À L'INTÉRIEUR
  //    de la transaction, puis un troisième rôle cassé (parent inexistant)
  //    qui déclenche le rejet.
  const rolesRollbackTest: RolePermissionSpec[] = [
    {
      nom: "Rôle Test Rollback A (jamais en production)",
      roleParentNom: null,
      permissions: [{ module: Module.STOCKS, niveauAcces: NiveauAcces.ECRITURE }],
    },
    {
      nom: "Rôle Test Rollback B (jamais en production)",
      roleParentNom: null,
      permissions: [{ module: Module.PRODUCTION, niveauAcces: NiveauAcces.LECTURE }],
    },
    {
      nom: "Rôle Test Rollback Cassé (jamais en production)",
      roleParentNom: "N'existe Pas Du Tout",
      permissions: [],
    },
  ];
  let rollbackLeve = false;
  try {
    await bootstrapProduction(prisma, rolesRollbackTest);
  } catch {
    rollbackLeve = true;
  }
  if (!rollbackLeve) echouer("bootstrapProduction() n'a PAS rejeté malgré une spec cassée (parent inexistant)");

  const apresRollback = await compterStructurel();
  if (apresRollback.roles !== 0) {
    echouer(
      `le rollback a laissé ${apresRollback.roles} rôle(s) commité(s) au lieu de 0 — les 2 rôles valides écrits ` +
        `avant l'échec n'ont pas été annulés par la transaction`,
    );
  }
  if (apresRollback.permissions !== 0) echouer(`le rollback a laissé ${apresRollback.permissions} permission(s) commise(s) au lieu de 0`);
  if (apresRollback.motifs !== 0) echouer(`le rollback a laissé ${apresRollback.motifs} motif(s) commis au lieu de 0`);
  await verifierZeroUtilisateur("après le rollback");
  const roleTestA = await prisma.role.findUnique({ where: { nom: rolesRollbackTest[0]!.nom } });
  if (roleTestA !== null) echouer("le rôle A (écrit avant l'échec) a malgré tout survécu au rollback");
  console.log("✓ rollback réel : 2 rôles + leurs permissions réellement écrits avant l'échec, tout annulé (0 rôle, 0 permission, 0 motif, 0 utilisateur)");

  // 3. Bootstrap normal via le VRAI chemin `npm run db:bootstrap:production`
  //    (round 3, point 2) — exécuté juste après le rollback, sur cette même
  //    base toujours vide : preuve directe que l'exécution normale après un
  //    échec réussit intégralement (rolesInstalles = 6, jamais 0) ET que le
  //    vrai bloc CLI (pas seulement `bootstrapProduction()` importée) est
  //    exercé.
  const cliBootstrap = executerEtCapturer("npm", ["run", "db:bootstrap:production"], {});
  if (!cliBootstrap.succes) {
    echouer(`\`npm run db:bootstrap:production\` (vrai chemin CLI) a échoué :\n${cliBootstrap.sortie}`);
  }
  // Le résultat doit annoncer l'installation réelle des 6 rôles — jamais 0 —
  // dans le texte même du message affiché par le CLI (pas seulement déduit
  // du comptage en base ci-dessous).
  if (!cliBootstrap.sortie.includes(`${MATRICE_ROLES.length} rôle(s) installé(s)`)) {
    echouer(
      `le CLI n'a pas annoncé l'installation des ${MATRICE_ROLES.length} rôles attendus — sortie : ${cliBootstrap.sortie}`,
    );
  }
  const apresCli = await compterStructurel();
  if (apresCli.roles !== MATRICE_ROLES.length) {
    echouer(`après le vrai \`npm run db:bootstrap:production\`, ${apresCli.roles} rôle(s) trouvé(s), attendu ${MATRICE_ROLES.length}`);
  }
  if (apresCli.motifs !== NB_MOTIFS_ATTENDUS) {
    echouer(`après le vrai bootstrap, ${apresCli.motifs} motif(s) trouvé(s), attendu ${NB_MOTIFS_ATTENDUS}`);
  }
  await verifierZeroUtilisateur("après le bootstrap normal (vrai chemin CLI) suivant le rollback");
  console.log(`✓ vrai \`npm run db:bootstrap:production\` après le rollback : ${apresCli.roles} rôles + ${apresCli.motifs} motifs installés (jamais 0), 0 utilisateur`);

  // 4. 2ᵉ bootstrap (rejeu, via la fonction exportée — même logique) :
  //    idempotent, rien de nouveau installé.
  const resultat2 = await bootstrapProduction(prisma);
  if (resultat2.rolesInstalles !== 0 || resultat2.rolesDejaPresents !== MATRICE_ROLES.length) {
    echouer(`le 2ᵉ bootstrap n'est pas idempotent : ${JSON.stringify(resultat2)}`);
  }
  await verifierZeroUtilisateur("après le 2ᵉ bootstrap (idempotence)");
  console.log("✓ 2ᵉ bootstrap (rejeu) : idempotent, rien de nouveau installé");

  const roleAdmin = await prisma.role.findUniqueOrThrow({ where: { nom: "Administrateur" } });
  const roleCaissiere = await prisma.role.findUniqueOrThrow({ where: { nom: "Caissier(ère)" } });

  // 5. Permission MODIFIÉE manuellement (simule PUT /api/roles/:id/permissions
  //    par un Administrateur), puis rejeu → doit rester STRICTEMENT inchangée.
  await prisma.rolePermission.update({
    where: { roleId_module: { roleId: roleAdmin.id, module: "PARAMETRES" } },
    data: { niveauAcces: "LECTURE" },
  });
  await bootstrapProduction(prisma);
  const permissionModifiee = await prisma.rolePermission.findUniqueOrThrow({
    where: { roleId_module: { roleId: roleAdmin.id, module: "PARAMETRES" } },
  });
  if (permissionModifiee.niveauAcces !== "LECTURE") {
    echouer(`la permission modifiée a été écrasée par le rejeu (niveauAcces=${permissionModifiee.niveauAcces})`);
  }
  await verifierZeroUtilisateur("après rejeu (permission modifiée)");
  console.log("✓ permission modifiée manuellement : strictement préservée après rejeu");

  // 6. Permission SUPPRIMÉE manuellement, puis rejeu → NE DOIT PAS être recréée.
  await prisma.rolePermission.delete({ where: { roleId_module: { roleId: roleCaissiere.id, module: "CAISSE" } } });
  const nbPermissionsCaissiereApresSuppression = await prisma.rolePermission.count({ where: { roleId: roleCaissiere.id } });
  await bootstrapProduction(prisma);
  const permissionSupprimeeEncoreAbsente = await prisma.rolePermission.findUnique({
    where: { roleId_module: { roleId: roleCaissiere.id, module: "CAISSE" } },
  });
  const nbPermissionsCaissiereApresRejeu = await prisma.rolePermission.count({ where: { roleId: roleCaissiere.id } });
  if (permissionSupprimeeEncoreAbsente !== null) echouer("la permission supprimée manuellement a été RECRÉÉE par le rejeu");
  if (nbPermissionsCaissiereApresRejeu !== nbPermissionsCaissiereApresSuppression) {
    echouer(`le nombre de permissions de Caissier(ère) a changé après rejeu (${nbPermissionsCaissiereApresSuppression} → ${nbPermissionsCaissiereApresRejeu})`);
  }
  await verifierZeroUtilisateur("après rejeu (permission supprimée)");
  console.log("✓ permission supprimée manuellement : jamais recréée par le rejeu");

  // 7. roleParentId personnalisé (modifié manuellement), puis rejeu → NE DOIT PAS être réécrit.
  await prisma.role.update({ where: { id: roleAdmin.id }, data: { roleParentId: null } });
  await bootstrapProduction(prisma);
  const roleAdminApresRejeu = await prisma.role.findUniqueOrThrow({ where: { id: roleAdmin.id } });
  if (roleAdminApresRejeu.roleParentId !== null) {
    echouer(`roleParentId a été réécrit par le rejeu (attendu null, la valeur simulée ; trouvé ${roleAdminApresRejeu.roleParentId})`);
  }
  await verifierZeroUtilisateur("après rejeu (roleParentId personnalisé)");
  console.log("✓ roleParentId personnalisé : jamais réécrit par le rejeu");

  // 8. Le seed de démonstration doit être refusé avec NODE_ENV=production, via
  //    le VRAI script npm documenté (`npm run db:seed:demo`). Un exit non nul
  //    NE SUFFIT PAS : on capture la sortie et on vérifie le message PRÉCIS
  //    de la garde (round 3, point 4).
  const seedRefuse = executerEtCapturer("npm", ["run", "db:seed:demo"], { NODE_ENV: "production" });
  if (seedRefuse.succes) echouer("`npm run db:seed:demo` a RÉUSSI avec NODE_ENV=production — ne doit jamais arriver");
  if (!seedRefuse.sortie.includes('NODE_ENV="production"')) {
    echouer(
      `\`npm run db:seed:demo\` a échoué (attendu), mais SANS le message précis de la garde ` +
        `(NODE_ENV="production") — échec possiblement dû à une autre cause. Sortie capturée :\n${seedRefuse.sortie}`,
    );
  }
  console.log('✓ `npm run db:seed:demo` refusé avec NODE_ENV=production — message précis de la garde confirmé');

  // 9. Base STRICTEMENT inchangée après ce refus (tous les états personnalisés
  //    des étapes précédentes doivent être encore exactement ceux-là).
  await verifierZeroUtilisateur("après le refus du seed démo");
  const permissionApresRefus = await prisma.rolePermission.findUniqueOrThrow({
    where: { roleId_module: { roleId: roleAdmin.id, module: "PARAMETRES" } },
  });
  if (permissionApresRefus.niveauAcces !== "LECTURE") echouer("le seed démo refusé a quand même modifié une permission");
  const permissionSupprimeeToujoursAbsente = await prisma.rolePermission.findUnique({
    where: { roleId_module: { roleId: roleCaissiere.id, module: "CAISSE" } },
  });
  if (permissionSupprimeeToujoursAbsente !== null) echouer("le seed démo refusé a recréé une permission supprimée");
  const roleAdminFinal = await prisma.role.findUniqueOrThrow({ where: { id: roleAdmin.id } });
  if (roleAdminFinal.roleParentId !== null) echouer("le seed démo refusé a modifié roleParentId");
  console.log("✓ base strictement inchangée après le refus du seed démo (tous les états personnalisés préservés)");

  console.log(
    "\n✅ Vérification d'intégration CI P0-01 (round 4) : tous les scénarios passent contre une vraie base PostgreSQL, y compris un rollback avec de vraies écritures préalables.\n",
  );
}

main()
  .catch((e) => {
    if (process.exitCode !== 1) {
      console.error(e);
      process.exitCode = 1;
    }
  })
  .finally(() => prisma.$disconnect());
