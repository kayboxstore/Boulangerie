// @vitest-environment jsdom

import "@/i18n";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Label } from "@/components/ui/label";
import { PasswordField } from "./password-field";

afterEach(cleanup);

describe("PasswordField — DOM", () => {
  it("type password au départ", () => {
    render(<PasswordField value="secret" onChange={() => {}} />);
    const bouton = screen.getByRole("button", { name: "Afficher le mot de passe" });
    const champ = bouton.parentElement?.querySelector("input") as HTMLInputElement;
    expect(champ.type).toBe("password");
  });

  it("affiche puis masque le mot de passe au clic sur le bouton bascule", () => {
    render(<PasswordField value="secret" onChange={() => {}} />);

    const champ = screen.getByDisplayValue("secret") as HTMLInputElement;
    expect(champ.type).toBe("password");

    const boutonAfficher = screen.getByRole("button", { name: "Afficher le mot de passe" });
    expect(boutonAfficher.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(boutonAfficher);

    expect(champ.type).toBe("text");
    const boutonMasquer = screen.getByRole("button", { name: "Masquer le mot de passe" });
    expect(boutonMasquer.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(boutonMasquer);
    expect(champ.type).toBe("password");
  });

  it("bouton bascule accessible au clavier : élément <button> natif, dans l'ordre de tabulation", () => {
    render(<PasswordField value="secret" onChange={() => {}} />);
    const bouton = screen.getByRole("button", { name: "Afficher le mot de passe" }) as HTMLButtonElement;

    // Un <button type="button"> natif est activable au clavier (Entrée/Espace)
    // par la plateforme elle-même — le composant doit rester ce véritable
    // élément (pas un <div onClick>) et rester joignable par tabulation.
    expect(bouton.tagName).toBe("BUTTON");
    expect(bouton.type).toBe("button");
    expect(bouton.tabIndex).toBe(0);

    bouton.focus();
    expect(document.activeElement).toBe(bouton);
  });

  it("association libellé/champ/aide : le label cible le champ, l'indicateur de robustesse est annoncé via aria-describedby", () => {
    function Formulaire() {
      const [valeur, setValeur] = React.useState("abcdefgh");
      return (
        <div>
          <Label htmlFor="mdp-creation">Mot de passe</Label>
          <PasswordField
            id="mdp-creation"
            afficherRobustesse
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
          />
        </div>
      );
    }
    render(<Formulaire />);

    // Association label ↔ champ (via htmlFor/id) : le champ est trouvable par son libellé.
    const champ = screen.getByLabelText("Mot de passe") as HTMLInputElement;
    expect(champ).toBeTruthy();
    expect(champ.id).toBe("mdp-creation");

    // Association champ ↔ aide (robustesse) : aria-describedby pointe vers un
    // élément réellement présent dans le document et qui contient le texte
    // d'aide affiché.
    const idsDecrivant = champ.getAttribute("aria-describedby");
    expect(idsDecrivant).toBeTruthy();
    const elementAide = document.getElementById(idsDecrivant!.split(" ")[0]);
    expect(elementAide).not.toBeNull();
    expect(elementAide!.textContent).toContain("Faible");
  });

  it("n'ajoute pas d'aria-describedby quand la robustesse n'est pas affichée", () => {
    render(<PasswordField value="secret" onChange={() => {}} />);
    const champ = screen.getByDisplayValue("secret") as HTMLInputElement;
    expect(champ.hasAttribute("aria-describedby")).toBe(false);
  });

  it("propage les changements de saisie (onChange) sur un champ réellement contrôlé", () => {
    const surChangement = vi.fn();
    function Formulaire() {
      const [valeur, setValeur] = React.useState("");
      return (
        <PasswordField
          value={valeur}
          onChange={(e) => {
            surChangement(e.target.value);
            setValeur(e.target.value);
          }}
        />
      );
    }
    render(<Formulaire />);
    const bouton = screen.getByRole("button", { name: "Afficher le mot de passe" });
    const champ = bouton.parentElement?.querySelector("input") as HTMLInputElement;

    fireEvent.change(champ, { target: { value: "nouveauMotDePasse" } });

    expect(surChangement).toHaveBeenCalledTimes(1);
    expect(surChangement).toHaveBeenCalledWith("nouveauMotDePasse");
    // La valeur contrôlée reflète bien la saisie une fois l'état parent mis à jour.
    expect(champ.value).toBe("nouveauMotDePasse");
  });
});
