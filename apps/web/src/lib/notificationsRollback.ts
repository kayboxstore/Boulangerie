/**
 * Logique pure du rollback ciblé des notifications (lib/socket.tsx) — voir
 * la note dans components/ui/robustesseMotDePasse.ts sur la séparation
 * logique pure / composant (résolution d'alias `@/` absente du runner
 * Vitest racine). Ce fichier n'importe rien.
 *
 * Historique des corrections (revues successives) :
 * - round 2 : remplacement d'un rollback par instantané global (qui
 *   écrasait toute notification arrivée entre-temps) par un rollback ciblé
 *   par identifiant, gardé par un registre de propriété à jetons.
 * - round 3 : suppression de toute capture de valeur dans un setter React
 *   relue juste après (non garanti synchrone) — l'état canonique vit
 *   désormais dans des refs, alimentées exclusivement par ces
 *   orchestrateurs purs. Correction de la concurrence individuel/global
 *   (`toutMarquerLu` réclame TOUS les ids actuels, pas seulement ceux
 *   qu'il modifie lui-même) et redéfinition du compteur non lu comme une
 *   valeur DÉRIVÉE (`resteNonLues` + décompte du tableau chargé) plutôt
 *   qu'un delta suivi indépendamment — un delta scalaire s'est révélé
 *   incorrect dès qu'une action reprend la propriété d'un identifiant déjà
 *   optimistiquement modifié par une autre (le delta de la seconde action
 *   ne "voit" pas la réduction déjà appliquée par la première si les deux
 *   finissent par échouer).
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
 * Identifiant réservé représentant les notifications non lues qui existent
 * côté serveur mais ne sont PAS chargées dans le tableau (l'API ne charge
 * qu'un sous-ensemble). Seul `toutMarquerLu` peut le réclamer/le restaurer —
 * aucune action individuelle ne porte sur des identifiants non chargés, donc
 * aucune concurrence possible sur ce point précis (contrairement aux ids
 * réels, potentiellement disputés entre une action individuelle et globale).
 */
export const ID_RESTE_NON_CHARGE = "__reste_non_charge__";

export interface EtatNotifications<T extends NotificationAvecLecture> {
  notifications: T[];
  /** Non lues côté serveur mais absentes de `notifications` (ex. au-delà de la page chargée). */
  resteNonLues: number;
}

/**
 * Nombre total de notifications non lues À AFFICHER — toujours DÉRIVÉ,
 * jamais stocké indépendamment (voir l'historique des corrections en tête
 * de fichier). Combine ce qui n'est pas chargé (`resteNonLues`) et le
 * décompte réel du tableau chargé, qui reflète fidèlement chaque
 * modification déjà appliquée via les fonctions ci-dessus.
 */
export function compterNonLues<T extends NotificationAvecLecture>(etat: EtatNotifications<T>): number {
  return etat.resteNonLues + etat.notifications.filter((n) => !n.lu).length;
}

/**
 * Registre de "propriété" par identifiant. Trois états possibles par id :
 * non réclamé, réclamé par un jeton (en attente de résolution réseau), ou
 * CONFIRMÉ (terminal — un succès réseau a eu lieu, pour n'importe quelle
 * action ; plus aucune reprise ni rollback futur ne peut l'affecter). Le
 * passage à "confirmé" est volontairement irréversible : dans ce modèle, un
 * identifiant ne peut jamais redevenir non lu autrement que par une nouvelle
 * notification distincte, jamais par une correction rétroactive.
 */
export function creerRegistreDePropriete<Jeton>() {
  type EtatId = { statut: "reclame"; jeton: Jeton } | { statut: "confirme" };
  const etats = new Map<string, EtatId>();

  return {
    /** Réclame la propriété des identifiants donnés — sans effet sur un identifiant déjà confirmé (terminal). */
    reclamer(ids: readonly string[], jeton: Jeton): void {
      for (const id of ids) {
        if (etats.get(id)?.statut === "confirme") continue;
        etats.set(id, { statut: "reclame", jeton });
      }
    },
    /** Marque définitivement confirmé — un succès réseau l'emporte toujours, quel que soit le propriétaire courant. */
    confirmer(ids: readonly string[]): void {
      for (const id of ids) etats.set(id, { statut: "confirme" });
    },
    /** Libère (sans confirmer) les identifiants encore réclamés par ce jeton précisément. */
    liberer(ids: readonly string[], jeton: Jeton): void {
      for (const id of ids) {
        const actuel = etats.get(id);
        if (actuel?.statut === "reclame" && actuel.jeton === jeton) etats.delete(id);
      }
    },
    /** Sous-ensemble des identifiants ENCORE réclamés (ni repris, ni confirmés) par ce jeton précisément. */
    idsEncoreReclamesPar(ids: readonly string[], jeton: Jeton): string[] {
      return ids.filter((id) => {
        const actuel = etats.get(id);
        return actuel?.statut === "reclame" && actuel.jeton === jeton;
      });
    },
  };
}

export type RegistrePropriete = ReturnType<typeof creerRegistreDePropriete<symbol>>;

export interface DemarrageAction<T extends NotificationAvecLecture> {
  etat: EtatNotifications<T>;
  jeton: symbol;
  /** false = rien à faire ; l'appelant ne doit alors ni envoyer de requête réseau ni traiter succès/échec. */
  aDemarre: boolean;
  idsReclames: string[];
  /** Valeur de `resteNonLues` à restaurer en cas d'échec — pertinent uniquement si `ID_RESTE_NON_CHARGE` fait partie de `idsReclames`. */
  resteNonLuesAvant: number;
}

/**
 * Orchestrateur pur pour une lecture INDIVIDUELLE. Réclame la propriété du
 * seul identifiant concerné. Utilisé identiquement par `socket.tsx` et par
 * les tests (aucune logique parallèle ne doit être réécrite ailleurs).
 */
export function demarrerMarquerLue<T extends NotificationAvecLecture>(
  etat: EtatNotifications<T>,
  id: string,
  registre: RegistrePropriete,
): DemarrageAction<T> {
  const { notifications, aChange } = marquerIdCommeLu(etat.notifications, id);
  if (!aChange) {
    return { etat, jeton: Symbol("inutilise"), aDemarre: false, idsReclames: [], resteNonLuesAvant: 0 };
  }
  const jeton = Symbol("marquerLue");
  registre.reclamer([id], jeton);
  return {
    etat: { ...etat, notifications },
    jeton,
    aDemarre: true,
    idsReclames: [id],
    resteNonLuesAvant: 0, // une action individuelle ne touche jamais `resteNonLues`
  };
}

/**
 * Orchestrateur pur pour une lecture GLOBALE. Réclame la propriété de TOUS
 * les identifiants actuellement chargés, plus `ID_RESTE_NON_CHARGE` — pas
 * seulement ceux qu'elle marque elle-même comme lus.
 *
 * Correction demandée en revue (round 3) : réclamer seulement `idsTouches`
 * (les identifiants non lus AU MOMENT du démarrage) laisse un `marquerLue(id)`
 * déjà en vol conserver la propriété de son id, puisque cet id est déjà
 * `lu: true` localement et n'apparaît donc plus dans `idsTouches`. Si
 * `toutMarquerLu` réussit ensuite mais que le `marquerLue(id)` isolé échoue
 * après coup, son rollback individuel repasserait à tort cet id à `lu: false`
 * malgré la réussite de l'action globale. Réclamer TOUS les ids actuels
 * (lus ou non) neutralise ce cas : l'action globale l'emporte toujours sur
 * toute action individuelle plus ancienne sur le même id.
 */
export function demarrerToutMarquerLu<T extends NotificationAvecLecture>(
  etat: EtatNotifications<T>,
  registre: RegistrePropriete,
): DemarrageAction<T> {
  const { notifications, idsTouches } = marquerTousCommeLus(etat.notifications);
  if (idsTouches.length === 0 && etat.resteNonLues === 0) {
    return { etat, jeton: Symbol("inutilise"), aDemarre: false, idsReclames: [], resteNonLuesAvant: 0 };
  }
  const idsAReclamer = [...etat.notifications.map((n) => n.id), ID_RESTE_NON_CHARGE];
  const jeton = Symbol("toutMarquerLu");
  registre.reclamer(idsAReclamer, jeton);
  return {
    etat: { notifications, resteNonLues: 0 },
    jeton,
    aDemarre: true,
    idsReclames: idsAReclamer,
    resteNonLuesAvant: etat.resteNonLues,
  };
}

/**
 * Succès : un succès réseau est toujours définitif. Confirme la propriété
 * (terminal, plus aucun rollback futur ne peut l'annuler) et RÉAFFIRME l'état
 * "lu" pour ces identifiants — nécessaire si une AUTRE action avait entre
 * temps repris puis perdu la propriété de l'un d'eux et l'avait remis à
 * `lu: false` par erreur avant que ce succès ne soit connu (voir le test
 * "individuel en vol → global échoué → individuel réussi").
 */
export function confirmerSucces<T extends NotificationAvecLecture>(
  etat: EtatNotifications<T>,
  idsReclames: readonly string[],
  registre: RegistrePropriete,
): EtatNotifications<T> {
  registre.confirmer(idsReclames);
  const idsReels = idsReclames.filter((id) => id !== ID_RESTE_NON_CHARGE);
  const ensemble = new Set(idsReels);
  const dejaCorrect = etat.notifications.every((n) => !ensemble.has(n.id) || n.lu);
  if (dejaCorrect) return etat; // rien à réaffirmer, évite un re-rendu inutile
  const notifications = etat.notifications.map((n) => (ensemble.has(n.id) ? { ...n, lu: true } : n));
  return { ...etat, notifications };
}

/**
 * Échec : restaure UNIQUEMENT ce que ce jeton possède ENCORE au moment de
 * l'échec (jamais un remplacement complet par un instantané antérieur).
 * Renvoie `null` si une action plus récente a déjà repris la main sur tous
 * les identifiants concernés — dans ce cas il n'y a rien à annuler, et
 * l'appelant ne doit ni modifier l'état ni afficher de toast d'erreur (l'état
 * courant reflète déjà la décision de l'action qui a pris le relais).
 */
export function annulerApresEchec<T extends NotificationAvecLecture>(
  etat: EtatNotifications<T>,
  idsReclames: readonly string[],
  jeton: symbol,
  resteNonLuesAvant: number,
  registre: RegistrePropriete,
): EtatNotifications<T> | null {
  const idsARestaurer = registre.idsEncoreReclamesPar(idsReclames, jeton);
  registre.liberer(idsARestaurer, jeton);
  if (idsARestaurer.length === 0) return null;

  const idsReels = idsARestaurer.filter((id) => id !== ID_RESTE_NON_CHARGE);
  const notifications = annulerLectureCiblee(etat.notifications, idsReels);
  const resteNonLues = idsARestaurer.includes(ID_RESTE_NON_CHARGE) ? resteNonLuesAvant : etat.resteNonLues;
  return { notifications, resteNonLues };
}
