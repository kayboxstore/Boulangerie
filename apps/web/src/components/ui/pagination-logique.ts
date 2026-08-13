/**
 * Logique pure de pagination — voir la note dans robustesseMotDePasse.ts sur
 * la séparation logique pure / composant.
 *
 * Volontairement agnostique client/serveur : ce composant ne fait AUCUN appel
 * réseau lui-même (aucune règle métier, conforme à F1 tâche 8). La pagination
 * serveur elle-même reste un chantier ultérieur (audit UX-18) ; ce module se
 * contente de calculer un état d'affichage cohérent à partir de trois
 * nombres, que la page/l'écran l'obtienne d'une liste chargée entièrement ou
 * d'une réponse API déjà paginée.
 */

export interface EtatPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Index (1-based) du premier élément affiché, 0 si `total` est nul. */
  premierIndex: number;
  /** Index (1-based) du dernier élément affiché, 0 si `total` est nul. */
  dernierIndex: number;
  aPrecedente: boolean;
  aSuivante: boolean;
}

/** Calcule un état de pagination cohérent, en bornant page/pageSize à des valeurs valides. */
export function calculerPagination(page: number, pageSize: number, total: number): EtatPagination {
  const tailleBornee = Math.max(1, Math.floor(pageSize) || 1);
  const totalBorne = Math.max(0, Math.floor(total) || 0);
  const totalPages = Math.max(1, Math.ceil(totalBorne / tailleBornee));
  const pageBornee = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);

  const premierIndex = totalBorne === 0 ? 0 : (pageBornee - 1) * tailleBornee + 1;
  const dernierIndex = totalBorne === 0 ? 0 : Math.min(pageBornee * tailleBornee, totalBorne);

  return {
    page: pageBornee,
    pageSize: tailleBornee,
    total: totalBorne,
    totalPages,
    premierIndex,
    dernierIndex,
    aPrecedente: pageBornee > 1,
    aSuivante: pageBornee < totalPages,
  };
}

/**
 * Borne une page demandée à l'intervalle [1, totalPages] calculé à partir de
 * `taillePage`/`total` — dérivé, sans état. Utilisé par PremiumTable pour ne
 * jamais afficher une page vide après une réduction des données ou de
 * `taillePage` (correction revue Codex : l'ancienne version ne recalculait
 * la page affichée que sur changement de recherche/tri, jamais sur une
 * simple baisse du nombre d'éléments).
 */
export function bornerPage(page: number, taillePage: number, total: number): number {
  const tailleBornee = Math.max(1, Math.floor(taillePage) || 1);
  const totalPages = Math.max(1, Math.ceil(Math.max(0, total) / tailleBornee));
  return Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
}

export type ElementNumeroPage = number | "…";

/**
 * Génère une liste compacte de numéros de page à afficher (première, dernière,
 * page courante ± `delta`, avec des marqueurs "…" pour les trous) — évite
 * d'afficher 200 boutons de page sur une longue liste.
 */
export function genererNumerosPages(pageActuelle: number, totalPages: number, delta = 1): ElementNumeroPage[] {
  if (totalPages <= 1) return [1];

  const pages = new Set<number>([1, totalPages]);
  for (let p = pageActuelle - delta; p <= pageActuelle + delta; p++) {
    if (p >= 1 && p <= totalPages) pages.add(p);
  }

  const triees = Array.from(pages).sort((a, b) => a - b);
  const resultat: ElementNumeroPage[] = [];
  let precedent = 0;
  for (const p of triees) {
    if (precedent && p - precedent > 1) resultat.push("…");
    resultat.push(p);
    precedent = p;
  }
  return resultat;
}
