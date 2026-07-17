import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  calculerCommande,
  commandeCreateSchema,
  formatFc,
  reglementCreateSchema,
  type CommandeDTO,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";

export const commandesRouter = Router();

commandesRouter.use(requireAuth);

type CommandeAvecRelations = Prisma.CommandeClientGetPayload<{
  include: {
    client: { select: { id: true; nom: true; typeClient: { select: { nom: true } } } };
    creePar: { select: { id: true; nom: true } };
    reglements: {
      include: { enregistrePar: { select: { id: true; nom: true } } };
      orderBy: { date: "asc" };
    };
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
  reglements: c.reglements.map((r) => ({
    id: r.id,
    montant: r.montant,
    date: r.date.toISOString(),
    enregistrePar: r.enregistrePar ? { id: r.enregistrePar.id, nom: r.enregistrePar.nom } : null,
  })),
});

const INCLUDE_RELATIONS = {
  client: { select: { id: true, nom: true, typeClient: { select: { nom: true } } } },
  creePar: { select: { id: true, nom: true } },
  reglements: {
    include: { enregistrePar: { select: { id: true, nom: true } } },
    orderBy: { date: "asc" },
  },
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

// Règlement d'une dette (section 3.4) : le montant s'ajoute au montant reçu,
// puis dette / avance générée / nouvelle avance sont recalculées avec la même
// fonction que pour une commande. Le trop-versé devient une avance du client.
commandesRouter.post("/:id/reglements", requirePermission("COMMANDES", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = reglementCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { montant } = parsed.data;

    const resultat = await prisma.$transaction(
      async (tx) => {
        const commande = await tx.commandeClient.findUnique({
          where: { id: req.params.id },
          include: { client: true },
        });
        if (!commande) return { erreur: 404 as const };
        if (commande.dette <= 0) return { erreur: 409 as const };

        // Recalcul à périmètre constant : mêmes bacs, même avance utilisée à
        // l'époque (avanceExistante = avanceUtilisee reproduit brut/àPercevoir
        // à l'identique) — seul le montant reçu cumulé change.
        const calcul = calculerCommande({
          quantiteBacs: commande.quantiteBacs,
          prixParBac: commande.montantBrut / commande.quantiteBacs,
          avanceExistante: commande.avanceUtilisee,
          montantRecu: commande.montantRecu + montant,
        });
        const deltaAvance = calcul.avanceGeneree - commande.avanceGeneree;

        await tx.paiementCommande.create({
          data: {
            commandeClientId: commande.id,
            montant,
            enregistreParId: req.utilisateur!.id,
          },
        });
        const maj = await tx.commandeClient.update({
          where: { id: commande.id },
          data: {
            montantRecu: commande.montantRecu + montant,
            dette: calcul.dette,
            avanceGeneree: calcul.avanceGeneree,
            nouvelleAvance: commande.nouvelleAvance + deltaAvance,
          },
          include: INCLUDE_RELATIONS,
        });
        await tx.client.update({
          where: { id: commande.clientId },
          data: { avanceDisponible: commande.client.avanceDisponible + deltaAvance },
        });
        return { commande: maj };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if ("erreur" in resultat) {
      return resultat.erreur === 404
        ? res.status(404).json({ erreur: "Commande introuvable" })
        : res.status(409).json({ erreur: "Cette commande n'a pas de dette à régler" });
    }

    const dto = versCommandeDTO(resultat.commande);

    busEvenements.emettreEvenement({
      type: "REGLEMENT_COMMANDE",
      module: "COMMANDES",
      emetteurId: req.utilisateur!.id,
      evenementRef: dto.id,
      message:
        `Règlement de ${formatFc(montant)} sur la commande n°${dto.numero} — ${dto.client.nom}` +
        (dto.dette > 0 ? ` — dette restante ${formatFc(dto.dette)}` : " — dette soldée") +
        (dto.avanceGeneree > 0 ? ` — avance générée ${formatFc(dto.avanceGeneree)}` : ""),
      donnees: { commandeId: dto.id, numero: dto.numero, montant },
    });

    res.status(201).json({ commande: dto });
  } catch (e) {
    next(e);
  }
});

class ErreurClientInconnu extends Error {}
