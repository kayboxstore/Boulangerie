import { describe, expect, it } from "vitest";
import { evaluerCompteurCaracteres } from "./compteurCaracteres";

describe("evaluerCompteurCaracteres", () => {
  it("désactive le compteur si aucune limite n'est fournie", () => {
    expect(evaluerCompteurCaracteres(50)).toEqual({
      longueur: 50,
      limite: undefined,
      procheLimite: false,
      depasse: false,
    });
  });

  it("désactive le compteur si la limite est nulle ou négative", () => {
    expect(evaluerCompteurCaracteres(50, 0).limite).toBeUndefined();
    expect(evaluerCompteurCaracteres(50, -10).limite).toBeUndefined();
  });

  it("ne signale rien tant qu'on est loin de la limite", () => {
    const etat = evaluerCompteurCaracteres(10, 100);
    expect(etat).toEqual({ longueur: 10, limite: 100, procheLimite: false, depasse: false });
  });

  it("signale procheLimite à partir de 90 % de la limite", () => {
    expect(evaluerCompteurCaracteres(89, 100).procheLimite).toBe(false);
    expect(evaluerCompteurCaracteres(90, 100).procheLimite).toBe(true);
  });

  it("signale depasse une fois la limite strictement franchie", () => {
    expect(evaluerCompteurCaracteres(100, 100).depasse).toBe(false);
    expect(evaluerCompteurCaracteres(101, 100).depasse).toBe(true);
  });

  it("depasse implique aussi procheLimite", () => {
    const etat = evaluerCompteurCaracteres(150, 100);
    expect(etat.depasse).toBe(true);
    expect(etat.procheLimite).toBe(true);
  });
});
