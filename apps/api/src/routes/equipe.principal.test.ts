/**
 * Preuves du correctif P0-01 (round 5, revue Codex, point 2) :
 * `POST /api/equipe/:id/principal` vérifiait déjà le rôle Administrateur de
 * la cible, mais pas son statut `actif`. Un compte désactivé pouvait donc
 * devenir Administrateur principal — un état qui laisse la base sans
 * personne capable d'agir avec ce statut. La route refuse désormais toute
 * cible inactive (409), avant même de démarrer la transaction de transfert.
 *
 * Depuis le round 6 (revue Codex, point 1) : cette pré-lecture (`actif`,
 * `estAdminPrincipal`, rôle) reste une vérification rapide utile, mais n'est
 * PLUS ce qui garantit la correction — les deux écritures de la transaction
 * sont désormais des `updateMany` conditionnées sur l'état exigé au moment
 * même de l'écriture (`equipe.ts`). Ces tests mockés prouvent que la route
 * appelle bien ces deux écritures conditionnelles dans le bon ordre et
 * réagit correctement quand l'une des deux n'affecte aucune ligne
 * (`count === 0`, simulant une course perdue) ; ils ne prouvent PAS
 * l'atomicité elle-même face à une vraie concurrence (impossible à simuler
 * fidèlement avec un mock, puisque `$transaction` est ici remplacé par un
 * simple appel direct au callback, sans le verrouillage de ligne réel de
 * PostgreSQL) — cette preuve est apportée séparément, contre une vraie base
 * PostgreSQL avec de vraies requêtes concurrentes, par
 * `scripts/verifier-concurrence-equipe-ci.ts`.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  transaction: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
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
  // le callback avec un tx minimal exposant les mêmes méthodes. NE reproduit
  // PAS le verrouillage de ligne / rollback réel de PostgreSQL — voir la
  // docstring en tête de fichier.
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback({
      utilisateur: {
        updateMany: mocks.updateMany,
        findUniqueOrThrow: mocks.findUniqueOrThrow,
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

describe("POST /api/equipe/:id/principal — invariant appliqué aux deux écritures (P0-01 round 6, point 1)", () => {
  it("cible active Administrateur → transaction exécutée dans l'ordre : retrait conditionnel de l'ancien Principal PUIS attribution conditionnelle à la cible", async () => {
    mocks.findUnique.mockResolvedValue(CIBLE_ADMIN_ACTIVE);
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValue({ ...CIBLE_ADMIN_ACTIVE, estAdminPrincipal: true });

    const res = await request(appEquipe()).post("/api/equipe/u2/principal").send({});

    expect(res.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "principal-actuel", estAdminPrincipal: true },
      data: { estAdminPrincipal: false },
    });
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "u2", actif: true, estAdminPrincipal: false, role: { nom: "Administrateur" } },
      data: { estAdminPrincipal: true },
    });
    expect(mocks.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "u2" } }),
    );
  });

  it("retrait de l'ancien Principal sans effet (count=0, course perdue — il n'est déjà plus Principal) → 409, l'attribution n'est JAMAIS tentée", async () => {
    mocks.findUnique.mockResolvedValue(CIBLE_ADMIN_ACTIVE);
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await request(appEquipe()).post("/api/equipe/u2/principal").send({});

    expect(res.status).toBe(409);
    expect(res.body.erreur).toMatch(/état a changé/i);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1); // jamais la 2ᵉ écriture
    expect(mocks.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("attribution à la cible sans effet (count=0, cible devenue inactive/inéligible entre-temps) → 409, après que le retrait a pourtant réussi", async () => {
    mocks.findUnique.mockResolvedValue(CIBLE_ADMIN_ACTIVE);
    mocks.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const res = await request(appEquipe()).post("/api/equipe/u2/principal").send({});

    expect(res.status).toBe(409);
    expect(res.body.erreur).toMatch(/état a changé/i);
    expect(mocks.updateMany).toHaveBeenCalledTimes(2);
    expect(mocks.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
