// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UtilisateurDTO } from "@lomoto/shared";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import App from "./App";

const utilisateurBase: UtilisateurDTO = {
  id: "u1",
  nom: "Chef Test",
  email: "chef@boulangerie-lomoto.com",
  estAdminPrincipal: false,
  role: { id: "r1", nom: "Production", roleParentId: null, permissions: [] },
  languePreferee: null,
  photoUrl: null,
};

let utilisateurMock: UtilisateurDTO | null = null;
const logoutMock = vi.fn();
const rafraichirIdentiteMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    utilisateur: utilisateurMock,
    chargement: false,
    login: vi.fn(),
    logout: logoutMock,
    peutLire: () => false,
    peutEcrire: () => false,
    langueDefautBoutique: "FR",
    changerLangue: vi.fn(),
    messageSessionRemplacee: null,
    deconnexionForcee: vi.fn(),
    premierLancement: false,
    rafraichirIdentite: rafraichirIdentiteMock,
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  utilisateurMock = null;
});

function rendre(chemin: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[chemin]}>
        <FeedbackProvider>
          <App />
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("App — changement obligatoire du mot de passe (F3)", () => {
  it("affiche le parcours bloquant, jamais la coquille métier (nav), quelle que soit l'URL demandée", async () => {
    utilisateurMock = { ...utilisateurBase, motDePasseDoitChanger: true };
    rendre("/commandes");

    expect(await screen.findByRole("heading", { name: "Mot de passe temporaire" })).toBeTruthy();
    // Layout (barre latérale desktop + tiroir mobile) porte deux éléments
    // <nav> ; leur absence prouve qu'aucune route métier n'a été montée.
    expect(document.querySelector("nav")).toBeNull();
  });

  it("affiche le même écran bloquant sur la racine, pas seulement sur une sous-route", async () => {
    utilisateurMock = { ...utilisateurBase, motDePasseDoitChanger: true };
    rendre("/");

    expect(await screen.findByRole("heading", { name: "Mot de passe temporaire" })).toBeTruthy();
    expect(document.querySelector("nav")).toBeNull();
  });

  it("propose une déconnexion depuis l'écran bloquant (échappatoire, pas de piège)", async () => {
    utilisateurMock = { ...utilisateurBase, motDePasseDoitChanger: true };
    rendre("/");

    await screen.findByRole("heading", { name: "Mot de passe temporaire" });
    expect(screen.getByRole("button", { name: "Se déconnecter" })).toBeTruthy();
  });
});
