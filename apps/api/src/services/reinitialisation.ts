import { prisma } from "../lib/prisma.js";
import { construireDump, ErreurSauvegarde, nomFichierSauvegarde } from "./sauvegarde.js";
import { ecrireSauvegardeLocale } from "./sauvegardeLocale.js";

/**
 * Réinitialisation de la base (section 3.15) — Admin Principal uniquement,
 * irréversible.
 *
 * 1. Sauvegarde de sûreté locale AVANT tout effacement, avec la raison en
 *    métadonnées — c'est la seule trace qui survit à l'opération, puisque le
 *    Journal d'audit lui-même est effacé. Si elle échoue, RIEN n'est effacé :
 *    mieux vaut refuser la réinitialisation que de la faire sans filet.
 * 2. Efface toutes les données transactionnelles et tous les comptes ; garde
 *    la configuration structurelle (rôles/permissions, catalogue produits,
 *    matières premières — stock remis à 0 mais catalogue conservé pour ne pas
 *    casser la décrémentation auto en Production —, recettes, types de
 *    clients, paramètres boutique). Départements & Groupes (3.18) sont eux
 *    aussi des données transactionnelles (organisation du personnel, pas de
 *    la config structurelle) : effacés avant Travailleur.
 *    (Vente/LigneVente/ClotureCaisse/Presence, orphelines depuis les refontes
 *    3.1/3.18, ont été supprimées du schéma — nettoyage confirmé vide avant
 *    suppression — donc plus rien à effacer ici pour elles.)
 * 3. L'ordre des suppressions est dicté par les contraintes de clé étrangère
 *    (enfants avant parents) — voir les migrations pour le détail exact des
 *    ON DELETE. `deleteMany`/`updateMany` ne passent PAS par l'extension
 *    d'audit (qui n'intercepte que `update`/`delete` unitaires) : pas de bruit
 *    inutile dans un AuditLog qui va de toute façon être vidé dans la même
 *    transaction.
 */
export class ErreurReinitialisation extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function reinitialiserBase(raison: string | undefined): Promise<{ sauvegardeId: string }> {
  const t0 = Date.now();
  const nomFichier = nomFichierSauvegarde();

  let dump: Buffer;
  try {
    dump = await construireDump();
  } catch (e) {
    const message = e instanceof ErreurSauvegarde ? e.message : e instanceof Error ? e.message : "Erreur inconnue";
    throw new ErreurReinitialisation(503, `Sauvegarde de sûreté impossible — réinitialisation annulée. ${message}`);
  }

  let chemin: string;
  try {
    chemin = await ecrireSauvegardeLocale(nomFichier, dump);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    throw new ErreurReinitialisation(
      500,
      `Écriture de la sauvegarde de sûreté impossible — réinitialisation annulée. ${message}`,
    );
  }

  const sauvegarde = await prisma.sauvegardeBase.create({
    data: {
      type: "REINITIALISATION",
      statut: "SUCCES",
      tailleOctets: dump.length,
      nomFichier,
      destination: "LOCAL",
      idDistant: chemin,
      dureeMs: Date.now() - t0,
      raisonReinitialisation: raison ?? null,
    },
  });

  await prisma.$transaction([
    // Assistant (3.19)
    prisma.messageSupport.deleteMany(),
    prisma.conversationSupport.deleteMany(),
    // Équipe (comptes-dépendant)
    prisma.auditLog.deleteMany(),
    prisma.demandeApprobation.deleteMany(),
    prisma.delegationRole.deleteMany(),
    prisma.notification.deleteMany(),
    // Travailleurs
    prisma.pointage.deleteMany(),
    prisma.absence.deleteMany(),
    prisma.sanction.deleteMany(),
    prisma.bulletinPaie.deleteMany(),
    prisma.groupe.deleteMany(),
    prisma.departement.deleteMany(),
    prisma.travailleur.deleteMany(),
    // Commandes clients
    prisma.paiementCommande.deleteMany(),
    prisma.commandeClient.deleteMany(),
    prisma.client.deleteMany(),
    // Fournisseurs & achats
    prisma.ligneCommandeFournisseur.deleteMany(),
    prisma.commandeFournisseur.deleteMany(),
    prisma.fournisseur.deleteMany(),
    // Stocks (mouvements seulement — le catalogue MatierePremiere est conservé)
    prisma.mouvementStock.deleteMany(),
    // Production
    prisma.productionDon.deleteMany(),
    prisma.production.deleteMany(),
    prisma.planningLigneProduit.deleteMany(),
    prisma.planningProduction.deleteMany(),
    // Caisse — le registre (3.1)
    prisma.tauxDuJour.deleteMany(),
    prisma.depenseCaisse.deleteMany(),
    // Comptes — en dernier, référencé par (presque) tout ce qui précède.
    prisma.utilisateur.deleteMany(),
    // Catalogue matières premières conservé ; seul le solde repart à 0.
    prisma.matierePremiere.updateMany({ data: { quantiteStock: 0 } }),
  ]);

  return { sauvegardeId: sauvegarde.id };
}
