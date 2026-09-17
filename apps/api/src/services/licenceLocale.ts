import { prisma as prismaApp } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { appellerServiceLicences, type ReponseServiceLicences } from "./licenceCentrale.js";

const ID_ETAT_LICENCE = 1;

/** Jamais bloquant tant que le dernier contact réussi date de moins de 5 jours. */
const JOURS_GRACE_COUPURE_CONTACT = 5;
/** Bandeau d'avertissement (non bloquant) dès que le dernier contact réussi date de plus de 1 jour. */
const JOURS_AVANT_AVERTISSEMENT = 1;
const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

export type AppelServiceLicences = (cleLicence?: string) => Promise<ReponseServiceLicences>;

async function enregistrerContactReussi(
  db: typeof prismaApp,
  reponse: ReponseServiceLicences,
  maintenant: Date,
): Promise<void> {
  const donnees = {
    dernierStatutConnu: reponse.statut,
    joursRestants: reponse.joursRestants ?? null,
    nomClientLicence: reponse.nomClient ?? null,
    dernierContactReussi: maintenant,
  };
  await db.etatLicence.upsert({
    where: { id: ID_ETAT_LICENCE },
    create: { id: ID_ETAT_LICENCE, ...donnees },
    update: donnees,
  });
}

/**
 * Vérification périodique (job, voir services/planificateurLicence.ts) : sur
 * succès, met à jour le cache. Sur échec réseau/timeout, NE TOUCHE PAS
 * dernierContactReussi — se contente de journaliser, le job réessaiera à sa
 * prochaine itération. Ne relance jamais l'erreur : cette fonction ne doit
 * jamais faire planter le planificateur.
 */
export async function rafraichirEtatLicence(
  db: typeof prismaApp = prismaApp,
  appelerService: AppelServiceLicences = appellerServiceLicences,
): Promise<void> {
  let reponse: ReponseServiceLicences;
  try {
    reponse = await appelerService();
  } catch (e) {
    logger.error("Vérification périodique de licence en échec — cache local conservé", { erreur: e });
    return;
  }
  await enregistrerContactReussi(db, reponse, new Date());
}

export interface ResultatActivationLicence {
  statut: string;
  joursRestants?: number;
  nomClient?: string;
  erreurActivation?: string;
}

/**
 * Activation d'une clé de licence (route POST /api/licence/activer — la
 * SEULE à transmettre `cleLicence` au service central). Contrairement au job
 * périodique, un échec réseau/timeout ici est relancé (`ErreurServiceLicences`)
 * — l'appelant (la route) le traduit en 503 pour que l'utilisateur sache que
 * son clic n'a rien fait, au lieu d'échouer silencieusement.
 *
 * Une réponse HTTP reçue (même avec `erreurActivation` — licence introuvable,
 * révoquée, ou plafond atteint) compte comme un contact réussi : le service
 * central a bien répondu, seule l'association de CETTE clé a échoué. Le
 * cache est donc mis à jour dans tous les cas où `appelerService` résout.
 */
export async function activerLicence(
  cleLicence: string,
  db: typeof prismaApp = prismaApp,
  appelerService: AppelServiceLicences = appellerServiceLicences,
): Promise<ResultatActivationLicence> {
  const reponse = await appelerService(cleLicence);
  await enregistrerContactReussi(db, reponse, new Date());
  return {
    statut: reponse.statut,
    joursRestants: reponse.joursRestants,
    nomClient: reponse.nomClient,
    erreurActivation: reponse.erreurActivation,
  };
}

export interface EtatLicenceCache {
  dernierStatutConnu: string;
  joursRestants: number | null;
  dernierContactReussi: Date | null;
}

export interface EtatLicencePourFrontend {
  bloque: boolean;
  avertissement?: boolean;
  joursRestants?: number;
  /** Jours écoulés depuis dernierContactReussi — absent si jamais contacté. */
  joursDepuisContact?: number;
}

/**
 * Calcul PUR (aucun accès base/réseau) de ce que le frontend doit afficher —
 * voir GET /api/licence/etat. Jamais confiance à un simple "on a une ligne
 * en cache" : c'est la FRAÎCHEUR du dernier contact réussi qui décide.
 *
 *  - Jamais contacté, ou contact réussi il y a plus de 5 jours → bloque
 *    (coupure de contact prolongée — pas de confiance aveugle dans un cache
 *    qui pourrait dater d'avant une manipulation locale de l'horloge ou du
 *    réseau).
 *  - Sinon, si le dernier statut CONNU (confirmé par le service central) est
 *    EXPIREE → bloque immédiatement : un essai réellement terminé bloque,
 *    la période de grâce ne couvre que les coupures de CONTACT, jamais un
 *    essai expiré confirmé.
 *  - Sinon → pas bloqué ; avertissement non bloquant dès que le contact date
 *    de plus d'1 jour.
 */
export function calculerEtatLicencePourFrontend(
  etat: EtatLicenceCache | null,
  maintenant: Date = new Date(),
): EtatLicencePourFrontend {
  if (!etat || !etat.dernierContactReussi) {
    return { bloque: true };
  }

  const joursDepuisContact = Math.floor((maintenant.getTime() - etat.dernierContactReussi.getTime()) / MS_PAR_JOUR);

  if (joursDepuisContact > JOURS_GRACE_COUPURE_CONTACT) {
    return { bloque: true, joursDepuisContact };
  }

  if (etat.dernierStatutConnu === "EXPIREE") {
    return { bloque: true, joursDepuisContact };
  }

  return {
    bloque: false,
    avertissement: joursDepuisContact > JOURS_AVANT_AVERTISSEMENT,
    joursRestants: etat.joursRestants ?? undefined,
    joursDepuisContact,
  };
}
