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
import { busEvenements } from "../lib/events.js";

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

// --- Preuves complémentaires (round correctif Codex, 29/08/2026, P2) --------
//
// caisse.test.ts ne couvrait jusqu'ici aucune route parmi
// POST /sessions/:id/remises et POST /sessions/:id/confirmer-reglements —
// l'affirmation « contrat HTTP de toutes les routes réécrites » de la PR #38
// n'était donc pas démontrée pour ces deux routes. Comblé ci-dessous, même
// convention que le reste du fichier (mock du service caisseAtomique.js,
// jamais Prisma directement) ; la persistance de l'empreinte d'idempotence
// elle-même (rejeu détecté, clé réutilisée avec des données différentes) est
// déjà prouvée génériquement, indépendamment de la route appelante, par
// lib/idempotence.test.ts et lib/idempotence-execution.test.ts — ici, seul
// le comportement PROPRE à la route (verrou avant écriture, aucun événement
// sur rejeu, audit transactionnel exact) est vérifié.

const REMISE_FIXTURE = {
  id: "r-1",
  sessionCaisseId: "s-1",
  montant: 5000,
  remisParNom: "Jean",
  recuPar: { id: "u-1", nom: "Alice" },
  enregistrePar: { id: "u-1", nom: "Alice" },
  reference: null,
  observation: null,
  dateRemise: new Date("2026-08-28T09:00:00.000Z"),
};

describe("POST /api/caisse/sessions/:id/remises", () => {
  it("404 quand la session est introuvable — aucune remise créée", async () => {
    mocks.verrouillerSessionOuverteParId.mockRejectedValue(new ErreurAction(404, "Session de caisse introuvable"));
    const res = await request(app()).post("/api/caisse/sessions/absente/remises").send({ montant: 5000, remisParNom: "Jean" });
    expect(res.status).toBe(404);
  });

  it("409 quand la session est clôturée — aucune remise créée", async () => {
    mocks.verrouillerSessionOuverteParId.mockRejectedValue(new ErreurAction(409, "La session de caisse du 2026-08-28 est clôturée"));
    const res = await request(app()).post("/api/caisse/sessions/s-1/remises").send({ montant: 5000, remisParNom: "Jean" });
    expect(res.status).toBe(409);
  });

  it("409 quand une session antérieure reste ouverte — aucun événement émis", async () => {
    mocks.verrouillerSessionOuverteParId.mockResolvedValue(SESSION_OUVERTE);
    mocks.verifierAucuneSessionAnterieureOuverte.mockRejectedValue(
      new ErreurAction(409, "Clôturez d'abord la session de caisse du 2026-08-27 avant de continuer"),
    );
    const handler = vi.fn();
    busEvenements.surEvenement(handler);
    try {
      const res = await request(app()).post("/api/caisse/sessions/s-1/remises").send({ montant: 5000, remisParNom: "Jean" });
      expect(res.status).toBe(409);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      busEvenements.removeAllListeners("evenement");
    }
  });

  it("201 sur session ouverte : la remise n'est créée qu'APRÈS l'acquisition et la validation du verrou", async () => {
    mocks.verrouillerSessionOuverteParId.mockResolvedValue(SESSION_OUVERTE);
    const creation = vi.fn().mockResolvedValue(REMISE_FIXTURE);
    const { executerEcritureIdempotente } = await import("../lib/idempotence.js");
    (executerEcritureIdempotente as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_req: unknown, _portee: unknown, _donnees: unknown, executer: (tx: unknown) => Promise<unknown>, versReponse: (v: unknown) => unknown) => {
        const tx = txFactice({ remiseCaisse: { create: creation } });
        const valeur = await executer(tx);
        const reponse = versReponse(valeur) as { statutHttp: number; corps: unknown };
        return { ...reponse, valeur, rejoue: false };
      },
    );

    const res = await request(app())
      .post("/api/caisse/sessions/s-1/remises")
      .send({ montant: 5000, remisParNom: "Jean" });

    expect(res.status).toBe(201);
    expect(res.body.remise).toMatchObject({ id: "r-1", montant: 5000, remisParNom: "Jean" });
    expect(creation).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sessionCaisseId: "s-1", montant: 5000, remisParNom: "Jean" }) }),
    );
    // Ordre d'appel réel : le verrou est acquis et validé AVANT toute écriture.
    const ordreVerrou = mocks.verrouillerSessionOuverteParId.mock.invocationCallOrder[0]!;
    const ordreCreation = creation.mock.invocationCallOrder[0]!;
    expect(ordreVerrou).toBeLessThan(ordreCreation);
  });

  it("n'émet aucun événement lors d'un rejeu (Idempotency-Key déjà traitée)", async () => {
    const { executerEcritureIdempotente } = await import("../lib/idempotence.js");
    (executerEcritureIdempotente as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      statutHttp: 201,
      corps: {
        remise: {
          id: "r-1",
          sessionCaisseId: "s-1",
          montant: 5000,
          remisParNom: "Jean",
          recuPar: { id: "u-1", nom: "Alice" },
          reference: null,
          observation: null,
          dateRemise: "2026-08-28T09:00:00.000Z",
        },
      },
      rejoue: true,
    });
    const handler = vi.fn();
    busEvenements.surEvenement(handler);
    try {
      const res = await request(app())
        .post("/api/caisse/sessions/s-1/remises")
        .set("Idempotency-Key", "clef-test-remise-01")
        .send({ montant: 5000, remisParNom: "Jean" });
      expect(res.status).toBe(201);
      expect(handler).not.toHaveBeenCalled();
    } finally {
      busEvenements.removeAllListeners("evenement");
    }
  });
});

function txConfirmerReglements(overrides: Record<string, unknown> = {}) {
  const commandeAvant = {
    id: "cmd-1",
    numero: 10,
    clientId: "c-1",
    quantiteBacs: 5,
    montantBrut: 20_500,
    commission: 0,
    avanceUtilisee: 0,
    montantAPercevoir: 20_500,
    montantRecu: 10_000,
    dette: 10_500,
    avanceGeneree: 0,
    nouvelleAvance: 0,
    client: { id: "c-1", avanceDisponible: 0 },
  };
  const paiementAvant = {
    id: "p-1",
    commandeClientId: "cmd-1",
    montant: 500,
    date: new Date("2026-08-27T10:00:00.000Z"),
    enregistreParId: "u-2",
    statut: "DECLARE" as const,
    remiseCaisseId: null,
    confirmeLe: null,
    confirmeParId: null,
    commandeClient: commandeAvant,
  };
  return {
    tx: txFactice({
      paiementCommande: {
        findUnique: vi.fn().mockResolvedValue({ id: "p-1", statut: "DECLARE" }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(paiementAvant),
        findMany: vi.fn().mockResolvedValue([{ montant: 500 }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      remiseCaisse: { create: vi.fn().mockResolvedValue(REMISE_FIXTURE) },
      commandeClient: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...commandeAvant, montantRecu: 10_500, dette: 10_000 }),
      },
      client: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "c-1", avanceDisponible: 0 }),
      },
      ...overrides,
    }),
    paiementAvant,
  };
}

describe("POST /api/caisse/sessions/:id/confirmer-reglements", () => {
  it("404 quand la session est introuvable", async () => {
    mocks.verrouillerSessionOuverteParId.mockRejectedValue(new ErreurAction(404, "Session de caisse introuvable"));
    const res = await request(app())
      .post("/api/caisse/sessions/absente/confirmer-reglements")
      .send({ paiementCommandeIds: ["p-1"], remisParNom: "Jean" });
    expect(res.status).toBe(404);
  });

  it("409 quand la session est clôturée", async () => {
    mocks.verrouillerSessionOuverteParId.mockRejectedValue(new ErreurAction(409, "clôturée"));
    const res = await request(app())
      .post("/api/caisse/sessions/s-1/confirmer-reglements")
      .send({ paiementCommandeIds: ["p-1"], remisParNom: "Jean" });
    expect(res.status).toBe(409);
  });

  it("409 REGLEMENT_INVALIDE quand un règlement est absent ou déjà confirmé", async () => {
    mocks.verrouillerSessionOuverteParId.mockResolvedValue(SESSION_OUVERTE);
    const { tx } = txConfirmerReglements({
      paiementCommande: {
        findUnique: vi.fn().mockResolvedValue(null),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
    });
    const { executerEcritureIdempotente } = await import("../lib/idempotence.js");
    (executerEcritureIdempotente as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_req: unknown, _portee: unknown, _donnees: unknown, executer: (tx: unknown) => Promise<unknown>, versReponse: (v: unknown) => unknown) => {
        const valeur = await executer(tx);
        const reponse = versReponse(valeur) as { statutHttp: number; corps: unknown };
        return { ...reponse, valeur, rejoue: false };
      },
    );
    const res = await request(app())
      .post("/api/caisse/sessions/s-1/confirmer-reglements")
      .send({ paiementCommandeIds: ["p-absent"], remisParNom: "Jean" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REGLEMENT_INVALIDE");
    expect(tx.remiseCaisse.create).not.toHaveBeenCalled();
  });

  it("valide TOUT le lot avant la première écriture — un seul règlement invalide dans un lot de deux bloque tout, aucune confirmation partielle", async () => {
    mocks.verrouillerSessionOuverteParId.mockResolvedValue(SESSION_OUVERTE);
    const findUnique = vi.fn(async ({ where }: { where: { id: string } }) =>
      where.id === "p-1" ? { id: "p-1", statut: "DECLARE" } : null,
    );
    const { tx } = txConfirmerReglements({ paiementCommande: { findUnique, findUniqueOrThrow: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() } });
    const { executerEcritureIdempotente } = await import("../lib/idempotence.js");
    (executerEcritureIdempotente as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_req: unknown, _portee: unknown, _donnees: unknown, executer: (tx: unknown) => Promise<unknown>, versReponse: (v: unknown) => unknown) => {
        const valeur = await executer(tx);
        const reponse = versReponse(valeur) as { statutHttp: number; corps: unknown };
        return { ...reponse, valeur, rejoue: false };
      },
    );
    const res = await request(app())
      .post("/api/caisse/sessions/s-1/confirmer-reglements")
      .send({ paiementCommandeIds: ["p-1", "p-2-invalide"], remisParNom: "Jean" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REGLEMENT_INVALIDE");
    // Les DEUX id ont été vérifiés avant toute écriture ; aucune remise ni
    // aucune écriture sur le règlement valide (p-1) n'a été créée malgré sa
    // validité individuelle — jamais de confirmation partielle.
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(tx.remiseCaisse.create).not.toHaveBeenCalled();
    expect(tx.paiementCommande.updateMany).not.toHaveBeenCalled();
  });

  it("201 : rattache le paiement à la RemiseCaisse de la session d'encaissement, écrit CommandeClient/Client/PaiementCommande via updateMany, et audite exactement les trois", async () => {
    mocks.verrouillerSessionOuverteParId.mockResolvedValue(SESSION_OUVERTE);
    const { tx } = txConfirmerReglements();
    const { executerEcritureIdempotente } = await import("../lib/idempotence.js");
    (executerEcritureIdempotente as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_req: unknown, _portee: unknown, _donnees: unknown, executer: (tx: unknown) => Promise<unknown>, versReponse: (v: unknown) => unknown) => {
        const valeur = await executer(tx);
        const reponse = versReponse(valeur) as { statutHttp: number; corps: unknown };
        return { ...reponse, valeur, rejoue: false };
      },
    );

    const res = await request(app())
      .post("/api/caisse/sessions/s-1/confirmer-reglements")
      .send({ paiementCommandeIds: ["p-1"], remisParNom: "Jean" });

    expect(res.status).toBe(201);
    expect(tx.paiementCommande.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "p-1" }, data: expect.objectContaining({ statut: "CONFIRME", remiseCaisseId: "r-1" }) }),
    );
    expect(tx.commandeClient.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "cmd-1" } }));
    expect(tx.client.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c-1" } }));
    expect(mocks.auditerCaisseTx).toHaveBeenCalledTimes(3);
    expect(mocks.auditerCaisseTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ module: "COMMANDES", typeEntite: "CommandeClient", action: "MODIFICATION" }),
    );
    expect(mocks.auditerCaisseTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ module: "COMMANDES", typeEntite: "Client", action: "MODIFICATION" }),
    );
    expect(mocks.auditerCaisseTx).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ module: "COMMANDES", typeEntite: "PaiementCommande", action: "MODIFICATION" }),
    );
  });

  it("rollback complet (jamais un 500 Prisma brut, jamais de confirmation partielle) si l'audit CommandeClient échoue", async () => {
    mocks.verrouillerSessionOuverteParId.mockResolvedValue(SESSION_OUVERTE);
    const { tx } = txConfirmerReglements();
    mocks.auditerCaisseTx.mockRejectedValueOnce(new Error("échec d'audit injecté"));
    const { executerEcritureIdempotente } = await import("../lib/idempotence.js");
    (executerEcritureIdempotente as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (_req: unknown, _portee: unknown, _donnees: unknown, executer: (tx: unknown) => Promise<unknown>, versReponse: (v: unknown) => unknown) => {
        const valeur = await executer(tx);
        const reponse = versReponse(valeur) as { statutHttp: number; corps: unknown };
        return { ...reponse, valeur, rejoue: false };
      },
    );
    const handler = vi.fn();
    busEvenements.surEvenement(handler);
    try {
      const res = await request(app())
        .post("/api/caisse/sessions/s-1/confirmer-reglements")
        .send({ paiementCommandeIds: ["p-1"], remisParNom: "Jean" });
      // Aucun gestionnaire d'erreur JSON monté dans ce harnais de test
      // minimal (app() ci-dessus) — Express retombe sur son gestionnaire
      // 500 par défaut. En production (app.ts), le même rejet atteint le
      // gestionnaire générique qui répond 500 SANS détail Prisma brut
      // (voir app.ts) — jamais 200/201.
      expect(res.status).toBe(500);
      // L'échec de l'audit CommandeClient (1er des 3) empêche les écritures
      // et audits suivants (Client, PaiementCommande) de s'exécuter.
      expect(mocks.auditerCaisseTx).toHaveBeenCalledTimes(1);
      expect(tx.client.updateMany).not.toHaveBeenCalled();
      expect(tx.paiementCommande.updateMany).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    } finally {
      busEvenements.removeAllListeners("evenement");
    }
  });

  it("503 après épuisement des réessais P2034 — jamais un 500 brut", async () => {
    const { ErreurEcritureCaisseReessayable, executerAvecReessaiP2034 } = await import("../services/caisseAtomique.js");
    (executerAvecReessaiP2034 as ReturnType<typeof vi.fn>).mockRejectedValue(new ErreurEcritureCaisseReessayable());
    const res = await request(app())
      .post("/api/caisse/sessions/s-1/confirmer-reglements")
      .send({ paiementCommandeIds: ["p-1"], remisParNom: "Jean" });
    expect(res.status).toBe(503);
  });
});
