import type { MatierePremiere } from "@prisma/client";
import { formatQuantite, type TypeMouvementStock } from "@lomoto/shared";
import { busEvenements } from "../lib/events.js";
import { prisma } from "../lib/prisma.js";
import type { TxClient } from "../lib/prisma.js";
import { auditerCaisseTx } from "./caisseAtomique.js";

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
 * Une sortie ne peut pas rendre le stock négatif. Signale si CE mouvement
 * fait franchir le seuil d'alerte vers le bas (détection du franchissement,
 * pas de l'état : une matière déjà sous le seuil ne ré-alerte pas), via un
 * compare-and-set sur `alerteSeuilEnvoyeeLe` partagé avec la vérification
 * paresseuse `verifierAlertesSeuilStock` — les deux chemins ne peuvent donc
 * jamais émettre deux fois la même alerte.
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
  // Verrou de ligne avant la lecture : le contrôle de stock, le mouvement, la
  // quantité finale et l'AuditLog reposent tous sur le même état sérialisé.
  const ids = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "MatierePremiere" WHERE id = ${params.matierePremiereId} FOR UPDATE
  `;
  if (!ids[0]) throw new ErreurStock(404, "Matière première introuvable");
  const matiere = await tx.matierePremiere.findUniqueOrThrow({ where: { id: ids[0].id } });

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
  const apresPrevu = params.type === "ENTREE" ? avant + params.quantite : avant - params.quantite;
  const modification = await tx.matierePremiere.updateMany({
    where: { id: matiere.id },
    data: {
      quantiteStock:
        params.type === "ENTREE" ? { increment: params.quantite } : { decrement: params.quantite },
      // Retour au-dessus du seuil : le prochain passage en dessous doit pouvoir
      // ré-alerter, donc on efface la marque de l'alerte précédente.
      ...(apresPrevu >= seuil ? { alerteSeuilEnvoyeeLe: null } : {}),
    },
  });
  if (modification.count !== 1) throw new ErreurStock(409, "Le stock vient d’être modifié — réessayez");

  const vientDeFranchir = avant >= seuil && apresPrevu < seuil;
  let franchitSeuil = false;
  if (vientDeFranchir) {
    // Compare-and-set : si une alerte a déjà été émise pour ce passage sous le
    // seuil (ex. par la vérification paresseuse), ne pas la redoubler.
    const { count } = await tx.matierePremiere.updateMany({
      where: { id: matiere.id, alerteSeuilEnvoyeeLe: null },
      data: { alerteSeuilEnvoyeeLe: new Date() },
    });
    franchitSeuil = count === 1;
  }

  const maj = await tx.matierePremiere.findUniqueOrThrow({ where: { id: matiere.id } });
  await auditerCaisseTx(tx, {
    module: "STOCKS",
    typeEntite: "MatierePremiere",
    entiteId: matiere.id,
    action: "MODIFICATION",
    avant: { ...matiere },
    apres: { ...maj },
  });
  return { matiere: maj, franchitSeuil };
}

/**
 * Alerte seuil critique (section 3.2, scénario « Alerte stock ») : priorité
 * haute, module STOCKS. Les destinataires sortent de la matrice (DG en lecture
 * partout + Responsable Stock/Achats et Fournisseurs en écriture) ; l'émetteur
 * est exclu par le NotificationService — quand le Responsable Stock émet
 * lui-même le mouvement, seul le DG est donc alerté.
 */
export function emettreAlerteSeuil(matiere: MatierePremiere, emetteurId: string | null) {
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

/**
 * Vérification PARESSEUSE du seuil d'alerte (section 3.2, Lot 7 pt 2) — même
 * principe que `verifierAlertesDette` (routes/commandes.ts) et
 * `verifierAlertesAbsenceEnAttente` (routes/travailleurs.ts) : pas de tâche
 * planifiée obligatoire, `alerteSeuilEnvoyeeLe: null` sert de compare-and-set
 * atomique.
 *
 * Ferme un trou que `appliquerMouvement` ne peut pas voir : relever le seuil
 * d'une matière (`PUT /matieres/:id`) peut la faire passer sous le seuil SANS
 * aucun mouvement de stock, donc sans franchissement à détecter. Cette
 * fonction relit l'état réel (stock vs seuil) et rattrape ce cas — comme le
 * scan complet porte sur une poignée de matières premières, il n'y a pas
 * besoin d'un filtre SQL sur deux colonnes Decimal.
 *
 * Réinitialise aussi `alerteSeuilEnvoyeeLe` pour toute matière repassée
 * au-dessus du seuil sans passer par `appliquerMouvement` (seuil abaissé),
 * pour qu'un futur passage sous le seuil puisse ré-alerter.
 *
 * Appelée à la fois au chargement de l'écran Stocks, juste après une
 * modification de seuil, et par le balayage périodique
 * (`services/planificateurAlertes.ts`) pour ne pas dépendre d'un accès écran.
 */
export async function verifierAlertesSeuilStock(): Promise<void> {
  const matieres = await prisma.matierePremiere.findMany();

  for (const m of matieres) {
    const sousSeuil = m.quantiteStock.toNumber() < m.seuilAlerte.toNumber();

    if (!sousSeuil) {
      if (m.alerteSeuilEnvoyeeLe !== null) {
        await prisma.matierePremiere.update({
          where: { id: m.id },
          data: { alerteSeuilEnvoyeeLe: null },
        });
      }
      continue;
    }

    if (m.alerteSeuilEnvoyeeLe !== null) continue;

    const { count } = await prisma.matierePremiere.updateMany({
      where: { id: m.id, alerteSeuilEnvoyeeLe: null },
      data: { alerteSeuilEnvoyeeLe: new Date() },
    });
    if (count !== 1) continue;

    // Émise SYSTÈME (aucun émetteur humain) : ce chemin n'est pas rattaché à
    // l'action d'un utilisateur précis, contrairement au mouvement de stock.
    emettreAlerteSeuil(m, null);
  }
}
