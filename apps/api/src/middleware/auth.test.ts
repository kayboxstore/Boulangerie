import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CODE_SESSION_REMPLACEE } from "@lomoto/shared";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  utilisateurFindUnique: vi.fn(),
  delegationsFindMany: vi.fn(),
}));

vi.mock("../lib/jwt.js", () => ({ verifyToken: mocks.verifyToken }));
vi.mock("../lib/prisma.js", () => ({
  prisma: {
    utilisateur: { findUnique: mocks.utilisateurFindUnique },
    delegationRole: { findMany: mocks.delegationsFindMany },
  },
}));

import { requireAuth, requirePermission } from "./auth.js";

const utilisateurPersistant = {
  id: "utilisateur-1",
  nom: "Agent Test",
  email: "agent@lomoto.test",
  actif: true,
  estAdminPrincipal: false,
  languePreferee: "FR",
  roleId: "role-1",
  role: {
    id: "role-1",
    nom: "Chargé des commandes",
    roleParentId: null,
    permissions: [{ module: "COMMANDES", niveauAcces: "ECRITURE" }],
  },
};

function appProtegee() {
  const app = express();
  app.get(
    "/commandes",
    requireAuth,
    requirePermission("COMMANDES", "ECRITURE"),
    (req, res) => res.json({ utilisateurId: req.utilisateur!.id }),
  );
  return app;
}

describe("authentification et permissions serveur", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.delegationsFindMany.mockResolvedValue([]);
  });

  it("refuse une requête sans jeton", async () => {
    const res = await request(appProtegee()).get("/commandes");
    expect(res.status).toBe(401);
    expect(res.body.erreur).toBe("Authentification requise");
  });

  it("refuse un jeton dont la session a été remplacée", async () => {
    mocks.verifyToken.mockReturnValue({ sub: "utilisateur-1", roleId: "role-1", sid: "ancienne-session" });
    mocks.utilisateurFindUnique.mockResolvedValueOnce({ sessionActuelleId: "session-active" });

    const res = await request(appProtegee()).get("/commandes").set("Authorization", "Bearer jeton");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe(CODE_SESSION_REMPLACEE);
  });

  it("autorise une session active possédant la permission demandée", async () => {
    mocks.verifyToken.mockReturnValue({ sub: "utilisateur-1", roleId: "role-1", sid: "session-active" });
    mocks.utilisateurFindUnique
      .mockResolvedValueOnce({ sessionActuelleId: "session-active" })
      .mockResolvedValueOnce(utilisateurPersistant);

    const res = await request(appProtegee()).get("/commandes").set("Authorization", "Bearer jeton");

    expect(res.status).toBe(200);
    expect(res.body.utilisateurId).toBe("utilisateur-1");
  });

  it("refuse une session active dépourvue de la permission demandée", async () => {
    mocks.verifyToken.mockReturnValue({ sub: "utilisateur-1", roleId: "role-1", sid: "session-active" });
    mocks.utilisateurFindUnique
      .mockResolvedValueOnce({ sessionActuelleId: "session-active" })
      .mockResolvedValueOnce({
        ...utilisateurPersistant,
        role: { ...utilisateurPersistant.role, permissions: [] },
      });

    const res = await request(appProtegee()).get("/commandes").set("Authorization", "Bearer jeton");

    expect(res.status).toBe(403);
  });
});
