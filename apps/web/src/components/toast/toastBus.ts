/**
 * Bus de toasts découplé du contexte React.
 *
 * FeedbackProvider (composants/**) est monté SOUS SocketProvider dans
 * main.tsx (hors zone de fichiers autorisée pour cette tâche — voir
 * docs/coordination/PLAN_COORDINATION_CODEX_CLAUDE_LOMOTO.md §6, tâche F1).
 * `useFeedback()` est donc inaccessible depuis lib/socket.tsx, qui a
 * pourtant besoin de signaler l'échec réseau d'un rollback de notification.
 *
 * Ce module résout le problème sans toucher à l'ordre des providers :
 * n'importe quel code (composant ou non) peut appeler `emettreToast`,
 * et FeedbackProvider s'y abonne pour l'afficher. C'est le même principe
 * que les bibliothèques de toast usuelles (état module, pas contexte).
 */

export type VarianteToast = "succes" | "erreur" | "avertissement" | "information";

export interface ToastDemande {
  variante: VarianteToast;
  titre?: string;
  message: string;
  /** Ne se ferme jamais tout seul (réservé aux erreurs bloquantes — voir audit UX-17). */
  persistant?: boolean;
  /** Durée d'affichage avant fermeture automatique, en ms. Ignoré si `persistant`. */
  dureeMs?: number;
}

export interface ToastAffiche extends ToastDemande {
  id: number;
}

type Ecouteur = (toast: ToastAffiche) => void;

export const DUREE_TOAST_DEFAUT_MS = 6000;
export const MAX_TOASTS_VISIBLES = 3;

let prochainId = 0;
const ecouteurs = new Set<Ecouteur>();

/**
 * Sélectionne les toasts VISIBLES parmi la file complète (règle UX-17 :
 * trois au maximum). Contrairement à un plafonnement qui supprimerait les
 * plus anciens à l'arrivée d'un nouveau, cette fonction ne modifie ni ne
 * perd jamais rien : elle prend simplement les `max` premiers de la file,
 * dans leur ordre d'arrivée. Les suivants restent dans la file (non
 * affichés) et prennent le relais dès qu'une place se libère — y compris un
 * toast `persistant`, qui ne disparaît donc jamais à cause d'un 4ᵉ toast
 * (correction demandée en revue : l'ancienne version gardait les *derniers*
 * arrivés et perdait silencieusement les plus anciens, persistants ou non).
 */
export function selectionnerToastsVisibles<T>(file: readonly T[], max: number): T[] {
  if (max <= 0) return [];
  return file.slice(0, max);
}

/**
 * Émet un toast vers tout abonné actif (normalement FeedbackProvider).
 * Ne fait rien si aucun FeedbackProvider n'est monté — appel sûr partout,
 * y compris avant le premier rendu ou dans un test sans arbre React.
 */
export function emettreToast(demande: ToastDemande): number {
  const id = ++prochainId;
  const toast: ToastAffiche = { id, ...demande };
  ecouteurs.forEach((ecouteur) => ecouteur(toast));
  return id;
}

/** Réservé à FeedbackProvider : s'abonne aux émissions et renvoie une fonction de désabonnement. */
export function sabonnerAuxToasts(ecouteur: Ecouteur): () => void {
  ecouteurs.add(ecouteur);
  return () => ecouteurs.delete(ecouteur);
}

/** Utilisé uniquement par les tests pour repartir d'un compteur d'id propre. */
export function reinitialiserCompteurToastPourTests(): void {
  prochainId = 0;
}
