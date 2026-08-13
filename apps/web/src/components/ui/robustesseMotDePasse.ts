/**
 * Logique pure, séparée de password-field.tsx exprès : ce fichier n'importe
 * rien via l'alias `@/` (uniquement des imports relatifs/aucun), ce qui lui
 * permet d'être testé par le runner Vitest racine — celui-ci n'a pas la
 * résolution d'alias configurée pour apps/web (propre à apps/web/vite.config.ts,
 * hors zone de fichiers F1). Voir le rapport final F1 pour le détail de cette
 * contrainte.
 */

export type CleRobustesse = "tresFaible" | "faible" | "moyen" | "bon" | "fort";

export interface RobustesseMotDePasse {
  score: 0 | 1 | 2 | 3 | 4;
  cle: CleRobustesse;
}

const CLES_PAR_SCORE: Record<0 | 1 | 2 | 3 | 4, CleRobustesse> = {
  0: "tresFaible",
  1: "faible",
  2: "moyen",
  3: "bon",
  4: "fort",
};

/**
 * Évalue la robustesse d'un mot de passe sur une échelle 0-4. Fonction pure —
 * aucune règle serveur : un mot de passe "fort" ici n'est qu'une indication
 * visuelle, la validation réelle reste entièrement du ressort de l'API
 * (cohérent avec le reste du projet, où Zod côté client n'est jamais la
 * source de vérité — voir Volume 15 du livre technique).
 */
export function evaluerRobustesseMotDePasse(motDePasse: string): RobustesseMotDePasse {
  if (motDePasse.length < 8) return { score: 0, cle: CLES_PAR_SCORE[0] };

  let score = 1; // longueur minimale atteinte
  if (motDePasse.length >= 12) score++;
  if (/[a-z]/.test(motDePasse) && /[A-Z]/.test(motDePasse)) score++;
  if (/\d/.test(motDePasse) && /[^A-Za-z0-9]/.test(motDePasse)) score++;

  const borne = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  return { score: borne, cle: CLES_PAR_SCORE[borne] };
}
