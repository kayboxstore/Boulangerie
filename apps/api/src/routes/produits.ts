import { Router } from "express";
import { produitCreateSchema, produitUpdateSchema } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { traiterActionCritique } from "../services/actionsCritiques.js";

export const produitsRouter = Router();

produitsRouter.use(requireAuth);

// Le catalogue produits est une donnée de référence partagée : lecture pour
// tout utilisateur authentifié. L'écriture relève des Paramètres (section 3.9),
// réservée à l'Administrateur.
const ecritureParametres = requirePermission("PARAMETRES", "ECRITURE");

produitsRouter.get("/", async (_req, res, next) => {
  try {
    const inclureArchives = _req.query.inclureArchives === "true";
    const produits = await prisma.produit.findMany({
      where: inclureArchives ? undefined : { actif: true },
      orderBy: { nom: "asc" },
    });
    res.json({ produits });
  } catch (e) {
    next(e);
  }
});

produitsRouter.get("/:id", async (req, res, next) => {
  try {
    const produit = await prisma.produit.findUnique({ where: { id: req.params.id } });
    if (!produit) return res.status(404).json({ erreur: "Produit introuvable" });
    res.json({ produit });
  } catch (e) {
    next(e);
  }
});

produitsRouter.post("/", ecritureParametres, async (req, res, next) => {
  try {
    const parsed = produitCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existant = await prisma.produit.findUnique({ where: { nom: parsed.data.nom } });
    if (existant) {
      return res.status(409).json({
        erreur: existant.actif
          ? "Un produit porte déjà ce nom"
          : "Un produit archivé porte déjà ce nom. Réactivez-le au lieu d'en créer un nouveau.",
      });
    }

    const produit = await prisma.produit.create({ data: parsed.data });
    res.status(201).json({ produit });
  } catch (e) {
    next(e);
  }
});

produitsRouter.put("/:id", ecritureParametres, async (req, res, next) => {
  try {
    const parsed = produitUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existant = await prisma.produit.findUnique({ where: { id: req.params.id } });
    if (!existant) return res.status(404).json({ erreur: "Produit introuvable" });

    // Modifier le taux de taxe est une tâche critique (section 2) : différée pour
    // un Admin secondaire. Une modification qui ne touche PAS le taux (nom, prix,
    // catégorie…) reste une action directe.
    const changeTaux = parsed.data.tauxTaxe !== undefined && parsed.data.tauxTaxe !== existant.tauxTaxe;
    if (changeTaux) {
      const r = await traiterActionCritique(
        req,
        "MODIFIER_TAUX_TAXE",
        {
          produitId: existant.id,
          data:
            parsed.data.actif === false
              ? { ...parsed.data, archiveLe: new Date(), archiveParId: req.utilisateur!.id }
              : parsed.data.actif === true
                ? { ...parsed.data, archiveLe: null, archiveParId: null }
                : parsed.data,
        },
        `modifier le taux de taxe de « ${existant.nom} » (${existant.tauxTaxe} % → ${parsed.data.tauxTaxe} %)`,
      );
      return res.status(r.http).json(r.body);
    }

    const donnees =
      parsed.data.actif === false
        ? { ...parsed.data, archiveLe: new Date(), archiveParId: req.utilisateur!.id }
        : parsed.data.actif === true
          ? { ...parsed.data, archiveLe: null, archiveParId: null }
          : parsed.data;
    const produit = await prisma.produit.update({ where: { id: req.params.id }, data: donnees });
    res.json({ produit });
  } catch (e) {
    next(e);
  }
});

produitsRouter.delete("/:id", ecritureParametres, async (req, res, next) => {
  try {
    const existant = await prisma.produit.findUnique({ where: { id: req.params.id } });
    if (!existant) return res.status(404).json({ erreur: "Produit introuvable" });

    if (existant.actif) {
      await prisma.produit.update({
        where: { id: req.params.id },
        data: { actif: false, archiveLe: new Date(), archiveParId: req.utilisateur!.id },
      });
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
