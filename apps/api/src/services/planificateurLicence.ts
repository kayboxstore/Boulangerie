import cron from "node-cron";
import { logger } from "../lib/logger.js";
import { rafraichirEtatLicence } from "./licenceLocale.js";
import { executerTacheDeFondSuivie } from "../lib/barriereEcriture.js";

/**
 * Vérification périodique du statut de licence auprès du service central
 * (kayboxstore/licences-activation, dépôt et déploiement séparés). Portée
 * par node-cron dans le process de l'API, même patron que
 * `planificateurAlertes.ts`.
 *
 * IMPORTANT : `initPlanificateurLicence()` déclenche un premier contact
 * IMMÉDIATEMENT à l'appel (pas seulement à la première échéance cron) — ce
 * planificateur est initialisé dans index.ts au tout début du démarrage du
 * serveur, avant même qu'un compte Administrateur puisse exister. Le
 * compteur d'essai de 30 jours (côté service central) démarre au premier
 * contact réussi, pas à la fin de l'assistant de premier lancement : retarder
 * ce premier appel jusqu'à la fin de l'assistant retarderait à tort le début
 * de l'essai.
 */
const EXPRESSION = process.env.LICENCE_CRON ?? "0 * * * *"; // toutes les heures
const FUSEAU = process.env.BACKUP_TIMEZONE ?? "Africa/Kinshasa";

let tache: ReturnType<typeof cron.schedule> | null = null;

/** Démarre la planification (+ un premier appel immédiat). Idempotent. */
export function initPlanificateurLicence(): void {
  if (tache) return;

  // Suivi par la barrière d'écriture (P0, lib/barriereEcriture.ts), comme le
  // reste des tâches de fond : voir planificateurAlertes.ts pour la doctrine.
  executerTacheDeFondSuivie(() => rafraichirEtatLicence()).catch((e) =>
    logger.error("Vérification de licence au démarrage en échec", { erreur: e }),
  );

  if (!cron.validate(EXPRESSION)) {
    logger.error("Expression cron de vérification de licence invalide : planification désactivée", {
      expression: EXPRESSION,
    });
    return;
  }
  tache = cron.schedule(EXPRESSION, () => executerTacheDeFondSuivie(() => rafraichirEtatLicence()), {
    timezone: FUSEAU,
    noOverlap: true,
    name: "verification-licence",
  });
  logger.info("Vérification périodique de licence planifiée", { expression: EXPRESSION, fuseau: FUSEAU });
}

/** Arrête la planification (tests, extinction propre). */
export function arreterPlanificateurLicence(): void {
  tache?.stop();
  tache = null;
}
