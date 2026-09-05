/**
 * Logique pure du geste de tirage de la ficelle (LampeFicelle.tsx) — voir la
 * note dans components/ui/robustesseMotDePasse.ts sur la séparation logique
 * pure / composant (résolution d'alias `@/` absente du runner Vitest
 * racine). Ce fichier n'importe rien.
 *
 * Le clic et le clavier basculent l'état directement (un vrai <button>
 * gère le clavier nativement, Entrée/Espace déclenchent onClick). Le
 * glissement tactile/souris, lui, doit dépasser un seuil de distance
 * verticale avant de basculer — sans quoi un simple tapotement imprécis
 * déclencherait la lampe de façon erratique.
 */

/** Distance verticale (px) à parcourir vers le bas pour que le glissement compte comme un tirage. */
export const SEUIL_GLISSEMENT_PX = 32;

export interface EtatGlissementFicelle {
  yDepart: number;
}

/** Démarre le suivi d'un glissement à partir de la position Y du pointeur. */
export function demarrerGlissement(y: number): EtatGlissementFicelle {
  return { yDepart: y };
}

/**
 * Le glissement en cours a-t-il dépassé le seuil d'activation ? Un
 * mouvement vers le HAUT (yActuel < yDepart) ne compte jamais, seul un
 * tirage vers le bas — cohérent avec le geste physique d'une ficelle de
 * lampe.
 */
export function glissementDepasseSeuil(
  etat: EtatGlissementFicelle,
  yActuel: number,
  seuilPx: number = SEUIL_GLISSEMENT_PX,
): boolean {
  return yActuel - etat.yDepart >= seuilPx;
}
