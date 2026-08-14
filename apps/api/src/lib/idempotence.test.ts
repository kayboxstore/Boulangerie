import { describe, expect, it } from "vitest";
import {
  empreinteIdempotence,
  ErreurIdempotence,
  lireCleIdempotence,
} from "./idempotence.js";

const requete = (cle?: string) => ({
  get: (nom: string) => (nom === "Idempotency-Key" ? cle : undefined),
});

describe("idempotence C2", () => {
  it("produit la même empreinte malgré l'ordre des propriétés", () => {
    const a = empreinteIdempotence("commandes", { clientId: "c1", montant: 10 });
    const b = empreinteIdempotence("commandes", { montant: 10, clientId: "c1" });
    expect(a).toBe(b);
  });

  it("distingue une portée ou des données différentes", () => {
    expect(empreinteIdempotence("commandes", { montant: 10 })).not.toBe(
      empreinteIdempotence("depenses", { montant: 10 }),
    );
    expect(empreinteIdempotence("commandes", { montant: 10 })).not.toBe(
      empreinteIdempotence("commandes", { montant: 11 }),
    );
  });

  it("accepte une clé compatible UUID", () => {
    expect(lireCleIdempotence(requete("0d8b4e5a-aaaa-bbbb-cccc-123456789012") as never)).toBe(
      "0d8b4e5a-aaaa-bbbb-cccc-123456789012",
    );
  });

  it("laisse les anciens clients fonctionner sans clé", () => {
    expect(lireCleIdempotence(requete() as never)).toBeNull();
  });

  it.each(["courte", "clé-avec-accent", "espaces interdits"])("refuse la clé invalide %s", (cle) => {
    expect(() => lireCleIdempotence(requete(cle) as never)).toThrow(ErreurIdempotence);
  });
});
