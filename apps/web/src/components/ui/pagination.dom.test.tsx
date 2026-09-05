// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Pagination } from "./pagination";

afterEach(cleanup);

describe("Pagination — DOM", () => {
  it("précédent/suivant appellent onPageChange avec la bonne page", () => {
    const surChangement = vi.fn();
    render(<Pagination page={2} pageSize={10} total={50} onPageChange={surChangement} />);

    fireEvent.click(screen.getByRole("button", { name: "Page suivante" }));
    expect(surChangement).toHaveBeenCalledWith(3);

    fireEvent.click(screen.getByRole("button", { name: "Page précédente" }));
    expect(surChangement).toHaveBeenCalledWith(1);
  });

  it("désactive « précédente » sur la première page et « suivante » sur la dernière", () => {
    const { rerender } = render(<Pagination page={1} pageSize={10} total={30} onPageChange={() => {}} />);
    expect((screen.getByRole("button", { name: "Page précédente" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Page suivante" }) as HTMLButtonElement).disabled).toBe(false);

    rerender(<Pagination page={3} pageSize={10} total={30} onPageChange={() => {}} />);
    expect((screen.getByRole("button", { name: "Page précédente" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Page suivante" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("borne une page hors intervalle à la dernière page valide (calculerPagination)", () => {
    // 30 éléments / 10 par page = 3 pages ; page=999 doit être ramenée à 3.
    render(<Pagination page={999} pageSize={10} total={30} onPageChange={() => {}} />);

    const boutonPage3 = screen.getByRole("button", { name: "Aller à la page 3" });
    expect(boutonPage3.getAttribute("aria-current")).toBe("page");
    // « Suivante » doit être désactivée : la page bornée (3) est bien la dernière.
    expect((screen.getByRole("button", { name: "Page suivante" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("le changement de taille de page appelle onPageSizeChange avec un nombre", () => {
    const surChangementTaille = vi.fn();
    render(
      <Pagination
        page={1}
        pageSize={10}
        total={100}
        onPageChange={() => {}}
        taillesDisponibles={[10, 20, 50]}
        onPageSizeChange={surChangementTaille}
      />,
    );

    const selecteur = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(selecteur, { target: { value: "50" } });
    expect(surChangementTaille).toHaveBeenCalledWith(50);
  });

  it("expose des libellés accessibles (nav, boutons de navigation, numéros de page)", () => {
    render(<Pagination page={2} pageSize={10} total={50} onPageChange={() => {}} />);

    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page précédente" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page suivante" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Aller à la page 2" })).toBeTruthy();
  });

  it("ne rend rien quand total est nul", () => {
    const { container } = render(<Pagination page={1} pageSize={10} total={0} onPageChange={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
