import { describe, expect, it } from "vitest";
import {
  ETAPES_CYCLE_LIVRAISON,
  calculerEcartQuantite,
  calculerQuantiteFacturableIndicative,
} from "./cycleLivraisonLogique";

describe("ETAPES_CYCLE_LIVRAISON", () => {
  it("contient exactement les onze étapes attendues, dans l'ordre métier (remisMagasin inclus, round 2)", () => {
    expect(ETAPES_CYCLE_LIVRAISON).toEqual([
      "prevu",
      "retenuProduction",
      "prepare",
      "remisMagasin",
      "charge",
      "depose",
      "enAttenteConfirmation",
      "accepte",
      "retourne",
      "manquant",
      "facturable",
    ]);
  });

  it("remisMagasin (remise Production → Magasin) est bien distincte de charge (remise Magasin → Chauffeur)", () => {
    const indexRemis = ETAPES_CYCLE_LIVRAISON.indexOf("remisMagasin");
    const indexCharge = ETAPES_CYCLE_LIVRAISON.indexOf("charge");
    expect(indexRemis).toBeGreaterThanOrEqual(0);
    expect(indexCharge).toBeGreaterThan(indexRemis);
  });
});

describe("calculerQuantiteFacturableIndicative — suit l'accepté, jamais plafonné par la prévision (round 2)", () => {
  it("exemple obligatoire : acceptation 40 (prévision 50) → 40 facturables", () => {
    expect(calculerQuantiteFacturableIndicative({ quantiteAcceptee: 40 })).toBe(40);
  });

  it("acceptation supérieure à la prévision : le facturable suit l'accepté, sans être plafonné (non-linéarité round 2)", () => {
    // Prévision 50, mais 60 réellement acceptés le jour même : les 60 restent facturables.
    expect(calculerQuantiteFacturableIndicative({ quantiteAcceptee: 60 })).toBe(60);
  });

  it("aucune acceptation : rien n'est facturable, quelle que soit la prévision", () => {
    expect(calculerQuantiteFacturableIndicative({ quantiteAcceptee: 0 })).toBe(0);
  });

  it("valeur négative défensive : jamais de facturable négatif", () => {
    expect(calculerQuantiteFacturableIndicative({ quantiteAcceptee: -5 })).toBe(0);
  });
});

describe("calculerEcartQuantite — constatée − prévue (comparaison Schéma / Bon de livraison uniquement)", () => {
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
