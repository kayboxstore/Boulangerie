/**
 * Restauration d'une sauvegarde (section 3.15) — CONTREPARTIE de
 * apps/api/src/services/sauvegarde.ts, qui ne fait QUE produire des dumps.
 * Volontairement un script à lancer à la main (jamais une route HTTP) : une
 * restauration REMPLACE le contenu de la base cible, un clic malheureux sur un
 * bouton web serait bien trop facile sur les données réelles de l'entreprise.
 *
 * Usage :
 *   npx tsx scripts/restaurer-sauvegarde.ts <fichier.dump> --confirmer
 *
 * Sans --confirmer, le script s'arrête après avoir affiché ce qu'il ferait
 * (base cible, fichier) sans toucher à quoi que ce soit.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PG_RESTORE = process.env.PG_RESTORE_PATH ?? "pg_restore";

async function main() {
  const args = process.argv.slice(2);
  const confirme = args.includes("--confirmer");
  const fichier = args.find((a) => !a.startsWith("--"));

  if (!fichier) {
    console.error("Usage : npx tsx scripts/restaurer-sauvegarde.ts <fichier.dump> --confirmer");
    process.exit(1);
  }
  if (!existsSync(fichier)) {
    console.error(`Fichier introuvable : ${fichier}`);
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL n'est pas définie dans l'environnement.");
    process.exit(1);
  }
  let cible: URL;
  try {
    cible = new URL(url);
  } catch {
    console.error("DATABASE_URL est illisible.");
    process.exit(1);
  }
  const base = cible.pathname.replace(/^\//, "");

  console.log("=== Restauration d'une sauvegarde ===");
  console.log(`Fichier   : ${fichier}`);
  console.log(`Hôte      : ${cible.hostname}:${cible.port || 5432}`);
  console.log(`Base      : ${base}`);
  console.log("");
  console.log(
    "ATTENTION : --clean --if-exists supprime les tables existantes de cette base AVANT de restaurer le dump — tout ce qui n'est pas dans le fichier sera perdu.",
  );

  if (!confirme) {
    console.log("\nAucune action effectuée (relancer avec --confirmer pour restaurer réellement).");
    return;
  }

  const restoreArgs = [
    "--host", cible.hostname,
    "--port", cible.port || "5432",
    "--dbname", base,
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    fichier,
  ];
  if (cible.username) restoreArgs.push("--username", decodeURIComponent(cible.username));

  console.log("\nRestauration en cours...");
  try {
    const { stdout, stderr } = await execFileAsync(PG_RESTORE, restoreArgs, {
      env: {
        ...process.env,
        PGPASSWORD: cible.password ? decodeURIComponent(cible.password) : "",
        PGSSLMODE: cible.searchParams.get("sslmode") ?? process.env.PGSSLMODE ?? "prefer",
        LC_ALL: "C",
      },
      maxBuffer: 1024 * 1024 * 64,
    });
    if (stdout.trim()) console.log(stdout);
    if (stderr.trim()) console.log(stderr);
    console.log("\nRestauration terminée.");
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      console.error(
        `L'outil pg_restore est introuvable (${PG_RESTORE}). Installe le client PostgreSQL ou renseigne PG_RESTORE_PATH.`,
      );
    } else {
      // pg_restore renvoie souvent un code non nul même pour de simples
      // avertissements (ex. objet déjà absent avec --if-exists) — on affiche
      // la sortie complète plutôt que de masquer un vrai échec derrière.
      console.error("pg_restore a signalé des erreurs/avertissements :");
      console.error(err.stderr ?? err.message);
    }
    process.exitCode = 1;
  }
}

main();
