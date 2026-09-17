import type { Prisma, StatutCycleLivraison } from "@prisma/client";
import { aAcces, type PermissionDTO, type SchemaCommandeJourInput } from "@lomoto/shared";
import type {
  ActionCycleLivraison,
  TransitionCycleLivraisonInput,
} from "@lomoto/shared/cycles-livraison";
import type { TxClient } from "../lib/prisma.js";

export type CodeErreurCycleLivraison =
  | "DONNEES_INVALIDES"
  | "CYCLE_INTROUVABLE"
  | "VERSION_OBSOLETE"
  | "TRANSITION_INTERDITE"
  | "PREVISION_VERROUILLEE"
  | "CYCLE_DEJA_DEMARRE"
  | "COMMANDE_JOUR_EXISTANTE"
  | "ACCEPTATION_DEJA_CONVERTIE"
  | "ANOMALIE_INTROUVABLE"
  | "ANOMALIE_DEJA_RESOLUE";

export class ErreurCycleLivraison extends Error {
  constructor(
    message: string,
    readonly statutHttp: 400 | 404 | 409,
    readonly code: CodeErreurCycleLivraison,
    readonly versionCourante?: number,
  ) {
    super(message);
  }
}

const TRANSITIONS_ATTENDUES: Record<ActionCycleLivraison, StatutCycleLivraison> = {
  RETENIR_PRODUCTION: "PREVISION",
  CONFIRMER_PREPARATION: "RETENUE_PRODUCTION",
  CONFIRMER_REMISE_MAGASIN: "PREPAREE",
  CONFIRMER_CHARGEMENT: "REMISE_MAGASIN",
  CONFIRMER_DEPART: "CHARGEE",
  SIGNALER_DEPOT: "EN_TOURNEE",
  CONFIRMER_ACCEPTATION: "EN_ATTENTE_CONFIRMATION",
};

const TRANSITIONS_SUIVANTES: Partial<Record<ActionCycleLivraison, StatutCycleLivraison>> = {
  RETENIR_PRODUCTION: "RETENUE_PRODUCTION",
  CONFIRMER_PREPARATION: "PREPAREE",
  CONFIRMER_REMISE_MAGASIN: "REMISE_MAGASIN",
  CONFIRMER_CHARGEMENT: "CHARGEE",
  CONFIRMER_DEPART: "EN_TOURNEE",
  SIGNALER_DEPOT: "EN_ATTENTE_CONFIRMATION",
};

export function statutAttenduPourAction(action: ActionCycleLivraison): StatutCycleLivraison {
  return TRANSITIONS_ATTENDUES[action];
}

export function statutSuivantPourAction(action: Exclude<ActionCycleLivraison, "CONFIRMER_ACCEPTATION">) {
  return TRANSITIONS_SUIVANTES[action]!;
}

export function peutExecuterActionCycle(
  permissions: PermissionDTO[],
  action: ActionCycleLivraison,
): boolean {
  return action === "CONFIRMER_ACCEPTATION"
    ? aAcces(permissions, "COMMANDES", "ECRITURE")
    : aAcces(permissions, "PRODUCTION", "ECRITURE");
}

export function determinerStatutAcceptation(totalAccepte: number, totalDepose: number): StatutCycleLivraison {
  if (totalAccepte === 0) return "RETOUR_TOTAL";
  return totalAccepte === totalDepose ? "ACCEPTEE" : "PARTIELLEMENT_ACCEPTEE";
}

export function calculerQuantiteManquante(quantiteChargee: number, quantiteDeposee: number): number {
  if (quantiteDeposee > quantiteChargee) {
    throw new ErreurCycleLivraison(
      "La quantité déposée ne peut pas dépasser la quantité chargée",
      400,
      "DONNEES_INVALIDES",
    );
  }
  return quantiteChargee - quantiteDeposee;
}

export interface LigneResultatAcceptation {
  produitId: string;
  quantiteChargee: number;
  quantiteDeposee: number;
  quantiteAcceptee: number;
  quantiteRetournee: number;
}

export function validerResultatAcceptation(lignes: readonly LigneResultatAcceptation[]) {
  let totalAccepte = 0;
  let totalDepose = 0;
  const manquants = new Map<string, number>();
  for (const ligne of lignes) {
    if (ligne.quantiteAcceptee + ligne.quantiteRetournee > ligne.quantiteDeposee) {
      throw new ErreurCycleLivraison(
        "La somme acceptée et retournée ne peut pas dépasser la quantité déposée",
        400,
        "DONNEES_INVALIDES",
      );
    }
    totalAccepte += ligne.quantiteAcceptee;
    totalDepose += ligne.quantiteDeposee;
    manquants.set(
      ligne.produitId,
      calculerQuantiteManquante(ligne.quantiteChargee, ligne.quantiteDeposee),
    );
  }
  return {
    totalAccepte,
    totalDepose,
    statut: determinerStatutAcceptation(totalAccepte, totalDepose),
    manquants,
  };
}

/**
 * Chaque transition quantifiée doit nommer exactement une fois tous les
 * produits du cycle. L'absence d'une ligne n'est jamais interprétée comme 0.
 */
export function validerLignesQuantite(
  produitIdsCycle: readonly string[],
  lignes: readonly { produitId: string; quantite: number }[],
): Map<string, number> {
  const valeurs = new Map<string, number>();
  for (const ligne of lignes) {
    if (valeurs.has(ligne.produitId)) {
      throw new ErreurCycleLivraison("Un produit apparaît deux fois", 400, "DONNEES_INVALIDES");
    }
    valeurs.set(ligne.produitId, ligne.quantite);
  }
  if (
    valeurs.size !== produitIdsCycle.length ||
    produitIdsCycle.some((produitId) => !valeurs.has(produitId))
  ) {
    throw new ErreurCycleLivraison(
      "Les quantités doivent couvrir exactement tous les produits du cycle",
      400,
      "DONNEES_INVALIDES",
    );
  }
  return valeurs;
}

export function validerLignesAcceptation(
  produitIdsCycle: readonly string[],
  lignes: Extract<TransitionCycleLivraisonInput, { action: "CONFIRMER_ACCEPTATION" }>["lignes"],
): Map<string, { quantiteAcceptee: number; quantiteRetournee: number }> {
  const valeurs = new Map<string, { quantiteAcceptee: number; quantiteRetournee: number }>();
  for (const ligne of lignes) {
    if (valeurs.has(ligne.produitId)) {
      throw new ErreurCycleLivraison("Un produit apparaît deux fois", 400, "DONNEES_INVALIDES");
    }
    valeurs.set(ligne.produitId, {
      quantiteAcceptee: ligne.quantiteAcceptee,
      quantiteRetournee: ligne.quantiteRetournee,
    });
  }
  if (
    valeurs.size !== produitIdsCycle.length ||
    produitIdsCycle.some((produitId) => !valeurs.has(produitId))
  ) {
    throw new ErreurCycleLivraison(
      "L'acceptation doit couvrir exactement tous les produits du cycle",
      400,
      "DONNEES_INVALIDES",
    );
  }
  return valeurs;
}

function normaliserLignesPrevision(lignes: readonly { produitId: string; quantite: number }[]) {
  const resultat = lignes
    .filter((ligne) => ligne.quantite > 0)
    .map((ligne) => ({ produitId: ligne.produitId, quantite: ligne.quantite }))
    .sort((a, b) => a.produitId.localeCompare(b.produitId));
  if (new Set(resultat.map((ligne) => ligne.produitId)).size !== resultat.length) {
    throw new ErreurCycleLivraison("Un produit apparaît deux fois pour le même client", 400, "DONNEES_INVALIDES");
  }
  return resultat;
}

function memePrevision(
  a: readonly { produitId: string; quantite: number }[],
  b: readonly { produitId: string; quantite: number }[],
) {
  const na = normaliserLignesPrevision(a);
  const nb = normaliserLignesPrevision(b);
  return na.length === nb.length && na.every((ligne, index) => {
    const autre = nb[index];
    return ligne.produitId === autre?.produitId && ligne.quantite === autre.quantite;
  });
}

/**
 * Synchronise le SchemaCommande canonique et son enveloppe C4 dans la même
 * transaction que le PlanningProduction. Un cycle démarré ne peut être ni
 * réécrit ni supprimé par l'ancien endpoint de remplacement journalier.
 */
export async function synchroniserPrevisionsCycles(
  tx: TxClient,
  date: Date,
  clients: SchemaCommandeJourInput["clients"],
  utilisateurId: string,
) {
  const souhaites = new Map(
    clients
      .map((client) => ({ ...client, lignes: normaliserLignesPrevision(client.lignes) }))
      .filter((client) => client.lignes.length > 0)
      .map((client) => [client.clientId, client]),
  );
  const existants = await tx.schemaCommande.findMany({
    where: { date },
    include: { lignes: true, cycle: { select: { id: true, statut: true, version: true } } },
  });
  const existantParClient = new Map(existants.map((schema) => [schema.clientId, schema]));

  for (const schema of existants) {
    if (souhaites.has(schema.clientId)) continue;
    if (schema.cycle && schema.cycle.statut !== "PREVISION") {
      throw new ErreurCycleLivraison(
        "Un cycle déjà démarré ne peut pas être supprimé du schéma",
        409,
        "CYCLE_DEJA_DEMARRE",
      );
    }
    if (schema.cycle) {
      const reclame = await tx.cycleLivraison.updateMany({
        where: { id: schema.cycle.id, statut: "PREVISION", version: schema.cycle.version },
        data: { version: { increment: 1 } },
      });
      if (reclame.count !== 1) {
        throw new ErreurCycleLivraison(
          "Un cycle démarré simultanément ne peut pas être supprimé du schéma",
          409,
          "CYCLE_DEJA_DEMARRE",
        );
      }
    }
    await tx.schemaCommande.delete({ where: { id: schema.id } });
  }

  for (const client of souhaites.values()) {
    const existant = existantParClient.get(client.clientId);
    if (!existant) {
      await tx.schemaCommande.create({
        data: {
          date,
          clientId: client.clientId,
          creeParId: utilisateurId,
          lignes: { create: client.lignes },
          cycle: {
            create: {
              lignes: { create: client.lignes.map(({ produitId }) => ({ produitId })) },
            },
          },
        },
      });
      continue;
    }

    if (existant.cycle?.statut !== undefined && existant.cycle.statut !== "PREVISION") {
      if (!memePrevision(existant.lignes, client.lignes)) {
        throw new ErreurCycleLivraison(
          "La prévision ne peut plus être modifiée après le démarrage du cycle",
          409,
          "PREVISION_VERROUILLEE",
        );
      }
      continue;
    }

    if (memePrevision(existant.lignes, client.lignes)) continue;

    if (existant.cycle) {
      const reclame = await tx.cycleLivraison.updateMany({
        where: { id: existant.cycle.id, statut: "PREVISION", version: existant.cycle.version },
        data: { version: { increment: 1 } },
      });
      if (reclame.count !== 1) {
        throw new ErreurCycleLivraison(
          "La prévision a été verrouillée simultanément par une transition",
          409,
          "PREVISION_VERROUILLEE",
        );
      }
    }

    await tx.schemaCommandeLigne.deleteMany({ where: { schemaCommandeId: existant.id } });
    await tx.schemaCommande.update({
      where: { id: existant.id },
      data: { creeParId: utilisateurId, lignes: { create: client.lignes } },
    });

    if (existant.cycle) {
      await tx.cycleLivraisonLigne.deleteMany({ where: { cycleId: existant.cycle.id } });
      await tx.cycleLivraison.update({
        where: { id: existant.cycle.id },
        data: { lignes: { create: client.lignes.map(({ produitId }) => ({ produitId })) } },
      });
    } else {
      await tx.cycleLivraison.create({
        data: {
          schemaCommandeId: existant.id,
          lignes: { create: client.lignes.map(({ produitId }) => ({ produitId })) },
        },
      });
    }
  }
}

export function donneesTransitionPourJournal(input: TransitionCycleLivraisonInput): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}
