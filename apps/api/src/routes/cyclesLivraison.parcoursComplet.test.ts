import { describe, expect, it } from "vitest";
import type { TransitionCycleLivraisonInput } from "@lomoto/shared/cycles-livraison";
import type { TxClient } from "../lib/prisma.js";
import { contexteRequete } from "../lib/contexteRequete.js";
import { appliquerTransition } from "./cycles-livraison.js";

const ACTEUR_E2E = { id: "user-e2e", nom: "Utilisateur E2E" };
/** CONFIRMER_ACCEPTATION audite désormais Client/CycleLivraison/CycleLivraisonLigne dans `tx` (round correctif Codex, 29/08/2026) — exige un acteur de contexte de requête. */
const avecActeur = <T>(executer: () => Promise<T>) => contexteRequete.run(ACTEUR_E2E, executer);

/**
 * Test d'intégration bout en bout du parcours réel du cycle C4 (I5, vague
 * 3) — contrairement à cycles-livraison.test.ts qui isole chaque transition
 * avec un état de départ fabriqué, ce fichier enchaîne RÉELLEMENT les sept
 * transitions dans l'ordre exact du contrat (PREVISION → ... →
 * CONFIRMER_ACCEPTATION), sur un état simulé en mémoire qui persiste entre
 * les appels : l'état muté par une transition est celui lu par la
 * suivante, exactement comme une vraie base de données le ferait au fil
 * des appels successifs de l'API.
 */

function creerEtatInitial() {
  return {
    id: "cycle-e2e",
    statut: "PREVISION" as string,
    version: 1,
    livrePar: null as string | null,
    bonRetourne: false,
    bonRetourneLe: null as Date | null,
    bonRetourneParId: null as string | null,
    commandeId: null as string | null,
    schemaCommande: {
      id: "schema-e2e",
      date: new Date("2026-08-15"),
      clientId: "client-e2e",
      client: {
        id: "client-e2e",
        nom: "Dépôt Bout en Bout",
        typeClientId: "type-e2e",
        avanceDisponible: 0,
        pointsFidelite: 0,
        zoneDepositaireId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        typeClient: {
          id: "type-e2e",
          nom: "Dépositaire",
          prixParBac: 4100,
          commissionParBac: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        zoneDepositaire: null,
      },
      lignes: [
        {
          id: "schema-ligne-e2e",
          schemaCommandeId: "schema-e2e",
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
        },
      ],
    },
    lignes: [
      {
        id: "cycle-ligne-e2e",
        cycleId: "cycle-e2e",
        produitId: "p1",
        quantiteRetenueProduction: null as number | null,
        quantitePreparee: null as number | null,
        quantiteRemiseMagasin: null as number | null,
        quantiteChargee: null as number | null,
        quantiteDeposee: null as number | null,
        quantiteAcceptee: null as number | null,
        quantiteRetournee: null as number | null,
        quantiteManquante: null as number | null,
      },
    ],
    commande: null as { id: string; numero: number; quantiteBacs: number } | null,
    anomalies: [] as { type: string; resolueLe: Date | null }[],
    transitions: [] as { createdAt: Date }[],
  };
}

type EtatCycle = ReturnType<typeof creerEtatInitial>;

/** Simule Prisma sur un état mutable partagé — pas une vraie base, mais un état RÉELLEMENT persistant entre les appels successifs. */
function creerTxEnMemoire(etat: EtatCycle) {
  let prochainNumeroCommande = 900;
  const appelsCommandeCreate: Record<string, unknown>[] = [];

  const auditLogs: Record<string, unknown>[] = [];

  const tx = {
    cycleLivraison: {
      findUnique: async () => structuredClone(etat),
      updateMany: async ({ where, data }: { where: { id: string; version?: number; statut?: string }; data: Record<string, unknown> }) => {
        if (where.id !== etat.id) return { count: 0 };
        if (where.version !== undefined && where.statut !== undefined) {
          if (etat.version !== where.version || etat.statut !== where.statut) return { count: 0 };
        }
        if (typeof data.statut === "string") etat.statut = data.statut;
        if (data.livrePar !== undefined) etat.livrePar = data.livrePar as string;
        if (data.bonRetourne !== undefined) etat.bonRetourne = data.bonRetourne as boolean;
        if (data.bonRetourneLe !== undefined) etat.bonRetourneLe = data.bonRetourneLe as Date;
        if (data.bonRetourneParId !== undefined) etat.bonRetourneParId = data.bonRetourneParId as string;
        if (data.commandeId !== undefined) etat.commandeId = data.commandeId as string;
        const versionIncrement = data.version as { increment?: number } | undefined;
        if (versionIncrement?.increment) etat.version += versionIncrement.increment;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => structuredClone(etat),
    },
    cycleLivraisonLigne: {
      // update() singulier reste utilisé par appliquerLignesSimples, pour les
      // transitions AUTRES que CONFIRMER_ACCEPTATION — hors périmètre de ce
      // round correctif (voir cartographie du rapport final).
      update: async ({
        where,
        data,
      }: {
        where: { cycleId_produitId: { produitId: string } };
        data: Record<string, number>;
      }) => {
        const ligne = etat.lignes.find((l) => l.produitId === where.cycleId_produitId.produitId)!;
        Object.assign(ligne, data);
        return {};
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, number>;
      }) => {
        const ligne = etat.lignes.find((l) => l.id === where.id);
        if (!ligne) return { count: 0 };
        Object.assign(ligne, data);
        return { count: 1 };
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        return structuredClone(etat.lignes.find((l) => l.id === where.id)!);
      },
    },
    commandeClient: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        appelsCommandeCreate.push(data);
        const numero = ++prochainNumeroCommande;
        const commande = {
          id: `commande-${numero}`,
          numero,
          quantiteBacs: data.quantiteBacs as number,
          montantRecu: data.montantRecu as number,
        };
        etat.commande = commande;
        return commande;
      },
    },
    client: {
      updateMany: async ({ where, data }: { where: { id: string }; data: { avanceDisponible?: number } }) => {
        if (where.id !== etat.schemaCommande.client.id) return { count: 0 };
        if (data.avanceDisponible !== undefined) etat.schemaCommande.client.avanceDisponible = data.avanceDisponible;
        return { count: 1 };
      },
      findUniqueOrThrow: async () => structuredClone(etat.schemaCommande.client),
    },
    anomalieCycleLivraison: {
      create: async ({ data }: { data: { type: string } }) => {
        etat.anomalies.push({ type: data.type, resolueLe: null });
        return { id: "anomalie-e2e" };
      },
    },
    transitionCycleLivraison: {
      create: async () => {
        etat.transitions.unshift({ createdAt: new Date() });
        return {};
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
      },
    },
  };

  return { tx: tx as unknown as TxClient, appelsCommandeCreate, auditLogs };
}

const PARCOURS_PRODUCTION: { input: TransitionCycleLivraisonInput; statutAttendu: string; versionAttendue: number }[] = [
  { input: { action: "RETENIR_PRODUCTION", version: 1, lignes: [{ produitId: "p1", quantite: 48 }] }, statutAttendu: "RETENUE_PRODUCTION", versionAttendue: 2 },
  { input: { action: "CONFIRMER_PREPARATION", version: 2, lignes: [{ produitId: "p1", quantite: 46 }] }, statutAttendu: "PREPAREE", versionAttendue: 3 },
  { input: { action: "CONFIRMER_REMISE_MAGASIN", version: 3, lignes: [{ produitId: "p1", quantite: 45 }] }, statutAttendu: "REMISE_MAGASIN", versionAttendue: 4 },
  {
    input: { action: "CONFIRMER_CHARGEMENT", version: 4, livrePar: "Chauffeur E2E", lignes: [{ produitId: "p1", quantite: 45 }] },
    statutAttendu: "CHARGEE",
    versionAttendue: 5,
  },
  { input: { action: "CONFIRMER_DEPART", version: 5 }, statutAttendu: "EN_TOURNEE", versionAttendue: 6 },
  { input: { action: "SIGNALER_DEPOT", version: 6, lignes: [{ produitId: "p1", quantite: 43 }] }, statutAttendu: "EN_ATTENTE_CONFIRMATION", versionAttendue: 7 },
];

describe("Parcours complet du cycle C4 — bout en bout (I5, vague 3)", () => {
  it("PREVISION → ... → PARTIELLEMENT_ACCEPTEE : chaque étape lit RÉELLEMENT l'état laissé par la précédente, la commande facturable est créée avec le bon montant", () => avecActeur(async () => {
    const etat = creerEtatInitial();
    const { tx, appelsCommandeCreate } = creerTxEnMemoire(etat);

    for (const etape of PARCOURS_PRODUCTION) {
      const resultat = await appliquerTransition(tx, "cycle-e2e", etape.input, "user-e2e");
      expect(resultat.cycle.statut).toBe(etape.statutAttendu);
      expect(resultat.cycle.version).toBe(etape.versionAttendue);
      // Aucune commande, aucun effet financier avant l'acceptation — à chaque étape.
      expect(resultat.commande).toBeNull();
      expect(resultat.cycle.estFacturable).toBe(false);
    }

    const finale = await appliquerTransition(
      tx,
      "cycle-e2e",
      {
        action: "CONFIRMER_ACCEPTATION",
        version: 7,
        lignes: [{ produitId: "p1", quantiteAcceptee: 40, quantiteRetournee: 3 }],
        bonRetourne: true,
      },
      "user-commandes-e2e",
    );

    expect(finale.cycle.statut).toBe("PARTIELLEMENT_ACCEPTEE");
    expect(finale.cycle.version).toBe(8);
    expect(finale.cycle.totaux.accepte).toBe(40);
    expect(finale.cycle.totaux.retourne).toBe(3);
    // Manquant = chargé (45) − déposé (43), une règle logistique indépendante de l'accepté/retourné.
    expect(finale.cycle.totaux.manquant).toBe(2);
    expect(finale.cycle.estFacturable).toBe(true);
    expect(finale.commande).not.toBeNull();
    expect(finale.commande!.quantiteBacs).toBe(40);
    expect(finale.cycle.commande?.quantiteBacs).toBe(40);

    expect(appelsCommandeCreate).toHaveLength(1);
    expect(appelsCommandeCreate[0]).toMatchObject({
      clientId: "client-e2e",
      quantiteBacs: 40,
      montantBrut: 40 * 4100,
      montantRecu: 0,
      dette: 40 * 4100,
      dateOperationnelle: new Date("2026-08-15"),
    });
  }));

  it("un retour total (accepté = 0) après tout le parcours ne crée jamais de commande", () => avecActeur(async () => {
    const etat = creerEtatInitial();
    const { tx, appelsCommandeCreate } = creerTxEnMemoire(etat);

    for (const etape of PARCOURS_PRODUCTION) {
      await appliquerTransition(tx, "cycle-e2e", etape.input, "user-e2e");
    }
    const finale = await appliquerTransition(
      tx,
      "cycle-e2e",
      { action: "CONFIRMER_ACCEPTATION", version: 7, lignes: [{ produitId: "p1", quantiteAcceptee: 0, quantiteRetournee: 43 }], bonRetourne: true },
      "user-commandes-e2e",
    );

    expect(finale.cycle.statut).toBe("RETOUR_TOTAL");
    expect(finale.commande).toBeNull();
    expect(finale.cycle.estFacturable).toBe(false);
    expect(appelsCommandeCreate).toHaveLength(0);
  }));

  it("acceptation intégrale (accepté = déposé) : statut ACCEPTEE, aucun retourné", () => avecActeur(async () => {
    const etat = creerEtatInitial();
    const { tx, appelsCommandeCreate } = creerTxEnMemoire(etat);

    for (const etape of PARCOURS_PRODUCTION) {
      await appliquerTransition(tx, "cycle-e2e", etape.input, "user-e2e");
    }
    const finale = await appliquerTransition(
      tx,
      "cycle-e2e",
      { action: "CONFIRMER_ACCEPTATION", version: 7, lignes: [{ produitId: "p1", quantiteAcceptee: 43, quantiteRetournee: 0 }], bonRetourne: true },
      "user-commandes-e2e",
    );

    expect(finale.cycle.statut).toBe("ACCEPTEE");
    expect(finale.commande).not.toBeNull();
    expect(finale.commande!.quantiteBacs).toBe(43);
    expect(appelsCommandeCreate).toHaveLength(1);
  }));

  it("une transition qui saute une étape (sans passer par la précédente) est rejetée par l'état réel, jamais simulée côté client", async () => {
    const etat = creerEtatInitial();
    const { tx } = creerTxEnMemoire(etat);
    // Le cycle est encore en PREVISION : CONFIRMER_PREPARATION attend RETENUE_PRODUCTION.
    await expect(
      appliquerTransition(tx, "cycle-e2e", { action: "CONFIRMER_PREPARATION", version: 1, lignes: [{ produitId: "p1", quantite: 50 }] }, "u"),
    ).rejects.toMatchObject({ code: "TRANSITION_INTERDITE" });
  });

  it("CONFIRMER_ACCEPTATION avec une version déjà obsolète échoue et ne crée aucune commande — jamais d'écrasement silencieux", () => avecActeur(async () => {
    const etat = creerEtatInitial();
    const { tx, appelsCommandeCreate } = creerTxEnMemoire(etat);

    for (const etape of PARCOURS_PRODUCTION) {
      await appliquerTransition(tx, "cycle-e2e", etape.input, "user-e2e");
    }
    // La version réelle est maintenant 7 — soumission avec une version périmée (6).
    await expect(
      appliquerTransition(
        tx,
        "cycle-e2e",
        { action: "CONFIRMER_ACCEPTATION", version: 6, lignes: [{ produitId: "p1", quantiteAcceptee: 43, quantiteRetournee: 0 }], bonRetourne: false },
        "u",
      ),
    ).rejects.toMatchObject({ code: "VERSION_OBSOLETE", versionCourante: 7 });
    expect(appelsCommandeCreate).toHaveLength(0);
  }));

  it("CONFIRMER_ACCEPTATION avant que le dépôt ne soit confirmé échoue, quel que soit l'ordre soumis", () => avecActeur(async () => {
    const etat = creerEtatInitial();
    const { tx, appelsCommandeCreate } = creerTxEnMemoire(etat);
    // On s'arrête juste avant SIGNALER_DEPOT (statut CHARGEE puis EN_TOURNEE, jamais déposé).
    await appliquerTransition(tx, "cycle-e2e", PARCOURS_PRODUCTION[0].input, "u");
    await appliquerTransition(tx, "cycle-e2e", PARCOURS_PRODUCTION[1].input, "u");
    await appliquerTransition(tx, "cycle-e2e", PARCOURS_PRODUCTION[2].input, "u");
    await appliquerTransition(tx, "cycle-e2e", PARCOURS_PRODUCTION[3].input, "u");
    await appliquerTransition(tx, "cycle-e2e", PARCOURS_PRODUCTION[4].input, "u");
    // Statut réel : EN_TOURNEE — CONFIRMER_ACCEPTATION attend EN_ATTENTE_CONFIRMATION.
    await expect(
      appliquerTransition(
        tx,
        "cycle-e2e",
        { action: "CONFIRMER_ACCEPTATION", version: 6, lignes: [{ produitId: "p1", quantiteAcceptee: 45, quantiteRetournee: 0 }], bonRetourne: false },
        "u",
      ),
    ).rejects.toMatchObject({ code: "TRANSITION_INTERDITE" });
    expect(appelsCommandeCreate).toHaveLength(0);
  }));
});
