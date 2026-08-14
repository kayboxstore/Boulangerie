// @vitest-environment jsdom

import "@/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BonLivraisonJourDTO, SchemaCommandeJourDTO } from "@lomoto/shared";
import type { CycleLivraisonDTO } from "@lomoto/shared/cycles-livraison";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import { BonsLivraisonPage } from "./BonsLivraison";

const apiMock = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...args: unknown[]) => apiMock(...args),
  getToken: () => "jeton-test",
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ peutEcrire: () => true }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  apiMock.mockReset();
});

const PRODUIT_A = { produitId: "p1", produitNom: "Carré 1.500 Fc" };
const PRODUIT_B = { produitId: "p2", produitNom: "Baguette 500 Fc" };

function jourDataFixture(overrides?: Partial<BonLivraisonJourDTO>): BonLivraisonJourDTO {
  return {
    date: "2026-08-14",
    totauxParProduit: [
      { ...PRODUIT_A, quantite: 5 },
      { ...PRODUIT_B, quantite: 2 },
    ],
    totalGeneral: 7,
    totalBacsVides: 1,
    clients: [
      {
        clientId: "c1",
        clientNom: "Dépôt Alpha",
        zoneDepositaireId: null,
        zoneDepositaireNom: null,
        lignes: [
          { produitId: "p1", produitNom: PRODUIT_A.produitNom, quantite: 5 },
          { produitId: "p2", produitNom: PRODUIT_B.produitNom, quantite: 2 },
        ],
        bacsVides: 1,
        livrePar: "Jean",
        observations: null,
        total: 7,
        totalCommande: 7,
      },
    ],
    ...overrides,
  };
}

function schemaDataFixture(): SchemaCommandeJourDTO {
  return {
    date: "2026-08-14",
    clients: [
      {
        clientId: "c1",
        clientNom: "Dépôt Alpha",
        typeClientNom: "Dépositaire",
        zoneDepositaireId: null,
        zoneDepositaireNom: null,
        lignes: [
          { produitId: "p1", produitNom: PRODUIT_A.produitNom, quantite: 8 },
          { produitId: "p2", produitNom: PRODUIT_B.produitNom, quantite: 2 },
        ],
        total: 10,
      },
    ],
    totauxParProduit: [],
    totalGeneral: 10,
  };
}

function cycleFixture(overrides?: Partial<CycleLivraisonDTO>): CycleLivraisonDTO {
  return {
    id: "cycle-c1",
    dateLivraison: "2026-08-14",
    client: { id: "c1", nom: "Dépôt Alpha", typeClientNom: "Dépositaire", zoneDepositaireId: null, zoneDepositaireNom: null },
    statut: "EN_ATTENTE_CONFIRMATION",
    version: 6,
    lignes: [],
    totaux: {
      prevu: 10,
      retenuProduction: 10,
      prepare: 10,
      remisMagasin: 10,
      charge: 10,
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
    derniereTransitionLe: "2026-08-14T08:00:00.000Z",
    ...overrides,
  };
}

function routerApi(reponses: {
  bonsLivraison?: () => unknown;
  schemaCommande?: () => unknown;
  cyclesLivraison?: () => unknown;
}) {
  apiMock.mockImplementation((path: string) => {
    if (path.startsWith("/api/production/bons-livraison?")) {
      return reponses.bonsLivraison ? Promise.resolve(reponses.bonsLivraison()) : Promise.resolve(jourDataFixture());
    }
    if (path.startsWith("/api/zones-depositaires")) return Promise.resolve({ zones: [] });
    if (path.startsWith("/api/production/schema-commande?")) {
      return reponses.schemaCommande ? Promise.resolve(reponses.schemaCommande()) : Promise.resolve(schemaDataFixture());
    }
    if (path.startsWith("/api/production/cycles-livraison?")) {
      return reponses.cyclesLivraison
        ? Promise.resolve(reponses.cyclesLivraison())
        : Promise.resolve({ date: "2026-08-14", cycles: [], totaux: { prevu: 0, charge: 0, accepte: 0, facturable: 0 } });
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
          <BonsLivraisonPage />
        </FeedbackProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BonsLivraisonPage — DOM (F4 round 1)", () => {
  it("affiche un état de chargement, jamais l'état vide, tant que les bons ne sont pas arrivés", async () => {
    routerApi({ bonsLivraison: () => new Promise(() => {}) });
    rendre();

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText(/Aucun des produits du Bon de livraison/)).toBeNull();
  });

  it("état vide explicite quand aucun produit n'est configuré", async () => {
    routerApi({ bonsLivraison: () => jourDataFixture({ totauxParProduit: [], clients: [] }) });
    rendre();

    expect(await screen.findByText(/Aucun des produits du Bon de livraison/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("état d'erreur explicite avec un bouton pour réessayer, distinct de l'état vide", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/production/bons-livraison?")) return Promise.reject(new Error("panne réseau"));
      if (path.startsWith("/api/zones-depositaires")) return Promise.resolve({ zones: [] });
      if (path.startsWith("/api/production/schema-commande?")) return Promise.resolve(schemaDataFixture());
      if (path.startsWith("/api/production/cycles-livraison?"))
        return Promise.resolve({ date: "2026-08-14", cycles: [], totaux: { prevu: 0, charge: 0, accepte: 0, facturable: 0 } });
      return Promise.reject(new Error("route non simulée"));
    });
    rendre();

    expect(await screen.findByText("panne réseau")).toBeTruthy();
    const bouton = screen.getByRole("button", { name: /réessayer/i });
    fireEvent.click(bouton);
    await waitFor(() => expect(apiMock.mock.calls.filter((c) => String(c[0]).includes("bons-livraison?")).length).toBeGreaterThan(1));
  });

  it("écart par produit visible et localisé quand le Schéma diffère de la saisie, absent quand ils concordent", async () => {
    routerApi({});
    rendre();

    await screen.findByRole("table");
    // p1 : prévu 8, saisi 5 → écart -3 visible avec le bon libellé. Le rendu
    // simultané du tableau desktop et de la carte mobile en jsdom (seule une
    // classe CSS les distingue, jamais évaluée hors navigateur réel) produit
    // deux occurrences identiques — c'est attendu, pas un doublon logique.
    const ecarts = await screen.findAllByLabelText("Prévu : 8 — Saisi : 5");
    expect(ecarts).toHaveLength(2);
    for (const ecart of ecarts) expect(ecart.textContent).toBe("-3");
    // p2 : prévu 2, saisi 2 → aucun écart affiché.
    expect(screen.queryByLabelText(/Prévu : 2 —/)).toBeNull();
  });

  it("aucun écart affiché tant que le Schéma de commande n'est pas encore chargé (pas de faux zéro)", async () => {
    routerApi({ schemaCommande: () => new Promise(() => {}) });
    rendre();

    await screen.findByRole("table");
    expect(screen.queryByLabelText(/Prévu :/)).toBeNull();
  });

  it("présente à la fois le tableau desktop et les cartes mobiles pour la même donnée (bascule purement CSS)", async () => {
    routerApi({});
    rendre();

    await screen.findByRole("table");
    // Le nom du client apparaît une fois dans le tableau ET une fois dans la carte mobile.
    expect(screen.getAllByText("Dépôt Alpha")).toHaveLength(2);
  });

  it("affiche la légende du cycle sans aucun statut actif — le statut réel de chaque client s'affiche à sa propre ligne, jamais dans la légende partagée (round 2, connectée en I4)", async () => {
    routerApi({});
    rendre();

    await screen.findByRole("table");
    const chronologie = screen.getByRole("list", { name: "Chronologie du cycle prévision → livraison" });
    expect(chronologie).toBeTruthy();
    // La légende générique n'a jamais aria-current sans cycle réel à côté.
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
    expect(screen.getByText(/proviennent du cycle de livraison réel/)).toBeTruthy();
    // aucune référence interne (numéro de PR) ne doit fuiter dans un texte utilisateur.
    expect(screen.queryByText(/PR #12/)).toBeNull();
  });

  it("surface visiblement l'échec de chargement du Schéma de commande (round 2, revue Codex)", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/production/bons-livraison?")) return Promise.resolve(jourDataFixture());
      if (path.startsWith("/api/zones-depositaires")) return Promise.resolve({ zones: [] });
      if (path.startsWith("/api/production/schema-commande?")) return Promise.reject(new Error("panne réseau du Schéma"));
      if (path.startsWith("/api/production/cycles-livraison?"))
        return Promise.resolve({ date: "2026-08-14", cycles: [], totaux: { prevu: 0, charge: 0, accepte: 0, facturable: 0 } });
      return Promise.reject(new Error("route non simulée"));
    });
    rendre();

    await screen.findByRole("table");
    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toContain("Impossible de charger le Schéma de commande");
    // L'échec du Schéma ne doit ni bloquer l'écran, ni inventer un écart à zéro.
    expect(screen.queryByLabelText(/Prévu :/)).toBeNull();
  });

  it("surface visiblement l'échec de chargement du cycle de livraison (I4)", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/production/bons-livraison?")) return Promise.resolve(jourDataFixture());
      if (path.startsWith("/api/zones-depositaires")) return Promise.resolve({ zones: [] });
      if (path.startsWith("/api/production/schema-commande?")) return Promise.resolve(schemaDataFixture());
      if (path.startsWith("/api/production/cycles-livraison?")) return Promise.reject(new Error("panne réseau du cycle"));
      return Promise.reject(new Error("route non simulée"));
    });
    rendre();

    await screen.findByRole("table");
    const alerte = await screen.findByRole("alert");
    expect(alerte.textContent).toContain("Impossible de charger le cycle de livraison");
  });

  it("affiche le statut réel du cycle à côté du client concerné, sans résultats avant l'acceptation (I4)", async () => {
    routerApi({ cyclesLivraison: () => ({ date: "2026-08-14", cycles: [cycleFixture()], totaux: { prevu: 10, charge: 10, accepte: 0, facturable: 0 } }) });
    rendre();

    await screen.findByRole("table");
    // "En attente de confirmation" apparaît trois fois : une fois dans la
    // légende statique (chronologie complète, toujours affichée) et deux
    // fois pour le statut réel du client (tableau desktop + carte mobile).
    const statuts = await screen.findAllByText("En attente de confirmation");
    expect(statuts).toHaveLength(3);
    // Avant acceptation (totaux.accepte === null côté serveur) : aucun résultat inventé.
    expect(screen.queryByText(/Accepté 0/)).toBeNull();
    expect(screen.queryByText(/Facturable /)).toBeNull();
  });

  it("affiche les résultats accepté/retourné/manquant et le facturable une fois l'acceptation confirmée (I4)", async () => {
    routerApi({
      cyclesLivraison: () => ({
        date: "2026-08-14",
        cycles: [
          cycleFixture({
            statut: "PARTIELLEMENT_ACCEPTEE",
            totaux: { prevu: 10, retenuProduction: 10, prepare: 10, remisMagasin: 10, charge: 10, depose: 7, accepte: 5, retourne: 2, manquant: 0 },
            estFacturable: true,
            commande: { id: "commande-1", numero: 42, quantiteBacs: 5 },
          }),
        ],
        totaux: { prevu: 10, charge: 10, accepte: 5, facturable: 5 },
      }),
    });
    rendre();

    await screen.findByRole("table");
    // Une occurrence dans la légende statique + deux pour le statut réel
    // (tableau desktop + carte mobile), comme pour EN_ATTENTE_CONFIRMATION ci-dessus.
    const statuts = await screen.findAllByText("Partiellement acceptée");
    expect(statuts).toHaveLength(3);
    const resultats = await screen.findAllByText((contenu) => contenu.includes("Accepté 5") && contenu.includes("Retourné 2") && contenu.includes("Manquant 0"));
    expect(resultats).toHaveLength(2);
    const facturables = await screen.findAllByText((contenu) => contenu.includes("Facturable") && contenu.includes("5"));
    expect(facturables).toHaveLength(2);
  });
});
