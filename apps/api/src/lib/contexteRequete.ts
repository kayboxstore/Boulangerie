import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Contexte de la requête courante, propagé de façon transparente à travers les
 * `await` (AsyncLocalStorage). Il permet à l'extension d'audit (lib/audit.ts) de
 * connaître l'auteur d'une écriture Prisma SANS que chaque contrôleur ait à
 * transmettre l'utilisateur manuellement — le journal d'audit reste ainsi
 * centralisé (section 3.17).
 */
export interface ActeurRequete {
  id: string;
  nom: string;
}

export const contexteRequete = new AsyncLocalStorage<ActeurRequete>();
