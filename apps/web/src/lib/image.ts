/**
 * Redimensionne une image choisie par l'utilisateur en un petit avatar carré
 * (photo de profil, V2) avant de l'envoyer au serveur — évite d'envoyer et de
 * stocker en base la photo originale (souvent plusieurs Mo) alors qu'une
 * poignée de dizaines de Ko suffit pour un avatar affiché en petit format.
 */
const TAILLE_AVATAR = 256;

export function redimensionnerImageAvatar(fichier: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lecteur = new FileReader();
    lecteur.onerror = () => reject(new Error("Impossible de lire le fichier"));
    lecteur.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Fichier image invalide"));
      image.onload = () => {
        // Recadrage carré centré (cover), puis mise à l'échelle vers TAILLE_AVATAR.
        const cote = Math.min(image.width, image.height);
        const sx = (image.width - cote) / 2;
        const sy = (image.height - cote) / 2;

        const canvas = document.createElement("canvas");
        canvas.width = TAILLE_AVATAR;
        canvas.height = TAILLE_AVATAR;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Redimensionnement indisponible"));
        ctx.drawImage(image, sx, sy, cote, cote, 0, 0, TAILLE_AVATAR, TAILLE_AVATAR);

        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      image.src = lecteur.result as string;
    };
    lecteur.readAsDataURL(fichier);
  });
}
