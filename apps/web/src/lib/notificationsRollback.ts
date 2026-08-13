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
 *   qu'un delta suivi indépendamment.
 * - round 4 : le "reste non chargé" n'est plus un identifiant confirmable
 *   au même titre qu'une notification réelle (une notification, une fois
 *   lue, le reste pour toujours ; le reste non chargé, lui, est un agrégat
 *   qui évolue à chaque nouveau cycle — le confirmer définitivement bloquait
 *   tout cycle `toutMarquerLu` ultérieur). Il utilise désormais un slot de
 *   propriété dédié, toujours réclamable (`creerProprieteUnique`). Un succès
 *   global réaffirme aussi `resteNonLues = 0` pour SON périmètre (pas
 *   seulement les identifiants réels), pour ne pas rester incohérent si un
 *   rechargement d'historique concurrent avait réinjecté une valeur
 *   périmée. Le plafonnement `MAX_FEED` (dans socket.tsx) doit désormais
 *   transférer vers `resteNonLues` toute notification non lue expulsée du
 *   tableau (`ajouterNotificationAvecPlafond`). Les opérations sont enfin
 *   isolées par génération de session (voir socket.tsx) pour qu'une requête
 *   commencée par un utilisateur ne puisse jamais modifier l'état affiché
 *   après sa déconnexion ou la connexion d'un autre utilisateur.
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

export interface EtatNotifications<T extends NotificationAvecLecture> {
  notifications: T[];
  /** Non lues côté serveur mais absentes de `notifications` (ex. au-delà de la page chargée). */
  resteNonLues: number;
}

/**
 * Nombre total de notifications non lues À AFFICHER — toujours DÉRIVÉ,
 * jamais stocké indépendamment. Combine ce qui n'est pas chargé
 * (`resteNonLues`) et le décompte réel du tableau chargé.
 */
export function compterNonLues<T extends NotificationAvecLecture>(etat: EtatNotifications<T>): number {
  return etat.resteNonLues + etat.notifications.filter((n) => !n.lu).length;
}

/**
 * Ajoute une notification arrivée en temps réel, en respectant le plafond
 * d'éléments chargés (`MAX_FEED`). Si l'ajout fait dépasser le plafond, les
 * éléments expulsés (les plus anciens) qui étaient encore NON LUS
 * transfèrent leur "non-lu" vers `resteNonLues` — sans quoi le compteur
 * affiché deviendrait inférieur au compteur réel (correction demandée en
 * revue, round 4 : une notification non lue expulsée du tableau reste non
 * lue côté serveur, elle ne doit pas disparaître silencieusement).
 */
export function ajouterNotificationAvecPlafond<T extends NotificationAvecLecture>(
  etat: EtatNotifications<T>,
  nouvelle: T,
  plafond: number,
): EtatNotifications<T> {
  const combinees = [nouvelle, ...etat.notifications];
  if (combinees.length <= plafond) {
    return { notifications: combinees, resteNonLues: etat.resteNonLues };
  }
  const conservees = combinees.slice(0, plafond);
  const expulsees = combinees.slice(plafond);
  const nonLuesExpulsees = expulsees.filter((n) => !n.lu).length;
  return { notifications: conservees, resteNonLues: etat.resteNonLues + nonLuesExpulsees };
}

/**
 * Registre de "propriété" par identifiant RÉEL. Trois états possibles par
 * id : non réclamé, réclamé par un jeton (en attente de résolution réseau),
 * ou CONFIRMÉ (terminal — un succès réseau a eu lieu, pour n'importe quelle
 * action ; plus aucune reprise ni rollback futur ne peut l'affecter). Ce
 * caractère terminal est correct pour une notification réelle (une fois
 * lue, elle le reste) — voir `creerProprieteUnique` ci-dessous pour le
 * "reste non chargé", qui n'a PAS cette propriété de terminalité.
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

/**
 * Propriété à SLOT UNIQUE, sans notion de confirmation terminale — utilisée
 * pour le "reste non chargé", qui contrairement à une notification réelle
 * n'est jamais définitivement figé (de nouvelles notifications non chargées
 * peuvent réapparaître à tout moment, à chaque nouveau cycle `toutMarquerLu`).
 * Réclamer écrase toujours le propriétaire précédent, y compris après un
 * succès — un succès se contente de LIBÉRER, jamais de verrouiller.
 */
export function creerProprieteUnique<Jeton>() {
  let proprietaire: Jeton | null = null;
  return {
    reclamer(jeton: Jeton): void {
      proprietaire = jeton;
    },
    liberer(jeton: Jeton): void {
      if (proprietaire === jeton) proprietaire = null;
    },
    estPossedePar(jeton: Jeton): boolean {
      return proprietaire === jeton;
    },
  };
}

export type ProprieteUnique = ReturnType<typeof creerProprieteUnique<symbol>>;

export interface DemarrageAction<T extends NotificationAvecLecture> {
  etat: EtatNotifications<T>;
  jeton: symbol;
  /** false = rien à faire ; l'appelant ne doit alors ni envoyer de requête réseau ni traiter succès/échec. */
  aDemarre: boolean;
  /** Identifiants RÉELS réclamés dans `registre` (jamais de marqueur synthétique mélangé). */
  idsReclames: string[];
  /** true pour `toutMarquerLu` : cette action a aussi la charge du "reste non chargé" (`registreReste`). */
  gereLeReste: boolean;
  /** Valeur de `resteNonLues` à restaurer en cas d'échec — pertinent uniquement si `gereLeReste`. */
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
    return { etat, jeton: Symbol("inutilise"), aDemarre: false, idsReclames: [], gereLeReste: false, resteNonLuesAvant: 0 };
  }
  const jeton = Symbol("marquerLue");
  registre.reclamer([id], jeton);
  return {
    etat: { ...etat, notifications },
    jeton,
    aDemarre: true,
    idsReclames: [id],
    gereLeReste: false, // une action individuelle ne touche jamais `resteNonLues`
    resteNonLuesAvant: 0,
  };
}

/**
 * Orchestrateur pur pour une lecture GLOBALE. Réclame la propriété de TOUS
 * les identifiants actuellement chargés (registre à ids réels) ET du slot
 * "reste non chargé" (registre à slot unique, toujours réclamable).
 *
 * Correction round 3 : réclamer seulement `idsTouches` (les identifiants non
 * lus AU MOMENT du démarrage) laisse un `marquerLue(id)` déjà en vol
 * conserver la propriété de son id. Réclamer TOUS les ids actuels neutralise
 * ce cas : l'action globale l'emporte toujours sur toute action
 * individuelle plus ancienne sur le même id.
 */
export function demarrerToutMarquerLu<T extends NotificationAvecLecture>(
  etat: EtatNotifications<T>,
  registre: RegistrePropriete,
  registreReste: ProprieteUnique,
): DemarrageAction<T> {
  const { notifications, idsTouches } = marquerTousCommeLus(etat.notifications);
  if (idsTouches.length === 0 && etat.resteNonLues === 0) {
    return { etat, jeton: Symbol("inutilise"), aDemarre: false, idsReclames: [], gereLeReste: false, resteNonLuesAvant: 0 };
  }
  const idsAReclamer = etat.notifications.map((n) => n.id);
  const jeton = Symbol("toutMarquerLu");
  registre.reclamer(idsAReclamer, jeton);
  registreReste.reclamer(jeton);
  return {
    etat: { notifications, resteNonLues: 0 },
    jeton,
    aDemarre: true,
    idsReclames: idsAReclamer,
    gereLeReste: true,
    resteNonLuesAvant: etat.resteNonLues,
  };
}

/**
 * Succès : un succès réseau est toujours définitif.
 * - Confirme la propriété des ids réels (terminal) et RÉAFFIRME leur état
 *   "lu" — nécessaire si une AUTRE action avait entre temps repris puis
 *   perdu leur propriété et les avait remis à `lu: false` par erreur.
 * - Si cette action gère le reste non chargé ET qu'elle le possède encore
 *   (aucun cycle `toutMarquerLu` plus récent ne l'a repris), réaffirme
 *   `resteNonLues = 0` pour SON périmètre — corrige le cas où un
 *   `chargerHistorique()` concurrent aurait réinjecté une valeur périmée
 *   entre l'optimiste et la résolution réseau (correction round 4).
 */
export function confirmerSucces<T extends NotificationAvecLecture>(
  etat: EtatNotifications<T>,
  demarrage: Pick<DemarrageAction<T>, "idsReclames" | "jeton" | "gereLeReste">,
  registre: RegistrePropriete,
  registreReste: ProprieteUnique,
): EtatNotifications<T> {
  registre.confirmer(demarrage.idsReclames);
  const ensemble = new Set(demarrage.idsReclames);
  const dejaCorrect = etat.notifications.every((n) => !ensemble.has(n.id) || n.lu);
  const notifications = dejaCorrect
    ? etat.notifications
    : etat.notifications.map((n) => (ensemble.has(n.id) ? { ...n, lu: true } : n));

  let resteNonLues = etat.resteNonLues;
  if (demarrage.gereLeReste && registreReste.estPossedePar(demarrage.jeton)) {
    resteNonLues = 0;
    registreReste.liberer(demarrage.jeton);
  }

  if (notifications === etat.notifications && resteNonLues === etat.resteNonLues) return etat;
  return { notifications, resteNonLues };
}

/**
 * Échec : restaure UNIQUEMENT ce que ce jeton possède ENCORE au moment de
 * l'échec (jamais un remplacement complet par un instantané antérieur).
 * Renvoie `null` si une action plus récente a déjà repris la main sur tout
 * ce que celle-ci gérait (ids réels ET reste non chargé) — dans ce cas il
 * n'y a rien à annuler, et l'appelant ne doit ni modifier l'état ni
 * afficher de toast d'erreur.
 */
export function annulerApresEchec<T extends NotificationAvecLecture>(
  etat: EtatNotifications<T>,
  demarrage: Pick<DemarrageAction<T>, "idsReclames" | "jeton" | "gereLeReste" | "resteNonLuesAvant">,
  registre: RegistrePropriete,
  registreReste: ProprieteUnique,
): EtatNotifications<T> | null {
  const idsARestaurer = registre.idsEncoreReclamesPar(demarrage.idsReclames, demarrage.jeton);
  registre.liberer(idsARestaurer, demarrage.jeton);

  let resteNonLues = etat.resteNonLues;
  let resteRestaure = false;
  if (demarrage.gereLeReste && registreReste.estPossedePar(demarrage.jeton)) {
    resteNonLues = demarrage.resteNonLuesAvant;
    registreReste.liberer(demarrage.jeton);
    resteRestaure = true;
  }

  if (idsARestaurer.length === 0 && !resteRestaure) return null;

  const notifications = annulerLectureCiblee(etat.notifications, idsARestaurer);
  return { notifications, resteNonLues };
}
