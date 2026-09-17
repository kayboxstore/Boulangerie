/**
 * Preuves du correctif P0-01, côté câblage de `seed-demo.ts` : la garde
 * d'environnement (testée en détail, comme fonction pure, dans
 * `garde-environnement-seed-demo.test.ts`) est bien appelée ici comme toute
 * première instruction du module, avant tout accès à Prisma.
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

describe("garde d'environnement — câblage réel dans prisma/seed-demo.ts (correctif P0-01)", () => {
  it("refuse réellement de s'exécuter avec NODE_ENV=production, avant tout accès à Prisma", async () => {
    process.env.NODE_ENV = "production";
    // Import dynamique du VRAI module : la garde est la première instruction,
    // donc ce `throw` doit survenir avant même la construction du
    // PrismaClient — aucune connexion réseau n'est tentée. Le module n'est
    // jamais importé ailleurs sous NODE_ENV=production dans cette suite, donc
    // aucun risque de mise en cache d'un état déjà rejeté.
    await expect(import("./seed-demo.js")).rejects.toThrow(/NODE_ENV="production"/);
  });

  it("appelle verifierEnvironnementSeedDemo(process.env) comme toute première instruction, avant new PrismaClient()", () => {
    expect(SOURCE).toContain(
      'import { verifierEnvironnementSeedDemo } from "./garde-environnement-seed-demo.js"',
    );
    const indexGarde = SOURCE.indexOf("verifierEnvironnementSeedDemo(process.env)");
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

  it("package.json distingue db:bootstrap:production et db:seed:demo, via un lanceur Node multiplateforme (round 3)", () => {
    expect(packageJson.scripts["db:bootstrap:production"]).toBe("tsx prisma/bootstrap-production.ts");
    // "node scripts/lancer-seed-demo.mjs" et non une syntaxe shell POSIX
    // (`NODE_ENV="${NODE_ENV:-development}" prisma db seed`, qui échoue sous
    // Windows/cmd.exe) — voir scripts/lancer-seed-demo.mjs et
    // scripts/lancer-seed-demo.test.ts pour la règle "défaut si absent
    // seulement, jamais un écrasement d'un NODE_ENV hérité".
    expect(packageJson.scripts["db:seed:demo"]).toBe("node scripts/lancer-seed-demo.mjs");
    expect(packageJson.scripts["db:seed"]).toBeUndefined();
    expect(packageJson.prisma.seed).toBe("tsx prisma/seed-demo.ts");
  });

  it("render.yaml n'appelle plus le seed de démonstration dans le build de production, et typechecke avant le bootstrap", () => {
    const correspondance = renderYaml.match(/buildCommand:\s*>-\n([\s\S]*?)\n\s*startCommand:/);
    expect(correspondance, "buildCommand introuvable dans render.yaml").not.toBeNull();
    const buildCommand = correspondance![1];
    expect(buildCommand).not.toMatch(/npm run db:seed\b/);
    expect(buildCommand).not.toContain("db:seed:demo");
    expect(buildCommand).toContain("npm run typecheck --workspace apps/api");
    expect(buildCommand).toContain("npm run db:bootstrap:production");
    // Le typecheck doit précéder le bootstrap : sans cet ordre, `tsx` (qui ne
    // vérifie jamais les types) exécuterait le bootstrap avant toute
    // vérification — voir render.yaml et la revue Passe B round 1.
    expect(buildCommand.indexOf("typecheck")).toBeLessThan(buildCommand.indexOf("db:bootstrap:production"));
  });
});
