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
});
