/**
 * Garde d'environnement du seed de démonstration — correctif P0-01, round 2
 * (revue indépendante « P1-02 »).
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
 * Second verrou indépendant du premier : même avec un `NODE_ENV` autorisé,
 * un simple `DATABASE_URL` distant reste refusé — sans lui, changer
 * accidentellement `NODE_ENV=development` sur un déploiement dont la
 * variable pointerait vers une base distante réelle suffirait à seeder cette
 * base. L'hôte doit être local, ou l'opérateur doit le confirmer
 * explicitement (voir `SEED_DEMO_HOTE_DISTANT_AUTORISE`).
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
  /** Opt-in explicite, jamais un simple changement de NODE_ENV : voir l'en-tête. */
  SEED_DEMO_HOTE_DISTANT_AUTORISE?: string;
}

/**
 * Lève si l'environnement n'est pas explicitement autorisé à exécuter le seed
 * de démonstration. Doit être appelée comme toute première instruction de
 * `prisma/seed-demo.ts`, avant tout import à effet de bord et avant toute
 * construction de `PrismaClient` — voir `seed-demo.test.ts` pour la preuve
 * d'ordre d'exécution.
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

  const hoteAutorise = hoteEstLocal(env.DATABASE_URL ?? "") || env.SEED_DEMO_HOTE_DISTANT_AUTORISE === "true";
  if (!hoteAutorise) {
    throw new Error(
      "prisma/seed-demo.ts refuse de s'exécuter : DATABASE_URL ne pointe pas vers un hôte local " +
        "(localhost/127.0.0.1/::1). Un NODE_ENV autorisé ne suffit jamais, seul, à seeder une base distante — " +
        "si cette base est réellement une base de test jetable, confirmez-le explicitement avec " +
        "SEED_DEMO_HOTE_DISTANT_AUTORISE=true.",
    );
  }
}
