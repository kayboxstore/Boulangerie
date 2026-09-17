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
  it("affiche les quatre variantes de toast, réellement rendues et contrôlées dans le DOM", () => {
    render(<FeedbackProvider>{null}</FeedbackProvider>);

    emettre({ variante: "succes", message: "Opération réussie" });
    emettre({ variante: "information", message: "Pour votre information" });
    emettre({ variante: "avertissement", message: "Attention à ceci" });
    emettre({ variante: "erreur", message: "Une erreur est survenue" });

    // succès/information → role="status" (aria-live polite) ; avertissement/erreur → role="alert".
    // MAX_TOASTS_VISIBLES=3 : le 4ᵉ (erreur) est d'abord en file d'attente, pas encore dans le DOM.
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByText("Opération réussie")).toBeTruthy();
    expect(screen.getByText("Pour votre information")).toBeTruthy();
    expect(screen.getByText("Attention à ceci")).toBeTruthy();
    expect(screen.queryByText("Une erreur est survenue")).toBeNull();

    // Libère une place : le 4ᵉ toast (erreur) doit alors être RÉELLEMENT rendu,
    // avec le rôle ARIA attendu — les quatre variantes sont ainsi toutes
    // vérifiées dans le DOM, pas seulement les trois premières.
    fireEvent.click(screen.getAllByRole("button", { name: "Fermer" })[0]);

    const erreur = screen.getByText("Une erreur est survenue");
    expect(erreur).toBeTruthy();
    const conteneurErreur = erreur.closest('[role="alert"]');
    expect(conteneurErreur).not.toBeNull();
    expect(screen.getAllByRole("alert")).toHaveLength(2); // avertissement + erreur, désormais toutes deux visibles
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

  it("temporisation contrôlée par de faux minuteurs : le survol suspend puis reprend pour le VRAI temps restant", () => {
    vi.useFakeTimers();
    render(<FeedbackProvider>{null}</FeedbackProvider>);
    emettre({ variante: "succes", message: "Disparaît tout seul" });

    const toastEl = screen.getByText("Disparaît tout seul").closest('[role="status"]') as HTMLElement;
    expect(toastEl).not.toBeNull();

    // Une partie de la durée s'écoule AVANT le survol (2000 ms sur 6000 ms) :
    // le temps restant au moment de la pause doit donc être de 4000 ms, pas
    // la durée totale — c'est précisément ce que ce test doit prouver.
    const ECOULE_AVANT_SURVOL = 2000;
    const RESTE_ATTENDU = DUREE_TOAST_DEFAUT_MS - ECOULE_AVANT_SURVOL;
    act(() => {
      vi.advanceTimersByTime(ECOULE_AVANT_SURVOL);
    });
    expect(screen.getByText("Disparaît tout seul")).toBeTruthy();

    fireEvent.mouseEnter(toastEl);
    // Même la durée totale (6000 ms) ne suffit plus à fermer le toast tant
    // qu'il reste en pause — la preuve que le minuteur est bien arrêté, pas
    // seulement ralenti.
    act(() => {
      vi.advanceTimersByTime(DUREE_TOAST_DEFAUT_MS);
    });
    expect(screen.getByText("Disparaît tout seul")).toBeTruthy();

    fireEvent.mouseLeave(toastEl);
    // Juste avant l'expiration du temps restant réel (4000 ms) : encore présent.
    act(() => {
      vi.advanceTimersByTime(RESTE_ATTENDU - 1);
    });
    expect(screen.getByText("Disparaît tout seul")).toBeTruthy();

    // Exactement à l'expiration du temps restant : retiré.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Disparaît tout seul")).toBeNull();
  });

  it("pause multi-source : focus actif + entrée/sortie du survol → aucune reprise avant le blur, temps restant conservé", () => {
    vi.useFakeTimers();
    render(<FeedbackProvider>{null}</FeedbackProvider>);
    emettre({ variante: "succes", message: "Focus puis survol" });
    const toastEl = screen.getByText("Focus puis survol").closest('[role="status"]') as HTMLElement;

    const ECOULE_AVANT_FOCUS = 1000;
    const RESTE_ATTENDU = DUREE_TOAST_DEFAUT_MS - ECOULE_AVANT_FOCUS;
    act(() => {
      vi.advanceTimersByTime(ECOULE_AVANT_FOCUS);
    });

    fireEvent.focus(toastEl); // 1ʳᵉ source de pause : fige le temps restant à RESTE_ATTENDU
    fireEvent.mouseEnter(toastEl); // 2ᵉ source de pause, s'ajoute sans rien changer
    fireEvent.mouseLeave(toastEl); // relâche le survol : le focus maintient ENCORE la pause

    // Sans la correction : mouseleave aurait relancé le minuteur ici alors
    // que le focus est toujours actif. Toute la durée par défaut ne doit
    // donc pas suffire à fermer le toast.
    act(() => {
      vi.advanceTimersByTime(DUREE_TOAST_DEFAUT_MS);
    });
    expect(screen.getByText("Focus puis survol")).toBeTruthy();

    fireEvent.blur(toastEl); // dernière source relâchée : reprise, pour le temps restant conservé (RESTE_ATTENDU)
    act(() => {
      vi.advanceTimersByTime(RESTE_ATTENDU - 1);
    });
    expect(screen.getByText("Focus puis survol")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Focus puis survol")).toBeNull();
  });

  it("pause multi-source : survol actif + focus/blur → aucune reprise avant le mouseleave, temps restant conservé", () => {
    vi.useFakeTimers();
    render(<FeedbackProvider>{null}</FeedbackProvider>);
    emettre({ variante: "succes", message: "Survol puis focus" });
    const toastEl = screen.getByText("Survol puis focus").closest('[role="status"]') as HTMLElement;

    const ECOULE_AVANT_SURVOL = 1500;
    const RESTE_ATTENDU = DUREE_TOAST_DEFAUT_MS - ECOULE_AVANT_SURVOL;
    act(() => {
      vi.advanceTimersByTime(ECOULE_AVANT_SURVOL);
    });

    fireEvent.mouseEnter(toastEl); // 1ʳᵉ source de pause : fige le temps restant à RESTE_ATTENDU
    fireEvent.focus(toastEl); // 2ᵉ source de pause, s'ajoute sans rien changer
    fireEvent.blur(toastEl); // relâche le focus : le survol maintient ENCORE la pause

    // Sans la correction : blur aurait relancé le minuteur ici alors que le
    // survol est toujours actif.
    act(() => {
      vi.advanceTimersByTime(DUREE_TOAST_DEFAUT_MS);
    });
    expect(screen.getByText("Survol puis focus")).toBeTruthy();

    fireEvent.mouseLeave(toastEl); // dernière source relâchée : reprise, pour le temps restant conservé
    act(() => {
      vi.advanceTimersByTime(RESTE_ATTENDU - 1);
    });
    expect(screen.getByText("Survol puis focus")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText("Survol puis focus")).toBeNull();
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
