import cron from "node-cron";
import { logger } from "../lib/logger.js";
import { verifierAlertesDette } from "../routes/commandes.js";
import { verifierAlertesAbsenceEnAttente } from "../routes/travailleurs.js";
import { verifierAlertesSeuilStock } from "./stocks.js";

/**
 * Balayage périodique des alertes paresseuses (section 3.2/3.4/3.18, Lot 7
 * pt 2). Les vérifications elles-mêmes (`verifierAlertesDette`,
 * `verifierAlertesAbsenceEnAttente`, `verifierAlertesSeuilStock`) tournent
 * déjà au chargement des écrans concernés — ce planificateur ne fait que les
 * rejouer à intervalle régulier, en filet de sécurité, pour qu'une dette, une
 * absence ou un stock sous le seuil ne restent jamais silencieux simplement
 * parce que personne n'a rouvert l'écran correspondant. Portée par node-cron
 * dans le process de l'API, même patron que `planificateurSauvegarde.ts`.
 *
 * Chaque vérification est indépendante et déjà idempotente (compare-and-set
 * sur son propre champ `*EnvoyeeLe`) : l'échec de l'une n'empêche pas les
 * autres de tourner.
 */

// Toutes les 30 minutes : assez réactif pour ne pas laisser une alerte
// dormir une journée entière, assez espacé pour rester un filet de sécurité
// et non le mécanisme principal (qui reste le chargement d'écran).
const EXPRESSION = process.env.ALERTES_CRON ?? "*/30 * * * *";
const FUSEAU = process.env.BACKUP_TIMEZONE ?? "Africa/Kinshasa";

let tache: ReturnType<typeof cron.schedule> | null = null;

export async function executerBalayageAlertes(): Promise<void> {
  const verifications: Array<[string, () => Promise<void>]> = [
    ["dette", verifierAlertesDette],
    ["absence", verifierAlertesAbsenceEnAttente],
    ["seuil stock", verifierAlertesSeuilStock],
  ];

  for (const [nom, verifier] of verifications) {
    try {
      await verifier();
    } catch (e) {
      logger.error("Balayage périodique des alertes en échec", { verification: nom, erreur: e });
    }
  }
}

/** Démarre la planification. Idempotent : un second appel ne double pas la tâche. */
export function initPlanificateurAlertes(): void {
  if (tache) return;
  if (!cron.validate(EXPRESSION)) {
    logger.error("Expression cron du balayage d'alertes invalide : planification désactivée", {
      expression: EXPRESSION,
    });
    return;
  }
  tache = cron.schedule(EXPRESSION, () => executerBalayageAlertes(), {
    timezone: FUSEAU,
    noOverlap: true,
    name: "balayage-alertes",
  });
  logger.info("Balayage périodique des alertes planifié", { expression: EXPRESSION, fuseau: FUSEAU });
}

/** Arrête la planification (tests, extinction propre). */
export function arreterPlanificateurAlertes(): void {
  tache?.stop();
  tache = null;
}
