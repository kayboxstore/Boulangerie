/**
 * Preuves du correctif P0-01 (round 2, P1-02) : la garde d'environnement du
 * seed de démonstration est testée ici comme une fonction PURE — aucun accès
 * Prisma, aucun risque de déclencher `main()` ou `process.exit()` contre une
 * vraie base, contrairement à un import complet de `seed-demo.ts`.
 */
import { describe, expect, it } from "vitest";
import { verifierEnvironnementSeedDemo } from "./garde-environnement-seed-demo.js";

const LOCAL = "postgresql://postgres:x@localhost:5432/lomoto_dev";
const LOCAL_127 = "postgresql://postgres:x@127.0.0.1:5432/lomoto_dev";
const DISTANT = "postgresql://postgres:x@db.production-lomoto.example.com:5432/lomoto";

describe("verifierEnvironnementSeedDemo — liste blanche (correctif P1-02)", () => {
  it("refuse NODE_ENV=production, même avec un DATABASE_URL local", () => {
    expect(() =>
      verifierEnvironnementSeedDemo({ NODE_ENV: "production", DATABASE_URL: LOCAL }),
    ).toThrow(/NODE_ENV="production"/);
  });

  it("refuse un NODE_ENV absent (liste blanche : pas de valeur par défaut permissive)", () => {
    expect(() => verifierEnvironnementSeedDemo({ DATABASE_URL: LOCAL })).toThrow(/NODE_ENV=\(absent\)/);
  });

  it("refuse NODE_ENV=staging", () => {
    expect(() => verifierEnvironnementSeedDemo({ NODE_ENV: "staging", DATABASE_URL: LOCAL })).toThrow(
      /NODE_ENV="staging"/,
    );
  });

  it("refuse NODE_ENV=preview", () => {
    expect(() => verifierEnvironnementSeedDemo({ NODE_ENV: "preview", DATABASE_URL: LOCAL })).toThrow(
      /NODE_ENV="preview"/,
    );
  });

  it("refuse un DATABASE_URL distant même avec NODE_ENV=development (un NODE_ENV autorisé seul ne suffit jamais)", () => {
    expect(() => verifierEnvironnementSeedDemo({ NODE_ENV: "development", DATABASE_URL: DISTANT })).toThrow(
      /ne pointe pas vers un hôte local/,
    );
  });

  it("refuse un DATABASE_URL distant même avec NODE_ENV=test", () => {
    expect(() => verifierEnvironnementSeedDemo({ NODE_ENV: "test", DATABASE_URL: DISTANT })).toThrow(
      /ne pointe pas vers un hôte local/,
    );
  });

  it("refuse un DATABASE_URL absent (ni local ni explicitement autorisé)", () => {
    expect(() => verifierEnvironnementSeedDemo({ NODE_ENV: "development" })).toThrow(
      /ne pointe pas vers un hôte local/,
    );
  });

  it("autorise NODE_ENV=development avec un DATABASE_URL local (localhost)", () => {
    expect(() => verifierEnvironnementSeedDemo({ NODE_ENV: "development", DATABASE_URL: LOCAL })).not.toThrow();
  });

  it("autorise NODE_ENV=test avec un DATABASE_URL local (127.0.0.1)", () => {
    expect(() => verifierEnvironnementSeedDemo({ NODE_ENV: "test", DATABASE_URL: LOCAL_127 })).not.toThrow();
  });

  it("autorise un DATABASE_URL distant UNIQUEMENT avec l'opt-in explicite SEED_DEMO_HOTE_DISTANT_AUTORISE=true", () => {
    expect(() =>
      verifierEnvironnementSeedDemo({
        NODE_ENV: "test",
        DATABASE_URL: DISTANT,
        SEED_DEMO_HOTE_DISTANT_AUTORISE: "true",
      }),
    ).not.toThrow();
  });

  it("l'opt-in distant n'importe quelle valeur autre que la chaîne exacte \"true\" reste refusé", () => {
    expect(() =>
      verifierEnvironnementSeedDemo({
        NODE_ENV: "test",
        DATABASE_URL: DISTANT,
        SEED_DEMO_HOTE_DISTANT_AUTORISE: "1",
      }),
    ).toThrow(/ne pointe pas vers un hôte local/);
  });

  it("l'opt-in distant ne contourne jamais la vérification NODE_ENV", () => {
    expect(() =>
      verifierEnvironnementSeedDemo({
        NODE_ENV: "production",
        DATABASE_URL: DISTANT,
        SEED_DEMO_HOTE_DISTANT_AUTORISE: "true",
      }),
    ).toThrow(/NODE_ENV="production"/);
  });
});
