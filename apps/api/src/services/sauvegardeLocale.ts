import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Stockage LOCAL des sauvegardes automatiques (section 3.15).
 *
 * Remplace l'envoi vers Google Drive : en usage réel, les comptes de service
 * Google Cloud n'ont pas de quota de stockage propre sur Drive (seuls les
 * Drive partagés Workspace en ont un), ce qui rendait la mise en place plus
 * lourde que le gain. La sauvegarde automatique écrit désormais directement
 * sur le disque du serveur, avec une rétention glissante.
 *
 * IMPORTANT — ce disque n'est pas garanti persistant. Sur un hébergeur comme
 * Render (offre gratuite), le disque peut être réinitialisé à chaque
 * redéploiement. Ce mécanisme protège contre une erreur de manipulation
 * ENTRE deux redéploiements ; il ne remplace pas une copie régulière vers un
 * support externe (clé USB/disque externe) — d'où le bouton de téléchargement
 * de la dernière sauvegarde locale, à côté de la sauvegarde manuelle.
 */

const PREFIXE = "lomoto-";
const SUFFIXE = ".dump";

/** Nombre de sauvegardes locales conservées ; les plus anciennes sont purgées. */
const RETENTION = Math.max(1, Number(process.env.BACKUP_LOCAL_RETENTION ?? 14));

/**
 * Répertoire de stockage. Résolu depuis l'emplacement de ce fichier (pas
 * `process.cwd()`, qui varie selon la façon dont le process est lancé) —
 * mêmes conventions que la résolution du logo pour les PDF. Surchargeable via
 * BACKUP_LOCAL_DIR pour pointer vers un disque persistant si l'hébergeur en
 * propose un (ex. Render Persistent Disk monté sur /data).
 */
function repertoire(): string {
  if (process.env.BACKUP_LOCAL_DIR) return process.env.BACKUP_LOCAL_DIR;
  const ici = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(ici, "../../sauvegardes-locales");
}

export function repertoireLocal(): string {
  return repertoire();
}

export function retentionLocale(): number {
  return RETENTION;
}

async function assurerRepertoire(): Promise<string> {
  const dossier = repertoire();
  await fs.mkdir(dossier, { recursive: true });
  return dossier;
}

/** Écrit le dump sur disque et purge les sauvegardes au-delà de la rétention. */
export async function ecrireSauvegardeLocale(nomFichier: string, contenu: Buffer): Promise<string> {
  const dossier = await assurerRepertoire();
  const chemin = path.join(dossier, nomFichier);
  await fs.writeFile(chemin, contenu);
  await purgerAnciennes();
  return chemin;
}

/**
 * Ne garde que les RETENTION fichiers les plus récents (tri par nom, qui est
 * horodaté donc trié naturellement — pas besoin de stat() sur chaque fichier).
 */
async function purgerAnciennes(): Promise<void> {
  const dossier = repertoire();
  const fichiers = (await fs.readdir(dossier))
    .filter((f) => f.startsWith(PREFIXE) && f.endsWith(SUFFIXE))
    .sort();
  const excedent = fichiers.slice(0, Math.max(0, fichiers.length - RETENTION));
  await Promise.all(excedent.map((f) => fs.unlink(path.join(dossier, f)).catch(() => {})));
}

/** Lit un fichier de sauvegarde local pour le servir en téléchargement. */
export async function lireSauvegardeLocale(nomFichier: string): Promise<Buffer | null> {
  // Le nom vient de la base (jamais de l'utilisateur), mais on se protège tout
  // de même d'une éventuelle traversée de chemin avant de toucher au disque.
  if (nomFichier.includes("/") || nomFichier.includes("\\") || nomFichier.includes("..")) return null;
  try {
    return await fs.readFile(path.join(repertoire(), nomFichier));
  } catch {
    return null;
  }
}
