import { JWT } from "google-auth-library";

/**
 * Envoi d'un fichier vers Google Drive (section 3.15) avec un COMPTE DE SERVICE
 * Google Cloud — distinct du mot de passe d'application Gmail utilisé par
 * l'envoi de rapports (services/email.ts). Deux mécanismes différents, deux
 * jeux d'identifiants séparés.
 *
 * Variables d'environnement :
 *   GOOGLE_SERVICE_ACCOUNT_JSON  la clé JSON du compte de service, en UNE ligne
 *                                (ou encodée en base64 — les deux sont acceptés)
 *   GOOGLE_DRIVE_FOLDER_ID       identifiant du dossier Drive de destination,
 *                                partagé en écriture avec l'email du compte
 *                                de service
 *
 * À renseigner SÉPARÉMENT en local et sur l'hébergeur : rien ne se propage d'un
 * environnement à l'autre.
 */
export class ErreurDrive extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// `drive.file` suffit : le compte de service ne peut toucher QUE les fichiers
// qu'il a créés (ou qu'on lui a explicitement partagés). On ne demande jamais
// l'accès complet au Drive de la boutique.
const PORTEE = "https://www.googleapis.com/auth/drive.file";

interface CleCompteService {
  client_email: string;
  private_key: string;
}

/**
 * Lit la clé du compte de service. Elle est acceptée en JSON brut ou en base64 :
 * les interfaces d'hébergeurs coupent volontiers les valeurs multilignes, et le
 * base64 évite d'avoir à échapper les sauts de ligne de la clé privée.
 */
function lireCle(): CleCompteService | null {
  const brut = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!brut) return null;
  const texte = brut.startsWith("{") ? brut : Buffer.from(brut, "base64").toString("utf8");
  let cle: Partial<CleCompteService>;
  try {
    cle = JSON.parse(texte);
  } catch {
    throw new ErreurDrive(
      500,
      "GOOGLE_SERVICE_ACCOUNT_JSON n'est pas un JSON valide (ni du base64 de JSON).",
    );
  }
  if (!cle.client_email || !cle.private_key) {
    throw new ErreurDrive(
      500,
      "GOOGLE_SERVICE_ACCOUNT_JSON ne contient pas client_email et private_key : ce n'est pas une clé de compte de service.",
    );
  }
  // Une clé recopiée à la main perd souvent ses retours à la ligne réels.
  return { client_email: cle.client_email, private_key: cle.private_key.replace(/\\n/g, "\n") };
}

/** Le serveur est-il configuré pour l'envoi automatique vers Drive ? */
export function driveConfigure(): boolean {
  return !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() && !!process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
}

/**
 * Email du compte de service — affiché dans État système : c'est l'adresse avec
 * laquelle le dossier Drive doit être partagé, et la première chose à vérifier
 * quand l'envoi échoue en « permission refusée ».
 */
export function emailCompteService(): string | null {
  try {
    return lireCle()?.client_email ?? null;
  } catch {
    return null;
  }
}

/**
 * Envoie un fichier dans le dossier Drive configuré. Upload « multipart » :
 * métadonnées + contenu en une requête, suffisant pour un dump de cette taille
 * (l'upload reprenable ne se justifierait qu'au-delà de plusieurs centaines de Mo).
 */
export async function envoyerVersDrive(params: {
  nomFichier: string;
  contenu: Buffer;
  typeMime?: string;
}): Promise<{ id: string; taille: number }> {
  const { nomFichier, contenu, typeMime = "application/octet-stream" } = params;
  const cle = lireCle();
  const dossier = process.env.GOOGLE_DRIVE_FOLDER_ID?.trim();
  if (!cle || !dossier) {
    throw new ErreurDrive(
      503,
      "L'envoi vers Google Drive n'est pas configuré (GOOGLE_SERVICE_ACCOUNT_JSON et GOOGLE_DRIVE_FOLDER_ID manquants).",
    );
  }

  let jeton: string;
  try {
    const client = new JWT({ email: cle.client_email, key: cle.private_key, scopes: [PORTEE] });
    const { access_token } = await client.authorize();
    if (!access_token) throw new Error("aucun jeton d'accès renvoyé");
    jeton = access_token;
  } catch (e) {
    throw new ErreurDrive(
      502,
      `Authentification Google refusée : ${e instanceof Error ? e.message : "erreur inconnue"}. Vérifie la clé du compte de service et que l'API Drive est activée.`,
    );
  }

  const frontiere = `lomoto-${Date.now().toString(36)}`;
  const metadonnees = JSON.stringify({ name: nomFichier, parents: [dossier] });
  const corps = Buffer.concat([
    Buffer.from(
      `--${frontiere}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadonnees}\r\n` +
        `--${frontiere}\r\nContent-Type: ${typeMime}\r\n\r\n`,
    ),
    contenu,
    Buffer.from(`\r\n--${frontiere}--\r\n`),
  ]);

  // supportsAllDrives : indispensable si le dossier vit dans un Drive partagé
  // Google Workspace plutôt que dans « Mon Drive ».
  const url =
    "https://www.googleapis.com/upload/drive/v3/files" +
    "?uploadType=multipart&supportsAllDrives=true&fields=id,size";

  let reponse: Response;
  try {
    reponse = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jeton}`,
        "Content-Type": `multipart/related; boundary=${frontiere}`,
        "Content-Length": String(corps.length),
      },
      body: new Uint8Array(corps),
    });
  } catch (e) {
    throw new ErreurDrive(502, `Google Drive inaccessible : ${e instanceof Error ? e.message : "erreur réseau"}`);
  }

  if (!reponse.ok) {
    const detail = await reponse.text().catch(() => "");
    // 404 sur un dossier existant = le dossier n'est pas partagé avec le compte
    // de service. C'est l'oubli le plus fréquent, autant le dire directement.
    const indice =
      reponse.status === 404
        ? " Le dossier est introuvable POUR CE COMPTE : partage-le en Éditeur avec l'email du compte de service."
        : "";
    throw new ErreurDrive(
      502,
      `Google Drive a refusé l'envoi (${reponse.status}) : ${detail.slice(0, 400)}.${indice}`,
    );
  }

  const resultat = (await reponse.json()) as { id?: string; size?: string };
  if (!resultat.id) throw new ErreurDrive(502, "Google Drive n'a pas renvoyé d'identifiant de fichier.");
  return { id: resultat.id, taille: Number(resultat.size ?? contenu.length) };
}
