/**
 * Preuves HTTP mockées (P1-A, 28/08/2026) : le middleware de garde
 * s'applique bien aux 4 routes du parcours, et /finaliser traduit
 * correctement les erreurs du service en codes HTTP.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErreurAction } from "../lib/erreurAction.js";
import { ErreurFinalisationReessayable } from "../services/premierLancement.js";

const mocks = vi.hoisted(() => ({
  secretValide: vi.fn(),
  finaliserDirect: vi.fn(),
  utilisateurCount: vi.fn(),
  travailleurCreate: vi.fn(),
  travailleurFindUnique: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    utilisateur: { count: mocks.utilisateurCount },
    travailleur: { create: mocks.travailleurCreate, findUnique: mocks.travailleurFindUnique },
  },
}));

vi.mock("../services/premierLancement.js", async () => {
  const actual = await vi.importActual<typeof import("../services/premierLancement.js")>("../services/premierLancement.js");
  return {
    ...actual,
    secretPremierLancementValide: mocks.secretValide,
    finaliserPremierLancementDirect: mocks.finaliserDirect,
  };
});

vi.mock("../services/emailPro.js", () => ({
  declencherEmailPro: vi.fn(),
  verifierEmailPro: vi.fn(),
}));

import { premierLancementRouter } from "./premierLancement.js";

function appPremierLancement() {
  const app = express();
  app.use(express.json());
  app.use("/api/premier-lancement", premierLancementRouter);
  return app;
}

const EN_TETE = "X-Secret-Premier-Lancement";

describe("premierLancementRouter — garde du secret sur les 4 routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.utilisateurCount.mockResolvedValue(0);
  });

  it.each([
    ["/travailleur", { nom: "A", poste: "P", dateEmbauche: "2026-01-01" }],
    ["/travailleur/t-1/email-pro", { emailDestination: "a@b.com" }],
    ["/travailleur/t-1/email-pro/verifier", {}],
    ["/finaliser", { travailleurId: "t-1", motDePasse: "motdepasse123" }],
  ])("401 sur %s sans en-tête secret (secretPremierLancementValide jamais appelé sans header -> false)", async (chemin, corps) => {
    mocks.secretValide.mockResolvedValue(false);
    const res = await request(appPremierLancement()).post(`/api/premier-lancement${chemin}`).send(corps);
    expect(res.status).toBe(401);
    expect(mocks.travailleurCreate).not.toHaveBeenCalled();
    expect(mocks.finaliserDirect).not.toHaveBeenCalled();
  });

  it("401 avec un mauvais secret sur /travailleur — aucune fiche créée", async () => {
    mocks.secretValide.mockResolvedValue(false);
    const res = await request(appPremierLancement())
      .post("/api/premier-lancement/travailleur")
      .set(EN_TETE, "mauvais-secret")
      .send({ nom: "A", poste: "P", dateEmbauche: "2026-01-01" });
    expect(res.status).toBe(401);
    expect(mocks.travailleurCreate).not.toHaveBeenCalled();
  });

  it("secret valide sur /travailleur : la garde laisse passer, la fiche est créée", async () => {
    mocks.secretValide.mockResolvedValue(true);
    mocks.travailleurCreate.mockResolvedValue({
      id: "t-1",
      nom: "A",
      telephone: null,
      poste: "P",
      dateEmbauche: new Date("2026-01-01"),
      utilisateur: null,
      emailDestination: null,
      emailProAdresse: null,
      emailProStatut: "AUCUNE",
      emailProErreur: null,
      departement: null,
      groupe: null,
      salaireMensuel: null,
      joursTravaillesParMois: null,
    });
    const res = await request(appPremierLancement())
      .post("/api/premier-lancement/travailleur")
      .set(EN_TETE, "bon-secret")
      .send({ nom: "A", poste: "P", dateEmbauche: "2026-01-01" });
    expect(res.status).toBe(201);
    expect(mocks.travailleurCreate).toHaveBeenCalledOnce();
  });

  it("base déjà non vide : 409 avant même de regarder le secret n'a pas d'importance ici — le garde-fou base vide reste actif après la garde secret", async () => {
    mocks.secretValide.mockResolvedValue(true);
    mocks.utilisateurCount.mockResolvedValue(1);
    const res = await request(appPremierLancement())
      .post("/api/premier-lancement/travailleur")
      .set(EN_TETE, "bon-secret")
      .send({ nom: "A", poste: "P", dateEmbauche: "2026-01-01" });
    expect(res.status).toBe(409);
    expect(mocks.travailleurCreate).not.toHaveBeenCalled();
  });
});

describe("POST /finaliser — traduction des erreurs du service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.secretValide.mockResolvedValue(true);
  });

  it("succède : 201 ok", async () => {
    mocks.finaliserDirect.mockResolvedValue(undefined);
    const res = await request(appPremierLancement())
      .post("/api/premier-lancement/finaliser")
      .set(EN_TETE, "bon-secret")
      .send({ travailleurId: "t-1", motDePasse: "motdepasse123" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect(mocks.finaliserDirect).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ secretFourni: "bon-secret", travailleurId: "t-1", motDePasse: "motdepasse123" }),
    );
  });

  it("ErreurAction(401) du service -> 401 avec le message exact", async () => {
    mocks.finaliserDirect.mockRejectedValue(new ErreurAction(401, "Secret de premier lancement invalide, expiré ou déjà utilisé"));
    const res = await request(appPremierLancement())
      .post("/api/premier-lancement/finaliser")
      .set(EN_TETE, "secret-rejoue")
      .send({ travailleurId: "t-1", motDePasse: "motdepasse123" });
    expect(res.status).toBe(401);
    expect(res.body.erreur).toBe("Secret de premier lancement invalide, expiré ou déjà utilisé");
  });

  it("ErreurAction(409) du service (course de finalisation) -> 409", async () => {
    mocks.finaliserDirect.mockRejectedValue(new ErreurAction(409, "La configuration initiale est déjà terminée — connectez-vous normalement."));
    const res = await request(appPremierLancement())
      .post("/api/premier-lancement/finaliser")
      .set(EN_TETE, "bon-secret")
      .send({ travailleurId: "t-1", motDePasse: "motdepasse123" });
    expect(res.status).toBe(409);
  });

  it("ErreurFinalisationReessayable du service -> 503", async () => {
    mocks.finaliserDirect.mockRejectedValue(new ErreurFinalisationReessayable());
    const res = await request(appPremierLancement())
      .post("/api/premier-lancement/finaliser")
      .set(EN_TETE, "bon-secret")
      .send({ travailleurId: "t-1", motDePasse: "motdepasse123" });
    expect(res.status).toBe(503);
  });

  it("400 si le mot de passe est trop court, sans même appeler le service", async () => {
    const res = await request(appPremierLancement())
      .post("/api/premier-lancement/finaliser")
      .set(EN_TETE, "bon-secret")
      .send({ travailleurId: "t-1", motDePasse: "court" });
    expect(res.status).toBe(400);
    expect(mocks.finaliserDirect).not.toHaveBeenCalled();
  });
});
