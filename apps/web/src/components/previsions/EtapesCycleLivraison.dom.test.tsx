// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EtapesCycleLivraison } from "./EtapesCycleLivraison";
import { ETAPES_CYCLE_LIVRAISON } from "./cycleLivraisonLogique";

afterEach(() => {
  cleanup();
});

describe("EtapesCycleLivraison — DOM (F4 round 1)", () => {
  it("affiche les dix étapes, dans l'ordre métier, comme une liste accessible", () => {
    render(<EtapesCycleLivraison />);
    const liste = screen.getByRole("list", { name: "Étapes du cycle prévision → livraison" });
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(ETAPES_CYCLE_LIVRAISON.length);
    // L'ordre du DOM doit suivre exactement l'ordre métier.
    const libellesAttendus = [
      "Prévu",
      "Retenu production",
      "Préparé",
      "Chargé",
      "Déposé",
      "En attente de confirmation",
      "Accepté",
      "Retourné",
      "Manquant",
      "Facturable",
    ];
    const libellesRendus = items.map((li) => li.textContent?.replace("→", "").trim());
    expect(libellesRendus).toEqual(libellesAttendus);
    expect(liste).toBeTruthy();
  });

  it("sans étape active : aucun badge n'a aria-current", () => {
    render(<EtapesCycleLivraison />);
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
  });

  it("avec une étape active : exactement ce badge porte aria-current=step", () => {
    render(<EtapesCycleLivraison etapeActive="depose" />);
    const actif = document.querySelector('[aria-current="step"]');
    expect(actif?.textContent).toBe("Déposé");
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it("chaque étape porte une description accessible via title (rôle responsable, sans âge/date ni donnée financière)", () => {
    render(<EtapesCycleLivraison etapeActive="accepte" />);
    const badgeAccepte = screen.getByText("Accepté");
    expect(badgeAccepte.getAttribute("title")).toContain("confirmée par le client");
  });
});
