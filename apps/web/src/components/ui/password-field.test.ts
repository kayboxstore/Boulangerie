import { describe, expect, it } from "vitest";
import { evaluerRobustesseMotDePasse } from "./robustesseMotDePasse";

describe("evaluerRobustesseMotDePasse", () => {
  it("renvoie un score de 0 (très faible) en dessous de 8 caractères, quelle que soit la complexité", () => {
    expect(evaluerRobustesseMotDePasse("")).toEqual({ score: 0, cle: "tresFaible" });
    expect(evaluerRobustesseMotDePasse("Ab1!")).toEqual({ score: 0, cle: "tresFaible" });
  });

  it("attribue un score de 1 (faible) pour 8+ caractères sans complexité supplémentaire", () => {
    expect(evaluerRobustesseMotDePasse("abcdefgh")).toEqual({ score: 1, cle: "faible" });
  });

  it("augmente le score avec la longueur ≥ 12", () => {
    expect(evaluerRobustesseMotDePasse("abcdefghijkl")).toEqual({ score: 2, cle: "moyen" });
  });

  it("augmente le score avec un mélange de casse", () => {
    expect(evaluerRobustesseMotDePasse("abcdefGH")).toEqual({ score: 2, cle: "moyen" });
  });

  it("augmente le score avec un chiffre ET un caractère spécial ensemble", () => {
    // 8 caractères + chiffre/spécial, mais SANS mélange de casse → 1 (longueur) + 1 (chiffre+spécial) = 2
    expect(evaluerRobustesseMotDePasse("abcdef1!")).toEqual({ score: 2, cle: "moyen" });
  });

  it("ne récompense pas un chiffre seul sans caractère spécial", () => {
    expect(evaluerRobustesseMotDePasse("abcdefg1")).toEqual({ score: 1, cle: "faible" });
  });

  it("atteint le score maximal (4, fort) quand tous les critères sont réunis", () => {
    expect(evaluerRobustesseMotDePasse("MotDePasse123!")).toEqual({ score: 4, cle: "fort" });
  });

  it("plafonne à 4 même si tous les critères sont largement dépassés", () => {
    const resultat = evaluerRobustesseMotDePasse("MotDePasseTresLongEtComplexe123!@#");
    expect(resultat.score).toBeLessThanOrEqual(4);
    expect(resultat).toEqual({ score: 4, cle: "fort" });
  });
});
