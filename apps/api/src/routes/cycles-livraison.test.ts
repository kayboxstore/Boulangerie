import { describe, expect, it, vi } from "vitest";
import type { TxClient } from "../lib/prisma.js";
import { contexteRequete } from "../lib/contexteRequete.js";
import { appliquerTransition } from "./cycles-livraison.js";

const ACTEUR = { id: "user-commandes", nom: "Bob Commandes" };
/** CONFIRMER_ACCEPTATION audite désormais Client/CycleLivraisonLigne/CycleLivraison manuellement dans `tx` (round correctif Codex, 29/08/2026) — exige un acteur de contexte de requête, exactement comme une vraie requête HTTP authentifiée (middleware/auth.ts). */
const avecActeur = <T>(executer: () => Promise<T>) => contexteRequete.run(ACTEUR, executer);

function cycleInitial() {
  return {
    id: "cycle-1",
    schemaCommandeId: "schema-1",
    statut: "EN_ATTENTE_CONFIRMATION",
    version: 7,
    livrePar: "Chauffeur A",
    bonRetourne: false,
    bonRetourneLe: null,
    bonRetourneParId: null,
    commandeId: null,
    createdAt: new Date("2026-08-14T08:00:00Z"),
    updatedAt: new Date("2026-08-14T08:00:00Z"),
    schemaCommande: {
      id: "schema-1",
      date: new Date("2026-08-15"),
      clientId: "client-1",
      client: {
        id: "client-1",
        nom: "Dépôt A",
        typeClientId: "type-1",
        avanceDisponible: 0,
        pointsFidelite: 0,
        zoneDepositaireId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        typeClient: {
          id: "type-1",
          nom: "Dépositaire",
          prixParBac: 4100,
          commissionParBac: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        zoneDepositaire: null,
      },
      lignes: [{
        id: "schema-line-1",
        schemaCommandeId: "schema-1",
        produitId: "p1",
        quantite: 50,
        produit: {
          id: "p1",
          nom: "Carré",
          prixVente: 1500,
          tauxTaxe: 0,
          categorie: "Pain",
          actif: true,
          archiveLe: null,
          archiveParId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }],
    },
    lignes: [{
      id: "cycle-line-1",
      cycleId: "cycle-1",
      produitId: "p1",
      quantiteRetenueProduction: 48,
      quantitePreparee: 46,
      quantiteRemiseMagasin: 45,
      quantiteChargee: 45,
      quantiteDeposee: 43,
      quantiteAcceptee: null,
      quantiteRetournee: null,
      quantiteManquante: null,
    }],
    commande: null,
    anomalies: [],
    transitions: [{ createdAt: new Date("2026-08-14T08:30:00Z") }],
  };
}

function cycleFinal(statut: "PARTIELLEMENT_ACCEPTEE" | "RETOUR_TOTAL") {
  const initial = cycleInitial();
  return {
    ...initial,
    statut,
    version: 8,
    commande: statut === "RETOUR_TOTAL" ? null : { id: "commande-1", numero: 123, quantiteBacs: 40 },
    commandeId: statut === "RETOUR_TOTAL" ? null : "commande-1",
    anomalies: [{ type: "BON_NON_RETOURNE" }],
    lignes: initial.lignes.map((ligne) => ({
      ...ligne,
      quantiteAcceptee: statut === "RETOUR_TOTAL" ? 0 : 40,
      quantiteRetournee: statut === "RETOUR_TOTAL" ? 43 : 3,
      quantiteManquante: 2,
    })),
  };
}

function txAcceptation(final: ReturnType<typeof cycleFinal>) {
  return {
    cycleLivraison: {
      findUnique: vi.fn().mockResolvedValueOnce(cycleInitial()).mockResolvedValueOnce(final),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...cycleInitial(), commandeId: "commande-1" }),
    },
    cycleLivraisonLigne: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(cycleInitial().lignes[0]),
    },
    commandeClient: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "commande-1", numero: 123, quantiteBacs: 40, montantRecu: 0 }),
    },
    client: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(cycleInitial().schemaCommande.client),
    },
    anomalieCycleLivraison: { create: vi.fn().mockResolvedValue({ id: "anomalie-bon" }) },
    transitionCycleLivraison: { create: vi.fn().mockResolvedValue({}) },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
}

describe("conversion C4 transactionnelle", () => {
  it("atteint le dépôt sans créer de commande ni effet financier", async () => {
    const avant = {
      ...cycleInitial(),
      statut: "EN_TOURNEE",
      version: 6,
      lignes: cycleInitial().lignes.map((ligne) => ({ ...ligne, quantiteDeposee: null })),
    };
    const apres = {
      ...avant,
      statut: "EN_ATTENTE_CONFIRMATION",
      version: 7,
      lignes: avant.lignes.map((ligne) => ({ ...ligne, quantiteDeposee: 43 })),
    };
    const creerCommande = vi.fn();
    const tx = {
      cycleLivraison: {
        findUnique: vi.fn().mockResolvedValueOnce(avant).mockResolvedValueOnce(apres),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      cycleLivraisonLigne: { update: vi.fn().mockResolvedValue({}) },
      commandeClient: { create: creerCommande },
      client: { update: vi.fn() },
      transitionCycleLivraison: { create: vi.fn().mockResolvedValue({}) },
    };
    const resultat = await appliquerTransition(
      tx as unknown as TxClient,
      "cycle-1",
      {
        action: "SIGNALER_DEPOT",
        version: 6,
        lignes: [{ produitId: "p1", quantite: 43 }],
      },
      "user-production",
    );
    expect(creerCommande).not.toHaveBeenCalled();
    expect(tx.client.update).not.toHaveBeenCalled();
    expect(resultat.cycle.statut).toBe("EN_ATTENTE_CONFIRMATION");
    expect(resultat.commande).toBeNull();
  });

  it("crée exactement une commande de 40, reçue à 0, à la date de livraison, avec l'audit transactionnel Client/CycleLivraison/CycleLivraisonLigne", async () => {
    const brut = txAcceptation(cycleFinal("PARTIELLEMENT_ACCEPTEE"));
    const resultat = await avecActeur(() =>
      appliquerTransition(
        brut as unknown as TxClient,
        "cycle-1",
        {
          action: "CONFIRMER_ACCEPTATION",
          version: 7,
          lignes: [{ produitId: "p1", quantiteAcceptee: 40, quantiteRetournee: 3 }],
          bonRetourne: false,
        },
        "user-commandes",
      ),
    );

    expect(brut.commandeClient.create).toHaveBeenCalledTimes(1);
    expect(brut.commandeClient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clientId: "client-1",
        quantiteBacs: 40,
        montantRecu: 0,
        montantBrut: 164_000,
        dette: 164_000,
        dateOperationnelle: new Date("2026-08-15"),
      }),
      select: { id: true, numero: true, quantiteBacs: true, montantRecu: true },
    });
    // updateMany (jamais update() singulier, cf. lib/audit.ts) + audit manuel
    // transactionnel — round correctif Codex, 29/08/2026.
    expect(brut.cycleLivraison.updateMany).toHaveBeenCalledWith({
      where: { id: "cycle-1" },
      data: { commandeId: "commande-1" },
    });
    expect(brut.client.updateMany).toHaveBeenCalledWith({
      where: { id: "client-1" },
      data: { avanceDisponible: expect.any(Number) },
    });
    expect(brut.cycleLivraisonLigne.updateMany).toHaveBeenCalledWith({
      where: { id: "cycle-line-1" },
      data: expect.objectContaining({ quantiteAcceptee: 40, quantiteRetournee: 3 }),
    });
    expect(brut.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ module: "COMMANDES", typeEntite: "Client", action: "MODIFICATION" }),
      }),
    );
    expect(brut.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ module: "PRODUCTION", typeEntite: "CycleLivraison", action: "MODIFICATION" }),
      }),
    );
    expect(brut.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ module: "PRODUCTION", typeEntite: "CycleLivraisonLigne", action: "MODIFICATION" }),
      }),
    );
    expect(brut.anomalieCycleLivraison.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ cycleId: "cycle-1", type: "BON_NON_RETOURNE" }),
    });
    expect(resultat.cycle.anomalieOuverte).toBe(true);
    expect(resultat.cycle.typesAnomalie).toContain("BON_NON_RETOURNE");
    expect(resultat.commande).toEqual({ id: "commande-1", numero: 123, quantiteBacs: 40, montantRecu: 0 });
  });

  it("avec une avance client strictement positive : l'avance est réellement consommée, montant à percevoir/dette/nouvelle avance corrects, audit Client exact avant/après (P1 — round correctif Codex)", async () => {
    // Avance initiale 3000, 40 bacs acceptés à 4100 Fc/bac : montantBrut
    // 164 000, avanceUtilisee = min(3000, 164 000) = 3000 (intégralement
    // consommée), montantAPercevoir = 161 000, montantRecu = 0 (C4),
    // dette = 161 000, avanceGeneree = 0, nouvelleAvance = 3000 - 3000 + 0 = 0.
    const clientAvecAvance = { ...cycleInitial().schemaCommande.client, avanceDisponible: 3000 };
    const cycleAvecAvance = {
      ...cycleInitial(),
      schemaCommande: { ...cycleInitial().schemaCommande, client: clientAvecAvance },
    };
    const final = { ...cycleFinal("PARTIELLEMENT_ACCEPTEE"), schemaCommande: cycleAvecAvance.schemaCommande };
    const brut = {
      cycleLivraison: {
        findUnique: vi.fn().mockResolvedValueOnce(cycleAvecAvance).mockResolvedValueOnce(final),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...cycleAvecAvance, commandeId: "commande-avance" }),
      },
      cycleLivraisonLigne: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue(cycleInitial().lignes[0]),
      },
      commandeClient: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: "commande-avance", numero: 456, quantiteBacs: 40, montantRecu: 0 }),
      },
      client: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...clientAvecAvance, avanceDisponible: 0 }),
      },
      anomalieCycleLivraison: { create: vi.fn().mockResolvedValue({ id: "anomalie-avance" }) },
      transitionCycleLivraison: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };

    await avecActeur(() =>
      appliquerTransition(
        brut as unknown as TxClient,
        "cycle-1",
        {
          action: "CONFIRMER_ACCEPTATION",
          version: 7,
          lignes: [{ produitId: "p1", quantiteAcceptee: 40, quantiteRetournee: 3 }],
          bonRetourne: true,
        },
        "user-commandes",
      ),
    );

    expect(brut.commandeClient.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        avanceUtilisee: 3000,
        montantAPercevoir: 161_000,
        montantRecu: 0,
        dette: 161_000,
        avanceGeneree: 0,
        nouvelleAvance: 0,
      }),
      select: { id: true, numero: true, quantiteBacs: true, montantRecu: true },
    });
    expect(brut.client.updateMany).toHaveBeenCalledWith({
      where: { id: "client-1" },
      data: { avanceDisponible: 0 },
    });
    expect(brut.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          module: "COMMANDES",
          typeEntite: "Client",
          entiteId: "client-1",
          action: "MODIFICATION",
          avant: expect.objectContaining({ avanceDisponible: 3000 }),
          apres: expect.objectContaining({ avanceDisponible: 0 }),
        }),
      }),
    );
  });

  it("n'écrit aucune commande lorsque le total accepté vaut zéro", async () => {
    const brut = txAcceptation(cycleFinal("RETOUR_TOTAL"));
    const resultat = await avecActeur(() =>
      appliquerTransition(
        brut as unknown as TxClient,
        "cycle-1",
        {
          action: "CONFIRMER_ACCEPTATION",
          version: 7,
          lignes: [{ produitId: "p1", quantiteAcceptee: 0, quantiteRetournee: 43 }],
          bonRetourne: false,
        },
        "user-commandes",
      ),
    );
    expect(brut.commandeClient.create).not.toHaveBeenCalled();
    expect(brut.client.updateMany).not.toHaveBeenCalled();
    expect(resultat.commande).toBeNull();
    expect(resultat.cycle.statut).toBe("RETOUR_TOTAL");
  });

  it("rejette une version perdue par une acceptation concurrente avant toute commande", async () => {
    const brut = txAcceptation(cycleFinal("PARTIELLEMENT_ACCEPTEE"));
    brut.cycleLivraison.updateMany.mockResolvedValueOnce({ count: 0 });
    brut.cycleLivraison.findUnique
      .mockReset()
      .mockResolvedValueOnce(cycleInitial())
      .mockResolvedValueOnce({ version: 8 });
    await expect(
      avecActeur(() =>
        appliquerTransition(
          brut as unknown as TxClient,
          "cycle-1",
          {
            action: "CONFIRMER_ACCEPTATION",
            version: 7,
            lignes: [{ produitId: "p1", quantiteAcceptee: 40, quantiteRetournee: 3 }],
            bonRetourne: false,
          },
          "user-commandes",
        ),
      ),
    ).rejects.toMatchObject({ code: "VERSION_OBSOLETE", versionCourante: 8 });
    expect(brut.commandeClient.create).not.toHaveBeenCalled();
  });

  it("refuse une commande manuelle du même jour sans double facturation", async () => {
    const brut = txAcceptation(cycleFinal("PARTIELLEMENT_ACCEPTEE"));
    brut.commandeClient.findFirst.mockResolvedValueOnce({ id: "commande-manuelle" });
    await expect(
      avecActeur(() =>
        appliquerTransition(
          brut as unknown as TxClient,
          "cycle-1",
          {
            action: "CONFIRMER_ACCEPTATION",
            version: 7,
            lignes: [{ produitId: "p1", quantiteAcceptee: 40, quantiteRetournee: 3 }],
            bonRetourne: false,
          },
          "user-commandes",
        ),
      ),
    ).rejects.toMatchObject({ code: "COMMANDE_JOUR_EXISTANTE" });
    expect(brut.commandeClient.create).not.toHaveBeenCalled();
  });
});
