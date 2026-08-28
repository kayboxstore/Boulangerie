/**
 * Vérification d'intégration CI que la migration
 * `20260827120333_purger_recettes_orphelines` PURGE RÉELLEMENT, quand elle
 * s'applique via le VRAI mécanisme `prisma migrate deploy`, des données
 * antérieures à son existence — contre une vraie base PostgreSQL éphémère.
 *
 * Écart signalé par la contre-revue Codex du 28/08/2026 sur
 * `scripts/verifier-purge-recettes-orphelines-ci.ts` : ce script voisin
 * s'exécute APRÈS que toutes les migrations (y compris celle-ci) ont déjà
 * été appliquées par l'étape CI précédente, puis appelle lui-même
 * `prisma.recette.deleteMany()` pour simuler l'effet de la migration — il
 * prouve que le mécanisme (CASCADE) fonctionne, mais jamais que la VRAIE
 * migration, appliquée par `prisma migrate deploy` à une base qui la
 * précédait, purge effectivement des données pré-existantes. C'est
 * exactement le scénario de production (des lignes `Recette`/
 * `IngredientRecette` existent déjà ; seul le prochain déploiement les
 * purgera) — ce script comble cet écart.
 *
 * Méthode : un schéma PostgreSQL isolé et jetable (`schema=` distinct de
 * `public`, dans la même base `lomoto_ci`), entièrement piloté par ce
 * script, pour ne jamais perturber le schéma `public` déjà migré par les
 * étapes CI précédentes :
 *   1. Nettoie le schéma isolé s'il existe déjà (rejouabilité locale).
 *   2. Déplace temporairement le dossier de la migration hors de
 *      `prisma/migrations/`, puis lance un VRAI `prisma migrate deploy`
 *      (processus enfant, comme en production) — le schéma isolé se
 *      retrouve donc exactement dans l'état qui précédait cette migration
 *      (36 migrations appliquées, la 37e absente).
 *   3. Insère, via le client Prisma connecté à ce schéma, une Recette et
 *      ses IngredientRecette « historiques » (même scénario que la
 *      production : elles existaient déjà avant ce correctif), PLUS une
 *      MatierePremiere non concernée, témoin de non-régression.
 *   4. Remet le dossier de migration en place et relance
 *      `prisma migrate deploy` — cette fois la 37e migration s'applique
 *      RÉELLEMENT, pour de vrai, à des données pré-existantes.
 *   5. Vérifie : Recette/IngredientRecette purgées (et leur cascade),
 *      la matière autrefois bloquée redevient supprimable, la matière
 *      témoin et son historique restent totalement intacts, et
 *      `_prisma_migrations` confirme les 37 migrations proprement
 *      terminées (aucune ligne en échec/rollback).
 *   6. Nettoie systématiquement (schéma isolé supprimé, dossier de
 *      migration restauré, TOUTES les connexions Prisma fermées) — y
 *      compris en cas d'échec d'une assertion, via try/finally, avec une
 *      vérification finale explicite via `pg_stat_activity` qu'aucune
 *      connexion portant le nom d'application de ce script ne subsiste.
 *
 * SÉCURITÉ : mêmes garanties que les scripts d'intégration voisins — hôte
 * local, nom de base EXACT `lomoto_ci`, confirmation explicite. Voir
 * `scripts/garde-integration-ci.ts`. Le schéma isolé vit DANS cette même
 * base jetable — jamais Neon, jamais la production, jamais `prisma db push`.
 *
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-application-reelle-migration-purge-recettes-ci.ts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-application-reelle-migration-purge-recettes-ci.ts");

const NOM_SCRIPT = "verifier-application-reelle-migration-purge-recettes-ci";
const NOM_SCHEMA_ISOLE = "verif_migration_purge_recettes_ci";
const NOM_MIGRATION_CIBLE = "20260827120333_purger_recettes_orphelines";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RACINE_DEPOT = path.resolve(__dirname, "..");
const DOSSIER_MIGRATIONS = path.join(RACINE_DEPOT, "prisma", "migrations");
const DOSSIER_MIGRATION_CIBLE = path.join(DOSSIER_MIGRATIONS, NOM_MIGRATION_CIBLE);
const DOSSIER_HOLDOUT = path.join(os.tmpdir(), `${NOM_SCHEMA_ISOLE}-holdout-${process.pid}`);

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification CI (application réelle de la migration purge) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

function urlAvecSchema(schema: string): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("schema", schema);
  url.searchParams.set("application_name", NOM_SCRIPT);
  return url.toString();
}

const URL_SCHEMA_ISOLE = urlAvecSchema(NOM_SCHEMA_ISOLE);

function migrationCibleEstDeplacee(): boolean {
  return !fs.existsSync(DOSSIER_MIGRATION_CIBLE) && fs.existsSync(DOSSIER_HOLDOUT);
}

function deplacerMigrationCibleHorsDuDossier(): void {
  if (!fs.existsSync(DOSSIER_MIGRATION_CIBLE)) {
    echouer(`dossier de migration introuvable : ${DOSSIER_MIGRATION_CIBLE} — la migration cible a-t-elle été renommée ?`);
  }
  fs.renameSync(DOSSIER_MIGRATION_CIBLE, DOSSIER_HOLDOUT);
}

function restaurerMigrationCible(): void {
  if (migrationCibleEstDeplacee()) {
    fs.renameSync(DOSSIER_HOLDOUT, DOSSIER_MIGRATION_CIBLE);
  }
}

function lancerMigrateDeploy(): void {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    cwd: RACINE_DEPOT,
    env: { ...process.env, DATABASE_URL: URL_SCHEMA_ISOLE },
    stdio: "inherit",
  });
}

async function connexionsResiduelles(clientAdmin: PrismaClient): Promise<number> {
  const lignes = await clientAdmin.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM pg_catalog.pg_stat_activity WHERE application_name = $1 AND pid <> pg_backend_pid()`,
    NOM_SCRIPT,
  );
  return Number(lignes[0]?.n ?? 0);
}

async function main() {
  // --- Préparation : schéma isolé propre, dossier de migration au repos. ---
  const clientAdminPublic = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    await clientAdminPublic.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${NOM_SCHEMA_ISOLE}" CASCADE`);
  } finally {
    await clientAdminPublic.$disconnect();
  }
  if (migrationCibleEstDeplacee()) restaurerMigrationCible();

  // --- Étape 1 : la base isolée précède la migration (36 migrations, pas 37). ---
  deplacerMigrationCibleHorsDuDossier();
  try {
    lancerMigrateDeploy();
  } finally {
    restaurerMigrationCible();
  }
  console.log("✓ schéma isolé migré à l'état PRÉCÉDANT immédiatement le correctif (migration cible absente)");

  // --- Étape 2 : insérer des données « historiques », comme en production. ---
  const clientAvantMigration = new PrismaClient({ datasourceUrl: URL_SCHEMA_ISOLE });
  let matiereId: string;
  let matiereTemoinId: string;
  try {
    const matiere = await clientAvantMigration.matierePremiere.create({
      data: { nom: "Farine — préexistante", code: "FARINE", unite: "kg", quantiteStock: 12.5, seuilAlerte: 10 },
    });
    matiereId = matiere.id;
    const produit = await clientAvantMigration.produit.create({
      data: { nom: "Pain — recette historique", prixVente: 500, categorie: "PAIN" },
    });
    const recette = await clientAvantMigration.recette.create({ data: { produitId: produit.id } });
    await clientAvantMigration.ingredientRecette.create({
      data: { recetteId: recette.id, matierePremiereId: matiere.id, quantite: 1 },
    });

    // Témoin de non-régression : aucun lien avec Recette/IngredientRecette —
    // la migration ne doit strictement rien lui faire.
    const matiereTemoin = await clientAvantMigration.matierePremiere.create({
      data: { nom: "Levure — témoin non concerné", code: "LEVURE", unite: "kg", quantiteStock: 3.25, seuilAlerte: 1 },
    });
    matiereTemoinId = matiereTemoin.id;

    const recettesAvant = await clientAvantMigration.recette.count();
    const ingredientsAvant = await clientAvantMigration.ingredientRecette.count();
    if (recettesAvant !== 1 || ingredientsAvant !== 1) {
      echouer(`scénario invalide avant migration : ${recettesAvant} recette(s), ${ingredientsAvant} ingrédient(s) — attendu 1 et 1`);
    }
  } finally {
    await clientAvantMigration.$disconnect();
  }
  console.log("✓ données « historiques » insérées (1 recette, 1 ingrédient, 1 matière bloquée, 1 matière témoin non liée)");

  // --- Étape 3 : appliquer RÉELLEMENT la migration via prisma migrate deploy. ---
  lancerMigrateDeploy();
  console.log("✓ migration `" + NOM_MIGRATION_CIBLE + "` appliquée pour de vrai via prisma migrate deploy (processus enfant)");

  // --- Étape 4 : vérifications après la vraie migration. ---
  const clientApresMigration = new PrismaClient({ datasourceUrl: URL_SCHEMA_ISOLE });
  try {
    const recettesApres = await clientApresMigration.recette.count();
    const ingredientsApres = await clientApresMigration.ingredientRecette.count();
    if (recettesApres !== 0) echouer(`la migration réelle n'a pas purgé Recette : ${recettesApres} ligne(s) restante(s)`);
    if (ingredientsApres !== 0) {
      echouer(`la migration réelle n'a pas fait cascader la suppression sur IngredientRecette : ${ingredientsApres} ligne(s) restante(s)`);
    }
    console.log("✓ la vraie migration a purgé Recette et fait cascader IngredientRecette (0 ligne restante dans les deux tables)");

    // La matière autrefois bloquée redevient réellement supprimable.
    await clientApresMigration.matierePremiere.delete({ where: { id: matiereId } });
    const matiereEncorePresente = await clientApresMigration.matierePremiere.findUnique({ where: { id: matiereId } });
    if (matiereEncorePresente !== null) echouer("la matière autrefois bloquée existe toujours après suppression post-migration");
    console.log("✓ la matière autrefois bloquée par la recette historique est maintenant réellement supprimable");

    // Non-régression : la matière témoin, sans aucun lien à Recette, est
    // strictement intacte (mêmes valeurs, toujours présente).
    const temoin = await clientApresMigration.matierePremiere.findUnique({ where: { id: matiereTemoinId } });
    if (!temoin) echouer("la matière témoin (non concernée par la migration) a disparu — la migration a supprimé plus que prévu");
    if (temoin.nom !== "Levure — témoin non concerné" || temoin.quantiteStock.toNumber() !== 3.25 || temoin.seuilAlerte.toNumber() !== 1) {
      echouer("la matière témoin a été altérée par la migration — attendu strictement inchangée");
    }
    console.log("✓ la matière témoin (aucun lien avec Recette) reste strictement intacte — la migration n'a purgé que ce qu'elle devait");

    // Les 37 migrations sont proprement terminées, aucune en échec.
    const migrations = await clientApresMigration.$queryRawUnsafe<
      { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
    >(`SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at ASC`);
    if (migrations.length !== 37) echouer(`attendu 37 migrations appliquées dans le schéma isolé, trouvé ${migrations.length}`);
    const inachevees = migrations.filter((m) => m.finished_at === null || m.rolled_back_at !== null);
    if (inachevees.length > 0) {
      echouer(`migration(s) inachevée(s) ou annulée(s) dans _prisma_migrations : ${inachevees.map((m) => m.migration_name).join(", ")}`);
    }
    const derniere = migrations.at(-1);
    if (derniere?.migration_name !== NOM_MIGRATION_CIBLE) {
      echouer(`la dernière migration appliquée devrait être ${NOM_MIGRATION_CIBLE}, trouvé ${derniere?.migration_name}`);
    }
    console.log("✓ _prisma_migrations confirme les 37 migrations proprement terminées, sans rollback, se terminant par la migration cible");
  } finally {
    await clientApresMigration.$disconnect();
  }

  console.log(
    "\n✅ Vérification CI « application réelle de la migration purge » : prisma migrate deploy purge pour de vrai des données " +
      "pré-existantes, sans toucher aux données non concernées.\n",
  );
}

async function nettoyageFinal(): Promise<void> {
  // Toujours restaurer le dossier de migration, même si une étape a échoué
  // avant sa restauration normale.
  if (migrationCibleEstDeplacee()) restaurerMigrationCible();

  const clientNettoyage = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    await clientNettoyage.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${NOM_SCHEMA_ISOLE}" CASCADE`);
  } finally {
    await clientNettoyage.$disconnect();
  }

  // Preuve explicite qu'aucune connexion PostgreSQL de ce script ne
  // subsiste — vérifiée depuis une DERNIÈRE connexion, elle-même fermée
  // juste après.
  const clientVerification = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
  try {
    const restantes = await connexionsResiduelles(clientVerification);
    if (restantes > 0) {
      echouer(`${restantes} connexion(s) PostgreSQL de ce script sont encore ouvertes après nettoyage — fuite de connexion`);
    }
    console.log("✓ aucune connexion PostgreSQL résiduelle de ce script après nettoyage (vérifié via pg_stat_activity)");
  } finally {
    await clientVerification.$disconnect();
  }
}

main()
  .catch((e) => {
    if (process.exitCode !== 1) {
      console.error(e);
      process.exitCode = 1;
    }
  })
  .finally(async () => {
    try {
      await nettoyageFinal();
    } catch (e) {
      console.error("❌ Échec du nettoyage final (schéma isolé et/ou dossier de migration) :", e);
      process.exitCode = 1;
    }
  });
