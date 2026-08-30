/**
 * Preuves mockées (P0, 30/08/2026 — durcies round 2 après contre-revue Codex)
 * de `validerDump` et du comportement de timeout de `construireDump`.
 *
 * Convention : mock de `node:child_process` (jamais le VRAI `pg_dump`/
 * `pg_restore` dans un test unitaire — trop lent, dépendance d'environnement).
 * La preuve que ces fonctions se comportent correctement contre les VRAIS
 * binaires (dont un pg_dump réellement bloqué, tué proprement) est apportée
 * séparément par `scripts/verifier-sauvegarde-reinitialisation-ci.ts`.
 */
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execFileImpl: vi.fn<(fichier: string, args: string[], options: unknown) => Promise<{ stdout: string; stderr: string }>>(),
  spawnImpl: vi.fn<(fichier: string, args: string[], options?: unknown) => FauxProcessus>(),
}));

interface FauxProcessus extends EventEmitter {
  stdout: EventEmitter & { resume: () => void };
  stderr: EventEmitter;
  kill: (signal?: string) => void;
}

/**
 * `kill()` simule le comportement RÉEL d'un enfant tué : Node émet `close`
 * avec le signal reçu, de façon asynchrone — jamais synchrone à l'appel de
 * `kill()`, comme un vrai process. Sans ça, un test qui vérifie le kill sur
 * timeout resterait bloqué indéfiniment (le code sous test attend `close`
 * pour savoir que le process a bien terminé après le signal).
 */
function creerFauxProcessus(options: { ignorerSigterm?: boolean } = {}): FauxProcessus {
  const proc = new EventEmitter() as FauxProcessus;
  const stdout = new EventEmitter() as EventEmitter & { resume: () => void };
  stdout.resume = vi.fn();
  proc.stdout = stdout;
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn((signal?: string) => {
    if (signal === "SIGTERM" && options.ignorerSigterm) return;
    queueMicrotask(() => proc.emit("close", null, signal ?? "SIGTERM"));
  });
  return proc;
}

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
  // execFile (résout {stdout, stderr}, pas juste stdout).
  (execFile as unknown as Record<symbol, unknown>)[CUSTOM_PROMISIFY] = (fichier: string, args: string[], options: unknown) =>
    mocks.execFileImpl(fichier, args, options);

  function spawn(fichier: string, args: string[], options?: unknown) {
    return mocks.spawnImpl(fichier, args, options);
  }

  return { execFile, spawn };
});

const { validerDump, construireDump, ErreurSauvegarde } = await import("./sauvegarde.js");

/** Configure spawnImpl pour que le PROCHAIN appel réussisse immédiatement. */
function armerSpawnSucces(stdout = "") {
  mocks.spawnImpl.mockImplementationOnce(() => {
    const proc = creerFauxProcessus();
    queueMicrotask(() => {
      if (stdout) proc.stdout.emit("data", Buffer.from(stdout));
      proc.emit("close", 0, null);
    });
    return proc;
  });
}

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.PG_RESTORE_PATH;
  delete process.env.PG_DUMP_PATH;
  delete process.env.PG_RESTORE_VALIDATION_TIMEOUT_MS;
  delete process.env.PG_DUMP_TIMEOUT_MS;
  delete process.env.PG_PROCESS_KILL_GRACE_MS;
  delete process.env.DATABASE_URL;
});

describe("validerDump — table des matières (pg_restore --list)", () => {
  it("rejette immédiatement une archive vide, sans même appeler pg_restore", async () => {
    await expect(validerDump(Buffer.alloc(0))).rejects.toBeInstanceOf(ErreurSauvegarde);
    expect(mocks.spawnImpl).not.toHaveBeenCalled();
  });

  it("rejette quand pg_restore --list renvoie une table des matières vide", async () => {
    armerSpawnSucces("   \n  \n");
    await expect(validerDump(Buffer.from("archive-tronquee"))).rejects.toBeInstanceOf(ErreurSauvegarde);
    expect(mocks.spawnImpl).toHaveBeenCalledTimes(1);
  });

  it("rejette avec un message actionnable quand pg_restore signale une archive corrompue", async () => {
    mocks.spawnImpl.mockImplementationOnce(() => {
      const proc = creerFauxProcessus();
      queueMicrotask(() => {
        proc.stderr.emit("data", Buffer.from("pg_restore: error: input file is invalid"));
        proc.emit("close", 1, null);
      });
      return proc;
    });
    await expect(validerDump(Buffer.from("garbage"))).rejects.toMatchObject({
      message: expect.stringContaining("invalide ou corrompue"),
    });
  });

  it("distingue un pg_restore introuvable (ENOENT) et pointe vers PG_RESTORE_PATH", async () => {
    mocks.spawnImpl.mockImplementationOnce(() => {
      const proc = creerFauxProcessus();
      queueMicrotask(() => proc.emit("error", Object.assign(new Error("introuvable"), { code: "ENOENT" })));
      return proc;
    });
    await expect(validerDump(Buffer.from("archive"))).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining("PG_RESTORE_PATH"),
    });
  });

  it("tue par SIGTERM et rejette quand la lecture de la table reste bloquée", async () => {
    process.env.PG_RESTORE_VALIDATION_TIMEOUT_MS = "30";
    let procCapture: FauxProcessus | undefined;
    mocks.spawnImpl.mockImplementationOnce(() => {
      procCapture = creerFauxProcessus();
      return procCapture;
    });
    await expect(validerDump(Buffer.from("archive"))).rejects.toMatchObject({
      status: 504,
      message: expect.stringContaining("interrompue"),
    });
    expect(procCapture?.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("force SIGKILL si pg_restore --list ignore SIGTERM", async () => {
    process.env.PG_RESTORE_VALIDATION_TIMEOUT_MS = "20";
    process.env.PG_PROCESS_KILL_GRACE_MS = "20";
    let procCapture: FauxProcessus | undefined;
    mocks.spawnImpl.mockImplementationOnce(() => {
      procCapture = creerFauxProcessus({ ignorerSigterm: true });
      return procCapture;
    });
    await expect(validerDump(Buffer.from("archive"))).rejects.toMatchObject({ status: 504 });
    expect(procCapture?.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(procCapture?.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });
});

describe("validerDump — parcours complet du contenu (2e passe)", () => {
  it("résout quand les deux passes réussissent (table des matières + parcours complet)", async () => {
    armerSpawnSucces("1234; 5678 TABLE public CommandeClient lomoto\n");
    armerSpawnSucces();
    await expect(validerDump(Buffer.from("archive-valide"))).resolves.toBeUndefined();
    expect(mocks.spawnImpl).toHaveBeenCalledTimes(2);
    const [fichierRestore, argsRestore] = mocks.spawnImpl.mock.calls[1];
    expect(fichierRestore).toBe("pg_restore");
    expect(argsRestore).not.toContain("--dbname");
    expect(argsRestore).toEqual(expect.arrayContaining(["--file", "-"]));
  });

  it("détecte un bloc de DONNÉES corrompu même si la table des matières reste lisible", async () => {
    armerSpawnSucces("1234; 5678 TABLE public CommandeClient lomoto\n");
    mocks.spawnImpl.mockImplementationOnce(() => {
      const proc = creerFauxProcessus();
      queueMicrotask(() => {
        proc.stderr.emit("data", Buffer.from("pg_restore: error: unexpected end of file\n"));
        proc.emit("close", 1, null);
      });
      return proc;
    });
    await expect(validerDump(Buffer.from("archive-toc-ok-donnees-corrompues"))).rejects.toMatchObject({
      message: expect.stringContaining("parcours complet du flux a échoué"),
    });
  });

  it("jette le flux stdout reconstruit sans le bufferiser", async () => {
    armerSpawnSucces("une-entree\n");
    let procCapture: FauxProcessus | undefined;
    mocks.spawnImpl.mockImplementationOnce(() => {
      const proc = creerFauxProcessus();
      procCapture = proc;
      queueMicrotask(() => proc.emit("close", 0, null));
      return proc;
    });
    await validerDump(Buffer.from("archive"));
    expect(procCapture?.stdout.resume).toHaveBeenCalled();
  });

  it("tue proprement le processus si la validation complète reste bloquée", async () => {
    armerSpawnSucces("une-entree\n");
    process.env.PG_RESTORE_VALIDATION_TIMEOUT_MS = "30";
    let procCapture: FauxProcessus | undefined;
    mocks.spawnImpl.mockImplementationOnce(() => {
      const proc = creerFauxProcessus();
      procCapture = proc;
      return proc;
    });
    await expect(validerDump(Buffer.from("archive"))).rejects.toMatchObject({
      status: 504,
      message: expect.stringContaining("interrompue"),
    });
    expect(procCapture?.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("construireDump — timeout d'un pg_dump bloqué", () => {
  it("tue proprement pg_dump et rejette si le process reste bloqué au-delà du délai maximal", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/lomoto_test";
    process.env.PG_DUMP_TIMEOUT_MS = "30";
    let procCapture: FauxProcessus | undefined;
    mocks.spawnImpl.mockImplementationOnce(() => {
      const proc = creerFauxProcessus();
      procCapture = proc; // ne termine jamais — simule un pg_dump bloqué (hôte injoignable, verrou...)
      return proc;
    });
    await expect(construireDump()).rejects.toMatchObject({
      status: 504,
      message: expect.stringContaining("interrompu"),
    });
    expect(procCapture?.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("force SIGKILL si pg_dump ignore SIGTERM", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/lomoto_test";
    process.env.PG_DUMP_TIMEOUT_MS = "20";
    process.env.PG_PROCESS_KILL_GRACE_MS = "20";
    let procCapture: FauxProcessus | undefined;
    mocks.spawnImpl.mockImplementationOnce(() => {
      procCapture = creerFauxProcessus({ ignorerSigterm: true });
      return procCapture;
    });
    await expect(construireDump()).rejects.toMatchObject({ status: 504 });
    expect(procCapture?.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(procCapture?.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });

  it("réussit normalement quand pg_dump se termine avant le délai", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/lomoto_test";
    mocks.spawnImpl.mockImplementationOnce(() => {
      const proc = creerFauxProcessus();
      queueMicrotask(() => {
        proc.stdout.emit("data", Buffer.from("contenu-dump-factice"));
        proc.emit("close", 0, null);
      });
      return proc;
    });
    const dump = await construireDump();
    expect(dump.toString()).toBe("contenu-dump-factice");
  });
});
