import { describe, expect, it } from "vitest";
import { cleSuccesAcceptation, sommeAccepteRetourneDepasseDepose } from "./acceptationCycleLogique";

describe("sommeAccepteRetourneDepasseDepose — contrat C4 §7", () => {
  it("false quand accepté + retourné est strictement inférieur au déposé", () => {
    expect(sommeAccepteRetourneDepasseDepose(3, 2, 10)).toBe(false);
  });

  it("false quand accepté + retourné égale exactement le déposé", () => {
    expect(sommeAccepteRetourneDepasseDepose(7, 3, 10)).toBe(false);
  });

  it("true dès que accepté + retourné dépasse le déposé", () => {
    expect(sommeAccepteRetourneDepasseDepose(7, 4, 10)).toBe(true);
  });

  it("true même si un seul des deux dépasse déjà le déposé à lui seul", () => {
    expect(sommeAccepteRetourneDepasseDepose(15, 0, 10)).toBe(true);
  });
});

describe("cleSuccesAcceptation — dépend uniquement de la réponse serveur", () => {
  it("clé « avec commande » quand le serveur renvoie une commande", () => {
    expect(cleSuccesAcceptation({ id: "c1", numero: 1, quantiteBacs: 5 })).toBe("acceptations.successWithOrder");
  });

  it("clé « sans commande » quand le serveur ne renvoie aucune commande (retour total)", () => {
    expect(cleSuccesAcceptation(null)).toBe("acceptations.successWithoutOrder");
  });
});
