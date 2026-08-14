// @vitest-environment jsdom

import "@/i18n";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CycleLivraisonDTO } from "@lomoto/shared/cycles-livraison";
import { ApiError } from "@/lib/api";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import { DialogActionCycle } from "./DialogActionCycle";

const apiMock = vi.fn();
vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      message: string,
      public corps?: unknown,
    ) {
      super(message);
    }
  }
  return { api: (...args: unknown[]) => apiMock(...args), ApiError };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  apiMock.mockReset();
});

function cycleFixture(overrides?: Partial<CycleLivraisonDTO>): CycleLivraisonDTO {
  return {
    id: "cycle-c1",
    dateLivraison: "2026-08-14",
    client: { id: "c1", nom: "Dépôt Alpha", typeClientNom: "Dépositaire", zoneDepositaireId: null, zoneDepositaireNom: null },
    statut: "PREVISION",
    version: 3,
    lignes: [
      {
        produitId: "p1",
        produitNom: "Carré 1.500 Fc",
        quantitePrevue: 8,
        quantiteRetenueProduction: null,
        quantitePreparee: null,
        quantiteRemiseMagasin: null,
        quantiteChargee: null,
        quantiteDeposee: null,
        quantiteAcceptee: null,
        quantiteRetournee: null,
        quantiteManquante: null,
      },
      {
        produitId: "p2",
        produitNom: "Baguette 500 Fc",
        quantitePrevue: 2,
        quantiteRetenueProduction: null,
        quantitePreparee: null,
        quantiteRemiseMagasin: null,
        quantiteChargee: null,
        quantiteDeposee: null,
        quantiteAcceptee: null,
        quantiteRetournee: null,
        quantiteManquante: null,
      },
    ],
    totaux: {
      prevu: 10,
      retenuProduction: null,
      prepare: null,
      remisMagasin: null,
      charge: null,
      depose: null,
      accepte: null,
      retourne: null,
      manquant: null,
    },
    livrePar: null,
    bonRetourne: false,
    anomalieOuverte: false,
    typesAnomalie: [],
    estFacturable: false,
    commande: null,
    derniereTransitionLe: null,
    ...overrides,
  };
}

function rendre(props: Partial<ComponentProps<typeof DialogActionCycle>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>
        <DialogActionCycle cycle={cycleFixture()} action="RETENIR_PRODUCTION" open onOpenChange={onOpenChange} {...props} />
      </FeedbackProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange, queryClient };
}

describe("DialogActionCycle — DOM (F5A, vague 3)", () => {
  it("affiche le titre, la description de l'action et le rappel d'absence d'effet financier", () => {
    rendre({ action: "RETENIR_PRODUCTION" });
    expect(screen.getByRole("heading", { name: "Retenir pour la production" })).toBeTruthy();
    expect(screen.getByText(/prévision annoncée/)).toBeTruthy();
    expect(screen.getByText(/Cette action n'a aucun effet financier/)).toBeTruthy();
  });

  it("préremplit les quantités depuis le champ de l'étape précédente, jamais depuis une valeur devinée", () => {
    rendre({
      action: "CONFIRMER_PREPARATION",
      cycle: cycleFixture({
        statut: "RETENUE_PRODUCTION",
        lignes: [
          {
            produitId: "p1",
            produitNom: "Carré 1.500 Fc",
            quantitePrevue: 8,
            quantiteRetenueProduction: 7,
            quantitePreparee: null,
            quantiteRemiseMagasin: null,
            quantiteChargee: null,
            quantiteDeposee: null,
            quantiteAcceptee: null,
            quantiteRetournee: null,
            quantiteManquante: null,
          },
        ],
      }),
    });
    expect(screen.getByLabelText("Carré 1.500 Fc")).toHaveProperty("value", "7");
  });

  it("n'affiche le champ chauffeur que pour CONFIRMER_CHARGEMENT, et le rend obligatoire", () => {
    const { unmount } = rendre({ action: "RETENIR_PRODUCTION" });
    expect(screen.queryByLabelText("Nom du chauffeur")).toBeNull();
    unmount();

    rendre({ action: "CONFIRMER_CHARGEMENT" });
    const champChauffeur = screen.getByLabelText("Nom du chauffeur");
    expect(champChauffeur).toBeTruthy();
    expect(champChauffeur.getAttribute("aria-describedby")).toBeTruthy();
    const bouton = screen.getByRole("button", { name: "Confirmer le chargement" });
    expect(bouton).toHaveProperty("disabled", true);
    fireEvent.change(champChauffeur, { target: { value: "Jean" } });
    expect(bouton).toHaveProperty("disabled", false);
  });

  it("CONFIRMER_DEPART n'affiche aucun champ de quantité — aucune ligne n'est portée par cette action", () => {
    rendre({ action: "CONFIRMER_DEPART", cycle: cycleFixture({ statut: "CHARGEE" }) });
    expect(screen.queryByText("Quantités par produit")).toBeNull();
  });

  it("envoie exactement l'action, la version et les lignes attendues — aucun succès affiché avant la réponse serveur", async () => {
    let resoudre: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(
      new Promise((resolve) => {
        resoudre = resolve;
      }),
    );
    const onOpenChange = vi.fn();
    rendre({ action: "RETENIR_PRODUCTION", onOpenChange });

    fireEvent.click(screen.getByRole("button", { name: "Retenir pour la production" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));

    // Tant que le serveur n'a pas répondu : le dialogue reste ouvert, rien
    // n'est fermé ni annoncé comme réussi.
    expect(onOpenChange).not.toHaveBeenCalled();
    const [chemin, options] = apiMock.mock.calls[0];
    expect(chemin).toBe("/api/production/cycles-livraison/cycle-c1/transitions");
    expect(options.method).toBe("POST");
    const corps = JSON.parse(options.body);
    expect(corps).toEqual({
      action: "RETENIR_PRODUCTION",
      version: 3,
      lignes: [
        { produitId: "p1", quantite: 8 },
        { produitId: "p2", quantite: 2 },
      ],
    });

    resoudre({ cycle: cycleFixture(), commande: null });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("empêche le double-clic : un seul appel réseau part, le bouton se désactive pendant l'envoi", async () => {
    let resoudre: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(
      new Promise((resolve) => {
        resoudre = resolve;
      }),
    );
    rendre({ action: "RETENIR_PRODUCTION" });

    const bouton = screen.getByRole("button", { name: "Retenir pour la production" });
    fireEvent.click(bouton);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    expect(bouton).toHaveProperty("disabled", true);
    fireEvent.click(bouton);
    fireEvent.click(bouton);
    expect(apiMock).toHaveBeenCalledTimes(1);

    resoudre({ cycle: cycleFixture(), commande: null });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
  });

  it("conflit de version (409) : explique clairement, ne retente jamais automatiquement et n'écrase rien silencieusement", async () => {
    apiMock.mockRejectedValue(new ApiError(409, "Le cycle a été modifié. Rechargez les données avant de réessayer.", { versionCourante: 4 }));
    rendre({ action: "RETENIR_PRODUCTION" });

    fireEvent.click(screen.getByRole("button", { name: "Retenir pour la production" }));

    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toContain("modifié");
    // Le bouton de soumission disparaît — impossible de retenter avec une
    // version qu'on sait déjà obsolète ; un seul appel a été envoyé.
    expect(screen.queryByRole("button", { name: "Retenir pour la production" })).toBeNull();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("erreur générique (non 409) : affiche le message et laisse la possibilité de réessayer", async () => {
    apiMock.mockRejectedValue(new Error("panne réseau"));
    rendre({ action: "RETENIR_PRODUCTION" });

    fireEvent.click(screen.getByRole("button", { name: "Retenir pour la production" }));

    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toBe("panne réseau");
    expect(screen.getByRole("button", { name: "Retenir pour la production" })).toBeTruthy();
  });

  it("le bouton Annuler ferme le dialogue sans appeler le serveur", () => {
    const onOpenChange = vi.fn();
    rendre({ action: "RETENIR_PRODUCTION", onOpenChange });
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(apiMock).not.toHaveBeenCalled();
  });
});
