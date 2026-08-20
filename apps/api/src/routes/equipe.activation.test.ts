/**
 * Preuves du correctif P0-01 (round 4, revue Codex, point 3) : la
 * désactivation d'un compte (`PUT /api/equipe/:id/activation`) doit
 * désormais révoquer immédiatement sa session — effacer `sessionActuelleId`
 * dans la MÊME écriture que `actif: false`, puis invalider la session
 * Socket.io une fois cette écriture confirmée réussie, jamais avant.
 *
 * Le rejet effectif d'un ancien jeton (conséquence de `sessionActuelleId`
 * mis à `null`) est prouvé séparément dans `middleware/auth.test.ts`, qui
 * exerce le VRAI `requireAuth` — ce fichier-ci mocke `requireAuth` (comme
 * partout ailleurs dans les tests de routes) et prouve donc uniquement ce
 * que cette route elle-même fait : l'écriture et l'appel d'invalidation.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  invaliderSessionUtilisateur: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    utilisateur: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
  },
}));

vi.mock("../lib/realtime.js", () => ({
  invaliderSessionUtilisateur: mocks.invaliderSessionUtilisateur,
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = { id: "admin-appelant" } as express.Request["utilisateur"];
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

const COMPTE_CIBLE = {
  id: "u1",
  nom: "Compte Test",
  email: "compte-test@boulangerie-lomoto.com",
  estAdminPrincipal: false,
  motDePasseDoitChanger: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  role: { id: "r1", nom: "Caissier(ère)" },
};

describe("PUT /api/equipe/:id/activation — révocation de session (P0-01 round 4, point 3)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("désactivation : actif=false ET sessionActuelleId=null dans LA MÊME écriture Prisma", async () => {
    mocks.findUnique.mockResolvedValue(COMPTE_CIBLE);
    mocks.update.mockResolvedValue({ ...COMPTE_CIBLE, actif: false });

    const res = await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: false });

    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: { actif: false, sessionActuelleId: null },
      }),
    );
  });

  it("invalidation Socket.io appelée EXACTEMENT une fois, avec le bon id, après le succès de l'écriture", async () => {
    mocks.findUnique.mockResolvedValue(COMPTE_CIBLE);
    mocks.update.mockResolvedValue({ ...COMPTE_CIBLE, actif: false });

    await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: false });

    expect(mocks.invaliderSessionUtilisateur).toHaveBeenCalledTimes(1);
    expect(mocks.invaliderSessionUtilisateur).toHaveBeenCalledWith("u1");
  });

  it("aucune invalidation si l'écriture Prisma échoue", async () => {
    mocks.findUnique.mockResolvedValue(COMPTE_CIBLE);
    mocks.update.mockRejectedValue(new Error("échec DB simulé"));

    const res = await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: false });

    expect(res.status).toBeGreaterThanOrEqual(400); // passe par next(e), jamais un 200
    expect(mocks.invaliderSessionUtilisateur).not.toHaveBeenCalled();
  });

  it("réactivation : ne touche PAS sessionActuelleId — aucune session artificielle créée", async () => {
    mocks.findUnique.mockResolvedValue({ ...COMPTE_CIBLE, actif: false });
    mocks.update.mockResolvedValue({ ...COMPTE_CIBLE, actif: true });

    await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: true });

    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: { actif: true },
      }),
    );
    // Confirme qu'aucune clé sessionActuelleId n'a été passée du tout — pas
    // même explicitement à une valeur — sur la branche réactivation.
    const dataEnvoyee = mocks.update.mock.calls[0]![0].data;
    expect("sessionActuelleId" in dataEnvoyee).toBe(false);
    expect(mocks.invaliderSessionUtilisateur).not.toHaveBeenCalled();
  });

  it("interdiction de se désactiver soi-même — préservée, aucune écriture tentée", async () => {
    mocks.findUnique.mockResolvedValue({ ...COMPTE_CIBLE, id: "admin-appelant" }); // même id que req.utilisateur (mock requireAuth)

    const res = await request(appEquipe()).put("/api/equipe/admin-appelant/activation").send({ actif: false });

    expect(res.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.invaliderSessionUtilisateur).not.toHaveBeenCalled();
  });
});

describe("PUT /api/equipe/:id/activation — protection du Principal (P0-01 round 5, point 1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("un Administrateur secondaire (l'appelant mocké n'est pas Principal) ne peut pas désactiver le Principal", async () => {
    mocks.findUnique.mockResolvedValue({ ...COMPTE_CIBLE, estAdminPrincipal: true });

    const res = await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: false });

    expect(res.status).toBe(409);
    expect(res.body.erreur).toMatch(/transférez d'abord/i);
  });

  it("aucune écriture Prisma ni invalidation Socket.io n'a lieu lors du refus", async () => {
    mocks.findUnique.mockResolvedValue({ ...COMPTE_CIBLE, estAdminPrincipal: true });

    await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: false });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.invaliderSessionUtilisateur).not.toHaveBeenCalled();
  });

  it("la désactivation du Principal reste refusée même en tentant de réactiver en même temps (actif:false prime)", async () => {
    // Le body n'admet qu'un seul actif ; ce test vérifie que le refus porte
    // uniquement sur la désactivation, pas sur une réactivation du Principal.
    mocks.findUnique.mockResolvedValue({ ...COMPTE_CIBLE, estAdminPrincipal: true, actif: false });
    mocks.update.mockResolvedValue({ ...COMPTE_CIBLE, estAdminPrincipal: true, actif: true });

    const res = await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: true });

    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("l'ancien Principal, devenu un Administrateur ordinaire après transfert (estAdminPrincipal=false), peut être désactivé normalement", async () => {
    mocks.findUnique.mockResolvedValue({ ...COMPTE_CIBLE, estAdminPrincipal: false });
    mocks.update.mockResolvedValue({ ...COMPTE_CIBLE, estAdminPrincipal: false, actif: false });

    const res = await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: false });

    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u1" }, data: { actif: false, sessionActuelleId: null } }),
    );
    expect(mocks.invaliderSessionUtilisateur).toHaveBeenCalledTimes(1);
  });

  it("l'interdiction de s'auto-désactiver reste intacte même quand l'appelant est aussi le Principal", async () => {
    mocks.findUnique.mockResolvedValue({ ...COMPTE_CIBLE, id: "admin-appelant", estAdminPrincipal: true });

    const res = await request(appEquipe()).put("/api/equipe/admin-appelant/activation").send({ actif: false });

    expect(res.status).toBe(409);
    expect(res.body.erreur).toMatch(/propre compte/i);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
