import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  demandeCreate: vi.fn(),
  demandeFindMany: vi.fn(),
  demandeFindUnique: vi.fn(),
  demandeFindUniqueOrThrow: vi.fn(),
  demandeUpdate: vi.fn(),
  demandeUpdateMany: vi.fn(),
  zoneFindUnique: vi.fn(),
  typeClientFindUnique: vi.fn(),
  clientCreate: vi.fn(),
  emettreEvenement: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    demandeInscriptionDepositaire: {
      create: mocks.demandeCreate,
      findMany: mocks.demandeFindMany,
      findUnique: mocks.demandeFindUnique,
      findUniqueOrThrow: mocks.demandeFindUniqueOrThrow,
      update: mocks.demandeUpdate,
      updateMany: mocks.demandeUpdateMany,
    },
    zoneDepositaire: { findUnique: mocks.zoneFindUnique },
    typeClient: { findUnique: mocks.typeClientFindUnique },
    client: { create: mocks.clientCreate },
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

import {
  demandesInscriptionDepositairePubliqueRouter,
  demandesInscriptionDepositaireRouter,
} from "./demandesInscriptionDepositaire.js";

function appPublic() {
  const app = express();
  app.use(express.json());
  app.use(demandesInscriptionDepositairePubliqueRouter);
  return app;
}

function appInterne() {
  const app = express();
  app.use(express.json());
  app.use(demandesInscriptionDepositaireRouter);
  return app;
}

function demandeComplete(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "di-1",
    nom: "Jean Mbala",
    telephone: "+243811111111",
    adresse: "12 Avenue de la Paix, Bandal",
    statut: "EN_ATTENTE",
    clientCreeId: null,
    motifRejet: null,
    createdAt: new Date("2026-09-06T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST / (créer une inscription)", () => {
  it("crée la demande d'inscription et émet un événement SYSTÈME", async () => {
    mocks.demandeCreate.mockResolvedValue(demandeComplete());

    const res = await request(appPublic())
      .post("/")
      .send({ nom: "Jean Mbala", telephone: "+243811111111", adresse: "12 Avenue de la Paix, Bandal" });

    expect(res.status).toBe(201);
    expect(res.body.demande.statut).toBe("EN_ATTENTE");
    expect(mocks.emettreEvenement).toHaveBeenCalledWith(expect.objectContaining({ emetteurId: null }));
  });

  it("400 si l'adresse est absente", async () => {
    const res = await request(appPublic()).post("/").send({ nom: "Jean Mbala", telephone: "+243811111111" });
    expect(res.status).toBe(400);
    expect(mocks.demandeCreate).not.toHaveBeenCalled();
  });

  it("n'exige aucune identification préalable (contrairement aux demandes de commande) — pas de vérification de doublon de téléphone", async () => {
    mocks.demandeCreate.mockResolvedValue(demandeComplete());
    const res = await request(appPublic())
      .post("/")
      .send({ nom: "Jean Mbala", telephone: "+243811111111", adresse: "12 Avenue de la Paix" });
    expect(res.status).toBe(201);
  });
});

describe("POST /:id/confirmer", () => {
  it("crée le vrai Client avec le type Dépositaire verrouillé côté serveur et la zone choisie par le gestionnaire", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete());
    mocks.zoneFindUnique.mockResolvedValue({ id: "zone-1", nom: "Dépôts Bandal" });
    mocks.typeClientFindUnique.mockResolvedValue({ id: "tc-depositaire", nom: "Dépositaire" });
    mocks.demandeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.clientCreate.mockResolvedValue({ id: "c-nouveau" });

    const res = await request(appInterne()).post("/di-1/confirmer").send({ zoneDepositaireId: "zone-1" });

    expect(res.status).toBe(200);
    expect(mocks.clientCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nom: "Jean Mbala",
          telephone: "+243811111111",
          adresse: "12 Avenue de la Paix, Bandal",
          typeClientId: "tc-depositaire",
          zoneDepositaireId: "zone-1",
        }),
      }),
    );
    expect(res.body.clientId).toBe("c-nouveau");
  });

  it("400 si la zone n'existe pas — jamais de Client créé sans zone valide", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete());
    mocks.zoneFindUnique.mockResolvedValue(null);
    const res = await request(appInterne()).post("/di-1/confirmer").send({ zoneDepositaireId: "zone-inexistante" });
    expect(res.status).toBe(400);
    expect(mocks.clientCreate).not.toHaveBeenCalled();
  });

  it("400 si zoneDepositaireId est absent du corps", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete());
    const res = await request(appInterne()).post("/di-1/confirmer").send({});
    expect(res.status).toBe(400);
    expect(mocks.zoneFindUnique).not.toHaveBeenCalled();
  });

  it("409 si déjà traitée", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete({ statut: "CONFIRMEE" }));
    const res = await request(appInterne()).post("/di-1/confirmer").send({ zoneDepositaireId: "zone-1" });
    expect(res.status).toBe(409);
  });

  it("409 si la réclamation échoue (déjà traitée entre la lecture et l'écriture)", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete());
    mocks.zoneFindUnique.mockResolvedValue({ id: "zone-1", nom: "Dépôts Bandal" });
    mocks.typeClientFindUnique.mockResolvedValue({ id: "tc-depositaire", nom: "Dépositaire" });
    mocks.demandeUpdateMany.mockResolvedValue({ count: 0 });
    const res = await request(appInterne()).post("/di-1/confirmer").send({ zoneDepositaireId: "zone-1" });
    expect(res.status).toBe(409);
    expect(mocks.clientCreate).not.toHaveBeenCalled();
  });
});

describe("POST /:id/rejeter", () => {
  it("rejette avec motif", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete());
    mocks.demandeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.demandeFindUniqueOrThrow.mockResolvedValue(demandeComplete({ statut: "REJETEE", motifRejet: "Adresse hors zone desservie" }));

    const res = await request(appInterne()).post("/di-1/rejeter").send({ motif: "Adresse hors zone desservie" });

    expect(res.status).toBe(200);
    expect(res.body.demande.statut).toBe("REJETEE");
  });

  it("400 si le motif est vide", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete());
    const res = await request(appInterne()).post("/di-1/rejeter").send({ motif: "" });
    expect(res.status).toBe(400);
  });
});
