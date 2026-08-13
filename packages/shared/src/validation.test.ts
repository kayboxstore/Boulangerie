import { describe, expect, it } from "vitest";
import {
  commandeCreateSchema,
  dateISOSchema,
  depenseCreateSchema,
  estDateISOValide,
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
