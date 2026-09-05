import { Router } from "express";
import {
  demandePubliqueIdentifierSchema,
  demandePubliqueCreateSchema,
  demandePubliqueRejeterSchema,
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
    createdAt: d.createdAt.toISOString(),
  };
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
      where: statut ? { statut: statut as "EN_ATTENTE" | "CONFIRMEE" | "REJETEE" } : undefined,
      include: INCLUDE_DEMANDE,
      orderBy: { createdAt: "desc" },
    });
    return res.json({ demandes: demandes.map(versDTO) });
  } catch (e) {
    next(e);
  }
});

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
 * produit plutôt que d'écraser l'existant — plusieurs demandes du même
 * client pour une même date de livraison sont considérées cumulatives, pas
 * substitutives. Si ce n'est pas le comportement voulu, à ajuster.
 *
 * Verrouillage optimiste contre le double-clic : la demande est BASCULÉE
 * en CONFIRMEE avant la fusion (via updateMany ... WHERE statut=EN_ATTENTE,
 * count doit valoir 1) puis repassée en EN_ATTENTE si la fusion échoue — sans
 * ça, deux clics concurrents pourraient tous les deux lire EN_ATTENTE et
 * additionner les mêmes bacs deux fois dans le Planning.
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
        return res
          .status(409)
          .json({ erreur: `Cette demande est déjà ${demande.statut === "CONFIRMEE" ? "confirmée" : "rejetée"}.` });
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
        const schemaExistant = await chargerSchemaCommandeJour(dateISO);
        const autresClients: SchemaCommandeLigneClientInput[] = schemaExistant.clients
          .filter((c) => c.clientId !== demande.clientId)
          .map((c) => ({
            clientId: c.clientId,
            lignes: c.lignes.map((l) => ({ produitId: l.produitId, quantite: l.quantite })),
          }));
        const ligneExistanteCeClient = schemaExistant.clients.find((c) => c.clientId === demande.clientId);
        const quantitesFusionnees = new Map<string, number>(
          ligneExistanteCeClient?.lignes.map((l) => [l.produitId, l.quantite]) ?? [],
        );
        for (const l of demande.lignes) {
          quantitesFusionnees.set(l.produitId, (quantitesFusionnees.get(l.produitId) ?? 0) + l.quantite);
        }

        const clientsAvecFusion: SchemaCommandeLigneClientInput[] = [
          ...autresClients,
          {
            clientId: demande.clientId,
            lignes: [...quantitesFusionnees.entries()].map(([produitId, quantite]) => ({ produitId, quantite })),
          },
        ];

        const resultat = await appliquerSchemaCommandeJour(dateISO, clientsAvecFusion, req.utilisateur!.id);
        if ("erreur" in resultat) {
          throw new ErreurAction(resultat.statutHttp, resultat.erreur);
        }

        return res.json({ demande: versDTO({ ...demande, statut: "CONFIRMEE" }) });
      } catch (erreurFusion) {
        // La demande a été réclamée (CONFIRMEE) mais la fusion a échoué :
        // on la rend au pool EN_ATTENTE pour qu'un nouvel essai reste
        // possible, plutôt que de la laisser bloquée "confirmée" sans que
        // rien n'ait réellement été appliqué.
        await prisma.demandeCommandePublique.updateMany({
          where: { id: demande.id, statut: "CONFIRMEE" },
          data: { statut: "EN_ATTENTE", traiteParId: null, traiteLe: null },
        });
        throw erreurFusion;
      }
    } catch (e) {
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
        return res
          .status(409)
          .json({ erreur: `Cette demande est déjà ${demande.statut === "CONFIRMEE" ? "confirmée" : "rejetée"}.` });
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
