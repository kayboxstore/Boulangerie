import {
  CLE_SEUIL_ALERTE_TRANSACTION,
  SEUIL_ALERTE_TRANSACTION_DEFAUT,
} from "@lomoto/shared";
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

/**
 * Seuil (Fc) au-delà duquel une transaction déclenche l'alerte dédiée au DG.
 * Lu en base à chaque appel — un changement dans les Paramètres est donc pris
 * en compte dès la vente/le règlement suivant. Retombe sur la valeur par
 * défaut si le paramètre est absent ou invalide.
 */
export async function seuilAlerteTransaction(): Promise<number> {
  const valeur = Number(await lireParametre(CLE_SEUIL_ALERTE_TRANSACTION));
  return Number.isFinite(valeur) && valeur > 0 ? valeur : SEUIL_ALERTE_TRANSACTION_DEFAUT;
}
