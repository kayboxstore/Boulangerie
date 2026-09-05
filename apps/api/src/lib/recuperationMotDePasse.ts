import { createHash, randomBytes } from "node:crypto";

export const DUREE_JETON_REINITIALISATION_MS = 30 * 60 * 1000;
export const DELAI_ENTRE_DEMANDES_MS = 2 * 60 * 1000;

export function hacherJetonReinitialisation(jeton: string): string {
  return createHash("sha256").update(jeton, "utf8").digest("hex");
}

export function genererJetonReinitialisation(): string {
  return randomBytes(32).toString("base64url");
}

export function expirationJetonReinitialisation(maintenant: Date = new Date()): Date {
  return new Date(maintenant.getTime() + DUREE_JETON_REINITIALISATION_MS);
}

export function jetonReinitialisationUtilisable(
  jeton: { expireLe: Date; utiliseLe: Date | null } | null,
  maintenant: Date = new Date(),
): boolean {
  return !!jeton && jeton.utiliseLe === null && jeton.expireLe.getTime() > maintenant.getTime();
}

/** Mot de passe transmis une seule fois à l'Admin, avec les 4 familles de caractères. */
export function genererMotDePasseTemporaire(): string {
  return `Lm9!${randomBytes(12).toString("base64url")}`;
}
