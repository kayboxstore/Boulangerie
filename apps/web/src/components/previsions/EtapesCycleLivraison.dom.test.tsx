// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EtapesCycleLivraison } from "./EtapesCycleLivraison";
import { ETAPES_CYCLE_LIVRAISON } from "./cycleLivraisonLogique";

afterEach(() => {
  cleanup();
});

describe("EtapesCycleLivraison — DOM (F4 round 1, corrigé round 2)", () => {
  it("affiche les onze étapes, dans l'ordre métier (remisMagasin inclus), comme une liste accessible", () => {
    render(<EtapesCycleLivraison />);
    const liste = screen.getByRole("list", { name: "Étapes du cycle prévision → livraison" });
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(ETAPES_CYCLE_LIVRAISON.length);
    // Seul le libellé visible du badge (premier enfant du <li>) est comparé —
    // le <li> contient aussi désormais la description accessible (sr-only,
    // round 2), qui ferait échouer une comparaison sur le textContent complet.
    const libellesAttendus = [
      "Prévu",
      "Retenu production",
      "Préparé",
      "Remis au Magasin",
      "Chargé",
      "Déposé",
      "En attente de confirmation",
      "Accepté",
      "Retourné",
      "Manquant",
      "Facturable",
    ];
    const libellesRendus = items.map((li) => li.firstElementChild?.textContent);
    expect(libellesRendus).toEqual(libellesAttendus);
    expect(liste).toBeTruthy();
  });

  it("remisMagasin (remise Production → Magasin) apparaît bien entre Préparé et Chargé", () => {
    render(<EtapesCycleLivraison />);
    const items = screen.getAllByRole("listitem").map((li) => li.firstElementChild?.textContent);
    const indexPrepare = items.indexOf("Préparé");
    const indexRemis = items.indexOf("Remis au Magasin");
    const indexCharge = items.indexOf("Chargé");
    expect(indexPrepare).toBeLessThan(indexRemis);
    expect(indexRemis).toBeLessThan(indexCharge);
  });

  it("sans étape active : aucun badge n'a aria-current", () => {
    render(<EtapesCycleLivraison />);
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
  });

  it("avec une étape active explicitement fournie : exactement ce badge porte aria-current=step", () => {
    render(<EtapesCycleLivraison etapeActive="depose" />);
    const actif = document.querySelector('[aria-current="step"]');
    expect(actif?.textContent).toBe("Déposé");
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it("chaque étape a une description accessible via aria-describedby, PAS seulement via l'attribut title (round 2, revue Codex)", () => {
    render(<EtapesCycleLivraison etapeActive="accepte" />);
    const badgeAccepte = screen.getByText("Accepté");
    const idDescription = badgeAccepte.getAttribute("aria-describedby");
    expect(idDescription).toBeTruthy();
    const description = document.getElementById(idDescription!);
    expect(description).toBeTruthy();
    expect(description?.textContent).toContain("confirmée par le client");
    // La description doit être un texte RÉEL dans le DOM (accessible sans
    // survol souris ni title), visuellement masqué via sr-only.
    expect(description?.className).toContain("sr-only");
  });

  it("aucune donnée d'âge, de date de naissance ni financière dans les descriptions", () => {
    render(<EtapesCycleLivraison />);
    for (const etape of ETAPES_CYCLE_LIVRAISON) {
      const badge = screen.getByText(
        {
          prevu: "Prévu",
          retenuProduction: "Retenu production",
          prepare: "Préparé",
          remisMagasin: "Remis au Magasin",
          charge: "Chargé",
          depose: "Déposé",
          enAttenteConfirmation: "En attente de confirmation",
          accepte: "Accepté",
          retourne: "Retourné",
          manquant: "Manquant",
          facturable: "Facturable",
        }[etape],
      );
      const idDescription = badge.getAttribute("aria-describedby");
      const description = document.getElementById(idDescription!)?.textContent ?? "";
      expect(description).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(description).not.toMatch(/Fc\b/);
    }
  });
});
