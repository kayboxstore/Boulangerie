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

vi.mock("../lib/idempotence.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/idempotence.js")>("../lib/idempotence.js");
  return {
    ...actual,
    executerEcritureIdempotente: vi.fn(async (_req, _portee, _donnees, executer) => {
      // Le verrou est vérifié en tout premier dans le callback — on veut
      // seulement prouver qu'il l'empêche avant toute autre lecture, jamais
      // dérouler la logique complète de création (hors périmètre ici).
      const txFactice = { client: { findUnique: vi.fn().mockResolvedValue(null) } };
      await executer(txFactice);
      throw new Error("ne devrait jamais atteindre ce point si le verrou a levé");
    }),
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
