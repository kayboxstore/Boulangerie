/**
 * Preuve HTTP (P0, correctif Codex round 2, 30/08/2026) que la barrière
 * d'écriture ne s'auto-bloque plus sur sa propre route de déclenchement.
 *
 * Défaut initial : `gardeBarriereEcriture` comptait
 * `POST /api/etat-systeme/reinitialiser` comme écriture « en vol » ; la
 * requête appelait ensuite `reinitialiserBase()`, qui activait la barrière
 * et attendait que ce MÊME compteur retombe à zéro — auto-blocage garanti,
 * résolu seulement après le timeout de drainage (503). Le round suivant
 * couvre aussi les formes équivalentes réellement acceptées par Express
 * (barre finale et casse différente), que l'ancienne égalité sur req.path
 * comptait encore par erreur.
 *
 * Utilise délibérément `createApp()` (le VRAI app.ts, avec le VRAI
 * `gardeBarriereEcriture` monté en middleware global, le VRAI `requireAuth`/
 * `requirePermission`) plutôt qu'un routeur isolé — un test montant
 * uniquement `etatSystemeRouter` ne prouverait pas que le montage GLOBAL
 * (l'ordre exact des middlewares dans app.ts) fonctionne. Seul Prisma est
 * mocké (jamais de vraie base ici) ; la preuve contre une vraie base
 * PostgreSQL est apportée séparément par
 * `scripts/verifier-sauvegarde-reinitialisation-ci.ts`.
 */
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  construireDump: vi.fn(),
  validerDump: vi.fn(),
  ecrireSauvegardeLocale: vi.fn(),
  sauvegardeBaseCreate: vi.fn(),
  transaction: vi.fn(),
  utilisateurFindUnique: vi.fn(),
  delegationRoleFindMany: vi.fn(),
}));

vi.mock("./services/sauvegarde.js", async (importOriginal) => {
  const reel = await importOriginal<typeof import("./services/sauvegarde.js")>();
  return { ...reel, construireDump: mocks.construireDump, validerDump: mocks.validerDump };
});

vi.mock("./lib/realtime.js", () => ({
  getIo: () => ({ emit: vi.fn(), disconnectSockets: vi.fn() }),
  invaliderSessionUtilisateur: vi.fn(),
  roomUtilisateur: (id: string) => `user:${id}`,
  roomRole: (id: string) => `role:${id}`,
}));

vi.mock("./services/sauvegardeLocale.js", () => ({
  ecrireSauvegardeLocale: mocks.ecrireSauvegardeLocale,
  repertoireLocal: () => "/tmp/lomoto-test",
  retentionLocale: () => 14,
  lireSauvegardeLocale: vi.fn(),
}));

const UTILISATEUR_ADMIN = {
  id: "admin-1",
  nom: "Admin Principal Test",
  email: "admin-test@lomoto.test",
  actif: true,
  estAdminPrincipal: true,
  motDePasseDoitChanger: false,
  sessionActuelleId: "sid-test",
  languePreferee: null,
  role: { id: "role-admin", nom: "Administrateur", permissions: [] },
};

function modeleGenerique() {
  return { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) };
}

vi.mock("./lib/prisma.js", () => ({
  prisma: new Proxy(
    {
      utilisateur: { findUnique: mocks.utilisateurFindUnique, ...modeleGenerique() },
      delegationRole: { findMany: mocks.delegationRoleFindMany, ...modeleGenerique() },
      sauvegardeBase: { create: mocks.sauvegardeBaseCreate, ...modeleGenerique() },
      $transaction: mocks.transaction,
    } as Record<string, unknown>,
    {
      get: (target, prop: string) => {
        if (!(prop in target)) target[prop] = modeleGenerique();
        return target[prop];
      },
    },
  ),
}));

const { createApp } = await import("./app.js");
const { signToken } = await import("./lib/jwt.js");
const { barriereReinitialisationActive, ecrituresEnVol, reinitialiserBarrierePourTests } = await import(
  "./lib/barriereEcriture.js"
);

function jetonAdmin() {
  return signToken({ sub: UTILISATEUR_ADMIN.id, sid: UTILISATEUR_ADMIN.sessionActuelleId, roleId: UTILISATEUR_ADMIN.role.id });
}

beforeEach(() => {
  mocks.utilisateurFindUnique.mockResolvedValue(UTILISATEUR_ADMIN);
  mocks.delegationRoleFindMany.mockResolvedValue([]);
  mocks.construireDump.mockResolvedValue(Buffer.from("dump-factice"));
  mocks.validerDump.mockResolvedValue(undefined);
  mocks.ecrireSauvegardeLocale.mockResolvedValue("/tmp/lomoto-test/lomoto-x.dump");
  mocks.sauvegardeBaseCreate.mockResolvedValue({ id: "sauv-1" });
  mocks.transaction.mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
  reinitialiserBarrierePourTests();
});

describe("POST /api/etat-systeme/reinitialiser via createApp() — plus d'auto-blocage", () => {
  it("répond avec succès RAPIDEMENT (pas après le délai de drainage) — preuve que la requête ne s'attend plus elle-même", async () => {
    const app = createApp();
    const t0 = Date.now();
    const reponse = await request(app)
      .post("/api/etat-systeme/reinitialiser")
      .set("Authorization", `Bearer ${jetonAdmin()}`)
      .send({ motConfirmation: "LOMOTO" });
    const duree = Date.now() - t0;

    expect(reponse.status).toBe(200);
    expect(reponse.body).toMatchObject({ ok: true, sauvegardeId: "sauv-1" });
    // L'auto-blocage aurait fait attendre le timeout de drainage (15s par
    // défaut) avant un 503 — une réponse largement sous la seconde prouve
    // que la requête ne s'est jamais comptée elle-même.
    expect(duree).toBeLessThan(2_000);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(barriereReinitialisationActive()).toBe(false);
    expect(ecrituresEnVol()).toBe(0);
  }, 10_000);

  it.each([
    "/api/etat-systeme/reinitialiser/",
    "/API/ETAT-SYSTEME/REINITIALISER",
  ])("reconnaît la variante Express %s sans auto-blocage", async (chemin) => {
    const app = createApp();
    const t0 = Date.now();
    const reponse = await request(app)
      .post(chemin)
      .set("Authorization", `Bearer ${jetonAdmin()}`)
      .send({ motConfirmation: "LOMOTO" });

    expect(reponse.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(barriereReinitialisationActive()).toBe(false);
    expect(ecrituresEnVol()).toBe(0);
  }, 10_000);

  it("n'exempte pas une autre méthode sur le même chemin", async () => {
    const app = createApp();
    const { crochetsTestBarriere } = await import("./lib/barriereEcriture.js");
    let increments = 0;
    crochetsTestBarriere.apresIncrementAvantExecution = () => {
      increments++;
    };

    const reponse = await request(app)
      .put("/api/etat-systeme/reinitialiser")
      .set("Authorization", `Bearer ${jetonAdmin()}`)
      .send({ motConfirmation: "LOMOTO" });

    expect(reponse.status).toBe(404);
    expect(increments).toBe(1);
    expect(ecrituresEnVol()).toBe(0);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("deux réinitialisations simultanées : au plus une exécution, l'autre refusée proprement (entrelacement déterministe, pas un espoir de chevauchement)", async () => {
    const app = createApp();
    const { crochetsTestBarriere } = await import("./lib/barriereEcriture.js");

    // Porte manuelle : la requête A s'arrête juste après avoir activé la
    // barrière (barriereActive=true), AVANT de continuer — le temps que la
    // requête B soit envoyée et observe cette barrière déjà active. Aucun
    // délai arbitraire : B n'est envoyée qu'une fois qu'on SAIT que A a déjà
    // franchi ce point précis.
    let debloquerA!: () => void;
    const porte = new Promise<void>((resolve) => {
      debloquerA = resolve;
    });
    crochetsTestBarriere.apresActivationAvantDrainage = () => porte;

    // `.then()` déclenche l'envoi RÉEL de la requête HTTP dès cette ligne
    // (superagent/supertest sont lazy : tant que ni `.end()` ni `.then()` ne
    // sont appelés, aucune requête ne part sur le réseau — une simple
    // affectation à une variable, sans plus, ne suffit PAS à la déclencher).
    // Sans ce `.then()` immédiat, la requête A ne partirait qu'au moment du
    // `await pReponseA` final, bien APRÈS que `vi.waitFor` ait déjà abandonné
    // faute de voir la barrière s'activer.
    const pReponseA = request(app)
      .post("/api/etat-systeme/reinitialiser")
      .set("Authorization", `Bearer ${jetonAdmin()}`)
      .send({ motConfirmation: "LOMOTO" })
      .then((r) => r);

    // Attend que A ait RÉELLEMENT activé la barrière avant d'envoyer B.
    await vi.waitFor(() => {
      if (!barriereReinitialisationActive()) throw new Error("barrière pas encore active");
    });

    const reponseB = await request(app)
      .post("/api/etat-systeme/reinitialiser")
      .set("Authorization", `Bearer ${jetonAdmin()}`)
      .send({ motConfirmation: "LOMOTO" });

    // B doit être refusée MAINTENANT, pendant que A est toujours en pause —
    // preuve que ce n'est pas une histoire de timing chanceux.
    expect([409, 503]).toContain(reponseB.status);
    expect(mocks.transaction).not.toHaveBeenCalled();

    debloquerA();
    const reponseA = await pReponseA;

    expect(reponseA.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(barriereReinitialisationActive()).toBe(false);
  }, 10_000);

  it("aucune autre route ne bénéficie de l'exception — une requête GET normale reste comptée pendant la barrière", async () => {
    const app = createApp();
    // Active la barrière manuellement (hors reinitialiserBase, pour isoler le test).
    const { activerBarriereEtAttendreDrainage, abaisserBarriere } = await import("./lib/barriereEcriture.js");
    await activerBarriereEtAttendreDrainage();
    const reponse = await request(app)
      .get("/api/etat-systeme/")
      .set("Authorization", `Bearer ${jetonAdmin()}`);
    expect(reponse.status).toBe(503);
    expect(reponse.body.code).toBe("REINITIALISATION_EN_COURS");
    abaisserBarriere();
  });
});
