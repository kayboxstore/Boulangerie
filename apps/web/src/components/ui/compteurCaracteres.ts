/**
 * Logique pure du compteur de caractères d'AutoTextarea — voir la note dans
 * robustesseMotDePasse.ts sur la séparation logique pure / composant, motivée
 * par la résolution d'alias `@/` absente du runner Vitest racine.
 */
export interface EtatCompteurCaracteres {
  longueur: number;
  limite: number | undefined;
  /** true à partir de 90 % de la limite — sert à avertir avant le blocage. */
  procheLimite: boolean;
  depasse: boolean;
}

const SEUIL_AVERTISSEMENT = 0.9;

export function evaluerCompteurCaracteres(longueur: number, limite?: number): EtatCompteurCaracteres {
  if (limite === undefined || limite <= 0) {
    return { longueur, limite: undefined, procheLimite: false, depasse: false };
  }
  return {
    longueur,
    limite,
    procheLimite: longueur >= limite * SEUIL_AVERTISSEMENT,
    depasse: longueur > limite,
  };
}
