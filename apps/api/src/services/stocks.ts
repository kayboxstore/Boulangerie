import type { MatierePremiere } from "@prisma/client";
import { formatQuantite, type TypeMouvementStock } from "@lomoto/shared";
import { busEvenements } from "../lib/events.js";
import type { TxClient } from "../lib/prisma.js";

/** Erreur métier renvoyée au client avec un statut HTTP dédié. */
export class ErreurStock extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ResultatMouvement {
  matiere: MatierePremiere;
  /** true si CE mouvement fait passer le stock au-dessus/en-dessous du seuil. */
  franchitSeuil: boolean;
}

/**
 * Applique un mouvement de stock DANS une transaction Prisma : crée la ligne
 * de journal (append-only) et met à jour la quantité de la matière première.
 * Une sortie ne peut pas rendre le stock négatif. Signale si le mouvement
 * fait passer le stock sous le seuil d'alerte (détection du franchissement,
 * pas de l'état : une matière déjà sous le seuil ne ré-alerte pas).
 */
export async function appliquerMouvement(
  tx: TxClient,
  params: {
    matierePremiereId: string;
    type: TypeMouvementStock;
    quantite: number;
    reference?: string;
    productionId?: string;
    commandeFournisseurId?: string;
    auteurId: string;
  },
): Promise<ResultatMouvement> {
  const matiere = await tx.matierePremiere.findUnique({ where: { id: params.matierePremiereId } });
  if (!matiere) throw new ErreurStock(404, "Matière première introuvable");

  const avant = matiere.quantiteStock.toNumber();
  const seuil = matiere.seuilAlerte.toNumber();

  if (params.type === "SORTIE" && params.quantite > avant) {
    throw new ErreurStock(
      400,
      `Stock insuffisant de ${matiere.nom} : reste ${formatQuantite(avant, matiere.unite)}, sortie demandée ${formatQuantite(params.quantite, matiere.unite)}`,
    );
  }

  await tx.mouvementStock.create({
    data: {
      matierePremiereId: matiere.id,
      type: params.type,
      quantite: params.quantite,
      reference: params.reference ?? null,
      productionId: params.productionId ?? null,
      commandeFournisseurId: params.commandeFournisseurId ?? null,
      auteurId: params.auteurId,
    },
  });
  const maj = await tx.matierePremiere.update({
    where: { id: matiere.id },
    data: {
      quantiteStock:
        params.type === "ENTREE" ? { increment: params.quantite } : { decrement: params.quantite },
    },
  });

  const apres = maj.quantiteStock.toNumber();
  return { matiere: maj, franchitSeuil: avant >= seuil && apres < seuil };
}

/**
 * Alerte seuil critique (section 3.2, scénario « Alerte stock ») : priorité
 * haute, module STOCKS. Les destinataires sortent de la matrice (DG en lecture
 * partout + Responsable Stock/Achats et Fournisseurs en écriture) ; l'émetteur
 * est exclu par le NotificationService — quand le Responsable Stock émet
 * lui-même le mouvement, seul le DG est donc alerté.
 */
export function emettreAlerteSeuil(matiere: MatierePremiere, emetteurId: string) {
  const stock = matiere.quantiteStock.toNumber();
  const seuil = matiere.seuilAlerte.toNumber();
  busEvenements.emettreEvenement({
    type: "ALERTE_STOCK",
    module: "STOCKS",
    emetteurId,
    evenementRef: matiere.id,
    priorite: "HAUTE",
    message: `⚠ Stock critique : ${matiere.nom} à ${formatQuantite(stock, matiere.unite)}, sous le seuil de ${formatQuantite(seuil, matiere.unite)} — commande fournisseur à anticiper`,
    donnees: { matierePremiereId: matiere.id, nom: matiere.nom, quantiteStock: stock, seuilAlerte: seuil },
  });
}
