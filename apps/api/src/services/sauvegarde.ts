import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

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

/** Chemin de l'exécutable pg_dump ; surchargeable si l'hôte le range ailleurs. */
const PG_DUMP = process.env.PG_DUMP_PATH ?? "pg_dump";

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
    const { stdout } = await execFileAsync(PG_DUMP, ["--version"], { timeout: 10_000 });
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

    const proc = spawn(PG_DUMP, args, {
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
    proc.stdout.on("data", (c: Buffer) => morceaux.push(c));
    proc.stderr.on("data", (c: Buffer) => {
      erreurs += c.toString();
    });

    proc.on("error", (e) => {
      const absent = (e as NodeJS.ErrnoException).code === "ENOENT";
      reject(
        new ErreurSauvegarde(
          503,
          absent
            ? `L'outil pg_dump est introuvable sur ce serveur (${PG_DUMP}). Installe le client PostgreSQL ou renseigne PG_DUMP_PATH.`
            : `Échec du lancement de pg_dump : ${e.message}`,
        ),
      );
    });

    proc.on("close", (code) => {
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
}
