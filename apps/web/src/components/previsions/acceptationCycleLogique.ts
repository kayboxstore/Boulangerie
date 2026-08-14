/**
 * Logique pure de la confirmation d'acceptation du cycle C4 (F5B, module
 * Commandes). CONFIRMER_ACCEPTATION est volontairement absente de
 * `transitionsCycleLivraison.ts` (F5A, Production) — cette action a un effet
 * financier (contrat C4 §7 : seule elle peut créer une commande) et n'est
 * jamais mélangée à la logique des actions Production.
 */

/** Règle serveur (contrat C4 §7) : accepté + retourné ne peut jamais dépasser le déposé, pour un produit donné. */
export function sommeAccepteRetourneDepasseDepose(accepte: number, retourne: number, depose: number): boolean {
  return accepte + retourne > depose;
}

/**
 * Clé i18n du message de succès selon que le serveur a créé une commande ou
 * non (contrat C4 §7 : aucune commande si le total accepté vaut zéro). Ne
 * dépend que de la réponse SERVEUR (`commande`), jamais d'une estimation
 * calculée côté client.
 */
export function cleSuccesAcceptation(commande: unknown): string {
  return commande ? "acceptations.successWithOrder" : "acceptations.successWithoutOrder";
}
