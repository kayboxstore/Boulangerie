// @vitest-environment jsdom

import "@/i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FeedbackProvider, useFeedback } from "./FeedbackProvider";
import {
  DUREE_TOAST_DEFAUT_MS,
  emettreToast,
  reinitialiserCompteurToastPourTests,
  type ToastDemande,
} from "./toast/toastBus";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  reinitialiserCompteurToastPourTests();
});

// `emettreToast` est appelé ici HORS d'un gestionnaire d'évènement React
// (contrairement à un clic utilisateur, déjà enveloppé par `fireEvent`) :
// sans `act()`, la mise à jour d'état déclenchée dans FeedbackProvider n'est
// pas garantie flush avant l'assertion suivante. `act()` est l'utilitaire
// React standard pour ce cas — pas une réimplémentation du bus.
function emettre(demande: ToastDemande): number {
  let id = 0;
  act(() => {
    id = emettreToast(demande);
  });
  return id;
}

function DeclencheurToast() {
  const { toast } = useFeedback();
  return (
    <button type="button" onClick={() => toast({ variante: "succes", message: "Enregistré avec succès" })}>
      Déclencher
    </button>
  );
}

describe("FeedbackProvider + toastBus — DOM", () => {
  it("affiche les quatre variantes de toast avec le rôle ARIA attendu", () => {
    render(<FeedbackProvider>{null}</FeedbackProvider>);

    emettre({ variante: "succes", message: "Opération réussie" });
    emettre({ variante: "information", message: "Pour votre information" });
    emettre({ variante: "avertissement", message: "Attention à ceci" });
    emettre({ variante: "erreur", message: "Une erreur est survenue" });

    // succès/information → role="status" (aria-live polite) ; erreur/avertissement → role="alert".
    const statuts = screen.getAllByRole("status");
    const alertes = screen.getAllByRole("alert");
    expect(statuts).toHaveLength(2);
    expect(alertes).toHaveLength(1); // le 4ᵉ toast (erreur) est en file d'attente, MAX_TOASTS_VISIBLES=3

    expect(screen.getByText("Opération réussie")).toBeTruthy();
    expect(screen.getByText("Pour votre information")).toBeTruthy();
    expect(screen.getByText("Attention à ceci")).toBeTruthy();
    expect(screen.queryByText("Une erreur est survenue")).toBeNull();
  });

  it("émission via le contexte useFeedback() fonctionne comme l'émission directe via le bus", () => {
    render(
      <FeedbackProvider>
        <DeclencheurToast />
      </FeedbackProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Déclencher" }));
    expect(screen.getByText("Enregistré avec succès")).toBeTruthy();
  });

  it("le bouton de fermeture retire le toast affiché", () => {
    render(<FeedbackProvider>{null}</FeedbackProvider>);
    emettre({ variante: "information", message: "À fermer" });

    expect(screen.getByText("À fermer")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    expect(screen.queryByText("À fermer")).toBeNull();
  });

  it("file d'attente : un 4ᵉ toast attend qu'une place se libère (MAX_TOASTS_VISIBLES=3)", () => {
    render(<FeedbackProvider>{null}</FeedbackProvider>);
    emettre({ variante: "information", message: "Premier" });
    emettre({ variante: "information", message: "Deuxième" });
    emettre({ variante: "information", message: "Troisième" });
    emettre({ variante: "information", message: "Quatrième" });

    expect(screen.getByText("Premier")).toBeTruthy();
    expect(screen.getByText("Deuxième")).toBeTruthy();
    expect(screen.getByText("Troisième")).toBeTruthy();
    expect(screen.queryByText("Quatrième")).toBeNull();

    // Fermer le premier libère une place pour le quatrième, en attente.
    fireEvent.click(screen.getAllByRole("button", { name: "Fermer" })[0]);
    expect(screen.queryByText("Premier")).toBeNull();
    expect(screen.getByText("Quatrième")).toBeTruthy();
  });

  it("un toast persistant n'est jamais évincé par l'arrivée d'un 4ᵉ toast", () => {
    render(<FeedbackProvider>{null}</FeedbackProvider>);
    emettre({ variante: "erreur", message: "Erreur bloquante persistante", persistant: true });
    emettre({ variante: "information", message: "B" });
    emettre({ variante: "information", message: "C" });
    emettre({ variante: "information", message: "D (en file d'attente)" });

    expect(screen.getByText("Erreur bloquante persistante")).toBeTruthy();
    expect(screen.queryByText("D (en file d'attente)")).toBeNull();
  });

  it("temporisation contrôlée par de faux minuteurs : fermeture automatique après la durée par défaut, suspendue au survol", () => {
    vi.useFakeTimers();
    render(<FeedbackProvider>{null}</FeedbackProvider>);
    emettre({ variante: "succes", message: "Disparaît tout seul" });

    const toastEl = screen.getByText("Disparaît tout seul").closest('[role="status"]') as HTMLElement;
    expect(toastEl).not.toBeNull();

    // Le survol suspend le minuteur : même après la durée complète, le toast reste.
    fireEvent.mouseEnter(toastEl);
    act(() => {
      vi.advanceTimersByTime(DUREE_TOAST_DEFAUT_MS);
    });
    expect(screen.getByText("Disparaît tout seul")).toBeTruthy();

    // Sortie du survol : le minuteur reprend pour le temps restant (la durée complète, non consommée).
    fireEvent.mouseLeave(toastEl);
    act(() => {
      vi.advanceTimersByTime(DUREE_TOAST_DEFAUT_MS);
    });
    expect(screen.queryByText("Disparaît tout seul")).toBeNull();
  });

  it("temporisation : un toast non survolé se ferme tout seul après la durée par défaut", () => {
    vi.useFakeTimers();
    render(<FeedbackProvider>{null}</FeedbackProvider>);
    emettre({ variante: "succes", message: "Fermeture automatique" });

    expect(screen.getByText("Fermeture automatique")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(DUREE_TOAST_DEFAUT_MS);
    });
    expect(screen.queryByText("Fermeture automatique")).toBeNull();
  });
});
