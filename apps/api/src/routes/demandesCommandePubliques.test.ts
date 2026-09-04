import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientFindFirst: vi.fn(),
  demandeCreate: vi.fn(),
  demandeFindMany: vi.fn(),
  demandeFindUnique: vi.fn(),
  demandeUpdate: vi.fn(),
  demandeUpdateMany: vi.fn(),
  emettreEvenement: vi.fn(),
  executerCreationOuMiseAJourCommande: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    client: { findFirst: mocks.clientFindFirst },
    demandeCommandePublique: {
      create: mocks.demandeCreate,
      findMany: mocks.demandeFindMany,
      findUnique: mocks.demandeFindUnique,
      update: mocks.demandeUpdate,
      updateMany: mocks.demandeUpdateMany,
    },
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = { id: "u-1", nom: "Alice", estAdminPrincipal: false } as express.Request["utilisateur"];
    next();
  },
  requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("../lib/events.js", () => ({
  busEvenements: { emettreEvenement: mocks.emettreEvenement },
}));

vi.mock("../services/caisseAtomique.js", async () => {
  const actual = await vi.importActual<typeof import("../services/caisseAtomique.js")>("../services/caisseAtomique.js");
  return { ...actual, executerAvecReessaiP2034: vi.fn((operation: () => Promise<unknown>) => operation()) };
});

vi.mock("./commandes.js", async () => {
  const actual = await vi.importActual<typeof import("./commandes.js")>("./commandes.js");
  return { ...actual, executerCreationOuMiseAJourCommande: mocks.executerCreationOuMiseAJourCommande };
});

let executerEcritureIdempotenteMock: (
  req: unknown,
  portee: string,
  donnees: unknown,
  executer: (tx: unknown) => Promise<unknown>,
  versReponse: (v: unknown) => { statutHttp: number; corps: unknown },
) => Promise<{ rejoue: boolean; corps: unknown }>;

vi.mock("../lib/idempotence.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/idempotence.js")>("../lib/idempotence.js");
  return {
    ...actual,
    executerEcritureIdempotente: vi.fn((...args: Parameters<typeof executerEcritureIdempotenteMock>) =>
      executerEcritureIdempotenteMock(...args),
    ),
    ajouterEnteteRejeu: vi.fn(),
  };
});

import {
  demandesCommandePubliquesPubliqueRouter,
  demandesCommandePubliquesRouter,
} from "./demandesCommandePubliques.js";

function appPublic() {
  const app = express();
  app.use(express.json());
  app.use(demandesCommandePubliquesPubliqueRouter);
  return app;
}

function appInterne() {
  const app = express();
  app.use(express.json());
  app.use(demandesCommandePubliquesRouter);
  return app;
}

const CLIENT_DEPOSITAIRE = {
  id: "c-1",
  nom: "Dépôt Bandal",
  telephone: "0810000001",
  typeClient: { id: "tc-1", nom: "Dépositaire" },
};

beforeEach(() => {
  vi.clearAllMocks();
  executerEcritureIdempotenteMock = async (_req, _portee, _donnees, executer, versReponse) => {
    const resultat = await executer({});
    const { statutHttp, corps } = versReponse(resultat);
    return { rejoue: false, corps: { ...(corps as Record<string, unknown>), statutHttp } };
  };
});

describe("POST /identifier", () => {
  it("confirme l'identité pour un téléphone connu, sans exposer de donnée financière", async () => {
    mocks.clientFindFirst.mockResolvedValue(CLIENT_DEPOSITAIRE);

    const res = await request(appPublic()).post("/identifier").send({ telephone: "0810000001" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ trouve: true, clientId: "c-1", nom: "Dépôt Bandal", typeClient: "Dépositaire" });
    // Jamais avanceDisponible, pointsFidelite ni aucun champ financier.
    expect(res.body.avanceDisponible).toBeUndefined();
  });

  it("répond 404 générique pour un téléphone inconnu, sans détail", async () => {
    mocks.clientFindFirst.mockResolvedValue(null);

    const res = await request(appPublic()).post("/identifier").send({ telephone: "0000000000" });

    expect(res.status).toBe(404);
    expect(res.body.trouve).toBe(false);
  });

  it("ne cherche que parmi Dépositaire/Maman — vérifié sur le filtre passé à Prisma", async () => {
    mocks.clientFindFirst.mockResolvedValue(null);
    await request(appPublic()).post("/identifier").send({ telephone: "0810000001" });

    expect(mocks.clientFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ typeClient: { nom: { in: ["Dépositaire", "Maman"] } } }),
      }),
    );
  });

  it("400 si le téléphone est absent", async () => {
    const res = await request(appPublic()).post("/identifier").send({});
    expect(res.status).toBe(400);
    expect(mocks.clientFindFirst).not.toHaveBeenCalled();
  });
});

describe("POST / (créer une demande)", () => {
  it("crée la demande et émet un événement SYSTÈME (emetteurId null)", async () => {
    mocks.clientFindFirst.mockResolvedValue(CLIENT_DEPOSITAIRE);
    mocks.demandeCreate.mockResolvedValue({
      id: "d-1",
      client: CLIENT_DEPOSITAIRE,
      quantiteBacs: 10,
      dateSouhaitee: null,
      note: null,
      statut: "EN_ATTENTE",
      commandeCreeeId: null,
      motifRejet: null,
      createdAt: new Date("2026-09-04T00:00:00Z"),
    });

    const res = await request(appPublic()).post("/").send({ telephone: "0810000001", quantiteBacs: 10 });

    expect(res.status).toBe(201);
    expect(res.body.demande.statut).toBe("EN_ATTENTE");
    expect(mocks.emettreEvenement).toHaveBeenCalledWith(
      expect.objectContaining({ type: "DEMANDE_COMMANDE_PUBLIQUE", emetteurId: null }),
    );
  });

  it("revérifie le téléphone même si un clientId était deviné — jamais fait confiance à l'entrée seule", async () => {
    mocks.clientFindFirst.mockResolvedValue(null);

    const res = await request(appPublic())
      .post("/")
      .send({ telephone: "0000000000", quantiteBacs: 10, clientIdSuppose: "c-1" });

    expect(res.status).toBe(404);
    expect(mocks.demandeCreate).not.toHaveBeenCalled();
  });

  it("400 si quantiteBacs manque ou est invalide", async () => {
    const res = await request(appPublic()).post("/").send({ telephone: "0810000001", quantiteBacs: 0 });
    expect(res.status).toBe(400);
  });
});

describe("GET / (file interne)", () => {
  it("liste les demandes, filtrable par statut", async () => {
    mocks.demandeFindMany.mockResolvedValue([]);
    const res = await request(appInterne()).get("/?statut=EN_ATTENTE");
    expect(res.status).toBe(200);
    expect(mocks.demandeFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { statut: "EN_ATTENTE" } }));
  });
});

describe("POST /:id/confirmer", () => {
  const DEMANDE_EN_ATTENTE = {
    id: "d-1",
    clientId: "c-1",
    quantiteBacs: 10,
    statut: "EN_ATTENTE",
    client: CLIENT_DEPOSITAIRE,
  };

  it("délègue au cœur de création partagé avec Commandes, jamais une réimplémentation", async () => {
    mocks.demandeFindUnique.mockResolvedValue(DEMANDE_EN_ATTENTE);
    mocks.executerCreationOuMiseAJourCommande.mockResolvedValue({ type: "creee", commande: { id: "cmd-1" } });

    const res = await request(appInterne()).post("/d-1/confirmer").send({});

    expect(res.status).toBe(200);
    expect(mocks.executerCreationOuMiseAJourCommande).toHaveBeenCalledWith(
      expect.anything(),
      { clientId: "c-1", quantiteBacs: 10, montantRecu: 0, strategie: undefined },
      "u-1",
    );
    expect(mocks.demandeUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ statut: "CONFIRMEE", commandeCreeeId: "cmd-1" }) }),
    );
  });

  it("409 si la demande est déjà traitée (CONFIRMEE ou REJETEE) — jamais retraitée deux fois", async () => {
    mocks.demandeFindUnique.mockResolvedValue({ ...DEMANDE_EN_ATTENTE, statut: "CONFIRMEE" });

    const res = await request(appInterne()).post("/d-1/confirmer").send({});

    expect(res.status).toBe(409);
    expect(mocks.executerCreationOuMiseAJourCommande).not.toHaveBeenCalled();
  });

  it("404 si la demande n'existe pas", async () => {
    mocks.demandeFindUnique.mockResolvedValue(null);
    const res = await request(appInterne()).post("/introuvable/confirmer").send({});
    expect(res.status).toBe(404);
  });

  it("propage le conflit (doublon du jour) exactement comme la création manuelle, sans marquer la demande traitée", async () => {
    mocks.demandeFindUnique.mockResolvedValue(DEMANDE_EN_ATTENTE);
    mocks.executerCreationOuMiseAJourCommande.mockResolvedValue({ type: "conflit", existante: { id: "cmd-existante" } });

    const res = await request(appInterne()).post("/d-1/confirmer").send({});

    expect(res.status).toBe(409);
    expect(res.body.conflit).toBe(true);
    expect(mocks.demandeUpdateMany).not.toHaveBeenCalled();
  });
});

describe("POST /:id/rejeter", () => {
  it("rejette avec motif, trace qui et quand", async () => {
    mocks.demandeFindUnique.mockResolvedValue({ id: "d-1", statut: "EN_ATTENTE" });
    mocks.demandeUpdate.mockResolvedValue({
      id: "d-1",
      client: CLIENT_DEPOSITAIRE,
      quantiteBacs: 10,
      dateSouhaitee: null,
      note: null,
      statut: "REJETEE",
      commandeCreeeId: null,
      motifRejet: "Zone non desservie cette semaine",
      createdAt: new Date(),
    });

    const res = await request(appInterne()).post("/d-1/rejeter").send({ motif: "Zone non desservie cette semaine" });

    expect(res.status).toBe(200);
    expect(mocks.demandeUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ statut: "REJETEE", motifRejet: "Zone non desservie cette semaine", traiteParId: "u-1" }),
      }),
    );
  });

  it("400 si le motif est vide", async () => {
    mocks.demandeFindUnique.mockResolvedValue({ id: "d-1", statut: "EN_ATTENTE" });
    const res = await request(appInterne()).post("/d-1/rejeter").send({ motif: "" });
    expect(res.status).toBe(400);
    expect(mocks.demandeUpdate).not.toHaveBeenCalled();
  });

  it("409 si déjà traitée", async () => {
    mocks.demandeFindUnique.mockResolvedValue({ id: "d-1", statut: "CONFIRMEE" });
    const res = await request(appInterne()).post("/d-1/rejeter").send({ motif: "Peu importe" });
    expect(res.status).toBe(409);
  });
});
