import { describe, expect, it } from "vitest";
import {
  aAcces,
  calculerCommande,
  calculerDepenseFarine,
  confirmerReglementsSchema,
  controleQualiteSchema,
  pertesJustifiees,
  sessionCaisseCorrectionSchema,
  sommeDeclarationsEnAttente,
  type PermissionDTO,
} from "./index.js";

describe("calculerCommande (section 3.4)", () => {
  it("sans avance ni dette : montant à percevoir = montant brut", () => {
    const r = calculerCommande({ quantiteBacs: 3, prixParBac: 6000, avanceExistante: 0, montantRecu: 18000 });
    expect(r).toEqual({
      montantBrut: 18000,
      avanceUtilisee: 0,
      montantAPercevoir: 18000,
      dette: 0,
      avanceGeneree: 0,
      nouvelleAvance: 0,
    });
  });

  it("avance existante déduite avant affichage du montant à percevoir (exemple de la spec)", () => {
    // Commande #1 : 3 bacs à 6.000 Fc, 20.000 reçus -> 2.000 d'avance générée.
    const c1 = calculerCommande({ quantiteBacs: 3, prixParBac: 6000, avanceExistante: 0, montantRecu: 20000 });
    expect(c1.avanceGeneree).toBe(2000);
    expect(c1.nouvelleAvance).toBe(2000);

    // Commande #2 (lendemain) : 5 bacs, l'avance de 2.000 est déduite en premier.
    const c2 = calculerCommande({ quantiteBacs: 5, prixParBac: 6000, avanceExistante: c1.nouvelleAvance, montantRecu: 28000 });
    expect(c2.avanceUtilisee).toBe(2000);
    expect(c2.montantAPercevoir).toBe(28000);
    expect(c2.dette).toBe(0);
    expect(c2.nouvelleAvance).toBe(0);
  });

  it("avance existante plafonnée au montant brut (pas d'avance négative)", () => {
    const r = calculerCommande({ quantiteBacs: 1, prixParBac: 4100, avanceExistante: 10000, montantRecu: 0 });
    expect(r.avanceUtilisee).toBe(4100); // min(avanceExistante, montantBrut)
    expect(r.montantAPercevoir).toBe(0);
    expect(r.nouvelleAvance).toBe(10000 - 4100 + 0);
  });

  it("montant reçu insuffisant génère une dette, jamais négative", () => {
    const r = calculerCommande({ quantiteBacs: 2, prixParBac: 4100, avanceExistante: 0, montantRecu: 3000 });
    expect(r.montantAPercevoir).toBe(8200);
    expect(r.dette).toBe(5200);
    expect(r.avanceGeneree).toBe(0);
  });

  it("trop-perçu devient une avance, la dette reste à 0", () => {
    const r = calculerCommande({ quantiteBacs: 1, prixParBac: 4350, avanceExistante: 0, montantRecu: 5000 });
    expect(r.dette).toBe(0);
    expect(r.avanceGeneree).toBe(650);
    expect(r.nouvelleAvance).toBe(650);
  });
});

describe("calculerDepenseFarine — [(33,5 × taux) + 500] × sacs", () => {
  it("calcule et arrondit au franc", () => {
    expect(calculerDepenseFarine(1500, 10)).toBe(Math.round((33.5 * 1500 + 500) * 10));
  });

  it("zéro sac utilisé -> zéro dépense, quel que soit le taux", () => {
    expect(calculerDepenseFarine(2000, 0)).toBe(0);
  });
});

describe("aAcces (matrice de permissions)", () => {
  const permissions: PermissionDTO[] = [
    { module: "COMMANDES", niveauAcces: "ECRITURE" },
    { module: "STOCKS", niveauAcces: "LECTURE" },
    { module: "CAISSE", niveauAcces: "AUCUN" },
  ];

  it("ECRITURE implique LECTURE sur le même module", () => {
    expect(aAcces(permissions, "COMMANDES", "LECTURE")).toBe(true);
    expect(aAcces(permissions, "COMMANDES", "ECRITURE")).toBe(true);
  });

  it("LECTURE seule n'accorde pas ECRITURE", () => {
    expect(aAcces(permissions, "STOCKS", "LECTURE")).toBe(true);
    expect(aAcces(permissions, "STOCKS", "ECRITURE")).toBe(false);
  });

  it("AUCUN refuse LECTURE et ECRITURE", () => {
    expect(aAcces(permissions, "CAISSE", "LECTURE")).toBe(false);
    expect(aAcces(permissions, "CAISSE", "ECRITURE")).toBe(false);
  });

  it("module absent de la liste équivaut à AUCUN", () => {
    expect(aAcces(permissions, "TRAVAILLEURS", "LECTURE")).toBe(false);
  });
});

describe("pertesJustifiees (section 3.3 f — clôture de Production)", () => {
  it("aucune perte requise quand bacsFoutus = 0", () => {
    expect(pertesJustifiees({ bacsFoutus: 0, pertes: [] })).toBe(true);
  });

  it("refuse tant que la somme des motifs ne couvre pas exactement bacsFoutus", () => {
    expect(pertesJustifiees({ bacsFoutus: 5, pertes: [{ nombreBacs: 3 }] })).toBe(false);
    expect(pertesJustifiees({ bacsFoutus: 5, pertes: [{ nombreBacs: 3 }, { nombreBacs: 3 }] })).toBe(false);
  });

  it("accepte une somme exactement égale, répartie sur plusieurs motifs", () => {
    expect(pertesJustifiees({ bacsFoutus: 5, pertes: [{ nombreBacs: 2 }, { nombreBacs: 3 }] })).toBe(true);
  });
});

describe("controleQualiteSchema (section 3.3 f)", () => {
  it("CONFORME sans motif est valide", () => {
    expect(controleQualiteSchema.safeParse({ verdict: "CONFORME" }).success).toBe(true);
  });

  it("NON_CONFORME sans motif est refusé", () => {
    const r = controleQualiteSchema.safeParse({ verdict: "NON_CONFORME" });
    expect(r.success).toBe(false);
  });

  it("NON_CONFORME avec motif est valide", () => {
    expect(controleQualiteSchema.safeParse({ verdict: "NON_CONFORME", motifId: "m1" }).success).toBe(true);
  });
});

describe("sommeDeclarationsEnAttente (section 3.1 pt 4 — Lot 6, P0-07)", () => {
  it("ignore les règlements déjà confirmés", () => {
    const total = sommeDeclarationsEnAttente([
      { statut: "DECLARE", montant: 1000 },
      { statut: "CONFIRME", montant: 5000 },
    ]);
    expect(total).toBe(1000);
  });

  it("additionne plusieurs déclarations en attente", () => {
    const total = sommeDeclarationsEnAttente([
      { statut: "DECLARE", montant: 1000 },
      { statut: "DECLARE", montant: 2000 },
    ]);
    expect(total).toBe(3000);
  });

  it("liste vide -> 0", () => {
    expect(sommeDeclarationsEnAttente([])).toBe(0);
  });
});

describe("sessionCaisseCorrectionSchema (section 3.1 pt 5 — droit spécial Admin Principal)", () => {
  it("exige toujours un motif, même sans écart apparent", () => {
    expect(sessionCaisseCorrectionSchema.safeParse({ soldeCompteFermeture: 10000 }).success).toBe(false);
  });

  it("valide avec motif", () => {
    expect(
      sessionCaisseCorrectionSchema.safeParse({ soldeCompteFermeture: 10000, motif: "Erreur de comptage" }).success,
    ).toBe(true);
  });
});

describe("confirmerReglementsSchema (section 3.1 pt 4)", () => {
  it("refuse une sélection vide", () => {
    expect(confirmerReglementsSchema.safeParse({ paiementCommandeIds: [], remisParNom: "Jean" }).success).toBe(false);
  });

  it("valide avec au moins un règlement sélectionné", () => {
    expect(
      confirmerReglementsSchema.safeParse({ paiementCommandeIds: ["p1"], remisParNom: "Jean" }).success,
    ).toBe(true);
  });
});
