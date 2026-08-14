// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";

afterEach(cleanup);

describe("harnais DOM frontend", () => {
  it("rend un composant Premium réel avec l’alias frontend", () => {
    render(createElement(Button, { loading: true }, "Enregistrer"));

    const bouton = screen.getByRole("button", { name: "Enregistrer" });
    expect(bouton.getAttribute("aria-busy")).toBe("true");
    expect((bouton as HTMLButtonElement).disabled).toBe(true);
  });
});
