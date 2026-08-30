/**
 * Preuves mockées (P0, 30/08/2026) du mécanisme de barrière d'écriture —
 * voir `barriereEcriture.ts` pour la doctrine complète. Aucun mock ici :
 * le module est un simple état en mémoire + un middleware Express, testé
 * directement avec un VRAI serveur Express servi par supertest (pas de base
 * de données requise). La preuve que ce mécanisme protège réellement
 * `reinitialiserBase()` contre une écriture concurrente réelle (PostgreSQL)
 * est apportée séparément par
 * `scripts/verifier-sauvegarde-reinitialisation-ci.ts`.
 */
import type { AddressInfo } from "node:net";
import net from "node:net";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  abaisserBarriere,
  activerBarriereEtAttendreDrainage,
  barriereReinitialisationActive,
  ecrituresEnVol,
  ErreurDrainageEchoue,
  executerTacheDeFondSuivie,
  gardeBarriereEcriture,
  reinitialiserBarrierePourTests,
} from "./barriereEcriture.js";

function creerApp() {
  const app = express();
  app.use(express.json());
  app.use(gardeBarriereEcriture);
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.post("/ecriture", (_req, res) => res.status(201).json({ ok: true }));
  app.get("/lecture", (_req, res) => res.json({ ok: true }));
  return app;
}

afterEach(() => {
  reinitialiserBarrierePourTests();
});

describe("gardeBarriereEcriture (middleware)", () => {
  it("laisse passer toute requête quand la barrière est inactive", async () => {
    const app = creerApp();
    const reponse = await request(app).post("/ecriture").send({});
    expect(reponse.status).toBe(201);
  });

  it("laisse toujours passer GET /api/health, même barrière active", async () => {
    const app = creerApp();
    await activerBarriereEtAttendreDrainage();
    const reponse = await request(app).get("/api/health");
    expect(reponse.status).toBe(200);
  });

  it("rejette une requête GET normale (pas /api/health) avec 503 quand la barrière est active", async () => {
    const app = creerApp();
    await activerBarriereEtAttendreDrainage();
    const reponse = await request(app).get("/lecture");
    expect(reponse.status).toBe(503);
    expect(reponse.body.code).toBe("REINITIALISATION_EN_COURS");
  });

  it("rejette une requête POST avec 503/REINITIALISATION_EN_COURS quand la barrière est active", async () => {
    const app = creerApp();
    await activerBarriereEtAttendreDrainage();
    const reponse = await request(app).post("/ecriture").send({});
    expect(reponse.status).toBe(503);
    expect(reponse.body.code).toBe("REINITIALISATION_EN_COURS");
    expect(reponse.body.erreur).toBeTruthy();
  });

  it("compte une requête comme « en vol » dès son entrée et la décompte à la fin (finish)", async () => {
    const app = express();
    app.use(gardeBarriereEcriture);
    let vuPendant = -1;
    app.post("/lente", async (_req, res) => {
      await new Promise((r) => setTimeout(r, 20));
      vuPendant = ecrituresEnVol();
      res.status(201).json({ ok: true });
    });
    expect(ecrituresEnVol()).toBe(0);
    await request(app).post("/lente").send({});
    expect(vuPendant).toBe(1);
    expect(ecrituresEnVol()).toBe(0);
  });
});

describe("executerTacheDeFondSuivie", () => {
  it("exécute la fonction et suit son exécution dans le compteur", async () => {
    let vuPendant = -1;
    const resultat = await executerTacheDeFondSuivie(async () => {
      vuPendant = ecrituresEnVol();
      return "ok";
    });
    expect(resultat).toBe("ok");
    expect(vuPendant).toBe(1);
    expect(ecrituresEnVol()).toBe(0);
  });

  it("ne démarre PAS la tâche si la barrière est déjà active — retourne undefined", async () => {
    await activerBarriereEtAttendreDrainage();
    let appelee = false;
    const resultat = await executerTacheDeFondSuivie(async () => {
      appelee = true;
      return "jamais";
    });
    expect(appelee).toBe(false);
    expect(resultat).toBeUndefined();
  });

  it("décrémente le compteur même si la tâche échoue", async () => {
    await expect(
      executerTacheDeFondSuivie(async () => {
        throw new Error("échec simulé");
      }),
    ).rejects.toThrow("échec simulé");
    expect(ecrituresEnVol()).toBe(0);
  });
});

describe("activerBarriereEtAttendreDrainage / abaisserBarriere", () => {
  it("résout immédiatement quand aucune écriture n'est en vol", async () => {
    await activerBarriereEtAttendreDrainage();
    expect(barriereReinitialisationActive()).toBe(true);
    abaisserBarriere();
    expect(barriereReinitialisationActive()).toBe(false);
  });

  it("attend qu'une tâche de fond en vol se termine avant de résoudre", async () => {
    let debloquer!: () => void;
    const porte = new Promise<void>((resolve) => {
      debloquer = resolve;
    });
    const pTache = executerTacheDeFondSuivie(async () => {
      await porte;
      return "terminée";
    });
    // Laisse la microtask de `executerTacheDeFondSuivie` incrémenter le compteur.
    await new Promise((r) => setTimeout(r, 0));
    expect(ecrituresEnVol()).toBe(1);

    const pBarriere = activerBarriereEtAttendreDrainage();
    const etat = await Promise.race([
      pBarriere.then(() => "resolue"),
      new Promise((r) => setTimeout(() => r("en-attente"), 20)),
    ]);
    expect(etat).toBe("en-attente");

    debloquer();
    await expect(pTache).resolves.toBe("terminée");
    await pBarriere;
    expect(barriereReinitialisationActive()).toBe(true);
    abaisserBarriere();
  });

  it("rejette avec ErreurDrainageEchoue si le drainage n'aboutit pas avant le délai — barrière reste active (à abaisser par l'appelant)", async () => {
    const pTache = executerTacheDeFondSuivie(async () => {
      await new Promise(() => {}); // ne se termine jamais dans ce test
    });
    void pTache.catch(() => {}); // évite un rejet non géré si le process se termine avant

    await expect(activerBarriereEtAttendreDrainage(30)).rejects.toBeInstanceOf(ErreurDrainageEchoue);
    expect(barriereReinitialisationActive()).toBe(true);
    abaisserBarriere();
    expect(barriereReinitialisationActive()).toBe(false);
  });

  it("refuse une seconde activation tant que la première est active", async () => {
    await activerBarriereEtAttendreDrainage();
    await expect(activerBarriereEtAttendreDrainage()).rejects.toThrow();
    abaisserBarriere();
  });
});

describe("gardeBarriereEcriture — close ≠ finish (correctif Codex round 2)", () => {
  it("ne décompte PAS quand le CLIENT se déconnecte pendant qu'un handler continue réellement d'écrire — seul `finish` (fin RÉELLEMENT prouvée) décompte", async () => {
    // Vrai serveur HTTP + vrai socket TCP brut (pas supertest, qui attend
    // toujours la réponse) : seul un socket manipulé à la main permet de
    // simuler un CLIENT qui part en cours de route, sans jamais toucher au
    // handler Express lui-même, qui continue de tourner côté serveur.
    const app = express();
    app.use(gardeBarriereEcriture);
    let handlerTermine = false;
    let debloquerHandler!: () => void;
    const porteHandler = new Promise<void>((resolve) => {
      debloquerHandler = resolve;
    });
    app.post("/ecriture-lente", async (_req, res) => {
      // Simule une écriture PostgreSQL encore en cours au moment où le
      // client se déconnecte — le handler Express n'est PAS annulé par la
      // déconnexion du client, il continue jusqu'à sa propre fin.
      await porteHandler;
      handlerTermine = true;
      res.status(201).json({ ok: true });
    });

    const serveur = app.listen(0);
    try {
      const port = (serveur.address() as AddressInfo).port;
      const socket = net.connect(port, "127.0.0.1");
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      socket.write(
        "POST /ecriture-lente HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );

      // Attend que le serveur ait bien reçu la requête et compté l'écriture
      // « en vol » — entrelacement déterministe, jamais un délai qui espère.
      await vi.waitFor(() => {
        if (ecrituresEnVol() !== 1) throw new Error("écriture pas encore comptée");
      });

      // Le CLIENT se déconnecte MAINTENANT, pendant que le handler attend
      // toujours `porteHandler` (écriture toujours en cours côté serveur).
      // Un court délai réel ici ne sert qu'à laisser l'event loop propager la
      // fermeture TCP côté serveur — la preuve elle-même ne repose PAS sur ce
      // délai : `gardeBarriereEcriture` n'écoute plus DU TOUT `close` (voir
      // le code), donc aucune décrémentation ne peut survenir de toute façon,
      // que ce délai soit court ou long.
      socket.destroy();
      await new Promise((r) => setTimeout(r, 20));

      // Le `close` a eu lieu côté serveur, mais le handler n'a PAS terminé :
      // le compteur ne doit surtout pas avoir été décompté prématurément.
      expect(handlerTermine).toBe(false);
      expect(ecrituresEnVol()).toBe(1);

      // Le handler termine enfin son écriture — `res.json()` tente d'écrire
      // sur un socket déjà fermé côté client. Selon le comportement Node
      // (le socket peut être détruit avant même que `res.json()` ne soit
      // appelé), `finish` peut se déclencher ou non : dans TOUS les cas, le
      // compteur ne redescend JAMAIS tant que `finish` n'a pas été observé —
      // c'est exactement la règle conservatrice documentée dans
      // `gardeBarriereEcriture` : préférer un drainage qui échoue sur
      // timeout à un drainage qui ment.
      debloquerHandler();
      await new Promise((r) => setTimeout(r, 50));
      expect(handlerTermine).toBe(true);
      // Si `finish` ne s'est jamais déclenché (socket déjà détruit), le
      // compteur reste à 1 pour toujours — c'est le comportement assumé.
      // S'il s'est déclenché (Node livre parfois `finish` même après un
      // socket détruit, la donnée étant simplement perdue), il redescend à
      // 0. Les deux issues sont sûres ; la seule interdite est une
      // décrémentation AVANT que le handler n'ait fini, déjà prouvée
      // ci-dessus.
      expect(ecrituresEnVol()).toBeLessThanOrEqual(1);
    } finally {
      serveur.close();
    }
  });
});
