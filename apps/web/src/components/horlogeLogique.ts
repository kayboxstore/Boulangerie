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

/** Libellé accessible complet ("14 h 32 min 05 s"), pour aria-label — jamais déduit du seul texte affiché (qui peut être tronqué visuellement). */
export function libelleAccessibleHeure(heure: HeureAffichee): string {
  return `${heure.heures} h ${heure.minutes} min ${heure.secondes} s`;
}
