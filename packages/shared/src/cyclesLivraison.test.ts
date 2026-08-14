import { describe, expect, it } from "vitest";
import {
  ACTIONS_CYCLE_LIVRAISON,
  STATUTS_CYCLE_LIVRAISON,
  TYPES_ANOMALIE_CYCLE,
  anomalieCycleCreateSchema,
  transitionCycleLivraisonSchema,
} from "./cyclesLivraison.js";

describe("contrat partagé C4", () => {
  it("publie les onze états, avec EN_TOURNEE avant l'attente de confirmation", () => {
    expect(STATUTS_CYCLE_LIVRAISON).toHaveLength(11);
    expect(STATUTS_CYCLE_LIVRAISON.indexOf("EN_TOURNEE")).toBe(
      STATUTS_CYCLE_LIVRAISON.indexOf("EN_ATTENTE_CONFIRMATION") - 1,
    );
  });

  it("publie les sept transitions serveur sans étape facturable fictive", () => {
    expect(ACTIONS_CYCLE_LIVRAISON).toEqual([
      "RETENIR_PRODUCTION",
      "CONFIRMER_PREPARATION",
      "CONFIRMER_REMISE_MAGASIN",
      "CONFIRMER_CHARGEMENT",
      "CONFIRMER_DEPART",
      "SIGNALER_DEPOT",
      "CONFIRMER_ACCEPTATION",
    ]);
    expect(ACTIONS_CYCLE_LIVRAISON).not.toContain("FACTURABLE");
  });

  it("valide une acceptation à quantités serveur indépendantes", () => {
    const resultat = transitionCycleLivraisonSchema.safeParse({
      action: "CONFIRMER_ACCEPTATION",
      version: 7,
      lignes: [{ produitId: "p1", quantiteAcceptee: 40, quantiteRetournee: 3 }],
      bonRetourne: false,
      observations: "Confirmation téléphonique",
    });
    expect(resultat.success).toBe(true);
  });

  it("refuse une quantité négative et une version nulle", () => {
    expect(transitionCycleLivraisonSchema.safeParse({
      action: "SIGNALER_DEPOT",
      version: 0,
      lignes: [{ produitId: "p1", quantite: -1 }],
    }).success).toBe(false);
  });

  it("borne et type les anomalies sans en faire des statuts", () => {
    expect(TYPES_ANOMALIE_CYCLE).toContain("BON_NON_RETOURNE");
    expect(STATUTS_CYCLE_LIVRAISON).not.toContain("BON_NON_RETOURNE" as never);
    expect(anomalieCycleCreateSchema.safeParse({
      version: 8,
      type: "BON_NON_RETOURNE",
      description: "Bon toujours chez le client",
    }).success).toBe(true);
  });
});
