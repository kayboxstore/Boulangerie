/**
 * Garde de `scripts/verifier-integration-bootstrap-ci.ts` — correctif P0-01,
 * round 3 (revue Codex, point 3).
 *
 * Ce script d'intégration effectue de VRAIES écritures, y compris des
 * scénarios destructifs volontaires (modification d'une permission,
 * suppression d'une permission, invalidation d'une hiérarchie de rôle, échec
 * de transaction injecté délibérément). Sans garde, rien n'empêchait de le
 * lancer par erreur contre une base de développement réelle (perte de
 * travail) ou, pire, une base distante.
 *
 * Fonction PURE (aucun accès Prisma, aucune E/S) — doit être appelée AVANT
 * toute construction de `PrismaClient`, toute connexion, toute requête.
 *
 * Exige SIMULTANÉMENT, sans aucune exception :
 *  - un hôte local (`localhost`/`127.0.0.1`/`::1`) ;
 *  - le nom de base EXACT `lomoto_ci` — celui du service PostgreSQL jetable
 *    défini dans `.github/workflows/ci.yml` (`POSTGRES_DB: lomoto_ci`), pas
 *    une base de développement réelle au nom arbitraire ;
 *  - une confirmation explicite PROPRE à ce script :
 *    `CI_INTEGRATION_BOOTSTRAP_CONFIRME=true` — volontairement absente de
 *    `.env.example` et de tout script npm autre que l'étape CI dédiée, pour
 *    qu'elle ne soit jamais activée par erreur ou par habitude.
 *
 * Round 2 : la mise en base de la vérification en CI. Round 3 : cette garde
 * elle-même, corrigeant l'absence de vérification de cible avant écriture.
 */

const NOM_BASE_JETABLE_ATTENDU = "lomoto_ci";
const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1", "::1"]);

export interface EnvironnementIntegrationCI {
  DATABASE_URL?: string;
  CI_INTEGRATION_BOOTSTRAP_CONFIRME?: string;
}

function analyserDatabaseUrl(databaseUrl: string): { hostname: string; nomBase: string } | null {
  try {
    const url = new URL(databaseUrl);
    return {
      hostname: url.hostname.toLowerCase().replace(/^\[|\]$/g, ""),
      nomBase: url.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}

/**
 * Lève si l'environnement n'est pas explicitement et exactement celui de la
 * base jetable de CI. Doit être appelée comme toute première instruction du
 * script — voir `verifier-integration-bootstrap-ci.ts`.
 */
export function verifierEnvironnementIntegrationCI(
  env: EnvironnementIntegrationCI,
  nomScript = "scripts/verifier-integration-bootstrap-ci.ts",
): void {
  if (env.CI_INTEGRATION_BOOTSTRAP_CONFIRME !== "true") {
    throw new Error(
      `${nomScript} refuse de s'exécuter : CI_INTEGRATION_BOOTSTRAP_CONFIRME doit ` +
        'valoir exactement "true". Ce script effectue de VRAIES écritures (round 6 : y compris des écritures ' +
        "concurrentes délibérées) — cette confirmation, propre à ce script, évite qu'il soit lancé par erreur " +
        "contre une base qui compte.",
    );
  }

  const analyse = analyserDatabaseUrl(env.DATABASE_URL ?? "");
  if (!analyse || !HOTES_LOCAUX.has(analyse.hostname)) {
    throw new Error(
      `${nomScript} refuse de s'exécuter : DATABASE_URL ne pointe pas vers un ` +
        "hôte local (localhost/127.0.0.1/::1). Aucune exception distante n'existe — ce script écrit et supprime " +
        "des données réelles.",
    );
  }

  if (analyse.nomBase !== NOM_BASE_JETABLE_ATTENDU) {
    throw new Error(
      `${nomScript} refuse de s'exécuter : le nom de base dans DATABASE_URL doit ` +
        `être exactement "${NOM_BASE_JETABLE_ATTENDU}" (trouvé "${analyse.nomBase}") — réservé à la base jetable ` +
        "du service PostgreSQL de la CI, jamais une base de développement réelle.",
    );
  }
}
