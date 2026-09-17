import express from "express";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    matierePremiere: {
      findUnique: mocks.findUnique,
      delete: mocks.delete,
    },
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = { id: "admin-1" } as express.Request["utilisateur"];
    next();
  },
  requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

class ErreurP2003Factice extends Prisma.PrismaClientKnownRequestError {
  constructor() {
    super("Foreign key constraint violated", { code: "P2003", clientVersion: "test" });
  }
}

import { stocksRouter } from "./stocks.js";

function appStocks() {
  const app = express();
  app.use(express.json());
  app.use(stocksRouter);
  return app;
}

// Correctif 27/08/2026 : une matière première sans mouvement de stock (contrôle
// applicatif du routeur) pouvait quand même être encore référencée par une ligne
// IngredientRecette résiduelle (table morte depuis la refonte 3.3, non couverte
// par ce contrôle) — la suppression échouait alors avec une erreur PostgreSQL
// P2003 non traduite, renvoyée en 500 générique par le gestionnaire d'erreurs
// central. Ce test verrouille la traduction en 409 explicite.
describe("DELETE /matieres/:id", () => {
  beforeEach(() => vi.clearAllMocks());

  it("supprime normalement une matière sans mouvement ni référence", async () => {
    mocks.findUnique.mockResolvedValue({ id: "m1", _count: { mouvements: 0 } });
    mocks.delete.mockResolvedValue({});

    const res = await request(appStocks()).delete("/matieres/m1");

    expect(res.status).toBe(204);
    expect(mocks.delete).toHaveBeenCalledWith({ where: { id: "m1" } });
  });

  it("404 si la matière n'existe pas", async () => {
    mocks.findUnique.mockResolvedValue(null);

    const res = await request(appStocks()).delete("/matieres/introuvable");

    expect(res.status).toBe(404);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("409 si la matière a un historique de mouvements", async () => {
    mocks.findUnique.mockResolvedValue({ id: "m1", _count: { mouvements: 3 } });

    const res = await request(appStocks()).delete("/matieres/m1");

    expect(res.status).toBe(409);
    expect(res.body.erreur).toMatch(/historique de mouvements/);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("409 explicite (pas 500 générique) si une contrainte de clé étrangère bloque la suppression (ex. IngredientRecette résiduel)", async () => {
    mocks.findUnique.mockResolvedValue({ id: "m1", _count: { mouvements: 0 } });
    mocks.delete.mockRejectedValue(new ErreurP2003Factice());

    const res = await request(appStocks()).delete("/matieres/m1");

    expect(res.status).toBe(409);
    expect(res.body.erreur).toMatch(/référencée ailleurs/);
  });
});
