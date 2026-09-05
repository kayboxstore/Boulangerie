import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  bonLivraisonLigne: { groupBy: vi.fn() },
  produit: { findMany: vi.fn() },
  commandeClient: { aggregate: vi.fn() },
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    $queryRaw: mocks.$queryRaw,
    bonLivraisonLigne: mocks.bonLivraisonLigne,
    produit: mocks.produit,
    commandeClient: mocks.commandeClient,
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = { id: "dg-1" } as express.Request["utilisateur"];
    next();
  },
  requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { rapportsRouter } from "./rapports.js";

function app() {
  const application = express();
  application.use(express.json());
  application.use(rapportsRouter);
  return application;
}

beforeEach(() => vi.clearAllMocks());

// Widget « Marge par produit » (3.8, resté en suspens) — pas une vraie marge :
// volume livré (BonLivraisonLigne) × prix catalogue COURANT, jamais un montant
// réellement facturé. Ces tests verrouillent le calcul, le tri décroissant et
// le repli sur 30 jours si ?jours n'est ni 7 ni 30.
describe("GET /marge-produit", () => {
  it("calcule le CA estimé (quantité livrée × prixVente) et trie par CA décroissant", async () => {
    mocks.bonLivraisonLigne.groupBy.mockResolvedValue([
      { produitId: "baguette", _sum: { quantite: 20 } },
      { produitId: "carre", _sum: { quantite: 19 } },
    ]);
    mocks.produit.findMany.mockResolvedValue([
      { id: "baguette", nom: "Baguette 500 Fc", prixVente: 500 },
      { id: "carre", nom: "Carré 1.500 Fc", prixVente: 1500 },
    ]);

    const res = await request(app()).get("/marge-produit");

    expect(res.status).toBe(200);
    expect(res.body.jours).toBe(30);
    expect(res.body.produits).toEqual([
      { produitId: "carre", nom: "Carré 1.500 Fc", quantiteLivree: 19, caEstime: 28500 },
      { produitId: "baguette", nom: "Baguette 500 Fc", quantiteLivree: 20, caEstime: 10000 },
    ]);
  });

  it("accepte ?jours=7 mais retombe sur 30 pour toute autre valeur", async () => {
    mocks.bonLivraisonLigne.groupBy.mockResolvedValue([]);
    mocks.produit.findMany.mockResolvedValue([]);

    const res7 = await request(app()).get("/marge-produit?jours=7");
    expect(res7.body.jours).toBe(7);

    const resInvalide = await request(app()).get("/marge-produit?jours=15");
    expect(resInvalide.body.jours).toBe(30);
  });

  it("ignore une ligne de volume dont le produit a été supprimé depuis (pas de plantage)", async () => {
    mocks.bonLivraisonLigne.groupBy.mockResolvedValue([{ produitId: "supprime", _sum: { quantite: 5 } }]);
    mocks.produit.findMany.mockResolvedValue([]);

    const res = await request(app()).get("/marge-produit");

    expect(res.status).toBe(200);
    expect(res.body.produits).toEqual([]);
  });
});

// Tendances historiques (v2) — granularité validée contre une liste blanche de
// 3 valeurs exactes (jour/semaine/mois) avant d'être injectée dans date_trunc
// via Prisma.raw ; toute autre valeur retombe silencieusement sur "jour".
describe("GET /tendances", () => {
  it("reshape les lignes SQL en séries CA/bacs et regroupe le volume par produit et par période", async () => {
    mocks.$queryRaw
      .mockResolvedValueOnce([
        { periode: new Date("2026-09-04T00:00:00.000Z"), ca: 10000n, bacs: 5n },
        { periode: new Date("2026-08-28T00:00:00.000Z"), ca: 4000n, bacs: 2n },
      ])
      .mockResolvedValueOnce([
        { periode: new Date("2026-09-04T00:00:00.000Z"), produitId: "carre", quantite: 12n },
        { periode: new Date("2026-09-04T00:00:00.000Z"), produitId: "baguette", quantite: 20n },
        { periode: new Date("2026-08-27T00:00:00.000Z"), produitId: "carre", quantite: 7n },
      ]);
    mocks.produit.findMany.mockResolvedValue([{ id: "carre", nom: "Carré 1.500 Fc" }]);

    const res = await request(app()).get("/tendances");

    expect(res.status).toBe(200);
    expect(res.body.granularite).toBe("jour");
    expect(res.body.ca).toEqual([
      { periode: "2026-09-04", total: 10000 },
      { periode: "2026-08-28", total: 4000 },
    ]);
    expect(res.body.bacs).toEqual([
      { periode: "2026-09-04", total: 5 },
      { periode: "2026-08-28", total: 2 },
    ]);
    expect(res.body.volumeParProduit).toEqual([
      { periode: "2026-08-27", produits: [{ produitId: "carre", quantite: 7 }] },
      {
        periode: "2026-09-04",
        produits: [
          { produitId: "carre", quantite: 12 },
          { produitId: "baguette", quantite: 20 },
        ],
      },
    ]);
    expect(res.body.produitsCatalogue).toEqual([{ id: "carre", nom: "Carré 1.500 Fc" }]);
  });

  it("retombe sur la granularité 'jour' si ?granularite n'est pas une des 3 valeurs valides", async () => {
    mocks.$queryRaw.mockResolvedValue([]);
    mocks.produit.findMany.mockResolvedValue([]);

    const res = await request(app()).get("/tendances?granularite=annee");

    expect(res.status).toBe(200);
    expect(res.body.granularite).toBe("jour");
  });

  it("accepte 'semaine' et 'mois' et les répercute telles quelles dans la réponse", async () => {
    mocks.$queryRaw.mockResolvedValue([]);
    mocks.produit.findMany.mockResolvedValue([]);

    const resSemaine = await request(app()).get("/tendances?granularite=semaine");
    expect(resSemaine.body.granularite).toBe("semaine");

    const resMois = await request(app()).get("/tendances?granularite=mois");
    expect(resMois.body.granularite).toBe("mois");
  });
});

// Projection (v2) — simple heuristique statistique, jamais un modèle prédictif :
// moyenne mobile sur 7 jours complets (aujourd'hui exclu) + comparaison au
// même jour la semaine précédente. Ces tests verrouillent les deux calculs
// avec les mêmes chiffres que la vérification manuelle sur données réelles.
describe("GET /projection", () => {
  it("calcule la moyenne mobile 7 jours et la variation en pourcentage vs même jour la semaine dernière", async () => {
    // 7 derniers jours complets : seul "hier" (10000 Fc / 5 bacs) contribue.
    mocks.commandeClient.aggregate
      .mockResolvedValueOnce({ _sum: { montantBrut: 10000, quantiteBacs: 5 } }) // fenêtre 7 jours
      .mockResolvedValueOnce({ _sum: { montantBrut: 10000, quantiteBacs: 5 } }) // hier (joursAvant=1)
      .mockResolvedValueOnce({ _sum: { montantBrut: 4000, quantiteBacs: 2 } }); // il y a 8 jours

    const res = await request(app()).get("/projection");

    expect(res.status).toBe(200);
    expect(res.body.moyenneMobile7JoursCa).toBe(1429); // Math.round(10000/7)
    expect(res.body.moyenneMobile7JoursBacs).toBe(1); // Math.round(5/7)
    expect(res.body.comparaisonCa.valeurReference).toBe(10000);
    expect(res.body.comparaisonCa.valeurComparaison).toBe(4000);
    expect(res.body.comparaisonCa.variationPourcent).toBe(150);
    expect(res.body.comparaisonBacs.variationPourcent).toBe(150);
  });

  it("renvoie une variation null plutôt qu'une division par zéro si le jour de comparaison est à zéro", async () => {
    mocks.commandeClient.aggregate
      .mockResolvedValueOnce({ _sum: { montantBrut: 0, quantiteBacs: 0 } })
      .mockResolvedValueOnce({ _sum: { montantBrut: 5000, quantiteBacs: 3 } })
      .mockResolvedValueOnce({ _sum: { montantBrut: 0, quantiteBacs: 0 } });

    const res = await request(app()).get("/projection");

    expect(res.body.comparaisonCa.variationPourcent).toBeNull();
    expect(res.body.comparaisonBacs.variationPourcent).toBeNull();
  });
});
