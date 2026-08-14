import { describe, expect, it } from "vitest";
import {
  ETAPES_CYCLE_LIVRAISON,
  calculerEcartQuantite,
  calculerQuantiteFacturableIndicative,
} from "./cycleLivraisonLogique";

describe("ETAPES_CYCLE_LIVRAISON", () => {
  it("contient exactement les dix étapes attendues, dans l'ordre métier", () => {
    expect(ETAPES_CYCLE_LIVRAISON).toEqual([
      "prevu",
      "retenuProduction",
      "prepare",
      "charge",
      "depose",
      "enAttenteConfirmation",
      "accepte",
      "retourne",
      "manquant",
      "facturable",
    ]);
  });
});

describe("calculerQuantiteFacturableIndicative — min(prévue, acceptée), jamais négatif", () => {
  it("exemple obligatoire : prévision 50, acceptation 40 → 40 facturables", () => {
    expect(calculerQuantiteFacturableIndicative({ quantitePrevue: 50, quantiteAcceptee: 40 })).toBe(40);
  });

  it("acceptation intégrale : la quantité facturable égale la quantité prévue", () => {
    expect(calculerQuantiteFacturableIndicative({ quantitePrevue: 30, quantiteAcceptee: 30 })).toBe(30);
  });

  it("acceptation supérieure à la prévision : plafonnée à la prévision", () => {
    expect(calculerQuantiteFacturableIndicative({ quantitePrevue: 20, quantiteAcceptee: 25 })).toBe(20);
  });

  it("aucune acceptation : rien n'est facturable", () => {
    expect(calculerQuantiteFacturableIndicative({ quantitePrevue: 50, quantiteAcceptee: 0 })).toBe(0);
  });

  it("aucune prévision mais une acceptation saisie : rien n'est facturable (plafonné par la prévision)", () => {
    expect(calculerQuantiteFacturableIndicative({ quantitePrevue: 0, quantiteAcceptee: 10 })).toBe(0);
  });

  it("valeurs négatives défensives : jamais de facturable négatif", () => {
    expect(calculerQuantiteFacturableIndicative({ quantitePrevue: -5, quantiteAcceptee: -5 })).toBe(0);
  });
});

describe("calculerEcartQuantite — constatée − prévue", () => {
  it("livraison inférieure à la prévision : écart négatif", () => {
    expect(calculerEcartQuantite({ quantitePrevue: 10, quantiteConstatee: 6 })).toBe(-4);
  });

  it("livraison supérieure à la prévision : écart positif", () => {
    expect(calculerEcartQuantite({ quantitePrevue: 10, quantiteConstatee: 13 })).toBe(3);
  });

  it("conforme à la prévision : écart nul", () => {
    expect(calculerEcartQuantite({ quantitePrevue: 8, quantiteConstatee: 8 })).toBe(0);
  });
});
