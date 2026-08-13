import { describe, expect, it } from "vitest";
import { calculerPagination, genererNumerosPages } from "./pagination-logique";

describe("calculerPagination", () => {
  it("calcule une page intermédiaire normale", () => {
    expect(calculerPagination(2, 10, 45)).toEqual({
      page: 2,
      pageSize: 10,
      total: 45,
      totalPages: 5,
      premierIndex: 11,
      dernierIndex: 20,
      aPrecedente: true,
      aSuivante: true,
    });
  });

  it("gère la dernière page partielle", () => {
    const etat = calculerPagination(5, 10, 45);
    expect(etat.dernierIndex).toBe(45);
    expect(etat.premierIndex).toBe(41);
    expect(etat.aSuivante).toBe(false);
  });

  it("borne une page demandée au-delà du total", () => {
    const etat = calculerPagination(99, 10, 45);
    expect(etat.page).toBe(5);
  });

  it("borne une page demandée en dessous de 1", () => {
    const etat = calculerPagination(-3, 10, 45);
    expect(etat.page).toBe(1);
  });

  it("gère une liste vide sans diviser par zéro ni renvoyer d'index négatif", () => {
    expect(calculerPagination(1, 10, 0)).toEqual({
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 1,
      premierIndex: 0,
      dernierIndex: 0,
      aPrecedente: false,
      aSuivante: false,
    });
  });

  it("protège contre une taille de page nulle ou négative", () => {
    expect(calculerPagination(1, 0, 45).pageSize).toBe(1);
    expect(calculerPagination(1, -5, 45).pageSize).toBe(1);
  });
});

describe("genererNumerosPages", () => {
  it("affiche toutes les pages quand il y en a peu", () => {
    expect(genererNumerosPages(1, 1)).toEqual([1]);
    expect(genererNumerosPages(2, 3)).toEqual([1, 2, 3]);
  });

  it("insère des ellipses des deux côtés pour une page centrale sur une longue liste", () => {
    expect(genererNumerosPages(10, 20)).toEqual([1, "…", 9, 10, 11, "…", 20]);
  });

  it("n'insère pas d'ellipse inutile près du début", () => {
    expect(genererNumerosPages(1, 20)).toEqual([1, 2, "…", 20]);
  });

  it("n'insère pas d'ellipse inutile près de la fin", () => {
    expect(genererNumerosPages(20, 20)).toEqual([1, "…", 19, 20]);
  });

  it("respecte un delta personnalisé", () => {
    expect(genererNumerosPages(10, 20, 2)).toEqual([1, "…", 8, 9, 10, 11, 12, "…", 20]);
  });
});
