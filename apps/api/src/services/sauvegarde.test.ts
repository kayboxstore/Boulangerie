/**
 * Preuves mockées (P0, 30/08/2026) de `validerDump` — la fonction qui refuse
 * qu'une archive corrompue ou tronquée soit jamais présentée comme une
 * sauvegarde réussie (constat Codex/Claude : « ne jamais conserver ni
 * annoncer comme réussie une archive partielle »).
 *
 * Convention : mock de `node:child_process` (jamais le VRAI `pg_restore`
 * dans un test unitaire — trop lent, dépendance d'environnement). La preuve
 * que `validerDump` détecte réellement une archive invalide contre le VRAI
 * binaire `pg_restore` est apportée séparément par
 * `scripts/verifier-sauvegarde-reinitialisation-ci.ts`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFileImpl: vi.fn<(fichier: string, args: string[], options: unknown) => Promise<{ stdout: string; stderr: string }>>(),
}));

vi.mock("node:child_process", () => {
  const CUSTOM_PROMISIFY = Symbol.for("nodejs.util.promisify.custom");
  function execFile(
    fichier: string,
    args: string[],
    options: unknown,
    callback: (err: unknown, result?: { stdout: string; stderr: string }) => void,
  ) {
    mocks.execFileImpl(fichier, args, options).then(
      (r) => callback(null, r),
      (e) => callback(e),
    );
  }
  // Reproduit le comportement de promisification personnalisée de Node pour
  // execFile (résout {stdout, stderr}, pas juste stdout) — sans ça,
  // `promisify(execFile)` du code testé tomberait sur le comportement
  // générique et ne renverrait qu'une seule valeur.
  (execFile as unknown as Record<symbol, unknown>)[CUSTOM_PROMISIFY] = (fichier: string, args: string[], options: unknown) =>
    mocks.execFileImpl(fichier, args, options);
  return { execFile, spawn: vi.fn() };
});

const { validerDump, ErreurSauvegarde } = await import("./sauvegarde.js");

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.PG_RESTORE_PATH;
});

describe("validerDump", () => {
  it("rejette immédiatement une archive vide, sans même appeler pg_restore", async () => {
    await expect(validerDump(Buffer.alloc(0))).rejects.toBeInstanceOf(ErreurSauvegarde);
    expect(mocks.execFileImpl).not.toHaveBeenCalled();
  });

  it("résout sans erreur quand pg_restore --list renvoie une table des matières non vide", async () => {
    mocks.execFileImpl.mockResolvedValue({ stdout: "1234; 5678 TABLE public CommandeClient lomoto\n", stderr: "" });
    await expect(validerDump(Buffer.from("archive-factice-non-vide"))).resolves.toBeUndefined();
    expect(mocks.execFileImpl).toHaveBeenCalledTimes(1);
    const [fichier, args] = mocks.execFileImpl.mock.calls[0];
    expect(fichier).toBe("pg_restore");
    expect(args[0]).toBe("--list");
  });

  it("rejette quand pg_restore --list renvoie une table des matières vide (archive tronquée)", async () => {
    mocks.execFileImpl.mockResolvedValue({ stdout: "   \n  \n", stderr: "" });
    await expect(validerDump(Buffer.from("archive-tronquee"))).rejects.toBeInstanceOf(ErreurSauvegarde);
  });

  it("rejette avec un message actionnable quand pg_restore signale une archive corrompue (code non nul)", async () => {
    const erreur = Object.assign(new Error("pg_restore: error: input file appears to be a text format dump"), {
      stderr: "pg_restore: error: input file appears to be a text format dump",
    });
    mocks.execFileImpl.mockRejectedValue(erreur);
    await expect(validerDump(Buffer.from("garbage"))).rejects.toMatchObject({
      message: expect.stringContaining("invalide ou corrompue"),
    });
  });

  it("distingue un pg_restore introuvable (ENOENT) et pointe vers PG_RESTORE_PATH", async () => {
    const erreur = Object.assign(new Error("introuvable"), { code: "ENOENT" });
    mocks.execFileImpl.mockRejectedValue(erreur);
    await expect(validerDump(Buffer.from("archive"))).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("PG_RESTORE_PATH"),
    });
  });

  it("respecte PG_RESTORE_PATH s'il est défini, lu à CHAQUE appel (pas figé au chargement du module)", async () => {
    mocks.execFileImpl.mockResolvedValue({ stdout: "une-entree\n", stderr: "" });
    process.env.PG_RESTORE_PATH = "/opt/pg16/bin/pg_restore";
    await validerDump(Buffer.from("archive"));
    const [fichier] = mocks.execFileImpl.mock.calls[0];
    expect(fichier).toBe("/opt/pg16/bin/pg_restore");
  });
});
