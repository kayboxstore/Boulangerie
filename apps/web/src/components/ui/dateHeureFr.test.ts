import { describe, expect, it } from "vitest";
import {
  combinerDateHeureISO,
  estDateValide,
  estHeureValide,
  formaterDateFr,
  formaterHeureFr,
} from "./dateHeureFr";

describe("estDateValide", () => {
  it("accepte une date réelle au format YYYY-MM-DD", () => {
    expect(estDateValide("2026-08-13")).toBe(true);
  });

  it("rejette un format incorrect", () => {
    expect(estDateValide("13/08/2026")).toBe(false);
    expect(estDateValide("")).toBe(false);
  });

  it("rejette une date calendaire impossible (ex. 31 février)", () => {
    expect(estDateValide("2026-02-31")).toBe(false);
  });
});

describe("estHeureValide", () => {
  it("accepte une heure au format HH:MM", () => {
    expect(estHeureValide("14:30")).toBe(true);
    expect(estHeureValide("00:00")).toBe(true);
    expect(estHeureValide("23:59")).toBe(true);
  });

  it("rejette une heure hors bornes ou mal formée", () => {
    expect(estHeureValide("24:00")).toBe(false);
    expect(estHeureValide("12:60")).toBe(false);
    expect(estHeureValide("12h30")).toBe(false);
  });
});

describe("formaterDateFr", () => {
  it("formate une date valide en français long", () => {
    expect(formaterDateFr("2026-08-13")).toBe("13 août 2026");
  });

  it("ne décale pas la date d'un jour près des bornes de fuseau (1er janvier)", () => {
    // Cas volontairement choisi car `new Date(iso)` (UTC) décalerait cette
    // date au 31 décembre dans tout fuseau à l'ouest de l'UTC.
    expect(formaterDateFr("2026-01-01")).toBe("1 janvier 2026");
  });

  it("renvoie une chaîne vide pour une date invalide", () => {
    expect(formaterDateFr("pas-une-date")).toBe("");
  });
});

describe("formaterHeureFr", () => {
  it("formate une heure valide à la française", () => {
    expect(formaterHeureFr("14:30")).toBe("14 h 30");
    expect(formaterHeureFr("09:00")).toBe("09 h 00");
  });

  it("renvoie une chaîne vide pour une heure invalide", () => {
    expect(formaterHeureFr("invalide")).toBe("");
  });
});

describe("combinerDateHeureISO", () => {
  it("combine une date et une heure valides", () => {
    expect(combinerDateHeureISO("2026-08-13", "14:30")).toBe("2026-08-13T14:30");
  });

  it("renvoie null si la date est invalide", () => {
    expect(combinerDateHeureISO("invalide", "14:30")).toBeNull();
  });

  it("renvoie null si l'heure est invalide", () => {
    expect(combinerDateHeureISO("2026-08-13", "invalide")).toBeNull();
  });

  it("renvoie null si les deux sont vides", () => {
    expect(combinerDateHeureISO("", "")).toBeNull();
  });
});
