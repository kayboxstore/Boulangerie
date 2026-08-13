// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { LoginPage } from "./Login";

const surLogin = vi.fn();

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ login: surLogin, messageSessionRemplacee: null }),
}));

afterEach(() => {
  cleanup();
  surLogin.mockReset();
});

function rendre() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe("LoginPage — DOM", () => {
  it("navigation vers « Mot de passe oublié ? » : un vrai lien, avec la bonne cible", () => {
    rendre();
    const lien = screen.getByRole("link", { name: "Mot de passe oublié ?" });
    expect(lien.getAttribute("href")).toBe("/mot-de-passe-oublie");
  });

  it("les champs e-mail et mot de passe sont joignables au clavier, dans l'ordre du formulaire", () => {
    rendre();
    const champEmail = screen.getByLabelText("Adresse e-mail") as HTMLInputElement;
    const champMotDePasse = screen.getByLabelText("Mot de passe") as HTMLInputElement;

    champEmail.focus();
    expect(document.activeElement).toBe(champEmail);
    champMotDePasse.focus();
    expect(document.activeElement).toBe(champMotDePasse);
  });

  it("soumet email/mot de passe saisis au gestionnaire de connexion", async () => {
    surLogin.mockResolvedValue(undefined);
    rendre();

    fireEvent.change(screen.getByLabelText("Adresse e-mail"), {
      target: { value: "chef@boulangerie-lomoto.com" },
    });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "motDePasseValide1" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(surLogin).toHaveBeenCalledWith("chef@boulangerie-lomoto.com", "motDePasseValide1");
  });

  it("affiche une erreur accessible (role=alert) si la connexion échoue, sans perdre le formulaire", async () => {
    surLogin.mockRejectedValue(new Error("Identifiants incorrects."));
    rendre();

    fireEvent.change(screen.getByLabelText("Adresse e-mail"), { target: { value: "chef@boulangerie-lomoto.com" } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "mauvais" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toBe("Identifiants incorrects.");
    expect(screen.getByLabelText("Adresse e-mail")).toBeTruthy();
  });
});
