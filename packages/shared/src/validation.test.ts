import { describe, expect, it } from "vitest";
import {
  absenceDeclarerSchema,
  bonLivraisonJourSchema,
  commandeCreateSchema,
  dateISOSchema,
  depenseCreateSchema,
  depenseFarineSchema,
  estDateISOValide,
  planningCreateSchema,
  premierLancementTravailleurSchema,
  sanctionCreateSchema,
  schemaCommandeJourSchema,
  tauxDuJourSchema,
} from "./index.js";

describe("validation stricte C2", () => {
  it.each(["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10"])(
    "refuse la date calendaire impossible %s",
    (date) => {
      expect(estDateISOValide(date)).toBe(false);
      expect(dateISOSchema.safeParse(date).success).toBe(false);
    },
  );

  it.each(["2024-02-29", "2026-08-13", "2000-01-01"])(
    "accepte la date réelle %s",
    (date) => expect(dateISOSchema.safeParse(date).success).toBe(true),
  );

  it("applique la validation calendaire aux contrats métier existants", () => {
    const dateImpossible = "2026-02-30";
    expect(tauxDuJourSchema.safeParse({ date: dateImpossible, valeur: 1 }).success).toBe(false);
    expect(
      depenseCreateSchema.safeParse({ date: dateImpossible, motif: "Transport", montant: 1 }).success,
    ).toBe(false);
    expect(depenseFarineSchema.safeParse({ date: dateImpossible, active: true }).success).toBe(false);
    expect(
      planningCreateSchema.safeParse({
        datePrevue: dateImpossible,
        nombreBacsCommandes: 0,
        lignes: [],
      }).success,
    ).toBe(false);
    expect(schemaCommandeJourSchema.safeParse({ date: dateImpossible, clients: [] }).success).toBe(false);
    expect(bonLivraisonJourSchema.safeParse({ date: dateImpossible, clients: [] }).success).toBe(false);
    expect(
      premierLancementTravailleurSchema.safeParse({
        nom: "Test",
        poste: "Boulanger",
        dateEmbauche: dateImpossible,
      }).success,
    ).toBe(false);
    expect(
      absenceDeclarerSchema.safeParse({
        travailleurId: "travailleur-1",
        date: dateImpossible,
        motif: "Test",
      }).success,
    ).toBe(false);
    expect(
      sanctionCreateSchema.safeParse({
        travailleurId: "travailleur-1",
        type: "PUNITION",
        motif: "Test",
        date: dateImpossible,
      }).success,
    ).toBe(false);
  });

  it("refuse les nombres non finis dans les écritures sensibles", () => {
    expect(
      commandeCreateSchema.safeParse({ clientId: "c1", quantiteBacs: 1, montantRecu: Infinity }).success,
    ).toBe(false);
    expect(tauxDuJourSchema.safeParse({ date: "2026-08-13", valeur: Infinity }).success).toBe(false);
    expect(
      depenseCreateSchema.safeParse({ date: "2026-08-13", motif: "Transport", montant: Infinity }).success,
    ).toBe(false);
  });
});
