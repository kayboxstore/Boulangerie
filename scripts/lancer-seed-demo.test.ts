/**
 * Preuves du lanceur multiplateforme `db:seed:demo` — correctif P0-01,
 * round 3 puis round 4 (revue Codex). Testé comme des fonctions PURES,
 * volontairement SANS dépendre de Bash (le point exact que la revue a
 * signalé pour l'ancienne syntaxe shell) : ni `spawnSync`, ni sous-shell,
 * juste les fonctions exportées par `lancer-seed-demo.mjs`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { injecterRepertoireBin, resoudreEntreePrisma, resoudreNodeEnv } from "./lancer-seed-demo.mjs";

const SOURCE = readFileSync(fileURLToPath(new URL("./lancer-seed-demo.mjs", import.meta.url)), "utf-8");

describe("resoudreNodeEnv — défaut SEULEMENT si absent, jamais un écrasement", () => {
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

describe("resoudreEntreePrisma — résolution de la VRAIE entrée JS du CLI (round 4, point 1)", () => {
  it("résout node_modules/prisma/build/index.js — un fichier qui existe réellement et est exécutable par Node", () => {
    const entree = resoudreEntreePrisma(import.meta.url);
    expect(entree.endsWith(path.join("prisma", "build", "index.js"))).toBe(true);
    // Preuve la plus forte : le fichier résolu existe RÉELLEMENT sur disque
    // (contrairement à un chemin de binaire .cmd deviné à la main, jamais
    // vérifié — exactement le bug signalé en revue round 4).
    expect(() => readFileSync(entree, "utf-8")).not.toThrow();
  });

  it("ne résout jamais vers un .cmd/.sh/binaire shim — seulement du JavaScript exécutable par process.execPath", () => {
    const entree = resoudreEntreePrisma(import.meta.url);
    expect(entree.endsWith(".cmd")).toBe(false);
    expect(entree.endsWith(".sh")).toBe(false);
    expect(entree.endsWith(".js")).toBe(true);
  });
});

describe("injecterRepertoireBin — PATH augmenté, quelle que soit la casse de la clé existante", () => {
  it("étend PATH (POSIX) sans le dupliquer", () => {
    const resultat = injecterRepertoireBin({ PATH: "/usr/bin" }, "/repo/node_modules/.bin");
    expect(resultat.PATH).toBe(`/repo/node_modules/.bin${path.delimiter}/usr/bin`);
    expect(Object.keys(resultat)).toEqual(["PATH"]);
  });

  it("retrouve une clé Path en casse différente (Windows) plutôt que d'en créer une seconde", () => {
    const resultat = injecterRepertoireBin({ Path: "C:\\Windows\\System32" }, "C:\\repo\\node_modules\\.bin");
    expect(resultat.Path).toBe(`C:\\repo\\node_modules\\.bin${path.delimiter}C:\\Windows\\System32`);
    expect(Object.keys(resultat)).toEqual(["Path"]);
    expect(resultat.PATH).toBeUndefined();
  });

  it("crée PATH si totalement absent", () => {
    const resultat = injecterRepertoireBin({}, "/repo/node_modules/.bin");
    expect(resultat.PATH).toBe("/repo/node_modules/.bin");
  });

  it("préserve les autres variables d'environnement inchangées", () => {
    const resultat = injecterRepertoireBin({ PATH: "/usr/bin", DATABASE_URL: "postgresql://x" }, "/bin");
    expect(resultat.DATABASE_URL).toBe("postgresql://x");
  });
});

describe("lancer-seed-demo.mjs — câblage et robustesse (preuves statiques, round 4)", () => {
  it("n'utilise aucune syntaxe shell POSIX (substitution de paramètre) DANS LE CODE", () => {
    // Le docblock d'en-tête cite volontairement l'ancienne syntaxe en prose
    // pour expliquer ce qui a été remplacé — on ne vérifie donc que le CODE.
    const codeSansCommentaires = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeSansCommentaires).not.toContain("${NODE_ENV:-");
    expect(codeSansCommentaires).not.toMatch(/NODE_ENV="\$\{/);
  });

  it("utilise pathToFileURL pour la détection d'entrypoint (même précaution que bootstrap-production.ts)", () => {
    expect(SOURCE).toContain('import { pathToFileURL } from "node:url"');
    expect(SOURCE).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
    const codeSansCommentaires = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeSansCommentaires).not.toContain("file://${process.argv[1]}");
  });

  it("exécute l'entrée Prisma via process.execPath — jamais un .cmd, jamais npx, jamais shell:true (round 4, point 1)", () => {
    expect(SOURCE).toContain("spawnSync(process.execPath, [entreePrisma");
    // Le docblock d'en-tête cite volontairement ".cmd"/"shell: true"/"npx" en
    // prose pour expliquer ce qui a été remplacé — on ne vérifie que le CODE.
    const codeSansCommentaires = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codeSansCommentaires).not.toContain('"npx"');
    expect(codeSansCommentaires).not.toContain("shell: true");
    expect(codeSansCommentaires).not.toContain("shell:true");
    expect(codeSansCommentaires).not.toContain(".cmd");
  });

  it("injecte node_modules/.bin dans PATH avant de spawn (nécessaire : le CLI Prisma spawn lui-même `tsx`)", () => {
    expect(SOURCE).toContain("injecterRepertoireBin(process.env,");
    expect(SOURCE).toContain('"node_modules", ".bin"');
  });
});
