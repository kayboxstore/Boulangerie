import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { construireDump, nomFichierSauvegarde, validerDump } from "./sauvegarde.js";
import { ecrireSauvegardeLocale } from "./sauvegardeLocale.js";
import { executerTacheDeFondSuivie } from "../lib/barriereEcriture.js";

/**
 * Sauvegarde quotidienne automatique (section 3.15). Portée par node-cron dans
 * le process de l'API : aucune infrastructure externe à provisionner.
 *
 * Chaque tentative est journalisée dans SauvegardeBase, y compris les échecs —
 * une sauvegarde qui n'a pas eu lieu est précisément l'information qui doit
 * remonter à l'écran État système.
 */

// 02h30, tous les jours. Heure creuse pour la boulangerie, et suffisamment
// après minuit pour que le registre de la veille soit complet.
const EXPRESSION = process.env.BACKUP_CRON ?? "30 2 * * *";
// Le serveur tourne en UTC chez la plupart des hébergeurs : on fige le fuseau de
// Kinshasa pour que « 02h30 » soit bien 02h30 sur place.
const FUSEAU = process.env.BACKUP_TIMEZONE ?? "Africa/Kinshasa";

// node-cron n'exporte pas le type de sa tâche : on le dérive de `schedule`.
let tache: ReturnType<typeof cron.schedule> | null = null;

/** Nombre de sauvegardes conservées dans l'historique affiché. */
export const TAILLE_HISTORIQUE = 20;

/**
 * Exécute une sauvegarde automatique et la journalise. Ne LANCE jamais : le
 * planificateur ne doit pas pouvoir faire tomber le process, et l'échec est de
 * toute façon consigné en base.
 */
export async function executerSauvegardeAutomatique(): Promise<void> {
  const t0 = Date.now();
  const nomFichier = nomFichierSauvegarde();

  let dump: Buffer;
  try {
    dump = await construireDump();
    // Intégrité (P0, section 3.15) : un dump non vide n'est pas la même
    // chose qu'un dump VALIDE — voir sauvegarde.ts. Une archive corrompue ou
    // partielle ne doit jamais être annoncée comme une sauvegarde réussie.
    await validerDump(dump);
  } catch (e) {
    await journaliserEchec(nomFichier, e, Date.now() - t0, null);
    return;
  }

  try {
    const chemin = await ecrireSauvegardeLocale(nomFichier, dump);
    await prisma.sauvegardeBase.create({
      data: {
        type: "AUTOMATIQUE",
        statut: "SUCCES",
        tailleOctets: dump.length,
        nomFichier,
        destination: "LOCAL",
        idDistant: chemin,
        dureeMs: Date.now() - t0,
      },
    });
    logger.info("Sauvegarde automatique écrite localement", { chemin, octets: dump.length });
  } catch (e) {
    await journaliserEchec(nomFichier, e, Date.now() - t0, dump.length);
  }
}

async function journaliserEchec(
  nomFichier: string,
  e: unknown,
  dureeMs: number,
  tailleOctets: number | null,
): Promise<void> {
  const message = e instanceof Error ? e.message : "erreur inconnue";
  logger.error("Sauvegarde automatique en échec", { erreur: message });
  try {
    await prisma.sauvegardeBase.create({
      data: {
        type: "AUTOMATIQUE",
        statut: "ECHEC",
        tailleOctets,
        nomFichier,
        destination: "LOCAL",
        erreur: message.slice(0, 1000),
        dureeMs,
      },
    });
  } catch (erreurJournal) {
    // Si même la journalisation échoue (base injoignable), il ne reste que la
    // sortie standard — mais le process ne doit pas tomber pour autant.
    logger.error("Impossible de journaliser l'échec de sauvegarde", { erreur: erreurJournal });
  }
}

/** Démarre la planification. Idempotent : un second appel ne double pas la tâche. */
export function initPlanificateurSauvegarde(): void {
  if (tache) return;
  if (!cron.validate(EXPRESSION)) {
    logger.error("Expression cron de sauvegarde invalide : planification désactivée", { expression: EXPRESSION });
    return;
  }
  // noOverlap : si un dump prend anormalement longtemps, la planification du
  // lendemain ne lance pas une seconde sauvegarde par-dessus.
  // Suivi par la barrière d'écriture (P0, lib/barriereEcriture.ts) : ne
  // démarre pas si une réinitialisation est en cours de préparation, et
  // compte cette sauvegarde comme « en vol » jusqu'à sa fin.
  tache = cron.schedule(EXPRESSION, () => executerTacheDeFondSuivie(() => executerSauvegardeAutomatique()), {
    timezone: FUSEAU,
    noOverlap: true,
    name: "sauvegarde-quotidienne",
  });
  logger.info("Sauvegarde automatique planifiée", { expression: EXPRESSION, fuseau: FUSEAU, stockage: "local" });
}

/** Arrête la planification (tests, extinction propre). */
export function arreterPlanificateurSauvegarde(): void {
  tache?.stop();
  tache = null;
}

export function planificationActive(): boolean {
  return tache !== null;
}

/**
 * Prochaine échéance prévue, affichée dans le tableau de bord de maintenance.
 * Calculée depuis l'expression cron plutôt que stockée, pour ne jamais dériver
 * de la planification réelle.
 */
export function prochaineSauvegarde(): string | null {
  if (!tache) return null;
  const prochaine = tache.getNextRun();
  return prochaine ? prochaine.toISOString() : null;
}

export const planificationSauvegarde = { EXPRESSION, FUSEAU };
