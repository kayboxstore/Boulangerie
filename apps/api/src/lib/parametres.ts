import { prisma } from "./prisma.js";

/** Lit une valeur du magasin clé/valeur ParametreBoutique (ou `defaut`). */
export async function lireParametre(cle: string, defaut = ""): Promise<string> {
  const parametre = await prisma.parametreBoutique.findUnique({ where: { cle } });
  return parametre?.valeur ?? defaut;
}

/** Écrit (upsert) une valeur dans le magasin clé/valeur ParametreBoutique. */
export async function ecrireParametre(cle: string, valeur: string): Promise<void> {
  await prisma.parametreBoutique.upsert({
    where: { cle },
    update: { valeur },
    create: { cle, valeur },
  });
}
