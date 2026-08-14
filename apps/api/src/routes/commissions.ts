import { Router } from "express";
import { Prisma } from "@prisma/client";
import { dateISOSchema, montantTotalPaye, type CommissionLigneDTO } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { bornesJourLomoto } from "../lib/temps.js";

export const commissionsRouter = Router();

commissionsRouter.use(requireAuth);

// Module Commissions (section 3.11) : vue dérivée des commandes dont la
// qualité du client génère une commission (> 0 Fc/bac — les « Mamans »).
// Lecture seule : Caissier(ère) et DG via la matrice de permissions.
commissionsRouter.get("/", requirePermission("COMMISSIONS", "LECTURE"), async (req, res, next) => {
  try {
    const { du, au } = req.query as Record<string, string | undefined>;

    if (du && !dateISOSchema.safeParse(du).success) {
      return res.status(400).json({ erreur: "Date de début invalide (AAAA-MM-JJ)" });
    }
    if (au && !dateISOSchema.safeParse(au).success) {
      return res.status(400).json({ erreur: "Date de fin invalide (AAAA-MM-JJ)" });
    }
    if (du && au && du > au) {
      return res.status(400).json({ erreur: "La date de fin doit suivre la date de début" });
    }

    const dateCreation: Prisma.DateTimeFilter = {};
    if (du) dateCreation.gte = bornesJourLomoto(du)[0];
    if (au) dateCreation.lte = bornesJourLomoto(au)[1];

    const commandes = await prisma.commandeClient.findMany({
      where: {
        client: { typeClient: { commissionParBac: { gt: 0 } } },
        ...(du || au ? { dateCreation } : {}),
      },
      include: {
        client: { select: { nom: true, typeClient: { select: { commissionParBac: true } } } },
      },
      orderBy: { numero: "desc" },
    });

    const lignes: CommissionLigneDTO[] = commandes.map((c) => ({
      commandeId: c.id,
      numero: c.numero,
      dateCreation: c.dateCreation.toISOString(),
      clientNom: c.client.nom,
      quantiteBacs: c.quantiteBacs,
      montantTotalPaye: montantTotalPaye(c),
      commission: c.quantiteBacs * c.client.typeClient.commissionParBac,
    }));

    res.json({
      commissions: lignes,
      totalCommissions: lignes.reduce((somme, l) => somme + l.commission, 0),
    });
  } catch (e) {
    next(e);
  }
});
