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
 *
 * Depuis le round 6 (revue Codex, point 1), la désactivation n'est plus un
 * `update` inconditionnel précédé d'une pré-lecture de `estAdminPrincipal` :
 * c'est un `updateMany` dont le `where` inclut `estAdminPrincipal: false`,
 * évalué atomiquement par PostgreSQL au moment même de l'écriture — voir
 * `equipe.ts`. Ces tests mockés prouvent que la route appelle bien cette
 * écriture conditionnelle et réagit correctement à `count === 0` ; ils ne
 * prouvent PAS l'atomicité elle-même face à une vraie concurrence (un mock
 * ne peut pas simuler une course) — cette preuve est apportée séparément,
 * contre une vraie base PostgreSQL, par
 * `scripts/verifier-concurrence-equipe-ci.ts`.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  invaliderSessionUtilisateur: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    utilisateur: {
      findUnique: mocks.findUnique,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
      updateMany: mocks.updateMany,
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

  it("désactivation : updateMany conditionné sur estAdminPrincipal=false, avec actif=false ET sessionActuelleId=null dans la même écriture", async () => {
    mocks.findUnique.mockResolvedValue(COMPTE_CIBLE);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValue({ ...COMPTE_CIBLE, actif: false });

    const res = await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: false });

    expect(res.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", estAdminPrincipal: false },
      data: { actif: false, sessionActuelleId: null },
    });
  });

  it("invalidation Socket.io appelée EXACTEMENT une fois, avec le bon id, après le succès de l'écriture (count=1)", async () => {
    mocks.findUnique.mockResolvedValue(COMPTE_CIBLE);
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValue({ ...COMPTE_CIBLE, actif: false });

    await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: false });

    expect(mocks.invaliderSessionUtilisateur).toHaveBeenCalledTimes(1);
    expect(mocks.invaliderSessionUtilisateur).toHaveBeenCalledWith("u1");
  });

  it("aucune invalidation si l'écriture Prisma échoue (rejet)", async () => {
    mocks.findUnique.mockResolvedValue(COMPTE_CIBLE);
    mocks.updateMany.mockRejectedValue(new Error("échec DB simulé"));

    const res = await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: false });

    expect(res.status).toBeGreaterThanOrEqual(400); // passe par next(e), jamais un 200
    expect(mocks.invaliderSessionUtilisateur).not.toHaveBeenCalled();
  });

  it("réactivation : ne touche PAS sessionActuelleId — aucune session artificielle créée", async () => {
    mocks.findUnique.mockResolvedValue({ ...COMPTE_CIBLE, actif: false });
    mocks.update.mockResolvedValue({ ...COMPTE_CIBLE, actif: true });

    await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: true });

    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { actif: true },
      include: expect.anything(),
    });
    const dataEnvoyee = mocks.update.mock.calls[0]![0].data;
    expect("sessionActuelleId" in dataEnvoyee).toBe(false);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.invaliderSessionUtilisateur).not.toHaveBeenCalled();
  });

  it("interdiction de se désactiver soi-même — préservée, aucune écriture tentée", async () => {
    mocks.findUnique.mockResolvedValue({ ...COMPTE_CIBLE, id: "admin-appelant" }); // même id que req.utilisateur (mock requireAuth)

    const res = await request(appEquipe()).put("/api/equipe/admin-appelant/activation").send({ actif: false });

    expect(res.status).toBe(409);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.invaliderSessionUtilisateur).not.toHaveBeenCalled();
  });
});

describe("PUT /api/equipe/:id/activation — protection du Principal, invariant appliqué à l'écriture (P0-01 round 5 point 1, durci round 6 point 1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("un Administrateur secondaire ne peut pas désactiver le Principal — l'updateMany conditionnel n'affecte aucune ligne (count=0), la route relit pour construire le message d'erreur", async () => {
    mocks.findUnique
      .mockResolvedValueOnce({ ...COMPTE_CIBLE, estAdminPrincipal: true }) // lecture initiale
      .mockResolvedValueOnce({ estAdminPrincipal: true }); // relecture après count=0, pour le message
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: false });

    expect(res.status).toBe(409);
    expect(res.body.erreur).toMatch(/transférez d'abord/i);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", estAdminPrincipal: false },
      data: { actif: false, sessionActuelleId: null },
    });
  });

  it("aucune invalidation Socket.io quand l'updateMany conditionnel n'affecte aucune ligne (count=0)", async () => {
    mocks.findUnique
      .mockResolvedValueOnce({ ...COMPTE_CIBLE, estAdminPrincipal: true })
      .mockResolvedValueOnce({ estAdminPrincipal: true });
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: false });

    expect(mocks.invaliderSessionUtilisateur).not.toHaveBeenCalled();
  });

  it("count=0 mais le compte n'existe plus du tout à la relecture → 404, jamais un 409 trompeur", async () => {
    mocks.findUnique
      .mockResolvedValueOnce({ ...COMPTE_CIBLE, estAdminPrincipal: false })
      .mockResolvedValueOnce(null); // supprimé/introuvable entre-temps
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const res = await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: false });

    expect(res.status).toBe(404);
  });

  it("la réactivation d'un compte n'est jamais bloquée par la garde Principal (elle ne s'applique qu'à la désactivation)", async () => {
    mocks.findUnique.mockResolvedValue({ ...COMPTE_CIBLE, estAdminPrincipal: true, actif: false });
    mocks.update.mockResolvedValue({ ...COMPTE_CIBLE, estAdminPrincipal: true, actif: true });

    const res = await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: true });

    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it("l'ancien Principal, devenu un Administrateur ordinaire après transfert (estAdminPrincipal=false), est désactivable : count=1", async () => {
    mocks.findUnique.mockResolvedValue({ ...COMPTE_CIBLE, estAdminPrincipal: false });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValue({ ...COMPTE_CIBLE, estAdminPrincipal: false, actif: false });

    const res = await request(appEquipe()).put("/api/equipe/u1/activation").send({ actif: false });

    expect(res.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", estAdminPrincipal: false },
      data: { actif: false, sessionActuelleId: null },
    });
    expect(mocks.invaliderSessionUtilisateur).toHaveBeenCalledTimes(1);
  });

  it("l'interdiction de s'auto-désactiver reste intacte même quand l'appelant est aussi le Principal", async () => {
    mocks.findUnique.mockResolvedValue({ ...COMPTE_CIBLE, id: "admin-appelant", estAdminPrincipal: true });

    const res = await request(appEquipe()).put("/api/equipe/admin-appelant/activation").send({ actif: false });

    expect(res.status).toBe(409);
    expect(res.body.erreur).toMatch(/propre compte/i);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
