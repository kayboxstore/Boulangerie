/**
 * Idempotence client pour les écritures sensibles (F5B, CONFIRMER_ACCEPTATION
 * — la seule action du cycle C4 qui exige l'en-tête `Idempotency-Key`, voir
 * contrat C4 §7 et `apps/api/src/lib/idempotence.ts`). Logique pure, sans
 * accès réseau ni composant : une nouvelle opération reçoit toujours une
 * clé neuve ; un rejeu STRICTEMENT identique (même empreinte) réutilise la
 * même clé ; une empreinte différente ne réutilise jamais l'ancienne clé —
 * le serveur rejetterait sinon avec `CLE_IDEMPOTENCE_REUTILISEE` (409), et
 * réutiliser une clé avec un corps différent romprait la garantie même
 * d'idempotence (deux opérations distinctes confondues sous un seul id).
 */

export interface EtatIdempotence {
  cle: string;
  empreinte: string;
}

/** Identifiant conforme au format serveur (8 à 128 caractères alphanumériques ou . _ : -). */
export function genererCleIdempotence(): string {
  return crypto.randomUUID();
}

/**
 * Décide la clé à envoyer pour cette soumission, à partir de la tentative
 * précédente (le cas échéant) et de l'empreinte du corps sur le point d'être
 * envoyé. `empreinte` doit être une sérialisation stable du corps exact
 * (mêmes valeurs ⇒ même chaîne) — à la charge de l'appelant.
 */
export function resoudreCleIdempotence(precedent: EtatIdempotence | null, empreinte: string): EtatIdempotence {
  if (precedent && precedent.empreinte === empreinte) return precedent;
  return { cle: genererCleIdempotence(), empreinte };
}
