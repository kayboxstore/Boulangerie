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
 * - round 5 : `annulerApresEchec` restaurait `lu: false` pour TOUS les ids
 *   encore réclamés par le jeton en échec — y compris ceux qui étaient déjà
 *   réellement lus avant que l'action ne démarre (ex. `toutMarquerLu` échoue
 *   après avoir réclamé une notification A déjà lue et une notification B non
 *   lue : A redevenait, à tort, non lue). Le registre distingue désormais
 *   deux notions par identifiant réclamé : la PROPRIÉTÉ (qui gère la
 *   concurrence, inchangée) et l'OBLIGATION DE ROLLBACK `doitRestaurerNonLu`
 *   (calculée au moment de la réclamation, jamais recalculée après coup à
 *   partir du seul `lu === false` courant — une notification affichée `lu:
 *   true` peut être le fruit d'une action individuelle encore en vol, pas
 *   encore confirmée : si le global la reprend, il doit hériter de son
 *   obligation de rollback, pas la perdre).
 * - round 6 : `chargerHistorique()` (GET `/api/notifications`) appliquait sa
 *   réponse dès lors que l'effet était encore actif, sans vérifier si une
 *   requête d'historique plus récente avait été lancée entre-temps, ni si
 *   une mutation locale plus récente (lecture individuelle/globale,
 *   notification Socket.io) avait déjà changé l'état affiché — une réponse
 *   réseau lente pouvait alors réinjecter des notifications non lues déjà
 *   traitées, ou écraser une notification arrivée depuis. `creerSuiviFraicheurHistorique`
 *   ajoute une barrière de fraîcheur À TROIS CONDITIONS avant d'appliquer
 *   une réponse d'historique : (1) la génération de session — RÉUTILISE la
 *   génération déjà introduite en round 4, ne recrée pas de mécanisme
 *   concurrent ; (2) un numéro de séquence monotone, pour ne retenir que la
 *   toute dernière requête d'historique lancée ; (3) une révision de mutation
 *   locale, incrémentée par `socket.tsx` à chaque écriture RÉELLE de l'état
 *   (voir `appliquerEtat`) — capturée au départ de la requête, revérifiée à
 *   son retour.
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

/** Un identifiant réclamé porte, en plus du jeton propriétaire, l'obligation de rollback calculée au moment de la réclamation. */
export interface EntreeReclamation {
  id: string;
  /** true si un échec de CETTE action doit remettre cet identifiant à `lu: false`. */
  doitRestaurerNonLu: boolean;
}

/**
 * Registre de "propriété" par identifiant RÉEL. Trois états possibles par
 * id : non réclamé, réclamé par un jeton (en attente de résolution réseau,
 * avec son obligation de rollback `doitRestaurerNonLu`), ou CONFIRMÉ
 * (terminal — un succès réseau a eu lieu, pour n'importe quelle action ; plus
 * aucune reprise ni rollback futur ne peut l'affecter). Ce caractère terminal
 * est correct pour une notification réelle (une fois lue, elle le reste) —
 * voir `creerProprieteUnique` ci-dessous pour le "reste non chargé", qui n'a
 * PAS cette propriété de terminalité.
 *
 * PROPRIÉTÉ et OBLIGATION DE ROLLBACK sont deux notions distinctes (round 5) :
 * la propriété gère la concurrence (qui a le droit de confirmer/annuler cet
 * id) ; l'obligation de rollback dit si un échec de CE propriétaire doit
 * remettre l'id à `lu: false`. Un identifiant réclamé par `toutMarquerLu`
 * peut très bien rester la propriété de cette action tout en ayant
 * `doitRestaurerNonLu = false` (il était déjà réellement lu) — un échec le
 * laisse alors intact.
 */
export function creerRegistreDePropriete<Jeton>() {
  type EtatId = { statut: "reclame"; jeton: Jeton; doitRestaurerNonLu: boolean } | { statut: "confirme" };
  const etats = new Map<string, EtatId>();

  return {
    /**
     * Réclame la propriété des identifiants donnés, avec leur obligation de
     * rollback respective — sans effet sur un identifiant déjà confirmé
     * (terminal). L'obligation est fournie par l'appelant (voir
     * `demarrerMarquerLue`/`demarrerToutMarquerLu`), jamais recalculée ici à
     * partir d'un état courant.
     */
    reclamer(entrees: readonly EntreeReclamation[], jeton: Jeton): void {
      for (const { id, doitRestaurerNonLu } of entrees) {
        if (etats.get(id)?.statut === "confirme") continue;
        etats.set(id, { statut: "reclame", jeton, doitRestaurerNonLu });
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
    /** Sous-ensemble des identifiants ENCORE réclamés (ni repris, ni confirmés) par ce jeton précisément — propriété seule, indépendamment de l'obligation de rollback. */
    idsEncoreReclamesPar(ids: readonly string[], jeton: Jeton): string[] {
      return ids.filter((id) => {
        const actuel = etats.get(id);
        return actuel?.statut === "reclame" && actuel.jeton === jeton;
      });
    },
    /**
     * Obligation de rollback ACTUELLE d'un identifiant encore réclamé (pour
     * qu'une action qui le reprend hérite de cette obligation plutôt que de
     * la recalculer sur le seul `lu` affiché — voir la note d'en-tête).
     * `false` si l'identifiant n'est pas réclamé (non trouvé ou confirmé).
     */
    doitRestaurerNonLu(id: string): boolean {
      const actuel = etats.get(id);
      return actuel?.statut === "reclame" ? actuel.doitRestaurerNonLu : false;
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
  // Une lecture individuelle ne démarre que sur une notification non lue
  // (voir `marquerIdCommeLu` ci-dessus, `aChange` serait `false` sinon) :
  // son obligation de rollback est donc toujours vraie.
  registre.reclamer([{ id, doitRestaurerNonLu: true }], jeton);
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
 *
 * Correction round 5 : réclamer un id ne signifie pas qu'un échec doit le
 * remettre à `lu: false` — un id réellement déjà lu (sans opération en vol)
 * doit rester lu même si CETTE action globale échoue. Pour chaque id
 * réclamé, l'obligation de rollback (`doitRestaurerNonLu`) est déterminée
 * ainsi, à partir de l'état AFFICHÉ avant le passage optimiste de
 * `marquerTousCommeLus` : non lu → obligation vraie ; déjà affiché lu mais
 * objet d'une réclamation en cours (action individuelle non confirmée) →
 * hérite de l'obligation de cette réclamation, jamais recalculée sur le seul
 * `lu` courant ; déjà réellement lu et sans réclamation en cours → obligation
 * fausse.
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
  const jeton = Symbol("toutMarquerLu");
  const entrees: EntreeReclamation[] = etat.notifications.map((n) => ({
    id: n.id,
    doitRestaurerNonLu: !n.lu || registre.doitRestaurerNonLu(n.id),
  }));
  registre.reclamer(entrees, jeton);
  registreReste.reclamer(jeton);
  return {
    etat: { notifications, resteNonLues: 0 },
    jeton,
    aDemarre: true,
    idsReclames: entrees.map((e) => e.id),
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
 *
 * Round 5 : la PROPRIÉTÉ (tous les ids encore possédés par ce jeton, y
 * compris ceux qui étaient déjà réellement lus) est TOUJOURS libérée — sans
 * quoi ces ids resteraient verrouillés indéfiniment. Seul le SOUS-ENSEMBLE
 * dont `doitRestaurerNonLu` vaut vrai est repassé à `lu: false` : une
 * notification réellement lue avant le démarrage de l'action n'est jamais
 * touchée, quel que soit l'ordre de résolution des actions concurrentes.
 */
export function annulerApresEchec<T extends NotificationAvecLecture>(
  etat: EtatNotifications<T>,
  demarrage: Pick<DemarrageAction<T>, "idsReclames" | "jeton" | "gereLeReste" | "resteNonLuesAvant">,
  registre: RegistrePropriete,
  registreReste: ProprieteUnique,
): EtatNotifications<T> | null {
  const idsEncorePossedes = registre.idsEncoreReclamesPar(demarrage.idsReclames, demarrage.jeton);
  const idsARestaurer = idsEncorePossedes.filter((id) => registre.doitRestaurerNonLu(id));
  registre.liberer(idsEncorePossedes, demarrage.jeton);

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

/** Jeton capturé au lancement d'une requête d'historique, à revérifier à son retour. */
export interface JetonFraicheurHistorique {
  generation: number;
  sequence: number;
  revision: number;
}

/**
 * Barrière de fraîcheur pour `chargerHistorique()` (round 6). La GÉNÉRATION
 * n'est pas gérée ici : elle est fournie par l'appelant à chaque opération
 * (`demarrerChargement`/`estEncoreValide`) pour RÉUTILISER telle quelle la
 * génération de session déjà introduite en round 4 (`generationRef` dans
 * socket.tsx), plutôt que de créer un second mécanisme concurrent.
 *
 * En revanche la SÉQUENCE (quelle requête d'historique est la plus récente)
 * et la RÉVISION (une mutation locale a-t-elle eu lieu depuis le départ de
 * la requête) sont spécifiques au chargement d'historique et gérées ici.
 *
 * Une réponse n'est appliquée que si les TROIS conditions tiennent encore :
 * même génération, dernière séquence lancée, aucune révision depuis.
 */
export function creerSuiviFraicheurHistorique() {
  let derniereSequence = 0;
  let revision = 0;

  return {
    /** À appeler à chaque nouvelle génération (connexion, changement d'utilisateur, déconnexion) : évite toute confusion avec les séquences/révisions de la session précédente. */
    reinitialiser(): void {
      derniereSequence = 0;
      revision = 0;
    },
    /**
     * À appeler à chaque écriture RÉELLE de l'état affiché (voir
     * `appliquerEtat` dans socket.tsx) : action optimiste, confirmation ou
     * rollback utile (qui a effectivement changé quelque chose), arrivée
     * d'une notification Socket.io, ou toute autre mutation locale. Périme
     * immédiatement toute requête d'historique encore en vol.
     */
    enregistrerMutationLocale(): void {
      revision += 1;
    },
    /** Démarre une nouvelle requête d'historique ; le jeton renvoyé doit être revérifié via `estEncoreValide` à la résolution (succès ou échec). */
    demarrerChargement(generation: number): JetonFraicheurHistorique {
      derniereSequence += 1;
      return { generation, sequence: derniereSequence, revision };
    },
    /** Une réponse (ou une erreur) d'historique doit-elle encore être appliquée ? */
    estEncoreValide(jeton: JetonFraicheurHistorique, generationActuelle: number): boolean {
      return jeton.generation === generationActuelle && jeton.sequence === derniereSequence && jeton.revision === revision;
    },
  };
}

export type SuiviFraicheurHistorique = ReturnType<typeof creerSuiviFraicheurHistorique>;
