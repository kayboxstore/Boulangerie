import { Router } from "express";
import {
  demandePubliqueIdentifierSchema,
  demandePubliqueCreateSchema,
  demandePubliqueRejeterSchema,
  demandePubliqueModifierSchema,
  demandePubliqueAnnulerSchema,
  NOMS_PRODUITS_SCHEMA_COMMANDE,
  type DemandeCommandePubliqueDTO,
  type SchemaCommandeLigneClientInput,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";
import {
  appliquerSchemaCommandeJour,
  chargerSchemaCommandeJour,
  ErreurPlanningConcurrent,
  estConflitPlanning,
} from "./production.js";
import { ErreurCycleLivraison } from "../services/cyclesLivraison.js";
import { ErreurAction } from "../lib/erreurAction.js";

export const demandesCommandePubliquesPubliqueRouter = Router();
export const demandesCommandePubliquesRouter = Router();
// Contrairement au routeur public ci-dessus (aucune authentification), tout
// ce routeur exige un compte connecté — même convention que
// commandesRouter.use(requireAuth) dans commandes.ts. requirePermission seul
// ne suffit pas : il ne fait QUE lire req.utilisateur, jamais le définir.
demandesCommandePubliquesRouter.use(requireAuth);

const INCLUDE_DEMANDE = {
  client: { include: { typeClient: true } },
  lignes: { include: { produit: true } },
} as const;

type DemandeAvecRelations = Awaited<
  ReturnType<typeof prisma.demandeCommandePublique.findFirstOrThrow<{ include: typeof INCLUDE_DEMANDE }>>
>;

function versDTO(d: DemandeAvecRelations): DemandeCommandePubliqueDTO {
  return {
    id: d.id,
    client: { id: d.client.id, nom: d.client.nom, typeClient: d.client.typeClient.nom },
    lignes: d.lignes.map((l) => ({ produitId: l.produitId, produitNom: l.produit.nom, quantite: l.quantite })),
    totalBacs: d.lignes.reduce((s, l) => s + l.quantite, 0),
    dateSouhaitee: d.dateSouhaitee.toISOString().slice(0, 10),
    note: d.note,
    statut: d.statut,
    motifRejet: d.motifRejet,
    motifAnnulation: d.motifAnnulation,
    createdAt: d.createdAt.toISOString(),
  };
}

/**
 * Applique un delta (positif = ajoute, négatif = retire) aux quantités d'UN
 * client dans la liste complète des clients d'un jour — partagé par
 * confirmer (delta positif), annuler (delta négatif) et modifier (delta =
 * nouvelles - anciennes quantités). Une quantité qui tomberait à 0 ou moins
 * retire la ligne plutôt que de stocker un négatif ou un zéro ; si plus
 * aucune ligne ne reste pour ce client, il disparaît entièrement du jour
 * (cohérent avec "ce client n'a plus rien prévu ce jour-là").
 */
function appliquerDeltaSurClients(
  clientsExistants: SchemaCommandeLigneClientInput[],
  clientId: string,
  deltasParProduit: Map<string, number>,
): SchemaCommandeLigneClientInput[] {
  const autres = clientsExistants.filter((c) => c.clientId !== clientId);
  const existant = clientsExistants.find((c) => c.clientId === clientId);
  const quantites = new Map<string, number>(existant?.lignes.map((l) => [l.produitId, l.quantite]) ?? []);
  for (const [produitId, delta] of deltasParProduit) {
    const nouvelle = (quantites.get(produitId) ?? 0) + delta;
    if (nouvelle > 0) quantites.set(produitId, nouvelle);
    else quantites.delete(produitId);
  }
  const lignesFinal = [...quantites.entries()].map(([produitId, quantite]) => ({ produitId, quantite }));
  return lignesFinal.length > 0 ? [...autres, { clientId, lignes: lignesFinal }] : autres;
}

/** Charge le Schéma d'un jour sous la forme attendue par appliquerSchemaCommandeJour. */
async function chargerClientsJour(dateISO: string): Promise<SchemaCommandeLigneClientInput[]> {
  const schema = await chargerSchemaCommandeJour(dateISO);
  return schema.clients.map((c) => ({
    clientId: c.clientId,
    lignes: c.lignes.map((l) => ({ produitId: l.produitId, quantite: l.quantite })),
  }));
}

function versDeltas(lignes: { produitId: string; quantite: number }[], signe: 1 | -1): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lignes) m.set(l.produitId, (m.get(l.produitId) ?? 0) + signe * l.quantite);
  return m;
}

// ---------------------------------------------------------------------------
// Routes PUBLIQUES (site vitrine, aucune authentification) — enregistrées
// sans requirePermission ni requireAuth. Le rate limiting est appliqué dans
// app.ts, au même titre que les autres routes publiques sensibles
// (/api/auth/*) — jamais ici, pour garder une seule source de vérité sur les
// limites (voir app.ts).
// ---------------------------------------------------------------------------

/**
 * Identification par téléphone. Ne révèle QUE si un Dépositaire/Maman
 * correspondant existe, avec son nom et sa Qualité — jamais son solde, son
 * historique, ni aucune autre donnée. Réponse volontairement minimale mais
 * PAS du type "ne révèle jamais si le compte existe" (contrairement au mot
 * de passe oublié) : le mécanisme même du formulaire exige de confirmer
 * l'identité pour que le visiteur puisse continuer — mais rien de plus que
 * cette confirmation n'est exposé.
 */
demandesCommandePubliquesPubliqueRouter.post("/identifier", async (req, res, next) => {
  try {
    const parsed = demandePubliqueIdentifierSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const client = await prisma.client.findFirst({
      where: { telephone: parsed.data.telephone, typeClient: { nom: { in: ["Dépositaire", "Maman"] } } },
      include: { typeClient: true },
    });
    if (!client) {
      return res.status(404).json({ trouve: false, erreur: "Aucun compte Dépositaire/Maman ne correspond à ce numéro." });
    }
    return res.json({ trouve: true, clientId: client.id, nom: client.nom, typeClient: client.typeClient.nom });
  } catch (e) {
    next(e);
  }
});

/**
 * Liste publique des produits éligibles à une demande de commande — jamais
 * de prix de revient, marge ou donnée interne, juste ce qui est déjà visible
 * sur le site vitrine en dur (nom, prix de vente). Sert UNIQUEMENT à ce que
 * le formulaire public connaisse le vrai produitId (identifiant interne
 * généré par la base, imprévisible) sans le coder en dur côté site vitrine —
 * un produit renommé, désactivé ou réinitialisé (nouvelle base de
 * développement, restauration) ne casserait sinon plus jamais le formulaire.
 */
demandesCommandePubliquesPubliqueRouter.get("/produits", async (_req, res, next) => {
  try {
    const produits = await prisma.produit.findMany({
      where: { actif: true, nom: { in: [...NOMS_PRODUITS_SCHEMA_COMMANDE] } },
      select: { id: true, nom: true, prixVente: true },
      orderBy: { nom: "asc" },
    });
    return res.json({ produits });
  } catch (e) {
    next(e);
  }
});

/**
 * Crée la demande. Revérifie le téléphone côté serveur (jamais confiance
 * dans un clientId envoyé par le formulaire public sans le prouver à nouveau
 * par le même téléphone) — sinon rien n'empêcherait un visiteur de deviner
 * un clientId et de soumettre une demande au nom d'un autre Dépositaire.
 * Ce n'est PAS une commande : c'est une PRÉVISION pour la date souhaitée,
 * jamais rien de facturable tant qu'un Chargé des commandes ne l'a pas
 * confirmée (voir /:id/confirmer plus bas).
 */
demandesCommandePubliquesPubliqueRouter.post("/", async (req, res, next) => {
  try {
    const parsed = demandePubliqueCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { telephone, dateSouhaitee, lignes, note } = parsed.data;
    const client = await prisma.client.findFirst({
      where: { telephone, typeClient: { nom: { in: ["Dépositaire", "Maman"] } } },
      include: { typeClient: true },
    });
    if (!client) {
      return res.status(404).json({ erreur: "Aucun compte Dépositaire/Maman ne correspond à ce numéro." });
    }

    const produitIds = [...new Set(lignes.map((l) => l.produitId))];
    const produitsConnus = await prisma.produit.count({ where: { id: { in: produitIds }, actif: true } });
    if (produitsConnus !== produitIds.length) {
      return res.status(400).json({ erreur: "Un des produits demandés est inconnu ou n'est plus proposé." });
    }
    if (produitIds.length !== lignes.length) {
      return res.status(400).json({ erreur: "Un même produit apparaît deux fois dans la demande." });
    }

    const demande = await prisma.demandeCommandePublique.create({
      data: {
        clientId: client.id,
        dateSouhaitee: new Date(dateSouhaitee),
        note,
        lignes: { create: lignes.map((l) => ({ produitId: l.produitId, quantite: l.quantite })) },
      },
      include: INCLUDE_DEMANDE,
    });

    const totalBacs = lignes.reduce((s, l) => s + l.quantite, 0);
    busEvenements.emettreEvenement({
      type: "DEMANDE_COMMANDE_PUBLIQUE",
      module: "COMMANDES",
      emetteurId: null,
      evenementRef: demande.id,
      message: `Nouvelle demande de commande (site vitrine) — ${client.nom} (${client.typeClient.nom}) : ${totalBacs} bac(s) pour le ${dateSouhaitee}.`,
      donnees: { demandeId: demande.id },
    });

    return res.status(201).json({ demande: versDTO(demande) });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Routes INTERNES (authentifiées, permission COMMANDES) — file d'attente et
// traitement par le Chargé des commandes.
// ---------------------------------------------------------------------------

demandesCommandePubliquesRouter.get("/", requirePermission("COMMANDES", "LECTURE"), async (req, res, next) => {
  try {
    const statut = typeof req.query.statut === "string" ? req.query.statut : undefined;
    const demandes = await prisma.demandeCommandePublique.findMany({
      where: statut ? { statut: statut as "EN_ATTENTE" | "CONFIRMEE" | "REJETEE" | "ANNULEE" } : undefined,
      include: INCLUDE_DEMANDE,
      orderBy: { createdAt: "desc" },
    });
    return res.json({ demandes: demandes.map(versDTO) });
  } catch (e) {
    next(e);
  }
});

function gererErreurSchema(e: unknown, res: import("express").Response, next: import("express").NextFunction) {
  if (e instanceof ErreurCycleLivraison) {
    return res.status(e.statutHttp).json({ code: e.code, erreur: e.message });
  }
  if (e instanceof ErreurPlanningConcurrent || estConflitPlanning(e)) {
    return res.status(409).json({
      code: "PREVISION_VERROUILLEE",
      erreur: "La prévision de ce jour a été modifiée simultanément. Réessayez.",
    });
  }
  if (e instanceof ErreurAction) {
    return res.status(e.status).json({ erreur: e.message });
  }
  next(e);
}

/**
 * Confirme une demande : l'ajoute au Schéma de commande de la date
 * souhaitée, en réutilisant appliquerSchemaCommandeJour (production.ts) — le
 * MÊME cœur transactionnel que la saisie manuelle des prévisions, jamais une
 * réimplémentation. PAS une CommandeClient : cette demande devient une
 * PRÉVISION, la vraie commande facturable ne naîtra qu'à la livraison (cycle
 * existant, étape "Montant facturable").
 *
 * Fusion, pas remplacement : si ce client a déjà des lignes pour cette date
 * (une commande manuelle saisie par l'équipe, ou une AUTRE demande publique
 * déjà confirmée pour le même jour), les quantités s'ADDITIONNENT par
 * produit plutôt que d'écraser l'existant.
 *
 * Verrouillage optimiste contre le double-clic : la demande est BASCULÉE
 * en CONFIRMEE avant la fusion (via updateMany ... WHERE statut=EN_ATTENTE,
 * count doit valoir 1) puis repassée en EN_ATTENTE si la fusion échoue.
 */
demandesCommandePubliquesRouter.post(
  "/:id/confirmer",
  requirePermission("COMMANDES", "ECRITURE"),
  async (req, res, next) => {
    try {
      const demande = await prisma.demandeCommandePublique.findUnique({
        where: { id: req.params.id },
        include: INCLUDE_DEMANDE,
      });
      if (!demande) return res.status(404).json({ erreur: "Demande introuvable" });
      if (demande.statut !== "EN_ATTENTE") {
        return res.status(409).json({ erreur: `Cette demande n'est plus en attente (statut : ${demande.statut}).` });
      }

      const reclamee = await prisma.demandeCommandePublique.updateMany({
        where: { id: demande.id, statut: "EN_ATTENTE" },
        data: { statut: "CONFIRMEE", traiteParId: req.utilisateur!.id, traiteLe: new Date() },
      });
      if (reclamee.count !== 1) {
        return res.status(409).json({ erreur: "Cette demande vient d'être traitée par quelqu'un d'autre." });
      }

      const dateISO = demande.dateSouhaitee.toISOString().slice(0, 10);
      try {
        const clientsJour = await chargerClientsJour(dateISO);
        const fusionnes = appliquerDeltaSurClients(clientsJour, demande.clientId, versDeltas(demande.lignes, 1));
        const resultat = await appliquerSchemaCommandeJour(dateISO, fusionnes, req.utilisateur!.id);
        if ("erreur" in resultat) throw new ErreurAction(resultat.statutHttp, resultat.erreur);
        return res.json({ demande: versDTO({ ...demande, statut: "CONFIRMEE" }) });
      } catch (erreurFusion) {
        // La demande a été réclamée (CONFIRMEE) mais la fusion a échoué : on
        // la rend au pool EN_ATTENTE plutôt que de la laisser "confirmée"
        // sans que rien n'ait réellement été appliqué.
        await prisma.demandeCommandePublique.updateMany({
          where: { id: demande.id, statut: "CONFIRMEE" },
          data: { statut: "EN_ATTENTE", traiteParId: null, traiteLe: null },
        });
        throw erreurFusion;
      }
    } catch (e) {
      gererErreurSchema(e, res, next);
    }
  },
);

demandesCommandePubliquesRouter.post(
  "/:id/rejeter",
  requirePermission("COMMANDES", "ECRITURE"),
  async (req, res, next) => {
    try {
      const parsed = demandePubliqueRejeterSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
      }
      const demande = await prisma.demandeCommandePublique.findUnique({ where: { id: req.params.id } });
      if (!demande) return res.status(404).json({ erreur: "Demande introuvable" });
      if (demande.statut !== "EN_ATTENTE") {
        return res.status(409).json({ erreur: `Cette demande n'est plus en attente (statut : ${demande.statut}).` });
      }
      const reclamee = await prisma.demandeCommandePublique.updateMany({
        where: { id: demande.id, statut: "EN_ATTENTE" },
        data: { statut: "REJETEE", motifRejet: parsed.data.motif, traiteParId: req.utilisateur!.id, traiteLe: new Date() },
      });
      if (reclamee.count !== 1) {
        return res.status(409).json({ erreur: "Cette demande vient d'être traitée par quelqu'un d'autre." });
      }
      const maj = await prisma.demandeCommandePublique.findUniqueOrThrow({
        where: { id: demande.id },
        include: INCLUDE_DEMANDE,
      });
      return res.json({ demande: versDTO(maj) });
    } catch (e) {
      next(e);
    }
  },
);

/**
 * Annule une demande déjà CONFIRMEE : retire ses lignes du Schéma de
 * commande de sa date (delta négatif, via appliquerDeltaSurClients), motif
 * requis. Distincte de Rejeter (EN_ATTENTE uniquement, jamais fusionnée nulle
 * part — rien à défusionner). Même verrouillage optimiste que confirmer :
 * réclamée (ANNULEE) avant la défusion, rendue à CONFIRMEE si ça échoue.
 */
demandesCommandePubliquesRouter.post(
  "/:id/annuler",
  requirePermission("COMMANDES", "ECRITURE"),
  async (req, res, next) => {
    try {
      const parsed = demandePubliqueAnnulerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
      }
      const demande = await prisma.demandeCommandePublique.findUnique({
        where: { id: req.params.id },
        include: INCLUDE_DEMANDE,
      });
      if (!demande) return res.status(404).json({ erreur: "Demande introuvable" });
      if (demande.statut !== "CONFIRMEE") {
        return res
          .status(409)
          .json({ erreur: `Seule une demande confirmée peut être annulée (statut actuel : ${demande.statut}).` });
      }

      const reclamee = await prisma.demandeCommandePublique.updateMany({
        where: { id: demande.id, statut: "CONFIRMEE" },
        data: { statut: "ANNULEE", motifAnnulation: parsed.data.motif, traiteParId: req.utilisateur!.id, traiteLe: new Date() },
      });
      if (reclamee.count !== 1) {
        return res.status(409).json({ erreur: "Cette demande vient d'être modifiée par quelqu'un d'autre." });
      }

      const dateISO = demande.dateSouhaitee.toISOString().slice(0, 10);
      try {
        const clientsJour = await chargerClientsJour(dateISO);
        const defusionnes = appliquerDeltaSurClients(clientsJour, demande.clientId, versDeltas(demande.lignes, -1));
        const resultat = await appliquerSchemaCommandeJour(dateISO, defusionnes, req.utilisateur!.id);
        if ("erreur" in resultat) throw new ErreurAction(resultat.statutHttp, resultat.erreur);
        return res.json({ demande: versDTO({ ...demande, statut: "ANNULEE", motifAnnulation: parsed.data.motif }) });
      } catch (erreurDefusion) {
        await prisma.demandeCommandePublique.updateMany({
          where: { id: demande.id, statut: "ANNULEE" },
          data: { statut: "CONFIRMEE", motifAnnulation: null },
        });
        throw erreurDefusion;
      }
    } catch (e) {
      gererErreurSchema(e, res, next);
    }
  },
);

/**
 * Modifie une demande — les nouvelles lignes/date/note remplacent les
 * anciennes. Sur une demande EN_ATTENTE : simple mise à jour, rien d'autre
 * (pas encore fusionnée nulle part). Sur une demande CONFIRMEE : répercute
 * la DIFFÉRENCE sur le Schéma de commande déjà fusionné — jamais un
 * remplacement brutal qui écraserait ce que d'autres clients ont ce
 * jour-là. Si la date change, deux jours sont touchés (retrait de l'ancien,
 * ajout au nouveau) : chaque jour est sa propre transaction
 * (appliquerSchemaCommandeJour), donc pas une seule opération atomique — en
 * cas d'échec sur le second jour, un retour en arrière du premier est
 * tenté (best effort), jamais garanti à 100% en cas de panne au pire
 * moment. Cas rare (changer la date ET que ça échoue exactement entre les
 * deux), accepté comme limite connue plutôt que sur-conçu pour ce risque
 * résiduel.
 */
demandesCommandePubliquesRouter.put(
  "/:id",
  requirePermission("COMMANDES", "ECRITURE"),
  async (req, res, next) => {
    try {
      const parsed = demandePubliqueModifierSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
      }
      const demande = await prisma.demandeCommandePublique.findUnique({
        where: { id: req.params.id },
        include: INCLUDE_DEMANDE,
      });
      if (!demande) return res.status(404).json({ erreur: "Demande introuvable" });
      if (demande.statut === "REJETEE" || demande.statut === "ANNULEE") {
        return res.status(409).json({ erreur: `Une demande ${demande.statut === "REJETEE" ? "rejetée" : "annulée"} ne peut plus être modifiée.` });
      }

      const { dateSouhaitee, lignes, note } = parsed.data;
      const produitIds = [...new Set(lignes.map((l) => l.produitId))];
      const produitsConnus = await prisma.produit.count({ where: { id: { in: produitIds }, actif: true } });
      if (produitsConnus !== produitIds.length) {
        return res.status(400).json({ erreur: "Un des produits demandés est inconnu ou n'est plus proposé." });
      }
      if (produitIds.length !== lignes.length) {
        return res.status(400).json({ erreur: "Un même produit apparaît deux fois dans la demande." });
      }

      const appliquerNouvellesLignes = async () => {
        await prisma.demandeCommandePubliqueLigne.deleteMany({ where: { demandeId: demande.id } });
        await prisma.demandeCommandePubliqueLigne.createMany({
          data: lignes.map((l) => ({ demandeId: demande.id, produitId: l.produitId, quantite: l.quantite })),
        });
        await prisma.demandeCommandePublique.update({
          where: { id: demande.id },
          data: { dateSouhaitee: new Date(dateSouhaitee), note },
        });
      };

      if (demande.statut === "EN_ATTENTE") {
        await appliquerNouvellesLignes();
        const maj = await prisma.demandeCommandePublique.findUniqueOrThrow({ where: { id: demande.id }, include: INCLUDE_DEMANDE });
        return res.json({ demande: versDTO(maj) });
      }

      // CONFIRMEE : répercuter la différence sur le(s) Schéma(s) concerné(s).
      const ancienDateISO = demande.dateSouhaitee.toISOString().slice(0, 10);
      const nouveauDateISO = dateSouhaitee;
      const ancienLignes = demande.lignes.map((l) => ({ produitId: l.produitId, quantite: l.quantite }));

      if (ancienDateISO === nouveauDateISO) {
        const deltas = versDeltas(lignes, 1);
        for (const [produitId, qte] of versDeltas(ancienLignes, -1)) {
          deltas.set(produitId, (deltas.get(produitId) ?? 0) + qte);
        }
        const clientsJour = await chargerClientsJour(ancienDateISO);
        const ajustes = appliquerDeltaSurClients(clientsJour, demande.clientId, deltas);
        const resultat = await appliquerSchemaCommandeJour(ancienDateISO, ajustes, req.utilisateur!.id);
        if ("erreur" in resultat) return res.status(resultat.statutHttp).json({ erreur: resultat.erreur });
        await appliquerNouvellesLignes();
        const maj = await prisma.demandeCommandePublique.findUniqueOrThrow({ where: { id: demande.id }, include: INCLUDE_DEMANDE });
        return res.json({ demande: versDTO(maj) });
      }

      // La date change : retire de l'ancien jour, ajoute au nouveau.
      const clientsAncienJour = await chargerClientsJour(ancienDateISO);
      const sansAncien = appliquerDeltaSurClients(clientsAncienJour, demande.clientId, versDeltas(ancienLignes, -1));
      const retraitResultat = await appliquerSchemaCommandeJour(ancienDateISO, sansAncien, req.utilisateur!.id);
      if ("erreur" in retraitResultat) {
        return res.status(retraitResultat.statutHttp).json({ erreur: retraitResultat.erreur });
      }
      try {
        const clientsNouveauJour = await chargerClientsJour(nouveauDateISO);
        const avecNouveau = appliquerDeltaSurClients(clientsNouveauJour, demande.clientId, versDeltas(lignes, 1));
        const ajoutResultat = await appliquerSchemaCommandeJour(nouveauDateISO, avecNouveau, req.utilisateur!.id);
        if ("erreur" in ajoutResultat) throw new ErreurAction(ajoutResultat.statutHttp, ajoutResultat.erreur);
      } catch (erreurAjout) {
        // Best effort : remet l'ancien jour comme avant, puisque le nouveau
        // jour n'a pas pu recevoir la demande — voir doc de tête sur la
        // limite de non-atomicité entre les deux jours.
        try {
          const clientsAncienJourRetente = await chargerClientsJour(ancienDateISO);
          const avecAncienRestaure = appliquerDeltaSurClients(clientsAncienJourRetente, demande.clientId, versDeltas(ancienLignes, 1));
          await appliquerSchemaCommandeJour(ancienDateISO, avecAncienRestaure, req.utilisateur!.id);
        } catch {
          // Le retour en arrière lui-même a échoué — situation à traiter
          // manuellement, mais on ne masque pas l'erreur d'origine pour ça.
        }
        throw erreurAjout;
      }

      await appliquerNouvellesLignes();
      const maj = await prisma.demandeCommandePublique.findUniqueOrThrow({ where: { id: demande.id }, include: INCLUDE_DEMANDE });
      return res.json({ demande: versDTO(maj) });
    } catch (e) {
      gererErreurSchema(e, res, next);
    }
  },
);
