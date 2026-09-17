// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CycleLivraisonDTO } from "@lomoto/shared/cycles-livraison";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import { AcceptationsLivraisonPage } from "./AcceptationsLivraison";

const apiMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => apiMock(...args),
  getToken: () => "jeton-test",
}));

const peutEcrireMock = vi.fn((_module: string) => true);
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ peutEcrire: (module: string) => peutEcrireMock(module) }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  apiMock.mockReset();
  peutEcrireMock.mockReset();
  peutEcrireMock.mockReturnValue(true);
});

function cycleFixture(overrides?: Partial<CycleLivraisonDTO>): CycleLivraisonDTO {
  return {
    id: "cycle-c1",
    dateLivraison: "2026-08-14",
    client: { id: "c1", nom: "Dépôt Alpha", typeClientNom: "Dépositaire", zoneDepositaireId: null, zoneDepositaireNom: null },
    statut: "EN_ATTENTE_CONFIRMATION",
    version: 6,
    lignes: [
      {
        produitId: "p1",
        produitNom: "Carré 1.500 Fc",
        quantitePrevue: 8,
        quantiteRetenueProduction: 8,
        quantitePreparee: 8,
        quantiteRemiseMagasin: 8,
        quantiteChargee: 8,
        quantiteDeposee: 7,
        quantiteAcceptee: null,
        quantiteRetournee: null,
        quantiteManquante: null,
      },
    ],
    totaux: {
      prevu: 8,
      retenuProduction: 8,
      prepare: 8,
      remisMagasin: 8,
      charge: 8,
      depose: 7,
      accepte: null,
      retourne: null,
      manquant: null,
    },
    livrePar: "Jean",
    bonRetourne: false,
    anomalieOuverte: false,
    typesAnomalie: [],
    estFacturable: false,
    commande: null,
    derniereTransitionLe: null,
    ...overrides,
  };
}

function routerApi(cycles: CycleLivraisonDTO[]) {
  apiMock.mockImplementation((path: string) => {
    if (path.startsWith("/api/production/cycles-livraison?")) {
      return Promise.resolve({ date: "2026-08-14", cycles, totaux: { prevu: 0, charge: 0, accepte: 0, facturable: 0 } });
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
          <AcceptationsLivraisonPage />
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AcceptationsLivraisonPage — DOM (F5B, vague 3)", () => {
  it("affiche l'état de chargement puis l'état vide quand aucun cycle n'est en attente", async () => {
    routerApi([]);
    rendre();
    expect(screen.getByRole("status")).toBeTruthy();
    expect(await screen.findByText(/Aucune livraison en attente de confirmation/)).toBeTruthy();
  });

  it("état d'erreur explicite avec bouton réessayer", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/production/cycles-livraison?")) return Promise.reject(new Error("panne réseau"));
      return Promise.reject(new Error("route non simulée"));
    });
    rendre();
    expect(await screen.findByText("panne réseau")).toBeTruthy();
    expect(screen.getByRole("button", { name: /réessayer/i })).toBeTruthy();
  });

  it("ne liste QUE les cycles en attente de confirmation, jamais les autres statuts", async () => {
    routerApi([
      cycleFixture({ id: "c1", statut: "EN_ATTENTE_CONFIRMATION", client: { id: "c1", nom: "Dépôt Alpha", typeClientNom: "Dépositaire", zoneDepositaireId: null, zoneDepositaireNom: null } }),
      cycleFixture({ id: "c2", statut: "ACCEPTEE", client: { id: "c2", nom: "Dépôt Beta", typeClientNom: "Dépositaire", zoneDepositaireId: null, zoneDepositaireNom: null } }),
      cycleFixture({ id: "c3", statut: "PREVISION", client: { id: "c3", nom: "Dépôt Gamma", typeClientNom: "Dépositaire", zoneDepositaireId: null, zoneDepositaireNom: null } }),
    ]);
    rendre();

    expect(await screen.findAllByText("Dépôt Alpha")).toHaveLength(2); // tableau + carte mobile
    expect(screen.queryByText("Dépôt Beta")).toBeNull();
    expect(screen.queryByText("Dépôt Gamma")).toBeNull();
  });

  it("masque le bouton de confirmation quand l'utilisateur n'a pas la permission Commandes en écriture", async () => {
    peutEcrireMock.mockReturnValue(false);
    routerApi([cycleFixture()]);
    rendre();

    await screen.findAllByText("Dépôt Alpha");
    expect(screen.queryByRole("button", { name: "Confirmer l'acceptation" })).toBeNull();
  });

  it("le clic sur le bouton ouvre le dialogue de confirmation pour le bon client", async () => {
    routerApi([cycleFixture()]);
    rendre();

    const [bouton] = await screen.findAllByRole("button", { name: "Confirmer l'acceptation" });
    fireEvent.click(bouton);

    expect(await screen.findByRole("heading", { name: "Confirmer l'acceptation — Dépôt Alpha" })).toBeTruthy();
  });
});
