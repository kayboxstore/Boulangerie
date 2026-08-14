/**
 * Logique pure du cycle « prévision J → livraison J+1 » (F4 round 1,
 * corrigée round 2, restructurée round 3 suite à la revue Codex).
 *
 * Le contrat C4 (backend) EXISTE désormais : `docs/api-contracts/C4_PREVISIONS_COMMANDES_REELLES.md`,
 * implémenté sur la branche `codex/previsions-commandes-c4` (PR brouillon #12,
 * HEAD `b6f2642c2651538a6e0c12959e194b14cb0e253b`). Cette PR n'est PAS encore
 * fusionnée dans `agent/integration-wave-2`, base de F4 — ce fichier reste
 * donc pour l'instant un vocabulaire et des exemples purement frontend,
 * SANS appel réseau, SANS simuler un succès serveur, SANS créer de commande
 * financière depuis le navigateur. Round 3 aligne ce vocabulaire sur les
 * noms EXACTS du contrat C4 (`STATUTS_CYCLE_LIVRAISON`, §3) pour qu'un futur
 * rebase sur C4 n'ait qu'à brancher les données réelles, sans renommer.
 */

/**
 * Chronologie linéaire du cycle — sous-ensemble ORDONNÉ des onze statuts
 * `STATUTS_CYCLE_LIVRAISON` du contrat C4 (§3), utilisant EXACTEMENT les
 * mêmes chaînes. S'arrête à `EN_ATTENTE_CONFIRMATION` : le dépôt chez le
 * client est l'ACTION qui fait passer `EN_TOURNEE` → `EN_ATTENTE_CONFIRMATION`
 * (contrat C4 §7, `SIGNALER_DEPOT`) — il n'existe AUCUN statut serveur
 * `DEPOSEE`, ce vocabulaire n'en invente donc pas.
 *
 * Les statuts C4 postérieurs (`PARTIELLEMENT_ACCEPTEE`, `ACCEPTEE`,
 * `RETOUR_TOTAL`, `ANNULEE`) ne sont volontairement PAS représentés comme
 * une suite de la chronologie : ce sont des résumés d'un ÉTAT résultant de
 * quantités indépendantes (accepté/retourné/manquant), pas de nouvelles
 * étapes séquentielles — voir `RESULTATS_CYCLE_LIVRAISON` ci-dessous.
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
 * Résultats de la livraison, PARALLÈLES et non chronologiques (round 3) :
 * contrairement à la chronologie ci-dessus, ces trois quantités ne forment
 * PAS une suite « accepté → retourné → manquant ». Le contrat C4 (§4) les
 * expose comme trois champs indépendants d'une même ligne
 * (`quantiteAcceptee`, `quantiteRetournee`, `quantiteManquante`), saisis ou
 * calculés séparément :
 *
 * - accepté et retourné sont SAISIS séparément (action `CONFIRMER_ACCEPTATION`,
 *   contrat C4 §7) — ce ne sont pas les deux faces d'un même choix binaire ;
 * - leur somme ne peut jamais dépasser le déposé :
 *   `quantiteAcceptee + quantiteRetournee <= quantiteDeposee` ;
 * - manquant est CALCULÉ côté serveur, jamais saisi :
 *   `quantiteManquante = quantiteChargee - quantiteDeposee` (contrat C4 §4) ;
 * - aucune de ces trois quantités n'est jamais déduite de la prévision.
 *
 * Ce fichier ne relie donc jamais ces trois résultats entre eux par une
 * relation d'ordre ou de flèche dans l'interface.
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
 * l'acceptation, séparée de la chronologie logistique : jamais reliée à
 * « retourné » ou « manquant ».
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
