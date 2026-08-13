import { describe, expect, it } from "vitest";
import { bornerPage, calculerPagination, genererNumerosPages } from "./pagination-logique";

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

describe("bornerPage — ne jamais renvoyer une page vide alors que des résultats existent", () => {
  it("laisse une page valide inchangée", () => {
    expect(bornerPage(2, 10, 45)).toBe(2);
  });

  it("borne une page devenue hors bornes après une baisse des données (ex. suppression de lignes)", () => {
    // L'utilisateur était en page 5/5 (50 items, 10/page) ; les données
    // tombent à 12 (2 pages) : la page affichée doit redescendre à 2, jamais rester à 5.
    expect(bornerPage(5, 10, 12)).toBe(2);
  });

  it("borne une page devenue hors bornes après une augmentation de taillePage", () => {
    // Page 5 avec 10/page sur 45 items (5 pages) ; taillePage passe à 20 → 3 pages.
    expect(bornerPage(5, 20, 45)).toBe(3);
  });

  it("renvoie 1 quand il n'y a aucun résultat", () => {
    expect(bornerPage(5, 10, 0)).toBe(1);
  });

  it("ne borne pas artificiellement une page déjà valide vers le bas", () => {
    expect(bornerPage(1, 10, 45)).toBe(1);
  });

  it("protège contre une page invalide", () => {
    expect(bornerPage(-1, 10, 45)).toBe(1);
  });

  it("protège contre une taille de page invalide (repli sur 1 élément par page)", () => {
    // taillePage=0 replie sur 1 élément/page → 45 pages : la page 2 reste valide.
    expect(bornerPage(2, 0, 45)).toBe(2);
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
