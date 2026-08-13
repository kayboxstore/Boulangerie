// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import { ApiError } from "@/lib/api";
import { ChangementMotDePasseObligatoirePage } from "./ChangementMotDePasseObligatoire";

const apiMock = vi.fn();
vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public corps?: unknown,
    ) {
      super(message);
    }
  }
  return { api: (...args: unknown[]) => apiMock(...args), ApiError };
});

const logoutMock = vi.fn();
const rafraichirIdentiteMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ logout: logoutMock, rafraichirIdentite: rafraichirIdentiteMock }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function rendre() {
  return render(
    <MemoryRouter>
      <FeedbackProvider>
        <ChangementMotDePasseObligatoirePage />
      </FeedbackProvider>
    </MemoryRouter>,
  );
}

function remplirEtSoumettre(actuel: string, nouveau: string, confirmation: string) {
  fireEvent.change(screen.getByLabelText("Mot de passe temporaire actuel"), { target: { value: actuel } });
  fireEvent.change(screen.getByLabelText("Nouveau mot de passe"), { target: { value: nouveau } });
  fireEvent.change(screen.getByLabelText("Confirmer le nouveau mot de passe"), { target: { value: confirmation } });
  fireEvent.click(screen.getByRole("button", { name: "Changer le mot de passe" }));
}

describe("ChangementMotDePasseObligatoirePage — DOM (F3)", () => {
  it("association libellé/champ pour les trois champs", () => {
    rendre();
    expect(screen.getByLabelText("Mot de passe temporaire actuel")).toBeTruthy();
    expect(screen.getByLabelText("Nouveau mot de passe")).toBeTruthy();
    expect(screen.getByLabelText("Confirmer le nouveau mot de passe")).toBeTruthy();
  });

  it("refuse un nouveau mot de passe trop court, sans appeler l'API", () => {
    rendre();
    remplirEtSoumettre("tempo123", "court1", "court1");

    expect(screen.getByRole("alert").textContent).toBe("Le nouveau mot de passe doit contenir au moins 8 caractères.");
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("refuse une confirmation différente, sans appeler l'API", () => {
    rendre();
    remplirEtSoumettre("tempo123", "motDePasseValide1", "autreChose1");

    expect(screen.getByRole("alert").textContent).toBe("Les deux mots de passe ne correspondent pas.");
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("appelle POST /api/auth/mot-de-passe avec le mot de passe actuel et le nouveau", async () => {
    apiMock.mockResolvedValue(undefined);
    rendre();
    remplirEtSoumettre("tempo123", "motDePasseValide1", "motDePasseValide1");

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/auth/mot-de-passe", {
        method: "POST",
        body: JSON.stringify({ motDePasseActuel: "tempo123", nouveauMotDePasse: "motDePasseValide1" }),
      }),
    );
  });

  it("mot de passe actuel incorrect (401) : affiche le message du serveur", async () => {
    apiMock.mockRejectedValue(new ApiError(401, "Mot de passe actuel incorrect"));
    rendre();
    remplirEtSoumettre("mauvais", "motDePasseValide1", "motDePasseValide1");

    expect((await screen.findByRole("alert")).textContent).toBe("Mot de passe actuel incorrect");
    expect(rafraichirIdentiteMock).not.toHaveBeenCalled();
  });

  it("panne réseau : affiche un message générique", async () => {
    apiMock.mockRejectedValue(new ApiError(0, "Impossible de contacter le serveur — vérifiez votre connexion internet."));
    rendre();
    remplirEtSoumettre("tempo123", "motDePasseValide1", "motDePasseValide1");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Impossible de contacter le serveur — vérifiez votre connexion internet.",
    );
  });

  it("succès : rafraîchit l'identité via le serveur et affiche un toast de confirmation (retour transitoire)", async () => {
    apiMock.mockResolvedValue(undefined);
    rendre();
    remplirEtSoumettre("tempo123", "motDePasseValide1", "motDePasseValide1");

    await waitFor(() => expect(rafraichirIdentiteMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Mot de passe changé avec succès.")).toBeTruthy();
  });

  it("empêche une double soumission : l'API n'est appelée qu'une seule fois", async () => {
    let resoudre!: (v: unknown) => void;
    apiMock.mockReturnValue(new Promise((r) => (resoudre = r)));
    rendre();

    fireEvent.change(screen.getByLabelText("Mot de passe temporaire actuel"), { target: { value: "tempo123" } });
    fireEvent.change(screen.getByLabelText("Nouveau mot de passe"), { target: { value: "motDePasseValide1" } });
    fireEvent.change(screen.getByLabelText("Confirmer le nouveau mot de passe"), { target: { value: "motDePasseValide1" } });
    const bouton = screen.getByRole("button", { name: "Changer le mot de passe" });
    fireEvent.click(bouton);
    fireEvent.click(bouton);
    fireEvent.click(bouton);

    expect(apiMock).toHaveBeenCalledTimes(1);
    resoudre(undefined);
    await waitFor(() => expect(rafraichirIdentiteMock).toHaveBeenCalledTimes(1));
  });

  it("propose une déconnexion (échappatoire)", () => {
    rendre();
    fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });
});
