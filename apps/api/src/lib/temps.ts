import { estDateISOValide } from "@lomoto/shared";

/** Fuseau opérationnel unique de la Boulangerie Lomoto. */
export const FUSEAU_LOMOTO = "Africa/Kinshasa" as const;

// Kinshasa reste à UTC+1 toute l'année (aucun changement saisonnier).
const DECALAGE_KINSHASA_MS = 60 * 60 * 1000;
const UN_JOUR_MS = 24 * 60 * 60 * 1000;

const formateurJour = new Intl.DateTimeFormat("fr-CA", {
  timeZone: FUSEAU_LOMOTO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Jour civil AAAA-MM-JJ tel qu'il est vécu à Kinshasa. */
export function jourLomoto(instant: Date = new Date()): string {
  const parties = formateurJour.formatToParts(instant);
  const valeur = (type: Intl.DateTimeFormatPartTypes) =>
    parties.find((partie) => partie.type === type)?.value;
  return `${valeur("year")}-${valeur("month")}-${valeur("day")}`;
}

/** Bornes UTC exactes d'un jour civil de Kinshasa, inclusives. */
export function bornesJourLomoto(jour: string = jourLomoto()): [Date, Date] {
  if (!estDateISOValide(jour)) throw new RangeError("Date Lomoto invalide");
  const [annee, mois, date] = jour.split("-").map(Number);
  const debutMs = Date.UTC(annee, mois - 1, date) - DECALAGE_KINSHASA_MS;
  return [new Date(debutMs), new Date(debutMs + UN_JOUR_MS - 1)];
}

/** Valeur stable pour les colonnes PostgreSQL @db.Date. */
export function dateSQLDepuisJourLomoto(jour: string): Date {
  if (!estDateISOValide(jour)) throw new RangeError("Date Lomoto invalide");
  return new Date(`${jour}T00:00:00.000Z`);
}
