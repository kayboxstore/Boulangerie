// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "@/lib/api";
import { NouveauMotDePassePage } from "./NouveauMotDePasse";

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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const JETON = "a".repeat(40);

function rendre(chemin = `/nouveau-mot-de-passe?jeton=${JETON}`) {
  return render(
    <MemoryRouter initialEntries={[chemin]}>
      <NouveauMotDePassePage />
    </MemoryRouter>,
  );
}

function champMotDePasse() {
  return document.getElementById("nouveau-mdp") as HTMLInputElement;
}
function champConfirmation() {
  return document.getElementById("confirmation-mdp") as HTMLInputElement;
}

describe("NouveauMotDePassePage — DOM (F3, connectée à l'API C3)", () => {
  it("jeton absent de l'URL : état invalide immédiat, sans appeler l'API", async () => {
    rendre("/nouveau-mot-de-passe");

    expect(await screen.findByRole("heading", { name: "Lien invalide ou expiré" })).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("vérifie le jeton au chargement, avant d'autoriser le formulaire", async () => {
    let resoudre!: (v: unknown) => void;
    apiMock.mockReturnValue(new Promise((r) => (resoudre = r)));
    rendre();

    expect(screen.getByRole("status").textContent).toBe("Vérification du lien de réinitialisation…");
    expect(screen.queryByLabelText("Nouveau mot de passe")).toBeNull();

    resoudre({ valide: true });
    expect(await screen.findByLabelText("Nouveau mot de passe")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith("/api/auth/reinitialisation/verifier", {
      method: "POST",
      body: JSON.stringify({ jeton: JETON }),
    });
  });

  it("jeton invalide (serveur) : état invalide, avec un lien pour demander un nouveau lien", async () => {
    apiMock.mockResolvedValue({ valide: false });
    rendre();

    expect(await screen.findByRole("heading", { name: "Lien invalide ou expiré" })).toBeTruthy();
    const lien = screen.getByRole("link", { name: "Demander un nouveau lien" });
    expect(lien.getAttribute("href")).toBe("/mot-de-passe-oublie");
  });

  it("panne réseau pendant la vérification : traité comme un jeton invalide (choix conservateur)", async () => {
    apiMock.mockRejectedValue(new ApiError(0, "Impossible de contacter le serveur — vérifiez votre connexion internet."));
    rendre();

    expect(await screen.findByRole("heading", { name: "Lien invalide ou expiré" })).toBeTruthy();
  });

  it("jeton valide : association label/champ pour les deux champs de mot de passe", async () => {
    apiMock.mockResolvedValue({ valide: true });
    rendre();

    expect(await screen.findByLabelText("Nouveau mot de passe")).toBe(champMotDePasse());
    expect(screen.getByLabelText("Confirmer le mot de passe")).toBe(champConfirmation());
  });

  it("refuse un mot de passe trop court, sans appeler l'API de réinitialisation", async () => {
    apiMock.mockResolvedValueOnce({ valide: true });
    rendre();
    await screen.findByLabelText("Nouveau mot de passe");
    apiMock.mockClear();

    fireEvent.change(champMotDePasse(), { target: { value: "court1" } });
    fireEvent.change(champConfirmation(), { target: { value: "court1" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le nouveau mot de passe" }));

    expect(screen.getByRole("alert").textContent).toBe("Le mot de passe doit contenir au moins 8 caractères.");
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("refuse une confirmation différente, sans appeler l'API de réinitialisation", async () => {
    apiMock.mockResolvedValueOnce({ valide: true });
    rendre();
    await screen.findByLabelText("Nouveau mot de passe");
    apiMock.mockClear();

    fireEvent.change(champMotDePasse(), { target: { value: "motDePasseValide1" } });
    fireEvent.change(champConfirmation(), { target: { value: "autreChose1" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le nouveau mot de passe" }));

    expect(screen.getByRole("alert").textContent).toBe("Les deux mots de passe ne correspondent pas.");
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("succès (204) : appelle /api/auth/reinitialisation puis propose clairement le retour à la connexion", async () => {
    apiMock.mockResolvedValueOnce({ valide: true });
    rendre();
    await screen.findByLabelText("Nouveau mot de passe");
    apiMock.mockResolvedValueOnce(undefined);

    fireEvent.change(champMotDePasse(), { target: { value: "motDePasseValide1" } });
    fireEvent.change(champConfirmation(), { target: { value: "motDePasseValide1" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le nouveau mot de passe" }));

    expect(await screen.findByRole("heading", { name: "Mot de passe mis à jour" })).toBeTruthy();
    expect(apiMock).toHaveBeenLastCalledWith("/api/auth/reinitialisation", {
      method: "POST",
      body: JSON.stringify({ jeton: JETON, nouveauMotDePasse: "motDePasseValide1" }),
    });
    const lien = screen.getByRole("link", { name: "Aller à la connexion" });
    expect(lien.getAttribute("href")).toBe("/connexion");
  });

  it("jeton devenu invalide entre la vérification et la soumission : bascule sur l'état invalide", async () => {
    apiMock.mockResolvedValueOnce({ valide: true });
    rendre();
    await screen.findByLabelText("Nouveau mot de passe");
    apiMock.mockRejectedValueOnce(
      new ApiError(400, "Ce lien de réinitialisation est invalide, expiré ou déjà utilisé.", {
        code: "JETON_INVALIDE_OU_EXPIRE",
      }),
    );

    fireEvent.change(champMotDePasse(), { target: { value: "motDePasseValide1" } });
    fireEvent.change(champConfirmation(), { target: { value: "motDePasseValide1" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le nouveau mot de passe" }));

    expect(await screen.findByRole("heading", { name: "Lien invalide ou expiré" })).toBeTruthy();
  });

  it("erreur réseau à la soumission : message affiché, le formulaire reste utilisable (pas de bascule vers invalide)", async () => {
    apiMock.mockResolvedValueOnce({ valide: true });
    rendre();
    await screen.findByLabelText("Nouveau mot de passe");
    apiMock.mockRejectedValueOnce(new ApiError(0, "Impossible de contacter le serveur — vérifiez votre connexion internet."));

    fireEvent.change(champMotDePasse(), { target: { value: "motDePasseValide1" } });
    fireEvent.change(champConfirmation(), { target: { value: "motDePasseValide1" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le nouveau mot de passe" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Impossible de contacter le serveur — vérifiez votre connexion internet.",
    );
    expect(screen.getByLabelText("Nouveau mot de passe")).toBeTruthy();
  });

  it("empêche une double soumission : l'API de réinitialisation n'est appelée qu'une seule fois", async () => {
    apiMock.mockResolvedValueOnce({ valide: true });
    rendre();
    await screen.findByLabelText("Nouveau mot de passe");

    let resoudre!: (v: unknown) => void;
    apiMock.mockReturnValueOnce(new Promise((r) => (resoudre = r)));

    fireEvent.change(champMotDePasse(), { target: { value: "motDePasseValide1" } });
    fireEvent.change(champConfirmation(), { target: { value: "motDePasseValide1" } });
    const bouton = screen.getByRole("button", { name: "Enregistrer le nouveau mot de passe" });
    fireEvent.click(bouton);
    fireEvent.click(bouton);
    fireEvent.click(bouton);

    expect(apiMock).toHaveBeenCalledTimes(2); // 1 vérification + 1 réinitialisation
    resoudre(undefined);
    await screen.findByRole("heading", { name: "Mot de passe mis à jour" });
  });

  it("le jeton n'est jamais écrit dans localStorage", async () => {
    const surSetItem = vi.spyOn(Storage.prototype, "setItem");
    apiMock.mockResolvedValueOnce({ valide: true });
    rendre();
    await screen.findByLabelText("Nouveau mot de passe");
    apiMock.mockResolvedValueOnce(undefined);

    fireEvent.change(champMotDePasse(), { target: { value: "motDePasseValide1" } });
    fireEvent.change(champConfirmation(), { target: { value: "motDePasseValide1" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le nouveau mot de passe" }));
    await screen.findByRole("heading", { name: "Mot de passe mis à jour" });

    for (const appel of surSetItem.mock.calls) {
      expect(appel.join(" ")).not.toContain(JETON);
    }
  });

  it("propose un lien de retour vers la connexion, y compris pendant la vérification", () => {
    apiMock.mockReturnValue(new Promise(() => {}));
    rendre();
    const lien = screen.getByRole("link", { name: "Retour à la connexion" });
    expect(lien.getAttribute("href")).toBe("/connexion");
  });
});
