import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    travailleur: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    utilisateur: { findUnique: vi.fn() },
    departement: { findUnique: vi.fn() },
    groupe: { findUnique: vi.fn() },
    pointage: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    absence: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    sanction: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    bulletinPaie: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return {
    tx,
    auditer: vi.fn(),
    event: vi.fn(),
    rootTravailleurFindUnique: vi.fn(),
    rootPointageFindUnique: vi.fn(),
    rootAbsenceFindUnique: vi.fn(),
    rootSanctionFindUnique: vi.fn(),
    rootUtilisateurFindMany: vi.fn(),
  };
});

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    travailleur: { findUnique: mocks.rootTravailleurFindUnique },
    pointage: { findUnique: mocks.rootPointageFindUnique },
    absence: { findUnique: mocks.rootAbsenceFindUnique },
    sanction: { findUnique: mocks.rootSanctionFindUnique },
    utilisateur: { findMany: mocks.rootUtilisateurFindMany },
  },
}));

vi.mock("../services/caisseAtomique.js", () => ({
  auditerCaisseTx: mocks.auditer,
  ErreurEcritureCaisseReessayable: class ErreurEcritureCaisseReessayable extends Error {},
  estViolationContrainteUnique: () => false,
  executerAvecReessaiP2034: (operation: () => Promise<unknown>) => operation(),
  transactionSerializable: (_db: unknown, executer: (tx: unknown) => Promise<unknown>) => executer(mocks.tx),
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = {
      id: "acteur-1",
      nom: "Chargé du personnel",
      role: { permissions: [{ module: "TRAVAILLEURS", niveauAcces: "ECRITURE" }] },
    } as express.Request["utilisateur"];
    next();
  },
  requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("../services/emailPro.js", () => ({ declencherEmailPro: vi.fn(), verifierEmailPro: vi.fn() }));
vi.mock("../services/pdf.js", () => ({ construirePdf: vi.fn(), nomFichierPdf: vi.fn() }));
vi.mock("../lib/events.js", () => ({ busEvenements: { emettreEvenement: mocks.event } }));

import { travailleursRouter } from "./travailleurs.js";

const FICHE = {
  id: "t-1",
  nom: "Jean Mukendi",
  telephone: null,
  poste: "Boulanger",
  dateEmbauche: new Date("2025-01-01T00:00:00.000Z"),
  utilisateurId: null,
  departementId: "dep-1",
  groupeId: null,
  emailDestination: null,
  emailProAdresse: null,
  emailProStatut: "AUCUNE",
  emailProErreur: null,
  salaireMensuel: 260_000,
  joursTravaillesParMois: 26,
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  updatedAt: new Date("2025-01-01T00:00:00.000Z"),
};

function appTravailleurs() {
  const app = express();
  app.use(express.json());
  app.use("/api/travailleurs", travailleursRouter);
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ erreur: "test" }));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.$queryRaw.mockResolvedValue([{ id: "verrou" }]);
  mocks.auditer.mockResolvedValue(undefined);
  mocks.rootUtilisateurFindMany.mockResolvedValue([]);
});

describe("Lot 5 — atomicité Travailleurs, présence et paie", () => {
  it("refuse un pointage chevauchant sous le verrou du Travailleur", async () => {
    mocks.tx.pointage.findFirst.mockResolvedValue({ id: "p-existant" });
    const res = await request(appTravailleurs()).post("/api/travailleurs/pointages").send({
      travailleurId: "t-1",
      horodatageEntree: "2026-09-01T06:00:00.000Z",
      horodatageSortie: "2026-09-01T14:00:00.000Z",
    });
    expect(res.status).toBe(409);
    expect(mocks.tx.pointage.create).not.toHaveBeenCalled();
    expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("refuse une deuxième absence du même travailleur le même jour", async () => {
    mocks.tx.absence.findFirst.mockResolvedValue({ id: "a-existante" });
    const res = await request(appTravailleurs()).post("/api/travailleurs/absences").send({
      travailleurId: "t-1",
      date: "2026-09-01",
      motif: "Maladie",
    });
    expect(res.status).toBe(409);
    expect(mocks.tx.absence.create).not.toHaveBeenCalled();
  });

  it("tranche une absence une seule fois, audite avant l'événement et refuse le rejeu", async () => {
    mocks.rootAbsenceFindUnique.mockResolvedValue({ travailleurId: "t-1" });
    const avant = { id: "a-1", travailleurId: "t-1", decisionStatut: "EN_ATTENTE" };
    const apres = {
      ...avant,
      decisionStatut: "NON_JUSTIFIEE",
      date: new Date("2026-09-01T00:00:00.000Z"),
      motif: "Absence",
      travailleur: { id: "t-1", nom: "Jean Mukendi", poste: "Boulanger" },
      declarePar: null,
      decidePar: { id: "acteur-1", nom: "Chargé du personnel" },
      dateDecision: new Date("2026-09-01T08:00:00.000Z"),
      alerteEnvoyeeLe: null,
    };
    mocks.tx.absence.findUniqueOrThrow.mockResolvedValueOnce(avant).mockResolvedValueOnce(apres);
    mocks.tx.absence.updateMany.mockResolvedValue({ count: 1 });
    mocks.rootTravailleurFindUnique.mockResolvedValue({ utilisateurId: null });

    const res = await request(appTravailleurs())
      .put("/api/travailleurs/absences/a-1/decision")
      .send({ decisionStatut: "NON_JUSTIFIEE" });
    expect(res.status).toBe(200);
    expect(mocks.tx.absence.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a-1", decisionStatut: "EN_ATTENTE" } }));
    expect(mocks.tx.absence.updateMany).toHaveBeenCalledBefore(mocks.auditer);

    mocks.tx.absence.findUniqueOrThrow.mockReset().mockResolvedValue({ ...avant, decisionStatut: "JUSTIFIEE" });
    const rejeu = await request(appTravailleurs())
      .put("/api/travailleurs/absences/a-1/decision")
      .send({ decisionStatut: "NON_JUSTIFIEE" });
    expect(rejeu.status).toBe(409);
  });

  it("interdit la suppression d'une fiche portant un bulletin officiel", async () => {
    mocks.tx.travailleur.findUniqueOrThrow.mockResolvedValue({
      ...FICHE,
      _count: { bulletinsPaie: 1, pointages: 2, absences: 1, sanctions: 1 },
    });
    const res = await request(appTravailleurs()).delete("/api/travailleurs/t-1");
    expect(res.status).toBe(409);
    expect(mocks.tx.travailleur.deleteMany).not.toHaveBeenCalled();
    expect(mocks.auditer).not.toHaveBeenCalled();
  });

  it("enregistre l'auteur authentifié lors de la création d'une fiche", async () => {
    mocks.tx.departement.findUnique.mockResolvedValue({ id: "dep-1" });
    mocks.tx.travailleur.create.mockImplementation(async ({ data }) => ({
      ...FICHE,
      ...data,
      utilisateur: null,
      departement: { id: "dep-1", nom: "Production" },
      groupe: null,
    }));
    const res = await request(appTravailleurs()).post("/api/travailleurs").send({
      nom: "Jean Mukendi",
      poste: "Boulanger",
      dateEmbauche: "2025-01-01",
      departementId: "dep-1",
      salaireMensuel: 260000,
      joursTravaillesParMois: 26,
    });
    expect(res.status).toBe(201);
    expect(mocks.tx.travailleur.create.mock.calls[0][0].data.creeParId).toBe("acteur-1");
  });

  it("fige salaire, absences et sanctions dans une seule transaction", async () => {
    mocks.tx.travailleur.findUniqueOrThrow.mockResolvedValue(FICHE);
    mocks.tx.absence.findMany.mockResolvedValue([{ id: "a-1", date: new Date("2026-09-03T00:00:00.000Z"), motif: "Absence" }]);
    mocks.tx.sanction.findMany.mockResolvedValue([{ id: "s-1", date: new Date("2026-09-04T00:00:00.000Z"), motif: "Retard", montant: 10_000 }]);
    mocks.tx.bulletinPaie.create.mockImplementation(async ({ data }) => ({
      id: "b-1",
      ...data,
      travailleur: { id: "t-1", nom: "Jean Mukendi", poste: "Boulanger" },
      generePar: { id: "acteur-1", nom: "Chargé du personnel" },
      dateGeneration: new Date("2026-09-30T00:00:00.000Z"),
    }));

    const res = await request(appTravailleurs()).post("/api/travailleurs/t-1/bulletins-paie?mois=2026-09");
    expect(res.status).toBe(201);
    const data = mocks.tx.bulletinPaie.create.mock.calls[0][0].data;
    expect(data.salaireMensuel).toBe(260_000);
    expect(data.retenueAbsences).toBe(10_000);
    expect(data.totalRetenuesDisciplinaires).toBe(10_000);
    expect(data.salaireNet).toBe(240_000);
    expect(data.genereParId).toBe("acteur-1");
  });
});
