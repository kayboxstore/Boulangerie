import { describe, expect, it } from "vitest";
import { formaterListeNoms } from "./anniversairesLogique";

describe("anniversairesLogique — formatage pur de « Constellation Lomoto »", () => {
  it("liste vide -> chaîne vide", () => {
    expect(formaterListeNoms([], "et")).toBe("");
  });

  it("un seul nom -> renvoyé tel quel, sans conjonction", () => {
    expect(formaterListeNoms(["Alain"], "et")).toBe("Alain");
  });

  it("deux noms -> joints par la conjonction fournie", () => {
    expect(formaterListeNoms(["Alain", "Zoé"], "et")).toBe("Alain et Zoé");
  });

  it("trois noms ou plus -> virgules puis la conjonction avant le dernier", () => {
    expect(formaterListeNoms(["Alain", "Zoé", "Marie"], "et")).toBe("Alain, Zoé et Marie");
    expect(formaterListeNoms(["Alain", "Zoé", "Marie", "Paul"], "et")).toBe("Alain, Zoé, Marie et Paul");
  });

  it("la conjonction est fournie par l'appelant, jamais codée en dur (support multilingue)", () => {
    expect(formaterListeNoms(["Alain", "Zoé"], "and")).toBe("Alain and Zoé");
    expect(formaterListeNoms(["Alain", "Zoé"], "mpe")).toBe("Alain mpe Zoé");
    expect(formaterListeNoms(["Alain", "Zoé"], "na")).toBe("Alain na Zoé");
  });

  it("ne modifie pas le tableau d'entrée", () => {
    const noms = ["Alain", "Zoé", "Marie"];
    formaterListeNoms(noms, "et");
    expect(noms).toEqual(["Alain", "Zoé", "Marie"]);
  });
});
