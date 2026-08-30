/**
 * Restauration d'une sauvegarde (section 3.15) — CONTREPARTIE de
 * apps/api/src/services/sauvegarde.ts, qui ne fait QUE produire des dumps.
 * Volontairement un script à lancer à la main (jamais une route HTTP) : une
 * restauration REMPLACE le contenu de la base cible, un clic malheureux sur un
 * bouton web serait bien trop facile sur les données réelles de l'entreprise.
 *
 * DURCISSEMENT P0 (30/08/2026, correctif Codex/Claude) :
 *  - la confirmation n'est plus liée au seul NOM de la base — plusieurs
 *    environnements Neon distincts portent tous couramment le même nom par
 *    défaut (`neondb`), ce qui ne protégeait en rien contre une confirmation
 *    valide mais pointant vers le mauvais SERVEUR. Elle exige désormais un
 *    identifiant complet **hôte + port + base**, affiché par le script et à
 *    recopier exactement — `--confirmer=<hote>:<port>/<base>` — jamais
 *    l'utilisateur ni le mot de passe ;
 *  - la restauration est désormais RÉELLEMENT atomique : `--single-transaction`
 *    (+ `--exit-on-error` explicite) enveloppe tout le flux SQL envoyé par
 *    pg_restore dans une unique transaction — toute erreur en cours de route
 *    fait échouer le COMMIT final et laisse la cible strictement inchangée,
 *    jamais à moitié effacée ;
 *  - l'archive est VALIDÉE (`validerDump`, même mécanisme que côté API) AVANT
 *    tout appel à `--clean`, qui ne s'exécute jamais sur un fichier tronqué
 *    ou corrompu — voir la limite documentée dans `validerDump` : une table
 *    des matières lisible n'est PAS une preuve complète de restaurabilité
 *    (voir apps/api/src/services/sauvegarde.ts) ;
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
 *     → mode SANS confirmation : valide l'archive, affiche l'identifiant
 *       complet de la cible (hôte:port/base) et ce qui serait fait. Ne
 *       touche à AUCUNE donnée.
 *
 *   npx tsx scripts/restaurer-sauvegarde.ts <fichier.dump> --confirmer=<hote>:<port>/<base>
 *     → restaure RÉELLEMENT, seulement si l'identifiant fourni correspond
 *       EXACTEMENT (hôte, port ET base) à la cible résolue depuis
 *       DATABASE_URL — un nom de base identique sur un autre hôte est refusé.
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

/** Identifiant complet de la cible — hôte + port + base, JAMAIS utilisateur ni mot de passe. */
function identifiantCible(cible: URL, base: string): string {
  return `${cible.hostname}:${cible.port || "5432"}/${base}`;
}

async function main() {
  const args = process.argv.slice(2);
  const argConfirmation = args.find((a) => a.startsWith(PREFIXE_CONFIRMATION));
  const confirmationFournie = argConfirmation ? argConfirmation.slice(PREFIXE_CONFIRMATION.length) : null;
  const fichier = args.find((a) => !a.startsWith("--"));

  if (!fichier) {
    echouer(
      "Usage : npx tsx scripts/restaurer-sauvegarde.ts <fichier.dump> [--confirmer=<hote>:<port>/<base> exact de la cible]",
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
  const identifiant = identifiantCible(cible, base);

  console.log("=== Restauration d'une sauvegarde ===");
  console.log(`Fichier   : ${fichier}`);
  // Jamais l'utilisateur ni le mot de passe — seulement ce qui identifie SANS
  // exposer d'identifiant (même règle que l'écran État système, section 3.15).
  console.log(`Cible     : ${identifiant}`);
  console.log("");

  console.log("Validation de l'archive...");
  const contenu = await fs.readFile(fichier);
  try {
    await validerDump(contenu);
    console.log("Archive validée (table des matières lisible et parcours complet du flux sans erreur).\n");
  } catch (e) {
    const message = e instanceof ErreurSauvegarde ? e.message : e instanceof Error ? e.message : "erreur inconnue";
    echouer(`L'archive est invalide ou corrompue — restauration refusée AVANT tout --clean. ${message}`);
    return;
  }

  console.log(
    "ATTENTION : --clean --if-exists supprime les tables existantes de cette base avant d'y recharger le dump. " +
      "La restauration est exécutée dans une SEULE transaction (--single-transaction) : si une erreur survient en " +
      "cours de route, tout est annulé au COMMIT final — la cible reste alors strictement inchangée, jamais à " +
      "moitié effacée.",
  );
  console.log(
    "RAPPEL OBLIGATOIRE : cette restauration doit avoir été répétée avec succès sur une base ou branche ISOLÉE avant toute exécution contre une base de production.",
  );

  if (!confirmationFournie) {
    console.log(
      "\nAucune action effectuée (mode sans confirmation — relancer avec " +
        `--confirmer=${identifiant} pour restaurer réellement CETTE cible précise).`,
    );
    return;
  }

  if (confirmationFournie !== identifiant) {
    echouer(
      `Confirmation refusée : "${confirmationFournie}" ne correspond pas exactement à l'identifiant complet de la ` +
        `cible ("${identifiant}", hôte + port + base) — un nom de base identique sur un autre serveur ne suffit ` +
        "pas. Relis attentivement la cible affichée ci-dessus avant de confirmer — aucune action effectuée.",
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
    // Atomicité (P0) : toute la restauration dans une seule transaction —
    // une erreur en cours de route annule tout au COMMIT final plutôt que de
    // laisser la cible à moitié effacée/restaurée. --exit-on-error, explicite
    // en complément, arrête l'envoi de commandes dès la première erreur.
    "--single-transaction",
    "--exit-on-error",
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
      // Avec --single-transaction --exit-on-error, un code de sortie non nul
      // signifie une VRAIE erreur — la transaction entière a été annulée, la
      // cible reste inchangée. On affiche la sortie complète pour que
      // l'opérateur comprenne quoi corriger avant de réessayer.
      console.error("pg_restore a échoué — transaction annulée, la cible n'a PAS été modifiée :");
      console.error(err.stderr ?? err.message);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  if (!(e instanceof Error)) console.error(e);
  process.exitCode = process.exitCode ?? 1;
});
