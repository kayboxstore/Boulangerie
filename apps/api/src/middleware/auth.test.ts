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

import { cheminAutoriseAvecMotDePasseTemporaire, requireAuth, requirePermission } from "./auth.js";

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

  it("refuse un jeton émis avant une désactivation de compte (P0-01 round 4, point 3) : sessionActuelleId=null ne correspond plus à aucun sid", async () => {
    // Reproduit exactement l'état laissé par PUT /api/equipe/:id/activation
    // avec { actif: false } (equipe.ts) : sessionActuelleId mis à null dans
    // la même écriture que actif. Un jeton signé avant cette désactivation
    // porte encore un `sid` non-vide — jamais égal à `null` — donc rejeté ici
    // par la même comparaison que le remplacement de session ci-dessus.
    mocks.verifyToken.mockReturnValue({ sub: "utilisateur-1", roleId: "role-1", sid: "session-avant-desactivation" });
    mocks.utilisateurFindUnique.mockResolvedValueOnce({ sessionActuelleId: null });

    const res = await request(appProtegee()).get("/commandes").set("Authorization", "Bearer ancien-jeton");

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

  it("bloque les modules métier tant que le mot de passe temporaire n'est pas remplacé", async () => {
    mocks.verifyToken.mockReturnValue({ sub: "utilisateur-1", roleId: "role-1", sid: "session-active" });
    mocks.utilisateurFindUnique.mockResolvedValueOnce({
      sessionActuelleId: "session-active",
      motDePasseDoitChanger: true,
    });

    const res = await request(appProtegee()).get("/commandes").set("Authorization", "Bearer jeton");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MOT_DE_PASSE_A_CHANGER");
    expect(mocks.utilisateurFindUnique).toHaveBeenCalledTimes(1);
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


describe("cloisonnement du mot de passe temporaire", () => {
  it("autorise uniquement la lecture de la session et le remplacement du secret", () => {
    expect(cheminAutoriseAvecMotDePasseTemporaire("GET", "/api/auth/me")).toBe(true);
    expect(cheminAutoriseAvecMotDePasseTemporaire("POST", "/api/auth/mot-de-passe")).toBe(true);
    expect(cheminAutoriseAvecMotDePasseTemporaire("POST", "/api/auth/mot-de-passe?source=temporaire")).toBe(true);
  });

  it("refuse les modules métier, le profil et une mauvaise méthode HTTP", () => {
    expect(cheminAutoriseAvecMotDePasseTemporaire("GET", "/api/produits")).toBe(false);
    expect(cheminAutoriseAvecMotDePasseTemporaire("GET", "/api/auth/profil")).toBe(false);
    expect(cheminAutoriseAvecMotDePasseTemporaire("GET", "/api/auth/mot-de-passe")).toBe(false);
    expect(cheminAutoriseAvecMotDePasseTemporaire("POST", "/api/auth/me")).toBe(false);
  });

  it("refuse les préfixes trompeurs", () => {
    expect(cheminAutoriseAvecMotDePasseTemporaire("GET", "/api/auth/me/permissions")).toBe(false);
    expect(cheminAutoriseAvecMotDePasseTemporaire("POST", "/api/auth/mot-de-passe/contourner")).toBe(false);
  });
});
