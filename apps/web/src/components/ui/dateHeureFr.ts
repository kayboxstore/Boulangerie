/**
 * Logique pure de formatage/validation date-heure — voir la note dans
 * robustesseMotDePasse.ts sur la séparation logique pure / composant.
 *
 * Volontairement minimal et sans dépendance (aucune bibliothèque de date
 * n'est installée dans apps/web — voir le rapport final F1). Ne traite
 * QUE l'affichage/la combinaison de chaînes ; aucune conversion de fuseau
 * horaire n'est effectuée ici : la centralisation d'Africa/Kinshasa reste
 * un chantier serveur explicitement attribué à Codex (ETAT_REEL_MAIN_A7FM5X.md §5).
 */

const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_HEURE = /^\d{2}:\d{2}$/;

export function estDateValide(valeur: string): boolean {
  if (!RE_DATE.test(valeur)) return false;
  const [annee, mois, jour] = valeur.split("-").map(Number);
  const date = new Date(annee, mois - 1, jour);
  return date.getFullYear() === annee && date.getMonth() === mois - 1 && date.getDate() === jour;
}

export function estHeureValide(valeur: string): boolean {
  if (!RE_HEURE.test(valeur)) return false;
  const [heure, minute] = valeur.split(":").map(Number);
  return heure >= 0 && heure <= 23 && minute >= 0 && minute <= 59;
}

/**
 * Formate une date "YYYY-MM-DD" en français long ("13 août 2026").
 * Construit la date à partir des composants (année, mois, jour) plutôt que
 * `new Date(iso)` : ce dernier interprète une date seule comme UTC minuit,
 * ce qui peut afficher la veille ou le lendemain selon le fuseau local —
 * piège déjà rencontré ailleurs dans ce projet (mélanges UTC/heure locale,
 * voir ETAT_REEL_MAIN_A7FM5X.md §5).
 */
export function formaterDateFr(valeur: string): string {
  if (!estDateValide(valeur)) return "";
  const [annee, mois, jour] = valeur.split("-").map(Number);
  const date = new Date(annee, mois - 1, jour);
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

/** Formate une heure "HH:MM" à la française ("14 h 30", "09 h 00"). */
export function formaterHeureFr(valeur: string): string {
  if (!estHeureValide(valeur)) return "";
  const [heure, minute] = valeur.split(":");
  return `${heure} h ${minute}`;
}

/**
 * Combine une date et une heure natives en une chaîne "YYYY-MM-DDTHH:MM".
 * Renvoie `null` si l'une des deux valeurs est absente ou invalide, plutôt
 * que de produire une chaîne partiellement fausse.
 */
export function combinerDateHeureISO(dateValeur: string, heureValeur: string): string | null {
  if (!estDateValide(dateValeur) || !estHeureValide(heureValeur)) return null;
  return `${dateValeur}T${heureValeur}`;
}
