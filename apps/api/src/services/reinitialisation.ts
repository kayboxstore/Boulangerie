import { prisma } from "../lib/prisma.js";
import { construireDump, ErreurSauvegarde, nomFichierSauvegarde, validerDump } from "./sauvegarde.js";
import { ecrireSauvegardeLocale } from "./sauvegardeLocale.js";
import { activerBarriereEtAttendreDrainage, abaisserBarriere, ErreurBarriereActive } from "../lib/barriereEcriture.js";

/**
 * Variable d'environnement EXPLICITE requise pour autoriser la
 * réinitialisation quand `NODE_ENV=production` (P0, section 3.15). Une
 * simple désactivation visuelle du bouton côté écran ne protège rien : la
 * garde qui compte est ici, côté serveur, avant toute écriture. Volontairement
 * absente de `.env.example`, de `render.yaml` et de tout script npm : elle ne
 * doit jamais être activée par habitude ou par copier-coller d'un exemple.
 */
export const VARIABLE_AUTORISATION_PRODUCTION = "REINITIALISATION_PRODUCTION_AUTORISEE";

/** true si la réinitialisation est autorisée dans l'environnement courant. */
export function reinitialisationAutoriseeIci(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env[VARIABLE_AUTORISATION_PRODUCTION] === "true";
}

export const MESSAGE_REINITIALISATION_DESACTIVEE_PRODUCTION =
  "La réinitialisation de la base est désactivée par défaut en production. Elle exige explicitement la " +
  `variable d'environnement ${VARIABLE_AUTORISATION_PRODUCTION}=true (actuellement absente ou différente) — ` +
  "jamais activée par une simple modification de l'interface.";

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
 *    casser la décrémentation auto en Production —, types de clients,
 *    paramètres boutique). Recette/IngredientRecette (correctif 27/08/2026) :
 *    mortes depuis la refonte 3.3, effacées comme le reste des données
 *    transactionnelles — leurs lignes résiduelles bloquaient silencieusement
 *    la suppression de matières premières (cf. migration
 *    20260827120333_purger_recettes_orphelines). Départements & Groupes (3.18) sont eux
 *    aussi des données transactionnelles (organisation du personnel, pas de
 *    la config structurelle) : effacés avant Travailleur. Zones de dépôt
 *    (3.3 d) restent en revanche, comme MotifDon : un pur référentiel
 *    organisationnel (nom, ordre d'affichage), sans donnée chiffrée ni lien
 *    obligatoire à un client précis une fois celui-ci effacé.
 *    (Vente/LigneVente/ClotureCaisse/Presence, orphelines depuis les refontes
 *    3.1/3.18, ont été supprimées du schéma — nettoyage confirmé vide avant
 *    suppression — donc plus rien à effacer ici pour elles.)
 * 3. L'ordre des suppressions est dicté par les contraintes de clé étrangère
 *    (enfants avant parents) — voir les migrations pour le détail exact des
 *    ON DELETE. En particulier, `SchemaCommande.clientId`, `BonLivraison.clientId`
 *    et `CycleLivraison.commandeId` sont en RESTRICT : Schémas de commande et
 *    Bons de livraison doivent donc être effacés avant Client/CommandeClient
 *    (supprimer un Schéma cascade son Cycle de livraison C4 et tout son
 *    historique de transitions/anomalies) ; de même `RemiseCaisse.sessionCaisseId`
 *    est en RESTRICT, donc les remises avant les sessions de caisse.
 *    `deleteMany`/`updateMany` ne passent PAS par l'extension d'audit (qui
 *    n'intercepte que `update`/`delete` unitaires) : pas de bruit inutile dans
 *    un AuditLog qui va de toute façon être vidé dans la même transaction.
 */
export class ErreurReinitialisation extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

/**
 * Réinitialise la base — voir la doctrine complète en tête de fichier.
 *
 * Frontière dump→effacement (P0, section 3.15) : la barrière d'écriture
 * globale (`lib/barriereEcriture.ts`) est activée AVANT même de lancer
 * `pg_dump`, et n'est abaissée qu'une fois toute l'opération terminée (succès
 * OU échec, `finally`). Aucune écriture — HTTP ou tâche de fond — ne peut
 * donc commencer entre l'instant où le dump est produit et l'instant où la
 * transaction d'effacement termine : le dump et l'état effacé représentent
 * strictement la même frontière logique. Toute impossibilité de garantir
 * cette frontière (écritures déjà en cours qui ne se terminent pas à temps)
 * annule la réinitialisation avant même de toucher à `pg_dump`.
 */
export async function reinitialiserBase(raison: string | undefined): Promise<{ sauvegardeId: string }> {
  if (!reinitialisationAutoriseeIci()) {
    throw new ErreurReinitialisation(403, MESSAGE_REINITIALISATION_DESACTIVEE_PRODUCTION, "REINITIALISATION_DESACTIVEE_PRODUCTION");
  }

  try {
    await activerBarriereEtAttendreDrainage();
  } catch (e) {
    if (e instanceof ErreurBarriereActive) {
      // Pas nous qui l'avons activée (une autre réinitialisation est déjà en
      // préparation) : surtout ne pas l'abaisser, ce n'est pas la nôtre.
      throw new ErreurReinitialisation(
        409,
        "Une réinitialisation est déjà en cours de préparation — réessayez dans quelques instants.",
        "REINITIALISATION_DEJA_EN_COURS",
      );
    }
    // ErreurDrainageEchoue : NOUS l'avons activée, puis le drainage a expiré
    // — c'est bien notre barrière, on doit l'abaisser avant de renvoyer.
    abaisserBarriere();
    const message = e instanceof Error ? e.message : "Erreur inconnue";
    throw new ErreurReinitialisation(
      503,
      `Impossible de garantir qu'aucune écriture n'était en cours — réinitialisation annulée. ${message}`,
      "DRAINAGE_ECRITURES_ECHOUE",
    );
  }

  try {
    const t0 = Date.now();
    const nomFichier = nomFichierSauvegarde();

    let dump: Buffer;
    try {
      dump = await construireDump();
      // Intégrité (P0) : un dump non vide n'est pas la même chose qu'un dump
      // VALIDE — voir sauvegarde.ts. Jamais d'effacement derrière une
      // archive corrompue ou partielle.
      await validerDump(dump);
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
      // Production — Schémas de commande et Bons de livraison (3.3 d/e), AVANT
      // Commandes clients : cf. note ON DELETE RESTRICT ci-dessus. Supprimer un
      // SchemaCommande cascade son CycleLivraison (C4) et tout son historique.
      prisma.bonLivraison.deleteMany(),
      prisma.schemaCommande.deleteMany(),
      // Commandes clients
      prisma.paiementCommande.deleteMany(),
      prisma.commandeClient.deleteMany(),
      prisma.client.deleteMany(),
      // Fournisseurs & achats
      prisma.ligneCommandeFournisseur.deleteMany(),
      prisma.commandeFournisseur.deleteMany(),
      prisma.fournisseur.deleteMany(),
      // Stocks (mouvements seulement — le catalogue MatierePremiere est conservé).
      // Recette/IngredientRecette (correctif 27/08/2026) : tables mortes depuis
      // la refonte 3.3 de la Production (plus aucune route/service ne les lit
      // ni ne les écrit), mais leurs lignes résiduelles d'avant cette refonte
      // référencent encore certaines matières (IngredientRecette.matierePremiereId,
      // sans ON DELETE CASCADE côté MatierePremiere) et bloquaient silencieusement
      // la suppression de ces matières même après une réinitialisation complète —
      // cette dernière ne les touchait pas jusqu'ici. Supprimer Recette entraîne
      // via ON DELETE CASCADE la suppression des IngredientRecette associées.
      prisma.recette.deleteMany(),
      prisma.mouvementStock.deleteMany(),
      // Production
      prisma.productionDon.deleteMany(),
      prisma.production.deleteMany(),
      prisma.planningLigneProduit.deleteMany(),
      prisma.planningProduction.deleteMany(),
      // Caisse — le registre (3.1). Remises AVANT sessions (RESTRICT, voir note).
      prisma.remiseCaisse.deleteMany(),
      prisma.sessionCaisse.deleteMany(),
      prisma.tauxDuJour.deleteMany(),
      prisma.depenseCaisse.deleteMany(),
      // Comptes — en dernier, référencé par (presque) tout ce qui précède.
      // SecretPremierLancement (P1-A, 28/08/2026) : un secret généré avant la
      // réinitialisation mais jamais consommé et pas encore expiré resterait
      // sinon valide après coup, alors que la réinitialisation fait réapparaître
      // l'Assistant de premier lancement — l'« ouverture explicite » du parcours
      // doit être un acte volontaire et frais, jamais un reliquat.
      prisma.secretPremierLancement.deleteMany(),
      prisma.utilisateur.deleteMany(),
      // Catalogue matières premières conservé ; seul le solde repart à 0.
      prisma.matierePremiere.updateMany({ data: { quantiteStock: 0 } }),
    ]);

    return { sauvegardeId: sauvegarde.id };
  } finally {
    // Toujours abaissée ici, succès ou échec — c'est bien NOTRE barrière
    // puisqu'on n'atteint ce bloc que si `activerBarriereEtAttendreDrainage`
    // a réussi ci-dessus (sinon on a déjà `return`/`throw` avant).
    abaisserBarriere();
  }
}
