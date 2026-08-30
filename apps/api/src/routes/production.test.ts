/**
 * Preuves HTTP mockées du Lot Production (P1, 30/08/2026).
 *
 * Ces tests exercent le vrai routeur Express et prouvent le contrat HTTP,
 * l'ordre verrou → écriture → audit et l'absence d'événement après un rejet.
 * Ils ne prétendent pas prouver un ROLLBACK PostgreSQL : cette garantie est
 * couverte séparément par scripts/verifier-production-ci.ts.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    production: {
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    productionPerte: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    controleQualite: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(),
    motifDon: { count: vi.fn() },
    matierePremiere: { findMany: vi.fn() },
    motifPerte: { count: vi.fn() },
    motifNonConformite: { findUnique: vi.fn() },
  };
  return {
    tx,
    prisma,
    auditerCaisseTx: vi.fn(),
    appliquerMouvement: vi.fn(),
    emettreAlerteSeuil: vi.fn(),
    emettreEvenement: vi.fn(),
  };
});

vi.mock("../lib/prisma.js", () => ({ prisma: mocks.prisma }));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = {
      id: "u-production",
      nom: "Responsable Production",
      estAdminPrincipal: false,
      role: { permissions: [] },
    } as express.Request["utilisateur"];
    next();
  },
  requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("../services/caisseAtomique.js", async () => {
  const actual = await vi.importActual<typeof import("../services/caisseAtomique.js")>("../services/caisseAtomique.js");
  return { ...actual, auditerCaisseTx: mocks.auditerCaisseTx };
});

vi.mock("../services/stocks.js", async () => {
  const actual = await vi.importActual<typeof import("../services/stocks.js")>("../services/stocks.js");
  return {
    ...actual,
    appliquerMouvement: mocks.appliquerMouvement,
    emettreAlerteSeuil: mocks.emettreAlerteSeuil,
  };
});

vi.mock("../lib/events.js", () => ({
  busEvenements: { emettreEvenement: mocks.emettreEvenement },
}));

import { ErreurStock } from "../services/stocks.js";
import { productionRouter } from "./production.js";

const decimal = (n: number) => ({ toNumber: () => n });

function perte(id = "perte-1", nombreBacs = 2) {
  return {
    id,
    productionId: "prod-1",
    motifPerteId: "motif-perte-1",
    nombreBacs,
    motifPerte: { id: "motif-perte-1", nom: "Brûlé" },
  };
}

function controle(verdict: "CONFORME" | "NON_CONFORME" = "CONFORME") {
  return {
    id: "controle-1",
    productionId: "prod-1",
    verdict,
    motifId: verdict === "NON_CONFORME" ? "motif-nc-1" : null,
    observations: null,
    controleParId: "u-production",
    createdAt: new Date("2026-08-30T10:00:00.000Z"),
    updatedAt: new Date("2026-08-30T10:00:00.000Z"),
    motif: verdict === "NON_CONFORME" ? { id: "motif-nc-1", nom: "Cuisson" } : null,
    controlePar: { id: "u-production", nom: "Responsable Production" },
  };
}

function production(options: {
  statut?: "OUVERTE" | "CLOTUREE";
  bacsFoutus?: number;
  pertes?: ReturnType<typeof perte>[];
  controleQualite?: ReturnType<typeof controle> | null;
  mouvements?: unknown[];
} = {}) {
  return {
    id: "prod-1",
    numero: 42,
    date: new Date("2026-08-30T09:00:00.000Z"),
    bacsProduits: 10,
    bacsLivresDepositaires: 8,
    bacsLivresMamans: 0,
    bacsVendusVC: 0,
    bacsRestants: 0,
    bacsFoutus: options.bacsFoutus ?? 2,
    kgFarineAbimes: null,
    sacsUtilises: decimal(2),
    paquetsLevureUtilises: decimal(0),
    kgSelUtilises: decimal(0),
    quantiteHuileUtilisee: decimal(0),
    observations: null,
    enregistreParId: "u-production",
    statut: options.statut ?? "OUVERTE",
    clotureeLe: options.statut === "CLOTUREE" ? new Date("2026-08-30T11:00:00.000Z") : null,
    clotureeParId: options.statut === "CLOTUREE" ? "u-production" : null,
    dons: [],
    pertes: options.pertes ?? [],
    controleQualite: options.controleQualite ?? null,
    enregistrePar: { id: "u-production", nom: "Responsable Production" },
    clotureePar: options.statut === "CLOTUREE" ? { id: "u-production", nom: "Responsable Production" } : null,
    mouvements: options.mouvements ?? [],
  };
}

function app() {
  const application = express();
  application.use(express.json());
  application.use("/api/production", productionRouter);
  application.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ erreur: "Erreur interne" });
  });
  return application;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (operation: (tx: typeof mocks.tx) => Promise<unknown>) => operation(mocks.tx),
  );
  mocks.tx.$queryRaw.mockResolvedValue([{ id: "prod-1" }]);
  mocks.prisma.motifDon.count.mockResolvedValue(0);
  mocks.prisma.matierePremiere.findMany.mockResolvedValue([]);
  mocks.prisma.motifPerte.count.mockResolvedValue(1);
  mocks.prisma.motifNonConformite.findUnique.mockResolvedValue({ id: "motif-nc-1" });
  mocks.tx.productionPerte.deleteMany.mockResolvedValue({ count: 0 });
  mocks.tx.productionPerte.createMany.mockResolvedValue({ count: 1 });
  mocks.tx.controleQualite.create.mockResolvedValue({ id: "controle-1" });
  mocks.tx.controleQualite.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.production.updateMany.mockResolvedValue({ count: 1 });
  mocks.auditerCaisseTx.mockResolvedValue(undefined);
});

describe("POST /api/production/productions — stock transactionnel", () => {
  it("crée la Production et applique chaque consommation dans la même transaction", async () => {
    const matiere = { id: "farine-1", code: "FARINE", nom: "Farine", unite: "SAC" };
    const complete = production({
      bacsFoutus: 0,
      mouvements: [{ quantite: decimal(2), matierePremiere: { nom: "Farine", unite: "SAC" } }],
    });
    mocks.prisma.matierePremiere.findMany.mockResolvedValue([matiere]);
    mocks.tx.production.create.mockResolvedValue({ id: "prod-1", numero: 42 });
    mocks.appliquerMouvement.mockResolvedValue({ matiere: { ...matiere, stockActuel: 8 }, franchitSeuil: true });
    mocks.tx.production.findUniqueOrThrow.mockResolvedValue(complete);

    const res = await request(app()).post("/api/production/productions").send({
      bacsProduits: 10,
      bacsLivresDepositaires: 10,
      sacsUtilises: 2,
    });

    expect(res.status).toBe(201);
    expect(mocks.appliquerMouvement).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        matierePremiereId: "farine-1",
        type: "SORTIE",
        quantite: 2,
        productionId: "prod-1",
      }),
    );
    expect(mocks.emettreAlerteSeuil).toHaveBeenCalledOnce();
    expect(mocks.emettreEvenement).toHaveBeenCalledWith(expect.objectContaining({ type: "PRODUCTION_ENREGISTREE" }));
  });

  it("traduit un stock insuffisant et n'émet aucun événement", async () => {
    mocks.prisma.matierePremiere.findMany.mockResolvedValue([
      { id: "farine-1", code: "FARINE", nom: "Farine", unite: "SAC" },
    ]);
    mocks.tx.production.create.mockResolvedValue({ id: "prod-1", numero: 42 });
    mocks.appliquerMouvement.mockRejectedValue(new ErreurStock(409, "Stock insuffisant"));

    const res = await request(app()).post("/api/production/productions").send({
      bacsProduits: 10,
      sacsUtilises: 99,
    });

    expect(res.status).toBe(409);
    expect(res.body.erreur).toBe("Stock insuffisant");
    expect(mocks.emettreEvenement).not.toHaveBeenCalled();
    expect(mocks.emettreAlerteSeuil).not.toHaveBeenCalled();
  });

  it("signale une matière non configurée sans inventer de mouvement", async () => {
    mocks.tx.production.create.mockResolvedValue({ id: "prod-1", numero: 42 });
    mocks.tx.production.findUniqueOrThrow.mockResolvedValue(production({ bacsFoutus: 0 }));

    const res = await request(app()).post("/api/production/productions").send({
      bacsProduits: 10,
      bacsLivresDepositaires: 10,
      sacsUtilises: 2,
    });

    expect(res.status).toBe(201);
    expect(mocks.appliquerMouvement).not.toHaveBeenCalled();
    expect(res.body.avertissements[0]).toContain("FARINE");
  });
});

describe("PUT /api/production/productions/:id/pertes — verrou et audit", () => {
  it("retourne 404 avant toute écriture si la Production n'existe pas", async () => {
    mocks.tx.$queryRaw.mockResolvedValue([]);

    const res = await request(app())
      .put("/api/production/productions/absente/pertes")
      .send({ pertes: [] });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PRODUCTION_INTROUVABLE");
    expect(mocks.tx.productionPerte.deleteMany).not.toHaveBeenCalled();
  });

  it("retourne 409 si la Production est déjà clôturée", async () => {
    mocks.tx.production.findUniqueOrThrow.mockResolvedValue(production({ statut: "CLOTUREE" }));

    const res = await request(app())
      .put("/api/production/productions/prod-1/pertes")
      .send({ pertes: [] });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PRODUCTION_CLOTUREE");
    expect(mocks.tx.productionPerte.deleteMany).not.toHaveBeenCalled();
  });

  it("remplace les pertes puis audite exactement chaque suppression dans la transaction", async () => {
    const avant = production({ pertes: [perte("perte-ancienne", 2)] });
    const apres = production({ pertes: [perte("perte-nouvelle", 2)] });
    mocks.tx.production.findUniqueOrThrow.mockResolvedValueOnce(avant).mockResolvedValueOnce(apres);

    const res = await request(app())
      .put("/api/production/productions/prod-1/pertes")
      .send({ pertes: [{ motifPerteId: "motif-perte-1", nombreBacs: 2 }] });

    expect(res.status).toBe(200);
    expect(mocks.tx.productionPerte.deleteMany).toHaveBeenCalledBefore(mocks.auditerCaisseTx);
    expect(mocks.tx.productionPerte.createMany).toHaveBeenCalledBefore(mocks.auditerCaisseTx);
    expect(mocks.auditerCaisseTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        module: "PRODUCTION",
        typeEntite: "ProductionPerte",
        entiteId: "perte-ancienne",
        action: "SUPPRESSION",
      }),
    );
  });

  it("propage l'échec d'audit après les écritures mockées et ne renvoie aucun succès", async () => {
    mocks.tx.production.findUniqueOrThrow.mockResolvedValue(production({ pertes: [perte()] }));
    mocks.auditerCaisseTx.mockRejectedValue(new Error("audit indisponible"));

    const res = await request(app())
      .put("/api/production/productions/prod-1/pertes")
      .send({ pertes: [{ motifPerteId: "motif-perte-1", nombreBacs: 2 }] });

    expect(res.status).toBe(500);
    expect(mocks.tx.productionPerte.createMany).toHaveBeenCalled();
    expect(mocks.auditerCaisseTx).toHaveBeenCalled();
  });
});

describe("PUT /api/production/productions/:id/controle-qualite", () => {
  it("refuse un verdict non conforme sans motif avant toute transaction", async () => {
    const res = await request(app())
      .put("/api/production/productions/prod-1/controle-qualite")
      .send({ verdict: "NON_CONFORME" });

    expect(res.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("crée le premier contrôle sous verrou sans audit de création", async () => {
    const avant = production();
    const apres = production({ controleQualite: controle() });
    mocks.tx.production.findUniqueOrThrow.mockResolvedValueOnce(avant).mockResolvedValueOnce(apres);

    const res = await request(app())
      .put("/api/production/productions/prod-1/controle-qualite")
      .send({ verdict: "CONFORME" });

    expect(res.status).toBe(200);
    expect(mocks.tx.controleQualite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ productionId: "prod-1", verdict: "CONFORME", controleParId: "u-production" }),
    });
    expect(mocks.auditerCaisseTx).not.toHaveBeenCalled();
  });

  it("corrige via updateMany, relit puis audite exactement dans la transaction", async () => {
    const existant = controle("NON_CONFORME");
    const modifie = { ...existant, verdict: "CONFORME", motifId: null, updatedAt: new Date("2026-08-30T12:00:00.000Z") };
    mocks.tx.production.findUniqueOrThrow
      .mockResolvedValueOnce(production({ controleQualite: existant }))
      .mockResolvedValueOnce(production({ controleQualite: { ...controle(), ...modifie } }));
    mocks.tx.controleQualite.findUniqueOrThrow.mockResolvedValue(modifie);

    const res = await request(app())
      .put("/api/production/productions/prod-1/controle-qualite")
      .send({ verdict: "CONFORME", observations: "Corrigé" });

    expect(res.status).toBe(200);
    expect(mocks.tx.controleQualite.updateMany).toHaveBeenCalledBefore(mocks.auditerCaisseTx);
    expect(mocks.auditerCaisseTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        module: "PRODUCTION",
        typeEntite: "ControleQualite",
        entiteId: "controle-1",
        action: "MODIFICATION",
      }),
    );
  });

  it("bloque toute correction après clôture", async () => {
    mocks.tx.production.findUniqueOrThrow.mockResolvedValue(
      production({ statut: "CLOTUREE", controleQualite: controle() }),
    );

    const res = await request(app())
      .put("/api/production/productions/prod-1/controle-qualite")
      .send({ verdict: "CONFORME" });

    expect(res.status).toBe(409);
    expect(mocks.tx.controleQualite.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.controleQualite.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/production/productions/:id/cloturer", () => {
  it("exige le contrôle qualité sous verrou et conserve le contrat 400", async () => {
    mocks.tx.production.findUniqueOrThrow.mockResolvedValue(production({ pertes: [perte()] }));

    const res = await request(app()).post("/api/production/productions/prod-1/cloturer");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CONTROLE_QUALITE_MANQUANT");
    expect(mocks.tx.production.updateMany).not.toHaveBeenCalled();
  });

  it("exige l'égalité stricte entre bacs foutus et pertes motivées", async () => {
    mocks.tx.production.findUniqueOrThrow.mockResolvedValue(
      production({ bacsFoutus: 2, pertes: [perte("perte-1", 1)], controleQualite: controle() }),
    );

    const res = await request(app()).post("/api/production/productions/prod-1/cloturer");

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PERTES_NON_JUSTIFIEES");
    expect(mocks.tx.production.updateMany).not.toHaveBeenCalled();
  });

  it("clôture via updateMany, audite avant commit puis émet l'événement après succès", async () => {
    const ouverte = production({ pertes: [perte()], controleQualite: controle() });
    const fermee = production({ statut: "CLOTUREE", pertes: [perte()], controleQualite: controle() });
    mocks.tx.production.findUniqueOrThrow.mockResolvedValueOnce(ouverte).mockResolvedValueOnce(fermee);

    const res = await request(app()).post("/api/production/productions/prod-1/cloturer");

    expect(res.status).toBe(200);
    expect(mocks.tx.production.updateMany).toHaveBeenCalledWith({
      where: { id: "prod-1", statut: "OUVERTE" },
      data: expect.objectContaining({ statut: "CLOTUREE", clotureeParId: "u-production" }),
    });
    expect(mocks.tx.production.updateMany).toHaveBeenCalledBefore(mocks.auditerCaisseTx);
    expect(mocks.auditerCaisseTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ module: "PRODUCTION", typeEntite: "Production", action: "MODIFICATION" }),
    );
    expect(mocks.emettreEvenement).toHaveBeenCalledWith(expect.objectContaining({ type: "PRODUCTION_CLOTUREE" }));
  });

  it("un échec d'audit après l'update ne publie jamais l'événement", async () => {
    const ouverte = production({ pertes: [perte()], controleQualite: controle() });
    const fermee = production({ statut: "CLOTUREE", pertes: [perte()], controleQualite: controle() });
    mocks.tx.production.findUniqueOrThrow.mockResolvedValueOnce(ouverte).mockResolvedValueOnce(fermee);
    mocks.auditerCaisseTx.mockRejectedValue(new Error("audit indisponible"));

    const res = await request(app()).post("/api/production/productions/prod-1/cloturer");

    expect(res.status).toBe(500);
    expect(mocks.tx.production.updateMany).toHaveBeenCalled();
    expect(mocks.emettreEvenement).not.toHaveBeenCalled();
  });
});
