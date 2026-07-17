import { Router } from "express";
import { Prisma } from "@prisma/client";
import { calculerCommande, commandeCreateSchema, formatFc, type CommandeDTO } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";

export const commandesRouter = Router();

commandesRouter.use(requireAuth);

type CommandeAvecRelations = Prisma.CommandeClientGetPayload<{
  include: {
    client: { select: { id: true; nom: true; typeClient: { select: { nom: true } } } };
    creePar: { select: { id: true; nom: true } };
  };
}>;

const versCommandeDTO = (c: CommandeAvecRelations): CommandeDTO => ({
  id: c.id,
  numero: c.numero,
  dateCreation: c.dateCreation.toISOString(),
  client: { id: c.client.id, nom: c.client.nom },
  qualite: c.client.typeClient.nom,
  quantiteBacs: c.quantiteBacs,
  montantBrut: c.montantBrut,
  avanceUtilisee: c.avanceUtilisee,
  montantAPercevoir: c.montantAPercevoir,
  montantRecu: c.montantRecu,
  dette: c.dette,
  avanceGeneree: c.avanceGeneree,
  nouvelleAvance: c.nouvelleAvance,
  creePar: c.creePar ? { id: c.creePar.id, nom: c.creePar.nom } : null,
});

const INCLUDE_RELATIONS = {
  client: { select: { id: true, nom: true, typeClient: { select: { nom: true } } } },
  creePar: { select: { id: true, nom: true } },
} as const;

// Liste avec filtres : ?typeClientId= (Qualité), ?du=AAAA-MM-JJ, ?au=AAAA-MM-JJ.
// Sans filtre : tout afficher (les plus récentes d'abord).
commandesRouter.get("/", requirePermission("COMMANDES", "LECTURE"), async (req, res, next) => {
  try {
    const { typeClientId, du, au } = req.query as Record<string, string | undefined>;

    const dateCreation: Prisma.DateTimeFilter = {};
    if (du) dateCreation.gte = new Date(`${du}T00:00:00`);
    if (au) dateCreation.lte = new Date(`${au}T23:59:59.999`);

    const commandes = await prisma.commandeClient.findMany({
      where: {
        ...(typeClientId ? { client: { typeClientId } } : {}),
        ...(du || au ? { dateCreation } : {}),
      },
      include: INCLUDE_RELATIONS,
      orderBy: { numero: "desc" },
    });
    res.json({ commandes: commandes.map(versCommandeDTO) });
  } catch (e) {
    next(e);
  }
});

// Enregistrement d'une commande : tous les montants sont calculés
// automatiquement (section 3.4) — l'avance du client est déduite en premier,
// puis le solde d'avance du client est mis à jour, le tout atomiquement.
commandesRouter.post("/", requirePermission("COMMANDES", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = commandeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { clientId, quantiteBacs, montantRecu } = parsed.data;

    const commande = await prisma.$transaction(
      async (tx) => {
        const client = await tx.client.findUnique({
          where: { id: clientId },
          include: { typeClient: true },
        });
        if (!client) throw new ErreurClientInconnu();

        const calcul = calculerCommande({
          quantiteBacs,
          prixParBac: client.typeClient.prixParBac,
          avanceExistante: client.avanceDisponible,
          montantRecu,
        });

        const creee = await tx.commandeClient.create({
          data: {
            clientId: client.id,
            quantiteBacs,
            montantBrut: calcul.montantBrut,
            avanceUtilisee: calcul.avanceUtilisee,
            montantAPercevoir: calcul.montantAPercevoir,
            montantRecu,
            dette: calcul.dette,
            avanceGeneree: calcul.avanceGeneree,
            nouvelleAvance: calcul.nouvelleAvance,
            creeParId: req.utilisateur!.id,
          },
          include: INCLUDE_RELATIONS,
        });

        await tx.client.update({
          where: { id: client.id },
          data: { avanceDisponible: calcul.nouvelleAvance },
        });

        return creee;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const dto = versCommandeDTO(commande);

    busEvenements.emettreEvenement({
      type: "NOUVELLE_COMMANDE",
      module: "COMMANDES",
      emetteurId: req.utilisateur!.id,
      evenementRef: commande.id,
      message:
        `Commande n°${dto.numero} — ${dto.client.nom} (${dto.qualite}) : ${dto.quantiteBacs} bac(s), ` +
        `à percevoir ${formatFc(dto.montantAPercevoir)}, reçu ${formatFc(dto.montantRecu)}` +
        (dto.dette > 0 ? ` — dette ${formatFc(dto.dette)}` : "") +
        (dto.avanceGeneree > 0 ? ` — avance générée ${formatFc(dto.avanceGeneree)}` : ""),
      donnees: { commandeId: commande.id, numero: dto.numero },
    });

    res.status(201).json({ commande: dto });
  } catch (e) {
    if (e instanceof ErreurClientInconnu) {
      return res.status(400).json({ erreur: "Client inconnu" });
    }
    next(e);
  }
});

class ErreurClientInconnu extends Error {}
