// @vitest-environment jsdom

import "@/i18n";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AnniversairesDuJourDTO } from "@lomoto/shared";
import { ConstellationLomoto } from "./ConstellationLomoto";

const apiMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => apiMock(...args),
}));

const matchMediaOriginal = window.matchMedia;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.matchMedia = matchMediaOriginal;
});

/** Simule `window.matchMedia`, même modèle que AuthShell.dom.test.tsx. */
function simulerMatchMedia(reduireMouvement: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduireMouvement : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function reponse(partial: Partial<AnniversairesDuJourDTO>): AnniversairesDuJourDTO {
  return { date: "2026-08-13", noms: [], dejaAffiche: false, ...partial };
}

/** Reproduit l'élément que Layout.tsx expose pour le retour de focus. */
function ScenePrincipale() {
  return (
    <>
      <main id="contenu-principal">Contenu de la page</main>
      <ConstellationLomoto />
    </>
  );
}

/** `useQuery` exige un `QueryClientProvider` — un client neuf par rendu, `retry: false` pour ne pas ralentir les scénarios d'échec réseau. */
function rendre(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe("ConstellationLomoto — DOM", () => {
  it("aucun anniversaire aujourd'hui : rien ne s'affiche", async () => {
    apiMock.mockResolvedValue(reponse({ noms: [], dejaAffiche: false }));
    rendre(<ConstellationLomoto />);

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/auth/anniversaires/aujourdhui", { method: "POST" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("célébration déjà affichée plus tôt dans la session : rien ne s'affiche", async () => {
    apiMock.mockResolvedValue(reponse({ noms: [], dejaAffiche: true }));
    rendre(<ConstellationLomoto />);

    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("un seul anniversaire : la célébration s'affiche avec le nom, sans conjonction", async () => {
    apiMock.mockResolvedValue(reponse({ noms: ["Alain"] }));
    rendre(<ConstellationLomoto />);

    const dialogue = await screen.findByRole("dialog");
    expect(dialogue.textContent).toContain("Constellation Lomoto");
    expect(dialogue.textContent).toContain("Alain");
  });

  it("plusieurs anniversaires : regroupés dans UNE SEULE célébration, jamais une par personne", async () => {
    apiMock.mockResolvedValue(reponse({ noms: ["Alain", "Zoé"] }));
    rendre(<ConstellationLomoto />);

    const dialogues = await screen.findAllByRole("dialog");
    expect(dialogues).toHaveLength(1);
    expect(dialogues[0].textContent).toContain("Alain et Zoé");
  });

  it("n'affiche jamais l'âge ni la date de naissance (absents du DTO, jamais déduits)", async () => {
    apiMock.mockResolvedValue(reponse({ noms: ["Alain", "Zoé"] }));
    rendre(<ConstellationLomoto />);

    const dialogue = await screen.findByRole("dialog");
    // Le texte affiché est exactement composé du titre, du message "noms" et
    // du bouton de fermeture standard (`components/ui/dialog.tsx`) — rien
    // d'autre ne peut donc s'y être glissé (ex. un âge ou une date).
    expect(dialogue.textContent).toBe("Constellation LomotoAnniversaire du jour : Alain et Zoé 🎂Fermer");
    expect(dialogue.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("échec réseau : ne bloque jamais l'application, aucune célébration ne s'affiche", async () => {
    apiMock.mockRejectedValue(new Error("panne réseau"));
    rendre(<ConstellationLomoto />);

    await waitFor(() => expect(apiMock).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("appelle l'endpoint une seule fois par montage (dédoublonnage react-query)", async () => {
    apiMock.mockResolvedValue(reponse({ noms: ["Alain"] }));
    rendre(<ConstellationLomoto />);

    await screen.findByRole("dialog");
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("clavier : Échap ferme la célébration et rend le focus à un emplacement logique (#contenu-principal)", async () => {
    apiMock.mockResolvedValue(reponse({ noms: ["Alain"] }));
    rendre(<ScenePrincipale />);

    await screen.findByRole("dialog");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement?.id).toBe("contenu-principal"));
  });

  it("prefers-reduced-motion : aucune classe d'animation décorative appliquée", async () => {
    simulerMatchMedia(true);
    apiMock.mockResolvedValue(reponse({ noms: ["Alain"] }));
    rendre(<ConstellationLomoto />);

    const dialogue = await screen.findByRole("dialog");
    expect(dialogue.className).not.toContain("lomoto-constellation-content");
    expect(dialogue.querySelector(".lomoto-constellation-etoiles")).toBeNull();
  });

  it("sans réduction de mouvement : les classes décoratives sont bien appliquées", async () => {
    simulerMatchMedia(false);
    apiMock.mockResolvedValue(reponse({ noms: ["Alain"] }));
    rendre(<ConstellationLomoto />);

    const dialogue = await screen.findByRole("dialog");
    expect(dialogue.className).toContain("lomoto-constellation-content");
    expect(dialogue.querySelector(".lomoto-constellation-etoiles")).toBeTruthy();
  });
});
