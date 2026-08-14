import { describe, expect, it } from "vitest";
import { STATUTS_CYCLE_LIVRAISON as STATUTS_CYCLE_LIVRAISON_PARTAGES } from "@lomoto/shared/cycles-livraison";
import {
  RESULTATS_CYCLE_LIVRAISON,
  STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON,
  STATUTS_CYCLE_LIVRAISON,
  STATUTS_FINAUX_CYCLE_LIVRAISON,
  calculerEcartQuantite,
  cleDescriptionStatutCycle,
  cleLibelleStatutCycle,
  varianteBadgeStatutCycle,
} from "./cycleLivraisonLogique";

describe("STATUTS_CYCLE_LIVRAISON — réexporté depuis @lomoto/shared/cycles-livraison (I4)", () => {
  it("est littéralement le même tableau que le contrat C4 partagé — pas de duplication locale", () => {
    expect(STATUTS_CYCLE_LIVRAISON).toBe(STATUTS_CYCLE_LIVRAISON_PARTAGES);
  });

  it("contient les onze statuts C4 exacts", () => {
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

describe("STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON — round 3 (sous-ensemble présentation des statuts C4)", () => {
  it("contient exactement les sept premiers statuts de STATUTS_CYCLE_LIVRAISON, dans le même ordre", () => {
    expect(STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON).toEqual(STATUTS_CYCLE_LIVRAISON.slice(0, 7));
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
  it("contient exactement les quatre derniers statuts de STATUTS_CYCLE_LIVRAISON, dans le même ordre", () => {
    expect(STATUTS_FINAUX_CYCLE_LIVRAISON).toEqual(STATUTS_CYCLE_LIVRAISON.slice(7));
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

  it("chronologie + finaux couvrent exactement, sans trou ni doublon, les onze statuts C4", () => {
    expect([...STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON, ...STATUTS_FINAUX_CYCLE_LIVRAISON]).toEqual(STATUTS_CYCLE_LIVRAISON);
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
});

describe("cleLibelleStatutCycle / cleDescriptionStatutCycle — clé i18n correcte selon le groupe du statut (I4)", () => {
  it("un statut chronologique pointe vers previsions.chronologie.*", () => {
    expect(cleLibelleStatutCycle("EN_TOURNEE")).toBe("previsions.chronologie.EN_TOURNEE.label");
    expect(cleDescriptionStatutCycle("EN_TOURNEE")).toBe("previsions.chronologie.EN_TOURNEE.description");
  });

  it("un statut final pointe vers previsions.statutsFinaux.*", () => {
    expect(cleLibelleStatutCycle("ACCEPTEE")).toBe("previsions.statutsFinaux.ACCEPTEE.label");
    expect(cleDescriptionStatutCycle("PARTIELLEMENT_ACCEPTEE")).toBe(
      "previsions.statutsFinaux.PARTIELLEMENT_ACCEPTEE.description",
    );
  });

  it("couvre les onze statuts C4 sans exception", () => {
    for (const statut of STATUTS_CYCLE_LIVRAISON) {
      expect(cleLibelleStatutCycle(statut)).toMatch(/^previsions\.(chronologie|statutsFinaux)\./);
      expect(cleDescriptionStatutCycle(statut)).toMatch(/^previsions\.(chronologie|statutsFinaux)\./);
    }
  });
});

describe("varianteBadgeStatutCycle — couleur cohérente pour un statut C4, quel que soit son groupe (I4)", () => {
  it("couvre les onze statuts C4 sans exception, avec une variante valide", () => {
    const variantesValides = ["secondary", "gold", "destructive", "outline"];
    for (const statut of STATUTS_CYCLE_LIVRAISON) {
      expect(variantesValides).toContain(varianteBadgeStatutCycle(statut));
    }
  });

  it("EN_ATTENTE_CONFIRMATION et PARTIELLEMENT_ACCEPTEE sont mis en évidence (gold, comme les états intermédiaires notables)", () => {
    expect(varianteBadgeStatutCycle("EN_ATTENTE_CONFIRMATION")).toBe("gold");
    expect(varianteBadgeStatutCycle("PARTIELLEMENT_ACCEPTEE")).toBe("gold");
  });

  it("RETOUR_TOTAL est mis en évidence comme un résultat défavorable (destructive)", () => {
    expect(varianteBadgeStatutCycle("RETOUR_TOTAL")).toBe("destructive");
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
