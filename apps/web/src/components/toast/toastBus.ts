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
 * Ne conserve que les `max` derniers éléments d'une liste (les plus récents).
 * Pure et testable indépendamment du rendu — règle UX-17 : trois toasts au maximum.
 */
export function limiterToasts<T>(liste: readonly T[], max: number): T[] {
  if (max <= 0) return [];
  return liste.length <= max ? [...liste] : liste.slice(liste.length - max);
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
