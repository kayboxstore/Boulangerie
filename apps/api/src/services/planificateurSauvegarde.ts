import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { construireDump, nomFichierSauvegarde } from "./sauvegarde.js";
import { driveConfigure, envoyerVersDrive } from "./googleDrive.js";

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
  } catch (e) {
    await journaliserEchec(nomFichier, e, Date.now() - t0, null);
    return;
  }

  // Sans identifiants Drive, la sauvegarde est produite mais n'a nulle part où
  // aller : on le consigne en échec explicite plutôt que de laisser croire à un
  // succès. Le téléchargement manuel reste, lui, pleinement fonctionnel.
  if (!driveConfigure()) {
    await journaliserEchec(
      nomFichier,
      new Error(
        "Sauvegarde produite mais non archivée : Google Drive n'est pas configuré (GOOGLE_SERVICE_ACCOUNT_JSON et GOOGLE_DRIVE_FOLDER_ID).",
      ),
      Date.now() - t0,
      dump.length,
    );
    return;
  }

  try {
    const { id } = await envoyerVersDrive({ nomFichier, contenu: dump });
    await prisma.sauvegardeBase.create({
      data: {
        type: "AUTOMATIQUE",
        statut: "SUCCES",
        tailleOctets: dump.length,
        nomFichier,
        destination: "GOOGLE_DRIVE",
        idDistant: id,
        dureeMs: Date.now() - t0,
      },
    });
    console.log(`Sauvegarde automatique envoyée vers Google Drive : ${nomFichier} (${dump.length} octets)`);
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
  console.error(`Sauvegarde automatique en échec : ${message}`);
  try {
    await prisma.sauvegardeBase.create({
      data: {
        type: "AUTOMATIQUE",
        statut: "ECHEC",
        tailleOctets,
        nomFichier,
        destination: driveConfigure() ? "GOOGLE_DRIVE" : null,
        erreur: message.slice(0, 1000),
        dureeMs,
      },
    });
  } catch (erreurJournal) {
    // Si même la journalisation échoue (base injoignable), il ne reste que la
    // sortie standard — mais le process ne doit pas tomber pour autant.
    console.error("Impossible de journaliser l'échec de sauvegarde :", erreurJournal);
  }
}

/** Démarre la planification. Idempotent : un second appel ne double pas la tâche. */
export function initPlanificateurSauvegarde(): void {
  if (tache) return;
  if (!cron.validate(EXPRESSION)) {
    console.error(`Expression cron de sauvegarde invalide (${EXPRESSION}) : planification désactivée.`);
    return;
  }
  // noOverlap : si un dump prend anormalement longtemps, la planification du
  // lendemain ne lance pas une seconde sauvegarde par-dessus.
  tache = cron.schedule(EXPRESSION, () => executerSauvegardeAutomatique(), {
    timezone: FUSEAU,
    noOverlap: true,
    name: "sauvegarde-quotidienne",
  });
  console.log(
    `Sauvegarde automatique planifiée (${EXPRESSION}, ${FUSEAU})` +
      (driveConfigure() ? "" : " — Google Drive non configuré, les tentatives seront consignées en échec"),
  );
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
