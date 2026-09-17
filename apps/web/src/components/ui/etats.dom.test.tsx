// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EtatChargement, EtatErreur, EtatHorsLigne, EtatVide } from "./etats";

afterEach(cleanup);

describe("États Premium — DOM", () => {
  it("EtatVide : titre par défaut, remplaçable par l'appelant", () => {
    const { rerender } = render(<EtatVide />);
    expect(screen.getByText("Aucun élément à afficher")).toBeTruthy();

    rerender(<EtatVide titre="Aucun fournisseur" description="Ajoutez-en un pour commencer." />);
    expect(screen.getByText("Aucun fournisseur")).toBeTruthy();
    expect(screen.getByText("Ajoutez-en un pour commencer.")).toBeTruthy();
  });

  it("EtatChargement : rôle status annoncé aux technologies d'assistance", () => {
    render(<EtatChargement />);
    const statut = screen.getByRole("status");
    expect(statut.getAttribute("aria-live")).toBe("polite");
    expect(screen.getByText("Chargement…")).toBeTruthy();
  });

  it("EtatHorsLigne : titre et description informent l'utilisateur", () => {
    render(<EtatHorsLigne />);
    expect(screen.getByText("Aucune connexion")).toBeTruthy();
    expect(screen.getByText("Vérifiez votre connexion internet et réessayez.")).toBeTruthy();
  });

  it("bouton « Réessayer » réellement fonctionnel et accessible (EtatHorsLigne)", () => {
    const surReessayer = vi.fn();
    render(<EtatHorsLigne onReessayer={surReessayer} />);

    const bouton = screen.getByRole("button", { name: "Réessayer" });
    fireEvent.click(bouton);
    expect(surReessayer).toHaveBeenCalledTimes(1);
  });

  it("sans callback onReessayer, aucun bouton « Réessayer » n'est rendu", () => {
    render(<EtatHorsLigne />);
    expect(screen.queryByRole("button", { name: "Réessayer" })).toBeNull();
  });

  it("bouton « Réessayer » également fonctionnel sur EtatErreur, avec le message fourni", () => {
    const surReessayer = vi.fn();
    render(<EtatErreur message="Le serveur n'a pas répondu." onReessayer={surReessayer} />);

    expect(screen.getByText("Une erreur est survenue")).toBeTruthy();
    expect(screen.getByText("Le serveur n'a pas répondu.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(surReessayer).toHaveBeenCalledTimes(1);
  });
});
