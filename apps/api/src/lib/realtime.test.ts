/**
 * Preuve ciblée du correctif P0-01 (round 4, point 3), demandée par la revue
 * Codex round 5 : `invaliderSessionUtilisateur()` doit réellement émettre
 * `sessionInvalidee` sur la room de l'utilisateur ET appeler
 * `disconnectSockets(true)` sur cette même room. Jusqu'ici, seul l'appel à
 * `invaliderSessionUtilisateur` lui-même était vérifié côté route
 * (`equipe.activation.test.ts`) — ce fichier teste directement la fonction,
 * en mockant le module `socket.io` pour observer les appels réels sur
 * l'instance `Server`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  use: vi.fn(),
  on: vi.fn(),
  to: vi.fn(),
  in: vi.fn(),
  emit: vi.fn(),
  disconnectSockets: vi.fn(),
}));

vi.mock("socket.io", () => ({
  Server: vi.fn().mockImplementation(() => ({
    use: mocks.use,
    on: mocks.on,
    to: (...args: unknown[]) => {
      mocks.to(...args);
      return { emit: mocks.emit };
    },
    in: (...args: unknown[]) => {
      mocks.in(...args);
      return { disconnectSockets: mocks.disconnectSockets };
    },
  })),
}));

vi.mock("./origines.js", () => ({ verifierOrigine: vi.fn() }));
vi.mock("./jwt.js", () => ({ verifyToken: vi.fn() }));
vi.mock("./prisma.js", () => ({ prisma: { utilisateur: { findUnique: vi.fn() } } }));
vi.mock("../middleware/auth.js", () => ({ chargerUtilisateur: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("invaliderSessionUtilisateur", () => {
  it("no-op silencieux tant que initRealtime n'a jamais été appelé (io === null)", async () => {
    const { invaliderSessionUtilisateur } = await import("./realtime.js");

    expect(() => invaliderSessionUtilisateur("u1")).not.toThrow();
    expect(mocks.to).not.toHaveBeenCalled();
    expect(mocks.in).not.toHaveBeenCalled();
  });

  it("émet sessionInvalidee ET appelle disconnectSockets(true), tous deux sur la room de l'utilisateur ciblé", async () => {
    const { initRealtime, invaliderSessionUtilisateur, roomUtilisateur } = await import("./realtime.js");

    initRealtime({} as never);
    invaliderSessionUtilisateur("u1");

    const room = roomUtilisateur("u1");
    expect(mocks.to).toHaveBeenCalledWith(room);
    expect(mocks.emit).toHaveBeenCalledWith("sessionInvalidee", expect.objectContaining({ message: expect.any(String) }));
    expect(mocks.in).toHaveBeenCalledWith(room);
    expect(mocks.disconnectSockets).toHaveBeenCalledWith(true);
  });

  it("cible bien la room de l'utilisateur demandé, pas une autre (deux utilisateurs distincts → deux rooms distinctes)", async () => {
    const { initRealtime, invaliderSessionUtilisateur, roomUtilisateur } = await import("./realtime.js");

    initRealtime({} as never);
    invaliderSessionUtilisateur("u1");
    invaliderSessionUtilisateur("u2");

    expect(mocks.to).toHaveBeenNthCalledWith(1, roomUtilisateur("u1"));
    expect(mocks.to).toHaveBeenNthCalledWith(2, roomUtilisateur("u2"));
    expect(mocks.in).toHaveBeenNthCalledWith(1, roomUtilisateur("u1"));
    expect(mocks.in).toHaveBeenNthCalledWith(2, roomUtilisateur("u2"));
  });
});
