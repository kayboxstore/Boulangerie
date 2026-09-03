import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORIGINES_AUTORISEES, verifierOrigine } from "./origines.js";

function appelerVerification(origin: string | undefined): Promise<boolean> {
  return new Promise((resolve, reject) => {
    verifierOrigine(origin, (err, allow) => {
      if (err) return reject(err);
      resolve(Boolean(allow));
    });
  });
}

describe("verifierOrigine / ORIGINES_AUTORISEES", () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it("autorise le domaine canonique (www) et l'apex", async () => {
    await expect(appelerVerification("https://www.boulangerie-lomoto.com")).resolves.toBe(true);
    await expect(appelerVerification("https://boulangerie-lomoto.com")).resolves.toBe(true);
  });

  it("autorise l'ancienne URL Render (liens déjà partagés)", async () => {
    await expect(appelerVerification("https://boulangerie-lomoto.onrender.com")).resolves.toBe(true);
  });

  it("sans en-tête Origin (same-origin/serveur-à-serveur), autorise toujours", async () => {
    await expect(appelerVerification(undefined)).resolves.toBe(true);
  });

  it("hors production, reste permissif même pour une origine inconnue", async () => {
    const precedent = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    await expect(appelerVerification("https://exemple-quelconque.test")).resolves.toBe(true);
    process.env.NODE_ENV = precedent;
  });

  it("en production, rejette une origine qui ne figure dans aucune liste", async () => {
    const precedent = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    await expect(appelerVerification("https://site-tiers-quelconque.test")).rejects.toThrow(
      "Origine non autorisée",
    );
    process.env.NODE_ENV = precedent;
  });

  it("RENDER_EXTERNAL_URL absent : ORIGINES_AUTORISEES ne contient jamais de valeur vide/undefined", () => {
    // Ce module est déjà chargé (import statique en tête de fichier) avec
    // l'environnement de test — RENDER_EXTERNAL_URL n'y est pas défini. On
    // vérifie donc directement l'invariant sur la liste déjà construite,
    // plutôt que de retenter un import dynamique qui resterait mis en cache.
    expect(ORIGINES_AUTORISEES.every((o) => typeof o === "string" && o.length > 0)).toBe(true);
  });

  it("RENDER_EXTERNAL_URL présent : ajouté à la liste (vrai sous-processus, module chargé à froid)", async () => {
    const { execFileSync } = await import("node:child_process");
    const sortie = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "-e",
        "import('./src/lib/origines.js').then(m => console.log(JSON.stringify(m.ORIGINES_AUTORISEES)))",
      ],
      {
        cwd: new URL("../..", import.meta.url).pathname,
        env: { ...process.env, RENDER_EXTERNAL_URL: "https://boulangerie-lomoto-0cls.onrender.com" },
        encoding: "utf-8",
      },
    );
    const liste = JSON.parse(sortie.trim());
    expect(liste).toContain("https://boulangerie-lomoto-0cls.onrender.com");
  });
});
