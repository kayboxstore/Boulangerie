// @vitest-environment jsdom

import "@/i18n";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AutoTextarea } from "./auto-textarea";

afterEach(cleanup);

function ZoneControlee({
  valeurInitiale = "",
  limiteCaracteres,
  style,
}: {
  valeurInitiale?: string;
  limiteCaracteres?: number;
  style?: React.CSSProperties;
}) {
  const [valeur, setValeur] = React.useState(valeurInitiale);
  return (
    <div>
      <AutoTextarea
        aria-label="Notes"
        value={valeur}
        onChange={(e) => setValeur(e.target.value)}
        limiteCaracteres={limiteCaracteres}
        style={style}
      />
      <button type="button" onClick={() => setValeur("valeur imposée par le parent")}>
        Réinitialiser depuis le parent
      </button>
    </div>
  );
}

describe("AutoTextarea — DOM", () => {
  it("saisie utilisateur : propage onChange et met à jour la valeur affichée (contrôlée)", () => {
    render(<ZoneControlee />);
    const zone = screen.getByLabelText("Notes") as HTMLTextAreaElement;

    fireEvent.change(zone, { target: { value: "Bonjour le monde" } });

    expect(zone.value).toBe("Bonjour le monde");
  });

  it("valeur contrôlée mise à jour depuis le PARENT (pas via la saisie utilisateur) : la zone suit", () => {
    render(<ZoneControlee valeurInitiale="ancienne valeur" />);
    const zone = screen.getByLabelText("Notes") as HTMLTextAreaElement;
    expect(zone.value).toBe("ancienne valeur");

    fireEvent.click(screen.getByRole("button", { name: "Réinitialiser depuis le parent" }));

    expect(zone.value).toBe("valeur imposée par le parent");
  });

  it("le compteur de caractères se resynchronise à la fois sur la saisie ET sur une valeur imposée par le parent", () => {
    render(<ZoneControlee valeurInitiale="12345" limiteCaracteres={20} />);
    const zone = screen.getByLabelText("Notes") as HTMLTextAreaElement;

    expect(screen.getByText("5 / 20 caractères")).toBeTruthy();

    fireEvent.change(zone, { target: { value: "1234567890" } });
    expect(screen.getByText("10 / 20 caractères")).toBeTruthy();

    // Changement programmatique (pas une frappe utilisateur) : le compteur
    // round 2 avait un bug précisément ici — il restait figé sur la longueur
    // du tout premier rendu tant que gererChangement() n'était pas déclenché.
    fireEvent.click(screen.getByRole("button", { name: "Réinitialiser depuis le parent" }));
    expect(screen.getByText("28 / 20 caractères")).toBeTruthy(); // "valeur imposée par le parent".length === 28
  });

  it("conserve le style fourni par l'appelant tout en imposant maxHeight", () => {
    render(<ZoneControlee style={{ color: "rgb(255, 0, 0)" }} />);
    const zone = screen.getByLabelText("Notes") as HTMLTextAreaElement;

    // Le style de l'appelant (round 2 : bug de fusion, `style` était écrasé
    // par le spread de `...props` qui suivait dans le JSX) doit survivre...
    expect(zone.style.color).toBe("rgb(255, 0, 0)");
    // ...ET la limite de hauteur du composant doit toujours s'appliquer par-dessus.
    expect(zone.style.maxHeight).toBe("320px");
  });

  it("respecte une hauteurMaxPx personnalisée dans le style calculé", () => {
    function ZoneAvecHauteur() {
      const [valeur, setValeur] = React.useState("");
      return (
        <AutoTextarea aria-label="Description" value={valeur} onChange={(e) => setValeur(e.target.value)} hauteurMaxPx={150} />
      );
    }
    render(<ZoneAvecHauteur />);
    const zone = screen.getByLabelText("Description") as HTMLTextAreaElement;
    expect(zone.style.maxHeight).toBe("150px");
  });

  it("n'affiche aucun compteur quand limiteCaracteres est omis", () => {
    render(<ZoneControlee valeurInitiale="du texte" />);
    expect(screen.queryByText(/caractères/)).toBeNull();
  });
});
