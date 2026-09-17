import { describe, expect, it, vi } from "vitest";
import type { TxClient } from "../lib/prisma.js";
import {
  calculerQuantiteManquante,
  determinerStatutAcceptation,
  ErreurCycleLivraison,
  peutExecuterActionCycle,
  statutAttenduPourAction,
  statutSuivantPourAction,
  synchroniserPrevisionsCycles,
  validerLignesAcceptation,
  validerLignesQuantite,
  validerResultatAcceptation,
} from "./cyclesLivraison.js";

describe("cycle de livraison C4 — logique contractuelle", () => {
  it("impose la séquence jusqu'à l'attente de confirmation, EN_TOURNEE comprise", () => {
    expect(statutAttenduPourAction("RETENIR_PRODUCTION")).toBe("PREVISION");
    expect(statutSuivantPourAction("CONFIRMER_CHARGEMENT")).toBe("CHARGEE");
    expect(statutSuivantPourAction("CONFIRMER_DEPART")).toBe("EN_TOURNEE");
    expect(statutSuivantPourAction("SIGNALER_DEPOT")).toBe("EN_ATTENTE_CONFIRMATION");
    expect(statutAttenduPourAction("CONFIRMER_ACCEPTATION")).toBe("EN_ATTENTE_CONFIRMATION");
  });

  it("reproduit l'exemple 50/45/43/40/3 : commande 40 et manquant 2", () => {
    const resultat = validerResultatAcceptation([
      {
        produitId: "pain",
        quantiteChargee: 45,
        quantiteDeposee: 43,
        quantiteAcceptee: 40,
        quantiteRetournee: 3,
      },
    ]);
    expect(resultat.totalAccepte).toBe(40);
    expect(resultat.statut).toBe("PARTIELLEMENT_ACCEPTEE");
    expect(resultat.manquants.get("pain")).toBe(2);
  });

  it("calcule le manquant uniquement par chargé - déposé", () => {
    expect(calculerQuantiteManquante(45, 43)).toBe(2);
    const a = validerResultatAcceptation([
      { produitId: "p", quantiteChargee: 45, quantiteDeposee: 43, quantiteAcceptee: 40, quantiteRetournee: 3 },
    ]);
    const b = validerResultatAcceptation([
      { produitId: "p", quantiteChargee: 45, quantiteDeposee: 43, quantiteAcceptee: 41, quantiteRetournee: 0 },
    ]);
    expect(a.manquants.get("p")).toBe(2);
    expect(b.manquants.get("p")).toBe(2);
  });

  it("ne crée conceptuellement aucune commande pour une acceptation totale zéro", () => {
    expect(determinerStatutAcceptation(0, 43)).toBe("RETOUR_TOTAL");
  });

  it("distingue acceptation totale et partielle", () => {
    expect(determinerStatutAcceptation(43, 43)).toBe("ACCEPTEE");
    expect(determinerStatutAcceptation(40, 43)).toBe("PARTIELLEMENT_ACCEPTEE");
  });

  it("refuse un dépôt supérieur au chargement", () => {
    expect(() => calculerQuantiteManquante(42, 43)).toThrowError(ErreurCycleLivraison);
  });

  it("refuse accepté + retourné supérieur au déposé", () => {
    expect(() =>
      validerResultatAcceptation([
        { produitId: "p", quantiteChargee: 45, quantiteDeposee: 43, quantiteAcceptee: 41, quantiteRetournee: 3 },
      ]),
    ).toThrowError(ErreurCycleLivraison);
  });

  it("exige exactement une quantité pour chaque produit", () => {
    expect(validerLignesQuantite(["p1", "p2"], [
      { produitId: "p1", quantite: 5 },
      { produitId: "p2", quantite: 7 },
    ])).toEqual(new Map([["p1", 5], ["p2", 7]]));
    expect(() => validerLignesQuantite(["p1", "p2"], [{ produitId: "p1", quantite: 5 }])).toThrowError(
      ErreurCycleLivraison,
    );
    expect(() => validerLignesQuantite(["p1"], [
      { produitId: "p1", quantite: 5 },
      { produitId: "p1", quantite: 6 },
    ])).toThrowError(ErreurCycleLivraison);
  });

  it("exige également toutes les lignes lors de l'acceptation", () => {
    expect(() => validerLignesAcceptation(["p1", "p2"], [
      { produitId: "p1", quantiteAcceptee: 5, quantiteRetournee: 0 },
    ])).toThrowError(ErreurCycleLivraison);
  });

  it("interdit au seul rôle Production de confirmer l'acceptation financière", () => {
    const production = [{ module: "PRODUCTION" as const, niveauAcces: "ECRITURE" as const }];
    const commandes = [{ module: "COMMANDES" as const, niveauAcces: "ECRITURE" as const }];
    expect(peutExecuterActionCycle(production, "CONFIRMER_DEPART")).toBe(true);
    expect(peutExecuterActionCycle(production, "CONFIRMER_ACCEPTATION")).toBe(false);
    expect(peutExecuterActionCycle(commandes, "CONFIRMER_ACCEPTATION")).toBe(true);
  });
});

describe("synchronisation du Schéma avec son cycle stable", () => {
  const date = new Date("2026-08-15");

  it("interdit de supprimer un cycle déjà démarré", async () => {
    const supprimer = vi.fn();
    const tx = {
      schemaCommande: {
        findMany: vi.fn().mockResolvedValue([
          { id: "schema-1", clientId: "client-1", lignes: [], cycle: { id: "cycle-1", statut: "CHARGEE" } },
        ]),
        delete: supprimer,
      },
    } as unknown as TxClient;
    await expect(synchroniserPrevisionsCycles(tx, date, [], "user-1")).rejects.toMatchObject({
      code: "CYCLE_DEJA_DEMARRE",
    });
    expect(supprimer).not.toHaveBeenCalled();
  });

  it("interdit de modifier une prévision après le démarrage", async () => {
    const tx = {
      schemaCommande: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "schema-1",
            clientId: "client-1",
            lignes: [{ produitId: "p1", quantite: 50 }],
            cycle: { id: "cycle-1", statut: "RETENUE_PRODUCTION" },
          },
        ]),
      },
    } as unknown as TxClient;
    await expect(
      synchroniserPrevisionsCycles(
        tx,
        date,
        [{ clientId: "client-1", lignes: [{ produitId: "p1", quantite: 51 }] }],
        "user-1",
      ),
    ).rejects.toMatchObject({ code: "PREVISION_VERROUILLEE" });
  });

  it("accepte sans écriture le rejeu identique d'une prévision verrouillée", async () => {
    const modifier = vi.fn();
    const tx = {
      schemaCommande: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "schema-1",
            clientId: "client-1",
            lignes: [{ produitId: "p1", quantite: 50 }],
            cycle: { id: "cycle-1", statut: "CHARGEE" },
          },
        ]),
        update: modifier,
      },
    } as unknown as TxClient;
    await synchroniserPrevisionsCycles(
      tx,
      date,
      [{ clientId: "client-1", lignes: [{ produitId: "p1", quantite: 50 }] }],
      "user-1",
    );
    expect(modifier).not.toHaveBeenCalled();
  });

  it("met à jour une prévision neuve sans changer l'identifiant du cycle", async () => {
    const majCycle = vi.fn().mockResolvedValue({});
    const tx = {
      schemaCommande: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "schema-1",
            clientId: "client-1",
            lignes: [{ produitId: "p1", quantite: 50 }],
            cycle: { id: "cycle-stable", statut: "PREVISION", version: 1 },
          },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      schemaCommandeLigne: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      cycleLivraisonLigne: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      cycleLivraison: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: majCycle },
    } as unknown as TxClient;
    await synchroniserPrevisionsCycles(
      tx,
      date,
      [{ clientId: "client-1", lignes: [{ produitId: "p1", quantite: 55 }] }],
      "user-1",
    );
    expect(majCycle).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "cycle-stable" } }));
  });

  it("crée le cycle imbriqué avec une nouvelle prévision", async () => {
    const creer = vi.fn().mockResolvedValue({});
    const tx = {
      schemaCommande: { findMany: vi.fn().mockResolvedValue([]), create: creer },
    } as unknown as TxClient;
    await synchroniserPrevisionsCycles(
      tx,
      date,
      [{ clientId: "client-1", lignes: [{ produitId: "p1", quantite: 50 }] }],
      "user-1",
    );
    expect(creer).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: "client-1",
        cycle: { create: { lignes: { create: [{ produitId: "p1" }] } } },
      }),
    });
  });
});
