#!/usr/bin/env node
/**
 * Lanceur multiplateforme pour `npm run db:seed:demo` — correctif P0-01,
 * round 3 puis round 4 (revue Codex).
 *
 * Remplace l'ancienne syntaxe shell POSIX
 * `NODE_ENV="${NODE_ENV:-development}" prisma db seed` : cette syntaxe de
 * substitution de paramètre échoue sous Windows/cmd.exe, le shell utilisé
 * par défaut par npm sur cet OS pour exécuter les scripts.
 *
 * Round 4 (revue Codex) : la version round 3 résolvait puis exécutait
 * `node_modules/.bin/prisma.cmd` via `spawnSync(cheminPrisma, ...)` SANS
 * shell — sous Windows, un `.cmd` n'est PAS un exécutable natif (c'est un
 * script de commandes), `spawnSync` sans `shell: true` ne sait pas
 * l'interpréter et échoue. Corrigé en évitant tout binaire `.cmd`/`.sh` :
 * on résout directement l'ENTRÉE JAVASCRIPT du CLI Prisma via la résolution
 * de modules Node elle-même (`createRequire(...).resolve(...)`), puis on
 * l'exécute avec `process.execPath` (le binaire Node courant) — un
 * mécanisme strictement identique sur toutes les plateformes, jamais un
 * script shell, jamais `shell: true`, jamais `npx`.
 *
 * Règle strictement conservée (identique aux rounds précédents, testée dans
 * `scripts/lancer-seed-demo.test.ts`) : `NODE_ENV` ne devient `"development"`
 * QUE s'il est absent — une valeur déjà présente dans l'environnement (ex.
 * `"production"`, héritée par erreur d'un shell CI/déploiement) n'est
 * JAMAIS écrasée, pour ne jamais désactiver silencieusement la garde de
 * `prisma/garde-environnement-seed-demo.ts`.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** NODE_ENV ne prend "development" que s'il est absent — jamais un écrasement. */
export function resoudreNodeEnv(nodeEnvActuel) {
  return nodeEnvActuel && nodeEnvActuel.length > 0 ? nodeEnvActuel : "development";
}

/**
 * Résout l'entrée JavaScript RÉELLE du CLI Prisma (`node_modules/prisma/build/index.js`)
 * via la résolution de modules Node — jamais un chemin de binaire deviné à la
 * main (`.cmd`/`.sh`/sans extension). `createRequire(...).resolve(...)` suit
 * le `package.json#exports` du paquet `prisma`, garanti correct quelle que
 * soit la plateforme, contrairement à une supposition sur l'emplacement des
 * shims de `node_modules/.bin`.
 */
export function resoudreEntreePrisma(requireDepuis) {
  return createRequire(requireDepuis).resolve("prisma/build/index.js");
}

/**
 * Ajoute `repertoireBin` en tête de la variable PATH de `env`, en retrouvant
 * la CLÉ RÉELLE de cette variable (`PATH` sur POSIX, mais potentiellement
 * `Path` sur Windows selon l'environnement d'où le process a hérité) plutôt
 * que de supposer `"PATH"` — un nom de clé différent créerait une seconde
 * variable au lieu d'étendre l'existante. Nécessaire parce que le CLI Prisma
 * lui-même exécute `tsx` en le cherchant sur PATH (`spawn tsx ENOENT` sinon) —
 * `npm run` l'ajoute automatiquement, un `spawnSync` direct ne l'hérite pas.
 */
export function injecterRepertoireBin(env, repertoireBin) {
  const cleExistante = Object.keys(env).find((cle) => cle.toUpperCase() === "PATH") ?? "PATH";
  const valeurExistante = env[cleExistante];
  return {
    ...env,
    [cleExistante]: valeurExistante ? `${repertoireBin}${path.delimiter}${valeurExistante}` : repertoireBin,
  };
}

// --- Exécution directe uniquement (`node scripts/lancer-seed-demo.mjs`) ---
// Même construction robuste que `prisma/bootstrap-production.ts` (round 3,
// point 2) — jamais de comparaison manuelle `file://${process.argv[1]}`,
// qui échoue sous Windows et pour tout chemin nécessitant un encodage URL.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let entreePrisma;
  try {
    entreePrisma = resoudreEntreePrisma(import.meta.url);
  } catch (e) {
    console.error(`Impossible de résoudre le CLI Prisma — as-tu lancé \`npm ci\` ? (${e.message})`);
    process.exit(1);
  }

  const envDeBase = injecterRepertoireBin(process.env, path.join(process.cwd(), "node_modules", ".bin"));
  const env = { ...envDeBase, NODE_ENV: resoudreNodeEnv(process.env.NODE_ENV) };

  // process.execPath (le binaire Node courant), pas `prisma`/`prisma.cmd`/`npx` :
  // aucun shell, aucune interprétation de script, identique sur toute plateforme.
  const resultat = spawnSync(process.execPath, [entreePrisma, "db", "seed"], { env, stdio: "inherit" });
  process.exit(resultat.status ?? 1);
}
