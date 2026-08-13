import { describe, expect, it } from "vitest";
import { FUSEAU_HORLOGE, decomposerHeureKinshasa, libelleAccessibleHeure } from "./horlogeLogique";

describe("horlogeLogique — logique pure de l'horloge flip", () => {
  it("toujours le fuseau Africa/Kinshasa, quel que soit l'input", () => {
    expect(FUSEAU_HORLOGE).toBe("Africa/Kinshasa");
  });

  it("décompose une date en heures/minutes/secondes à deux chiffres", () => {
    // 2026-08-13T10:05:07Z = 11:05:07 à Kinshasa (UTC+1, pas d'heure d'été).
    const heure = decomposerHeureKinshasa(new Date("2026-08-13T10:05:07Z"));
    expect(heure).toEqual({ heures: "11", minutes: "05", secondes: "07" });
  });

  it("reste correct au passage de minuit (23h -> 00h)", () => {
    // 2026-08-13T23:30:00Z = 2026-08-14T00:30:00 à Kinshasa.
    const heure = decomposerHeureKinshasa(new Date("2026-08-13T23:30:00Z"));
    expect(heure).toEqual({ heures: "00", minutes: "30", secondes: "00" });
  });

  it("produit un libellé accessible complet, non tronqué", () => {
    const libelle = libelleAccessibleHeure({ heures: "14", minutes: "32", secondes: "05" });
    expect(libelle).toBe("14 h 32 min 05 s");
  });
});
