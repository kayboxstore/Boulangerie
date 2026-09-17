/**
 * Preuves du correctif P0-01 (round 2/3, P1-02) : la garde d'environnement du
 * seed de démonstration est testée ici comme une fonction PURE — aucun accès
 * Prisma, aucun risque de déclencher `main()` ou `process.exit()` contre une
 * vraie base, contrairement à un import complet de `seed-demo.ts`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { verifierEnvironnementSeedDemo } from "./garde-environnement-seed-demo.js";

const SOURCE = readFileSync(fileURLToPath(new URL("./garde-environnement-seed-demo.ts", import.meta.url)), "utf-8");

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

  // `postgresql://` n'est pas un schéma "spécial" pour l'implémentation
  // WHATWG URL de Node : contrairement à http(s), le hostname n'est ni mis en
  // minuscules ni dépouillé de ses crochets IPv6 par `new URL()`. Sans
  // normalisation explicite, ces variantes pourtant bien locales seraient
  // refusées à tort (trouvé en revue indépendante round 2 — échec fermé, pas
  // une faille, mais une vraie gêne pour un développeur local).
  it("autorise un hôte local écrit en MAJUSCULES (new URL() ne normalise pas la casse pour ce schéma)", () => {
    expect(() =>
      verifierEnvironnementSeedDemo({ NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@LOCALHOST:5432/db" }),
    ).not.toThrow();
  });

  it("autorise ::1 écrit entre crochets, comme dans une vraie URL (new URL() ne retire pas les crochets pour ce schéma)", () => {
    expect(() =>
      verifierEnvironnementSeedDemo({ NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@[::1]:5432/db" }),
    ).not.toThrow();
  });

  it("un hôte distant ne devient PAS local en préfixant/suffixant localhost ou ::1 (pas de correspondance partielle)", () => {
    const tentativesDeContournement = [
      "postgresql://u:p@localhost.evil.example.com:5432/db",
      "postgresql://u:p@evil.com/localhost:5432/db",
      "postgresql://u:p@[::1].evil.com:5432/db",
      "postgresql://u:p@notlocalhost:5432/db",
    ];
    for (const url of tentativesDeContournement) {
      expect(
        () => verifierEnvironnementSeedDemo({ NODE_ENV: "development", DATABASE_URL: url }),
        `« ${url} » ne doit pas être reconnu comme local`,
      ).toThrow(/ne pointe pas vers un hôte local/);
    }
  });

  // Round 3 (revue Codex) : l'opt-in round 2 `SEED_DEMO_HOTE_DISTANT_AUTORISE`
  // a été jugé inacceptable pour un script qui crée des comptes à mot de
  // passe connu et réattribue `estAdminPrincipal` — retiré entièrement, sans
  // aucun remplacement. Les tests ci-dessous prouvent qu'aucune variable
  // d'environnement, quelle qu'elle soit, ne permet plus de contourner le
  // refus d'un hôte distant.
  it("un hôte distant reste refusé même avec une prétendue variable d'autorisation dans l'environnement (aucune exception, quel que soit son nom)", () => {
    expect(() =>
      verifierEnvironnementSeedDemo({
        NODE_ENV: "test",
        DATABASE_URL: DISTANT,
        // @ts-expect-error — cette clé n'existe plus dans EnvironnementSeedDemo ;
        // on la passe quand même pour prouver qu'elle est ignorée à l'exécution.
        SEED_DEMO_HOTE_DISTANT_AUTORISE: "true",
      }),
    ).toThrow(/ne pointe pas vers un hôte local/);
  });

  it("aucune exception distante n'existe même avec NODE_ENV=test ET NODE_ENV=development (les deux seules valeurs autorisées)", () => {
    for (const nodeEnv of ["development", "test"]) {
      expect(
        () => verifierEnvironnementSeedDemo({ NODE_ENV: nodeEnv, DATABASE_URL: DISTANT }),
        `NODE_ENV=${nodeEnv} ne doit jamais autoriser un hôte distant`,
      ).toThrow(/ne pointe pas vers un hôte local/);
    }
  });

  it("preuve statique : EnvironnementSeedDemo n'expose plus aucun champ d'opt-in distant", () => {
    expect(SOURCE).not.toContain("SEED_DEMO_HOTE_DISTANT_AUTORISE");
    expect(SOURCE).not.toContain("HoteDistantAutorise");
  });
});
