import { describe, expect, it } from "vitest";
import { filtrerParRecherche, trierPar } from "./rechercheEtTri";

interface Personne {
  nom: string;
  age: number;
}

const personnes: Personne[] = [
  { nom: "Awa", age: 34 },
  { nom: "Blaise", age: 22 },
  { nom: "Chantal", age: 45 },
];

describe("filtrerParRecherche", () => {
  it("renvoie la liste complète pour une requête vide", () => {
    expect(filtrerParRecherche(personnes, (p) => [p.nom], "")).toEqual(personnes);
    expect(filtrerParRecherche(personnes, (p) => [p.nom], "   ")).toEqual(personnes);
  });

  it("filtre insensible à la casse sur les champs indiqués", () => {
    expect(filtrerParRecherche(personnes, (p) => [p.nom], "AWA")).toEqual([{ nom: "Awa", age: 34 }]);
  });

  it("cherche une correspondance partielle", () => {
    expect(filtrerParRecherche(personnes, (p) => [p.nom], "ai")).toEqual([{ nom: "Blaise", age: 22 }]);
  });

  it("peut chercher sur plusieurs champs, y compris numériques", () => {
    expect(filtrerParRecherche(personnes, (p) => [p.nom, p.age], "45")).toEqual([{ nom: "Chantal", age: 45 }]);
  });

  it("ignore les valeurs null/undefined sans planter", () => {
    const avecTrous = [{ nom: "Awa", surnom: null }, { nom: "Blaise", surnom: undefined }];
    expect(filtrerParRecherche(avecTrous, (p) => [p.nom, p.surnom], "awa")).toEqual([{ nom: "Awa", surnom: null }]);
  });

  it("ne trouve rien si aucune correspondance", () => {
    expect(filtrerParRecherche(personnes, (p) => [p.nom], "zzz")).toEqual([]);
  });

  it("ne mute pas la liste d'origine", () => {
    const resultat = filtrerParRecherche(personnes, (p) => [p.nom], "a");
    expect(personnes).toHaveLength(3);
    expect(resultat).not.toBe(personnes);
  });
});

describe("trierPar", () => {
  it("renvoie la liste inchangée sans comparateur", () => {
    expect(trierPar(personnes, undefined, "asc")).toEqual(personnes);
  });

  it("trie en ordre croissant", () => {
    const resultat = trierPar(personnes, (a, b) => a.age - b.age, "asc");
    expect(resultat.map((p) => p.nom)).toEqual(["Blaise", "Awa", "Chantal"]);
  });

  it("trie en ordre décroissant", () => {
    const resultat = trierPar(personnes, (a, b) => a.age - b.age, "desc");
    expect(resultat.map((p) => p.nom)).toEqual(["Chantal", "Awa", "Blaise"]);
  });

  it("ne mute pas la liste d'origine", () => {
    const original = [...personnes];
    trierPar(personnes, (a, b) => a.age - b.age, "asc");
    expect(personnes).toEqual(original);
  });
});
