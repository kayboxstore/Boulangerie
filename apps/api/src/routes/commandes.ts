import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  avanceAvantCommande,
  calculerCommande,
  commandeCreateSchema,
  formatFc,
  reglementCreateSchema,
  type AlerteDetteDTO,
  type CommandeDTO,
  type LivraisonsDuJourDTO,
  type ResumeCommandesJourDTO,
  type StrategieDoublon,
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

/** Bornes [début, fin] du jour local contenant `d`. */
function bornesDuJour(d: Date): [Date, Date] {
  const debut = new Date(d);
  debut.setHours(0, 0, 0, 0);
  const fin = new Date(d);
  fin.setHours(23, 59, 59, 999);
  return [debut, fin];
}

// Résumé du jour (section 3.4) — accessible en lecture à tous les rôles ayant
// accès au module Commandes (Chargé des commandes, Caissier(ère), DG).
commandesRouter.get("/resume-jour", requirePermission("COMMANDES", "LECTURE"), async (_req, res, next) => {
  try {
    const [debut, fin] = bornesDuJour(new Date());
    const duJour = await prisma.commandeClient.findMany({
      where: { dateCreation: { gte: debut, lte: fin } },
      select: { quantiteBacs: true, montantAPercevoir: true, montantRecu: true, dette: true },
    });
    const somme = (f: (c: (typeof duJour)[number]) => number) => duJour.reduce((s, c) => s + f(c), 0);
    const avecDette = duJour.filter((c) => c.dette > 0);

    const dto: ResumeCommandesJourDTO = {
      date: debut.toISOString().slice(0, 10),
      nombreCommandes: duJour.length,
      totalBacs: somme((c) => c.quantiteBacs),
      totalAPercevoir: somme((c) => c.montantAPercevoir),
      totalRecu: somme((c) => c.montantRecu),
      nbSoldees: duJour.length - avecDette.length,
      nbAvecDette: avecDette.length,
      totalDettes: avecDette.reduce((s, c) => s + c.dette, 0),
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});

// Totaux livrés du jour par client (Bon de livraison — module Production),
// pour pré-remplir « Nombre de bacs reçus » à la création d'une commande. Pas
// de lien rigide entre les deux modules : simple indice, modifiable par
// l'utilisateur. ?date= optionnel (AAAA-MM-JJ), sinon aujourd'hui.
commandesRouter.get("/livraisons-du-jour", requirePermission("COMMANDES", "LECTURE"), async (req, res, next) => {
  try {
    const { date } = req.query as Record<string, string | undefined>;
    const dateStr = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : jourISO(new Date());
    const dateObj = new Date(dateStr);

    const bons = await prisma.bonLivraison.findMany({
      where: { date: dateObj },
      include: { lignes: true },
    });

    const totauxParClientId: Record<string, number> = {};
    for (const bon of bons) {
      totauxParClientId[bon.clientId] = bon.lignes.reduce((s, l) => s + l.quantite, 0);
    }

    const dto: LivraisonsDuJourDTO = { date: dateStr, totauxParClientId };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});

/**
 * Alerte « dette non payée » (section 3.4) — vérification PARESSEUSE, sans
 * tâche planifiée : elle tourne au chargement de l'app pour les rôles ayant
 * accès à Commandes, sur le même principe que l'expiration des délégations
 * (évaluée à la date plutôt que par un cron).
 *
 * Sont concernées les commandes créées AVANT aujourd'hui dont la dette reste
 * ouverte. La notification part une seule fois par commande : `updateMany`
 * gardé sur `alerteDetteEnvoyeeLe: null` fait office de compare-and-set atomique,
 * donc deux connexions simultanées ne peuvent pas produire de doublon.
 *
 * L'événement est SYSTÈME (aucun émetteur humain) : les destinataires sont tous
 * les rôles ayant lecture sur Commandes — Chargé des commandes, Caissier(ère)
 * et DG.
 */
async function verifierAlertesDette(): Promise<void> {
  const [debutAujourdhui] = bornesDuJour(new Date());

  const enRetard = await prisma.commandeClient.findMany({
    where: {
      dette: { gt: 0 },
      dateCreation: { lt: debutAujourdhui },
      alerteDetteEnvoyeeLe: null,
    },
    include: { client: { select: { nom: true } } },
    take: 200,
  });

  for (const c of enRetard) {
    // Compare-and-set : seule la première tentative passe.
    const { count } = await prisma.commandeClient.updateMany({
      where: { id: c.id, alerteDetteEnvoyeeLe: null },
      data: { alerteDetteEnvoyeeLe: new Date() },
    });
    if (count !== 1) continue;

    busEvenements.emettreEvenement({
      type: "DETTE_NON_PAYEE",
      module: "COMMANDES",
      emetteurId: null, // déclenchée par le système
      evenementRef: c.id,
      priorite: "HAUTE",
      message: `Dette non payée — commande n°${c.numero} (${c.client.nom}) : ${formatFc(c.dette)} restant dû depuis le ${jourISO(c.dateCreation)}`,
      donnees: { commandeId: c.id, numero: c.numero, dette: c.dette },
    });
  }
}

const jourISO = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Déclenche la vérification paresseuse puis renvoie les dettes en retard encore
 * ouvertes. La notification ne part qu'une fois ; la liste, elle, reste affichée
 * dans le module tant que la dette n'est pas soldée.
 */
commandesRouter.get("/alertes-dette", requirePermission("COMMANDES", "LECTURE"), async (_req, res, next) => {
  try {
    await verifierAlertesDette();

    const [debutAujourdhui] = bornesDuJour(new Date());
    const enRetard = await prisma.commandeClient.findMany({
      where: { dette: { gt: 0 }, dateCreation: { lt: debutAujourdhui } },
      include: { client: { select: { nom: true } } },
      orderBy: { dateCreation: "asc" },
      take: 100,
    });

    const alertes: AlerteDetteDTO[] = enRetard.map((c) => ({
      commandeId: c.id,
      numero: c.numero,
      clientNom: c.client.nom,
      dette: c.dette,
      dateCreation: c.dateCreation.toISOString(),
      joursDepuis: Math.max(
        1,
        Math.floor((debutAujourdhui.getTime() - bornesDuJour(c.dateCreation)[0].getTime()) / 86_400_000),
      ),
      alerteEnvoyeeLe: c.alerteDetteEnvoyeeLe?.toISOString() ?? null,
    }));
    res.json({ alertes });
  } catch (e) {
    next(e);
  }
});

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

/**
 * Enregistrement d'une commande (section 3.4). Tous les montants sont calculés
 * automatiquement — l'avance du client est déduite en premier, puis son solde
 * est mis à jour, le tout atomiquement.
 *
 * UNE SEULE COMMANDE PAR CLIENT ET PAR JOUR : si le client a déjà une commande
 * aujourd'hui, on ne crée jamais de seconde ligne.
 *  - sans `strategie` → 409 portant la commande en conflit, pour que l'UI
 *    propose le choix à l'utilisateur ;
 *  - avec `strategie` → UPDATE de la commande existante (même numéro) :
 *    MODIFIER additionne la saisie, REMPLACER l'écrase.
 */
commandesRouter.post("/", requirePermission("COMMANDES", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = commandeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { clientId, quantiteBacs, montantRecu, strategie } = parsed.data;

    const resultat = await prisma.$transaction(
      async (tx) => {
        const client = await tx.client.findUnique({
          where: { id: clientId },
          include: { typeClient: true },
        });
        if (!client) throw new ErreurClientInconnu();

        const [debut, fin] = bornesDuJour(new Date());
        const existante = await tx.commandeClient.findFirst({
          where: { clientId: client.id, dateCreation: { gte: debut, lte: fin } },
          include: INCLUDE_RELATIONS,
          orderBy: { numero: "asc" },
        });

        // --- Cas 1 : pas de doublon → création normale ---------------------
        if (!existante) {
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
          return { type: "creee" as const, commande: creee };
        }

        // --- Cas 2 : doublon sans choix → on demande à l'utilisateur --------
        if (!strategie) {
          return { type: "conflit" as const, existante };
        }

        // --- Cas 3 : doublon avec choix → UPDATE de la MÊME commande -------
        // Remplacer écrase l'ancienne saisie : les règlements déjà encaissés
        // sur cette commande n'auraient plus de contrepartie cohérente (leur
        // somme dépasserait le montant reçu). On refuse plutôt que de les
        // effacer silencieusement — Modifier reste disponible.
        if (strategie === "REMPLACER" && existante.reglements.length > 0) {
          return { type: "reglementsPresents" as const, existante };
        }

        const totaux =
          strategie === "MODIFIER"
            ? {
                quantiteBacs: existante.quantiteBacs + quantiteBacs,
                montantRecu: existante.montantRecu + montantRecu,
              }
            : { quantiteBacs, montantRecu };

        // L'avance à considérer est celle du client AVANT cette commande :
        // on inverse l'effet qu'elle a déjà appliqué sur son solde, pour ne pas
        // le compter deux fois (la commande est mise à jour, pas dupliquée).
        const avanceExistante = avanceAvantCommande({
          avanceDisponibleClient: client.avanceDisponible,
          avanceUtilisee: existante.avanceUtilisee,
          avanceGeneree: existante.avanceGeneree,
        });

        const calcul = calculerCommande({
          quantiteBacs: totaux.quantiteBacs,
          prixParBac: client.typeClient.prixParBac,
          avanceExistante,
          montantRecu: totaux.montantRecu,
        });

        const maj = await tx.commandeClient.update({
          where: { id: existante.id },
          data: {
            quantiteBacs: totaux.quantiteBacs,
            montantBrut: calcul.montantBrut,
            avanceUtilisee: calcul.avanceUtilisee,
            montantAPercevoir: calcul.montantAPercevoir,
            montantRecu: totaux.montantRecu,
            dette: calcul.dette,
            avanceGeneree: calcul.avanceGeneree,
            nouvelleAvance: calcul.nouvelleAvance,
          },
          include: INCLUDE_RELATIONS,
        });
        await tx.client.update({
          where: { id: client.id },
          data: { avanceDisponible: calcul.nouvelleAvance },
        });
        return { type: "miseAJour" as const, commande: maj, strategie };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (resultat.type === "conflit") {
      const existant = versCommandeDTO(resultat.existante);
      return res.status(409).json({
        erreur: `${existant.client.nom} a déjà la commande n°${existant.numero} aujourd'hui (${existant.quantiteBacs} bac(s), reçu ${formatFc(existant.montantRecu)}). Choisissez Modifier ou Remplacer.`,
        conflit: true,
        commandeExistante: existant,
        apercu: {
          MODIFIER: {
            quantiteBacs: existant.quantiteBacs + quantiteBacs,
            montantRecu: existant.montantRecu + montantRecu,
          },
          REMPLACER: { quantiteBacs, montantRecu },
        },
      });
    }

    if (resultat.type === "reglementsPresents") {
      return res.status(409).json({
        erreur: `La commande n°${resultat.existante.numero} a déjà reçu ${resultat.existante.reglements.length} règlement(s) : elle ne peut pas être remplacée. Utilisez « Modifier ».`,
      });
    }

    const dto = versCommandeDTO(resultat.commande);
    const prefixe =
      resultat.type === "creee"
        ? `Commande n°${dto.numero}`
        : `Commande n°${dto.numero} ${(resultat.strategie as StrategieDoublon) === "MODIFIER" ? "modifiée" : "remplacée"}`;

    busEvenements.emettreEvenement({
      type: "NOUVELLE_COMMANDE",
      module: "COMMANDES",
      emetteurId: req.utilisateur!.id,
      evenementRef: dto.id,
      message:
        `${prefixe} — ${dto.client.nom} (${dto.qualite}) : ${dto.quantiteBacs} bac(s), ` +
        `à percevoir ${formatFc(dto.montantAPercevoir)}, reçu ${formatFc(dto.montantRecu)}` +
        (dto.dette > 0 ? ` — dette ${formatFc(dto.dette)}` : "") +
        (dto.avanceGeneree > 0 ? ` — avance générée ${formatFc(dto.avanceGeneree)}` : ""),
      donnees: { commandeId: dto.id, numero: dto.numero, strategie: resultat.type === "miseAJour" ? resultat.strategie : null },
    });

    res.status(resultat.type === "creee" ? 201 : 200).json({ commande: dto });
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
