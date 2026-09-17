/**
 * Preuve HTTP mockée (P1-B, 28/08/2026) : POST /api/commandes exige désormais
 * une session de caisse OUVERTE pour aujourd'hui — cette écriture modifie
 * `montantRecu`, qui alimente directement le registre de caisse. Même
 * convention de mock que routes/caisse.test.ts (service caisseAtomique.js,
 * jamais Prisma directement).
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErreurAction } from "../lib/erreurAction.js";

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = { id: "u-1", nom: "Alice", estAdminPrincipal: false } as express.Request["utilisateur"];
    next();
  },
  requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const mocks = vi.hoisted(() => ({
  verrouillerSessionOuverte: vi.fn(),
  verifierAucuneSessionAnterieureOuverte: vi.fn(),
  auditerCaisseTx: vi.fn(),
}));

vi.mock("../services/caisseAtomique.js", async () => {
  const actual = await vi.importActual<typeof import("../services/caisseAtomique.js")>("../services/caisseAtomique.js");
  return {
    ...actual,
    verrouillerSessionOuverte: mocks.verrouillerSessionOuverte,
    verifierAucuneSessionAnterieureOuverte: mocks.verifierAucuneSessionAnterieureOuverte,
    auditerCaisseTx: mocks.auditerCaisseTx,
    executerAvecReessaiP2034: vi.fn((operation: () => Promise<unknown>) => operation()),
  };
});

let executerEcritureIdempotenteMock: (
  req: unknown,
  portee: string,
  donnees: unknown,
  executer: (tx: unknown) => Promise<unknown>,
  versReponse: (v: unknown) => unknown,
) => Promise<unknown>;

vi.mock("../lib/idempotence.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/idempotence.js")>("../lib/idempotence.js");
  return {
    ...actual,
    executerEcritureIdempotente: vi.fn((...args: Parameters<typeof executerEcritureIdempotenteMock>) =>
      executerEcritureIdempotenteMock(...args),
    ),
    ajouterEnteteRejeu: vi.fn(),
  };
});

import { commandesRouter } from "./commandes.js";

function app() {
  const application = express();
  application.use(express.json());
  application.use("/api/commandes", commandesRouter);
  return application;
}

beforeEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  // Comportement par défaut, équivalent à l'ancien mock fixe : exécute
  // réellement le callback `executer` avec un tx factice minimal, pour que
  // le verrou mocké (verrouillerSessionOuverte) s'exécute et puisse rejeter.
  executerEcritureIdempotenteMock = async (_req, _portee, _donnees, executer) => {
    return executer({});
  };
});

describe("POST /api/commandes — session de caisse requise (P1-B)", () => {
  it("409 quand aucune session n'est OUVERTE aujourd'hui — la commande n'est jamais créée", async () => {
    mocks.verrouillerSessionOuverte.mockRejectedValue(
      new ErreurAction(409, "Aucune session de caisse n'est ouverte pour aujourd'hui — ouvrez d'abord la caisse."),
    );
    const res = await request(app())
      .post("/api/commandes")
      .send({ clientId: "c-1", quantiteBacs: 5, montantRecu: 10000 });
    expect(res.status).toBe(409);
    expect(mocks.verrouillerSessionOuverte).toHaveBeenCalled();
  });

  it("409 quand la session d'aujourd'hui est déjà clôturée", async () => {
    mocks.verrouillerSessionOuverte.mockRejectedValue(
      new ErreurAction(409, "La session de caisse du 2026-08-28 est clôturée : plus aucune écriture n'est possible."),
    );
    const res = await request(app())
      .post("/api/commandes")
      .send({ clientId: "c-1", quantiteBacs: 5, montantRecu: 0, strategie: "MODIFIER" });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/commandes — audit transactionnel de l'avance Client à la création (régression Passe B)", () => {
  it("audite la mise à jour de l'avance du Client via updateMany + auditerCaisseTx, jamais un update() singulier non transactionnel", async () => {
    mocks.verrouillerSessionOuverte.mockResolvedValue(undefined);
    mocks.verifierAucuneSessionAnterieureOuverte.mockResolvedValue(undefined);

    const client = {
      id: "c-1",
      nom: "Client Test",
      avanceDisponible: 0,
      typeClient: { nom: "Détail", prixParBac: 1000, commissionParBac: 50 },
    };
    const clientApresCreation = { ...client, avanceDisponible: 5000 };
    const creee = {
      id: "cmd-1",
      numero: 1,
      dateCreation: new Date(),
      client: { id: "c-1", nom: "Client Test", typeClient: { nom: "Détail" } },
      quantiteBacs: 5,
      montantBrut: 5000,
      avanceUtilisee: 0,
      montantAPercevoir: 5000,
      montantRecu: 10000,
      dette: 0,
      avanceGeneree: 5000,
      nouvelleAvance: 5000,
      creePar: { id: "u-1", nom: "Alice" },
      reglements: [],
    };

    const txFactice = {
      client: {
        findUnique: vi.fn().mockResolvedValue(client),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(clientApresCreation),
      },
      commandeClient: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(creee),
      },
    };

    executerEcritureIdempotenteMock = async (_req, _portee, _donnees, executer, versReponse) => {
      const valeur = await executer(txFactice);
      const reponse = versReponse(valeur) as { statutHttp: number; corps: unknown };
      return { rejoue: false, valeur, ...reponse };
    };

    const res = await request(app())
      .post("/api/commandes")
      .send({ clientId: "c-1", quantiteBacs: 5, montantRecu: 10000 });

    expect(res.status).toBe(201);
    expect(txFactice.client.updateMany).toHaveBeenCalledWith({
      where: { id: "c-1" },
      data: { avanceDisponible: 5000 },
    });
    expect(mocks.auditerCaisseTx).toHaveBeenCalledWith(
      txFactice,
      expect.objectContaining({
        module: "COMMANDES",
        typeEntite: "Client",
        entiteId: "c-1",
        action: "MODIFICATION",
        avant: client,
        apres: clientApresCreation,
      }),
    );
  });
});
