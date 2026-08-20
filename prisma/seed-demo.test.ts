/**
 * Preuves du correctif P0-01, côté garde de production de `seed-demo.ts` :
 * ce script ne doit jamais pouvoir s'exécuter contre une base de production,
 * sans aucun contournement possible.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const CHEMIN_SOURCE = fileURLToPath(new URL("./seed-demo.ts", import.meta.url));
const SOURCE = readFileSync(CHEMIN_SOURCE, "utf-8");
const NODE_ENV_ORIGINAL = process.env.NODE_ENV;

afterEach(() => {
  if (NODE_ENV_ORIGINAL === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = NODE_ENV_ORIGINAL;
});

describe("garde de production — prisma/seed-demo.ts (correctif P0-01)", () => {
  it("refuse de s'exécuter avec NODE_ENV=production, avant tout accès à Prisma", async () => {
    process.env.NODE_ENV = "production";
    // Import dynamique : la garde est la première instruction du module, donc
    // ce `throw` doit survenir avant même la construction du PrismaClient —
    // aucune connexion réseau n'est tentée. Le module n'est jamais importé
    // ailleurs sous NODE_ENV=production dans cette suite, donc aucun risque
    // de mise en cache d'un état déjà rejeté.
    await expect(import("./seed-demo.js")).rejects.toThrow(/NODE_ENV=production/);
  });

  it("le message de la garde oriente explicitement vers le bootstrap de production", async () => {
    process.env.NODE_ENV = "production";
    await expect(import("./seed-demo.js")).rejects.toThrow(/db:bootstrap:production/);
  });

  it("la garde ne comporte aucune variable d'environnement de contournement", () => {
    const debut = SOURCE.indexOf('if (process.env.NODE_ENV === "production")');
    expect(debut).toBeGreaterThan(-1);
    const fin = SOURCE.indexOf("\n}", debut);
    expect(fin).toBeGreaterThan(debut);
    const blocGarde = SOURCE.slice(debut, fin);
    // Aucune autre variable d'environnement ne doit intervenir dans la
    // condition (ex. un `SEED_FORCE=true` qui désactiverait la garde).
    const referencesEnv = blocGarde.match(/process\.env\.\w+/g) ?? [];
    expect(referencesEnv).toEqual(["process.env.NODE_ENV"]);
  });

  it("la garde est la toute première instruction exécutée, avant la création du client Prisma", () => {
    const indexGarde = SOURCE.indexOf('if (process.env.NODE_ENV === "production")');
    const indexPrismaClient = SOURCE.indexOf("new PrismaClient()");
    expect(indexGarde).toBeGreaterThan(-1);
    expect(indexPrismaClient).toBeGreaterThan(-1);
    expect(indexGarde).toBeLessThan(indexPrismaClient);
  });

  it("délègue la matrice de rôles et les motifs fixes à bootstrap-production.ts (source unique)", () => {
    expect(SOURCE).toContain('import { bootstrapProduction } from "./bootstrap-production.js"');
    expect(SOURCE).toContain("await bootstrapProduction(prisma)");
  });
});

describe("câblage du déploiement — le chemin de production n'invoque plus le seed de démonstration", () => {
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf-8"),
  );
  const renderYaml = readFileSync(fileURLToPath(new URL("../render.yaml", import.meta.url)), "utf-8");

  it("package.json distingue db:bootstrap:production et db:seed:demo", () => {
    expect(packageJson.scripts["db:bootstrap:production"]).toBe("tsx prisma/bootstrap-production.ts");
    expect(packageJson.scripts["db:seed:demo"]).toBe("prisma db seed");
    expect(packageJson.scripts["db:seed"]).toBeUndefined();
    expect(packageJson.prisma.seed).toBe("tsx prisma/seed-demo.ts");
  });

  it("render.yaml n'appelle plus le seed de démonstration dans le build de production", () => {
    const correspondance = renderYaml.match(/buildCommand:\s*>-\n([\s\S]*?)\n\s*startCommand:/);
    expect(correspondance, "buildCommand introuvable dans render.yaml").not.toBeNull();
    const buildCommand = correspondance![1];
    expect(buildCommand).not.toMatch(/npm run db:seed\b/);
    expect(buildCommand).not.toContain("db:seed:demo");
    expect(buildCommand).toContain("npm run db:bootstrap:production");
  });
});
