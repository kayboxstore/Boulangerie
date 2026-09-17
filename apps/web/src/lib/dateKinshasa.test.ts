import { describe, expect, it } from "vitest";
import { dateISOKinshasa, dateISOKinshasaLendemain } from "./dateKinshasa";

describe("dateISOKinshasa — journée calendaire dans le fuseau Africa/Kinshasa (UTC+1, round 2)", () => {
  it("un instant en pleine journée UTC donne la même date en Kinshasa", () => {
    expect(dateISOKinshasa(new Date("2026-08-14T12:00:00Z"))).toBe("2026-08-14");
  });

  it("23h30 UTC est déjà le lendemain à Kinshasa (UTC+1) — jamais calculé en UTC pur", () => {
    // 2026-01-15T23:30:00Z = 2026-01-16T00:30:00 à Kinshasa.
    expect(dateISOKinshasa(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-16");
    // Une implémentation naïve en toISOString().slice(0,10) donnerait "2026-01-15" (faux).
  });

  it("juste avant minuit UTC+1 (23h00 UTC) : encore le jour même à Kinshasa", () => {
    expect(dateISOKinshasa(new Date("2026-01-15T22:30:00Z"))).toBe("2026-01-15");
  });

  it("minuit UTC pile : déjà 1h du matin à Kinshasa, jour inchangé", () => {
    expect(dateISOKinshasa(new Date("2026-08-14T00:00:00Z"))).toBe("2026-08-14");
  });
});

describe("dateISOKinshasaLendemain — J+1 sans heure d'été à gérer", () => {
  it("avance d'exactement une journée calendaire à Kinshasa", () => {
    expect(dateISOKinshasaLendemain(new Date("2026-08-14T12:00:00Z"))).toBe("2026-08-15");
  });

  it("cohérent avec dateISOKinshasa même près d'une bascule de journée UTC", () => {
    // 23h30 UTC le 15 janvier = 16 janvier à Kinshasa ; le lendemain est donc le 17.
    expect(dateISOKinshasaLendemain(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-17");
  });

  it("traverse correctement un changement de mois", () => {
    expect(dateISOKinshasaLendemain(new Date("2026-01-31T12:00:00Z"))).toBe("2026-02-01");
  });
});
