/**
 * Preuves de la garde de `scripts/verifier-integration-bootstrap-ci.ts` —
 * correctif P0-01, round 3 (revue Codex, point 3). Testée comme fonction
 * PURE — aucun accès Prisma, aucun risque d'écriture réelle.
 */
import { describe, expect, it } from "vitest";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

const CI_LOCAL = "postgresql://lomoto:lomoto@localhost:5432/lomoto_ci?schema=public";
const CI_LOCAL_127 = "postgresql://lomoto:lomoto@127.0.0.1:5432/lomoto_ci?schema=public";
const AUTRE_BASE_LOCALE = "postgresql://postgres:x@localhost:5432/lomoto_dev";
const DISTANT_MEME_NOM = "postgresql://lomoto:lomoto@db.production-lomoto.example.com:5432/lomoto_ci";

describe("verifierEnvironnementIntegrationCI — garde stricte (round 3, point 3)", () => {
  it("refuse sans CI_INTEGRATION_BOOTSTRAP_CONFIRME, même avec une URL par ailleurs correcte", () => {
    expect(() => verifierEnvironnementIntegrationCI({ DATABASE_URL: CI_LOCAL })).toThrow(
      /CI_INTEGRATION_BOOTSTRAP_CONFIRME/,
    );
  });

  it('refuse si CI_INTEGRATION_BOOTSTRAP_CONFIRME n\'est pas exactement "true"', () => {
    expect(() =>
      verifierEnvironnementIntegrationCI({ DATABASE_URL: CI_LOCAL, CI_INTEGRATION_BOOTSTRAP_CONFIRME: "1" }),
    ).toThrow(/CI_INTEGRATION_BOOTSTRAP_CONFIRME/);
  });

  it("refuse un hôte distant, même avec la confirmation ET le nom de base exact (aucune exception)", () => {
    expect(() =>
      verifierEnvironnementIntegrationCI({
        DATABASE_URL: DISTANT_MEME_NOM,
        CI_INTEGRATION_BOOTSTRAP_CONFIRME: "true",
      }),
    ).toThrow(/ne pointe pas vers un hôte local/);
  });

  it("refuse un nom de base différent de « lomoto_ci », même local et confirmé (jamais une base de dev réelle)", () => {
    expect(() =>
      verifierEnvironnementIntegrationCI({
        DATABASE_URL: AUTRE_BASE_LOCALE,
        CI_INTEGRATION_BOOTSTRAP_CONFIRME: "true",
      }),
    ).toThrow(/doit être exactement "lomoto_ci"/);
  });

  it("refuse un DATABASE_URL absent", () => {
    expect(() => verifierEnvironnementIntegrationCI({ CI_INTEGRATION_BOOTSTRAP_CONFIRME: "true" })).toThrow(
      /ne pointe pas vers un hôte local/,
    );
  });

  it("autorise UNIQUEMENT la combinaison exacte : hôte local + base lomoto_ci + confirmation", () => {
    expect(() =>
      verifierEnvironnementIntegrationCI({ DATABASE_URL: CI_LOCAL, CI_INTEGRATION_BOOTSTRAP_CONFIRME: "true" }),
    ).not.toThrow();
    expect(() =>
      verifierEnvironnementIntegrationCI({ DATABASE_URL: CI_LOCAL_127, CI_INTEGRATION_BOOTSTRAP_CONFIRME: "true" }),
    ).not.toThrow();
  });
});
