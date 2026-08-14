import { describe, expect, it } from "vitest";
import {
  RESULTATS_CYCLE_LIVRAISON,
  STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON,
  STATUTS_CYCLE_LIVRAISON,
  STATUTS_FINAUX_CYCLE_LIVRAISON,
  calculerEcartQuantite,
  calculerQuantiteFacturableIndicative,
  calculerQuantiteManquanteIndicative,
  respecteLimiteAccepteRetourne,
} from "./cycleLivraisonLogique";

describe("STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON — round 3 (statuts C4 exacts)", () => {
  it("contient exactement les sept statuts C4, dans l'ordre, utilisant les chaînes exactes du contrat", () => {
    expect(STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON).toEqual([
      "PREVISION",
      "RETENUE_PRODUCTION",
      "PREPAREE",
      "REMISE_MAGASIN",
      "CHARGEE",
      "EN_TOURNEE",
      "EN_ATTENTE_CONFIRMATION",
    ]);
  });

  it("EN_TOURNEE se trouve exactement entre CHARGEE et EN_ATTENTE_CONFIRMATION", () => {
    const indexChargee = STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON.indexOf("CHARGEE");
    const indexEnTournee = STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON.indexOf("EN_TOURNEE");
    const indexAttente = STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON.indexOf("EN_ATTENTE_CONFIRMATION");
    expect(indexEnTournee).toBe(indexChargee + 1);
    expect(indexAttente).toBe(indexEnTournee + 1);
  });

  it("la chronologie s'arrête à EN_ATTENTE_CONFIRMATION : aucun statut ACCEPTEE/RETOUR_TOTAL/ANNULEE n'y figure", () => {
    expect(STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON).not.toContain("ACCEPTEE");
    expect(STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON).not.toContain("PARTIELLEMENT_ACCEPTEE");
    expect(STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON).not.toContain("RETOUR_TOTAL");
    expect(STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON).not.toContain("ANNULEE");
    expect(STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON[STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON.length - 1]).toBe(
      "EN_ATTENTE_CONFIRMATION",
    );
  });

  it("aucun statut DEPOSEE inventé : le dépôt est une action (SIGNALER_DEPOT), jamais un statut de cette liste", () => {
    expect(STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON as readonly string[]).not.toContain("DEPOSEE");
    expect(STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON as readonly string[]).not.toContain("DEPOSE");
  });
});

describe("STATUTS_FINAUX_CYCLE_LIVRAISON — groupe non chronologique, mutuellement exclusif (round 4)", () => {
  it("contient exactement les quatre statuts finaux C4, dans l'ordre du contrat", () => {
    expect(STATUTS_FINAUX_CYCLE_LIVRAISON).toEqual(["PARTIELLEMENT_ACCEPTEE", "ACCEPTEE", "RETOUR_TOTAL", "ANNULEE"]);
  });

  it("n'est pas un sous-ensemble de la chronologie (deux groupes bien distincts, jamais de flèche entre eux)", () => {
    for (const statutFinal of STATUTS_FINAUX_CYCLE_LIVRAISON) {
      expect(STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON as readonly string[]).not.toContain(statutFinal);
    }
  });

  it("n'est confondu ni avec RESULTATS_CYCLE_LIVRAISON (quantités) ni l'inverse — deux concepts distincts", () => {
    for (const statutFinal of STATUTS_FINAUX_CYCLE_LIVRAISON) {
      expect(RESULTATS_CYCLE_LIVRAISON as readonly string[]).not.toContain(statutFinal);
    }
    for (const resultat of RESULTATS_CYCLE_LIVRAISON) {
      expect(STATUTS_FINAUX_CYCLE_LIVRAISON as readonly string[]).not.toContain(resultat);
    }
  });
});

describe("STATUTS_CYCLE_LIVRAISON — les onze statuts C4 exacts (round 4)", () => {
  it("concatène exactement les sept statuts de chronologie puis les quatre statuts finaux, dans l'ordre du contrat", () => {
    expect(STATUTS_CYCLE_LIVRAISON).toEqual([
      "PREVISION",
      "RETENUE_PRODUCTION",
      "PREPAREE",
      "REMISE_MAGASIN",
      "CHARGEE",
      "EN_TOURNEE",
      "EN_ATTENTE_CONFIRMATION",
      "PARTIELLEMENT_ACCEPTEE",
      "ACCEPTEE",
      "RETOUR_TOTAL",
      "ANNULEE",
    ]);
    expect(STATUTS_CYCLE_LIVRAISON).toHaveLength(11);
  });
});

describe("RESULTATS_CYCLE_LIVRAISON — quantités distinctes présentées en parallèle, non chronologiques (round 3, formulation corrigée round 4)", () => {
  it("contient exactement accepté, retourné, manquant", () => {
    expect(RESULTATS_CYCLE_LIVRAISON).toEqual(["accepte", "retourne", "manquant"]);
  });

  it("n'est pas un sous-ensemble de la chronologie (deux groupes bien distincts)", () => {
    for (const resultat of RESULTATS_CYCLE_LIVRAISON) {
      expect(STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON as readonly string[]).not.toContain(resultat);
    }
  });

  it("respecte les règles exactes du contrat plutôt qu'une indépendance totale (round 4) : accepté+retourné borné par le déposé, manquant calculé serveur", () => {
    // accepté + retourné <= déposé (respecteLimiteAccepteRetourne) et
    // manquant = chargé - déposé (calculerQuantiteManquanteIndicative) sont
    // testés en détail plus bas — ce test vérifie seulement que ces deux
    // fonctions existent et documentent une RELATION, pas une indépendance.
    expect(typeof respecteLimiteAccepteRetourne).toBe("function");
    expect(typeof calculerQuantiteManquanteIndicative).toBe("function");
  });
});

describe("calculerQuantiteFacturableIndicative — conséquence de l'accepté uniquement, jamais plafonnée par la prévision", () => {
  it("exemple obligatoire : acceptation 40 (prévision 50) → 40 facturables", () => {
    expect(calculerQuantiteFacturableIndicative({ quantiteAcceptee: 40 })).toBe(40);
  });

  it("acceptation supérieure à la prévision : le facturable suit l'accepté, sans être plafonné", () => {
    expect(calculerQuantiteFacturableIndicative({ quantiteAcceptee: 60 })).toBe(60);
  });

  it("aucune acceptation : rien n'est facturable", () => {
    expect(calculerQuantiteFacturableIndicative({ quantiteAcceptee: 0 })).toBe(0);
  });

  it("valeur négative défensive : jamais de facturable négatif", () => {
    expect(calculerQuantiteFacturableIndicative({ quantiteAcceptee: -5 })).toBe(0);
  });
});

describe("calculerQuantiteManquanteIndicative — manquant = chargé − déposé (règle exacte C4 §4)", () => {
  it("exemple de référence du contrat : chargement 45, dépôt 43 → manquant 2", () => {
    expect(calculerQuantiteManquanteIndicative({ quantiteChargee: 45, quantiteDeposee: 43 })).toBe(2);
  });

  it("dépôt intégral : aucun manquant", () => {
    expect(calculerQuantiteManquanteIndicative({ quantiteChargee: 45, quantiteDeposee: 45 })).toBe(0);
  });

  it("jamais de manquant négatif (défensif)", () => {
    expect(calculerQuantiteManquanteIndicative({ quantiteChargee: 40, quantiteDeposee: 45 })).toBe(0);
  });
});

describe("respecteLimiteAccepteRetourne — accepté + retourné <= déposé (règle exacte C4 §4)", () => {
  it("exemple de référence du contrat : dépôt 43, acceptation 40, retour 3 → respecte la limite (égalité)", () => {
    expect(respecteLimiteAccepteRetourne({ quantiteDeposee: 43, quantiteAcceptee: 40, quantiteRetournee: 3 })).toBe(true);
  });

  it("somme strictement inférieure au déposé : respecte la limite", () => {
    expect(respecteLimiteAccepteRetourne({ quantiteDeposee: 43, quantiteAcceptee: 40, quantiteRetournee: 2 })).toBe(true);
  });

  it("somme supérieure au déposé : viole la limite", () => {
    expect(respecteLimiteAccepteRetourne({ quantiteDeposee: 43, quantiteAcceptee: 40, quantiteRetournee: 5 })).toBe(false);
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
