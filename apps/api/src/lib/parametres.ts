import { prisma } from "./prisma.js";

/** Lit une valeur du magasin clé/valeur ParametreBoutique (ou `defaut`). */
export async function lireParametre(cle: string, defaut = ""): Promise<string> {
  const parametre = await prisma.parametreBoutique.findUnique({ where: { cle } });
  return parametre?.valeur ?? defaut;
}

/**
 * Écrit une valeur dans le magasin clé/valeur ParametreBoutique — create/update
 * explicites plutôt qu'un upsert : l'extension d'audit centrale (lib/audit.ts)
 * n'intercepte que les opérations `update`/`delete`, pas `upsert`. Un upsert
 * silencieux ferait disparaître toute trace de modification au Journal d'audit
 * (section 3.17) dès la deuxième écriture sur une même clé.
 */
export async function ecrireParametre(cle: string, valeur: string): Promise<void> {
  const existant = await prisma.parametreBoutique.findUnique({ where: { cle } });
  if (existant) {
    await prisma.parametreBoutique.update({ where: { cle }, data: { valeur } });
  } else {
    await prisma.parametreBoutique.create({ data: { cle, valeur } });
  }
}
