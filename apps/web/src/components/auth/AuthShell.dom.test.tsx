// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AuthShell } from "./AuthShell";

afterEach(cleanup);

/** Simule `window.matchMedia` pour une préférence donnée, comme `lib/theme.tsx` le fait déjà pour les tests de thème. */
function simulerMatchMedia(reduireMouvement: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduireMouvement : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("AuthShell — DOM", () => {
  it("le formulaire (children) est toujours présent, visible et interactif — indépendamment de l'état de la lampe", () => {
    simulerMatchMedia(false);
    render(
      <AuthShell>
        <input aria-label="Adresse e-mail" />
        <button type="submit">Se connecter</button>
      </AuthShell>,
    );

    const champ = screen.getByLabelText("Adresse e-mail") as HTMLInputElement;
    const bouton = screen.getByRole("button", { name: "Se connecter" }) as HTMLButtonElement;
    expect(champ.disabled).toBe(false);
    expect(bouton.disabled).toBe(false);

    // Bascule la lampe (desktop, première instance) : le formulaire reste intact.
    const [lampeDesktop] = screen.getAllByRole("button", { name: "Allumer la lampe" });
    fireEvent.click(lampeDesktop);

    expect(screen.getByLabelText("Adresse e-mail")).toBeTruthy();
    expect((screen.getByLabelText("Adresse e-mail") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Se connecter" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("variante prefers-reduced-motion : le formulaire est immédiatement utilisable, sans dépendre d'une animation", () => {
    simulerMatchMedia(true);
    render(
      <AuthShell>
        <input aria-label="Adresse e-mail" />
      </AuthShell>,
    );

    // Aucune classe d'animation d'entrée n'est appliquée à la carte du formulaire.
    const conteneurFormulaire = screen.getByLabelText("Adresse e-mail").closest(".w-full.max-w-md");
    expect(conteneurFormulaire?.className).not.toContain("lomoto-authshell-formulaire");

    // La lampe démarre déjà « allumée » : rien ne dépend d'une interaction pour être complet.
    const [lampeDesktop] = screen.getAllByRole("button", { name: "Éteindre la lampe" });
    expect(lampeDesktop.getAttribute("aria-pressed")).toBe("true");

    // Le champ reste pleinement utilisable.
    expect((screen.getByLabelText("Adresse e-mail") as HTMLInputElement).disabled).toBe(false);
  });

  it("le filigrane du logo est purement décoratif : aria-hidden, alt vide, ignoré des clics", () => {
    simulerMatchMedia(false);
    const { container } = render(
      <AuthShell>
        <input aria-label="Adresse e-mail" />
      </AuthShell>,
    );

    const filigrane = container.querySelector('img[alt=""]') as HTMLImageElement;
    expect(filigrane).toBeTruthy();
    expect(filigrane.getAttribute("aria-hidden")).toBe("true");
    expect(filigrane.className).toContain("pointer-events-none");
  });

  it("existe une lampe interactive à la fois pour le panneau desktop et l'en-tête compact mobile", () => {
    simulerMatchMedia(false);
    render(
      <AuthShell>
        <input aria-label="Adresse e-mail" />
      </AuthShell>,
    );
    const lampes = screen.getAllByRole("button", { name: "Allumer la lampe" });
    expect(lampes).toHaveLength(2);
  });
});
