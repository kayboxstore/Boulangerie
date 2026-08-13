import { describe, expect, it } from "vitest";
import {
  bornesJourLomoto,
  dateSQLDepuisJourLomoto,
  decalerJourLomoto,
  FUSEAU_LOMOTO,
  jourLomoto,
} from "./temps.js";

describe("temps opérationnel Lomoto", () => {
  it("centralise explicitement le fuseau", () => {
    expect(FUSEAU_LOMOTO).toBe("Africa/Kinshasa");
  });

  it("bascule de jour à 23:00 UTC, soit minuit à Kinshasa", () => {
    expect(jourLomoto(new Date("2026-08-13T22:59:59.999Z"))).toBe("2026-08-13");
    expect(jourLomoto(new Date("2026-08-13T23:00:00.000Z"))).toBe("2026-08-14");
  });

  it("calcule les bornes UTC inclusives du jour de Kinshasa", () => {
    const [debut, fin] = bornesJourLomoto("2026-08-13");
    expect(debut.toISOString()).toBe("2026-08-12T23:00:00.000Z");
    expect(fin.toISOString()).toBe("2026-08-13T22:59:59.999Z");
  });

  it("décale les jours sans dépendre du fuseau du serveur", () => {
    expect(decalerJourLomoto("2026-03-01", -1)).toBe("2026-02-28");
    expect(decalerJourLomoto("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("stabilise les colonnes SQL de type date", () => {
    expect(dateSQLDepuisJourLomoto("2026-08-13").toISOString()).toBe("2026-08-13T00:00:00.000Z");
  });

  it("refuse une date calendaire impossible", () => {
    expect(() => bornesJourLomoto("2026-02-30")).toThrow(RangeError);
  });
});
