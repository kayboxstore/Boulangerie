/**
 * Logique pure du cycle « prévision J → livraison J+1 » (F4 round 1,
 * corrigée round 2, restructurée round 3, complétée round 4 suite à la
 * revue Codex).
 *
 * Le contrat C4 (backend) EXISTE désormais : `docs/api-contracts/C4_PREVISIONS_COMMANDES_REELLES.md`,
 * implémenté sur la branche `codex/previsions-commandes-c4` (PR brouillon #12,
 * HEAD `b6f2642c2651538a6e0c12959e194b14cb0e253b`). Cette PR n'est PAS encore
 * fusionnée dans `agent/integration-wave-2`, base de F4 — ce fichier reste
 * donc pour l'instant un vocabulaire et des exemples purement frontend,
 * SANS appel réseau, SANS simuler un succès serveur, SANS créer de commande
 * financière depuis le navigateur. Les noms utilisés sont EXACTEMENT ceux du
 * contrat C4 (`STATUTS_CYCLE_LIVRAISON`, §3) pour qu'un futur rebase sur C4
 * n'ait qu'à brancher les données réelles (notamment `CycleLivraisonDTO.statut`
 * directement dans `statutActif`), sans renommer.
 */

/**
 * Chronologie linéaire du cycle — sous-ensemble ORDONNÉ des onze statuts C4,
 * utilisant EXACTEMENT les mêmes chaînes. S'arrête à `EN_ATTENTE_CONFIRMATION` :
 * le dépôt chez le client est l'ACTION qui fait passer `EN_TOURNEE` →
 * `EN_ATTENTE_CONFIRMATION` (contrat C4 §7, `SIGNALER_DEPOT`) — il n'existe
 * AUCUN statut serveur `DEPOSEE`, ce vocabulaire n'en invente donc pas.
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

/**
 * Les onze statuts C4 exacts (contrat §3), chronologie puis statuts finaux
 * concaténés dans le même ordre que `STATUTS_CYCLE_LIVRAISON` côté contrat —
 * pratique pour un futur rebase, où `CycleLivraisonDTO.statut` pourra être
 * passé directement à `statutActif` sans conversion ni renommage.
 */
export const STATUTS_CYCLE_LIVRAISON = [
  ...STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON,
  ...STATUTS_FINAUX_CYCLE_LIVRAISON,
] as const;

export type StatutCycleLivraison = (typeof STATUTS_CYCLE_LIVRAISON)[number];

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
 * (bornes/calcul ci-dessus), pas une suite logistique à représenter.
 */
export const RESULTATS_CYCLE_LIVRAISON = ["accepte", "retourne", "manquant"] as const;

export type ResultatCycleLivraison = (typeof RESULTATS_CYCLE_LIVRAISON)[number];

/**
 * Exemple illustratif de la règle « seule la quantité acceptée devient
 * facturable » (contrat C4, invariant 3 : « seule la quantité acceptée
 * devient une CommandeClient »). Exemple obligatoire : prévision 50,
 * acceptation 40 → 40 facturables.
 *
 * La quantité facturable suit UNIQUEMENT la quantité acceptée — elle n'est
 * PAS plafonnée par la prévision (annonce non contractuelle : rien
 * n'empêche une acceptation supérieure à ce qui avait été annoncé).
 * « Facturable » est présenté comme la SEULE conséquence directionnelle de
 * l'acceptation, séparée de la chronologie logistique et des statuts finaux :
 * jamais reliée à « retourné », « manquant », ni à un statut final.
 *
 * Une fois F4 rebasé sur C4, l'interface devra utiliser directement
 * `estFacturable` et `commande` renvoyés par `GET
 * /api/production/cycles-livraison` (contrat C4 §5) au lieu de ce calcul
 * client — ce round ne simule PAS encore leur présence, ce calcul reste un
 * exemple pédagogique local, jamais la source de vérité.
 */
export function calculerQuantiteFacturableIndicative(params: { quantiteAcceptee: number }): number {
  return Math.max(0, params.quantiteAcceptee);
}

/**
 * Illustre `quantiteManquante = quantiteChargee - quantiteDeposee` (contrat
 * C4 §4, calcul SERVEUR — jamais saisi côté client). Purement pédagogique :
 * une fois connecté à C4, la valeur affichée sera toujours
 * `CycleLivraisonLigneDTO.quantiteManquante`, jamais recalculée ici.
 */
export function calculerQuantiteManquanteIndicative(params: { quantiteChargee: number; quantiteDeposee: number }): number {
  return Math.max(0, params.quantiteChargee - params.quantiteDeposee);
}

/**
 * Illustre la règle `quantiteAcceptee + quantiteRetournee <= quantiteDeposee`
 * (contrat C4 §4). Purement pédagogique — ne valide rien côté client une
 * fois connecté à C4, où cette contrainte est garantie par le serveur.
 */
export function respecteLimiteAccepteRetourne(params: {
  quantiteDeposee: number;
  quantiteAcceptee: number;
  quantiteRetournee: number;
}): boolean {
  return params.quantiteAcceptee + params.quantiteRetournee <= params.quantiteDeposee;
}

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
