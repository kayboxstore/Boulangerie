import { estDateISOValide } from "@lomoto/shared";

export interface TravailleurAvecNaissance {
  nom: string;
  dateNaissance: Date | null;
}

export function estAnniversaireLe(dateNaissance: Date, jour: string): boolean {
  if (!estDateISOValide(jour)) throw new RangeError("Jour d'anniversaire invalide");
  const [, mois, date] = jour.split("-").map(Number);
  return dateNaissance.getUTCMonth() + 1 === mois && dateNaissance.getUTCDate() === date;
}

/** Ne renvoie volontairement que les noms : aucun identifiant, date ni âge. */
export function nomsAnniversairesDuJour(
  travailleurs: TravailleurAvecNaissance[],
  jour: string,
): string[] {
  if (!estDateISOValide(jour)) throw new RangeError("Jour d'anniversaire invalide");
  return travailleurs
    .filter((t): t is { nom: string; dateNaissance: Date } => !!t.dateNaissance)
    .filter((t) => estAnniversaireLe(t.dateNaissance, jour))
    .map((t) => t.nom)
    .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
}
