// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import { NouveauMotDePassePage } from "./NouveauMotDePasse";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function rendre() {
  return render(
    <MemoryRouter>
      <FeedbackProvider>
        <NouveauMotDePassePage />
      </FeedbackProvider>
    </MemoryRouter>,
  );
}

function champMotDePasse() {
  return document.getElementById("nouveau-mdp") as HTMLInputElement;
}
function champConfirmation() {
  return document.getElementById("confirmation-mdp") as HTMLInputElement;
}

describe("NouveauMotDePassePage — DOM", () => {
  it("association libellé/champ pour les deux champs de mot de passe", () => {
    rendre();
    expect(screen.getByLabelText("Nouveau mot de passe")).toBe(champMotDePasse());
    expect(screen.getByLabelText("Confirmer le mot de passe")).toBe(champConfirmation());
  });

  it("refuse un mot de passe trop court, sans appel réseau", () => {
    const surFetch = vi.spyOn(globalThis, "fetch");
    rendre();

    fireEvent.change(champMotDePasse(), { target: { value: "court1" } });
    fireEvent.change(champConfirmation(), { target: { value: "court1" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le nouveau mot de passe" }));

    expect(screen.getByRole("alert").textContent).toBe("Le mot de passe doit contenir au moins 8 caractères.");
    expect(surFetch).not.toHaveBeenCalled();
  });

  it("refuse une confirmation différente, sans appel réseau", () => {
    const surFetch = vi.spyOn(globalThis, "fetch");
    rendre();

    fireEvent.change(champMotDePasse(), { target: { value: "motDePasseValide1" } });
    fireEvent.change(champConfirmation(), { target: { value: "autreChose1" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le nouveau mot de passe" }));

    expect(screen.getByRole("alert").textContent).toBe("Les deux mots de passe ne correspondent pas.");
    expect(surFetch).not.toHaveBeenCalled();
  });

  it("une soumission valide n'appelle AUCUN endpoint réseau et n'affiche jamais un message de succès", () => {
    const surFetch = vi.spyOn(globalThis, "fetch");
    rendre();

    fireEvent.change(champMotDePasse(), { target: { value: "motDePasseValide1" } });
    fireEvent.change(champConfirmation(), { target: { value: "motDePasseValide1" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le nouveau mot de passe" }));

    expect(surFetch).not.toHaveBeenCalled();

    // Une SEULE annonce accessible (revue Codex round 2) : le message
    // persistant, jamais un toast en plus.
    const statuts = screen.getAllByRole("status");
    expect(statuts).toHaveLength(1);
    expect(statuts[0].textContent).toContain("attend encore son intégration");
    expect(statuts[0].textContent).toContain("Aucune demande n'a été envoyée");
    expect(statuts[0].textContent?.toLowerCase()).not.toContain("succès");
  });

  it("propose un lien de retour vers la connexion", () => {
    rendre();
    const lien = screen.getByRole("link", { name: "Retour à la connexion" });
    expect(lien.getAttribute("href")).toBe("/connexion");
  });
});
