import { Router } from "express";
import { Prisma } from "@prisma/client";
import { formatFc, venteCreateSchema, type ClotureCaisseDTO, type VenteDTO } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";
import { seuilAlerteTransaction } from "../lib/parametres.js";

export const caisseRouter = Router();

caisseRouter.use(requireAuth);

type VenteAvecRelations = Prisma.VenteGetPayload<{
  include: {
    vendeur: { select: { id: true; nom: true } };
    lignes: { include: { produit: { select: { nom: true } } } };
  };
}>;

const INCLUDE_VENTE = {
  vendeur: { select: { id: true, nom: true } },
  lignes: { include: { produit: { select: { nom: true } } } },
} as const;

const versVenteDTO = (v: VenteAvecRelations): VenteDTO => ({
  id: v.id,
  numero: v.numero,
  date: v.date.toISOString(),
  vendeur: v.vendeur ? { id: v.vendeur.id, nom: v.vendeur.nom } : null,
  total: v.total,
  totalTaxe: v.totalTaxe,
  moyenPaiement: v.moyenPaiement,
  clotureId: v.clotureId,
  lignes: v.lignes.map((l) => ({
    id: l.id,
    produitId: l.produitId,
    produitNom: l.produit.nom,
    quantite: l.quantite,
    prixUnitaire: l.prixUnitaire,
    tauxTaxe: l.tauxTaxe,
  })),
});

const versClotureDTO = (c: {
  id: string;
  date: Date;
  caissier: { id: string; nom: string } | null;
  nombreVentes: number;
  totalVentes: number;
  totalEspeces: number;
  totalMobileMoney: number;
  totalCarte: number;
}): ClotureCaisseDTO => ({
  id: c.id,
  date: c.date.toISOString(),
  caissier: c.caissier ? { id: c.caissier.id, nom: c.caissier.nom } : null,
  nombreVentes: c.nombreVentes,
  totalVentes: c.totalVentes,
  totalEspeces: c.totalEspeces,
  totalMobileMoney: c.totalMobileMoney,
  totalCarte: c.totalCarte,
});

// Ventes : ?du/?au (dates), ?ouvertes=1 pour les ventes non clôturées.
caisseRouter.get("/ventes", requirePermission("CAISSE", "LECTURE"), async (req, res, next) => {
  try {
    const { du, au, ouvertes } = req.query as Record<string, string | undefined>;
    const date: Prisma.DateTimeFilter = {};
    if (du) date.gte = new Date(`${du}T00:00:00`);
    if (au) date.lte = new Date(`${au}T23:59:59.999`);

    const ventes = await prisma.vente.findMany({
      where: {
        ...(du || au ? { date } : {}),
        ...(ouvertes ? { clotureId: null } : {}),
      },
      include: INCLUDE_VENTE,
      orderBy: { numero: "desc" },
    });
    res.json({ ventes: ventes.map(versVenteDTO) });
  } catch (e) {
    next(e);
  }
});

// Encaissement (section 3.1) : prix et taux de taxe lus en base (jamais depuis
// le client). Le pain est exonéré (tauxTaxe = 0) — la taxe éventuelle vient
// des produits hors pain, au taux configuré par produit.
caisseRouter.post("/ventes", requirePermission("CAISSE", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = venteCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { moyenPaiement, lignes } = parsed.data;

    const produits = await prisma.produit.findMany({
      where: { id: { in: lignes.map((l) => l.produitId) }, actif: true },
    });
    const parId = new Map(produits.map((p) => [p.id, p]));
    if (parId.size !== new Set(lignes.map((l) => l.produitId)).size) {
      return res.status(400).json({ erreur: "Produit inconnu ou inactif dans le panier" });
    }

    let total = 0;
    let totalTaxe = 0;
    const lignesData = lignes.map((l) => {
      const produit = parId.get(l.produitId)!;
      const sousTotal = produit.prixVente * l.quantite;
      total += sousTotal;
      totalTaxe += Math.round((sousTotal * produit.tauxTaxe) / 100);
      return {
        produitId: produit.id,
        quantite: l.quantite,
        prixUnitaire: produit.prixVente,
        tauxTaxe: produit.tauxTaxe,
      };
    });

    const vente = await prisma.vente.create({
      data: {
        vendeurId: req.utilisateur!.id,
        total,
        totalTaxe,
        moyenPaiement,
        lignes: { create: lignesData },
      },
      include: INCLUDE_VENTE,
    });
    const dto = versVenteDTO(vente);

    busEvenements.emettreEvenement({
      type: "NOUVELLE_VENTE",
      module: "CAISSE",
      emetteurId: req.utilisateur!.id,
      evenementRef: vente.id,
      message: `Vente n°${dto.numero} — ${formatFc(dto.total)} (${dto.lignes.reduce((n, l) => n + l.quantite, 0)} article(s), ${moyenPaiement.toLowerCase().replace("_", " ")})`,
      donnees: { venteId: vente.id, numero: dto.numero, total: dto.total },
    });

    // Alerte transaction inhabituelle (3.10) : dédiée au DG, priorité haute.
    const seuil = await seuilAlerteTransaction();
    if (total > seuil) {
      busEvenements.emettreEvenement({
        type: "TRANSACTION_INHABITUELLE",
        module: "CAISSE",
        emetteurId: req.utilisateur!.id,
        evenementRef: vente.id,
        priorite: "HAUTE",
        restreindreAuxRoles: ["Directeur Général"],
        message: `⚠ Transaction inhabituelle : vente n°${dto.numero} de ${formatFc(total)} — au-dessus du seuil de ${formatFc(seuil)}`,
        donnees: { venteId: vente.id, numero: dto.numero, total, seuil },
      });
    }

    res.status(201).json({ vente: dto });
  } catch (e) {
    next(e);
  }
});

// Clôture de caisse journalière : rassemble toutes les ventes non clôturées,
// fige les totaux par moyen de paiement.
caisseRouter.post("/cloture", requirePermission("CAISSE", "ECRITURE"), async (req, res, next) => {
  try {
    const resultat = await prisma.$transaction(
      async (tx) => {
        const ouvertes = await tx.vente.findMany({ where: { clotureId: null } });
        if (ouvertes.length === 0) return null;

        const totalPar = (moyen: string) =>
          ouvertes.filter((v) => v.moyenPaiement === moyen).reduce((s, v) => s + v.total, 0);

        const cloture = await tx.clotureCaisse.create({
          data: {
            caissierId: req.utilisateur!.id,
            nombreVentes: ouvertes.length,
            totalVentes: ouvertes.reduce((s, v) => s + v.total, 0),
            totalEspeces: totalPar("ESPECES"),
            totalMobileMoney: totalPar("MOBILE_MONEY"),
            totalCarte: totalPar("CARTE"),
          },
          include: { caissier: { select: { id: true, nom: true } } },
        });
        await tx.vente.updateMany({
          where: { id: { in: ouvertes.map((v) => v.id) } },
          data: { clotureId: cloture.id },
        });
        return cloture;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (!resultat) {
      return res.status(409).json({ erreur: "Aucune vente à clôturer" });
    }

    const dto = versClotureDTO(resultat);
    busEvenements.emettreEvenement({
      type: "CLOTURE_CAISSE",
      module: "CAISSE",
      emetteurId: req.utilisateur!.id,
      evenementRef: dto.id,
      message: `Clôture de caisse — ${dto.nombreVentes} vente(s), total ${formatFc(dto.totalVentes)} (espèces ${formatFc(dto.totalEspeces)}, mobile money ${formatFc(dto.totalMobileMoney)}, carte ${formatFc(dto.totalCarte)})`,
      donnees: { clotureId: dto.id, totalVentes: dto.totalVentes },
    });

    res.status(201).json({ cloture: dto });
  } catch (e) {
    next(e);
  }
});

caisseRouter.get("/clotures", requirePermission("CAISSE", "LECTURE"), async (_req, res, next) => {
  try {
    const clotures = await prisma.clotureCaisse.findMany({
      include: { caissier: { select: { id: true, nom: true } } },
      orderBy: { date: "desc" },
      take: 30,
    });
    res.json({ clotures: clotures.map(versClotureDTO) });
  } catch (e) {
    next(e);
  }
});
