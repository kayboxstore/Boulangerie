// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { HorlogeFlip } from "./HorlogeFlip";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("HorlogeFlip — DOM", () => {
  it("affiche l'heure de Kinshasa initiale via un role=status accessible", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:05:07Z")); // 11:05:07 à Kinshasa
    render(<HorlogeFlip />);
    const statut = screen.getByRole("status");
    expect(statut.getAttribute("aria-label")).toBe("Heure actuelle à Kinshasa : 11 h 05 min 07 s");
  });

  it("progresse chaque seconde (setInterval) sans nécessiter de nouveau rendu du parent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:05:07Z"));
    render(<HorlogeFlip />);

    expect(screen.getByRole("status").getAttribute("aria-label")).toContain("11 h 05 min 07 s");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("status").getAttribute("aria-label")).toContain("11 h 05 min 10 s");
  });

  it("nettoie exactement l'intervalle qu'il a créé, au démontage (pas de fuite du minuteur)", () => {
    vi.useFakeTimers();
    const surSetInterval = vi.spyOn(globalThis, "setInterval");
    const surClearInterval = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = render(<HorlogeFlip />);

    const idCree = surSetInterval.mock.results[0]?.value;
    unmount();

    expect(surClearInterval).toHaveBeenCalledWith(idCree);
    // Après démontage, avancer le temps ne doit lever aucune exception (pas
    // de setState sur un composant démonté) — l'arrêt réel du minuteur.
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });
});
