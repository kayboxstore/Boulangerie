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
import { prisma, type TxClient } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";
import { appliquerMouvement, ErreurStock } from "../services/stocks.js";
import { auditerCaisseTx } from "../services/caisseAtomique.js";

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


class ErreurFournisseur extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
  }
}

class ErreurConflitFournisseur extends Error {
  constructor() {
    super("Conflit de concurrence persistant — réessayez. Rien n’a été enregistré.");
  }
}

function estConflitSerialisation(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return e.code === "P2034" || (e.code === "P2010" && (e.meta as { code?: string } | undefined)?.code === "40001");
}

async function avecReessaiSerializable<T>(operation: () => Promise<T>): Promise<T> {
  for (let tentative = 1; tentative <= 3; tentative++) {
    try {
      return await operation();
    } catch (e) {
      if (!estConflitSerialisation(e)) throw e;
      if (tentative === 3) throw new ErreurConflitFournisseur();
    }
  }
  throw new ErreurConflitFournisseur();
}

async function verrouillerFournisseur(tx: TxClient, id: string) {
  const ids = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Fournisseur" WHERE id = ${id} FOR UPDATE
  `;
  if (!ids[0]) throw new ErreurFournisseur(404, "Fournisseur introuvable");
  return tx.fournisseur.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { commandes: true } } },
  });
}

async function verrouillerCommande(tx: TxClient, id: string): Promise<CommandeAvecRelations> {
  const ids = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "CommandeFournisseur" WHERE id = ${id} FOR UPDATE
  `;
  if (!ids[0]) throw new ErreurFournisseur(404, "Commande introuvable");
  return tx.commandeFournisseur.findUniqueOrThrow({ where: { id }, include: INCLUDE_COMMANDE });
}

function repondreErreurFournisseur(e: unknown, res: import("express").Response, next: import("express").NextFunction) {
  if (e instanceof ErreurFournisseur) return res.status(e.status).json({ erreur: e.message });
  if (e instanceof ErreurConflitFournisseur) {
    return res.status(503).json({ code: "FOURNISSEUR_CONFLIT_CONCURRENCE", erreur: e.message });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    return res.status(409).json({ erreur: "Une donnée Fournisseur identique existe déjà" });
  }
  return next(e);
}

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
    return repondreErreurFournisseur(e, res, next);
  }
});

fournisseursRouter.put("/:id", requirePermission("FOURNISSEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = fournisseurUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const fournisseur = await avecReessaiSerializable(() =>
      prisma.$transaction(async (tx) => {
        const avant = await verrouillerFournisseur(tx, req.params.id);
        const resultat = await tx.fournisseur.updateMany({ where: { id: avant.id }, data: parsed.data });
        if (resultat.count !== 1) throw new ErreurFournisseur(409, "Le fournisseur vient d’être modifié");
        const apres = await tx.fournisseur.findUniqueOrThrow({
          where: { id: avant.id },
          include: { _count: { select: { commandes: true } } },
        });
        await auditerCaisseTx(tx, {
          module: "FOURNISSEURS",
          typeEntite: "Fournisseur",
          entiteId: avant.id,
          action: "MODIFICATION",
          avant: { ...avant },
          apres: { ...apres },
        });
        return apres;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
    res.json({ fournisseur: versFournisseurDTO(fournisseur) });
  } catch (e) {
    return repondreErreurFournisseur(e, res, next);
  }
});

// Suppression bloquée si le fournisseur a des commandes (historique conservé).
fournisseursRouter.delete("/:id", requirePermission("FOURNISSEURS", "ECRITURE"), async (req, res, next) => {
  try {
    await avecReessaiSerializable(() =>
      prisma.$transaction(async (tx) => {
        const fournisseur = await verrouillerFournisseur(tx, req.params.id);
        if (fournisseur._count.commandes > 0) {
          throw new ErreurFournisseur(409, "Suppression impossible : ce fournisseur a des commandes enregistrées");
        }
        const resultat = await tx.fournisseur.deleteMany({ where: { id: fournisseur.id } });
        if (resultat.count !== 1) throw new ErreurFournisseur(409, "Le fournisseur vient d’être modifié");
        await auditerCaisseTx(tx, {
          module: "FOURNISSEURS",
          typeEntite: "Fournisseur",
          entiteId: fournisseur.id,
          action: "SUPPRESSION",
          avant: { ...fournisseur },
          apres: null,
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
    res.status(204).end();
  } catch (e) {
    return repondreErreurFournisseur(e, res, next);
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

    const matiereIds = lignes.map((l) => l.matierePremiereId);
    if (new Set(matiereIds).size !== matiereIds.length) {
      return res.status(400).json({ erreur: "Une matière première apparaît deux fois dans la commande" });
    }

    const commande = await avecReessaiSerializable(() =>
      prisma.$transaction(async (tx) => {
        // Le verrou du fournisseur empêche sa suppression entre la validation
        // et la création de la commande.
        await verrouillerFournisseur(tx, fournisseurId);

        // FOR KEY SHARE protège les références contre une suppression
        // concurrente sans bloquer les mouvements ordinaires de stock.
        const idsTries = [...matiereIds].sort();
        const matieres = await tx.$queryRaw<{ id: string }[]>(
          Prisma.sql`SELECT id FROM "MatierePremiere"
            WHERE id IN (${Prisma.join(idsTries)})
            ORDER BY id
            FOR KEY SHARE`,
        );
        if (matieres.length !== idsTries.length) {
          throw new ErreurFournisseur(400, "Matière première inconnue dans la commande");
        }

        return tx.commandeFournisseur.create({
          data: {
            fournisseurId,
            creeParId: req.utilisateur!.id,
            lignes: { create: lignes },
          },
          include: INCLUDE_COMMANDE,
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
    res.status(201).json({ commande: versCommandeDTO(commande) });
  } catch (e) {
    return repondreErreurFournisseur(e, res, next);
  }
});

// Annulation d'un bon encore en attente (une commande reçue est de l'historique).
fournisseursRouter.delete("/commandes/:id", requirePermission("FOURNISSEURS", "ECRITURE"), async (req, res, next) => {
  try {
    await avecReessaiSerializable(() =>
      prisma.$transaction(async (tx) => {
        const commande = await verrouillerCommande(tx, req.params.id);
        if (commande.statut !== "EN_ATTENTE") {
          throw new ErreurFournisseur(409, "Cette commande a déjà été reçue");
        }
        const resultat = await tx.commandeFournisseur.deleteMany({
          where: { id: commande.id, statut: "EN_ATTENTE" },
        });
        if (resultat.count !== 1) throw new ErreurFournisseur(409, "La commande vient d’être modifiée");
        for (const ligne of commande.lignes) {
          await auditerCaisseTx(tx, {
            module: "FOURNISSEURS",
            typeEntite: "LigneCommandeFournisseur",
            entiteId: ligne.id,
            action: "SUPPRESSION",
            avant: { ...ligne },
            apres: null,
          });
        }
        await auditerCaisseTx(tx, {
          module: "FOURNISSEURS",
          typeEntite: "CommandeFournisseur",
          entiteId: commande.id,
          action: "SUPPRESSION",
          avant: { ...commande },
          apres: null,
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
    );
    res.status(204).end();
  } catch (e) {
    return repondreErreurFournisseur(e, res, next);
  }
});

// Réception de la marchandise (section 3.6) : passage EN_ATTENTE → RECUE et
// incrémentation du stock via des MouvementStock ENTREE (référence = la
// commande), dans UNE transaction sérialisable — même rigueur que la
// décrémentation de production (Phase 5), en sens inverse.
fournisseursRouter.post("/commandes/:id/reception", requirePermission("FOURNISSEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const recue = await avecReessaiSerializable(() =>
      prisma.$transaction(async (tx) => {
        const commande = await verrouillerCommande(tx, req.params.id);
        if (commande.statut !== "EN_ATTENTE") {
          throw new ErreurFournisseur(409, "Cette commande a déjà été reçue");
        }

        // Ordre global stable : deux réceptions touchant les mêmes matières
        // acquièrent toujours les verrous de stock dans le même ordre.
        const lignes = [...commande.lignes].sort((a, b) =>
          a.matierePremiereId.localeCompare(b.matierePremiereId),
        );
        for (const ligne of lignes) {
          await appliquerMouvement(tx, {
            matierePremiereId: ligne.matierePremiereId,
            type: "ENTREE",
            quantite: ligne.quantite.toNumber(),
            reference: `Commande fournisseur n°${commande.numero}`,
            commandeFournisseurId: commande.id,
            auteurId: req.utilisateur!.id,
          });
        }

        const passage = await tx.commandeFournisseur.updateMany({
          where: { id: commande.id, statut: "EN_ATTENTE" },
          data: { statut: "RECUE", dateReception: new Date(), recueParId: req.utilisateur!.id },
        });
        if (passage.count !== 1) throw new ErreurFournisseur(409, "La commande vient d’être réceptionnée");
        const apres = await tx.commandeFournisseur.findUniqueOrThrow({
          where: { id: commande.id },
          include: INCLUDE_COMMANDE,
        });
        await auditerCaisseTx(tx, {
          module: "FOURNISSEURS",
          typeEntite: "CommandeFournisseur",
          entiteId: commande.id,
          action: "MODIFICATION",
          avant: { ...commande },
          apres: { ...apres },
        });
        return apres;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }),
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
    return repondreErreurFournisseur(e, res, next);
  }
});
