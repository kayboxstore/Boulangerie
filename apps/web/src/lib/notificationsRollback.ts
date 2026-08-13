/**
 * Logique pure du rollback ciblé des notifications (lib/socket.tsx) — voir
 * la note dans components/ui/robustesseMotDePasse.ts sur la séparation
 * logique pure / composant (résolution d'alias `@/` absente du runner
 * Vitest racine). Ce fichier n'importe rien.
 *
 * Correction demandée en revue : l'ancienne version capturait l'état des
 * notifications dans un setter React puis le rejouait tel quel après l'appel
 * réseau — un rollback "instantané" qui écrasait toute notification arrivée
 * entre-temps (via Socket.io) et ignorait qu'une autre mutation ait pu
 * entre-temps réussir sur la même notification. Cette version ne remplace
 * plus jamais le tableau entier : elle ne touche que l'identifiant concerné,
 * via un gestionnaire de propriété qui refuse d'annuler une action dont la
 * "propriété" d'un identifiant a depuis été reprise par une action plus
 * récente (marquerLue et toutMarquerLu peuvent se chevaucher).
 */

export interface NotificationAvecLecture {
  id: string;
  lu: boolean;
}

/** Marque une seule notification comme lue. Ne fait rien si elle est déjà lue ou introuvable. */
export function marquerIdCommeLu<T extends NotificationAvecLecture>(
  notifications: readonly T[],
  id: string,
): { notifications: T[]; aChange: boolean } {
  const cible = notifications.find((n) => n.id === id);
  if (!cible || cible.lu) return { notifications: [...notifications], aChange: false };
  return {
    notifications: notifications.map((n) => (n.id === id ? { ...n, lu: true } : n)),
    aChange: true,
  };
}

/** Marque toutes les notifications non lues comme lues ; renvoie la liste des identifiants réellement touchés. */
export function marquerTousCommeLus<T extends NotificationAvecLecture>(
  notifications: readonly T[],
): { notifications: T[]; idsTouches: string[] } {
  const idsTouches = notifications.filter((n) => !n.lu).map((n) => n.id);
  if (idsTouches.length === 0) return { notifications: [...notifications], idsTouches };
  return {
    notifications: notifications.map((n) => (n.lu ? n : { ...n, lu: true })),
    idsTouches,
  };
}

/**
 * Rollback CIBLÉ : ne repasse à `lu: false` QUE les identifiants indiqués,
 * et seulement s'ils sont encore marqués lus au moment de l'appel — toute
 * notification arrivée entre-temps (autre id) reste intacte, contrairement à
 * un remplacement complet du tableau par un instantané antérieur.
 */
export function annulerLectureCiblee<T extends NotificationAvecLecture>(
  notifications: readonly T[],
  idsARestaurer: readonly string[],
): T[] {
  if (idsARestaurer.length === 0) return [...notifications];
  const ensemble = new Set(idsARestaurer);
  return notifications.map((n) => (ensemble.has(n.id) && n.lu ? { ...n, lu: false } : n));
}

/**
 * Registre générique de "propriété" par identifiant, utilisé pour éviter
 * qu'une action asynchrone qui échoue (ex. marquerLue) n'annule le résultat
 * d'une action plus récente ou déjà réussie qui a repris la main sur le même
 * identifiant (ex. toutMarquerLu déclenché entre-temps, ou un second appel
 * pour le même id). Chaque action réclame la propriété des identifiants
 * qu'elle modifie avec un jeton qui lui est propre ; elle ne peut annuler
 * (ou libérer) que ce qu'elle possède encore au moment où elle agit.
 */
export function creerRegistreDePropriete<Jeton>() {
  const proprietaires = new Map<string, Jeton>();

  return {
    /** Réclame la propriété des identifiants donnés pour ce jeton (écrase toute réclamation antérieure). */
    reclamer(ids: readonly string[], jeton: Jeton): void {
      for (const id of ids) proprietaires.set(id, jeton);
    },
    /** Libère la propriété des identifiants encore possédés par ce jeton précisément. */
    liberer(ids: readonly string[], jeton: Jeton): void {
      for (const id of ids) {
        if (proprietaires.get(id) === jeton) proprietaires.delete(id);
      }
    },
    /** Sous-ensemble des identifiants encore possédés par ce jeton précisément (les seuls annulables par lui). */
    idsEncorePossedesPar(ids: readonly string[], jeton: Jeton): string[] {
      return ids.filter((id) => proprietaires.get(id) === jeton);
    },
  };
}
