import { describe, expect, it } from "vitest";
import { genererCleIdempotence, resoudreCleIdempotence } from "./idempotence";

describe("genererCleIdempotence — format conforme au serveur (F5B)", () => {
  it("génère une chaîne de 8 à 128 caractères alphanumériques ou . _ : -", () => {
    const cle = genererCleIdempotence();
    expect(cle).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
  });

  it("génère une clé différente à chaque appel", () => {
    expect(genererCleIdempotence()).not.toBe(genererCleIdempotence());
  });
});

describe("resoudreCleIdempotence — nouvelle opération vs rejeu strictement identique (F5B)", () => {
  it("génère une nouvelle clé quand il n'y a pas de tentative précédente", () => {
    const resultat = resoudreCleIdempotence(null, "corps-1");
    expect(resultat.cle).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(resultat.empreinte).toBe("corps-1");
  });

  it("réutilise la même clé quand l'empreinte est strictement identique — rejeu", () => {
    const premiere = resoudreCleIdempotence(null, "corps-1");
    const rejeu = resoudreCleIdempotence(premiere, "corps-1");
    expect(rejeu.cle).toBe(premiere.cle);
  });

  it("génère une clé DIFFÉRENTE dès que l'empreinte change — jamais la même clé avec un corps différent", () => {
    const premiere = resoudreCleIdempotence(null, "corps-1");
    const nouvelle = resoudreCleIdempotence(premiere, "corps-2");
    expect(nouvelle.cle).not.toBe(premiere.cle);
    expect(nouvelle.empreinte).toBe("corps-2");
  });

  it("chaîne de rejeux : la clé ne change qu'au moment précis où l'empreinte change", () => {
    let etat = resoudreCleIdempotence(null, "A");
    const cleA = etat.cle;
    etat = resoudreCleIdempotence(etat, "A"); // rejeu identique
    expect(etat.cle).toBe(cleA);
    etat = resoudreCleIdempotence(etat, "B"); // corps différent : nouvelle opération
    expect(etat.cle).not.toBe(cleA);
    const cleB = etat.cle;
    etat = resoudreCleIdempotence(etat, "B"); // rejeu de la nouvelle opération
    expect(etat.cle).toBe(cleB);
  });
});
