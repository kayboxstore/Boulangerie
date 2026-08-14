// @vitest-environment jsdom

import "@/i18n";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CycleLivraisonDTO } from "@lomoto/shared/cycles-livraison";
import { ApiError } from "@/lib/api";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import { DialogAcceptationCycle } from "./DialogAcceptationCycle";

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
      {
        produitId: "p2",
        produitNom: "Baguette 500 Fc",
        quantitePrevue: 2,
        quantiteRetenueProduction: 2,
        quantitePreparee: 2,
        quantiteRemiseMagasin: 2,
        quantiteChargee: 2,
        quantiteDeposee: 2,
        quantiteAcceptee: null,
        quantiteRetournee: null,
        quantiteManquante: null,
      },
    ],
    totaux: {
      prevu: 10,
      retenuProduction: 10,
      prepare: 10,
      remisMagasin: 10,
      charge: 10,
      depose: 9,
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

function rendre(props: Partial<ComponentProps<typeof DialogAcceptationCycle>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <FeedbackProvider>
        <DialogAcceptationCycle cycle={cycleFixture()} open onOpenChange={onOpenChange} {...props} />
      </FeedbackProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange, queryClient };
}

function remplirLigne(produitNom: string, accepte: string, retourne: string) {
  const carte = screen.getByText(produitNom).closest("div")!;
  fireEvent.change(carte.querySelector('input[id$="-accepte"]')!, { target: { value: accepte } });
  fireEvent.change(carte.querySelector('input[id$="-retourne"]')!, { target: { value: retourne } });
}

describe("DialogAcceptationCycle — DOM (F5B, vague 3)", () => {
  it("affiche le titre avec le nom du client, l'avertissement d'effet financier et le déposé par produit", () => {
    rendre();
    expect(screen.getByRole("heading", { name: "Confirmer l'acceptation — Dépôt Alpha" })).toBeTruthy();
    expect(screen.getByText(/seule la quantité ACCEPTÉE devient facturable/)).toBeTruthy();
    expect(screen.getByText("Déposé : 7")).toBeTruthy();
    expect(screen.getByText("Déposé : 2")).toBeTruthy();
  });

  it("n'affiche jamais de champ « manquant » — seuls accepté et retourné sont saisissables", () => {
    rendre();
    expect(screen.queryByLabelText(/manquant/i)).toBeNull();
  });

  it("bloque la soumission si accepté + retourné dépasse le déposé pour un produit", () => {
    rendre();
    remplirLigne("Carré 1.500 Fc", "5", "4"); // 9 > déposé (7)
    expect(screen.getByRole("alert").textContent).toContain("dépasse la quantité déposée");
    expect(screen.getByRole("button", { name: "Confirmer l'acceptation" })).toHaveProperty("disabled", true);
  });

  it("envoie exactement l'action, la version, les lignes accepté/retourné et bonRetourne, avec l'en-tête Idempotency-Key", async () => {
    let resoudre: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(
      new Promise((resolve) => {
        resoudre = resolve;
      }),
    );
    const onOpenChange = vi.fn();
    rendre({ onOpenChange });

    remplirLigne("Carré 1.500 Fc", "5", "2");
    remplirLigne("Baguette 500 Fc", "2", "0");
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l'acceptation" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalled();

    const [chemin, options] = apiMock.mock.calls[0];
    expect(chemin).toBe("/api/production/cycles-livraison/cycle-c1/transitions");
    expect(options.method).toBe("POST");
    expect(options.headers["Idempotency-Key"]).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    const corps = JSON.parse(options.body);
    expect(corps).toEqual({
      action: "CONFIRMER_ACCEPTATION",
      version: 6,
      lignes: [
        { produitId: "p1", quantiteAcceptee: 5, quantiteRetournee: 2 },
        { produitId: "p2", quantiteAcceptee: 2, quantiteRetournee: 0 },
      ],
      bonRetourne: false,
    });
    // Jamais de champ "manquant" dans le corps envoyé au serveur.
    expect(JSON.stringify(corps)).not.toContain("manquant");

    resoudre({ cycle: cycleFixture(), commande: { id: "cmd-1", numero: 42, quantiteBacs: 7, montantRecu: 0 } });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("réutilise la même clé Idempotency-Key pour un rejeu strictement identique après un échec réseau", async () => {
    apiMock.mockRejectedValueOnce(new Error("panne réseau"));
    apiMock.mockResolvedValueOnce({ cycle: cycleFixture(), commande: null });
    rendre();

    remplirLigne("Carré 1.500 Fc", "0", "7");
    remplirLigne("Baguette 500 Fc", "0", "2");
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l'acceptation" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    const premiereCle = apiMock.mock.calls[0][1].headers["Idempotency-Key"];

    // Aucune modification du formulaire : rejeu strictement identique.
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l'acceptation" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    const deuxiemeCle = apiMock.mock.calls[1][1].headers["Idempotency-Key"];
    expect(deuxiemeCle).toBe(premiereCle);
  });

  it("génère une NOUVELLE clé Idempotency-Key dès que le corps change entre deux soumissions", async () => {
    apiMock.mockRejectedValueOnce(new Error("panne réseau"));
    apiMock.mockResolvedValueOnce({ cycle: cycleFixture(), commande: null });
    rendre();

    remplirLigne("Carré 1.500 Fc", "0", "7");
    remplirLigne("Baguette 500 Fc", "0", "2");
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l'acceptation" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    const premiereCle = apiMock.mock.calls[0][1].headers["Idempotency-Key"];

    // L'utilisateur change une valeur : ce n'est plus le même corps, jamais la même clé.
    remplirLigne("Baguette 500 Fc", "1", "1");
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l'acceptation" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    const deuxiemeCle = apiMock.mock.calls[1][1].headers["Idempotency-Key"];
    expect(deuxiemeCle).not.toBe(premiereCle);
  });

  it("empêche le double-clic : un seul appel réseau part pendant l'envoi", async () => {
    let resoudre: (v: unknown) => void = () => {};
    apiMock.mockReturnValue(
      new Promise((resolve) => {
        resoudre = resolve;
      }),
    );
    rendre();
    remplirLigne("Carré 1.500 Fc", "7", "0");
    remplirLigne("Baguette 500 Fc", "2", "0");

    const bouton = screen.getByRole("button", { name: "Confirmer l'acceptation" });
    fireEvent.click(bouton);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    expect(bouton).toHaveProperty("disabled", true);
    fireEvent.click(bouton);
    fireEvent.click(bouton);
    expect(apiMock).toHaveBeenCalledTimes(1);

    resoudre({ cycle: cycleFixture(), commande: null });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
  });

  it("conflit de version (409 VERSION_OBSOLETE) : explique clairement, ne retente jamais automatiquement", async () => {
    apiMock.mockRejectedValue(new ApiError(409, "Le cycle a été modifié.", { code: "VERSION_OBSOLETE", versionCourante: 7 }));
    rendre();
    remplirLigne("Carré 1.500 Fc", "7", "0");
    remplirLigne("Baguette 500 Fc", "2", "0");
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l'acceptation" }));

    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toContain("modifié");
    expect(screen.queryByRole("button", { name: "Confirmer l'acceptation" })).toBeNull();
  });

  it("un 409 ACCEPTATION_DEJA_CONVERTIE (pas une obsolescence de version) affiche le message serveur et laisse réessayer", async () => {
    apiMock.mockRejectedValue(new ApiError(409, "Cette acceptation est déjà liée à une commande", { code: "ACCEPTATION_DEJA_CONVERTIE" }));
    rendre();
    remplirLigne("Carré 1.500 Fc", "7", "0");
    remplirLigne("Baguette 500 Fc", "2", "0");
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l'acceptation" }));

    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toBe("Cette acceptation est déjà liée à une commande");
    expect(screen.getByRole("button", { name: "Confirmer l'acceptation" })).toBeTruthy();
  });

  it("succès avec commande créée : message de succès avec numéro et quantité facturable", async () => {
    apiMock.mockResolvedValue({ cycle: cycleFixture(), commande: { id: "cmd-1", numero: 42, quantiteBacs: 9, montantRecu: 0 } });
    rendre();
    remplirLigne("Carré 1.500 Fc", "7", "0");
    remplirLigne("Baguette 500 Fc", "2", "0");
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l'acceptation" }));

    expect(await screen.findByText(/commande n°42 créée pour 9 bacs/)).toBeTruthy();
  });

  it("succès sans commande (retour total) : message de succès distinct, sans numéro de commande", async () => {
    apiMock.mockResolvedValue({ cycle: cycleFixture(), commande: null });
    rendre();
    remplirLigne("Carré 1.500 Fc", "0", "7");
    remplirLigne("Baguette 500 Fc", "0", "2");
    fireEvent.click(screen.getByRole("button", { name: "Confirmer l'acceptation" }));

    expect(await screen.findByText(/aucune quantité acceptée, aucune commande créée/)).toBeTruthy();
  });

  it("case « bon retourné » désactivée et cochée si le cycle l'a déjà (rien à changer)", () => {
    rendre({ cycle: cycleFixture({ bonRetourne: true }) });
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(true);
    expect(screen.getByText("Bon physique déjà retourné et enregistré.")).toBeTruthy();
  });

  it("le bouton Annuler ferme le dialogue sans appeler le serveur", () => {
    const onOpenChange = vi.fn();
    rendre({ onOpenChange });
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(apiMock).not.toHaveBeenCalled();
  });
});
