import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hacherJetonReinitialisation } from "../lib/recuperationMotDePasse.js";

const mocks = vi.hoisted(() => ({
  utilisateurFindUnique: vi.fn(),
  jetonFindFirst: vi.fn(),
  jetonFindUnique: vi.fn(),
  jetonUpdateMany: vi.fn(),
  jetonUpdate: vi.fn(),
  jetonCreate: vi.fn(),
  envoyerLien: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    utilisateur: {
      findUnique: mocks.utilisateurFindUnique,
    },
    jetonReinitialisationMotDePasse: {
      findFirst: mocks.jetonFindFirst,
      findUnique: mocks.jetonFindUnique,
      updateMany: mocks.jetonUpdateMany,
      update: mocks.jetonUpdate,
      create: mocks.jetonCreate,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../middleware/auth.js", () => ({
  chargerUtilisateur: vi.fn(),
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../services/email.js", () => ({
  envoyerLienReinitialisation: mocks.envoyerLien,
}));

vi.mock("../lib/realtime.js", () => ({
  invaliderSessionUtilisateur: vi.fn(),
}));

import { authRouter, MESSAGE_DEMANDE_REINITIALISATION } from "./auth.js";

function appRecuperation() {
  const app = express();
  app.use(express.json());
  app.use("/auth", authRouter);
  return app;
}

describe("routes publiques de récupération", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        jetonReinitialisationMotDePasse: {
          updateMany: mocks.jetonUpdateMany,
          create: mocks.jetonCreate,
        },
      }),
    );
    mocks.jetonUpdateMany.mockResolvedValue({ count: 0 });
    mocks.jetonCreate.mockResolvedValue({ id: "jeton-enregistre" });
    mocks.envoyerLien.mockResolvedValue(undefined);
  });

  it("ne révèle pas qu'une adresse valide est inconnue", async () => {
    mocks.utilisateurFindUnique.mockResolvedValue(null);

    const res = await request(appRecuperation())
      .post("/auth/mot-de-passe-oublie")
      .send({ email: "inconnu@lomoto.test" });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: MESSAGE_DEMANDE_REINITIALISATION });
    expect(mocks.envoyerLien).not.toHaveBeenCalled();
  });

  it("renvoie exactement la même réponse pour un compte actif", async () => {
    mocks.utilisateurFindUnique.mockResolvedValue({
      id: "utilisateur-1",
      email: "agent@lomoto.test",
      actif: true,
    });
    mocks.jetonFindFirst.mockResolvedValue(null);

    const res = await request(appRecuperation())
      .post("/auth/mot-de-passe-oublie")
      .send({ email: "agent@lomoto.test" });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ message: MESSAGE_DEMANDE_REINITIALISATION });
    expect(mocks.envoyerLien).toHaveBeenCalledTimes(1);
  });

  it("ne persiste que le SHA-256 du secret envoyé", async () => {
    mocks.utilisateurFindUnique.mockResolvedValue({
      id: "utilisateur-1",
      email: "agent@lomoto.test",
      actif: true,
    });
    mocks.jetonFindFirst.mockResolvedValue(null);

    await request(appRecuperation())
      .post("/auth/mot-de-passe-oublie")
      .send({ email: "agent@lomoto.test" });

    const jetonBrut = mocks.envoyerLien.mock.calls[0][0].jeton as string;
    const donnees = mocks.jetonCreate.mock.calls[0][0].data;
    expect(donnees.jetonHash).toBe(hacherJetonReinitialisation(jetonBrut));
    expect(JSON.stringify(donnees)).not.toContain(jetonBrut);
  });

  it("masque les jetons absents ou mal formés derrière le même booléen", async () => {
    const court = await request(appRecuperation())
      .post("/auth/reinitialisation/verifier")
      .send({ jeton: "court" });
    expect(court.status).toBe(200);
    expect(court.body).toEqual({ valide: false });

    mocks.jetonFindUnique.mockResolvedValue(null);
    const inconnu = await request(appRecuperation())
      .post("/auth/reinitialisation/verifier")
      .send({ jeton: "x".repeat(43) });
    expect(inconnu.status).toBe(200);
    expect(inconnu.body).toEqual({ valide: false });
  });
});
