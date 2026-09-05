import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("sécurité HTTP de l’API", () => {
  it("ajoute les en-têtes de sécurité et un identifiant de requête serveur", async () => {
    const res = await request(createApp())
      .get("/api/health")
      .set("X-Request-Id", "identifiant-controle-par-le-client");

    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers["x-request-id"]).not.toBe("identifiant-controle-par-le-client");
  });

  it("renvoie une erreur 404 corrélable sans détail interne", async () => {
    const res = await request(createApp()).get("/api/route-inexistante");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      erreur: "Ressource introuvable",
      code: "RESSOURCE_INTROUVABLE",
      idRequete: res.headers["x-request-id"],
    });
  });

  it("limite les demandes répétées de récupération, même invalides", async () => {
    const app = createApp();

    for (let tentative = 0; tentative < 5; tentative += 1) {
      const res = await request(app)
        .post("/api/auth/mot-de-passe-oublie")
        .send({ email: "adresse-invalide" });
      expect(res.status).toBe(400);
    }

    const bloquee = await request(app)
      .post("/api/auth/mot-de-passe-oublie")
      .send({ email: "adresse-invalide" });
    expect(bloquee.status).toBe(429);
    expect(bloquee.body.code).toBe("TROP_DE_REQUETES");
  });

  it("limite les tentatives répétées de connexion", async () => {
    const app = createApp();

    for (let tentative = 0; tentative < 10; tentative += 1) {
      const res = await request(app).post("/api/auth/login").send({});
      expect(res.status).toBe(400);
    }

    const bloquee = await request(app).post("/api/auth/login").send({});
    expect(bloquee.status).toBe(429);
    expect(bloquee.body.code).toBe("TROP_DE_REQUETES");
    expect(bloquee.body.idRequete).toBe(bloquee.headers["x-request-id"]);
  });

  // Non-régression d'un vrai bug de production (trouvé via les logs Render,
  // idRequete 536a13c1...) : le CORS permissif de /api/public était enregistré
  // APRÈS le CORS strict global — ce dernier rejetait la requête (il appelle
  // son callback avec une erreur, ce qui court-circuite Express) avant que le
  // permissif n'ait la moindre chance de s'exécuter. Un test qui appelle
  // seulement demandesCommandePubliquesRouter en isolation (voir
  // demandesCommandePubliques.test.ts) ne peut PAS attraper ce genre de bug
  // d'ordre : il faut la vraie chaîne de app.ts, via createApp().
  describe("CORS de /api/public/* (site vitrine, origine différente de l'app de gestion)", () => {
    const ORIGINE_SITE_VITRINE = "https://boulangerie-lomoto-site.vercel.app";

    it("une origine étrangère à l'app de gestion N'EST PAS rejetée par CORS sur /api/public", async () => {
      const res = await request(createApp())
        .post("/api/public/demandes-commande/identifier")
        .set("Origin", ORIGINE_SITE_VITRINE)
        .send({ telephone: "+000000000" });

      // Peu importe que ce téléphone corresponde à un client (404 probable
      // en base de test vide) — l'assertion porte sur l'ABSENCE de rejet
      // CORS, jamais vu ici comme une erreur 500 "Origine non autorisée".
      expect(res.status).not.toBe(500);
      expect(res.body?.erreur).not.toBe("Origine non autorisée");
      expect(res.headers["access-control-allow-origin"]).toBeTruthy();
    });

    it("la même origine étrangère reste bien rejetée sur une route interne authentifiée, en production", async () => {
      // verifierOrigine reste volontairement permissif hors production (voir
      // origines.test.ts) — sans ce réglage explicite, ce test donnerait un
      // faux négatif ici, pas parce que la séparation public/interne aurait
      // un défaut.
      const precedent = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const res = await request(createApp()).get("/api/commandes").set("Origin", ORIGINE_SITE_VITRINE);
        expect(res.headers["access-control-allow-origin"]).not.toBe(ORIGINE_SITE_VITRINE);
      } finally {
        process.env.NODE_ENV = precedent;
      }
    });
  });
});
