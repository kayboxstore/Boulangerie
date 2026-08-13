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

    fireEvent.pointerDown(bouton, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(bouton, { pointerId: 1, clientY: 100 + SEUIL_GLISSEMENT_PX });
    fireEvent.pointerUp(bouton, { pointerId: 1, clientY: 100 + SEUIL_GLISSEMENT_PX });

    expect(screen.getByRole("button", { name: "Éteindre la lampe" })).toBeTruthy();
  });

  it("un glissement en-deçà du seuil ne bascule rien", () => {
    render(<LampeControlee />);
    const bouton = screen.getByRole("button", { name: "Allumer la lampe" });

    fireEvent.pointerDown(bouton, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(bouton, { pointerId: 1, clientY: 100 + SEUIL_GLISSEMENT_PX - 5 });
    fireEvent.pointerUp(bouton, { pointerId: 1, clientY: 100 + SEUIL_GLISSEMENT_PX - 5 });

    expect(screen.getByRole("button", { name: "Allumer la lampe" })).toBeTruthy();
  });

  it("le clic de fin de geste qui suit un glissement abouti ne rebascule pas une seconde fois", () => {
    render(<LampeControlee />);
    const bouton = screen.getByRole("button", { name: "Allumer la lampe" });

    fireEvent.pointerDown(bouton, { pointerId: 1, clientY: 100 });
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

    fireEvent.pointerDown(bouton, { pointerId: 1, clientY: 0 });
    fireEvent.pointerMove(bouton, { pointerId: 1, clientY: SEUIL_GLISSEMENT_PX });
    fireEvent.pointerMove(bouton, { pointerId: 1, clientY: SEUIL_GLISSEMENT_PX + 40 });
    fireEvent.pointerUp(bouton, { pointerId: 1, clientY: SEUIL_GLISSEMENT_PX + 40 });

    expect(surBasculer).toHaveBeenCalledTimes(1);
  });
});
