import { Router } from "express";
import { Prisma, type MatierePremiere } from "@prisma/client";
import {
  formatQuantite,
  matiereCreateSchema,
  matiereUpdateSchema,
  mouvementCreateSchema,
  TYPE_MOUVEMENT_LABELS,
  type MatierePremiereDTO,
  type MouvementStockDTO,
  type TypeMouvementStock,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";
import { appliquerMouvement, emettreAlerteSeuil, ErreurStock, verifierAlertesSeuilStock } from "../services/stocks.js";

export const stocksRouter = Router();

stocksRouter.use(requireAuth);

const versMatiereDTO = (m: MatierePremiere): MatierePremiereDTO => ({
  id: m.id,
  nom: m.nom,
  unite: m.unite,
  quantiteStock: m.quantiteStock.toNumber(),
  seuilAlerte: m.seuilAlerte.toNumber(),
  sousSeuil: m.quantiteStock.toNumber() < m.seuilAlerte.toNumber(),
  code: m.code,
});

type MouvementAvecRelations = Prisma.MouvementStockGetPayload<{
  include: {
    matierePremiere: { select: { id: true; nom: true; unite: true } };
    auteur: { select: { id: true; nom: true } };
  };
}>;

const INCLUDE_MOUVEMENT = {
  matierePremiere: { select: { id: true, nom: true, unite: true } },
  auteur: { select: { id: true, nom: true } },
} as const;

const versMouvementDTO = (m: MouvementAvecRelations): MouvementStockDTO => ({
  id: m.id,
  matierePremiere: m.matierePremiere,
  type: m.type as TypeMouvementStock,
  quantite: m.quantite.toNumber(),
  reference: m.reference,
  auteur: m.auteur,
  date: m.date.toISOString(),
});

// --- Matières premières (CRUD) ---------------------------------------------

stocksRouter.get("/matieres", requirePermission("STOCKS", "LECTURE"), async (_req, res, next) => {
  try {
    await verifierAlertesSeuilStock();

    const matieres = await prisma.matierePremiere.findMany({ orderBy: { nom: "asc" } });
    res.json({ matieres: matieres.map(versMatiereDTO) });
  } catch (e) {
    next(e);
  }
});

stocksRouter.post("/matieres", requirePermission("STOCKS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = matiereCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { nom, unite, seuilAlerte, quantiteInitiale, code } = parsed.data;

    const existante = await prisma.matierePremiere.findUnique({ where: { nom } });
    if (existante) return res.status(409).json({ erreur: "Une matière première porte déjà ce nom" });

    if (code) {
      const dejaRelie = await prisma.matierePremiere.findUnique({ where: { code } });
      if (dejaRelie) {
        return res.status(409).json({
          erreur: `« ${dejaRelie.nom} » est déjà reliée à l'ingrédient ${code} — une seule matière peut porter ce lien`,
        });
      }
    }

    // Le stock de départ passe par le journal (mouvement ENTREE « Stock
    // initial ») pour que l'historique explique toujours la quantité en stock.
    const matiere = await prisma.$transaction(async (tx) => {
      const creee = await tx.matierePremiere.create({ data: { nom, unite, seuilAlerte, code: code ?? null } });
      if (quantiteInitiale > 0) {
        const { matiere: maj } = await appliquerMouvement(tx, {
          matierePremiereId: creee.id,
          type: "ENTREE",
          quantite: quantiteInitiale,
          reference: "Stock initial",
          auteurId: req.utilisateur!.id,
        });
        return maj;
      }
      return creee;
    });

    res.status(201).json({ matiere: versMatiereDTO(matiere) });
  } catch (e) {
    next(e);
  }
});

stocksRouter.put("/matieres/:id", requirePermission("STOCKS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = matiereUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existante = await prisma.matierePremiere.findUnique({ where: { id: req.params.id } });
    if (!existante) return res.status(404).json({ erreur: "Matière première introuvable" });

    if (parsed.data.code) {
      const dejaRelie = await prisma.matierePremiere.findUnique({ where: { code: parsed.data.code } });
      if (dejaRelie && dejaRelie.id !== existante.id) {
        return res.status(409).json({
          erreur: `« ${dejaRelie.nom} » est déjà reliée à l'ingrédient ${parsed.data.code} — une seule matière peut porter ce lien`,
        });
      }
    }

    const matiere = await prisma.matierePremiere.update({
      where: { id: existante.id },
      data: parsed.data,
    });

    // Relever le seuil peut faire passer la matière sous le seuil sans aucun
    // mouvement de stock : la vérification paresseuse rattrape ce cas ici,
    // immédiatement, plutôt que d'attendre le prochain chargement de l'écran.
    if (parsed.data.seuilAlerte !== undefined) await verifierAlertesSeuilStock();

    res.json({ matiere: versMatiereDTO(matiere) });
  } catch (e) {
    next(e);
  }
});

// Suppression bloquée si la matière a un historique de mouvements : le journal
// ne doit jamais être altéré rétroactivement.
stocksRouter.delete("/matieres/:id", requirePermission("STOCKS", "ECRITURE"), async (req, res, next) => {
  try {
    const matiere = await prisma.matierePremiere.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { mouvements: true } } },
    });
    if (!matiere) return res.status(404).json({ erreur: "Matière première introuvable" });
    if (matiere._count.mouvements > 0) {
      return res.status(409).json({
        erreur: "Suppression impossible : la matière a un historique de mouvements",
      });
    }
    await prisma.matierePremiere.delete({ where: { id: matiere.id } });
    res.status(204).end();
  } catch (e) {
    // Contrainte de clé étrangère non couverte par le contrôle ci-dessus
    // (ex. lien résiduel via IngredientRecette, cf. migration
    // 20260827120333_purger_recettes_orphelines) : message clair plutôt qu'une
    // erreur 500 générique, même idiome que typeClients.ts.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return res.status(409).json({
        erreur: "Suppression impossible : cette matière est encore référencée ailleurs (ex. une recette)",
      });
    }
    next(e);
  }
});

// --- Mouvements de stock (journal append-only) ------------------------------

stocksRouter.get("/mouvements", requirePermission("STOCKS", "LECTURE"), async (req, res, next) => {
  try {
    const { matiereId } = req.query as Record<string, string | undefined>;
    const mouvements = await prisma.mouvementStock.findMany({
      where: matiereId ? { matierePremiereId: matiereId } : {},
      include: INCLUDE_MOUVEMENT,
      orderBy: { date: "desc" },
      take: 100,
    });
    res.json({ mouvements: mouvements.map(versMouvementDTO) });
  } catch (e) {
    next(e);
  }
});

stocksRouter.post("/mouvements", requirePermission("STOCKS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = mouvementCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { matierePremiereId, type, quantite, reference } = parsed.data;

    const resultat = await prisma.$transaction(
      (tx) =>
        appliquerMouvement(tx, {
          matierePremiereId,
          type,
          quantite,
          reference,
          auteurId: req.utilisateur!.id,
        }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    const { matiere, franchitSeuil } = resultat;

    busEvenements.emettreEvenement({
      type: "MOUVEMENT_STOCK",
      module: "STOCKS",
      emetteurId: req.utilisateur!.id,
      evenementRef: matiere.id,
      message: `${TYPE_MOUVEMENT_LABELS[type]} de stock : ${matiere.nom} ${type === "ENTREE" ? "+" : "−"}${formatQuantite(quantite, matiere.unite)} (reste ${formatQuantite(matiere.quantiteStock.toNumber(), matiere.unite)})${reference ? ` — ${reference}` : ""}`,
      donnees: { matierePremiereId: matiere.id, type, quantite },
    });
    if (franchitSeuil) emettreAlerteSeuil(matiere, req.utilisateur!.id);

    res.status(201).json({ matiere: versMatiereDTO(matiere) });
  } catch (e) {
    if (e instanceof ErreurStock) return res.status(e.status).json({ erreur: e.message });
    next(e);
  }
});
