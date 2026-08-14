// @vitest-environment jsdom

import "@/i18n";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LampeFicelle } from "./LampeFicelle";
import { SEUIL_GLISSEMENT_PX } from "./lampeLogique";

afterEach(cleanup);

function LampeControlee({ reduireMouvement = false }: { reduireMouvement?: boolean }) {
  const [allumee, setAllumee] = React.useState(false);
  return (
    <LampeFicelle allumee={allumee} onBasculer={() => setAllumee((v) => !v)} reduireMouvement={reduireMouvement} />
  );
}

describe("LampeFicelle — DOM", () => {
  it("est un vrai <button> dans l'ordre de tabulation : Entrée/Espace fonctionnent nativement au clavier", () => {
    render(<LampeControlee />);
    const bouton = screen.getByRole("button", { name: "Allumer la lampe" }) as HTMLButtonElement;
    expect(bouton.tagName).toBe("BUTTON");
    expect(bouton.type).toBe("button");
    expect(bouton.tabIndex).toBe(0);
    bouton.focus();
    expect(document.activeElement).toBe(bouton);
  });

  it("cible tactile réelle d'au moins 44×44 px (pas seulement l'icône de 36 px)", () => {
    render(<LampeControlee />);
    const bouton = screen.getByRole("button", { name: "Allumer la lampe" });
    expect(bouton.className).toContain("min-h-11");
    expect(bouton.className).toContain("min-w-11");
  });

  it("le clic simple bascule l'état (aria-pressed + libellé accessible)", () => {
    render(<LampeControlee />);
    const bouton = screen.getByRole("button", { name: "Allumer la lampe" });
    expect(bouton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(bouton);
    expect(screen.getByRole("button", { name: "Éteindre la lampe" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Éteindre la lampe" }));
    expect(screen.getByRole("button", { name: "Allumer la lampe" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("un glissement (souris ou tactile, via Pointer Events) au-delà du seuil bascule l'état", () => {
    render(<LampeControlee />);
    const bouton = screen.getByRole("button", { name: "Allumer la lampe" });

    fireEvent.pointerDown(bouton, { pointerId: 1, clientY: 100, isPrimary: true, button: 0 });
    fireEvent.pointerMove(bouton, { pointerId: 1, clientY: 100 + SEUIL_GLISSEMENT_PX });
    fireEvent.pointerUp(bouton, { pointerId: 1, clientY: 100 + SEUIL_GLISSEMENT_PX });

    expect(screen.getByRole("button", { name: "Éteindre la lampe" })).toBeTruthy();
  });

  it("un glissement en-deçà du seuil ne bascule rien", () => {
    render(<LampeControlee />);
    const bouton = screen.getByRole("button", { name: "Allumer la lampe" });

    fireEvent.pointerDown(bouton, { pointerId: 1, clientY: 100, isPrimary: true, button: 0 });
    fireEvent.pointerMove(bouton, { pointerId: 1, clientY: 100 + SEUIL_GLISSEMENT_PX - 5 });
    fireEvent.pointerUp(bouton, { pointerId: 1, clientY: 100 + SEUIL_GLISSEMENT_PX - 5 });

    expect(screen.getByRole("button", { name: "Allumer la lampe" })).toBeTruthy();
  });

  it("le clic de fin de geste qui suit un glissement abouti ne rebascule pas une seconde fois", () => {
    render(<LampeControlee />);
    const bouton = screen.getByRole("button", { name: "Allumer la lampe" });

    fireEvent.pointerDown(bouton, { pointerId: 1, clientY: 100, isPrimary: true, button: 0 });
    fireEvent.pointerMove(bouton, { pointerId: 1, clientY: 100 + SEUIL_GLISSEMENT_PX });
    fireEvent.pointerUp(bouton, { pointerId: 1, clientY: 100 + SEUIL_GLISSEMENT_PX });
    // Le navigateur émet un `click` de synthèse après le relâchement du pointeur.
    fireEvent.click(screen.getByRole("button", { name: "Éteindre la lampe" }));

    // Toujours allumée (un seul basculement, pas deux) : bouton "Éteindre".
    expect(screen.getByRole("button", { name: "Éteindre la lampe" })).toBeTruthy();
  });

  it("onBasculer est appelé exactement une fois par glissement abouti", () => {
    const surBasculer = vi.fn();
    render(<LampeFicelle allumee={false} onBasculer={surBasculer} reduireMouvement={false} />);
    const bouton = screen.getByRole("button", { name: "Allumer la lampe" });

    fireEvent.pointerDown(bouton, { pointerId: 1, clientY: 0, isPrimary: true, button: 0 });
    fireEvent.pointerMove(bouton, { pointerId: 1, clientY: SEUIL_GLISSEMENT_PX });
    fireEvent.pointerMove(bouton, { pointerId: 1, clientY: SEUIL_GLISSEMENT_PX + 40 });
    fireEvent.pointerUp(bouton, { pointerId: 1, clientY: SEUIL_GLISSEMENT_PX + 40 });

    expect(surBasculer).toHaveBeenCalledTimes(1);
  });

  it("un pointeur étranger (jamais démarré ici) ne peut ni poursuivre ni terminer un geste", () => {
    const surBasculer = vi.fn();
    render(<LampeFicelle allumee={false} onBasculer={surBasculer} reduireMouvement={false} />);
    const bouton = screen.getByRole("button", { name: "Allumer la lampe" });

    // Aucun pointerDown préalable pour pointerId 7 : move/up doivent être des no-op.
    fireEvent.pointerMove(bouton, { pointerId: 7, clientY: SEUIL_GLISSEMENT_PX + 40 });
    fireEvent.pointerUp(bouton, { pointerId: 7, clientY: SEUIL_GLISSEMENT_PX + 40 });

    expect(surBasculer).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Allumer la lampe" })).toBeTruthy();
  });

  it("un second pointeur (doigt secondaire) ne peut ni remplacer ni déclencher le geste actif", () => {
    const surBasculer = vi.fn();
    render(<LampeFicelle allumee={false} onBasculer={surBasculer} reduireMouvement={false} />);
    const bouton = screen.getByRole("button", { name: "Allumer la lampe" });

    // Premier pointeur (primaire) démarre le geste.
    fireEvent.pointerDown(bouton, { pointerId: 1, clientY: 0, isPrimary: true, button: 0 });
    // Second pointeur (doigt secondaire, non-primaire) tente de démarrer un geste concurrent.
    fireEvent.pointerDown(bouton, { pointerId: 2, clientY: 0, isPrimary: false, button: 0 });
    // Le second pointeur glisse seul, au-delà du seuil : il n'est pas propriétaire, donc no-op.
    fireEvent.pointerMove(bouton, { pointerId: 2, clientY: SEUIL_GLISSEMENT_PX + 40 });
    expect(surBasculer).not.toHaveBeenCalled();

    // Le premier pointeur (propriétaire réel) peut toujours faire progresser le geste.
    fireEvent.pointerMove(bouton, { pointerId: 1, clientY: SEUIL_GLISSEMENT_PX + 40 });
    expect(surBasculer).toHaveBeenCalledTimes(1);
  });

  it("un clic droit (bouton secondaire) ne bascule jamais la lampe", () => {
    const surBasculer = vi.fn();
    render(<LampeFicelle allumee={false} onBasculer={surBasculer} reduireMouvement={false} />);
    const bouton = screen.getByRole("button", { name: "Allumer la lampe" });

    // pointerDown au bouton droit ne doit pas démarrer de geste de glissement...
    fireEvent.pointerDown(bouton, { pointerId: 1, clientY: 0, isPrimary: true, button: 2 });
    fireEvent.pointerMove(bouton, { pointerId: 1, clientY: SEUIL_GLISSEMENT_PX + 40 });
    fireEvent.pointerUp(bouton, { pointerId: 1, clientY: SEUIL_GLISSEMENT_PX + 40 });
    expect(surBasculer).not.toHaveBeenCalled();

    // ... et un `click` au bouton droit (filet de sécurité) ne bascule pas non plus.
    fireEvent.click(bouton, { button: 2 });
    expect(surBasculer).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Allumer la lampe" })).toBeTruthy();
  });

  it("pointercancel nettoie complètement le geste sans neutraliser la prochaine activation clavier/clic", () => {
    const surBasculer = vi.fn();
    render(<LampeFicelle allumee={false} onBasculer={surBasculer} reduireMouvement={false} />);
    const bouton = screen.getByRole("button", { name: "Allumer la lampe" });

    // Glissement abouti puis annulé (au lieu d'un pointerup normal) : le
    // basculement du glissement a déjà eu lieu, mais aucun `click` de
    // synthèse ne suivra un `pointercancel`.
    fireEvent.pointerDown(bouton, { pointerId: 1, clientY: 0, isPrimary: true, button: 0 });
    fireEvent.pointerMove(bouton, { pointerId: 1, clientY: SEUIL_GLISSEMENT_PX + 40 });
    expect(surBasculer).toHaveBeenCalledTimes(1);
    fireEvent.pointerCancel(bouton, { pointerId: 1, clientY: SEUIL_GLISSEMENT_PX + 40 });

    // Une activation clavier/clic normale, sans rapport avec le geste annulé,
    // doit basculer l'état comme d'habitude — pas être avalée silencieusement.
    fireEvent.click(bouton);
    expect(surBasculer).toHaveBeenCalledTimes(2);

    // Un nouveau geste de glissement (nouveau pointerId) démarre normalement.
    fireEvent.pointerDown(bouton, { pointerId: 2, clientY: 0, isPrimary: true, button: 0 });
    fireEvent.pointerMove(bouton, { pointerId: 2, clientY: SEUIL_GLISSEMENT_PX + 40 });
    expect(surBasculer).toHaveBeenCalledTimes(3);
  });
});
