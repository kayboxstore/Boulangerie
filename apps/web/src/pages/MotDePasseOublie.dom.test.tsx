// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import { MotDePasseOubliePage } from "./MotDePasseOublie";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function rendre() {
  return render(
    <MemoryRouter>
      <FeedbackProvider>
        <MotDePasseOubliePage />
      </FeedbackProvider>
    </MemoryRouter>,
  );
}

describe("MotDePasseOubliePage — DOM", () => {
  it("association libellé/champ : le champ e-mail est trouvable par son libellé", () => {
    rendre();
    const champ = screen.getByLabelText("Adresse e-mail") as HTMLInputElement;
    expect(champ.id).toBe("email-recuperation");
  });

  it("refuse une adresse e-mail invalide, sans jamais appeler le réseau", () => {
    const surFetch = vi.spyOn(globalThis, "fetch");
    rendre();

    fireEvent.change(screen.getByLabelText("Adresse e-mail"), { target: { value: "pas-un-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer la demande" }));

    expect(screen.getByRole("alert").textContent).toBe("Saisissez une adresse e-mail valide.");
    expect(surFetch).not.toHaveBeenCalled();
  });

  it("une soumission valide n'appelle AUCUN endpoint réseau et n'affiche jamais un message de succès", () => {
    const surFetch = vi.spyOn(globalThis, "fetch");
    rendre();

    fireEvent.change(screen.getByLabelText("Adresse e-mail"), {
      target: { value: "chef.boulanger@boulangerie-lomoto.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer la demande" }));

    // Aucun appel réseau, aucune requête `fetch` — pas de faux jeton, pas de
    // fausse demande envoyée au serveur (tâche 9 : ne jamais simuler le succès).
    expect(surFetch).not.toHaveBeenCalled();

    // Une SEULE annonce accessible (revue Codex round 2) : le message
    // persistant, jamais un toast en plus — sans quoi le même texte serait
    // annoncé deux fois aux lecteurs d'écran.
    const statuts = screen.getAllByRole("status");
    expect(statuts).toHaveLength(1);
    expect(statuts[0].textContent).toContain("attend encore son intégration");
    // Le texte nie explicitement tout envoi ("Aucune demande n'a été envoyée") —
    // jamais une formulation positive laissant croire à un succès.
    expect(statuts[0].textContent).toContain("Aucune demande n'a été envoyée");
    expect(statuts[0].textContent?.toLowerCase()).not.toContain("succès");
  });

  it("propose un lien de retour vers la connexion", () => {
    rendre();
    const lien = screen.getByRole("link", { name: "Retour à la connexion" });
    expect(lien.getAttribute("href")).toBe("/connexion");
  });
});
