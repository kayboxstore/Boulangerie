import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    produit: {
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      create: mocks.create,
      update: mocks.update,
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

vi.mock("../services/actionsCritiques.js", () => ({
  traiterActionCritique: vi.fn(),
}));

import { produitsRouter } from "./produits.js";

function appProduits() {
  const app = express();
  app.use(express.json());
  app.use(produitsRouter);
  return app;
}

describe("archivage des produits C2", () => {
  beforeEach(() => vi.clearAllMocks());

  it("masque les produits archivés par défaut", async () => {
    mocks.findMany.mockResolvedValue([]);
    const res = await request(appProduits()).get("/");
    expect(res.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { actif: true },
      orderBy: { nom: "asc" },
    });
  });

  it("permet de consulter explicitement les archives", async () => {
    mocks.findMany.mockResolvedValue([]);
    await request(appProduits()).get("/?inclureArchives=true");
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: undefined,
      orderBy: { nom: "asc" },
    });
  });

  it("crée de façon cohérente un produit demandé initialement inactif", async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.create.mockImplementation(async ({ data }) => ({ id: "produit-2", ...data }));

    const res = await request(appProduits()).post("/").send({
      nom: "Pain test",
      prixVente: 100,
      tauxTaxe: 0,
      categorie: "Pain",
      actif: false,
    });

    expect(res.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actif: false,
        archiveLe: expect.any(Date),
        archiveParId: "admin-1",
      }),
    });
  });

  it("archive au lieu de supprimer physiquement", async () => {
    mocks.findUnique.mockResolvedValue({ id: "produit-1", nom: "Baguette", actif: true });
    mocks.update.mockResolvedValue({});

    const res = await request(appProduits()).delete("/produit-1");

    expect(res.status).toBe(204);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "produit-1" },
      data: {
        actif: false,
        archiveLe: expect.any(Date),
        archiveParId: "admin-1",
      },
    });
  });

  it("rend la répétition de l'archivage sans effet", async () => {
    mocks.findUnique.mockResolvedValue({ id: "produit-1", nom: "Baguette", actif: false });
    const res = await request(appProduits()).delete("/produit-1");
    expect(res.status).toBe(204);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
