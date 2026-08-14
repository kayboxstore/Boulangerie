// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DateHeurePicker } from "./date-time-picker";

afterEach(cleanup);

describe("DateHeurePicker — DOM", () => {
  it("les libellés Date et Heure sont associés à leurs champs respectifs", () => {
    render(
      <DateHeurePicker
        id="livraison"
        dateValue="2026-08-13"
        heureValue="14:30"
        onDateChange={() => {}}
        onHeureChange={() => {}}
      />,
    );

    const champDate = screen.getByLabelText("Date") as HTMLInputElement;
    const champHeure = screen.getByLabelText("Heure") as HTMLInputElement;
    expect(champDate.type).toBe("date");
    expect(champHeure.type).toBe("time");
    expect(champDate.id).toBe("livraison-date");
    expect(champHeure.id).toBe("livraison-heure");
  });

  it("génère des identifiants uniques entre deux instances sans id fourni", () => {
    render(
      <div>
        <DateHeurePicker dateValue="" heureValue="" onDateChange={() => {}} onHeureChange={() => {}} />
        <DateHeurePicker dateValue="" heureValue="" onDateChange={() => {}} onHeureChange={() => {}} />
      </div>,
    );

    const champsDate = screen.getAllByLabelText("Date") as HTMLInputElement[];
    expect(champsDate).toHaveLength(2);
    expect(champsDate[0].id).not.toBe(champsDate[1].id);
    // Chaque id reste néanmoins stable et non vide (React.useId()).
    expect(champsDate[0].id).toBeTruthy();
    expect(champsDate[1].id).toBeTruthy();
  });

  it("propage les changements de date et d'heure aux callbacks fournis", () => {
    const surDate = vi.fn();
    const surHeure = vi.fn();
    render(
      <DateHeurePicker
        id="commande"
        dateValue="2026-08-01"
        heureValue="08:00"
        onDateChange={surDate}
        onHeureChange={surHeure}
      />,
    );

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-15" } });
    expect(surDate).toHaveBeenCalledWith("2026-08-15");

    fireEvent.change(screen.getByLabelText("Heure"), { target: { value: "09:45" } });
    expect(surHeure).toHaveBeenCalledWith("09:45");
  });

  it("répercute les contraintes (min/max/requis) et l'état désactivé sur le champ date", () => {
    render(
      <DateHeurePicker
        id="fenetre"
        dateValue="2026-08-10"
        heureValue="10:00"
        dateMin="2026-08-01"
        dateMax="2026-08-31"
        requis
        disabled
        onDateChange={() => {}}
        onHeureChange={() => {}}
      />,
    );

    const champDate = screen.getByLabelText("Date") as HTMLInputElement;
    expect(champDate.min).toBe("2026-08-01");
    expect(champDate.max).toBe("2026-08-31");
    expect(champDate.required).toBe(true);
    expect(champDate.disabled).toBe(true);

    const champHeure = screen.getByLabelText("Heure") as HTMLInputElement;
    expect(champHeure.required).toBe(true);
    expect(champHeure.disabled).toBe(true);
  });

  it("affiche un aperçu français lisible sous chaque champ", () => {
    render(
      <DateHeurePicker
        id="apercu"
        dateValue="2026-08-13"
        heureValue="14:30"
        onDateChange={() => {}}
        onHeureChange={() => {}}
      />,
    );

    // Les widgets natifs date/time suivent la locale système, pas la langue
    // de l'app : l'aperçu reformaté en français est ce qui reste lisible.
    expect(screen.getByText(/13/)).toBeTruthy();
    expect(screen.getByText(/14:30|14 h 30/)).toBeTruthy();
  });
});
