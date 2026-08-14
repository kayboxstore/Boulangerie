/**
 * Logique pure du cycle « prévision J → livraison J+1 » (F4 round 1, corrigée
 * round 2 suite à la revue Codex).
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

/**
 * Les onze étapes du cycle, dans l'ordre métier (plan de coordination vague
 * 2, §« Modèle de responsabilité »). `remisMagasin` (round 2) trace
 * explicitement la remise Production → Magasin, distincte de `prepare`
 * (produit, pas encore remis) et de `charge` (remis par le Magasin au
 * chauffeur) — les deux remises tracées par le contrat C4 sont donc
 * représentées séparément, jamais fusionnées en une seule étape.
 */
export const ETAPES_CYCLE_LIVRAISON = [
  "prevu",
  "retenuProduction",
  "prepare",
  "remisMagasin",
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
 * facturable » (règle métier non négociable de la vague 2 — « la commande
 * réelle correspond à la quantité livrée ET acceptée »). Exemple obligatoire :
 * prévision 50, acceptation 40 → 40 facturables.
 *
 * Corrigé round 2 (revue Codex) : la quantité facturable suit UNIQUEMENT la
 * quantité acceptée — elle n'est PAS plafonnée par la prévision. La
 * prévision n'est qu'une annonce non contractuelle (« une prévision ne crée
 * ni vente, ni dette ») ; rien n'empêche une acceptation supérieure à ce qui
 * avait été annoncé (le client prend davantage que prévu le jour même), et
 * cette quantité supplémentaire reste facturable. Plafonner par la prévision
 * aurait à tort fait disparaître du chiffre d'affaires réellement accepté.
 *
 * Sert uniquement à illustrer/tester le vocabulaire de l'écran ; la valeur
 * réellement facturée sera toujours calculée et garantie par le serveur
 * (contrat C4), jamais par ce calcul client.
 */
export function calculerQuantiteFacturableIndicative(params: { quantiteAcceptee: number }): number {
  return Math.max(0, params.quantiteAcceptee);
}

/**
 * Écart simple (constatée − prévue), utilisé pour les badges d'écart par
 * client et par produit entre le Schéma de commande (prévu) et le Bon de
 * livraison (déposé). Ne sert QU'à cette comparaison ponctuelle — jamais à
 * dériver une des quantités du cycle (accepté, retourné, manquant) à partir
 * d'une autre.
 *
 * Important (round 2, revue Codex) : accepté, retourné et manquant sont
 * TROIS quantités indépendantes, chacune rapportée séparément par le
 * serveur (contrat C4) — leur relation n'est PAS une simple somme linéaire
 * du type « manquant = déposé − accepté − retourné ». Un bon peut par
 * exemple rester partiellement non retourné pendant que son anomalie est
 * déjà signalée comme manquante, ou un retour peut être partiellement
 * réaccepté plus tard : ce frontend ne doit donc jamais recalculer l'une de
 * ces trois quantités à partir des deux autres, ni supposer qu'elles
 * s'additionnent pour retomber sur le déposé initial.
 */
export function calculerEcartQuantite(params: { quantitePrevue: number; quantiteConstatee: number }): number {
  return params.quantiteConstatee - params.quantitePrevue;
}
