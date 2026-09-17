// @vitest-environment jsdom

import "@/i18n";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PremiumTable, type ColonnePremiumTable } from "./premium-table";

afterEach(cleanup);

interface Fournisseur {
  id: string;
  nom: string;
  ville: string;
}

const FOURNISSEURS: Fournisseur[] = [
  { id: "1", nom: "Boulangerie Nord", ville: "Kinshasa" },
  { id: "2", nom: "Atelier Sud", ville: "Lubumbashi" },
  { id: "3", nom: "Minoterie Est", ville: "Goma" },
];

const COLONNES: ColonnePremiumTable<Fournisseur>[] = [
  { cle: "nom", titre: "Nom", rendu: (f) => f.nom, valeurTri: (f) => f.nom, triable: true },
  { cle: "ville", titre: "Ville", rendu: (f) => f.ville },
];

// Rendu ET mobile ET ordinateur coexistent dans le DOM en jsdom (aucune
// feuille de style Tailwind chargée pour interpréter `hidden md:block` /
// `md:hidden`) — toutes les assertions de contenu sont donc scopées au
// <table> réel (rôle "table"), pour ne jamais confondre les deux vues.
function table() {
  return screen.getByRole("table");
}

describe("PremiumTable — DOM", () => {
  it("rend les données fournies", () => {
    render(<PremiumTable donnees={FOURNISSEURS} colonnes={COLONNES} cleId={(f) => f.id} titreMobile={(f) => f.nom} />);

    const t = within(table());
    expect(t.getByText("Boulangerie Nord")).toBeTruthy();
    expect(t.getByText("Atelier Sud")).toBeTruthy();
    expect(t.getByText("Minoterie Est")).toBeTruthy();
    expect(t.getByText("Kinshasa")).toBeTruthy();
  });

  it("trie par colonne au clic sur l'en-tête triable", () => {
    render(<PremiumTable donnees={FOURNISSEURS} colonnes={COLONNES} cleId={(f) => f.id} titreMobile={(f) => f.nom} />);

    const boutonTri = within(table()).getByRole("button", { name: /Nom/ });
    fireEvent.click(boutonTri); // 1er clic : tri ascendant

    let lignes = within(table()).getAllByRole("row").slice(1); // sans l'en-tête
    let premiereLigneApresAsc = within(lignes[0]).getByText(/Atelier Sud|Boulangerie Nord|Minoterie Est/).textContent;
    expect(premiereLigneApresAsc).toBe("Atelier Sud"); // ordre alphabétique : Atelier < Boulangerie < Minoterie

    fireEvent.click(boutonTri); // 2e clic : bascule en tri descendant
    lignes = within(table()).getAllByRole("row").slice(1);
    const premiereLigneApresDesc = within(lignes[0]).getByText(/Atelier Sud|Boulangerie Nord|Minoterie Est/).textContent;
    expect(premiereLigneApresDesc).toBe("Minoterie Est");
  });

  it("filtre via la barre de recherche", () => {
    render(
      <PremiumTable
        donnees={FOURNISSEURS}
        colonnes={COLONNES}
        cleId={(f) => f.id}
        titreMobile={(f) => f.nom}
        champsRecherche={(f) => [f.nom, f.ville]}
      />,
    );

    const recherche = screen.getByRole("searchbox");
    fireEvent.change(recherche, { target: { value: "Goma" } });

    const t = within(table());
    expect(t.getByText("Minoterie Est")).toBeTruthy();
    expect(t.queryByText("Boulangerie Nord")).toBeNull();
    expect(t.queryByText("Atelier Sud")).toBeNull();
  });

  it("sélection par case à cocher : nom accessible et callback appelé avec le bon ensemble", () => {
    const surChangementSelection = vi.fn();
    function Conteneur() {
      const [selectionnes, setSelectionnes] = React.useState<Set<string>>(new Set());
      return (
        <PremiumTable
          donnees={FOURNISSEURS}
          colonnes={COLONNES}
          cleId={(f) => f.id}
          titreMobile={(f) => f.nom}
          selection={{
            selectionnes,
            onChange: (s) => {
              surChangementSelection(s);
              setSelectionnes(s);
            },
          }}
        />
      );
    }
    render(<Conteneur />);

    const cases = within(table()).getAllByRole("checkbox", { name: "Sélectionner cette ligne" });
    expect(cases).toHaveLength(FOURNISSEURS.length);

    fireEvent.click(cases[0]);
    expect(surChangementSelection).toHaveBeenCalledWith(new Set(["1"]));
    expect((cases[0] as HTMLInputElement).checked).toBe(true);

    fireEvent.click(cases[0]);
    expect(surChangementSelection).toHaveBeenLastCalledWith(new Set());
  });

  it("affiche l'état vide quand aucune donnée n'est fournie", () => {
    render(<PremiumTable donnees={[]} colonnes={COLONNES} cleId={(f: Fournisseur) => f.id} titreMobile={(f: Fournisseur) => f.nom} />);

    expect(screen.getByText("Aucun élément à afficher")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("pagination bornée : n'affiche que taillePage lignes par page", () => {
    const donneesEtendues: Fournisseur[] = Array.from({ length: 5 }, (_, i) => ({
      id: String(i + 1),
      nom: `Fournisseur ${i + 1}`,
      ville: "Kinshasa",
    }));

    render(
      <PremiumTable
        donnees={donneesEtendues}
        colonnes={COLONNES}
        cleId={(f) => f.id}
        titreMobile={(f) => f.nom}
        taillePage={2}
      />,
    );

    // 5 éléments, 2 par page → 3 pages ; la première page ne montre que 2 lignes.
    let lignes = within(table()).getAllByRole("row").slice(1);
    expect(lignes).toHaveLength(2);
    expect(within(table()).getByText("Fournisseur 1")).toBeTruthy();
    expect(within(table()).queryByText("Fournisseur 3")).toBeNull();

    // Navigation vers la page suivante : bornée par le composant Pagination interne.
    fireEvent.click(screen.getByRole("button", { name: "Page suivante" }));
    lignes = within(table()).getAllByRole("row").slice(1);
    expect(within(table()).getByText("Fournisseur 3")).toBeTruthy();
  });

  it("page rabattue quand les données diminuent SOUS la page où l'utilisateur se trouve déjà (rerender, sans démontage)", () => {
    const SIX: Fournisseur[] = Array.from({ length: 6 }, (_, i) => ({
      id: String(i + 1),
      nom: `Fournisseur ${i + 1}`,
      ville: "Kinshasa",
    }));

    const { rerender } = render(
      <PremiumTable donnees={SIX} colonnes={COLONNES} cleId={(f) => f.id} titreMobile={(f) => f.nom} taillePage={2} />,
    );

    // 6 éléments, 2 par page → 3 pages. Navigue jusqu'à la DERNIÈRE page,
    // valide au moment du clic.
    fireEvent.click(screen.getByRole("button", { name: "Aller à la page 3" }));
    expect(within(table()).getByText("Fournisseur 5")).toBeTruthy();
    expect(within(table()).getByText("Fournisseur 6")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Page suivante" }) as HTMLButtonElement).disabled).toBe(true);

    // Réduit les données SANS démonter le composant (rerender de la MÊME
    // instance, l'état interne `page` — toujours à 3 — est conservé) : avec
    // seulement 2 éléments restants et 2 par page, il n'y a plus qu'UNE
    // seule page. La page 3 est désormais hors bornes.
    const DEUX = SIX.slice(0, 2);
    rerender(
      <PremiumTable donnees={DEUX} colonnes={COLONNES} cleId={(f) => f.id} titreMobile={(f) => f.nom} taillePage={2} />,
    );

    // La page effective est immédiatement rabattue à 1 — les bonnes lignes
    // s'affichent, sans page vide ni clignotement — et les contrôles de
    // pagination reflètent cette page bornée (plus de page précédente/suivante).
    expect(within(table()).getByText("Fournisseur 1")).toBeTruthy();
    expect(within(table()).getByText("Fournisseur 2")).toBeTruthy();
    expect(within(table()).queryByText("Fournisseur 5")).toBeNull();
    expect((screen.getByRole("button", { name: "Page précédente" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Page suivante" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
