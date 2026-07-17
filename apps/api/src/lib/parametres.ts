import { CLE_SEUIL_ALERTE_TRANSACTION } from "@lomoto/shared";
import { prisma } from "./prisma.js";

const SEUIL_PAR_DEFAUT = 100_000; // Fc — valeur par défaut de la spec (3.10)

/**
 * Seuil (Fc) au-delà duquel une transaction déclenche l'alerte dédiée au DG.
 * Lu en base (ParametreBoutique) pour rester modifiable par l'Admin ;
 * retombe sur la valeur par défaut si le paramètre est absent ou invalide.
 */
export async function seuilAlerteTransaction(): Promise<number> {
  const parametre = await prisma.parametreBoutique.findUnique({
    where: { cle: CLE_SEUIL_ALERTE_TRANSACTION },
  });
  const valeur = Number(parametre?.valeur);
  return Number.isFinite(valeur) && valeur > 0 ? valeur : SEUIL_PAR_DEFAUT;
}
