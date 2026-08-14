import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const operationIdempotente = {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
  const tx = { operationIdempotente };
  return {
    operationIdempotente,
    tx,
    transaction: vi.fn(async (executer: (transaction: typeof tx) => unknown) => executer(tx)),
  };
});

vi.mock("./prisma.js", () => ({
  prisma: {
    operationIdempotente: mocks.operationIdempotente,
    $transaction: mocks.transaction,
  },
}));

import {
  empreinteIdempotence,
  executerEcritureIdempotente,
} from "./idempotence.js";

function requete(cle?: string): Request {
  return {
    utilisateur: { id: "utilisateur-1" },
    get: (nom: string) => (nom === "Idempotency-Key" ? cle : undefined),
  } as unknown as Request;
}

describe("exécution idempotente C2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (executer) => executer(mocks.tx));
    mocks.operationIdempotente.findUnique.mockResolvedValue(null);
    mocks.operationIdempotente.create.mockResolvedValue({ id: "operation-1" });
    mocks.operationIdempotente.update.mockResolvedValue({});
  });

  it("préserve la compatibilité sans en-tête", async () => {
    const executer = vi.fn(async () => ({ id: "commande-1" }));
    const resultat = await executerEcritureIdempotente(
      requete(),
      "POST:/api/commandes",
      { montant: 10 },
      executer,
      (valeur) => ({ statutHttp: 201, corps: valeur }),
    );

    expect(resultat.rejoue).toBe(false);
    expect(resultat.corps).toEqual({ id: "commande-1" });
    expect(mocks.operationIdempotente.create).not.toHaveBeenCalled();
  });

  it("mémorise effet et réponse dans la même transaction", async () => {
    const executer = vi.fn(async () => ({ id: "depense-1", montant: 10 }));
    const resultat = await executerEcritureIdempotente(
      requete("depense-unique-0001"),
      "POST:/api/caisse/depenses",
      { montant: 10 },
      executer,
      (valeur) => ({ statutHttp: 201, corps: { depense: valeur } }),
    );

    expect(resultat.rejoue).toBe(false);
    expect(mocks.operationIdempotente.create).toHaveBeenCalledTimes(1);
    expect(mocks.operationIdempotente.update).toHaveBeenCalledWith({
      where: { id: "operation-1" },
      data: {
        statutHttp: 201,
        reponse: { depense: { id: "depense-1", montant: 10 } },
      },
    });
  });

  it("rejoue la réponse mémorisée sans rappeler l'écriture métier", async () => {
    const portee = "POST:/api/commandes";
    const donnees = { clientId: "client-1", quantiteBacs: 2, montantRecu: 0 };
    mocks.operationIdempotente.findUnique.mockResolvedValue({
      empreinte: empreinteIdempotence(portee, donnees),
      statutHttp: 201,
      reponse: { commande: { id: "commande-1" } },
    });
    const executer = vi.fn();

    const resultat = await executerEcritureIdempotente(
      requete("commande-unique-01"),
      portee,
      donnees,
      executer,
      (valeur) => ({ statutHttp: 201, corps: valeur }),
    );

    expect(resultat.rejoue).toBe(true);
    expect(resultat.corps).toEqual({ commande: { id: "commande-1" } });
    expect(executer).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("refuse de réutiliser la clé avec un autre contenu", async () => {
    mocks.operationIdempotente.findUnique.mockResolvedValue({
      empreinte: empreinteIdempotence("POST:/api/commandes", { montant: 10 }),
      statutHttp: 201,
      reponse: {},
    });

    await expect(
      executerEcritureIdempotente(
        requete("commande-unique-02"),
        "POST:/api/commandes",
        { montant: 11 },
        vi.fn(),
        (valeur) => ({ statutHttp: 201, corps: valeur }),
      ),
    ).rejects.toMatchObject({
      statutHttp: 409,
      code: "CLE_IDEMPOTENCE_REUTILISEE",
    });
  });
});
