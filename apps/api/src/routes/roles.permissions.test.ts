/**
 * Preuve de route HTTP RÉELLE (passe par le routeur Express, via supertest —
 * pas un appel direct à un service) pour le parcours DIRECT de
 * MODIFIER_PERMISSIONS_ROLE : `PUT /api/roles/:id/permissions` (correctif
 * P1, Round 2, contre-revue Codex du 24/08/2026, mission « Test de route du
 * parcours direct »).
 *
 * Mocke `../lib/prisma.js` (uniquement le pré-check `role.findUnique` de la
 * route) et `../services/permissionsRoleAudit.js` (la fonction la plus
 * profonde, celle qui touche réellement Prisma) — laisse `traiterActionCritique`
 * et `EXECUTEURS.MODIFIER_PERMISSIONS_ROLE` (`actionsCritiques.ts`) s'exécuter
 * pour de vrai, afin de prouver le câblage réel route → aiguillage
 * direct/différé → exécuteur → service, pas seulement le service isolé (déjà
 * prouvé par `permissionsRoleAudit.test.ts`).
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  roleFindUnique: vi.fn(),
  appliquerModificationPermissionsRole: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    role: { findUnique: mocks.roleFindUnique },
  },
}));

vi.mock("../services/permissionsRoleAudit.js", () => ({
  appliquerModificationPermissionsRole: mocks.appliquerModificationPermissionsRole,
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = { id: "u-admin-principal", nom: "Aline (Admin Principal)", estAdminPrincipal: true } as express.Request["utilisateur"];
    next();
  },
  requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { rolesRouter } from "./roles.js";

function appRoles() {
  const app = express();
  app.use(express.json());
  app.use("/api/roles", rolesRouter);
  return app;
}

const ROLE_ID = "role-1";

describe("PUT /api/roles/:id/permissions — parcours DIRECT (Round 2, test de route HTTP réel)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Admin Principal exécutant : 200, message exact, service appelé une fois avec le rôle et les permissions exacts", async () => {
    mocks.roleFindUnique.mockResolvedValue({ id: ROLE_ID, nom: "Caissier(ère)" });
    mocks.appliquerModificationPermissionsRole.mockResolvedValue({
      roleNom: "Caissier(ère)",
      avant: [],
      apres: [],
      diff: { ajouts: [], retraits: [], modifications: [] },
    });

    const res = await request(appRoles())
      .put(`/api/roles/${ROLE_ID}/permissions`)
      .send({ permissions: [{ module: "CAISSE", niveauAcces: "LECTURE" }] });

    expect(res.status).toBe(200);
    expect(res.body.statut).toBe("execute");
    expect(res.body.message).toMatch(/Caissier\(ère\)/);

    // Route HTTP réelle → traiterActionCritique (réel) → executerAction
    // (réel) → EXECUTEURS.MODIFIER_PERMISSIONS_ROLE (réel) →
    // appliquerModificationPermissionsRole (mocké ici) : exactement 3
    // arguments (client, roleId, permissions) — la signature n'accepte plus
    // de 4e argument de contexte depuis le Round 2, l'exécution DIRECTE ne
    // passe jamais par le workflow d'approbation.
    expect(mocks.appliquerModificationPermissionsRole).toHaveBeenCalledTimes(1);
    expect(mocks.appliquerModificationPermissionsRole).toHaveBeenCalledWith(expect.anything(), ROLE_ID, [
      { module: "CAISSE", niveauAcces: "LECTURE" },
    ]);
  });

  it("rôle introuvable : 404 avant même d'appeler le service (pré-check de la route)", async () => {
    mocks.roleFindUnique.mockResolvedValue(null);

    const res = await request(appRoles())
      .put(`/api/roles/${ROLE_ID}/permissions`)
      .send({ permissions: [{ module: "CAISSE", niveauAcces: "LECTURE" }] });

    expect(res.status).toBe(404);
    expect(mocks.appliquerModificationPermissionsRole).not.toHaveBeenCalled();
  });

  it("corps de requête invalide (module hors énumération) : 400, service jamais appelé", async () => {
    mocks.roleFindUnique.mockResolvedValue({ id: ROLE_ID, nom: "Caissier(ère)" });

    const res = await request(appRoles())
      .put(`/api/roles/${ROLE_ID}/permissions`)
      .send({ permissions: [{ module: "MODULE_INEXISTANT", niveauAcces: "LECTURE" }] });

    expect(res.status).toBe(400);
    expect(mocks.appliquerModificationPermissionsRole).not.toHaveBeenCalled();
  });
});
