/**
 * Preuves du lanceur multiplateforme `db:seed:demo` — correctif P0-01,
 * round 3 (revue Codex, point 2). Testé comme des fonctions PURES,
 * volontairement SANS dépendre de Bash (le point exact que la revue a
 * signalé pour l'ancienne syntaxe shell) : ni `spawnSync`, ni sous-shell,
 * juste les deux fonctions exportées par `lancer-seed-demo.mjs`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resoudreCheminPrisma, resoudreNodeEnv } from "./lancer-seed-demo.mjs";

const SOURCE = readFileSync(fileURLToPath(new URL("./lancer-seed-demo.mjs", import.meta.url)), "utf-8");

describe("resoudreNodeEnv — défaut SEULEMENT si absent, jamais un écrasement (round 3, point 2)", () => {
  it('devient "development" si NODE_ENV est absent (undefined)', () => {
    expect(resoudreNodeEnv(undefined)).toBe("development");
  });

  it('devient "development" si NODE_ENV est une chaîne vide', () => {
    expect(resoudreNodeEnv("")).toBe("development");
  });

  it("préserve NODE_ENV=production hérité — ne l'écrase JAMAIS", () => {
    expect(resoudreNodeEnv("production")).toBe("production");
  });

  it("préserve NODE_ENV=test hérité", () => {
    expect(resoudreNodeEnv("test")).toBe("test");
  });

  it("préserve NODE_ENV=staging hérité (même une valeur que la garde refusera ensuite — ce n'est pas le rôle de ce lanceur de la corriger)", () => {
    expect(resoudreNodeEnv("staging")).toBe("staging");
  });
});

describe("resoudreCheminPrisma — résolution cross-plateforme du binaire local", () => {
  // `path.win32`/`path.posix` explicites (pas `path.join` ambiant) : preuve
  // du VRAI format de chemin Windows (séparateurs `\`), vérifiable même en
  // exécutant cette suite sur une machine Linux — voir le commentaire dans
  // lancer-seed-demo.mjs.
  it("utilise prisma.cmd avec des séparateurs Windows (win32), même testé depuis un autre OS", () => {
    expect(resoudreCheminPrisma("C:\\repo", "win32")).toBe(
      path.win32.join("C:\\repo", "node_modules", ".bin", "prisma.cmd"),
    );
    expect(resoudreCheminPrisma("C:\\repo", "win32")).toBe("C:\\repo\\node_modules\\.bin\\prisma.cmd");
  });

  it("utilise prisma (sans extension) avec des séparateurs POSIX sous Linux", () => {
    expect(resoudreCheminPrisma("/repo", "linux")).toBe(path.posix.join("/repo", "node_modules", ".bin", "prisma"));
    expect(resoudreCheminPrisma("/repo", "linux")).toBe("/repo/node_modules/.bin/prisma");
  });

  it("utilise prisma (sans extension) avec des séparateurs POSIX sous macOS (darwin)", () => {
    expect(resoudreCheminPrisma("/repo", "darwin")).toBe("/repo/node_modules/.bin/prisma");
  });
});

describe("lancer-seed-demo.mjs — câblage et robustesse (preuves statiques)", () => {
  it("n'utilise aucune syntaxe shell POSIX (substitution de paramètre, guillemets imbriqués) DANS LE CODE", () => {
    // Le docblock d'en-tête cite volontairement l'ancienne syntaxe en prose
    // pour expliquer ce qui a été remplacé — on ne vérifie donc que le CODE.
    const codeSansCommentaires = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeSansCommentaires).not.toContain("${NODE_ENV:-");
    expect(codeSansCommentaires).not.toMatch(/NODE_ENV="\$\{/);
  });

  it("utilise pathToFileURL pour la détection d'entrypoint (round 3, point 2 — même précaution que bootstrap-production.ts)", () => {
    expect(SOURCE).toContain('import { pathToFileURL } from "node:url"');
    expect(SOURCE).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
    // Retire les commentaires (`//...`) avant de vérifier l'absence du motif
    // dans le CODE : le docblock d'en-tête le cite volontairement en prose
    // pour expliquer ce qui a été remplacé.
    const codeSansCommentaires = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeSansCommentaires).not.toContain("file://${process.argv[1]}");
  });

  it("invoque le binaire prisma local directement, jamais via npx", () => {
    expect(SOURCE).not.toContain('"npx"');
    expect(SOURCE).toContain("spawnSync(cheminPrisma");
  });
});
