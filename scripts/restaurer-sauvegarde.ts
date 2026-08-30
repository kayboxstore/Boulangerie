/**
 * Restauration d'une sauvegarde (section 3.15) — CONTREPARTIE de
 * apps/api/src/services/sauvegarde.ts, qui ne fait QUE produire des dumps.
 * Volontairement un script à lancer à la main (jamais une route HTTP) : une
 * restauration REMPLACE le contenu de la base cible, un clic malheureux sur un
 * bouton web serait bien trop facile sur les données réelles de l'entreprise.
 *
 * DURCISSEMENT P0 (30/08/2026, correctif Codex/Claude) :
 *  - la confirmation n'est plus un simple `--confirmer` booléen (trop faible —
 *    un opérateur pressé colle la même commande d'un terminal à l'autre sans
 *    relire la cible) : elle doit désormais répéter le nom EXACT de la base
 *    cible, tel que résolu depuis DATABASE_URL — `--confirmer=<nomBase>` ;
 *  - l'archive est VALIDÉE (`pg_restore --list`, même mécanisme que
 *    `validerDump` côté API) AVANT tout appel à `--clean`, qui ne s'exécute
 *    jamais sur un fichier tronqué ou corrompu ;
 *  - refuse une base vide ou une URL illisible AVANT d'afficher quoi que ce
 *    soit qui ressemblerait à une cible valide ;
 *  - le mode SANS confirmation reste strictement non destructif : il valide
 *    l'archive (pour que l'opérateur sache si elle est seulement utilisable
 *    AVANT de s'engager) et affiche la cible, mais n'appelle jamais
 *    `pg_restore --clean`.
 *
 * PROCÉDURE OBLIGATOIRE avant toute restauration sur une base de PRODUCTION :
 * répéter d'abord cette même commande contre une base ou branche ISOLÉE
 * (ex. une base Neon de développement/staging distincte, ou une instance
 * PostgreSQL locale jetable) — jamais la toute première exécution d'une
 * restauration sur les données réelles de l'entreprise. Voir
 * DEPLOIEMENT.md, section Sauvegarde et restauration.
 *
 * Usage :
 *   npx tsx scripts/restaurer-sauvegarde.ts <fichier.dump>
 *     → mode SANS confirmation : valide l'archive, affiche la cible et ce qui
 *       serait fait. Ne touche à AUCUNE donnée.
 *
 *   npx tsx scripts/restaurer-sauvegarde.ts <fichier.dump> --confirmer=<nomBase>
 *     → restaure RÉELLEMENT, seulement si <nomBase> correspond EXACTEMENT au
 *       nom de la base résolu depuis DATABASE_URL.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { promisify } from "node:util";
import { validerDump, ErreurSauvegarde } from "../apps/api/src/services/sauvegarde.js";

const execFileAsync = promisify(execFile);
const PG_RESTORE = process.env.PG_RESTORE_PATH ?? "pg_restore";
const PREFIXE_CONFIRMATION = "--confirmer=";

function echouer(message: string): never {
  console.error(`\n❌ ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function main() {
  const args = process.argv.slice(2);
  const argConfirmation = args.find((a) => a.startsWith(PREFIXE_CONFIRMATION));
  const nomBaseConfirme = argConfirmation ? argConfirmation.slice(PREFIXE_CONFIRMATION.length) : null;
  const fichier = args.find((a) => !a.startsWith("--"));

  if (!fichier) {
    echouer(
      "Usage : npx tsx scripts/restaurer-sauvegarde.ts <fichier.dump> [--confirmer=<nomBase exact de la cible>]",
    );
  }
  if (!existsSync(fichier)) {
    echouer(`Fichier introuvable : ${fichier}`);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    echouer("DATABASE_URL n'est pas définie dans l'environnement.");
  }
  let cible: URL;
  try {
    cible = new URL(url);
  } catch {
    echouer("DATABASE_URL est illisible : impossible d'en extraire un hôte/une base.");
    return;
  }
  const base = cible.pathname.replace(/^\//, "");
  if (!base) {
    echouer("DATABASE_URL ne désigne aucune base de données (chemin vide) — refus par sécurité.");
    return;
  }

  console.log("=== Restauration d'une sauvegarde ===");
  console.log(`Fichier   : ${fichier}`);
  // Jamais l'utilisateur ni le mot de passe — seulement ce qui identifie SANS
  // exposer d'identifiant (même règle que l'écran État système, section 3.15).
  console.log(`Hôte      : ${cible.hostname}:${cible.port || 5432}`);
  console.log(`Base      : ${base}`);
  console.log("");

  console.log("Validation de l'archive (pg_restore --list)...");
  const contenu = await fs.readFile(fichier);
  try {
    await validerDump(contenu);
    console.log("Archive valide (table des matières lisible).\n");
  } catch (e) {
    const message = e instanceof ErreurSauvegarde ? e.message : e instanceof Error ? e.message : "erreur inconnue";
    echouer(`L'archive est invalide ou corrompue — restauration refusée AVANT tout --clean. ${message}`);
    return;
  }

  console.log(
    "ATTENTION : --clean --if-exists supprime les tables existantes de cette base AVANT de restaurer le dump — tout ce qui n'est pas dans le fichier sera perdu.",
  );
  console.log(
    "RAPPEL OBLIGATOIRE : cette restauration doit avoir été répétée avec succès sur une base ou branche ISOLÉE avant toute exécution contre une base de production.",
  );

  if (!nomBaseConfirme) {
    console.log(
      "\nAucune action effectuée (mode sans confirmation — relancer avec " +
        `--confirmer=${base} pour restaurer réellement CETTE base précise).`,
    );
    return;
  }

  if (nomBaseConfirme !== base) {
    echouer(
      `Confirmation refusée : "${nomBaseConfirme}" ne correspond pas exactement au nom de la base cible ("${base}"). ` +
        "Relis attentivement la cible affichée ci-dessus avant de confirmer — aucune action effectuée.",
    );
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
    process.exitCode = 0;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT") {
      echouer(
        `L'outil pg_restore est introuvable (${PG_RESTORE}). Installe le client PostgreSQL ou renseigne PG_RESTORE_PATH.`,
      );
    } else {
      // pg_restore renvoie souvent un code non nul même pour de simples
      // avertissements (ex. objet déjà absent avec --if-exists) — on affiche
      // la sortie complète plutôt que de masquer un vrai échec derrière.
      console.error("pg_restore a signalé des erreurs/avertissements :");
      console.error(err.stderr ?? err.message);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  if (!(e instanceof Error)) console.error(e);
  process.exitCode = process.exitCode ?? 1;
});
