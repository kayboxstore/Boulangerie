/**
 * Preuves du correctif P0-01 (round 5, revue Codex, point 2) :
 * `POST /api/equipe/:id/principal` vérifiait déjà le rôle Administrateur de
 * la cible, mais pas son statut `actif`. Un compte désactivé pouvait donc
 * devenir Administrateur principal — un état qui laisse la base sans
 * personne capable d'agir avec ce statut. La route refuse désormais toute
 * cible inactive (409), avant même de démarrer la transaction de transfert.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  transaction: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    utilisateur: {
      findUnique: mocks.findUnique,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../lib/realtime.js", () => ({
  invaliderSessionUtilisateur: vi.fn(),
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = { id: "principal-actuel", estAdminPrincipal: true } as express.Request["utilisateur"];
    next();
  },
  requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("../services/actionsCritiques.js", () => ({
  traiterActionCritique: vi.fn(),
}));

import { equipeRouter } from "./equipe.js";

function appEquipe() {
  const app = express();
  app.use(express.json());
  app.use("/api/equipe", equipeRouter);
  return app;
}

const CIBLE_ADMIN_ACTIVE = {
  id: "u2",
  nom: "Cible Test",
  email: "cible-test@boulangerie-lomoto.com",
  actif: true,
  estAdminPrincipal: false,
  motDePasseDoitChanger: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  role: { id: "r-admin", nom: "Administrateur" },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Reproduit le comportement réel de prisma.$transaction(callback) : exécute
  // le callback avec un tx minimal exposant les mêmes méthodes.
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback({
      utilisateur: {
        updateMany: mocks.updateMany,
        update: mocks.update,
      },
    }),
  );
});

describe("POST /api/equipe/:id/principal — cible inactive refusée (P0-01 round 5, point 2)", () => {
  it("cible Administrateur mais inactive → 409, aucune transaction démarrée", async () => {
    mocks.findUnique.mockResolvedValue({ ...CIBLE_ADMIN_ACTIVE, actif: false });

    const res = await request(appEquipe()).post("/api/equipe/u2/principal").send({});

    expect(res.status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("cible Administrateur active → acceptée, transaction exécutée", async () => {
    mocks.findUnique.mockResolvedValue(CIBLE_ADMIN_ACTIVE);
    mocks.update.mockResolvedValue({ ...CIBLE_ADMIN_ACTIVE, estAdminPrincipal: true });

    const res = await request(appEquipe()).post("/api/equipe/u2/principal").send({});

    expect(res.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { estAdminPrincipal: true },
      data: { estAdminPrincipal: false },
    });
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u2" }, data: { estAdminPrincipal: true } }),
    );
  });

  it("cible active mais avec un autre rôle que Administrateur → toujours refusée, même active", async () => {
    mocks.findUnique.mockResolvedValue({
      ...CIBLE_ADMIN_ACTIVE,
      actif: true,
      role: { id: "r-caissier", nom: "Caissier(ère)" },
    });

    const res = await request(appEquipe()).post("/api/equipe/u2/principal").send({});

    expect(res.status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("cible inactive ET avec un autre rôle → refusée pour la même raison de fond (409), transaction jamais démarrée", async () => {
    mocks.findUnique.mockResolvedValue({
      ...CIBLE_ADMIN_ACTIVE,
      actif: false,
      role: { id: "r-caissier", nom: "Caissier(ère)" },
    });

    const res = await request(appEquipe()).post("/api/equipe/u2/principal").send({});

    expect(res.status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
