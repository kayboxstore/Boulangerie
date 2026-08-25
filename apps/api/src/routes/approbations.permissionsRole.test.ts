/**
 * Preuve de route HTTP RÉELLE (passe par le routeur Express, via supertest)
 * pour le parcours APPROBATION de MODIFIER_PERMISSIONS_ROLE :
 * `POST /api/approbations/:id/approuver` (correctif P1, Round 2, contre-revue
 * Codex du 24/08/2026, mission « Test de route du parcours avec
 * approbation »).
 *
 * Mocke `../lib/prisma.js` (uniquement le pré-check léger `type` et la
 * relecture finale) et `../services/permissionsRoleAudit.js`
 * (`approuverEtAppliquerModificationPermissionsRole`, la fonction la plus
 * profonde) — laisse le routeur réel décider l'aiguillage
 * MODIFIER_PERMISSIONS_ROLE vs les 4 autres types et traduire les erreurs en
 * codes HTTP.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  demandeFindUnique: vi.fn(),
  demandeFindUniqueOrThrow: vi.fn(),
  demandeUpdate: vi.fn(),
  approuverEtAppliquer: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    demandeApprobation: {
      findUnique: mocks.demandeFindUnique,
      findUniqueOrThrow: mocks.demandeFindUniqueOrThrow,
      update: mocks.demandeUpdate,
    },
  },
}));

vi.mock("../services/permissionsRoleAudit.js", async () => {
  const actual = await vi.importActual<typeof import("../services/permissionsRoleAudit.js")>(
    "../services/permissionsRoleAudit.js",
  );
  return {
    ErreurApprobationConcurrente: actual.ErreurApprobationConcurrente,
    approuverEtAppliquerModificationPermissionsRole: mocks.approuverEtAppliquer,
  };
});

vi.mock("../services/actionsCritiques.js", () => ({
  executerAction: vi.fn(),
  ErreurAction: class ErreurAction extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

const PRINCIPAL = { id: "u-principal", nom: "Aline (Admin Principal)" };

// Mutable : chaque test contrôle qui `requireAuth` connecte, sans avoir à
// empiler un second middleware qui serait de toute façon écrasé par celui du
// routeur (`approbationsRouter.use(requireAuth, ...)` s'exécute après).
let utilisateurActuel: { id: string; nom: string; estAdminPrincipal: boolean } = {
  ...PRINCIPAL,
  estAdminPrincipal: true,
};

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = utilisateurActuel as express.Request["utilisateur"];
    next();
  },
  requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { approbationsRouter } from "./approbations.js";
import { ErreurApprobationConcurrente } from "../services/permissionsRoleAudit.js";

function appApprobations() {
  const app = express();
  app.use(express.json());
  app.use("/api/approbations", approbationsRouter);
  return app;
}

const DEMANDE_ID = "demande-42";
const SECONDAIRE = { id: "u-secondaire", nom: "Bakari (Admin secondaire)" };

describe("POST /api/approbations/:id/approuver — parcours APPROBATION, MODIFIER_PERMISSIONS_ROLE (Round 2, test de route HTTP réel)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    utilisateurActuel = { ...PRINCIPAL, estAdminPrincipal: true };
  });

  it("demande d'un Admin secondaire approuvée par le Principal : acteur=Principal, demandeur=Admin secondaire, id exact, mode approbation", async () => {
    mocks.demandeFindUnique.mockResolvedValue({ type: "MODIFIER_PERMISSIONS_ROLE" });
    mocks.approuverEtAppliquer.mockResolvedValue({
      roleNom: "Caissier(ère)",
      avant: [],
      apres: [],
      diff: { ajouts: [], retraits: [], modifications: [] },
      demandeStatut: "APPROUVEE",
      demandeApprouveParId: PRINCIPAL.id,
      demandeDateDecision: new Date("2026-08-24T22:00:00Z"),
    });
    mocks.demandeFindUniqueOrThrow.mockResolvedValue({
      id: DEMANDE_ID,
      type: "MODIFIER_PERMISSIONS_ROLE",
      resume: "modifier les permissions du rôle « Caissier(ère) »",
      statut: "APPROUVEE",
      demandePar: SECONDAIRE,
      approuvePar: PRINCIPAL,
      erreur: null,
      dateDemande: new Date("2026-08-24T21:00:00Z"),
      dateDecision: new Date("2026-08-24T22:00:00Z"),
    });

    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});

    expect(res.status).toBe(200);
    expect(res.body.demande.id).toBe(DEMANDE_ID);
    expect(res.body.demande.statut).toBe("APPROUVEE");
    // Acteur (qui a APPROUVÉ) = le Principal — distinct du demandeur d'origine.
    expect(res.body.demande.approuvePar).toEqual(PRINCIPAL);
    expect(res.body.demande.demandePar).toEqual(SECONDAIRE);
    expect(res.body.message).toMatch(/Caissier\(ère\)/);

    // Preuve du câblage réel : la fonction atomique reçoit l'id EXACT de
    // l'URL et l'identité EXACTE de l'approbateur courant (jamais celle du
    // demandeur).
    expect(mocks.approuverEtAppliquer).toHaveBeenCalledTimes(1);
    expect(mocks.approuverEtAppliquer).toHaveBeenCalledWith(expect.anything(), DEMANDE_ID, PRINCIPAL);
  });

  it("réservation perdue (course concurrente déjà tranchée) : 409, service appelé mais aucune double approbation apparente", async () => {
    mocks.demandeFindUnique.mockResolvedValue({ type: "MODIFIER_PERMISSIONS_ROLE" });
    mocks.approuverEtAppliquer.mockRejectedValue(new ErreurApprobationConcurrente());

    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});

    expect(res.status).toBe(409);
    expect(mocks.demandeFindUniqueOrThrow).not.toHaveBeenCalled(); // pas de relecture DTO après un 409
  });

  it("demande introuvable : 404, service jamais appelé", async () => {
    mocks.demandeFindUnique.mockResolvedValue(null);

    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});

    expect(res.status).toBe(404);
    expect(mocks.approuverEtAppliquer).not.toHaveBeenCalled();
  });

  it("acteur non Admin Principal : 403, service jamais appelé (garde d'autorisation préservée)", async () => {
    utilisateurActuel = { ...SECONDAIRE, estAdminPrincipal: false };

    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});

    expect(res.status).toBe(403);
    expect(mocks.approuverEtAppliquer).not.toHaveBeenCalled();
  });
});
