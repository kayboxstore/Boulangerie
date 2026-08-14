// @vitest-environment jsdom

import "@/i18n";
import type { UtilisateurDTO } from "@lomoto/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SocketProvider, useSocket } from "./socket";

const apiMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => apiMock(...args),
  getToken: () => "jeton-test",
}));

const ioMock = vi.fn();
vi.mock("socket.io-client", () => ({
  io: (...args: unknown[]) => ioMock(...args),
}));

let utilisateurMock: UtilisateurDTO | null = null;
const deconnexionForceeMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ utilisateur: utilisateurMock, deconnexionForcee: deconnexionForceeMock }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  apiMock.mockReset();
  ioMock.mockReset();
  utilisateurMock = null;
});

function utilisateurFactice(motDePasseDoitChanger: boolean): UtilisateurDTO {
  return {
    id: "u1",
    nom: "Chef Boulanger",
    email: "chef.boulanger@boulangerie-lomoto.com",
    estAdminPrincipal: false,
    role: { id: "r1", nom: "Production", roleParentId: null, permissions: [] },
    languePreferee: "FR",
    motDePasseDoitChanger,
  } as UtilisateurDTO;
}

/** Socket factice minimale : `.on`/`.io.on`/`.disconnect` sans jamais réellement se connecter. */
function creerSocketFactice() {
  return {
    on: vi.fn(),
    io: { on: vi.fn() },
    disconnect: vi.fn(),
  };
}

function SondeSocket() {
  const { statut, nonLues } = useSocket();
  return (
    <div>
      <div data-testid="statut">{statut}</div>
      <div data-testid="non-lues">{nonLues}</div>
    </div>
  );
}

function arbre() {
  return (
    <SocketProvider>
      <SondeSocket />
    </SocketProvider>
  );
}

describe("SocketProvider — garde motDePasseDoitChanger (F3, revue Codex)", () => {
  it("motDePasseDoitChanger actif : aucun appel /api/notifications, aucune connexion Socket.io, état vidé", async () => {
    utilisateurMock = utilisateurFactice(true);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}>{arbre()}</QueryClientProvider>);

    // Laisse le temps à un éventuel appel réseau ou import dynamique de partir.
    await new Promise((r) => setTimeout(r, 0));

    expect(apiMock).not.toHaveBeenCalled();
    expect(ioMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("statut").textContent).toBe("deconnecte");
    expect(screen.getByTestId("non-lues").textContent).toBe("0");
  });

  it("après confirmation serveur (motDePasseDoitChanger → false) : la connexion démarre, une seule fois", async () => {
    utilisateurMock = utilisateurFactice(true);
    apiMock.mockResolvedValue({ notifications: [], nonLues: 0 });
    ioMock.mockReturnValue(creerSocketFactice());
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { rerender } = render(<QueryClientProvider client={queryClient}>{arbre()}</QueryClientProvider>);
    await new Promise((r) => setTimeout(r, 0));
    expect(ioMock).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();

    // Confirmation serveur (ex. rafraichirIdentite() après le changement de
    // mot de passe obligatoire) : le drapeau repasse à `false`.
    utilisateurMock = utilisateurFactice(false);
    rerender(<QueryClientProvider client={queryClient}>{arbre()}</QueryClientProvider>);

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/notifications"));
    await waitFor(() => expect(ioMock).toHaveBeenCalledTimes(1));

    // Un second rendu sans changement d'utilisateur ne doit pas déclencher une seconde connexion.
    rerender(<QueryClientProvider client={queryClient}>{arbre()}</QueryClientProvider>);
    await new Promise((r) => setTimeout(r, 0));
    expect(ioMock).toHaveBeenCalledTimes(1);
  });
});
