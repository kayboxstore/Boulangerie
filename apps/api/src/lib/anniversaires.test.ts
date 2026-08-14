import { describe, expect, it } from "vitest";
import { estAnniversaireLe, nomsAnniversairesDuJour } from "./anniversaires.js";
import { jourLomoto } from "./temps.js";

describe("anniversaires Premium", () => {
  it("groupe et trie plusieurs noms sans exposer date, âge ni identifiant", () => {
    const noms = nomsAnniversairesDuJour([
      { nom: "Zoé", dateNaissance: new Date("1990-08-13T00:00:00.000Z") },
      { nom: "Alain", dateNaissance: new Date("1988-08-13T00:00:00.000Z") },
      { nom: "Hors jour", dateNaissance: new Date("1995-08-14T00:00:00.000Z") },
      { nom: "Sans date", dateNaissance: null },
    ], "2026-08-13");
    expect(noms).toEqual(["Alain", "Zoé"]);
    expect(Object.keys({ noms })).toEqual(["noms"]);
  });

  it("renvoie un groupe vide quand personne ne fête son anniversaire", () => {
    expect(nomsAnniversairesDuJour([
      { nom: "A", dateNaissance: new Date("2000-01-01T00:00:00.000Z") },
    ], "2026-08-13")).toEqual([]);
  });

  it("gère le 29 février sans inventer de date les années non bissextiles", () => {
    const naissance = new Date("2000-02-29T00:00:00.000Z");
    expect(estAnniversaireLe(naissance, "2028-02-29")).toBe(true);
    expect(estAnniversaireLe(naissance, "2027-02-28")).toBe(false);
  });

  it("utilise la bascule civile de Kinshasa", () => {
    expect(jourLomoto(new Date("2026-08-13T22:59:59.999Z"))).toBe("2026-08-13");
    expect(jourLomoto(new Date("2026-08-13T23:00:00.000Z"))).toBe("2026-08-14");
  });

  it("refuse un jour calendaire impossible", () => {
    expect(() => nomsAnniversairesDuJour([], "2026-02-30")).toThrow(RangeError);
  });
});
