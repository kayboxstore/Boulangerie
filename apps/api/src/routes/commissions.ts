import { Router } from "express";
import { Prisma } from "@prisma/client";
import { montantTotalPaye, type CommissionLigneDTO } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const commissionsRouter = Router();

commissionsRouter.use(requireAuth);

// Module Commissions (section 3.11) : vue dérivée des commandes dont la
// qualité du client génère une commission (> 0 Fc/bac — les « Mamans »).
// Lecture seule : Caissier(ère) et DG via la matrice de permissions.
commissionsRouter.get("/", requirePermission("COMMISSIONS", "LECTURE"), async (req, res, next) => {
  try {
    const { du, au } = req.query as Record<string, string | undefined>;

    const dateCreation: Prisma.DateTimeFilter = {};
    if (du) dateCreation.gte = new Date(`${du}T00:00:00`);
    if (au) dateCreation.lte = new Date(`${au}T23:59:59.999`);

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
