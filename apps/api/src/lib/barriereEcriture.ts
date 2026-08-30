/**
 * Barrière d'écriture globale (P0 — sécurité/fiabilité du pilote, correctif
 * Codex/Claude du 30/08/2026, section 3.15) — garantit que le dump produit
 * par une réinitialisation de base (`services/reinitialisation.ts`) et l'état
 * transactionnel effacé juste après représentent la MÊME frontière logique.
 *
 * Constat corrigé : `reinitialiserBase()` produisait auparavant son dump AVANT
 * la transaction d'effacement, sans empêcher aucune écriture concurrente entre
 * les deux — une commande, un règlement ou une remise arrivé après le snapshot
 * du dump mais avant l'effacement était silencieusement PERDU (ni dans la
 * sauvegarde, ni dans la base après coup).
 *
 * Mécanisme : un compteur d'écritures « en vol » (`compteurEnVol`), incrémenté
 * à l'entrée de chaque requête HTTP mutante (voir `gardeBarriereEcriture`, le
 * middleware Express monté tout en amont dans app.ts) et de chaque tâche de
 * fond susceptible d'écrire (voir `executerTacheDeFondSuivie`, utilisé par les
 * planificateurs d'alertes et de sauvegarde). Activer la barrière (1) refuse
 * toute NOUVELLE requête/tâche avec un 503 explicite, puis (2) attend que le
 * compteur retombe à zéro — c'est-à-dire que toutes les écritures déjà
 * engagées AVANT l'activation aient terminé — avant de rendre la main à
 * l'appelant. `reinitialiserBase()` ne produit son dump qu'une fois cette
 * attente résolue : plus aucune écriture ne peut être en cours ni démarrer
 * pendant tout l'intervalle dump→effacement.
 *
 * Choix délibéré, documenté : le middleware bloque TOUTES les méthodes HTTP
 * (pas seulement POST/PUT/PATCH/DELETE), sauf `GET /api/health`. Plusieurs
 * routes de lecture ont un effet de bord d'écriture paresseuse (ex.
 * `verifierAlertesDette` déclenché par un simple GET) ; plutôt que de dresser
 * et maintenir une liste exhaustive et fragile des routes « vraiment en
 * lecture seule », la barrière traite la réinitialisation comme une coupure
 * de service brève et totale (le temps du drainage + du dump, typiquement
 * quelques secondes) — plus simple à prouver correcte que d'auditer chaque
 * route existante et future.
 *
 * LIMITE CONNUE — mono-instance : ce compteur vit en mémoire du process
 * Node.js. Le déploiement Render actuel ne comporte qu'UNE SEULE instance de
 * l'API (voir render.yaml, `numInstances` absent = 1) : cette barrière est
 * donc une garantie EXACTE dans la configuration actuelle. Si l'application
 * passe un jour à plusieurs instances (scaling horizontal), ce mécanisme en
 * mémoire NE SUFFIT PLUS : une écriture routée vers une AUTRE instance ne
 * serait ni comptée ni bloquée. Il faudrait alors remplacer ce compteur par
 * une coordination distribuée réelle (ex. verrou consultatif PostgreSQL
 * `pg_advisory_lock`, tenu par l'instance qui réinitialise, vérifié par un
 * middleware sur toutes les instances avant d'accepter une écriture) —
 * documenté ici pour ne pas être oublié le jour où ce choix d'infrastructure
 * change.
 *
 * CORRECTIFS ROUND 2 (contre-revue Codex, 30/08/2026) — deux défauts P0
 * trouvés dans la version initiale de ce mécanisme :
 *  1. Auto-blocage : `POST /api/etat-systeme/reinitialiser` se comptait
 *     elle-même comme écriture en vol avant même d'appeler
 *     `activerBarriereEtAttendreDrainage()`, qui attendait alors sa PROPRE
 *     fin pour se drainer — blocage garanti, résolu seulement par le
 *     timeout de drainage. Corrigé par `estRequeteReinitialisation()` :
 *     exception hardcodée, UNIQUEMENT cette route, jamais une liste
 *     extensible.
 *  2. Décompte prématuré : le compteur décomptait aussi sur l'événement
 *     `close` de la réponse, qui peut se déclencher quand le CLIENT se
 *     déconnecte alors que le handler Express continue réellement d'écrire
 *     en base. Corrigé : décompte UNIQUEMENT sur `finish` (fin RÉELLEMENT
 *     prouvée de la réponse) — voir `gardeBarriereEcriture`.
 */
import type { NextFunction, Request, Response } from "express";

export class ErreurBarriereActive extends Error {
  code = "REINITIALISATION_EN_COURS";
  constructor(message: string) {
    super(message);
  }
}

export class ErreurDrainageEchoue extends Error {
  code = "DRAINAGE_ECRITURES_ECHOUE";
  constructor(message: string) {
    super(message);
  }
}

let barriereActive = false;
let compteurEnVol = 0;
const abonnesDrain: Array<() => void> = [];

/**
 * SEULE exception au comptage — la route qui active elle-même la barrière et
 * attend le drainage (`services/reinitialisation.ts`). Sans elle, cette
 * requête se compterait comme « en vol » avant même d'appeler
 * `activerBarriereEtAttendreDrainage()`, puis attendrait indéfiniment sa
 * PROPRE fin pour se drainer elle-même — auto-blocage garanti (correctif
 * Codex, round 2, 30/08/2026). Hardcodée en dur (méthode + chemin EXACTS),
 * jamais une liste extensible : aucune autre route ne doit jamais en
 * bénéficier. Elle reste pleinement protégée par le refus 503 ci-dessous si
 * la barrière est DÉJÀ active, et par le garde-fou anti-double-activation de
 * `activerBarriereEtAttendreDrainage()` (ErreurBarriereActive) si deux
 * requêtes de réinitialisation arrivent à la suite l'une de l'autre avant
 * que la première n'ait eu le temps d'activer la barrière : Node.js étant
 * mono-thread et cette vérification synchrone (aucun `await` avant elle),
 * la première à l'atteindre gagne — au plus une exécution, jamais deux.
 */
const METHODE_REINITIALISATION = "POST";
const CHEMIN_REINITIALISATION = "/api/etat-systeme/reinitialiser";

function estRequeteReinitialisation(req: Request): boolean {
  return req.method === METHODE_REINITIALISATION && req.path === CHEMIN_REINITIALISATION;
}

/**
 * Crochets de test — UNIQUEMENT utilisés par les scripts de vérification
 * PostgreSQL réels (jamais par du code de production, jamais fournis par une
 * requête HTTP). Même idiome que `CrochetsTestVerrouCaisse`
 * (services/caisseAtomique.ts) et `CrochetsTestTransitionCycle`
 * (routes/cycles-livraison.ts) : un point de contrôle déterministe pour
 * entrelacer deux opérations concurrentes, jamais un délai qui « espère » un
 * chevauchement.
 */
export const crochetsTestBarriere: {
  /** Appelé juste après le passage de la barrière à `active`, avant l'attente de drainage. */
  apresActivationAvantDrainage?: () => Promise<void> | void;
  /** Appelé pour CHAQUE écriture suivie (HTTP ou tâche de fond) juste après l'incrémentation, avant de continuer. */
  apresIncrementAvantExecution?: () => Promise<void> | void;
} = {};

export function barriereReinitialisationActive(): boolean {
  return barriereActive;
}

export function ecrituresEnVol(): number {
  return compteurEnVol;
}

function notifierDrainSiVide(): void {
  if (compteurEnVol <= 0) {
    const liste = abonnesDrain.splice(0);
    liste.forEach((f) => f());
  }
}

/**
 * Middleware Express — à monter tout en amont (voir app.ts), avant les
 * routeurs métier. Bloque toute requête (sauf `GET /api/health`) tant que la
 * barrière est active, et suit les autres comme « en vol » jusqu'à leur fin
 * RÉELLEMENT PROUVÉE.
 *
 * Décompte UNIQUEMENT sur `finish` (correctif Codex, round 2, 30/08/2026) —
 * jamais sur `close`. `close` se déclenche dès que la connexion TCP se ferme,
 * y compris quand le CLIENT part en cours de route alors que le handler
 * Express, lui, continue d'exécuter ses écritures PostgreSQL (Express
 * n'annule pas le handler à la déconnexion du client). Décompter sur `close`
 * pouvait donc faire croire la base « drainée » alors qu'une écriture
 * tournait encore. Règle conservatrice assumée : si `finish` ne se déclenche
 * jamais (réponse jamais envoyée, ex. connexion détruite avant que le
 * handler ait pu répondre), cette écriture reste comptée « en vol » pour
 * toujours — une réinitialisation qui attend son drainage échouera alors sur
 * timeout (`ErreurDrainageEchoue`) plutôt que de risquer de démarrer un dump
 * pendant qu'une écriture est peut-être encore en cours. Préférer un échec
 * explicite à une perte de données silencieuse.
 */
export function gardeBarriereEcriture(req: Request, res: Response, next: NextFunction): void {
  if (req.method === "GET" && req.path === "/api/health") {
    next();
    return;
  }
  if (barriereActive) {
    res.status(503).json({
      erreur:
        "Une réinitialisation de la base de données est en cours de préparation. Réessayez dans quelques instants.",
      code: "REINITIALISATION_EN_COURS",
    });
    return;
  }
  if (estRequeteReinitialisation(req)) {
    // Voir le commentaire au-dessus de `estRequeteReinitialisation` : seule
    // exception au comptage, pour ne pas s'auto-bloquer en attendant son
    // propre drainage. Reste protégée par le refus 503 ci-dessus et par
    // `activerBarriereEtAttendreDrainage()` en cas de double requête.
    next();
    return;
  }
  compteurEnVol++;
  let decompte = false;
  const finir = () => {
    if (decompte) return;
    decompte = true;
    compteurEnVol--;
    notifierDrainSiVide();
  };
  res.once("finish", finir);
  void crochetsTestBarriere.apresIncrementAvantExecution?.();
  next();
}

/**
 * Enveloppe une tâche de fond (planificateur d'alertes, de sauvegarde) dans
 * le même suivi que les requêtes HTTP : si la barrière est déjà active, la
 * tâche ne démarre simplement pas (elle sera rejouée à son prochain
 * déclenchement) ; sinon elle est comptée « en vol » jusqu'à sa fin.
 */
export async function executerTacheDeFondSuivie<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (barriereActive) return undefined;
  compteurEnVol++;
  await crochetsTestBarriere.apresIncrementAvantExecution?.();
  try {
    return await fn();
  } finally {
    compteurEnVol--;
    notifierDrainSiVide();
  }
}

/**
 * Active la barrière (refuse toute nouvelle écriture) puis attend que les
 * écritures déjà engagées se terminent. Rejette avec `ErreurDrainageEchoue`
 * si le drainage n'est pas terminé après `timeoutMs` — dans ce cas la
 * barrière reste active et DOIT être abaissée par l'appelant (`finally`,
 * voir `services/reinitialisation.ts`) avant de renvoyer l'erreur : jamais de
 * réinitialisation lancée sans frontière garantie.
 */
export async function activerBarriereEtAttendreDrainage(timeoutMs = 15_000): Promise<void> {
  if (barriereActive) {
    throw new ErreurBarriereActive("La barrière d'écriture est déjà active.");
  }
  barriereActive = true;
  await crochetsTestBarriere.apresActivationAvantDrainage?.();

  if (compteurEnVol <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const minuteur = setTimeout(() => {
      const i = abonnesDrain.indexOf(surDrain);
      if (i >= 0) abonnesDrain.splice(i, 1);
      reject(
        new ErreurDrainageEchoue(
          `${compteurEnVol} écriture(s) encore en cours après ${timeoutMs} ms — impossible de garantir la ` +
            "frontière entre la sauvegarde et l'effacement. Réinitialisation annulée.",
        ),
      );
    }, timeoutMs);
    function surDrain() {
      clearTimeout(minuteur);
      resolve();
    }
    abonnesDrain.push(surDrain);
  });
}

/** Abaisse la barrière — DOIT toujours être appelée dans un `finally`, succès ou échec. */
export function abaisserBarriere(): void {
  barriereActive = false;
}

/** Réservé aux tests : remet le module dans son état initial entre deux scénarios. */
export function reinitialiserBarrierePourTests(): void {
  barriereActive = false;
  compteurEnVol = 0;
  abonnesDrain.length = 0;
  delete crochetsTestBarriere.apresActivationAvantDrainage;
  delete crochetsTestBarriere.apresIncrementAvantExecution;
}
