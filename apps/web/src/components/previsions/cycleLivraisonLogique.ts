/**
 * Logique pure du cycle « prévision J → livraison J+1 » (F4 round 1,
 * corrigée round 2, restructurée round 3, complétée round 4, corrigée round
 * 5-6, connectée round I4 suite aux revues Codex).
 *
 * I4 : C4 est fusionné dans `agent/integration-wave-2` (PR #12) et F4 est
 * rebasé dessus. Les onze statuts C4 exacts et leurs types ne sont donc plus
 * dupliqués ici : ils sont réexportés depuis `@lomoto/shared/cycles-livraison`
 * (contrat `docs/api-contracts/C4_PREVISIONS_COMMANDES_REELLES.md`, §3), la
 * même source que le backend. `StatutCycleLivraison` est désormais
 * littéralement le type de `CycleLivraisonDTO.statut`.
 */

import { STATUTS_CYCLE_LIVRAISON } from "@lomoto/shared/cycles-livraison";
import type { StatutCycleLivraison } from "@lomoto/shared/cycles-livraison";

export { STATUTS_CYCLE_LIVRAISON };
export type { StatutCycleLivraison };

/**
 * Chronologie linéaire du cycle — sous-ensemble ORDONNÉ, présentation-only,
 * des onze statuts C4 ci-dessus. S'arrête à `EN_ATTENTE_CONFIRMATION` : le
 * dépôt chez le client est l'ACTION qui fait passer `EN_TOURNEE` →
 * `EN_ATTENTE_CONFIRMATION` (contrat C4 §7, `SIGNALER_DEPOT`) — il n'existe
 * AUCUN statut serveur `DEPOSEE`. Un test dédié vérifie que ce sous-ensemble
 * correspond exactement aux sept premiers éléments de `STATUTS_CYCLE_LIVRAISON`.
 */
export const STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON = [
  "PREVISION",
  "RETENUE_PRODUCTION",
  "PREPAREE",
  "REMISE_MAGASIN",
  "CHARGEE",
  "EN_TOURNEE",
  "EN_ATTENTE_CONFIRMATION",
] as const;

export type StatutChronologieCycleLivraison = (typeof STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON)[number];

/**
 * Statuts FINAUX du cycle (round 4) — les quatre derniers statuts C4,
 * mutuellement exclusifs et NON chronologiques : un cycle donné se termine
 * dans exactement UN de ces quatre statuts, jamais dans une suite ordonnée
 * des quatre. Représentés à part de `STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON`
 * (jamais intégrés à la liste ordonnée) et à part de
 * `RESULTATS_CYCLE_LIVRAISON` ci-dessous : un statut final RÉSUME l'issue du
 * cycle, il n'est ni une étape logistique ni une quantité. Aucune flèche ne
 * relie ces quatre statuts entre eux dans l'interface.
 */
export const STATUTS_FINAUX_CYCLE_LIVRAISON = [
  "PARTIELLEMENT_ACCEPTEE",
  "ACCEPTEE",
  "RETOUR_TOTAL",
  "ANNULEE",
] as const;

export type StatutFinalCycleLivraison = (typeof STATUTS_FINAUX_CYCLE_LIVRAISON)[number];

function estStatutChronologique(statut: StatutCycleLivraison): statut is StatutChronologieCycleLivraison {
  return (STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON as readonly string[]).includes(statut);
}

/** Clé i18n du libellé d'un statut C4, quel que soit son groupe (I4). */
export function cleLibelleStatutCycle(statut: StatutCycleLivraison): string {
  return estStatutChronologique(statut)
    ? `previsions.chronologie.${statut}.label`
    : `previsions.statutsFinaux.${statut}.label`;
}

/** Clé i18n de la description accessible d'un statut C4, quel que soit son groupe (I4). */
export function cleDescriptionStatutCycle(statut: StatutCycleLivraison): string {
  return estStatutChronologique(statut)
    ? `previsions.chronologie.${statut}.description`
    : `previsions.statutsFinaux.${statut}.description`;
}

export type VarianteBadgeStatutCycle = "secondary" | "gold" | "destructive" | "outline";

const VARIANTE_PAR_STATUT_CHRONOLOGIE: Record<StatutChronologieCycleLivraison, VarianteBadgeStatutCycle> = {
  PREVISION: "outline",
  RETENUE_PRODUCTION: "outline",
  PREPAREE: "outline",
  REMISE_MAGASIN: "outline",
  CHARGEE: "secondary",
  EN_TOURNEE: "secondary",
  EN_ATTENTE_CONFIRMATION: "gold",
};

const VARIANTE_PAR_STATUT_FINAL: Record<StatutFinalCycleLivraison, VarianteBadgeStatutCycle> = {
  PARTIELLEMENT_ACCEPTEE: "gold",
  ACCEPTEE: "secondary",
  RETOUR_TOTAL: "destructive",
  ANNULEE: "outline",
};

/**
 * Couleur de badge cohérente pour un statut C4, quel que soit son groupe
 * (I4) — même mapping utilisé par la légende (`EtapesCycleLivraison`) et par
 * tout badge de statut réel affiché ailleurs (ex. `BonsLivraison`), pour ne
 * jamais désynchroniser les couleurs d'un même statut entre deux écrans.
 */
export function varianteBadgeStatutCycle(statut: StatutCycleLivraison): VarianteBadgeStatutCycle {
  return estStatutChronologique(statut)
    ? VARIANTE_PAR_STATUT_CHRONOLOGIE[statut]
    : VARIANTE_PAR_STATUT_FINAL[statut];
}

/**
 * Quantités DISTINCTES de la livraison, présentées en PARALLÈLE (round 3) —
 * PAS une suite « accepté → retourné → manquant », mais pas non plus des
 * valeurs indépendantes les unes des autres (round 4 : cette formulation
 * était trompeuse et a été retirée). Le contrat C4 (§4) les expose comme
 * trois champs d'une même ligne (`quantiteAcceptee`, `quantiteRetournee`,
 * `quantiteManquante`), reliés par des règles exactes :
 *
 * - accepté et retourné sont SAISIS séparément (action `CONFIRMER_ACCEPTATION`,
 *   contrat C4 §7) — ce ne sont pas les deux faces d'un même choix binaire ;
 * - leur somme est BORNÉE par le déposé :
 *   `quantiteAcceptee + quantiteRetournee <= quantiteDeposee` ;
 * - manquant est CALCULÉ côté serveur à partir du chargé et du déposé,
 *   jamais saisi : `quantiteManquante = quantiteChargee - quantiteDeposee`
 *   (contrat C4 §4) ;
 * - aucune de ces trois quantités n'est jamais déduite de la prévision.
 *
 * Ce fichier ne relie donc jamais ces trois résultats entre eux par une
 * flèche dans l'interface — la relation entre eux est arithmétique
 * (bornes/calcul ci-dessus, garantie par le serveur), pas une suite
 * logistique à représenter. Depuis I4, les valeurs réelles proviennent
 * directement de `CycleLivraisonDTO.totaux`/`CycleLivraisonLigneDTO` — ce
 * fichier ne les recalcule jamais côté client.
 */
export const RESULTATS_CYCLE_LIVRAISON = ["accepte", "retourne", "manquant"] as const;

export type ResultatCycleLivraison = (typeof RESULTATS_CYCLE_LIVRAISON)[number];

/**
 * Écart simple (constatée − prévue), utilisé pour les badges d'écart par
 * client et par produit entre le Schéma de commande (prévu) et le Bon de
 * livraison (quantité saisie). Comparaison ponctuelle Schéma / Bon de
 * livraison uniquement — sans rapport avec les résultats accepté/retourné/
 * manquant ci-dessus, qui ne se déduisent jamais de la prévision.
 */
export function calculerEcartQuantite(params: { quantitePrevue: number; quantiteConstatee: number }): number {
  return params.quantiteConstatee - params.quantitePrevue;
}
