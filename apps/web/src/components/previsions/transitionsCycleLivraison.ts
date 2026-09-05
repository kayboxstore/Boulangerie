/**
 * Logique pure des actions Production du cycle C4 (F5A, vague 3). Couvre
 * uniquement les six transitions Production, de la prévision jusqu'au dépôt
 * chez le client — `PREVISION` → `RETENUE_PRODUCTION` → `PREPAREE` →
 * `REMISE_MAGASIN` → `CHARGEE` → `EN_TOURNEE` → `EN_ATTENTE_CONFIRMATION`.
 *
 * `CONFIRMER_ACCEPTATION` (statut `EN_ATTENTE_CONFIRMATION` → statut final)
 * appartient à F5B (module Commandes, permission `COMMANDES:ECRITURE`,
 * idempotence obligatoire) et n'apparaît JAMAIS dans ce fichier — un rôle
 * Production ne doit jamais pouvoir confirmer l'acceptation financière
 * (contrat C4 §7 : « Cette action ne peut pas être validée par le chauffeur
 * seul »).
 */

import type { ActionCycleLivraison, StatutCycleLivraison } from "@lomoto/shared/cycles-livraison";

export type ActionProductionCycleLivraison = Exclude<ActionCycleLivraison, "CONFIRMER_ACCEPTATION">;

/**
 * Action Production suivante disponible pour un statut donné (contrat C4
 * §7). `EN_ATTENTE_CONFIRMATION` et les quatre statuts finaux n'ont pas
 * d'action Production suivante — `EN_ATTENTE_CONFIRMATION` attend
 * `CONFIRMER_ACCEPTATION` (F5B), les statuts finaux sont terminaux.
 */
const ACTION_PRODUCTION_PAR_STATUT: Partial<Record<StatutCycleLivraison, ActionProductionCycleLivraison>> = {
  PREVISION: "RETENIR_PRODUCTION",
  RETENUE_PRODUCTION: "CONFIRMER_PREPARATION",
  PREPAREE: "CONFIRMER_REMISE_MAGASIN",
  REMISE_MAGASIN: "CONFIRMER_CHARGEMENT",
  CHARGEE: "CONFIRMER_DEPART",
  EN_TOURNEE: "SIGNALER_DEPOT",
};

/** Action Production suivante pour ce statut, ou `null` s'il n'y en a pas (F5A). */
export function actionProductionSuivante(statut: StatutCycleLivraison): ActionProductionCycleLivraison | null {
  return ACTION_PRODUCTION_PAR_STATUT[statut] ?? null;
}

/** `CONFIRMER_DEPART` ne porte aucune ligne de quantité (contrat C4 §7) : juste un départ, sans nouvelle mesure. */
export function actionRequiertLignes(action: ActionProductionCycleLivraison): boolean {
  return action !== "CONFIRMER_DEPART";
}

/** Seul le chargement identifie nommément le chauffeur (contrat C4 §7, `livrePar`). */
export function actionRequiertChauffeur(action: ActionProductionCycleLivraison): boolean {
  return action === "CONFIRMER_CHARGEMENT";
}

/** Champ `CycleLivraisonLigneDTO` où lire la valeur DÉJÀ connue pour préremplir le formulaire de cette action. */
const CHAMP_PREREMPLISSAGE_PAR_ACTION: Record<
  ActionProductionCycleLivraison,
  | "quantitePrevue"
  | "quantiteRetenueProduction"
  | "quantitePreparee"
  | "quantiteRemiseMagasin"
  | "quantiteChargee"
  | null
> = {
  RETENIR_PRODUCTION: "quantitePrevue",
  CONFIRMER_PREPARATION: "quantiteRetenueProduction",
  CONFIRMER_REMISE_MAGASIN: "quantitePreparee",
  CONFIRMER_CHARGEMENT: "quantiteRemiseMagasin",
  CONFIRMER_DEPART: null,
  SIGNALER_DEPOT: "quantiteChargee",
};

export function champPrereplissagePourAction(action: ActionProductionCycleLivraison) {
  return CHAMP_PREREMPLISSAGE_PAR_ACTION[action];
}

/** Clé i18n du libellé et de la description d'une action Production (F5A). */
export function cleLibelleAction(action: ActionProductionCycleLivraison): string {
  return `previsions.actions.${action}.label`;
}
export function cleDescriptionAction(action: ActionProductionCycleLivraison): string {
  return `previsions.actions.${action}.description`;
}
export function cleBoutonAction(action: ActionProductionCycleLivraison): string {
  return `previsions.actions.${action}.bouton`;
}
