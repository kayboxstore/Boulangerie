/**
 * Idempotence client pour les écritures sensibles — d'abord réservée à
 * CONFIRMER_ACCEPTATION (F5B, cycle C4, voir contrat C4 §7 et
 * `apps/api/src/lib/idempotence.ts`), généralisée aux autres écritures
 * financières qui utilisent déjà `executerEcritureIdempotente` côté serveur
 * (création de commande, règlement, dépenses de caisse, ouverture de
 * session, remise, confirmation de règlements — audit du 19/08/2026). Une
 * nouvelle opération reçoit toujours une clé neuve ; un rejeu STRICTEMENT
 * identique (même empreinte) réutilise la même clé ; une empreinte
 * différente ne réutilise jamais l'ancienne clé — le serveur rejetterait
 * sinon avec `CLE_IDEMPOTENCE_REUTILISEE` (409), et réutiliser une clé avec
 * un corps différent romprait la garantie même d'idempotence (deux
 * opérations distinctes confondues sous un seul id).
 */
import { useRef } from "react";

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

/**
 * Enveloppe React de `resoudreCleIdempotence` : porte la tentative précédente
 * d'un composant sans dupliquer le `useRef`/`resoudreCleIdempotence` dans
 * chaque mutation financière. Utilisation : appeler la fonction retournée
 * avec l'empreinte JSON du corps juste avant l'appel réseau, et envoyer le
 * résultat comme en-tête `Idempotency-Key`.
 */
export function useCleIdempotence(): (empreinte: string) => string {
  const precedent = useRef<EtatIdempotence | null>(null);
  return (empreinte: string) => {
    const resolue = resoudreCleIdempotence(precedent.current, empreinte);
    precedent.current = resolue;
    return resolue.cle;
  };
}
