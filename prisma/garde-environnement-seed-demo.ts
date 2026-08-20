/**
 * Garde d'environnement du seed de démonstration — correctif P0-01, round 3
 * (revue indépendante « P1-02 », puis revue Codex round 3 « point 1 »).
 *
 * Fonction PURE (aucun accès Prisma, aucune E/S) volontairement extraite de
 * `prisma/seed-demo.ts` pour être testable sans jamais construire de
 * `PrismaClient` ni risquer d'exécuter `main()` contre une base réelle.
 *
 * Liste BLANCHE, pas liste noire : la version round 1 ne refusait que
 * `NODE_ENV === "production"` — un `NODE_ENV` absent, mal orthographié, ou
 * une valeur intermédiaire (`staging`, `preview`) passait donc SILENCIEUSEMENT
 * la garde. Ici, seules deux valeurs exactes sont explicitement autorisées ;
 * tout le reste (y compris l'absence de la variable) est refusé par défaut.
 *
 * Second verrou INDÉPENDANT et SANS EXCEPTION : même avec un `NODE_ENV`
 * autorisé, un `DATABASE_URL` distant est refusé — sans exception, sans
 * variable de contournement d'aucune sorte. Une version antérieure de cette
 * garde offrait un opt-in par variable d'environnement pour un hôte distant ;
 * jugé inacceptable en revue pour un script qui crée des comptes à mot de
 * passe connu et réattribue `estAdminPrincipal` — un opt-in reste un
 * contournement, même nommé explicitement. Il a donc été entièrement retiré
 * — code, tests et documentation, sans laisser de trace du nom de cette
 * variable dans ce fichier (vérifié par `garde-environnement-seed-demo.test.ts`).
 * Un besoin futur d'environnement de démonstration distant devra passer par
 * un mécanisme séparé, sans identifiants fixes, hors
 * périmètre de ce fichier.
 */

const ENVIRONNEMENTS_AUTORISES = new Set(["development", "test"]);
const HOTES_LOCAUX = new Set(["localhost", "127.0.0.1", "::1"]);

function hoteEstLocal(databaseUrl: string): boolean {
  if (!databaseUrl) return false;
  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    return false;
  }
  // `postgresql://` n'est pas un schéma "spécial" pour l'implémentation WHATWG
  // URL de Node — contrairement à http(s), le hostname n'est ni mis en
  // minuscules, ni dépouillé de ses crochets IPv6 automatiquement (vérifié :
  // `new URL("postgresql://u@LOCALHOST/d").hostname === "LOCALHOST"`,
  // `new URL("postgresql://u@[::1]/d").hostname === "[::1]"`). Sans cette
  // normalisation, un DATABASE_URL local mais écrit `LOCALHOST` ou `[::1]`
  // serait refusé à tort (échec fermé, pas une faille — mais une gêne réelle
  // pour un développeur dont le shell/l'outil produit ces variantes).
  return HOTES_LOCAUX.has(hostname.toLowerCase().replace(/^\[|\]$/g, ""));
}

/** Sous-ensemble de `process.env` nécessaire à la décision — passé explicitement pour rester testable sans mock global. */
export interface EnvironnementSeedDemo {
  NODE_ENV?: string;
  DATABASE_URL?: string;
}

/**
 * Lève si l'environnement n'est pas explicitement autorisé à exécuter le seed
 * de démonstration. Doit être appelée comme toute première instruction de
 * `prisma/seed-demo.ts`, avant tout import à effet de bord et avant toute
 * construction de `PrismaClient` — voir `seed-demo.test.ts` pour la preuve
 * d'ordre d'exécution.
 *
 * SANS EXCEPTION : un `DATABASE_URL` distant est toujours refusé, quel que
 * soit `NODE_ENV` — il n'existe aucune variable d'environnement, aucun
 * paramètre, aucun mécanisme pour contourner cette vérification.
 */
export function verifierEnvironnementSeedDemo(env: EnvironnementSeedDemo): void {
  const nodeEnv = env.NODE_ENV;
  if (!nodeEnv || !ENVIRONNEMENTS_AUTORISES.has(nodeEnv)) {
    throw new Error(
      `prisma/seed-demo.ts refuse de s'exécuter : NODE_ENV=${nodeEnv ? `"${nodeEnv}"` : "(absent)"} — seuls ` +
        `"development" et "test" sont explicitement autorisés (liste blanche, pas liste noire). Ce script crée ` +
        `des comptes à mot de passe connu et des données fictives, réservés au développement/test. Utilisez ` +
        "`npm run db:bootstrap:production` pour une base de production (voir prisma/bootstrap-production.ts).",
    );
  }

  if (!hoteEstLocal(env.DATABASE_URL ?? "")) {
    throw new Error(
      "prisma/seed-demo.ts refuse de s'exécuter : DATABASE_URL ne pointe pas vers un hôte local " +
        "(localhost/127.0.0.1/::1). Aucune exception n'existe pour un hôte distant, quel que soit NODE_ENV — " +
        "ce script crée des comptes à mot de passe connu et réattribue estAdminPrincipal.",
    );
  }
}
