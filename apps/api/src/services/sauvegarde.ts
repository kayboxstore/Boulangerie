import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

/**
 * Sauvegarde de la base (section 3.15). Le dump est produit par `pg_dump`, en
 * FORMAT PERSONNALISÉ (-Fc) : c'est le format restaurable par `pg_restore`,
 * compressé, et indépendant de l'ordre des tables — un simple SQL texte pose
 * des problèmes de contraintes à la restauration.
 *
 * Le mot de passe n'est JAMAIS passé en argument de ligne de commande : les
 * arguments d'un process sont lisibles par tout le monde (`ps aux`). Il part
 * dans PGPASSWORD, et l'URL complète n'est écrite dans aucun journal.
 */
export class ErreurSauvegarde extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Chemin des exécutables pg_dump/pg_restore ; surchargeables si l'hôte les
 * range ailleurs. Lus à CHAQUE appel (pas figés dans une constante au
 * chargement du module) : une variable d'environnement modifiée après coup
 * (ex. par un script de vérification qui injecte un binaire défaillant pour
 * prouver un échec) doit être immédiatement prise en compte, sans avoir à
 * relancer le process.
 */
function cheminPgDump(): string {
  return process.env.PG_DUMP_PATH ?? "pg_dump";
}
function cheminPgRestore(): string {
  return process.env.PG_RESTORE_PATH ?? "pg_restore";
}

/**
 * Délais maximaux (P0, correctif Codex round 2, 30/08/2026) — lus à chaque
 * appel, comme les chemins des binaires. Sans borne, un `pg_dump` ou une
 * validation qui reste bloqué (hôte injoignable, verrou PostgreSQL,
 * processus qui ne se termine jamais) empêcherait indéfiniment la barrière
 * d'écriture de se libérer — voir `lib/barriereEcriture.ts`. Au dépassement,
 * le processus enfant est tué proprement (SIGTERM puis SIGKILL de secours),
 * la sauvegarde est rejetée et rien n'est effacé (reinitialiserBase()
 * n'atteint jamais l'effacement si construireDump/validerDump échoue, et
 * abaisse toujours la barrière dans son `finally`).
 */
function delaiMaxPgDumpMs(): number {
  return Number(process.env.PG_DUMP_TIMEOUT_MS) || 120_000;
}
function delaiMaxValidationMs(): number {
  return Number(process.env.PG_RESTORE_VALIDATION_TIMEOUT_MS) || 60_000;
}

/**
 * Coordonnées de la base SANS aucun secret — c'est ce que l'écran État système
 * affiche. On ne renvoie que l'hôte, le port et le nom de la base : jamais
 * l'utilisateur, jamais le mot de passe, jamais l'URL complète.
 */
export function coordonneesBase(): { hote: string | null; port: number | null; base: string | null } {
  const url = process.env.DATABASE_URL;
  if (!url) return { hote: null, port: null, base: null };
  try {
    const u = new URL(url);
    return {
      hote: u.hostname || null,
      port: u.port ? Number(u.port) : 5432,
      base: u.pathname.replace(/^\//, "") || null,
    };
  } catch {
    // URL illisible : on préfère ne rien affirmer plutôt que d'exposer un
    // fragment de chaîne qui pourrait contenir des identifiants.
    return { hote: null, port: null, base: null };
  }
}

/**
 * Vérifie que l'outil de sauvegarde est présent sur l'hôte. Exposé à l'écran
 * État système : sur un hébergeur sans client PostgreSQL installé, la
 * sauvegarde est impossible et l'Admin doit le voir AVANT d'en avoir besoin.
 */
export async function outilSauvegardeDisponible(): Promise<{ disponible: boolean; version: string | null }> {
  try {
    const { stdout } = await execFileAsync(cheminPgDump(), ["--version"], { timeout: 10_000 });
    return { disponible: true, version: stdout.trim() || null };
  } catch {
    return { disponible: false, version: null };
  }
}

/** Nom de fichier horodaté, trié naturellement par date. */
export function nomFichierSauvegarde(date = new Date()): string {
  const h = date.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `lomoto-${h}.dump`;
}

/**
 * Produit le dump en mémoire. On passe par un flux plutôt qu'un fichier
 * temporaire : le téléchargement manuel ne doit laisser AUCUNE copie de la base
 * sur le serveur, et l'envoi vers Drive n'en a pas besoin non plus.
 */
export function construireDump(): Promise<Buffer> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new ErreurSauvegarde(503, "DATABASE_URL n'est pas configurée : impossible de sauvegarder la base.");
  }

  let cible: URL;
  try {
    cible = new URL(url);
  } catch {
    throw new ErreurSauvegarde(500, "DATABASE_URL est illisible : impossible de sauvegarder la base.");
  }
  const base = cible.pathname.replace(/^\//, "");
  if (!base) {
    throw new ErreurSauvegarde(500, "DATABASE_URL ne désigne aucune base de données.");
  }

  return new Promise((resolve, reject) => {
    const args = [
      "--host", cible.hostname,
      "--port", cible.port || "5432",
      "--dbname", base,
      // -Fc : format personnalisé (restaurable par pg_restore) · --no-owner et
      // --no-privileges : le dump se restaure sur une base dont les rôles
      // diffèrent (cas d'une restauration en local depuis la production).
      "-Fc",
      "--no-owner",
      "--no-privileges",
    ];
    if (cible.username) args.push("--username", decodeURIComponent(cible.username));

    const proc = spawn(cheminPgDump(), args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        // Seul canal du mot de passe. `sslmode` doit suivre : Render impose TLS,
        // et l'information ne vit que dans la query string de DATABASE_URL.
        PGPASSWORD: cible.password ? decodeURIComponent(cible.password) : "",
        PGSSLMODE: cible.searchParams.get("sslmode") ?? process.env.PGSSLMODE ?? "prefer",
        // pg_dump est bavard en anglais ou dans la locale de l'hôte : on fige
        // l'anglais pour que les messages d'erreur journalisés restent stables.
        LC_ALL: "C",
      },
    });

    const morceaux: Buffer[] = [];
    let erreurs = "";
    let regle = false;
    proc.stdout.on("data", (c: Buffer) => morceaux.push(c));
    proc.stderr.on("data", (c: Buffer) => {
      erreurs += c.toString();
    });

    // Délai maximal (P0) : un pg_dump qui reste bloqué (hôte injoignable,
    // verrou PostgreSQL jamais libéré) ne doit jamais bloquer indéfiniment la
    // barrière d'écriture. SIGTERM d'abord, puis SIGKILL de secours si le
    // process ignore le signal.
    const delaiMax = delaiMaxPgDumpMs();
    const minuteur = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 2_000).unref();
    }, delaiMax);
    minuteur.unref();

    function regler(fn: () => void) {
      if (regle) return;
      regle = true;
      clearTimeout(minuteur);
      fn();
    }

    proc.on("error", (e) => {
      const absent = (e as NodeJS.ErrnoException).code === "ENOENT";
      regler(() =>
        reject(
          new ErreurSauvegarde(
            503,
            absent
              ? `L'outil pg_dump est introuvable sur ce serveur (${cheminPgDump()}). Installe le client PostgreSQL ou renseigne PG_DUMP_PATH.`
              : `Échec du lancement de pg_dump : ${e.message}`,
          ),
        ),
      );
    });

    proc.on("close", (code, signal) => {
      regler(() => {
        if (signal === "SIGTERM" || signal === "SIGKILL") {
          return reject(
            new ErreurSauvegarde(
              504,
              `pg_dump interrompu après ${delaiMax} ms sans terminer (processus tué proprement) — sauvegarde rejetée.`,
            ),
          );
        }
        if (code !== 0) {
          // On remonte le message de pg_dump tel quel (ex. incompatibilité de
          // version serveur/client) : c'est ce qui rend l'échec actionnable. Il ne
          // contient pas le mot de passe, passé via --dbname et non journalisé.
          return reject(
            new ErreurSauvegarde(500, `pg_dump a échoué (code ${code}) : ${erreurs.trim() || "aucun détail"}`),
          );
        }
        const dump = Buffer.concat(morceaux);
        if (dump.length === 0) {
          return reject(new ErreurSauvegarde(500, "pg_dump n'a produit aucune donnée."));
        }
        resolve(dump);
      });
    });
  });
}

/**
 * Parcourt RÉELLEMENT tout le contenu de l'archive — pas seulement sa table
 * des matières (P0, correctif Codex round 2, 30/08/2026). `pg_restore
 * --list` ne fait que lire l'en-tête/index de l'archive : une table des
 * matières parfaitement lisible n'empêche pas un BLOC DE DONNÉES d'être
 * corrompu plus loin dans le fichier (ex. troncature/corruption après le
 * dernier bloc listé). Sans cible (`--dbname`) mais avec `--file=-`,
 * `pg_restore` reconstruit le flux SQL complet — décodant donc réellement
 * CHAQUE bloc de données — et l'écrit sur stdout au lieu de s'y connecter,
 * qui est ici immédiatement jeté (`resume()`, jamais bufferisé) : aucune
 * connexion à une base, rien n'est exécuté nulle part, seule la capacité de
 * l'archive à être intégralement décodée est vérifiée. `--file` (ou
 * `--dbname`) est OBLIGATOIRE pour ce binaire pg_restore (16.x) — l'omettre
 * complètement fait échouer la commande elle-même (« one of -d/--dbname and
 * -f/--file must be specified »), et non l'archive ; découvert en exécutant
 * ce code contre un VRAI pg_restore, pas en le supposant.
 *
 * Délai maximal borné : un `pg_restore` qui resterait bloqué est tué
 * proprement (SIGTERM puis SIGKILL de secours) et l'archive est rejetée
 * plutôt que de bloquer indéfiniment l'appelant.
 */
function validerContenuComplet(fichier: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cheminPgRestore(), [fichier, "--file", "-"], { stdio: ["ignore", "pipe", "pipe"] });
    let erreurs = "";
    let regle = false;
    // Le flux SQL reconstruit n'intéresse personne ici — seule sa production
    // sans erreur compte. Le laisser s'accumuler gonflerait la mémoire pour
    // rien sur une grosse base ; `resume()` le draine et le jette.
    proc.stdout.resume();
    proc.stderr.on("data", (c: Buffer) => {
      erreurs += c.toString();
    });

    const delaiMax = delaiMaxValidationMs();
    const minuteur = setTimeout(() => {
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 2_000).unref();
    }, delaiMax);
    minuteur.unref();

    function regler(fn: () => void) {
      if (regle) return;
      regle = true;
      clearTimeout(minuteur);
      fn();
    }

    proc.on("error", (e) => {
      const absent = (e as NodeJS.ErrnoException).code === "ENOENT";
      regler(() =>
        reject(
          new ErreurSauvegarde(
            503,
            absent
              ? `L'outil pg_restore est introuvable sur ce serveur (${cheminPgRestore()}). Installe le client PostgreSQL ou renseigne PG_RESTORE_PATH.`
              : `Échec du lancement de pg_restore : ${e.message}`,
          ),
        ),
      );
    });

    proc.on("close", (code, signal) => {
      regler(() => {
        if (signal === "SIGTERM" || signal === "SIGKILL") {
          return reject(
            new ErreurSauvegarde(
              504,
              `Validation complète de l'archive interrompue après ${delaiMax} ms (pg_restore bloqué, tué proprement) — sauvegarde rejetée.`,
            ),
          );
        }
        if (code !== 0) {
          return reject(
            new ErreurSauvegarde(
              500,
              `L'archive de sauvegarde est invalide ou corrompue (parcours complet du flux a échoué) : ${erreurs.trim() || "aucun détail"}`,
            ),
          );
        }
        resolve();
      });
    });
  });
}

/**
 * Valide RÉELLEMENT une archive (P0, section 3.15) : un dump non vide n'est
 * pas la même chose qu'un dump restaurable. `pg_dump` peut réussir (code 0)
 * tout en produisant un fichier tronqué si le process est interrompu APRÈS le
 * dernier octet écrit sur stdout mais avant la fin propre.
 *
 * Deux passes, chacune bornée dans le temps (voir `delaiMaxValidationMs`) :
 *  1. `pg_restore --list` — lit la table des matières, rapide, échoue vite
 *     sur une archive grossièrement tronquée ou totalement illisible ;
 *  2. `validerContenuComplet` — reconstruit le flux SQL COMPLET sans se
 *     connecter à aucune base, détecte un bloc de données corrompu que la
 *     seule table des matières laisserait passer (voir sa doc ci-dessus).
 *
 * LIMITE ASSUMÉE ET DOCUMENTÉE : même ces deux passes ne sont PAS une preuve
 * complète de restaurabilité — seule une restauration réelle réussie (voir
 * `scripts/restaurer-sauvegarde.ts` et sa preuve CI dédiée) le prouve
 * vraiment. `validerDump` élimine les archives tronquées/corrompues
 * détectables sans écrire nulle part ; il ne remplace pas un essai de
 * restauration périodique sur un environnement isolé.
 *
 * Écrit l'archive dans un fichier temporaire (pg_restore ne peut pas lire le
 * format personnalisé -Fc de façon fiable depuis un pipe stdin), le supprime
 * systématiquement ensuite (`finally`).
 */
export async function validerDump(dump: Buffer): Promise<void> {
  if (dump.length === 0) {
    throw new ErreurSauvegarde(500, "L'archive de sauvegarde est vide.");
  }
  const fichierTemporaire = path.join(os.tmpdir(), `lomoto-validation-${randomUUID()}.dump`);
  await fs.writeFile(fichierTemporaire, dump);
  try {
    try {
      const { stdout } = await execFileAsync(cheminPgRestore(), ["--list", fichierTemporaire], {
        timeout: delaiMaxValidationMs(),
        maxBuffer: 1024 * 1024 * 16,
      });
      const entrees = stdout.split("\n").filter((ligne) => ligne.trim().length > 0);
      if (entrees.length === 0) {
        throw new ErreurSauvegarde(500, "L'archive de sauvegarde ne contient aucune entrée exploitable (table des matières vide).");
      }
    } catch (e) {
      if (e instanceof ErreurSauvegarde) throw e;
      const err = e as NodeJS.ErrnoException & { stderr?: string; killed?: boolean; signal?: string | null };
      if (err.code === "ENOENT") {
        throw new ErreurSauvegarde(
          503,
          `L'outil pg_restore est introuvable sur ce serveur (${cheminPgRestore()}). Installe le client PostgreSQL ou renseigne PG_RESTORE_PATH.`,
        );
      }
      if (err.killed || err.signal) {
        throw new ErreurSauvegarde(
          504,
          `Lecture de la table des matières interrompue après ${delaiMaxValidationMs()} ms (pg_restore bloqué, tué proprement) — sauvegarde rejetée.`,
        );
      }
      throw new ErreurSauvegarde(
        500,
        `L'archive de sauvegarde est invalide ou corrompue (pg_restore --list a échoué) : ${err.stderr?.trim() || err.message}`,
      );
    }

    await validerContenuComplet(fichierTemporaire);
  } finally {
    await fs.unlink(fichierTemporaire).catch(() => {});
  }
}
