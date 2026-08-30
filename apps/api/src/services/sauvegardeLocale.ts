import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

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

/**
 * Écrit le dump sur disque de façon ATOMIQUE (P0, section 3.15) et purge les
 * sauvegardes au-delà de la rétention. Écrire directement sur le chemin final
 * laisserait, en cas de panne/redémarrage EN COURS d'écriture (disque plein,
 * process tué), un fichier tronqué portant déjà le nom attendu — indissociable
 * d'une sauvegarde réussie pour qui la lirait ensuite. On écrit d'abord dans
 * un fichier temporaire du MÊME répertoire (obligatoire pour que le
 * renommage soit atomique — `fs.rename` n'est atomique que sur un même
 * système de fichiers), puis on le renomme vers le nom final : `rename()` est
 * une opération atomique du système de fichiers, il n'existe aucun état
 * intermédiaire où le fichier final existerait à moitié écrit.
 */
export async function ecrireSauvegardeLocale(nomFichier: string, contenu: Buffer): Promise<string> {
  const dossier = await assurerRepertoire();
  const chemin = path.join(dossier, nomFichier);
  const cheminTemporaire = path.join(dossier, `.tmp-${randomUUID()}-${nomFichier}`);
  try {
    await fs.writeFile(cheminTemporaire, contenu);
    await fs.rename(cheminTemporaire, chemin);
  } catch (e) {
    await fs.unlink(cheminTemporaire).catch(() => {});
    throw e;
  }
  await purgerAnciennes();
  return chemin;
}

/**
 * Ne garde que les RETENTION fichiers les plus récents (tri par nom, qui est
 * horodaté donc trié naturellement — pas besoin de stat() sur chaque fichier).
 */
async function purgerAnciennes(): Promise<void> {
  const dossier = repertoire();
  const tousLesFichiers = await fs.readdir(dossier);

  // Reliquat éventuel d'une écriture atomique interrompue (process tué entre
  // le writeFile et le rename) : jamais un fichier final valide, toujours
  // sans risque à supprimer.
  const tmpOrphelins = tousLesFichiers.filter((f) => f.startsWith(".tmp-"));
  await Promise.all(tmpOrphelins.map((f) => fs.unlink(path.join(dossier, f)).catch(() => {})));

  const fichiers = tousLesFichiers.filter((f) => f.startsWith(PREFIXE) && f.endsWith(SUFFIXE)).sort();
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
