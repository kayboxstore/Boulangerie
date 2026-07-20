import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  commandeFournisseurCreateSchema,
  formatFc,
  formatQuantite,
  fournisseurCreateSchema,
  fournisseurUpdateSchema,
  type CommandeFournisseurDTO,
  type FournisseurDTO,
  type StatutCommandeFournisseur,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";
import { appliquerMouvement, ErreurStock } from "../services/stocks.js";

export const fournisseursRouter = Router();

fournisseursRouter.use(requireAuth);

const versFournisseurDTO = (f: {
  id: string;
  nom: string;
  contact: string | null;
  _count: { commandes: number };
}): FournisseurDTO => ({
  id: f.id,
  nom: f.nom,
  contact: f.contact,
  nombreCommandes: f._count.commandes,
});

type CommandeAvecRelations = Prisma.CommandeFournisseurGetPayload<{
  include: {
    fournisseur: { select: { id: true; nom: true } };
    creePar: { select: { id: true; nom: true } };
    recuePar: { select: { id: true; nom: true } };
    lignes: { include: { matierePremiere: { select: { id: true; nom: true; unite: true } } } };
  };
}>;

const INCLUDE_COMMANDE = {
  fournisseur: { select: { id: true, nom: true } },
  creePar: { select: { id: true, nom: true } },
  recuePar: { select: { id: true, nom: true } },
  lignes: { include: { matierePremiere: { select: { id: true, nom: true, unite: true } } } },
} as const;

const versCommandeDTO = (c: CommandeAvecRelations): CommandeFournisseurDTO => {
  const lignes = c.lignes.map((l) => {
    const quantite = l.quantite.toNumber();
    return {
      id: l.id,
      matierePremiere: l.matierePremiere,
      quantite,
      prixUnitaire: l.prixUnitaire,
      sousTotal: Math.round(quantite * l.prixUnitaire),
    };
  });
  return {
    id: c.id,
    numero: c.numero,
    fournisseur: c.fournisseur,
    statut: c.statut as StatutCommandeFournisseur,
    date: c.date.toISOString(),
    dateReception: c.dateReception?.toISOString() ?? null,
    creePar: c.creePar,
    recuePar: c.recuePar,
    lignes,
    total: lignes.reduce((s, l) => s + l.sousTotal, 0),
  };
};

// --- Fournisseurs (CRUD) ----------------------------------------------------

fournisseursRouter.get("/", requirePermission("FOURNISSEURS", "LECTURE"), async (_req, res, next) => {
  try {
    const fournisseurs = await prisma.fournisseur.findMany({
      include: { _count: { select: { commandes: true } } },
      orderBy: { nom: "asc" },
    });
    res.json({ fournisseurs: fournisseurs.map(versFournisseurDTO) });
  } catch (e) {
    next(e);
  }
});

fournisseursRouter.post("/", requirePermission("FOURNISSEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = fournisseurCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existant = await prisma.fournisseur.findUnique({ where: { nom: parsed.data.nom } });
    if (existant) return res.status(409).json({ erreur: "Un fournisseur porte déjà ce nom" });

    const fournisseur = await prisma.fournisseur.create({
      data: { nom: parsed.data.nom, contact: parsed.data.contact ?? null },
      include: { _count: { select: { commandes: true } } },
    });
    res.status(201).json({ fournisseur: versFournisseurDTO(fournisseur) });
  } catch (e) {
    next(e);
  }
});

fournisseursRouter.put("/:id", requirePermission("FOURNISSEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = fournisseurUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existant = await prisma.fournisseur.findUnique({ where: { id: req.params.id } });
    if (!existant) return res.status(404).json({ erreur: "Fournisseur introuvable" });

    const fournisseur = await prisma.fournisseur.update({
      where: { id: existant.id },
      data: parsed.data,
      include: { _count: { select: { commandes: true } } },
    });
    res.json({ fournisseur: versFournisseurDTO(fournisseur) });
  } catch (e) {
    next(e);
  }
});

// Suppression bloquée si le fournisseur a des commandes (historique conservé).
fournisseursRouter.delete("/:id", requirePermission("FOURNISSEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const fournisseur = await prisma.fournisseur.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { commandes: true } } },
    });
    if (!fournisseur) return res.status(404).json({ erreur: "Fournisseur introuvable" });
    if (fournisseur._count.commandes > 0) {
      return res.status(409).json({ erreur: "Suppression impossible : ce fournisseur a des commandes enregistrées" });
    }
    await prisma.fournisseur.delete({ where: { id: fournisseur.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// --- Commandes fournisseur (bons de commande) -------------------------------

fournisseursRouter.get("/commandes", requirePermission("FOURNISSEURS", "LECTURE"), async (req, res, next) => {
  try {
    const { statut } = req.query as Record<string, string | undefined>;
    const commandes = await prisma.commandeFournisseur.findMany({
      where: statut === "EN_ATTENTE" || statut === "RECUE" ? { statut } : {},
      include: INCLUDE_COMMANDE,
      orderBy: { numero: "desc" },
      take: 60,
    });
    res.json({ commandes: commandes.map(versCommandeDTO) });
  } catch (e) {
    next(e);
  }
});

fournisseursRouter.post("/commandes", requirePermission("FOURNISSEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = commandeFournisseurCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { fournisseurId, lignes } = parsed.data;

    const fournisseur = await prisma.fournisseur.findUnique({ where: { id: fournisseurId } });
    if (!fournisseur) return res.status(404).json({ erreur: "Fournisseur introuvable" });

    const matiereIds = lignes.map((l) => l.matierePremiereId);
    if (new Set(matiereIds).size !== matiereIds.length) {
      return res.status(400).json({ erreur: "Une matière première apparaît deux fois dans la commande" });
    }
    const matieres = await prisma.matierePremiere.count({ where: { id: { in: matiereIds } } });
    if (matieres !== matiereIds.length) {
      return res.status(400).json({ erreur: "Matière première inconnue dans la commande" });
    }

    const commande = await prisma.commandeFournisseur.create({
      data: {
        fournisseurId,
        creeParId: req.utilisateur!.id,
        lignes: { create: lignes },
      },
      include: INCLUDE_COMMANDE,
    });
    res.status(201).json({ commande: versCommandeDTO(commande) });
  } catch (e) {
    next(e);
  }
});

// Annulation d'un bon encore en attente (une commande reçue est de l'historique).
fournisseursRouter.delete("/commandes/:id", requirePermission("FOURNISSEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const commande = await prisma.commandeFournisseur.findUnique({ where: { id: req.params.id } });
    if (!commande) return res.status(404).json({ erreur: "Commande introuvable" });
    if (commande.statut !== "EN_ATTENTE") {
      return res.status(409).json({ erreur: "Cette commande a déjà été reçue" });
    }
    await prisma.commandeFournisseur.delete({ where: { id: commande.id } }); // lignes en cascade
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Réception de la marchandise (section 3.6) : passage EN_ATTENTE → RECUE et
// incrémentation du stock via des MouvementStock ENTREE (référence = la
// commande), dans UNE transaction sérialisable — même rigueur que la
// décrémentation de production (Phase 5), en sens inverse.
fournisseursRouter.post("/commandes/:id/reception", requirePermission("FOURNISSEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const commande = await prisma.commandeFournisseur.findUnique({
      where: { id: req.params.id },
      include: INCLUDE_COMMANDE,
    });
    if (!commande) return res.status(404).json({ erreur: "Commande introuvable" });

    const recue = await prisma.$transaction(
      async (tx) => {
        // Verrou logique : seule une commande encore EN_ATTENTE est réceptionnée
        // (l'updateMany conditionnel évite une double réception concurrente).
        const passage = await tx.commandeFournisseur.updateMany({
          where: { id: commande.id, statut: "EN_ATTENTE" },
          data: { statut: "RECUE", dateReception: new Date(), recueParId: req.utilisateur!.id },
        });
        if (passage.count === 0) throw new ErreurStock(409, "Cette commande a déjà été reçue");

        for (const ligne of commande.lignes) {
          await appliquerMouvement(tx, {
            matierePremiereId: ligne.matierePremiereId,
            type: "ENTREE",
            quantite: ligne.quantite.toNumber(),
            reference: `Commande fournisseur n°${commande.numero}`,
            commandeFournisseurId: commande.id,
            auteurId: req.utilisateur!.id,
          });
        }

        return tx.commandeFournisseur.findUniqueOrThrow({
          where: { id: commande.id },
          include: INCLUDE_COMMANDE,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const dto = versCommandeDTO(recue);
    const detail = dto.lignes
      .map((l) => `${formatQuantite(l.quantite, l.matierePremiere.unite)} ${l.matierePremiere.nom}`)
      .join(", ");
    busEvenements.emettreEvenement({
      type: "RECEPTION_FOURNISSEUR",
      module: "FOURNISSEURS",
      emetteurId: req.utilisateur!.id,
      evenementRef: dto.id,
      message: `Réception fournisseur — commande n°${dto.numero} (${dto.fournisseur.nom}) : ${detail}, total ${formatFc(dto.total)}`,
      donnees: { commandeFournisseurId: dto.id, numero: dto.numero, total: dto.total },
    });

    res.json({ commande: dto });
  } catch (e) {
    if (e instanceof ErreurStock) return res.status(e.status).json({ erreur: e.message });
    next(e);
  }
});
