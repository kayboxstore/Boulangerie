import { Router } from "express";
import {
  demandeInscriptionDepositaireCreateSchema,
  demandeInscriptionDepositaireConfirmerSchema,
  demandeInscriptionDepositaireRejeterSchema,
  type DemandeInscriptionDepositaireDTO,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";

export const demandesInscriptionDepositairePubliqueRouter = Router();
export const demandesInscriptionDepositaireRouter = Router();
demandesInscriptionDepositaireRouter.use(requireAuth);

function versDTO(d: {
  id: string;
  nom: string;
  telephone: string;
  adresse: string;
  statut: "EN_ATTENTE" | "CONFIRMEE" | "REJETEE" | "ANNULEE";
  clientCreeId: string | null;
  motifRejet: string | null;
  createdAt: Date;
}): DemandeInscriptionDepositaireDTO {
  return {
    id: d.id,
    nom: d.nom,
    telephone: d.telephone,
    adresse: d.adresse,
    statut: d.statut,
    clientCreeId: d.clientCreeId,
    motifRejet: d.motifRejet,
    createdAt: d.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Route PUBLIQUE (site vitrine, aucune authentification).
// ---------------------------------------------------------------------------

/**
 * Inscription publique pour devenir Dépositaire. Pas d'identification
 * préalable (contrairement aux demandes de commande) : c'est précisément
 * cette inscription qui crée le Client, il n'existe pas encore. Le
 * téléphone n'est PAS vérifié comme unique ici — deux inscriptions avec le
 * même numéro peuvent coexister EN_ATTENTE (ex. une correction) ; c'est au
 * Chargé des commandes de trancher à la confirmation, pas au formulaire de
 * bloquer une resoumission légitime.
 */
demandesInscriptionDepositairePubliqueRouter.post("/", async (req, res, next) => {
  try {
    const parsed = demandeInscriptionDepositaireCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const demande = await prisma.demandeInscriptionDepositaire.create({ data: parsed.data });

    busEvenements.emettreEvenement({
      type: "DEMANDE_COMMANDE_PUBLIQUE",
      module: "COMMANDES",
      emetteurId: null,
      evenementRef: demande.id,
      message: `Nouvelle demande d'inscription Dépositaire (site vitrine) — ${demande.nom}.`,
      donnees: { demandeInscriptionId: demande.id },
    });

    return res.status(201).json({ demande: versDTO(demande) });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Routes INTERNES (authentifiées, permission COMMANDES).
// ---------------------------------------------------------------------------

demandesInscriptionDepositaireRouter.get("/", requirePermission("COMMANDES", "LECTURE"), async (req, res, next) => {
  try {
    const statut = typeof req.query.statut === "string" ? req.query.statut : undefined;
    const demandes = await prisma.demandeInscriptionDepositaire.findMany({
      where: statut ? { statut: statut as "EN_ATTENTE" | "CONFIRMEE" | "REJETEE" | "ANNULEE" } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return res.json({ demandes: demandes.map(versDTO) });
  } catch (e) {
    next(e);
  }
});

/**
 * Confirme une inscription : crée le vrai Client (typeClient Dépositaire,
 * verrouillé côté serveur — jamais un choix laissé à l'appelant), avec la
 * zone choisie ICI par le Chargé des commandes (le visiteur ne connaît pas
 * le découpage interne, voir demandeInscriptionDepositaireConfirmerSchema).
 * Verrouillage optimiste contre le double-clic, même principe que les
 * demandes de commande.
 */
demandesInscriptionDepositaireRouter.post(
  "/:id/confirmer",
  requirePermission("COMMANDES", "ECRITURE"),
  async (req, res, next) => {
    try {
      const parsed = demandeInscriptionDepositaireConfirmerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
      }
      const demande = await prisma.demandeInscriptionDepositaire.findUnique({ where: { id: req.params.id } });
      if (!demande) return res.status(404).json({ erreur: "Demande introuvable" });
      if (demande.statut !== "EN_ATTENTE") {
        return res.status(409).json({ erreur: `Cette demande n'est plus en attente (statut : ${demande.statut}).` });
      }

      const zone = await prisma.zoneDepositaire.findUnique({ where: { id: parsed.data.zoneDepositaireId } });
      if (!zone) return res.status(400).json({ erreur: "Zone de dépôt inconnue" });

      const typeDepositaire = await prisma.typeClient.findUnique({ where: { nom: "Dépositaire" } });
      if (!typeDepositaire) {
        return res.status(500).json({ erreur: "Type de client « Dépositaire » introuvable — configuration incomplète." });
      }

      const reclamee = await prisma.demandeInscriptionDepositaire.updateMany({
        where: { id: demande.id, statut: "EN_ATTENTE" },
        data: { statut: "CONFIRMEE", traiteParId: req.utilisateur!.id, traiteLe: new Date() },
      });
      if (reclamee.count !== 1) {
        return res.status(409).json({ erreur: "Cette demande vient d'être traitée par quelqu'un d'autre." });
      }

      const client = await prisma.client.create({
        data: {
          nom: demande.nom,
          telephone: demande.telephone,
          adresse: demande.adresse,
          typeClientId: typeDepositaire.id,
          zoneDepositaireId: zone.id,
        },
      });
      await prisma.demandeInscriptionDepositaire.update({
        where: { id: demande.id },
        data: { clientCreeId: client.id },
      });

      return res.json({ demande: versDTO({ ...demande, statut: "CONFIRMEE", clientCreeId: client.id }), clientId: client.id });
    } catch (e) {
      next(e);
    }
  },
);

demandesInscriptionDepositaireRouter.post(
  "/:id/rejeter",
  requirePermission("COMMANDES", "ECRITURE"),
  async (req, res, next) => {
    try {
      const parsed = demandeInscriptionDepositaireRejeterSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
      }
      const demande = await prisma.demandeInscriptionDepositaire.findUnique({ where: { id: req.params.id } });
      if (!demande) return res.status(404).json({ erreur: "Demande introuvable" });
      if (demande.statut !== "EN_ATTENTE") {
        return res.status(409).json({ erreur: `Cette demande n'est plus en attente (statut : ${demande.statut}).` });
      }
      const reclamee = await prisma.demandeInscriptionDepositaire.updateMany({
        where: { id: demande.id, statut: "EN_ATTENTE" },
        data: { statut: "REJETEE", motifRejet: parsed.data.motif, traiteParId: req.utilisateur!.id, traiteLe: new Date() },
      });
      if (reclamee.count !== 1) {
        return res.status(409).json({ erreur: "Cette demande vient d'être traitée par quelqu'un d'autre." });
      }
      const maj = await prisma.demandeInscriptionDepositaire.findUniqueOrThrow({ where: { id: demande.id } });
      return res.json({ demande: versDTO(maj) });
    } catch (e) {
      next(e);
    }
  },
);
