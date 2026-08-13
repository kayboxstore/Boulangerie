// @vitest-environment jsdom

import i18n from "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { HorlogeFlip } from "./HorlogeFlip";

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  await i18n.changeLanguage("FR");
});

describe("HorlogeFlip — DOM", () => {
  it("affiche l'heure de Kinshasa initiale via un role=timer non bavard (jamais role=status)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:05:07Z")); // 11:05:07 à Kinshasa
    render(<HorlogeFlip />);
    const horloge = screen.getByRole("timer");
    expect(horloge.getAttribute("aria-label")).toBe("Heure actuelle à Kinshasa : 11 h 05 min 07 s");
    expect(horloge.tagName).toBe("TIME");
    expect(horloge.getAttribute("dateTime")).toBe("11:05:07");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("aria-live=off : l'horloge ne doit jamais interrompre les lecteurs d'écran à chaque seconde", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:05:07Z"));
    render(<HorlogeFlip />);
    expect(screen.getByRole("timer").getAttribute("aria-live")).toBe("off");
  });

  it("progresse chaque seconde (setInterval, dateTime et libellé) sans nécessiter de nouveau rendu du parent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:05:07Z"));
    render(<HorlogeFlip />);

    const horloge = screen.getByRole("timer");
    expect(horloge.getAttribute("aria-label")).toContain("11 h 05 min 07 s");
    expect(horloge.getAttribute("dateTime")).toBe("11:05:07");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("timer").getAttribute("aria-label")).toContain("11 h 05 min 10 s");
    expect(screen.getByRole("timer").getAttribute("dateTime")).toBe("11:05:10");
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

  it("libellé accessible réellement localisé en FR/EN/LN/SW (jamais de fragment français codé en dur)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T10:05:07Z")); // 11:05:07 à Kinshasa

    await i18n.changeLanguage("FR");
    const { unmount: unmountFr } = render(<HorlogeFlip />);
    expect(screen.getByRole("timer").getAttribute("aria-label")).toBe("Heure actuelle à Kinshasa : 11 h 05 min 07 s");
    unmountFr();

    await i18n.changeLanguage("EN");
    const { unmount: unmountEn } = render(<HorlogeFlip />);
    expect(screen.getByRole("timer").getAttribute("aria-label")).toBe(
      "Current time in Kinshasa: 11 hours 05 minutes 07 seconds",
    );
    unmountEn();

    await i18n.changeLanguage("LN");
    const { unmount: unmountLn } = render(<HorlogeFlip />);
    expect(screen.getByRole("timer").getAttribute("aria-label")).toBe(
      "Ngonga ya sikoyo na Kinshasa : ngonga 11, miniti 05, segonde 07",
    );
    unmountLn();

    await i18n.changeLanguage("SW");
    const { unmount: unmountSw } = render(<HorlogeFlip />);
    expect(screen.getByRole("timer").getAttribute("aria-label")).toBe("Saa za sasa Kinshasa : saa 11, dakika 05, sekunde 07");
    unmountSw();
  });
});
