// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "@/lib/api";
import { MotDePasseOubliePage } from "./MotDePasseOublie";

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

function rendre() {
  return render(
    <MemoryRouter>
      <MotDePasseOubliePage />
    </MemoryRouter>,
  );
}

function soumettre(email = "chef.boulanger@boulangerie-lomoto.com") {
  fireEvent.change(screen.getByLabelText("Adresse e-mail"), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: "Envoyer la demande" }));
}

describe("MotDePasseOubliePage — DOM (F3, connectée à l'API C3)", () => {
  it("association libellé/champ : le champ e-mail est trouvable par son libellé", () => {
    rendre();
    const champ = screen.getByLabelText("Adresse e-mail") as HTMLInputElement;
    expect(champ.id).toBe("email-recuperation");
  });

  it("refuse une adresse e-mail invalide localement, sans jamais appeler l'API", () => {
    rendre();
    soumettre("pas-un-email");

    expect(screen.getByRole("alert").textContent).toBe("Saisissez une adresse e-mail valide.");
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("appelle POST /api/auth/mot-de-passe-oublie avec l'e-mail saisi", async () => {
    apiMock.mockResolvedValue({ message: "peu importe" });
    rendre();
    soumettre("chef.boulanger@boulangerie-lomoto.com");

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/api/auth/mot-de-passe-oublie", {
        method: "POST",
        body: JSON.stringify({ email: "chef.boulanger@boulangerie-lomoto.com" }),
      }),
    );
  });

  it("202 : affiche un message persistant unique de succès (role=status)", async () => {
    apiMock.mockResolvedValue({ message: "Si cette adresse correspond à un compte actif…" });
    rendre();
    soumettre();

    const statuts = await screen.findAllByRole("status");
    expect(statuts).toHaveLength(1);
    expect(statuts[0].textContent).toContain("un lien de réinitialisation vient d'être envoyé");
  });

  it("anti-énumération préservée : le message affiché est identique quel que soit le corps renvoyé par le serveur", async () => {
    apiMock.mockResolvedValueOnce({ message: "un texte quelconque A" });
    rendre();
    soumettre("compte.existant@boulangerie-lomoto.com");
    const premierMessage = (await screen.findByRole("status")).textContent;

    cleanup();
    apiMock.mockResolvedValueOnce({});
    rendre();
    soumettre("compte.inexistant@boulangerie-lomoto.com");
    const secondMessage = (await screen.findByRole("status")).textContent;

    expect(premierMessage).toBe(secondMessage);
  });

  it("400 (rejeté par le serveur) : affiche le message d'erreur du serveur, jamais un succès", async () => {
    apiMock.mockRejectedValue(new ApiError(400, "Adresse e-mail invalide"));
    rendre();
    soumettre();

    expect((await screen.findByRole("alert")).textContent).toBe("Adresse e-mail invalide");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("429 (limitation de fréquence) : affiche le message du serveur", async () => {
    apiMock.mockRejectedValue(
      new ApiError(429, "Trop de tentatives. Patientez quelques minutes avant de réessayer."),
    );
    rendre();
    soumettre();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Trop de tentatives. Patientez quelques minutes avant de réessayer.",
    );
  });

  it("panne réseau : affiche un message générique, jamais un succès", async () => {
    apiMock.mockRejectedValue(new ApiError(0, "Impossible de contacter le serveur — vérifiez votre connexion internet."));
    rendre();
    soumettre();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Impossible de contacter le serveur — vérifiez votre connexion internet.",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("empêche une double soumission : l'API n'est appelée qu'une seule fois même sur double clic rapide", async () => {
    let resoudre!: (v: unknown) => void;
    apiMock.mockReturnValue(new Promise((r) => (resoudre = r)));
    rendre();

    fireEvent.change(screen.getByLabelText("Adresse e-mail"), {
      target: { value: "chef.boulanger@boulangerie-lomoto.com" },
    });
    const bouton = screen.getByRole("button", { name: "Envoyer la demande" });
    fireEvent.click(bouton);
    fireEvent.click(bouton);
    fireEvent.click(bouton);

    expect(apiMock).toHaveBeenCalledTimes(1);
    resoudre({ message: "ok" });
    await screen.findByRole("status");
  });

  it("propose un lien de retour vers la connexion", () => {
    rendre();
    const lien = screen.getByRole("link", { name: "Retour à la connexion" });
    expect(lien.getAttribute("href")).toBe("/connexion");
  });
});
