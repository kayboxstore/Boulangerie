/**
 * Preuves HTTP mockées (P0, 30/08/2026) de `routes/etat-systeme.ts` :
 * réservation à l'Administrateur principal, désactivation en production
 * reflétée honnêtement AUSSI côté route (pas seulement dans le service),
 * traduction des erreurs en JSON clair (jamais un code brut), et DTO
 * `GET /` honnête sur la disponibilité réelle de la réinitialisation.
 *
 * Convention : mock au niveau du SERVICE (`services/reinitialisation.js`),
 * comme `routes/caisse.test.ts` — même idiome. La preuve PostgreSQL réelle
 * de bout en bout est apportée séparément par
 * `scripts/verifier-sauvegarde-reinitialisation-ci.ts`.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let utilisateurCourant: { id: string; estAdminPrincipal: boolean } = { id: "u-1", estAdminPrincipal: false };

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = utilisateurCourant as express.Request["utilisateur"];
    next();
  },
  requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const mocks = vi.hoisted(() => ({
  reinitialiserBase: vi.fn(),
  reinitialisationAutoriseeIci: vi.fn(() => true),
  emit: vi.fn(),
  disconnectSockets: vi.fn(),
  queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  utilisateurCount: vi.fn().mockResolvedValue(0),
  sauvegardeBaseFindMany: vi.fn().mockResolvedValue([]),
  sauvegardeBaseFindFirst: vi.fn().mockResolvedValue(null),
  sauvegardeBaseCreate: vi.fn().mockResolvedValue({ id: "sauv-manuelle-1" }),
  construireDump: vi.fn(),
  validerDump: vi.fn(),
}));

vi.mock("../services/reinitialisation.js", async (importOriginal) => {
  const reel = await importOriginal<typeof import("../services/reinitialisation.js")>();
  return {
    ...reel,
    reinitialiserBase: mocks.reinitialiserBase,
    reinitialisationAutoriseeIci: mocks.reinitialisationAutoriseeIci,
  };
});

vi.mock("../services/sauvegarde.js", () => ({
  construireDump: mocks.construireDump,
  validerDump: mocks.validerDump,
  ErreurSauvegarde: class ErreurSauvegarde extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  nomFichierSauvegarde: () => "lomoto-test.dump",
  coordonneesBase: () => ({ hote: "localhost", port: 5432, base: "lomoto_test" }),
  outilSauvegardeDisponible: vi.fn().mockResolvedValue({ disponible: true, version: "pg_dump 16.0" }),
}));

vi.mock("../services/sauvegardeLocale.js", () => ({
  lireSauvegardeLocale: vi.fn(),
  repertoireLocal: () => "/tmp/lomoto-test",
  retentionLocale: () => 14,
}));

vi.mock("../services/planificateurSauvegarde.js", () => ({
  planificationActive: () => true,
  planificationSauvegarde: { EXPRESSION: "30 2 * * *", FUSEAU: "Africa/Kinshasa" },
  prochaineSauvegarde: () => null,
  TAILLE_HISTORIQUE: 20,
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    utilisateur: { count: mocks.utilisateurCount },
    sauvegardeBase: {
      findMany: mocks.sauvegardeBaseFindMany,
      findFirst: mocks.sauvegardeBaseFindFirst,
      create: mocks.sauvegardeBaseCreate,
    },
  },
}));

vi.mock("../lib/realtime.js", () => ({
  getIo: () => ({ emit: mocks.emit, disconnectSockets: mocks.disconnectSockets }),
}));

const { etatSystemeRouter } = await import("./etat-systeme.js");
const { ErreurReinitialisation } = await import("../services/reinitialisation.js");
const { ErreurSauvegarde } = await import("../services/sauvegarde.js");

function creerApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/etat-systeme", etatSystemeRouter);
  return app;
}

beforeEach(() => {
  utilisateurCourant = { id: "u-1", estAdminPrincipal: true };
  mocks.reinitialisationAutoriseeIci.mockReturnValue(true);
  mocks.construireDump.mockResolvedValue(Buffer.from("dump-factice"));
  mocks.validerDump.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/etat-systeme/reinitialiser — permissions", () => {
  it("403 si l'appelant n'est pas l'Administrateur principal", async () => {
    utilisateurCourant = { id: "u-2", estAdminPrincipal: false };
    const reponse = await request(creerApp())
      .post("/api/etat-systeme/reinitialiser")
      .send({ motConfirmation: "LOMOTO" });
    expect(reponse.status).toBe(403);
    expect(mocks.reinitialiserBase).not.toHaveBeenCalled();
  });
});

describe("POST /api/etat-systeme/reinitialiser — désactivation en production (même pour l'Admin Principal)", () => {
  it("403 avec un code explicite quand reinitialisationAutoriseeIci() est faux — refusé AVANT même de parser le corps", async () => {
    mocks.reinitialisationAutoriseeIci.mockReturnValue(false);
    const reponse = await request(creerApp()).post("/api/etat-systeme/reinitialiser").send({});
    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe("REINITIALISATION_DESACTIVEE_PRODUCTION");
    expect(reponse.body.erreur).toMatch(/désactivée par défaut en production/);
    expect(mocks.reinitialiserBase).not.toHaveBeenCalled();
  });
});

describe("POST /api/etat-systeme/reinitialiser — validation et traduction des erreurs", () => {
  it("400 si le mot de confirmation est absent/incorrect (jamais un 500 brut)", async () => {
    const reponse = await request(creerApp()).post("/api/etat-systeme/reinitialiser").send({ motConfirmation: "faux" });
    expect(reponse.status).toBe(400);
    expect(reponse.body.erreur).toBeTruthy();
    expect(mocks.reinitialiserBase).not.toHaveBeenCalled();
  });

  it("traduit une ErreurReinitialisation (ex. 409 déjà en cours) en JSON clair avec son code, jamais un code HTTP brut sans message", async () => {
    mocks.reinitialiserBase.mockRejectedValue(
      new ErreurReinitialisation(409, "Une réinitialisation est déjà en cours de préparation.", "REINITIALISATION_DEJA_EN_COURS"),
    );
    const reponse = await request(creerApp())
      .post("/api/etat-systeme/reinitialiser")
      .send({ motConfirmation: "LOMOTO" });
    expect(reponse.status).toBe(409);
    expect(reponse.body.code).toBe("REINITIALISATION_DEJA_EN_COURS");
    expect(reponse.body.erreur).toMatch(/déjà en cours/);
  });
});

describe("POST /api/etat-systeme/reinitialiser — succès", () => {
  it("appelle reinitialiserBase, déconnecte tous les sockets, et répond {ok:true, sauvegardeId}", async () => {
    mocks.reinitialiserBase.mockResolvedValue({ sauvegardeId: "sauv-42" });
    const reponse = await request(creerApp())
      .post("/api/etat-systeme/reinitialiser")
      .send({ motConfirmation: "LOMOTO", raison: "test" });
    expect(reponse.status).toBe(200);
    expect(reponse.body).toEqual({ ok: true, sauvegardeId: "sauv-42" });
    expect(mocks.reinitialiserBase).toHaveBeenCalledWith("test");
    expect(mocks.disconnectSockets).toHaveBeenCalledWith(true);
    expect(mocks.emit).toHaveBeenCalledWith("sessionInvalidee", expect.any(Object));
  });
});

describe("POST /api/etat-systeme/sauvegarde — validation obligatoire AVANT tout téléchargement (correctif Codex round 2, 30/08/2026)", () => {
  it("dump valide : validerDump est appelé, la sauvegarde est journalisée SUCCES, et le fichier part au téléchargement", async () => {
    const reponse = await request(creerApp()).post("/api/etat-systeme/sauvegarde");
    expect(reponse.status).toBe(200);
    expect(mocks.validerDump).toHaveBeenCalledTimes(1);
    expect(mocks.sauvegardeBaseCreate).toHaveBeenCalledTimes(1);
    expect(mocks.sauvegardeBaseCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statut: "SUCCES", type: "MANUELLE" }) }),
    );
    expect(reponse.body.toString()).toBe("dump-factice");
  });

  it("dump construit mais INVALIDE (validerDump rejette) : jamais téléchargé, jamais SUCCES — journalisé ECHEC avec un message clair", async () => {
    mocks.validerDump.mockRejectedValue(new ErreurSauvegarde(500, "Archive invalide ou corrompue"));
    const reponse = await request(creerApp()).post("/api/etat-systeme/sauvegarde");

    expect(reponse.status).toBe(500);
    expect(reponse.body.erreur).toMatch(/invalide ou corrompue/);
    // Le corps de la réponse est une erreur JSON, jamais l'octet du dump.
    expect(reponse.headers["content-type"]).toMatch(/json/);

    expect(mocks.sauvegardeBaseCreate).toHaveBeenCalledTimes(1);
    expect(mocks.sauvegardeBaseCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statut: "ECHEC", type: "MANUELLE", erreur: expect.stringContaining("invalide") }),
      }),
    );
    // Jamais journalisé SUCCES pour ce même appel.
    expect(mocks.sauvegardeBaseCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statut: "SUCCES" }) }),
    );
  });

  it("403 si l'appelant n'est pas l'Administrateur principal — validerDump n'est même pas atteint", async () => {
    utilisateurCourant = { id: "u-2", estAdminPrincipal: false };
    const reponse = await request(creerApp()).post("/api/etat-systeme/sauvegarde");
    expect(reponse.status).toBe(403);
    expect(mocks.construireDump).not.toHaveBeenCalled();
    expect(mocks.validerDump).not.toHaveBeenCalled();
  });
});

describe("GET /api/etat-systeme/ — DTO honnête sur la disponibilité de la réinitialisation", () => {
  it("reinitialisation.autorisee=true et motifIndisponibilite=null quand l'action est permise", async () => {
    mocks.reinitialisationAutoriseeIci.mockReturnValue(true);
    const reponse = await request(creerApp()).get("/api/etat-systeme/");
    expect(reponse.status).toBe(200);
    expect(reponse.body.etat.reinitialisation).toEqual({ autorisee: true, motifIndisponibilite: null });
  });

  it("reinitialisation.autorisee=false et un motif explicite quand l'action est désactivée — jamais un simple booléen sans explication", async () => {
    mocks.reinitialisationAutoriseeIci.mockReturnValue(false);
    const reponse = await request(creerApp()).get("/api/etat-systeme/");
    expect(reponse.status).toBe(200);
    expect(reponse.body.etat.reinitialisation.autorisee).toBe(false);
    expect(reponse.body.etat.reinitialisation.motifIndisponibilite).toMatch(/désactivée par défaut en production/);
  });
});
