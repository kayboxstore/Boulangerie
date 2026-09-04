// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CompteDTO } from "@lomoto/shared";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import { EquipePage } from "./Equipe";

const apiMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => apiMock(...args),
  getToken: () => "jeton-test",
}));

const peutEcrireMock = vi.fn((_module: string) => true);
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    utilisateur: { id: "u1", estAdminPrincipal: true },
    peutEcrire: (module: string) => peutEcrireMock(module),
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  apiMock.mockReset();
  peutEcrireMock.mockReset();
  peutEcrireMock.mockReturnValue(true);
});

const COMPTE_FIXTURE: CompteDTO = {
  id: "compte-1",
  nom: "Admin Test",
  email: "admin@boulangerie-lomoto.com",
  actif: true,
  estAdminPrincipal: true,
  role: { id: "role-admin", nom: "Administrateur" },
  dateCreation: "2026-01-01T00:00:00.000Z",
};

function roleCommandesFixture() {
  return {
    id: "role-commandes",
    nom: "Chargé des commandes",
    roleParentId: null,
    roleParentNom: null,
    permissions: [
      { module: "COMMANDES", niveauAcces: "ECRITURE" },
      { module: "COMMISSIONS", niveauAcces: "LECTURE" },
    ],
  };
}

function routerApi(overrides?: { permissionsPut?: () => unknown }) {
  apiMock.mockImplementation((path: string, options?: RequestInit) => {
    if (path === "/api/equipe") return Promise.resolve({ comptes: [COMPTE_FIXTURE] });
    if (path === "/api/roles") return Promise.resolve({ roles: [roleCommandesFixture()] });
    if (path === "/api/travailleurs") return Promise.resolve({ travailleurs: [] });
    if (path === "/api/delegations") return Promise.resolve({ delegations: [] });
    if (path === "/api/roles/role-commandes/permissions" && options?.method === "PUT") {
      return overrides?.permissionsPut
        ? Promise.resolve(overrides.permissionsPut())
        : Promise.resolve({ statut: "execute", message: "Permissions du rôle « Chargé des commandes » mises à jour" });
    }
    return Promise.reject(new Error(`route non simulée dans ce test : ${path}`));
  });
}

function rendre() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <FeedbackProvider>
          <EquipePage />
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EquipePage — éditeur de permissions d'un rôle (écart livre technique comblé)", () => {
  it("affiche la liste des rôles avec un bouton pour modifier leurs permissions quand éditable", async () => {
    routerApi();
    rendre();

    const boutons = await screen.findAllByRole("button", { name: "Modifier les permissions" });
    expect(boutons.length).toBeGreaterThan(0);
  });

  it("masque tout moyen de modifier les permissions quand l'utilisateur n'a pas l'écriture Équipe", async () => {
    peutEcrireMock.mockReturnValue(false);
    routerApi();
    rendre();

    await screen.findAllByText("Chargé des commandes");
    expect(screen.queryByRole("button", { name: "Modifier les permissions" })).toBeNull();
  });

  it("pré-remplit l'éditeur avec l'état actuel renvoyé par GET /api/roles", async () => {
    routerApi();
    rendre();

    const [bouton] = await screen.findAllByRole("button", { name: "Modifier les permissions" });
    fireEvent.click(bouton);

    const dialogue = await screen.findByRole("heading", { name: /Permissions — Chargé des commandes/ });
    const conteneur = dialogue.closest('[role="dialog"]') as HTMLElement;
    expect((within(conteneur).getByLabelText("Commandes clients") as HTMLSelectElement).value).toBe("ECRITURE");
    expect((within(conteneur).getByLabelText("Commissions") as HTMLSelectElement).value).toBe("LECTURE");
    // Un module absent de la réponse serveur est pré-rempli à AUCUN, jamais laissé indéterminé.
    expect((within(conteneur).getByLabelText("Caisse") as HTMLSelectElement).value).toBe("AUCUN");
  });

  it("envoie la liste COMPLÈTE des 10 modules à la sauvegarde, jamais seulement ceux modifiés", async () => {
    routerApi();
    rendre();

    const [bouton] = await screen.findAllByRole("button", { name: "Modifier les permissions" });
    fireEvent.click(bouton);

    const dialogue = await screen.findByRole("heading", { name: /Permissions — Chargé des commandes/ });
    const conteneur = dialogue.closest('[role="dialog"]') as HTMLElement;
    fireEvent.change(within(conteneur).getByLabelText("Caisse"), { target: { value: "LECTURE" } });
    fireEvent.click(within(conteneur).getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(apiMock.mock.calls.some((c) => c[0] === "/api/roles/role-commandes/permissions")).toBe(true),
    );
    const appel = apiMock.mock.calls.find((c) => c[0] === "/api/roles/role-commandes/permissions")!;
    const corps = JSON.parse((appel[1] as RequestInit).body as string) as {
      permissions: { module: string; niveauAcces: string }[];
    };
    expect(corps.permissions).toHaveLength(10);
    expect(corps.permissions).toEqual(
      expect.arrayContaining([
        { module: "CAISSE", niveauAcces: "LECTURE" },
        { module: "COMMANDES", niveauAcces: "ECRITURE" },
        { module: "COMMISSIONS", niveauAcces: "LECTURE" },
        { module: "STOCKS", niveauAcces: "AUCUN" },
        { module: "PRODUCTION", niveauAcces: "AUCUN" },
        { module: "FOURNISSEURS", niveauAcces: "AUCUN" },
        { module: "PARAMETRES", niveauAcces: "AUCUN" },
        { module: "EQUIPE", niveauAcces: "AUCUN" },
        { module: "RAPPORTS", niveauAcces: "AUCUN" },
        { module: "TRAVAILLEURS", niveauAcces: "AUCUN" },
      ]),
    );
  });

  it("exécution directe (Admin Principal) : ferme le dialogue et affiche une confirmation de succès", async () => {
    routerApi();
    rendre();

    const [bouton] = await screen.findAllByRole("button", { name: "Modifier les permissions" });
    fireEvent.click(bouton);
    await screen.findByRole("heading", { name: /Permissions — Chargé des commandes/ });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText(/Permissions du rôle « Chargé des commandes » mises à jour/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /Permissions — Chargé des commandes/ })).toBeNull(),
    );
  });

  it("demande différée (Admin secondaire) : ferme le dialogue et affiche le bandeau d'approbation, pas de toast de succès", async () => {
    routerApi({
      permissionsPut: () => ({
        statut: "en_attente_approbation",
        message: "Action soumise à l'approbation de l'Administrateur principal — modifier les permissions du rôle « Chargé des commandes »",
      }),
    });
    rendre();

    const [bouton] = await screen.findAllByRole("button", { name: "Modifier les permissions" });
    fireEvent.click(bouton);
    await screen.findByRole("heading", { name: /Permissions — Chargé des commandes/ });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText(/soumise à l'approbation de l'Administrateur principal/)).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /Permissions — Chargé des commandes/ })).toBeNull(),
    );
  });

  it("affiche une erreur claire dans le dialogue si la sauvegarde échoue, sans le fermer", async () => {
    apiMock.mockImplementation((path: string, options?: RequestInit) => {
      if (path === "/api/equipe") return Promise.resolve({ comptes: [COMPTE_FIXTURE] });
      if (path === "/api/roles") return Promise.resolve({ roles: [roleCommandesFixture()] });
      if (path === "/api/travailleurs") return Promise.resolve({ travailleurs: [] });
      if (path === "/api/delegations") return Promise.resolve({ delegations: [] });
      if (path === "/api/roles/role-commandes/permissions" && options?.method === "PUT") {
        return Promise.reject(new Error("Rôle introuvable"));
      }
      return Promise.reject(new Error(`route non simulée : ${path}`));
    });
    rendre();

    const [bouton] = await screen.findAllByRole("button", { name: "Modifier les permissions" });
    fireEvent.click(bouton);
    await screen.findByRole("heading", { name: /Permissions — Chargé des commandes/ });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toContain("Rôle introuvable");
    expect(screen.getByRole("heading", { name: /Permissions — Chargé des commandes/ })).toBeTruthy();
  });
});
