/**
 * Logique pure de date dans le fuseau opérationnel Africa/Kinshasa — même
 * principe que `components/horlogeLogique.ts` (`decomposerHeureKinshasa`),
 * appliqué ici à la journée calendaire plutôt qu'à l'heure. N'importe rien :
 * utilisable tel quel depuis n'importe quelle page.
 *
 * Corrige (F4 round 2, revue Codex) : les dates par défaut de Production.tsx
 * et BonsLivraison.tsx (`jourISO`/`demain`) utilisaient `toISOString()`, qui
 * calcule en UTC — au fuseau de Kinshasa (UTC+1, sans heure d'été), une
 * bascule de date peut donc arriver plusieurs heures trop tôt ou trop tard
 * selon le fuseau du navigateur. `Intl.DateTimeFormat` avec
 * `timeZone: "Africa/Kinshasa"` donne la bonne journée calendaire quel que
 * soit le fuseau du navigateur ou du serveur qui exécute le code.
 */

export const FUSEAU_KINSHASA = "Africa/Kinshasa";

const UNE_JOURNEE_MS = 24 * 60 * 60 * 1000;

/** Date "YYYY-MM-DD" correspondant à `date`, dans le fuseau Africa/Kinshasa. */
export function dateISOKinshasa(date: Date): string {
  const formateur = new Intl.DateTimeFormat("fr-FR", {
    timeZone: FUSEAU_KINSHASA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parties = formateur.formatToParts(date);
  const valeur = (type: string) => parties.find((p) => p.type === type)?.value ?? "00";
  return `${valeur("year")}-${valeur("month")}-${valeur("day")}`;
}

/**
 * Date "YYYY-MM-DD" du lendemain (J+1) de `date`, dans le fuseau Africa/
 * Kinshasa. Kinshasa n'observe pas l'heure d'été : ajouter exactement 24 h
 * en millisecondes avance donc toujours d'une seule journée calendaire
 * complète, sans jamais sauter ou répéter un jour.
 */
export function dateISOKinshasaLendemain(date: Date): string {
  return dateISOKinshasa(new Date(date.getTime() + UNE_JOURNEE_MS));
}
