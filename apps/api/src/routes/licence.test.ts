/**
 * Preuves HTTP mockées de routes/licence.ts : POST /activer public (pas de
 * requireAuth), traduction d'ErreurServiceLicences en 503, GET /etat et
 * POST /rafraichir authentifiées et branchées sur calculerEtatLicencePourFrontend.
 * Mêmes idiomes que routes/premierLancement.test.ts / routes/etat-systeme.test.ts.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErreurServiceLicences } from "../services/licenceCentrale.js";

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = { id: "u-1" } as express.Request["utilisateur"];
    next();
  },
}));

const mocks = vi.hoisted(() => ({
  activerLicence: vi.fn(),
  rafraichirEtatLicence: vi.fn(),
  calculerEtatLicencePourFrontend: vi.fn(),
  etatLicenceFindUnique: vi.fn(),
}));

vi.mock("../services/licenceLocale.js", () => ({
  activerLicence: mocks.activerLicence,
  rafraichirEtatLicence: mocks.rafraichirEtatLicence,
  calculerEtatLicencePourFrontend: mocks.calculerEtatLicencePourFrontend,
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: { etatLicence: { findUnique: mocks.etatLicenceFindUnique } },
}));

import { licenceRouter } from "./licence.js";

function appLicence() {
  const app = express();
  app.use(express.json());
  app.use("/api/licence", licenceRouter);
  return app;
}

describe("POST /api/licence/activer — publique, sans authentification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("400 si cleLicence est absente, sans appeler le service", async () => {
    const res = await request(appLicence()).post("/api/licence/activer").send({});
    expect(res.status).toBe(400);
    expect(mocks.activerLicence).not.toHaveBeenCalled();
  });

  it("200 : renvoie la réponse du service telle quelle (y compris erreurActivation)", async () => {
    mocks.activerLicence.mockResolvedValue({
      statut: "ESSAI",
      joursRestants: 30,
      erreurActivation: "Clé de licence introuvable.",
    });
    const res = await request(appLicence()).post("/api/licence/activer").send({ cleLicence: "CLE-X" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ statut: "ESSAI", joursRestants: 30, erreurActivation: "Clé de licence introuvable." });
    expect(mocks.activerLicence).toHaveBeenCalledWith("CLE-X");
  });

  it("503 si le service central est injoignable (ErreurServiceLicences)", async () => {
    mocks.activerLicence.mockRejectedValue(new ErreurServiceLicences("injoignable"));
    const res = await request(appLicence()).post("/api/licence/activer").send({ cleLicence: "CLE-X" });
    expect(res.status).toBe(503);
  });

  it("ne passe PAS par requireAuth : aucun en-tête Authorization nécessaire", async () => {
    mocks.activerLicence.mockResolvedValue({ statut: "ACTIVE", nomClient: "Boulangerie Test" });
    const res = await request(appLicence()).post("/api/licence/activer").send({ cleLicence: "CLE-OK" });
    expect(res.status).toBe(200);
    expect(res.body.nomClient).toBe("Boulangerie Test");
  });
});

describe("GET /api/licence/etat — authentifiée", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renvoie le résultat de calculerEtatLicencePourFrontend appliqué à la ligne EtatLicence courante", async () => {
    const ligne = { id: 1, dernierStatutConnu: "ACTIVE", joursRestants: null, dernierContactReussi: new Date() };
    mocks.etatLicenceFindUnique.mockResolvedValue(ligne);
    mocks.calculerEtatLicencePourFrontend.mockReturnValue({ bloque: false, avertissement: false });

    const res = await request(appLicence()).get("/api/licence/etat");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bloque: false, avertissement: false });
    expect(mocks.calculerEtatLicencePourFrontend).toHaveBeenCalledWith(ligne);
  });

  it("aucune ligne en cache -> calculerEtatLicencePourFrontend(null) -> bloque", async () => {
    mocks.etatLicenceFindUnique.mockResolvedValue(null);
    mocks.calculerEtatLicencePourFrontend.mockReturnValue({ bloque: true });

    const res = await request(appLicence()).get("/api/licence/etat");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bloque: true });
    expect(mocks.calculerEtatLicencePourFrontend).toHaveBeenCalledWith(null);
  });
});

describe("GET /api/licence/etat — LIEN_ACHAT_LICENCE (lien de l'écran de blocage)", () => {
  const original = process.env.LIEN_ACHAT_LICENCE;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.etatLicenceFindUnique.mockResolvedValue(null);
    mocks.calculerEtatLicencePourFrontend.mockReturnValue({ bloque: true });
  });

  afterEach(() => {
    if (original === undefined) delete process.env.LIEN_ACHAT_LICENCE;
    else process.env.LIEN_ACHAT_LICENCE = original;
  });

  it("variable définie : lienAchat ajouté au DTO renvoyé", async () => {
    process.env.LIEN_ACHAT_LICENCE = "https://exemple.com/acheter";

    const res = await request(appLicence()).get("/api/licence/etat");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bloque: true, lienAchat: "https://exemple.com/acheter" });
  });

  it("variable absente : lienAchat absent du DTO (pas de champ vide/null)", async () => {
    delete process.env.LIEN_ACHAT_LICENCE;

    const res = await request(appLicence()).get("/api/licence/etat");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bloque: true });
    expect(res.body.lienAchat).toBeUndefined();
  });

  it("variable définie mais vide (espaces) : traitée comme absente", async () => {
    process.env.LIEN_ACHAT_LICENCE = "   ";

    const res = await request(appLicence()).get("/api/licence/etat");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ bloque: true });
  });
});

describe("POST /api/licence/rafraichir — authentifiée", () => {
  beforeEach(() => vi.clearAllMocks());

  it("force un rafraîchissement puis renvoie l'état à jour", async () => {
    mocks.rafraichirEtatLicence.mockResolvedValue(undefined);
    const ligne = { id: 1, dernierStatutConnu: "ESSAI", joursRestants: 12, dernierContactReussi: new Date() };
    mocks.etatLicenceFindUnique.mockResolvedValue(ligne);
    mocks.calculerEtatLicencePourFrontend.mockReturnValue({ bloque: false, avertissement: false, joursRestants: 12 });

    const res = await request(appLicence()).post("/api/licence/rafraichir");

    expect(res.status).toBe(200);
    expect(mocks.rafraichirEtatLicence).toHaveBeenCalledOnce();
    expect(res.body).toEqual({ bloque: false, avertissement: false, joursRestants: 12 });
  });
});
