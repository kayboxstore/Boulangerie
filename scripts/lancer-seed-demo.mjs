#!/usr/bin/env node
/**
 * Lanceur multiplateforme pour `npm run db:seed:demo` — correctif P0-01,
 * round 3 (revue Codex, point 2).
 *
 * Remplace l'ancienne syntaxe shell POSIX
 * `NODE_ENV="${NODE_ENV:-development}" prisma db seed` : cette syntaxe de
 * substitution de paramètre échoue sous Windows/cmd.exe, le shell utilisé
 * par défaut par npm sur cet OS pour exécuter les scripts — le seed de
 * démonstration ne serait alors même pas atteint.
 *
 * Règle strictement conservée (identique à l'ancien script, testée dans
 * `scripts/lancer-seed-demo.test.ts`) : `NODE_ENV` ne devient `"development"`
 * QUE s'il est absent — une valeur déjà présente dans l'environnement (ex.
 * `"production"`, héritée par erreur d'un shell CI/déploiement) n'est
 * JAMAIS écrasée, pour ne jamais désactiver silencieusement la garde de
 * `prisma/garde-environnement-seed-demo.ts`.
 *
 * Invoque directement le binaire local `node_modules/.bin/prisma` (résolu
 * cross-plateforme) plutôt que `npx`, pour éviter les particularités
 * supplémentaires de résolution de `npx` selon l'OS.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** NODE_ENV ne prend "development" que s'il est absent — jamais un écrasement. */
export function resoudreNodeEnv(nodeEnvActuel) {
  return nodeEnvActuel && nodeEnvActuel.length > 0 ? nodeEnvActuel : "development";
}

/**
 * Chemin du binaire prisma local, cross-plateforme. Utilise explicitement
 * `path.win32`/`path.posix` selon le paramètre `plateforme` (pas `path.join`
 * ambiant, qui ne reflète que l'OS d'exécution RÉEL) — ainsi cette fonction
 * produit un vrai chemin Windows (séparateurs `\`) même testée depuis Linux,
 * ce qui rend le comportement Windows vérifiable sans machine Windows.
 */
export function resoudreCheminPrisma(cwd, plateforme) {
  const nomBinaire = plateforme === "win32" ? "prisma.cmd" : "prisma";
  const implementationChemin = plateforme === "win32" ? path.win32 : path.posix;
  return implementationChemin.join(cwd, "node_modules", ".bin", nomBinaire);
}

// --- Exécution directe uniquement (`node scripts/lancer-seed-demo.mjs`) ---
// Même construction robuste que `prisma/bootstrap-production.ts` (round 3,
// point 2) — jamais de comparaison manuelle `file://${process.argv[1]}`,
// qui échoue sous Windows et pour tout chemin nécessitant un encodage URL.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = { ...process.env, NODE_ENV: resoudreNodeEnv(process.env.NODE_ENV) };
  const cheminPrisma = resoudreCheminPrisma(process.cwd(), process.platform);

  if (!existsSync(cheminPrisma)) {
    console.error(`Binaire prisma introuvable : ${cheminPrisma} — as-tu lancé \`npm ci\` ?`);
    process.exit(1);
  }

  const resultat = spawnSync(cheminPrisma, ["db", "seed"], { env, stdio: "inherit" });
  process.exit(resultat.status ?? 1);
}
