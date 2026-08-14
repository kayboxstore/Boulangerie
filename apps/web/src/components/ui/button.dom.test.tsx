// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button } from "./button";

afterEach(cleanup);

describe("Button — DOM", () => {
  it("rendu normal : bouton actif, cliquable, non busy", () => {
    const surClic = vi.fn();
    render(<Button onClick={surClic}>Enregistrer</Button>);

    const bouton = screen.getByRole("button", { name: "Enregistrer" });
    expect((bouton as HTMLButtonElement).disabled).toBe(false);
    expect(bouton.hasAttribute("aria-busy")).toBe(false);

    fireEvent.click(bouton);
    expect(surClic).toHaveBeenCalledTimes(1);
  });

  it("état loading : désactive le bouton, empêche le clic et affiche aria-busy", () => {
    const surClic = vi.fn();
    render(
      <Button loading onClick={surClic}>
        Enregistrer
      </Button>,
    );

    const bouton = screen.getByRole("button", { name: "Enregistrer" });
    expect(bouton.getAttribute("aria-busy")).toBe("true");
    expect((bouton as HTMLButtonElement).disabled).toBe(true);

    // Un bouton natif désactivé ne déclenche aucun événement clic — vérifie
    // que le comportement réel du DOM (pas seulement l'attribut) empêche l'action.
    fireEvent.click(bouton);
    expect(surClic).not.toHaveBeenCalled();
  });

  it("bouton désactivé (disabled, sans loading) : pas de aria-busy", () => {
    render(<Button disabled>Enregistrer</Button>);

    const bouton = screen.getByRole("button", { name: "Enregistrer" });
    expect((bouton as HTMLButtonElement).disabled).toBe(true);
    expect(bouton.hasAttribute("aria-busy")).toBe(false);
  });

  it("conserve le libellé accessible même avec le spinner de chargement affiché", () => {
    render(<Button loading>Enregistrer</Button>);

    // Le nom accessible ne doit pas être pollué par l'icône du spinner
    // (marquée aria-hidden dans le composant) : le bouton doit rester
    // trouvable par son seul libellé visible.
    const bouton = screen.getByRole("button", { name: "Enregistrer" });
    expect(bouton.textContent).toContain("Enregistrer");
  });
});
