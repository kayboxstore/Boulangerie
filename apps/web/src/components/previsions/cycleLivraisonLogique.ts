/**
 * Logique pure du cycle « prévision J → livraison J+1 » (F4 round 1).
 *
 * IMPORTANT — ce fichier ne fait AUCUN appel réseau et ne décrit AUCUN
 * contrat serveur : le contrat C4 (backend, `docs/api-contracts/`) n'est pas
 * encore publié. Les étapes et la règle de calcul ci-dessous sont un
 * vocabulaire et un exemple purement frontend, destinés à préparer l'écran
 * (libellés, tests, composants d'affichage) SANS jamais simuler un succès
 * serveur ni créer de commande financière depuis le navigateur. Une fois le
 * contrat C4 publié, ce fichier sera adapté pour rester cohérent avec lui —
 * il n'en est pas la source de vérité.
 */

/** Les dix étapes du cycle, dans l'ordre métier (voir le plan de coordination vague 2). */
export const ETAPES_CYCLE_LIVRAISON = [
  "prevu",
  "retenuProduction",
  "prepare",
  "charge",
  "depose",
  "enAttenteConfirmation",
  "accepte",
  "retourne",
  "manquant",
  "facturable",
] as const;

export type EtapeCycleLivraison = (typeof ETAPES_CYCLE_LIVRAISON)[number];

/**
 * Exemple illustratif de la règle « seule la quantité acceptée devient
 * facturable » (règle métier non négociable de la vague 2) : la quantité
 * facturable ne peut jamais dépasser ni la quantité prévue, ni la quantité
 * acceptée, et ne descend jamais sous zéro. Exemple obligatoire : prévision
 * 50, acceptation 40 → 40 facturables.
 *
 * Sert uniquement à illustrer/tester le vocabulaire de l'écran ; la valeur
 * réellement facturée sera toujours calculée et garantie par le serveur
 * (contrat C4), jamais par ce calcul client.
 */
export function calculerQuantiteFacturableIndicative(params: { quantitePrevue: number; quantiteAcceptee: number }): number {
  const prevue = Math.max(0, params.quantitePrevue);
  const acceptee = Math.max(0, params.quantiteAcceptee);
  return Math.min(prevue, acceptee);
}

/** Écart simple (livré − prévu), utilisé pour les badges d'écart par client et par produit. */
export function calculerEcartQuantite(params: { quantitePrevue: number; quantiteConstatee: number }): number {
  return params.quantiteConstatee - params.quantitePrevue;
}
