/**
 * Preuves HTTP mockées (P1-B, 28/08/2026) : le contrat HTTP des routes
 * réécrites de caisse.ts — 409 métier explicite quand une écriture financière
 * est tentée sans session OUVERTE ou après clôture, 400 ECART_NON_MOTIVE,
 * 403 réservé à l'Admin Principal pour la correction, 409 sur version
 * optimiste obsolète (taux, correction), 409 sur violation d'unicité
 * (farine, première définition du taux), 503 après épuisement des réessais
 * P2034 — jamais un 500 brut. La preuve AUTORITAIRE de l'atomicité réelle
 * (verrou de ligne PostgreSQL, résistance à la vraie concurrence) est
 * apportée séparément par scripts/verifier-concurrence-caisse-ci.ts.
 *
 * Convention : mock au niveau du SERVICE (caisseAtomique.js), pas de Prisma —
 * même idiome que routes/premierLancement.test.ts. Chaque route est ainsi
 * testée pour ce qu'elle FAIT de ce que le service lui rend/lève, sans
 * réimplémenter la sémantique transactionnelle de Prisma.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErreurAction } from "../lib/erreurAction.js";

let utilisateurCourant = { id: "u-1", nom: "Alice", estAdminPrincipal: false };

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = utilisateurCourant as express.Request["utilisateur"];
    next();
  },
  requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

const mocks = vi.hoisted(() => ({
  verrouillerSessionOuverte: vi.fn(),
  verrouillerSessionOuverteParId: vi.fn(),
  verrouillerSessionFermeeParId: vi.fn(),
  verifierAucuneSessionAnterieureOuverte: vi.fn(),
  auditerCaisseTx: vi.fn(),
  sessionCaisseFindUnique: vi.fn(),
  sessionCaisseFindFirst: vi.fn(),
  depenseCaisseFindUnique: vi.fn(),
  paiementCommandeFindMany: vi.fn(),
  commandeClientFindMany: vi.fn(),
  tauxDuJourFindUnique: vi.fn(),
  productionAggregate: vi.fn(),
  remiseCaisseFindMany: vi.fn(),
}));

function txFactice(overrides: Record<string, unknown> = {}) {
  return {
    sessionCaisse: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...SESSION_OUVERTE, statut: "FERMEE" as const }),
    },
    tauxDuJour: {
      findUnique: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
    },
    depenseCaisse: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    remiseCaisse: { create: vi.fn() },
    paiementCommande: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
    commandeClient: { findMany: vi.fn().mockResolvedValue([]), findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
    client: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
    production: { aggregate: vi.fn().mockResolvedValue({ _sum: { sacsUtilises: null } }) },
    auditLog: { create: vi.fn() },
    ...overrides,
  };
}

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    sessionCaisse: { findUnique: mocks.sessionCaisseFindUnique, findFirst: mocks.sessionCaisseFindFirst },
    depenseCaisse: { findUnique: mocks.depenseCaisseFindUnique },
    paiementCommande: { findMany: mocks.paiementCommandeFindMany },
    commandeClient: { findMany: mocks.commandeClientFindMany },
    tauxDuJour: { findUnique: mocks.tauxDuJourFindUnique },
    production: { aggregate: mocks.productionAggregate },
    remiseCaisse: { findMany: mocks.remiseCaisseFindMany },
  },
}));

vi.mock("../lib/idempotence.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/idempotence.js")>("../lib/idempotence.js");
  return {
    ...actual,
    executerEcritureIdempotente: vi.fn(async (_req, _portee, _donnees, executer, versReponse) => {
      const valeur = await executer(txFactice());
      const reponse = versReponse(valeur);
      return { ...reponse, valeur, rejoue: false };
    }),
    ajouterEnteteRejeu: vi.fn(),
  };
});

vi.mock("../services/caisseAtomique.js", async () => {
  const actual = await vi.importActual<typeof import("../services/caisseAtomique.js")>("../services/caisseAtomique.js");
  return {
    ...actual,
    verrouillerSessionOuverte: mocks.verrouillerSessionOuverte,
    verrouillerSessionOuverteParId: mocks.verrouillerSessionOuverteParId,
    verrouillerSessionFermeeParId: mocks.verrouillerSessionFermeeParId,
    verifierAucuneSessionAnterieureOuverte: mocks.verifierAucuneSessionAnterieureOuverte,
    auditerCaisseTx: mocks.auditerCaisseTx,
    executerAvecReessaiP2034: vi.fn((operation: () => Promise<unknown>) => operation()),
    transactionSerializable: vi.fn((_db: unknown, executer: (tx: unknown) => Promise<unknown>) => executer(txFactice())),
  };
});

import { caisseRouter } from "./caisse.js";

function app() {
  const application = express();
  application.use(express.json());
  application.use("/api/caisse", caisseRouter);
  return application;
}

const SESSION_OUVERTE = {
  id: "s-1",
  date: new Date("2026-08-28T00:00:00.000Z"),
  statut: "OUVERTE" as const,
  soldeOuverture: 5000,
  soldeTheoriqueFermeture: null,
  soldeCompteFermeture: null,
  ecartFermeture: null,
  motifEcart: null,
  ouverteParId: "u-1",
  ouvertePar: null,
  fermeeParId: null,
  fermeePar: null,
  ouverteLe: new Date(),
  fermeeLe: null,
  derniereCorrectionLe: null,
  derniereCorrectionParId: null,
  derniereCorrectionPar: null,
  motifCorrection: null,
  createdAt: new Date(),
  updatedAt: new Date("2026-08-28T08:00:00.000Z"),
};

beforeEach(async () => {
  vi.clearAllMocks();
  utilisateurCourant = { id: "u-1", nom: "Alice", estAdminPrincipal: false };
  mocks.verifierAucuneSessionAnterieureOuverte.mockResolvedValue(undefined);
  mocks.auditerCaisseTx.mockResolvedValue(undefined);
  // `mockRejectedValue`/`mockImplementation` posés par un test précédent
  // survivent à `vi.clearAllMocks()` (qui n'efface que l'historique
  // d'appels) — on republie donc explicitement le comportement par défaut
  // (« passe-plat ») à chaque test.
  const { executerAvecReessaiP2034, transactionSerializable } = await import("../services/caisseAtomique.js");
  (executerAvecReessaiP2034 as ReturnType<typeof vi.fn>).mockImplementation((operation: () => Promise<unknown>) => operation());
  (transactionSerializable as ReturnType<typeof vi.fn>).mockImplementation((_db: unknown, executer: (tx: unknown) => Promise<unknown>) =>
    executer(txFactice()),
  );
});

describe("PUT /api/caisse/taux — session requise", () => {
  it("409 quand aucune session OUVERTE n'existe pour la date", async () => {
    mocks.verrouillerSessionOuverte.mockRejectedValue(new ErreurAction(409, "Aucune session de caisse n'est ouverte pour le 2026-08-28"));
    const res = await request(app()).put("/api/caisse/taux").send({ date: "2026-08-28", valeur: 2800 });
    expect(res.status).toBe(409);
    expect(res.body.erreur).toMatch(/ouverte/);
  });

  it("409 si aucune versionAttendue n'est transmise alors qu'un taux existe déjà (modification)", async () => {
    mocks.verrouillerSessionOuverte.mockResolvedValue(SESSION_OUVERTE);
    const { transactionSerializable } = await import("../services/caisseAtomique.js");
    (transactionSerializable as ReturnType<typeof vi.fn>).mockImplementation((_db: unknown, executer: (tx: unknown) => Promise<unknown>) => {
      const tx = txFactice();
      (tx.tauxDuJour.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "t-1",
        valeur: { toNumber: () => 2700 },
        updatedAt: new Date("2026-08-28T07:00:00.000Z"),
      });
      return executer(tx);
    });
    const res = await request(app()).put("/api/caisse/taux").send({ date: "2026-08-28", valeur: 2800 });
    expect(res.status).toBe(409);
  });

  it("409 quand la versionAttendue transmise ne correspond plus au taux existant (course détectée)", async () => {
    mocks.verrouillerSessionOuverte.mockResolvedValue(SESSION_OUVERTE);
    const { transactionSerializable } = await import("../services/caisseAtomique.js");
    (transactionSerializable as ReturnType<typeof vi.fn>).mockImplementation((_db: unknown, executer: (tx: unknown) => Promise<unknown>) => {
      const tx = txFactice();
      (tx.tauxDuJour.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
        id: "t-1",
        valeur: { toNumber: () => 2700 },
        updatedAt: new Date("2026-08-28T07:00:00.000Z"),
      });
      return executer(tx);
    });
    const res = await request(app())
      .put("/api/caisse/taux")
      .send({ date: "2026-08-28", valeur: 2800, versionAttendue: "2026-08-28T06:00:00.000Z" });
    expect(res.status).toBe(409);
  });

  it("409 (jamais un 500 brut) sur violation d'unicité lors d'une première définition concurrente", async () => {
    mocks.verrouillerSessionOuverte.mockResolvedValue(SESSION_OUVERTE);
    const { Prisma } = await import("@prisma/client");
    const { transactionSerializable } = await import("../services/caisseAtomique.js");
    (transactionSerializable as ReturnType<typeof vi.fn>).mockImplementation((_db: unknown, executer: (tx: unknown) => Promise<unknown>) => {
      const tx = txFactice();
      (tx.tauxDuJour.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }),
      );
      return executer(tx);
    });
    const res = await request(app()).put("/api/caisse/taux").send({ date: "2026-08-28", valeur: 2800 });
    expect(res.status).toBe(409);
  });
});

describe("PUT /api/caisse/depenses/farine — au plus une ligne par date", () => {
  it("409 (jamais un 500 brut) quand deux activations concurrentes se heurtent à l'index unique partiel", async () => {
    mocks.verrouillerSessionOuverte.mockResolvedValue(SESSION_OUVERTE);
    const { Prisma } = await import("@prisma/client");
    const { transactionSerializable } = await import("../services/caisseAtomique.js");
    (transactionSerializable as ReturnType<typeof vi.fn>).mockImplementation((_db: unknown, executer: (tx: unknown) => Promise<unknown>) => {
      const tx = txFactice();
      (tx.tauxDuJour.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "t-1", valeur: { toNumber: () => 2700 } });
      (tx.production.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({ _sum: { sacsUtilises: { toNumber: () => 4 } } });
      (tx.depenseCaisse.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "test" }),
      );
      return executer(tx);
    });
    const res = await request(app()).put("/api/caisse/depenses/farine").send({ date: "2026-08-28", active: true });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/caisse/depenses — session requise", () => {
  it("409 quand la session est clôturée", async () => {
    mocks.verrouillerSessionOuverte.mockRejectedValue(new ErreurAction(409, "La session de caisse du 2026-08-28 est clôturée"));
    const res = await request(app()).post("/api/caisse/depenses").send({ date: "2026-08-28", motif: "Transport", montant: 5000 });
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/caisse/depenses/:id", () => {
  it("404 si la dépense n'existe pas (aperçu hors transaction)", async () => {
    mocks.depenseCaisseFindUnique.mockResolvedValue(null);
    const res = await request(app()).delete("/api/caisse/depenses/absent");
    expect(res.status).toBe(404);
    expect(mocks.verrouillerSessionOuverte).not.toHaveBeenCalled();
  });

  it("409 quand la session de la date de la dépense est clôturée", async () => {
    mocks.depenseCaisseFindUnique.mockResolvedValue({ id: "d-1", date: new Date("2026-08-28T00:00:00.000Z"), motif: "x", montant: 100 });
    mocks.verrouillerSessionOuverte.mockRejectedValue(new ErreurAction(409, "clôturée"));
    const res = await request(app()).delete("/api/caisse/depenses/d-1");
    expect(res.status).toBe(409);
  });
});

describe("PUT /api/caisse/depenses/farine", () => {
  it("409 quand la session n'est pas ouverte", async () => {
    mocks.verrouillerSessionOuverte.mockRejectedValue(new ErreurAction(409, "clôturée"));
    const res = await request(app()).put("/api/caisse/depenses/farine").send({ date: "2026-08-28", active: true });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/caisse/sessions/:id/cloturer", () => {
  it("400 ECART_NON_MOTIVE quand l'écart est non nul sans motif", async () => {
    mocks.verrouillerSessionOuverteParId.mockResolvedValue(SESSION_OUVERTE);
    const { transactionSerializable } = await import("../services/caisseAtomique.js");
    (transactionSerializable as ReturnType<typeof vi.fn>).mockImplementation((_db: unknown, executer: (tx: unknown) => Promise<unknown>) => {
      const tx = txFactice();
      // construireRegistre(tx, ...) lira des collections vides -> solde = 0,
      // donc soldeTheoriqueFermeture = soldeOuverture (5000) ; un compte à
      // 6000 crée un écart non nul sans motif fourni par la requête.
      return executer(tx);
    });
    const res = await request(app()).post("/api/caisse/sessions/s-1/cloturer").send({ soldeCompteFermeture: 6000 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ECART_NON_MOTIVE");
  });

  it("200 et audit appelé quand l'écart est nul", async () => {
    mocks.verrouillerSessionOuverteParId.mockResolvedValue(SESSION_OUVERTE);
    const res = await request(app()).post("/api/caisse/sessions/s-1/cloturer").send({ soldeCompteFermeture: 5000 });
    expect(res.status).toBe(200);
    expect(mocks.auditerCaisseTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ typeEntite: "SessionCaisse", action: "MODIFICATION" }),
    );
  });

  it("503 après épuisement des réessais P2034 — jamais un 500 brut", async () => {
    const { ErreurEcritureCaisseReessayable, executerAvecReessaiP2034 } = await import("../services/caisseAtomique.js");
    (executerAvecReessaiP2034 as ReturnType<typeof vi.fn>).mockRejectedValue(new ErreurEcritureCaisseReessayable());
    const res = await request(app()).post("/api/caisse/sessions/s-1/cloturer").send({ soldeCompteFermeture: 5000 });
    expect(res.status).toBe(503);
  });
});

describe("POST /api/caisse/sessions/:id/corriger", () => {
  it("403 si l'utilisateur n'est pas Admin Principal", async () => {
    const res = await request(app())
      .post("/api/caisse/sessions/s-1/corriger")
      .send({ soldeCompteFermeture: 5000, motif: "erreur", versionAttendue: "x" });
    expect(res.status).toBe(403);
    expect(mocks.verrouillerSessionFermeeParId).not.toHaveBeenCalled();
  });

  it("409 quand la version transmise ne correspond plus à la session (course détectée)", async () => {
    utilisateurCourant = { id: "admin-1", nom: "Admin", estAdminPrincipal: true };

    mocks.verrouillerSessionFermeeParId.mockResolvedValue({
      ...SESSION_OUVERTE,
      statut: "FERMEE" as const,
      soldeTheoriqueFermeture: 5000,
      updatedAt: new Date("2026-08-28T09:00:00.000Z"),
    });
    const res = await request(app())
      .post("/api/caisse/sessions/s-1/corriger")
      .send({ soldeCompteFermeture: 5100, motif: "correction", versionAttendue: "2026-08-28T08:00:00.000Z" });
    expect(res.status).toBe(409);
  });
});
