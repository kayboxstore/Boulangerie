/**
 * Vérification d'intégration CI du correctif P0-01 (round 2 « P1-03 »,
 * complétée round 3 « point 4 » après revue Codex), contre une VRAIE base
 * PostgreSQL éphémère — le service `postgres` de `.github/workflows/ci.yml`.
 * Additif : ne remplace ni `npm test` ni les tests unitaires mockés
 * (`prisma/bootstrap-production.test.ts`, `prisma/garde-environnement-seed-demo.test.ts`)
 * — prouve la même chose contre une base réelle plutôt qu'un client Prisma
 * simulé, PLUS des scénarios que seule une vraie base peut prouver
 * (transaction réellement avortée, rejeu après échec).
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
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-integration-bootstrap-ci.ts
 */
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { bootstrapProduction, MATRICE_ROLES } from "../prisma/bootstrap-production.js";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

// --- Garde — voir l'en-tête. Toute première instruction, avant tout accès
// Prisma : les imports ci-dessus n'ouvrent eux-mêmes aucune connexion (même
// convention que prisma/seed-demo.ts), seule la ligne suivante en ouvrirait
// une, donc la garde s'exécute avant toute connexion réelle. ---
verifierEnvironnementIntegrationCI(process.env);

const prisma = new PrismaClient();

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification d'intégration CI (P0-01 / round 3) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function verifierZeroUtilisateur(etape: string) {
  const n = await prisma.utilisateur.count();
  if (n !== 0) echouer(`${etape} : la base contient ${n} utilisateur(s), attendu 0`);
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

  // 1. Base fraîchement migrée → aucun utilisateur.
  await verifierZeroUtilisateur("avant le 1ᵉʳ bootstrap");

  // 2. 1ᵉʳ bootstrap via le VRAI chemin `npm run db:bootstrap:production`
  //    (round 3, point 2) — pas seulement un import direct de
  //    `bootstrapProduction()` : ceci exerce réellement le bloc CLI de
  //    `prisma/bootstrap-production.ts` (détection d'entrypoint incluse).
  const cliBootstrap = executerEtCapturer("npm", ["run", "db:bootstrap:production"], {});
  if (!cliBootstrap.succes) {
    echouer(`\`npm run db:bootstrap:production\` (vrai chemin CLI) a échoué :\n${cliBootstrap.sortie}`);
  }
  const rolesApresCli = await prisma.role.count();
  if (rolesApresCli !== MATRICE_ROLES.length) {
    echouer(`après le vrai \`npm run db:bootstrap:production\`, ${rolesApresCli} rôle(s) trouvé(s), attendu ${MATRICE_ROLES.length}`);
  }
  await verifierZeroUtilisateur("après le 1ᵉʳ bootstrap (vrai chemin CLI)");
  console.log(`✓ vrai \`npm run db:bootstrap:production\` : ${rolesApresCli} rôle(s) installés, 0 utilisateur`);

  // 3. 2ᵉ bootstrap (rejeu, via la fonction exportée — même logique) :
  //    idempotent, rien de nouveau installé.
  const resultat2 = await bootstrapProduction(prisma);
  if (resultat2.rolesInstalles !== 0 || resultat2.rolesDejaPresents !== MATRICE_ROLES.length) {
    echouer(`le 2ᵉ bootstrap n'est pas idempotent : ${JSON.stringify(resultat2)}`);
  }
  await verifierZeroUtilisateur("après le 2ᵉ bootstrap (idempotence)");
  console.log("✓ 2ᵉ bootstrap (rejeu) : idempotent, rien de nouveau installé");

  const roleAdmin = await prisma.role.findUniqueOrThrow({ where: { nom: "Administrateur" } });
  const roleCaissiere = await prisma.role.findUniqueOrThrow({ where: { nom: "Caissier(ère)" } });

  // 4. Permission MODIFIÉE manuellement (simule PUT /api/roles/:id/permissions
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

  // 5. Permission SUPPRIMÉE manuellement, puis rejeu → NE DOIT PAS être recréée.
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

  // 6. roleParentId personnalisé (modifié manuellement), puis rejeu → NE DOIT PAS être réécrit.
  await prisma.role.update({ where: { id: roleAdmin.id }, data: { roleParentId: null } });
  await bootstrapProduction(prisma);
  const roleAdminApresRejeu = await prisma.role.findUniqueOrThrow({ where: { id: roleAdmin.id } });
  if (roleAdminApresRejeu.roleParentId !== null) {
    echouer(`roleParentId a été réécrit par le rejeu (attendu null, la valeur simulée ; trouvé ${roleAdminApresRejeu.roleParentId})`);
  }
  await verifierZeroUtilisateur("après rejeu (roleParentId personnalisé)");
  console.log("✓ roleParentId personnalisé : jamais réécrit par le rejeu");

  // 7. ÉCHEC simulé au milieu de l'installation → transaction RÉELLEMENT
  //    avortée par PostgreSQL, aucune donnée partielle. Spec cassée : un rôle
  //    inédit ("Rôle Cassé Intégration CI") dont le parent n'existe pas.
  const rolesAvantEchec = await prisma.role.count();
  const specCassee = [
    ...MATRICE_ROLES,
    { nom: "Rôle Cassé Intégration CI", roleParentNom: "N'existe Pas Du Tout", permissions: [] },
  ];
  let echecLeve = false;
  try {
    await bootstrapProduction(prisma, specCassee);
  } catch {
    echecLeve = true;
  }
  if (!echecLeve) echouer("bootstrapProduction() n'a PAS rejeté malgré une spec cassée (parent inexistant)");
  const rolesApresEchec = await prisma.role.count();
  if (rolesApresEchec !== rolesAvantEchec) {
    echouer(`la transaction avortée a quand même laissé des données partielles (rôles avant=${rolesAvantEchec}, après=${rolesApresEchec})`);
  }
  const roleCasseInexistant = await prisma.role.findUnique({ where: { nom: "Rôle Cassé Intégration CI" } });
  if (roleCasseInexistant !== null) echouer("le rôle cassé a malgré tout été commité — rollback réel non respecté");
  await verifierZeroUtilisateur("après l'échec simulé (rollback)");
  console.log(`✓ échec simulé : transaction réellement avortée par PostgreSQL, ${rolesApresEchec} rôle(s) (identique à avant, aucune donnée partielle)`);

  // 8. Exécution NORMALE après l'échec → doit réussir intégralement (l'état reste utilisable).
  const resultatApresEchec = await bootstrapProduction(prisma); // spec réelle, par défaut
  if (resultatApresEchec.rolesInstalles !== 0 || resultatApresEchec.rolesDejaPresents !== MATRICE_ROLES.length) {
    echouer(`l'exécution normale après l'échec n'a pas réussi comme attendu : ${JSON.stringify(resultatApresEchec)}`);
  }
  await verifierZeroUtilisateur("après l'exécution normale suivant l'échec");
  console.log("✓ exécution normale après l'échec : succès complet, état cohérent");

  // 9. Le seed de démonstration doit être refusé avec NODE_ENV=production, via
  //    le VRAI script npm documenté (`npm run db:seed:demo`). Un exit non nul
  //    NE SUFFIT PAS : on capture la sortie et on vérifie le message PRÉCIS
  //    de la garde (round 3, point 4 — corrige l'ambiguïté round 2).
  const seedRefuse = executerEtCapturer("npm", ["run", "db:seed:demo"], { NODE_ENV: "production" });
  if (seedRefuse.succes) echouer("`npm run db:seed:demo` a RÉUSSI avec NODE_ENV=production — ne doit jamais arriver");
  if (!seedRefuse.sortie.includes('NODE_ENV="production"')) {
    echouer(
      `\`npm run db:seed:demo\` a échoué (attendu), mais SANS le message précis de la garde ` +
        `(NODE_ENV="production") — échec possiblement dû à une autre cause. Sortie capturée :\n${seedRefuse.sortie}`,
    );
  }
  console.log('✓ `npm run db:seed:demo` refusé avec NODE_ENV=production — message précis de la garde confirmé');

  // 10. Base STRICTEMENT inchangée après ce refus (tous les états personnalisés
  //     des étapes précédentes doivent être encore exactement ceux-là).
  await verifierZeroUtilisateur("après le refus du seed démo");
  const permissionApresRefus = await prisma.rolePermission.findUniqueOrThrow({
    where: { roleId_module: { roleId: roleAdmin.id, module: "PARAMETRES" } },
  });
  if (permissionApresRefus.niveauAcces !== "LECTURE") echouer("le seed démo refusé a quand même modifié une permission");
  const permissionSupprimeeTropjoursAbsente = await prisma.rolePermission.findUnique({
    where: { roleId_module: { roleId: roleCaissiere.id, module: "CAISSE" } },
  });
  if (permissionSupprimeeTropjoursAbsente !== null) echouer("le seed démo refusé a recréé une permission supprimée");
  const roleAdminFinal = await prisma.role.findUniqueOrThrow({ where: { id: roleAdmin.id } });
  if (roleAdminFinal.roleParentId !== null) echouer("le seed démo refusé a modifié roleParentId");
  console.log("✓ base strictement inchangée après le refus du seed démo (tous les états personnalisés préservés)");

  console.log(
    "\n✅ Vérification d'intégration CI P0-01 (round 3) : tous les scénarios passent contre une vraie base PostgreSQL.\n",
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
