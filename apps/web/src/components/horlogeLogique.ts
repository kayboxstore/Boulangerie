/**
 * Logique pure de l'horloge « flip » compacte (HorlogeFlip.tsx) — voir la
 * note dans components/ui/robustesseMotDePasse.ts sur la séparation logique
 * pure / composant. Ce fichier n'importe rien.
 */

export const FUSEAU_HORLOGE = "Africa/Kinshasa";

export interface HeureAffichee {
  heures: string;
  minutes: string;
  secondes: string;
}

/**
 * Décompose une date en heures/minutes/secondes à deux chiffres, dans le
 * fuseau opérationnel Africa/Kinshasa — toujours ce fuseau, quel que soit
 * celui du navigateur ou du serveur qui exécute le code.
 */
export function decomposerHeureKinshasa(date: Date): HeureAffichee {
  const formateur = new Intl.DateTimeFormat("fr-FR", {
    timeZone: FUSEAU_HORLOGE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parties = formateur.formatToParts(date);
  const valeur = (type: string) => parties.find((p) => p.type === type)?.value ?? "00";
  return {
    heures: valeur("hour"),
    minutes: valeur("minute"),
    secondes: valeur("second"),
  };
}

/**
 * Valeur de l'attribut `dateTime` de l'élément `<time>` — format de temps
 * valide au sens HTML (« hh:mm:ss »), toujours dérivé des mêmes valeurs à
 * deux chiffres que l'affichage, jamais recalculé séparément.
 */
export function dateTimeAttribut(heure: HeureAffichee): string {
  return `${heure.heures}:${heure.minutes}:${heure.secondes}`;
}
