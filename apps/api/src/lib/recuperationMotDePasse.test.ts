import { describe, expect, it } from "vitest";
import {
  DUREE_JETON_REINITIALISATION_MS,
  expirationJetonReinitialisation,
  genererJetonReinitialisation,
  genererMotDePasseTemporaire,
  hacherJetonReinitialisation,
  jetonReinitialisationUtilisable,
} from "./recuperationMotDePasse.js";

describe("récupération sécurisée du mot de passe", () => {
  it("stocke un condensat déterministe, jamais le jeton brut", () => {
    const jeton = "secret-de-test-qui-ne-doit-pas-etre-stocke";
    const hash = hacherJetonReinitialisation(jeton);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(jeton);
    expect(hacherJetonReinitialisation(jeton)).toBe(hash);
  });

  it("génère des jetons indépendants avec 256 bits d'entropie", () => {
    const a = genererJetonReinitialisation();
    const b = genererJetonReinitialisation();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("fixe exactement la durée de validité contractuelle", () => {
    const maintenant = new Date("2026-08-13T12:00:00.000Z");
    expect(expirationJetonReinitialisation(maintenant).getTime() - maintenant.getTime())
      .toBe(DUREE_JETON_REINITIALISATION_MS);
  });

  it("accepte un jeton non utilisé avant son échéance", () => {
    const expireLe = new Date("2026-08-13T12:30:00.000Z");
    expect(jetonReinitialisationUtilisable(
      { expireLe, utiliseLe: null },
      new Date("2026-08-13T12:29:59.999Z"),
    )).toBe(true);
  });

  it("refuse l'instant exact d'expiration et tout jeton déjà utilisé", () => {
    const expireLe = new Date("2026-08-13T12:30:00.000Z");
    expect(jetonReinitialisationUtilisable({ expireLe, utiliseLe: null }, expireLe)).toBe(false);
    expect(jetonReinitialisationUtilisable(
      { expireLe: new Date("2099-01-01T00:00:00.000Z"), utiliseLe: new Date() },
    )).toBe(false);
  });

  it("génère un mot de passe temporaire couvrant les quatre familles", () => {
    const motDePasse = genererMotDePasseTemporaire();
    expect(motDePasse).toMatch(/[A-Z]/);
    expect(motDePasse).toMatch(/[a-z]/);
    expect(motDePasse).toMatch(/[0-9]/);
    expect(motDePasse).toMatch(/[^A-Za-z0-9]/);
    expect(motDePasse.length).toBeGreaterThanOrEqual(16);
  });

  it("ne réutilise pas un mot de passe temporaire", () => {
    expect(genererMotDePasseTemporaire()).not.toBe(genererMotDePasseTemporaire());
  });
});
