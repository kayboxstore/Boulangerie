/**
 * Lot Fournisseurs P1 — preuves HTTP mockées.
 *
 * Le vrai routeur Express est exercé ici pour le contrat HTTP et l'ordre des
 * appels. Les rollbacks et les blocages PostgreSQL sont prouvés séparément par
 * scripts/verifier-fournisseurs-ci.ts.
 */
import { Prisma } from "@prisma/client";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    fournisseur: {
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    commandeFournisseur: {
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(),
      fournisseur: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
      },
      commandeFournisseur: { findMany: vi.fn(), create: vi.fn() },
      matierePremiere: { count: vi.fn() },
    },
    auditerCaisseTx: vi.fn(),
    appliquerMouvement: vi.fn(),
    emettreEvenement: vi.fn(),
  };
});

vi.mock("../lib/prisma.js", () => ({ prisma: mocks.prisma }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = {
      id: "u-fournisseurs",
      nom: "Responsable Fournisseurs",
      estAdminPrincipal: false,
      role: { permissions: [{ module: "FOURNISSEURS", niveauAcces: "ECRITURE" }] },
    } as express.Request["utilisateur"];
    next();
  },
  requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock("../services/caisseAtomique.js", () => ({ auditerCaisseTx: mocks.auditerCaisseTx }));
vi.mock("../services/stocks.js", async () => {
  const actual = await vi.importActual<typeof import("../services/stocks.js")>("../services/stocks.js");
  return { ...actual, appliquerMouvement: mocks.appliquerMouvement };
});
vi.mock("../lib/events.js", () => ({
  busEvenements: { emettreEvenement: mocks.emettreEvenement },
}));

import { fournisseursRouter } from "./fournisseurs.js";

const date = new Date("2026-08-31T10:00:00.000Z");
const decimal = (n: number) => new Prisma.Decimal(n);

function fournisseur(commandes = 0) {
  return {
    id: "fournisseur-1",
    nom: "Minoterie Test",
    contact: "0990000000",
    createdAt: date,
    updatedAt: date,
    _count: { commandes },
  };
}

function ligne(id: string, matierePremiereId: string, quantite: number) {
  return {
    id,
    commandeFournisseurId: "commande-1",
    matierePremiereId,
    quantite: decimal(quantite),
    prixUnitaire: 1000,
    matierePremiere: { id: matierePremiereId, nom: matierePremiereId, unite: "sac" },
  };
}

function commande(statut: "EN_ATTENTE" | "RECUE" = "EN_ATTENTE") {
  return {
    id: "commande-1",
    numero: 42,
    fournisseurId: "fournisseur-1",
    fournisseur: { id: "fournisseur-1", nom: "Minoterie Test" },
    statut,
    date,
    dateReception: statut === "RECUE" ? date : null,
    creeParId: "u-fournisseurs",
    creePar: { id: "u-fournisseurs", nom: "Responsable Fournisseurs" },
    recueParId: statut === "RECUE" ? "u-fournisseurs" : null,
    recuePar: statut === "RECUE" ? { id: "u-fournisseurs", nom: "Responsable Fournisseurs" } : null,
    lignes: [
      ligne("ligne-z", "matiere-z", 2),
      ligne("ligne-a", "matiere-a", 3),
    ],
    mouvements: [],
  };
}

function app() {
  const application = express();
  application.use(express.json());
  application.use("/api/fournisseurs", fournisseursRouter);
  application.use((_e: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
    res.status(500).json({ erreur: "Erreur interne" }),
  );
  return application;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.$transaction.mockImplementation(
    async (operation: (tx: typeof mocks.tx) => Promise<unknown>) => operation(mocks.tx),
  );
  mocks.tx.$queryRaw.mockResolvedValue([{ id: "verrou-1" }]);
  mocks.tx.fournisseur.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.fournisseur.deleteMany.mockResolvedValue({ count: 1 });
  mocks.tx.commandeFournisseur.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.commandeFournisseur.deleteMany.mockResolvedValue({ count: 1 });
  mocks.auditerCaisseTx.mockResolvedValue(undefined);
  mocks.appliquerMouvement.mockResolvedValue({
    matiere: { id: "matiere", nom: "Farine", unite: "sac", quantiteStock: decimal(10), seuilAlerte: decimal(1) },
    franchitSeuil: false,
  });
});

describe("Fournisseur — mutations auditables", () => {
  it("verrouille, modifie via updateMany puis audite dans la transaction", async () => {
    const avant = fournisseur();
    const apres = { ...avant, contact: "0810000000" };
    mocks.tx.fournisseur.findUniqueOrThrow.mockResolvedValueOnce(avant).mockResolvedValueOnce(apres);

    const res = await request(app()).put("/api/fournisseurs/fournisseur-1").send({ contact: "0810000000" });

    expect(res.status).toBe(200);
    expect(mocks.tx.$queryRaw).toHaveBeenCalledBefore(mocks.tx.fournisseur.updateMany);
    expect(mocks.tx.fournisseur.updateMany).toHaveBeenCalledBefore(mocks.auditerCaisseTx);
    expect(mocks.auditerCaisseTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({
        module: "FOURNISSEURS",
        typeEntite: "Fournisseur",
        entiteId: "fournisseur-1",
        action: "MODIFICATION",
      }),
    );
  });

  it("refuse la suppression sous verrou quand des commandes existent", async () => {
    mocks.tx.fournisseur.findUniqueOrThrow.mockResolvedValue(fournisseur(1));

    const res = await request(app()).delete("/api/fournisseurs/fournisseur-1");

    expect(res.status).toBe(409);
    expect(mocks.tx.fournisseur.deleteMany).not.toHaveBeenCalled();
    expect(mocks.auditerCaisseTx).not.toHaveBeenCalled();
  });

  it("supprime via deleteMany puis audite dans la transaction", async () => {
    mocks.tx.fournisseur.findUniqueOrThrow.mockResolvedValue(fournisseur());

    const res = await request(app()).delete("/api/fournisseurs/fournisseur-1");

    expect(res.status).toBe(204);
    expect(mocks.tx.fournisseur.deleteMany).toHaveBeenCalledBefore(mocks.auditerCaisseTx);
    expect(mocks.auditerCaisseTx).toHaveBeenCalledWith(
      mocks.tx,
      expect.objectContaining({ typeEntite: "Fournisseur", action: "SUPPRESSION" }),
    );
  });
});

describe("Commande fournisseur — annulation atomique", () => {
  it("verrouille, supprime puis audite chaque ligne et la commande", async () => {
    mocks.tx.commandeFournisseur.findUniqueOrThrow.mockResolvedValue(commande());

    const res = await request(app()).delete("/api/fournisseurs/commandes/commande-1");

    expect(res.status).toBe(204);
    expect(mocks.tx.$queryRaw).toHaveBeenCalledBefore(mocks.tx.commandeFournisseur.deleteMany);
    expect(mocks.tx.commandeFournisseur.deleteMany).toHaveBeenCalledBefore(mocks.auditerCaisseTx);
    expect(mocks.auditerCaisseTx).toHaveBeenCalledTimes(3);
    expect(mocks.auditerCaisseTx).toHaveBeenLastCalledWith(
      mocks.tx,
      expect.objectContaining({ typeEntite: "CommandeFournisseur", action: "SUPPRESSION" }),
    );
  });

  it("refuse l'annulation d'une commande déjà reçue sans écrire", async () => {
    mocks.tx.commandeFournisseur.findUniqueOrThrow.mockResolvedValue(commande("RECUE"));

    const res = await request(app()).delete("/api/fournisseurs/commandes/commande-1");

    expect(res.status).toBe(409);
    expect(mocks.tx.commandeFournisseur.deleteMany).not.toHaveBeenCalled();
  });
});

describe("Commande fournisseur — réception atomique", () => {
  it("verrouille la commande, trie les matières, écrit les stocks puis le statut et l'audit", async () => {
    mocks.tx.commandeFournisseur.findUniqueOrThrow
      .mockResolvedValueOnce(commande())
      .mockResolvedValueOnce(commande("RECUE"));

    const res = await request(app()).post("/api/fournisseurs/commandes/commande-1/reception");

    expect(res.status).toBe(200);
    expect(mocks.appliquerMouvement).toHaveBeenCalledTimes(2);
    expect(mocks.appliquerMouvement.mock.calls.map((c) => c[1].matierePremiereId)).toEqual([
      "matiere-a",
      "matiere-z",
    ]);
    expect(mocks.tx.$queryRaw).toHaveBeenCalledBefore(mocks.appliquerMouvement);
    expect(mocks.appliquerMouvement).toHaveBeenCalledBefore(mocks.tx.commandeFournisseur.updateMany);
    expect(mocks.tx.commandeFournisseur.updateMany).toHaveBeenCalledBefore(mocks.auditerCaisseTx);
    expect(mocks.emettreEvenement).toHaveBeenCalledTimes(1);
  });

  it("refuse une seconde réception avant tout mouvement", async () => {
    mocks.tx.commandeFournisseur.findUniqueOrThrow.mockResolvedValue(commande("RECUE"));

    const res = await request(app()).post("/api/fournisseurs/commandes/commande-1/reception");

    expect(res.status).toBe(409);
    expect(mocks.appliquerMouvement).not.toHaveBeenCalled();
    expect(mocks.tx.commandeFournisseur.updateMany).not.toHaveBeenCalled();
    expect(mocks.emettreEvenement).not.toHaveBeenCalled();
  });

  it("n'émet aucun événement quand l'audit échoue", async () => {
    mocks.tx.commandeFournisseur.findUniqueOrThrow
      .mockResolvedValueOnce(commande())
      .mockResolvedValueOnce(commande("RECUE"));
    mocks.auditerCaisseTx.mockRejectedValueOnce(new Error("audit indisponible"));

    const res = await request(app()).post("/api/fournisseurs/commandes/commande-1/reception");

    expect(res.status).toBe(500);
    expect(mocks.appliquerMouvement).toHaveBeenCalled();
    expect(mocks.emettreEvenement).not.toHaveBeenCalled();
  });
});
