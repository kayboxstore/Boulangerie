/**
 * Logique pure de recherche/tri pour PremiumTable — voir la note dans
 * apps/web/src/components/ui/robustesseMotDePasse.ts sur la séparation
 * logique pure / composant (résolution d'alias `@/` absente du runner
 * Vitest racine).
 */

/**
 * Filtre une liste selon une requête texte, en la comparant (insensible à la
 * casse) aux valeurs renvoyées par `champs` pour chaque élément. Une requête
 * vide renvoie la liste complète, inchangée.
 */
export function filtrerParRecherche<T>(
  items: readonly T[],
  champs: (item: T) => Array<string | number | null | undefined>,
  requete: string,
): T[] {
  const q = requete.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((item) =>
    champs(item).some((valeur) => valeur !== null && valeur !== undefined && String(valeur).toLowerCase().includes(q)),
  );
}

export type SensTri = "asc" | "desc";

/** Trie une liste avec un comparateur donné ; sans comparateur, renvoie la liste inchangée (aucun tri implicite). */
export function trierPar<T>(items: readonly T[], comparateur: ((a: T, b: T) => number) | undefined, sens: SensTri): T[] {
  if (!comparateur) return [...items];
  const copie = [...items].sort(comparateur);
  return sens === "desc" ? copie.reverse() : copie;
}
