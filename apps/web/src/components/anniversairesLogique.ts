/**
 * Logique pure de regroupement de « Constellation Lomoto » (F3) — voir la
 * note dans components/ui/robustesseMotDePasse.ts sur la séparation logique
 * pure / composant. Ce fichier n'importe rien.
 *
 * Le serveur renvoie déjà les noms groupés en une seule liste pour le jour
 * (`AnniversairesDuJourDTO.noms`, `docs/api-contracts/C3_SERVICES_PREMIUM.md`) ;
 * cette fonction ne fait que composer un texte lisible à partir de cette
 * liste — jamais de regroupement supplémentaire côté client, jamais d'âge ni
 * de date de naissance (absents du DTO lui-même).
 */

/**
 * Joint une liste de noms en une phrase naturelle : "Alain" (1),
 * "Alain et Zoé" (2), "Alain, Zoé et Marie" (3+). `conjonction` est fournie
 * par l'appelant (déjà traduite) — cette fonction ne connaît aucune langue.
 */
export function formaterListeNoms(noms: readonly string[], conjonction: string): string {
  if (noms.length === 0) return "";
  if (noms.length === 1) return noms[0];
  const tous = [...noms];
  const dernier = tous.pop()!;
  return `${tous.join(", ")} ${conjonction} ${dernier}`;
}
