import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientFindFirst: vi.fn(),
  produitCount: vi.fn(),
  demandeCreate: vi.fn(),
  demandeFindMany: vi.fn(),
  demandeFindUnique: vi.fn(),
  demandeFindUniqueOrThrow: vi.fn(),
  demandeUpdateMany: vi.fn(),
  emettreEvenement: vi.fn(),
  chargerSchemaCommandeJour: vi.fn(),
  appliquerSchemaCommandeJour: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    client: { findFirst: mocks.clientFindFirst },
    produit: { count: mocks.produitCount },
    demandeCommandePublique: {
      create: mocks.demandeCreate,
      findMany: mocks.demandeFindMany,
      findUnique: mocks.demandeFindUnique,
      findUniqueOrThrow: mocks.demandeFindUniqueOrThrow,
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

vi.mock("./production.js", async () => {
  const actual = await vi.importActual<typeof import("./production.js")>("./production.js");
  return {
    ...actual,
    chargerSchemaCommandeJour: mocks.chargerSchemaCommandeJour,
    appliquerSchemaCommandeJour: mocks.appliquerSchemaCommandeJour,
  };
});

import {
  demandesCommandePubliquesPubliqueRouter,
  demandesCommandePubliquesRouter,
} from "./demandesCommandePubliques.js";
import { ErreurAction } from "../lib/erreurAction.js";

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

const PRODUIT_BAGUETTE_500 = { id: "p-baguette-500", nom: "Baguette 500 Fc" };
const PRODUIT_CARRE_1500 = { id: "p-carre-1500", nom: "Carré 1.500 Fc" };

function demandeComplete(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "d-1",
    clientId: "c-1",
    client: CLIENT_DEPOSITAIRE,
    dateSouhaitee: new Date("2026-09-07T00:00:00Z"),
    note: null,
    statut: "EN_ATTENTE",
    motifRejet: null,
    createdAt: new Date("2026-09-05T00:00:00Z"),
    lignes: [
      { produitId: PRODUIT_BAGUETTE_500.id, quantite: 10, produit: PRODUIT_BAGUETTE_500 },
      { produitId: PRODUIT_CARRE_1500.id, quantite: 5, produit: PRODUIT_CARRE_1500 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /identifier", () => {
  it("confirme l'identité pour un téléphone connu, sans exposer de donnée financière", async () => {
    mocks.clientFindFirst.mockResolvedValue(CLIENT_DEPOSITAIRE);
    const res = await request(appPublic()).post("/identifier").send({ telephone: "0810000001" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ trouve: true, clientId: "c-1", nom: "Dépôt Bandal", typeClient: "Dépositaire" });
  });

  it("répond 404 générique pour un téléphone inconnu", async () => {
    mocks.clientFindFirst.mockResolvedValue(null);
    const res = await request(appPublic()).post("/identifier").send({ telephone: "0000000000" });
    expect(res.status).toBe(404);
    expect(res.body.trouve).toBe(false);
  });
});

describe("POST / (créer une demande)", () => {
  const CORPS_VALIDE = {
    telephone: "0810000001",
    dateSouhaitee: "2026-09-07",
    lignes: [
      { produitId: "p-baguette-500", quantite: 10 },
      { produitId: "p-carre-1500", quantite: 5 },
    ],
  };

  it("crée la demande avec le détail par produit structuré et émet un événement SYSTÈME", async () => {
    mocks.clientFindFirst.mockResolvedValue(CLIENT_DEPOSITAIRE);
    mocks.produitCount.mockResolvedValue(2);
    mocks.demandeCreate.mockResolvedValue(demandeComplete());

    const res = await request(appPublic()).post("/").send(CORPS_VALIDE);

    expect(res.status).toBe(201);
    expect(res.body.demande.lignes).toHaveLength(2);
    expect(res.body.demande.totalBacs).toBe(15);
    expect(res.body.demande.dateSouhaitee).toBe("2026-09-07");
    expect(mocks.emettreEvenement).toHaveBeenCalledWith(
      expect.objectContaining({ type: "DEMANDE_COMMANDE_PUBLIQUE", emetteurId: null }),
    );
  });

  it("400 si un produit demandé est inconnu ou inactif", async () => {
    mocks.clientFindFirst.mockResolvedValue(CLIENT_DEPOSITAIRE);
    mocks.produitCount.mockResolvedValue(1); // un seul des deux existe/est actif
    const res = await request(appPublic()).post("/").send(CORPS_VALIDE);
    expect(res.status).toBe(400);
    expect(mocks.demandeCreate).not.toHaveBeenCalled();
  });

  it("400 si le même produit apparaît deux fois", async () => {
    mocks.clientFindFirst.mockResolvedValue(CLIENT_DEPOSITAIRE);
    mocks.produitCount.mockResolvedValue(1);
    const res = await request(appPublic())
      .post("/")
      .send({ ...CORPS_VALIDE, lignes: [{ produitId: "p-baguette-500", quantite: 5 }, { produitId: "p-baguette-500", quantite: 3 }] });
    expect(res.status).toBe(400);
  });

  it("400 si dateSouhaitee est absente (désormais requise)", async () => {
    const { dateSouhaitee: _sansDate, ...sansDate } = CORPS_VALIDE;
    const res = await request(appPublic()).post("/").send(sansDate);
    expect(res.status).toBe(400);
    expect(mocks.clientFindFirst).not.toHaveBeenCalled();
  });

  it("revérifie le téléphone même si un clientId était deviné", async () => {
    mocks.clientFindFirst.mockResolvedValue(null);
    const res = await request(appPublic()).post("/").send(CORPS_VALIDE);
    expect(res.status).toBe(404);
    expect(mocks.demandeCreate).not.toHaveBeenCalled();
  });
});

describe("POST /:id/confirmer", () => {
  it("fusionne les lignes de la demande dans le Schéma existant du jour, en ADDITIONNANT les quantités déjà présentes pour ce client", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete());
    mocks.demandeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.chargerSchemaCommandeJour.mockResolvedValue({
      date: "2026-09-07",
      clients: [
        // Ce même client a DÉJÀ 3 Baguette 500Fc pour ce jour — doit devenir 10+3=13.
        { clientId: "c-1", lignes: [{ produitId: "p-baguette-500", quantite: 3 }] },
        { clientId: "c-autre", lignes: [{ produitId: "p-carre-1500", quantite: 20 }] },
      ],
      totauxParProduit: [],
      totalGeneral: 23,
    });
    mocks.appliquerSchemaCommandeJour.mockResolvedValue({ schema: { date: "2026-09-07" } });

    const res = await request(appInterne()).post("/d-1/confirmer").send({});

    expect(res.status).toBe(200);
    const [dateAppelee, clientsAppeles] = mocks.appliquerSchemaCommandeJour.mock.calls[0];
    expect(dateAppelee).toBe("2026-09-07");
    // L'autre client doit être préservé tel quel.
    expect(clientsAppeles).toContainEqual({ clientId: "c-autre", lignes: [{ produitId: "p-carre-1500", quantite: 20 }] });
    // Ce client : 13 Baguette 500 (3 existant + 10 de la demande) + 5 Carré 1500 (nouveau).
    const ligneClient = clientsAppeles.find((c: { clientId: string }) => c.clientId === "c-1");
    expect(ligneClient.lignes).toEqual(
      expect.arrayContaining([
        { produitId: "p-baguette-500", quantite: 13 },
        { produitId: "p-carre-1500", quantite: 5 },
      ]),
    );
  });

  it("réclame la demande (EN_ATTENTE→CONFIRMEE) AVANT la fusion — protection double-clic", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete());
    mocks.demandeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.chargerSchemaCommandeJour.mockResolvedValue({ date: "2026-09-07", clients: [], totauxParProduit: [], totalGeneral: 0 });
    mocks.appliquerSchemaCommandeJour.mockResolvedValue({ schema: {} });

    await request(appInterne()).post("/d-1/confirmer").send({});

    expect(mocks.demandeUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "d-1", statut: "EN_ATTENTE" },
        data: expect.objectContaining({ statut: "CONFIRMEE" }),
      }),
    );
  });

  it("409 si un autre traitement a déjà réclamé la demande entre-temps (updateMany count=0)", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete());
    mocks.demandeUpdateMany.mockResolvedValue({ count: 0 });

    const res = await request(appInterne()).post("/d-1/confirmer").send({});

    expect(res.status).toBe(409);
    expect(mocks.chargerSchemaCommandeJour).not.toHaveBeenCalled();
  });

  it("409 si la demande est déjà CONFIRMEE ou REJETEE au moment de la lecture initiale", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete({ statut: "CONFIRMEE" }));
    const res = await request(appInterne()).post("/d-1/confirmer").send({});
    expect(res.status).toBe(409);
    expect(mocks.demandeUpdateMany).not.toHaveBeenCalled();
  });

  it("404 si la demande n'existe pas", async () => {
    mocks.demandeFindUnique.mockResolvedValue(null);
    const res = await request(appInterne()).post("/introuvable/confirmer").send({});
    expect(res.status).toBe(404);
  });

  it("remet la demande en EN_ATTENTE si la fusion échoue, plutôt que de la laisser CONFIRMEE sans effet réel", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete());
    mocks.demandeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.chargerSchemaCommandeJour.mockResolvedValue({ date: "2026-09-07", clients: [], totauxParProduit: [], totalGeneral: 0 });
    mocks.appliquerSchemaCommandeJour.mockResolvedValue({ erreur: "Produit inconnu dans le schéma", statutHttp: 400 });

    const res = await request(appInterne()).post("/d-1/confirmer").send({});

    expect(res.status).toBe(400);
    // Deux appels updateMany : la réclamation initiale, puis le retour en arrière.
    expect(mocks.demandeUpdateMany).toHaveBeenCalledTimes(2);
    expect(mocks.demandeUpdateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: "d-1", statut: "CONFIRMEE" }, data: expect.objectContaining({ statut: "EN_ATTENTE" }) }),
    );
  });

  it("surface le vrai message métier (ex. Caisse/Planning verrouillé) plutôt qu'un 500 générique", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete());
    mocks.demandeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.chargerSchemaCommandeJour.mockResolvedValue({ date: "2026-09-07", clients: [], totauxParProduit: [], totalGeneral: 0 });
    mocks.appliquerSchemaCommandeJour.mockRejectedValue(
      new ErreurAction(409, "La planification a été modifiée simultanément. Rechargez les données avant de réessayer."),
    );

    const res = await request(appInterne()).post("/d-1/confirmer").send({});

    expect(res.status).toBe(409);
    expect(res.body.erreur).toContain("modifiée simultanément");
  });
});

describe("POST /:id/rejeter", () => {
  it("rejette avec motif via verrouillage optimiste (updateMany count=1)", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete());
    mocks.demandeUpdateMany.mockResolvedValue({ count: 1 });
    mocks.demandeFindUniqueOrThrow.mockResolvedValue(demandeComplete({ statut: "REJETEE", motifRejet: "Zone non desservie" }));

    const res = await request(appInterne()).post("/d-1/rejeter").send({ motif: "Zone non desservie" });

    expect(res.status).toBe(200);
    expect(mocks.demandeUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "d-1", statut: "EN_ATTENTE" },
        data: expect.objectContaining({ statut: "REJETEE", motifRejet: "Zone non desservie" }),
      }),
    );
  });

  it("400 si le motif est vide", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete());
    const res = await request(appInterne()).post("/d-1/rejeter").send({ motif: "" });
    expect(res.status).toBe(400);
    expect(mocks.demandeUpdateMany).not.toHaveBeenCalled();
  });

  it("409 si déjà traitée", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete({ statut: "CONFIRMEE" }));
    const res = await request(appInterne()).post("/d-1/rejeter").send({ motif: "Peu importe" });
    expect(res.status).toBe(409);
  });

  it("409 si la réclamation échoue (déjà traitée entre la lecture et l'écriture)", async () => {
    mocks.demandeFindUnique.mockResolvedValue(demandeComplete());
    mocks.demandeUpdateMany.mockResolvedValue({ count: 0 });
    const res = await request(appInterne()).post("/d-1/rejeter").send({ motif: "Peu importe" });
    expect(res.status).toBe(409);
  });
});
