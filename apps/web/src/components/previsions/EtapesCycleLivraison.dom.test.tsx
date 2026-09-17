// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { EtapesCycleLivraison } from "./EtapesCycleLivraison";
import {
  RESULTATS_CYCLE_LIVRAISON,
  STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON,
  STATUTS_CYCLE_LIVRAISON,
  STATUTS_FINAUX_CYCLE_LIVRAISON,
} from "./cycleLivraisonLogique";

afterEach(() => {
  cleanup();
});

const LIBELLE_PAR_STATUT: Record<string, string> = {
  PREVISION: "Prévision",
  RETENUE_PRODUCTION: "Retenue Production",
  PREPAREE: "Préparée",
  REMISE_MAGASIN: "Remise au Magasin",
  CHARGEE: "Chargée",
  EN_TOURNEE: "En tournée",
  EN_ATTENTE_CONFIRMATION: "En attente de confirmation",
};

const LIBELLE_PAR_STATUT_FINAL: Record<string, string> = {
  PARTIELLEMENT_ACCEPTEE: "Partiellement acceptée",
  ACCEPTEE: "Acceptée intégralement",
  RETOUR_TOTAL: "Retour total",
  ANNULEE: "Annulée",
};

const LIBELLE_PAR_RESULTAT: Record<string, string> = {
  accepte: "Accepté",
  retourne: "Retourné",
  manquant: "Manquant",
};

describe("EtapesCycleLivraison — DOM (F4 round 1/2/3, complétée round 4 suite à la revue Codex)", () => {
  it("chronologie : sept statuts C4 exacts, dans l'ordre, comme une liste ordonnée accessible", () => {
    render(<EtapesCycleLivraison />);
    const chronologie = screen.getByRole("list", { name: "Chronologie du cycle prévision → livraison" });
    const items = within(chronologie).getAllByRole("listitem");
    expect(items).toHaveLength(7);
    const libellesRendus = items.map((li) => li.firstElementChild?.textContent);
    expect(libellesRendus).toEqual(STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON.map((s) => LIBELLE_PAR_STATUT[s]));
  });

  it("EN_TOURNEE se trouve exactement entre Chargée et En attente de confirmation", () => {
    render(<EtapesCycleLivraison />);
    const chronologie = screen.getByRole("list", { name: "Chronologie du cycle prévision → livraison" });
    const libelles = within(chronologie)
      .getAllByRole("listitem")
      .map((li) => li.firstElementChild?.textContent);
    expect(libelles.indexOf("En tournée")).toBe(libelles.indexOf("Chargée") + 1);
    expect(libelles.indexOf("En attente de confirmation")).toBe(libelles.indexOf("En tournée") + 1);
  });

  it("la chronologie s'arrête à « En attente de confirmation » — aucun statut d'acceptation n'y figure, et aucun « Déposé » n'est inventé", () => {
    render(<EtapesCycleLivraison />);
    const chronologie = screen.getByRole("list", { name: "Chronologie du cycle prévision → livraison" });
    const libelles = within(chronologie)
      .getAllByRole("listitem")
      .map((li) => li.firstElementChild?.textContent);
    expect(libelles[libelles.length - 1]).toBe("En attente de confirmation");
    expect(libelles).not.toContain("Déposé");
    expect(libelles).not.toContain("Accepté");
    expect(screen.queryByText("Déposé")).toBeNull();
  });

  it("les onze statuts C4 exacts sont tous rendus quelque part dans le composant (round 4)", () => {
    render(<EtapesCycleLivraison />);
    expect(STATUTS_CYCLE_LIVRAISON).toHaveLength(11);
    for (const statut of STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON) {
      expect(screen.getByText(LIBELLE_PAR_STATUT[statut])).toBeTruthy();
    }
    for (const statut of STATUTS_FINAUX_CYCLE_LIVRAISON) {
      expect(screen.getByText(LIBELLE_PAR_STATUT_FINAL[statut])).toBeTruthy();
    }
  });

  it("statuts finaux : quatre statuts C4 dans un groupe distinct, non chronologique, identifié par un titre accessible (round 4)", () => {
    render(<EtapesCycleLivraison />);
    const titreFinaux = screen.getByText("Statut final du cycle (un seul des quatre s'applique)");
    const groupe = titreFinaux.parentElement!;
    const liste = within(groupe).getByRole("list");
    expect(liste.tagName).toBe("UL");
    expect(liste.getAttribute("aria-labelledby")).toBe(titreFinaux.id);
    const items = within(liste).getAllByRole("listitem");
    expect(items.map((li) => li.firstElementChild?.textContent)).toEqual(
      STATUTS_FINAUX_CYCLE_LIVRAISON.map((s) => LIBELLE_PAR_STATUT_FINAL[s]),
    );
  });

  it("aucune flèche ne relie les statuts finaux entre eux (round 4)", () => {
    render(<EtapesCycleLivraison />);
    const titreFinaux = screen.getByText("Statut final du cycle (un seul des quatre s'applique)");
    const groupe = titreFinaux.parentElement!;
    const liste = within(groupe).getByRole("list");
    expect(liste.textContent).not.toContain("→");
  });

  it("les statuts finaux ne sont jamais confondus avec les quantités Accepté/Retourné/Manquant (round 4)", () => {
    render(<EtapesCycleLivraison />);
    const titreFinaux = screen.getByText("Statut final du cycle (un seul des quatre s'applique)");
    const groupeFinaux = titreFinaux.parentElement!;
    for (const libelleResultat of Object.values(LIBELLE_PAR_RESULTAT)) {
      expect(within(groupeFinaux).queryByText(libelleResultat)).toBeNull();
    }
    const titreResultats = screen.getByText("Résultats de la livraison (quantités distinctes, présentées en parallèle)");
    const groupeResultats = titreResultats.parentElement!;
    for (const libelleFinal of Object.values(LIBELLE_PAR_STATUT_FINAL)) {
      expect(within(groupeResultats).queryByText(libelleFinal)).toBeNull();
    }
  });

  it("résultats : Accepté, Retourné et Manquant forment un groupe PARALLÈLE distinct de la chronologie, identifié par un titre accessible", () => {
    render(<EtapesCycleLivraison />);
    const titreResultats = screen.getByText("Résultats de la livraison (quantités distinctes, présentées en parallèle)");
    const groupe = titreResultats.parentElement!;
    const liste = within(groupe).getByRole("list");
    expect(liste.getAttribute("aria-labelledby")).toBe(titreResultats.id);
    const items = within(liste).getAllByRole("listitem");
    expect(items.map((li) => li.firstElementChild?.textContent)).toEqual(
      RESULTATS_CYCLE_LIVRAISON.map((r) => LIBELLE_PAR_RESULTAT[r]),
    );
  });

  it("aucune flèche ne relie Accepté à Retourné ni Retourné à Manquant dans le groupe de résultats", () => {
    render(<EtapesCycleLivraison />);
    const titreResultats = screen.getByText("Résultats de la livraison (quantités distinctes, présentées en parallèle)");
    const groupe = titreResultats.parentElement!;
    const liste = within(groupe).getByRole("list");
    // Aucune flèche visible (aria-hidden "→") n'existe dans ce groupe — à la
    // différence de la chronologie, qui en contient entre chaque étape.
    expect(liste.textContent).not.toContain("→");
  });

  it("Facturable n'apparaît que comme conséquence de l'accepté — seule relation directionnelle du groupe final", () => {
    render(<EtapesCycleLivraison />);
    const consequence = screen.getByLabelText("Conséquence de l'acceptation");
    expect(consequence.textContent).toContain("Accepté");
    expect(consequence.textContent).toContain("Facturable");
    expect(consequence.textContent).toContain("→");
    // Facturable n'existe nulle part ailleurs que dans cette conséquence.
    expect(screen.getAllByText("Facturable")).toHaveLength(1);
    // Retourné/Manquant ne sont jamais associés à Facturable.
    expect(consequence.textContent).not.toContain("Retourné");
    expect(consequence.textContent).not.toContain("Manquant");
  });

  it("sans statut actif fourni : aucun badge n'a aria-current (round 2, conservé)", () => {
    render(<EtapesCycleLivraison />);
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
  });

  it("avec un statut actif de la chronologie : exactement ce badge porte aria-current=step", () => {
    render(<EtapesCycleLivraison statutActif="EN_TOURNEE" />);
    const actifs = document.querySelectorAll('[aria-current="step"]');
    expect(actifs).toHaveLength(1);
    expect(actifs[0].textContent).toBe("En tournée");
  });

  it("avec statutActif=ACCEPTEE (statut final) : le badge du groupe des statuts finaux porte aria-current=step (round 4)", () => {
    render(<EtapesCycleLivraison statutActif="ACCEPTEE" />);
    const actifs = document.querySelectorAll('[aria-current="step"]');
    expect(actifs).toHaveLength(1);
    expect(actifs[0].textContent).toBe("Acceptée intégralement");
  });

  it("avec un autre statut final (RETOUR_TOTAL) : le badge correspondant porte aria-current=step (round 4)", () => {
    render(<EtapesCycleLivraison statutActif="RETOUR_TOTAL" />);
    const actifs = document.querySelectorAll('[aria-current="step"]');
    expect(actifs).toHaveLength(1);
    expect(actifs[0].textContent).toBe("Retour total");
  });

  it("chaque badge (chronologie, statuts finaux, résultats, conséquence) a une description accessible via aria-describedby, pas seulement via title", () => {
    render(<EtapesCycleLivraison />);
    const badgeEnTournee = screen.getByText("En tournée");
    const idDescription = badgeEnTournee.getAttribute("aria-describedby");
    expect(idDescription).toBeTruthy();
    const description = document.getElementById(idDescription!);
    expect(description?.textContent).toContain("EN_TOURNEE");
    expect(description?.className).toContain("sr-only");

    const badgeAcceptee = screen.getByText("Acceptée intégralement");
    const idDescriptionFinal = badgeAcceptee.getAttribute("aria-describedby");
    expect(idDescriptionFinal).toBeTruthy();
    expect(document.getElementById(idDescriptionFinal!)?.className).toContain("sr-only");
  });

  it("décrit correctement la règle de manquant et la limite accepté+retourné dans les descriptions accessibles", () => {
    render(<EtapesCycleLivraison />);
    const badgeManquant = screen.getByText("Manquant");
    const descManquant = document.getElementById(badgeManquant.getAttribute("aria-describedby")!);
    expect(descManquant?.textContent).toContain("chargé");
    expect(descManquant?.textContent).toContain("déposé");
    expect(descManquant?.textContent).not.toContain("prévision");

    const badgeAccepte = within(
      screen.getByText("Résultats de la livraison (quantités distinctes, présentées en parallèle)").parentElement!,
    ).getByText("Accepté");
    const descAccepte = document.getElementById(badgeAccepte.getAttribute("aria-describedby")!);
    expect(descAccepte?.textContent).toContain("accepté + retourné");
  });

  it("n'affirme nulle part que les résultats sont indépendants les uns des autres (round 4)", () => {
    render(<EtapesCycleLivraison />);
    const texteComplet = document.body.textContent ?? "";
    expect(texteComplet).not.toMatch(/indépendant/i);
  });

  it("ne décrit jamais REMISE_MAGASIN comme « confirmée par les deux » (round 4)", () => {
    render(<EtapesCycleLivraison />);
    const badgeRemiseMagasin = screen.getByText("Remise au Magasin");
    const description = document.getElementById(badgeRemiseMagasin.getAttribute("aria-describedby")!);
    expect(description?.textContent).not.toContain("confirmée par les deux");
    expect(description?.textContent).toContain("remise interne");
  });

  it("ne décrit jamais PREPAREE comme la quantité réellement produite (round 4)", () => {
    render(<EtapesCycleLivraison />);
    const badgePreparee = screen.getByText("Préparée");
    const description = document.getElementById(badgePreparee.getAttribute("aria-describedby")!);
    expect(description?.textContent).not.toContain("réellement produite");
    expect(description?.textContent).toContain("préparée pour la livraison");
  });

  it("aucun statut « Déposé » inventé n'apparaît dans le composant (round 4, rappel)", () => {
    render(<EtapesCycleLivraison />);
    expect(screen.queryByText("Déposé")).toBeNull();
    expect(document.body.textContent).not.toContain("statut C4 DEPOSEE");
  });

  it("aucune donnée d'âge, de date de naissance ni financière dans les descriptions", () => {
    render(<EtapesCycleLivraison />);
    for (const el of Array.from(document.querySelectorAll(".sr-only"))) {
      expect(el.textContent ?? "").not.toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(el.textContent ?? "").not.toMatch(/\bFc\b/);
    }
  });
});
