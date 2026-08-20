/**
 * Vérification d'intégration CI du correctif P0-01 (round 2, « P1-03 »),
 * contre une VRAIE base PostgreSQL éphémère — le service `postgres` de
 * `.github/workflows/ci.yml`. Additif : ne remplace ni `npm test` ni les
 * tests unitaires mockés (`prisma/bootstrap-production.test.ts`,
 * `prisma/garde-environnement-seed-demo.test.ts`) — prouve la même chose
 * contre une base réelle plutôt qu'un client Prisma simulé.
 *
 * Suppose que les migrations viennent déjà d'être appliquées sur une base
 * vide (étape CI précédente : `npx prisma migrate deploy`).
 *
 * Usage : npx tsx scripts/verifier-integration-bootstrap-ci.ts
 */
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { bootstrapProduction, MATRICE_ROLES } from "../prisma/bootstrap-production.js";

const prisma = new PrismaClient();

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification d'intégration CI (P0-01 / P1-03) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function main() {
  // 1. Base fraîchement migrée → aucun utilisateur.
  const utilisateursAvant = await prisma.utilisateur.count();
  if (utilisateursAvant !== 0) echouer(`la base n'est pas vide avant le 1ᵉʳ bootstrap (${utilisateursAvant} utilisateur(s))`);

  // 2. 1ᵉʳ bootstrap : installe toute la matrice.
  const resultat1 = await bootstrapProduction(prisma);
  if (resultat1.rolesInstalles !== MATRICE_ROLES.length) {
    echouer(`le 1ᵉʳ bootstrap n'a pas installé les ${MATRICE_ROLES.length} rôles attendus (${resultat1.rolesInstalles})`);
  }
  if ((await prisma.utilisateur.count()) !== 0) echouer("le bootstrap a créé un utilisateur");
  console.log(`✓ 1ᵉʳ bootstrap (base vide) : ${resultat1.rolesInstalles} rôle(s) installé(s), 0 utilisateur`);

  // 3. 2ᵉ bootstrap (rejeu) : idempotent — rien de nouveau installé.
  const resultat2 = await bootstrapProduction(prisma);
  if (resultat2.rolesInstalles !== 0 || resultat2.rolesDejaPresents !== MATRICE_ROLES.length) {
    echouer(`le 2ᵉ bootstrap n'est pas idempotent : ${JSON.stringify(resultat2)}`);
  }
  console.log("✓ 2ᵉ bootstrap (rejeu) : idempotent, rien de nouveau installé");

  // 4. Modifie RÉELLEMENT une permission (simule PUT /api/roles/:id/permissions
  //    par un Administrateur), puis rejoue le bootstrap une 3ᵉ fois.
  const roleAdmin = await prisma.role.findUniqueOrThrow({ where: { nom: "Administrateur" } });
  await prisma.rolePermission.update({
    where: { roleId_module: { roleId: roleAdmin.id, module: "PARAMETRES" } },
    data: { niveauAcces: "LECTURE" },
  });
  await bootstrapProduction(prisma); // simule un redéploiement
  const permissionApresRejeu = await prisma.rolePermission.findUniqueOrThrow({
    where: { roleId_module: { roleId: roleAdmin.id, module: "PARAMETRES" } },
  });
  if (permissionApresRejeu.niveauAcces !== "LECTURE") {
    echouer(`la permission personnalisée a été écrasée par le rejeu du bootstrap (niveauAcces=${permissionApresRejeu.niveauAcces})`);
  }
  if ((await prisma.utilisateur.count()) !== 0) echouer("un utilisateur est apparu après un rejeu du bootstrap");
  console.log("✓ permission personnalisée strictement préservée après un 3ᵉ bootstrap (simulation de redéploiement)");

  // 5. Le seed de démonstration doit être refusé avec NODE_ENV=production, via
  //    le VRAI script npm documenté (`npm run db:seed:demo`) — pas un appel
  //    direct à tsx, pour prouver le câblage réel bout en bout.
  let refuse = false;
  try {
    execFileSync("npm", ["run", "db:seed:demo"], {
      env: { ...process.env, NODE_ENV: "production" },
      stdio: "pipe",
    });
  } catch {
    refuse = true;
  }
  if (!refuse) echouer("le seed de démonstration a RÉUSSI avec NODE_ENV=production — ne doit jamais arriver");
  console.log("✓ `npm run db:seed:demo` refusé avec NODE_ENV=production (exit non-zéro)");

  // 6. Base strictement inchangée après ce refus.
  if ((await prisma.utilisateur.count()) !== 0) echouer("le seed démo refusé a quand même créé un utilisateur");
  const permissionApresRefus = await prisma.rolePermission.findUniqueOrThrow({
    where: { roleId_module: { roleId: roleAdmin.id, module: "PARAMETRES" } },
  });
  if (permissionApresRefus.niveauAcces !== "LECTURE") echouer("le seed démo refusé a quand même modifié une permission");
  console.log("✓ base strictement inchangée après le refus du seed démo (0 utilisateur, permission intacte)");

  console.log("\n✅ Vérification d'intégration CI P0-01 (P1-03) : tous les scénarios passent contre une vraie base PostgreSQL.\n");
}

main()
  .catch((e) => {
    if (process.exitCode !== 1) {
      console.error(e);
      process.exitCode = 1;
    }
  })
  .finally(() => prisma.$disconnect());
