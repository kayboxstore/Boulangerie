import { describe, expect, it } from "vitest";
import { SEUIL_GLISSEMENT_PX, demarrerGlissement, glissementDepasseSeuil } from "./lampeLogique";

describe("lampeLogique — logique pure du geste de tirage", () => {
  it("un glissement vers le bas au-delà du seuil compte comme un tirage", () => {
    const etat = demarrerGlissement(100);
    expect(glissementDepasseSeuil(etat, 100 + SEUIL_GLISSEMENT_PX)).toBe(true);
    expect(glissementDepasseSeuil(etat, 100 + SEUIL_GLISSEMENT_PX + 20)).toBe(true);
  });

  it("un glissement vers le bas en-deçà du seuil ne compte pas", () => {
    const etat = demarrerGlissement(100);
    expect(glissementDepasseSeuil(etat, 100 + SEUIL_GLISSEMENT_PX - 1)).toBe(false);
    expect(glissementDepasseSeuil(etat, 100)).toBe(false);
  });

  it("un glissement vers le HAUT ne compte jamais, quelle que soit sa distance", () => {
    const etat = demarrerGlissement(100);
    expect(glissementDepasseSeuil(etat, 100 - SEUIL_GLISSEMENT_PX - 50)).toBe(false);
    expect(glissementDepasseSeuil(etat, 0)).toBe(false);
  });

  it("accepte un seuil personnalisé", () => {
    const etat = demarrerGlissement(0);
    expect(glissementDepasseSeuil(etat, 5, 10)).toBe(false);
    expect(glissementDepasseSeuil(etat, 10, 10)).toBe(true);
  });
});
