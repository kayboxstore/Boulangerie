/**
 * Logging structuré minimal (une ligne JSON par entrée : horodatage, niveau,
 * message, contexte) — remplace les `console.log`/`console.error` épars,
 * sans niveau ni format exploitable, qui existaient jusqu'ici. Volontairement
 * sans dépendance externe (winston/pino) : le volume de ce projet ne le
 * justifie pas, une fonction simple suffit.
 */

type Niveau = "info" | "warn" | "error";

/** Sérialise une Error avec son message et sa pile — sinon JSON.stringify ne renvoie que `{}`. */
function remplacantErreur(_cle: string, valeur: unknown) {
  if (valeur instanceof Error) {
    return { nom: valeur.name, message: valeur.message, pile: valeur.stack };
  }
  return valeur;
}

function ecrire(niveau: Niveau, message: string, contexte?: Record<string, unknown>) {
  const entree = {
    horodatage: new Date().toISOString(),
    niveau,
    message,
    ...(contexte ? { contexte } : {}),
  };
  const ligne = JSON.stringify(entree, remplacantErreur);
  if (niveau === "error") console.error(ligne);
  else console.log(ligne);
}

export const logger = {
  info: (message: string, contexte?: Record<string, unknown>) => ecrire("info", message, contexte),
  warn: (message: string, contexte?: Record<string, unknown>) => ecrire("warn", message, contexte),
  error: (message: string, contexte?: Record<string, unknown>) => ecrire("error", message, contexte),
};
