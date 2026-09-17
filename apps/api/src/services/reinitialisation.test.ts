/**
 * Preuves mockées (P0, 30/08/2026) de l'orchestration de `reinitialiserBase` :
 * désactivation par défaut en production, activation contrôlée explicite,
 * libération de la barrière après succès ET après échec à chaque étape de
 * sûreté, et absence totale d'effacement (transaction jamais appelée) si la
 * génération, la validation ou l'écriture du dump échoue.
 *
 * Convention : mock des SERVICES `./sauvegarde.js`/`./sauvegardeLocale.js`
 * et du client Prisma (jamais une vraie base ici) — la preuve PostgreSQL
 * réelle de bout en bout (sauvegarde, effacement, restauration, écriture
 * concurrente) est apportée séparément par
 * `scripts/verifier-sauvegarde-reinitialisation-ci.ts`. La barrière
 * d'écriture (`lib/barriereEcriture.ts`), elle, est utilisée RÉELLE (pas
 * mockée) : c'est un simple état en mémoire, et vérifier qu'elle est bien
 * levée/abaissée par ce code est précisément ce que ces tests prouvent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abaisserBarriere, activerBarriereEtAttendreDrainage, barriereReinitialisationActive } from "../lib/barriereEcriture.js";

const mocks = vi.hoisted(() => ({
  construireDump: vi.fn(),
  validerDump: vi.fn(),
  ecrireSauvegardeLocale: vi.fn(),
  sauvegardeBaseCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("./sauvegarde.js", async (importOriginal) => {
  const reel = await importOriginal<typeof import("./sauvegarde.js")>();
  return { ...reel, construireDump: mocks.construireDump, validerDump: mocks.validerDump };
});

vi.mock("./sauvegardeLocale.js", () => ({
  ecrireSauvegardeLocale: mocks.ecrireSauvegardeLocale,
  repertoireLocal: vi.fn(() => "/tmp/lomoto-test"),
  retentionLocale: vi.fn(() => 14),
  lireSauvegardeLocale: vi.fn(),
}));

function modeleGenerique() {
  return { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) };
}

vi.mock("../lib/prisma.js", () => ({
  prisma: new Proxy(
    { sauvegardeBase: { create: mocks.sauvegardeBaseCreate }, $transaction: mocks.transaction } as Record<string, unknown>,
    {
      get: (target, prop: string) => {
        if (!(prop in target)) target[prop] = modeleGenerique();
        return target[prop];
      },
    },
  ),
}));

const { reinitialiserBase, ErreurReinitialisation, VARIABLE_AUTORISATION_PRODUCTION } = await import("./reinitialisation.js");
const { ErreurSauvegarde } = await import("./sauvegarde.js");

const nodeEnvOriginal = process.env.NODE_ENV;
const autorisationOriginale = process.env[VARIABLE_AUTORISATION_PRODUCTION];

afterEach(() => {
  vi.clearAllMocks();
  process.env.NODE_ENV = nodeEnvOriginal;
  if (autorisationOriginale === undefined) delete process.env[VARIABLE_AUTORISATION_PRODUCTION];
  else process.env[VARIABLE_AUTORISATION_PRODUCTION] = autorisationOriginale;
  if (barriereReinitialisationActive()) abaisserBarriere(); // filet en cas d'assertion échouée avant nettoyage
});

function armerSuccesComplet() {
  mocks.construireDump.mockResolvedValue(Buffer.from("dump-factice"));
  mocks.validerDump.mockResolvedValue(undefined);
  mocks.ecrireSauvegardeLocale.mockResolvedValue("/tmp/lomoto-test/lomoto-x.dump");
  mocks.sauvegardeBaseCreate.mockResolvedValue({ id: "sauv-1" });
  mocks.transaction.mockResolvedValue([]);
}

describe("reinitialiserBase — désactivation en production", () => {
  it("refuse par défaut en production (403, code explicite), sans toucher au dump ni à la transaction", async () => {
    process.env.NODE_ENV = "production";
    delete process.env[VARIABLE_AUTORISATION_PRODUCTION];

    await expect(reinitialiserBase(undefined)).rejects.toMatchObject({
      status: 403,
      code: "REINITIALISATION_DESACTIVEE_PRODUCTION",
    });
    expect(mocks.construireDump).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(barriereReinitialisationActive()).toBe(false);
  });

  it("accepte en production avec la variable d'autorisation EXPLICITE (activation contrôlée)", async () => {
    process.env.NODE_ENV = "production";
    process.env[VARIABLE_AUTORISATION_PRODUCTION] = "true";
    armerSuccesComplet();

    const resultat = await reinitialiserBase("raison de test");
    expect(resultat).toEqual({ sauvegardeId: "sauv-1" });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(barriereReinitialisationActive()).toBe(false);
  });

  it("une valeur différente de \"true\" (ex. \"1\" ou \"vrai\") ne suffit pas à autoriser", async () => {
    process.env.NODE_ENV = "production";
    process.env[VARIABLE_AUTORISATION_PRODUCTION] = "1";
    await expect(reinitialiserBase(undefined)).rejects.toMatchObject({ status: 403 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});

describe("reinitialiserBase — hors production (environnement de développement/CI par défaut)", () => {
  it("procède normalement sans variable d'autorisation quand NODE_ENV n'est pas production", async () => {
    process.env.NODE_ENV = "test";
    delete process.env[VARIABLE_AUTORISATION_PRODUCTION];
    armerSuccesComplet();

    await expect(reinitialiserBase(undefined)).resolves.toEqual({ sauvegardeId: "sauv-1" });
    expect(barriereReinitialisationActive()).toBe(false);
  });
});

describe("reinitialiserBase — aucune écriture de succès si une étape de sûreté échoue", () => {
  beforeEachHorsProduction();

  it("pg_dump échoue : ErreurReinitialisation 503, transaction JAMAIS appelée, barrière abaissée", async () => {
    mocks.construireDump.mockRejectedValue(new ErreurSauvegarde(503, "pg_dump a échoué"));

    await expect(reinitialiserBase(undefined)).rejects.toMatchObject({ status: 503 });
    expect(mocks.validerDump).not.toHaveBeenCalled();
    expect(mocks.ecrireSauvegardeLocale).not.toHaveBeenCalled();
    expect(mocks.sauvegardeBaseCreate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(barriereReinitialisationActive()).toBe(false);
  });

  it("archive invalide (validerDump échoue) : ErreurReinitialisation 503, transaction JAMAIS appelée", async () => {
    mocks.construireDump.mockResolvedValue(Buffer.from("archive-suspecte"));
    mocks.validerDump.mockRejectedValue(new ErreurSauvegarde(500, "archive invalide"));

    await expect(reinitialiserBase(undefined)).rejects.toMatchObject({ status: 503 });
    expect(mocks.ecrireSauvegardeLocale).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(barriereReinitialisationActive()).toBe(false);
  });

  it("écriture locale échoue : ErreurReinitialisation 500, transaction JAMAIS appelée", async () => {
    mocks.construireDump.mockResolvedValue(Buffer.from("dump-ok"));
    mocks.validerDump.mockResolvedValue(undefined);
    mocks.ecrireSauvegardeLocale.mockRejectedValue(new Error("ENOSPC: disque plein"));

    await expect(reinitialiserBase(undefined)).rejects.toMatchObject({ status: 500 });
    expect(mocks.sauvegardeBaseCreate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(barriereReinitialisationActive()).toBe(false);
  });
});

describe("reinitialiserBase — barrière déjà active (une autre réinitialisation en préparation)", () => {
  beforeEachHorsProduction();

  it("refuse avec 409 et NE lève PAS la barrière d'autrui", async () => {
    await activerBarriereEtAttendreDrainage(); // simule une AUTRE réinitialisation déjà en cours
    armerSuccesComplet();

    await expect(reinitialiserBase(undefined)).rejects.toMatchObject({
      status: 409,
      code: "REINITIALISATION_DEJA_EN_COURS",
    });
    expect(mocks.construireDump).not.toHaveBeenCalled();
    expect(barriereReinitialisationActive()).toBe(true); // toujours celle de l'appelant précédent
    abaisserBarriere();
  });
});

// vitest exécute describe() de façon synchrone ; ce petit utilitaire évite de
// dupliquer le même beforeEach dans chaque describe() « hors production ».
function beforeEachHorsProduction() {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    delete process.env[VARIABLE_AUTORISATION_PRODUCTION];
  });
}
