import { Router, type NextFunction, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import {
  bonLivraisonJourSchema,
  aAcces,
  controleQualiteSchema,
  formatQuantite,
  NOMS_PRODUITS_SCHEMA_COMMANDE,
  pertesJustifiees,
  planningCreateSchema,
  productionCreateSchema,
  productionPertesSchema,
  schemaCommandeJourSchema,
  totalDestinationsBacs,
  type BonLivraisonClientDTO,
  type BonLivraisonJourDTO,
  type CodeIngredient,
  type EcartsProductionDTO,
  type LigneEcartDTO,
  type MotifDonDTO,
  type MotifNonConformiteDTO,
  type MotifPerteDTO,
  type PlanningProductionDTO,
  type ProductionDTO,
  type SchemaCommandeClientDTO,
  type SchemaCommandeJourDTO,
} from "@lomoto/shared";
import { prisma, type TxClient } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";
import { construirePdfBonsLivraison, nomFichierPdf } from "../services/pdf.js";
import { appliquerMouvement, emettreAlerteSeuil, ErreurStock } from "../services/stocks.js";
import { auditerCaisseTx } from "../services/caisseAtomique.js";
import {
  ErreurCycleLivraison,
  synchroniserPrevisionsCycles,
} from "../services/cyclesLivraison.js";

export const productionRouter = Router();

productionRouter.use(requireAuth);

const lecture = requirePermission("PRODUCTION", "LECTURE");
const ecriture = requirePermission("PRODUCTION", "ECRITURE");
const ecriturePrevision = (req: Request, res: Response, next: NextFunction) => {
  const permissions = req.utilisateur?.role.permissions ?? [];
  if (aAcces(permissions, "COMMANDES", "ECRITURE") || aAcces(permissions, "PRODUCTION", "ECRITURE")) return next();
  return res.status(403).json({
    code: "ACTION_NON_AUTORISEE",
    erreur: "Écriture Commandes ou Production requise pour transmettre une prévision",
  });
};

const dec = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());
const jour = (d: Date) => d.toISOString().slice(0, 10);

class ErreurPlanningConcurrent extends Error {}

class ErreurBonLivraison extends Error {
  constructor(
    message: string,
    readonly statutHttp: 400 | 409 | 503,
    readonly code: string,
  ) {
    super(message);
  }
}

function estConflitPlanning(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return (
    e.code === "P2002" ||
    e.code === "P2034" ||
    (e.code === "P2010" && (e.meta as { code?: string } | undefined)?.code === "40001")
  );
}

// --- Planning de production (section 3.3 a) ---------------------------------

type PlanningAvecRelations = Prisma.PlanningProductionGetPayload<{
  include: {
    lignes: { include: { produit: { select: { id: true; nom: true } } } };
    creePar: { select: { id: true; nom: true } };
  };
}>;

const INCLUDE_PLANNING = {
  lignes: { include: { produit: { select: { id: true, nom: true } } } },
  creePar: { select: { id: true, nom: true } },
} as const;

/**
 * Sérialise les remplacements d'un Planning existant. Le verrou précède toute
 * suppression de ligne ; la relecture faite ensuite fournit donc l'instantané
 * exact à modifier et à auditer. Une création concurrente (aucune ligne encore
 * verrouillable) est arbitrée par SERIALIZABLE + l'unicité de datePrevue.
 */
async function verrouillerPlanningParDate(tx: TxClient, datePrevue: Date): Promise<PlanningAvecRelations | null> {
  const ids = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "PlanningProduction" WHERE "datePrevue" = ${datePrevue} FOR UPDATE
  `;
  if (!ids[0]) return null;
  return tx.planningProduction.findUniqueOrThrow({
    where: { id: ids[0].id },
    include: INCLUDE_PLANNING,
  });
}

const versPlanningDTO = (p: PlanningAvecRelations): PlanningProductionDTO => ({
  id: p.id,
  datePrevue: jour(p.datePrevue),
  nombreBacsCommandes: p.nombreBacsCommandes,
  lignes: p.lignes.map((l) => ({
    produitId: l.produitId,
    produitNom: l.produit.nom,
    quantitePrevue: l.quantitePrevue,
  })),
  sacsFarinePrevus: p.sacsFarinePrevus.toNumber(),
  paquetsLevurePrevus: p.paquetsLevurePrevus.toNumber(),
  quantiteHuilePrevue: p.quantiteHuilePrevue.toNumber(),
  kgSelPrevus: p.kgSelPrevus.toNumber(),
  observations: p.observations,
  creePar: p.creePar,
});

productionRouter.get("/planning", lecture, async (req, res, next) => {
  try {
    const { du, au } = req.query as Record<string, string | undefined>;
    const datePrevue: Prisma.DateTimeFilter = {};
    if (du) datePrevue.gte = new Date(du);
    if (au) datePrevue.lte = new Date(au);

    const plannings = await prisma.planningProduction.findMany({
      where: du || au ? { datePrevue } : {},
      include: INCLUDE_PLANNING,
      orderBy: { datePrevue: "desc" },
      take: 60,
    });
    res.json({ plannings: plannings.map(versPlanningDTO) });
  } catch (e) {
    next(e);
  }
});

// Une seule planification par date (contrainte d'unicité) : un envoi sur une
// date déjà planifiée met à jour la planification existante plutôt que d'échouer.
productionRouter.post("/planning", ecriture, async (req, res, next) => {
  try {
    const parsed = planningCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { datePrevue, lignes, observations, ...previsions } = parsed.data;

    const produitIds = lignes.map((l) => l.produitId);
    if (new Set(produitIds).size !== produitIds.length) {
      return res.status(400).json({ erreur: "Un produit apparaît deux fois dans le détail" });
    }
    if (produitIds.length > 0) {
      const connus = await prisma.produit.count({ where: { id: { in: produitIds } } });
      if (connus !== produitIds.length) {
        return res.status(400).json({ erreur: "Produit inconnu dans le détail du planning" });
      }
    }

    const date = new Date(datePrevue);
    const donnees = { ...previsions, nombreBacsCommandes: parsed.data.nombreBacsCommandes, observations: observations ?? null };

    const planning = await prisma.$transaction(async (tx) => {
      const existant = await verrouillerPlanningParDate(tx, date);
      if (existant) {
        // Le remplacement complet reste atomique avec ses AuditLog : aucun
        // update() singulier intercepté par l'extension non transactionnelle.
        await tx.planningLigneProduit.deleteMany({ where: { planningId: existant.id } });
        const resultat = await tx.planningProduction.updateMany({
          where: { id: existant.id },
          data: donnees,
        });
        if (resultat.count !== 1) {
          throw new ErreurPlanningConcurrent("La planification a été modifiée simultanément");
        }
        if (lignes.length > 0) {
          await tx.planningLigneProduit.createMany({
            data: lignes.map((ligne) => ({ ...ligne, planningId: existant.id })),
          });
        }
        const modifie = await tx.planningProduction.findUniqueOrThrow({
          where: { id: existant.id },
          include: INCLUDE_PLANNING,
        });
        for (const ancienneLigne of existant.lignes) {
          await auditerCaisseTx(tx, {
            module: "PRODUCTION",
            typeEntite: "PlanningLigneProduit",
            entiteId: ancienneLigne.id,
            action: "SUPPRESSION",
            avant: { ...ancienneLigne },
            apres: null,
          });
        }
        await auditerCaisseTx(tx, {
          module: "PRODUCTION",
          typeEntite: "PlanningProduction",
          entiteId: existant.id,
          action: "MODIFICATION",
          avant: { ...existant },
          apres: { ...modifie },
        });
        return modifie;
      }
      return tx.planningProduction.create({
        data: { ...donnees, datePrevue: date, creeParId: req.utilisateur!.id, lignes: { create: lignes } },
        include: INCLUDE_PLANNING,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.status(201).json({ planning: versPlanningDTO(planning) });
  } catch (e) {
    if (e instanceof ErreurPlanningConcurrent || estConflitPlanning(e)) {
      return res.status(409).json({
        code: "PREVISION_VERROUILLEE",
        erreur: e instanceof ErreurPlanningConcurrent
          ? e.message
          : "La prévision a été modifiée simultanément. Rechargez les données avant de réessayer.",
      });
    }
    return next(e);
  }
});

productionRouter.delete("/planning/:id", ecriture, async (req, res, next) => {
  try {
    const planning = await prisma.planningProduction.findUnique({ where: { id: req.params.id } });
    if (!planning) return res.status(404).json({ erreur: "Planification introuvable" });
    await prisma.planningProduction.delete({ where: { id: planning.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// --- Schéma de commande (section 3.3 d) -------------------------------------
//
// Digitalise la « Fiche de commande » papier : pour une date donnée, chaque
// Dépositaire et chaque Maman apparaît en ligne, avec son détail par produit.
// Enregistrer un Schéma remplace AUTOMATIQUEMENT le nombre de bacs et les
// lignes du Planning de production de cette même date — les prévisions
// d'ingrédients et les observations du Planning restent, elles, saisies à la
// main (voir /planning ci-dessus).

/** Un seul chemin de lecture pour le GET et pour la réponse du PUT (source unique de vérité). */
async function chargerSchemaCommandeJour(date: string): Promise<SchemaCommandeJourDTO> {
  const dateObj = new Date(date);

  const [produitsCatalogue, clients, schemasExistants] = await Promise.all([
    prisma.produit.findMany({ where: { nom: { in: [...NOMS_PRODUITS_SCHEMA_COMMANDE] } } }),
    prisma.client.findMany({
      where: { typeClient: { nom: { in: ["Dépositaire", "Maman"] } } },
      include: { typeClient: { select: { nom: true } }, zoneDepositaire: { select: { nom: true } } },
      orderBy: { nom: "asc" },
    }),
    prisma.schemaCommande.findMany({ where: { date: dateObj }, include: { lignes: true } }),
  ]);

  // Ordre fixe (celui de la fiche papier), pas l'ordre alphabétique renvoyé par la requête.
  const produits = NOMS_PRODUITS_SCHEMA_COMMANDE.map((nom) => produitsCatalogue.find((p) => p.nom === nom)).filter(
    (p): p is (typeof produitsCatalogue)[number] => !!p,
  );

  const schemaParClientId = new Map(schemasExistants.map((s) => [s.clientId, s]));

  const clientsDTO: SchemaCommandeClientDTO[] = clients.map((c) => {
    const existant = schemaParClientId.get(c.id);
    const quantiteParProduitId = new Map((existant?.lignes ?? []).map((l) => [l.produitId, l.quantite]));
    const lignes = produits.map((p) => ({
      produitId: p.id,
      produitNom: p.nom,
      quantite: quantiteParProduitId.get(p.id) ?? 0,
    }));
    return {
      clientId: c.id,
      clientNom: c.nom,
      typeClientNom: c.typeClient.nom,
      zoneDepositaireId: c.zoneDepositaireId,
      zoneDepositaireNom: c.zoneDepositaire?.nom ?? null,
      lignes,
      total: lignes.reduce((s, l) => s + l.quantite, 0),
    };
  });

  const totauxParProduit = produits.map((p) => ({
    produitId: p.id,
    produitNom: p.nom,
    quantite: clientsDTO.reduce((s, c) => s + (c.lignes.find((l) => l.produitId === p.id)?.quantite ?? 0), 0),
  }));

  return {
    date,
    clients: clientsDTO,
    totauxParProduit,
    totalGeneral: totauxParProduit.reduce((s, t) => s + t.quantite, 0),
  };
}

productionRouter.get("/schema-commande", lecture, async (req, res, next) => {
  try {
    const { date } = req.query as Record<string, string | undefined>;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ erreur: "Date requise (AAAA-MM-JJ)" });
    }
    res.json(await chargerSchemaCommandeJour(date));
  } catch (e) {
    next(e);
  }
});

productionRouter.put("/schema-commande", ecriturePrevision, async (req, res, next) => {
  try {
    const parsed = schemaCommandeJourSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { date, clients } = parsed.data;

    const clientIds = clients.map((c) => c.clientId);
    if (new Set(clientIds).size !== clientIds.length) {
      return res.status(400).json({ erreur: "Un client apparaît deux fois dans le schéma" });
    }
    const produitIds = [...new Set(clients.flatMap((c) => c.lignes.map((l) => l.produitId)))];
    if (clientIds.length > 0) {
      const clientsConnus = await prisma.client.count({ where: { id: { in: clientIds } } });
      if (clientsConnus !== clientIds.length) {
        return res.status(400).json({ erreur: "Client inconnu dans le schéma" });
      }
    }
    if (produitIds.length > 0) {
      const produitsConnus = await prisma.produit.count({ where: { id: { in: produitIds } } });
      if (produitsConnus !== produitIds.length) {
        return res.status(400).json({ erreur: "Produit inconnu dans le schéma" });
      }
    }

    const dateObj = new Date(date);

    await prisma.$transaction(async (tx) => {
      // C4 conserve l'identifiant de chaque cycle : les prévisions encore
      // neuves sont mises à jour en place, tandis qu'une étape aval verrouille
      // la suppression et la modification. Le Planning reste dans cette même
      // transaction, donc aucun des deux côtés ne peut diverger.
      await synchroniserPrevisionsCycles(tx, dateObj, clients, req.utilisateur!.id);

      // Alimentation automatique du Planning de production : le nombre de
      // bacs et le détail par produit deviennent ceux du Schéma. Un Planning
      // déjà existant pour cette date garde ses prévisions d'ingrédients et
      // ses observations, saisies à part.
      const totauxParProduitId = new Map<string, number>();
      for (const c of clients) {
        for (const l of c.lignes) {
          if (l.quantite <= 0) continue;
          totauxParProduitId.set(l.produitId, (totauxParProduitId.get(l.produitId) ?? 0) + l.quantite);
        }
      }
      const lignesPlanning = [...totauxParProduitId.entries()].map(([produitId, quantitePrevue]) => ({
        produitId,
        quantitePrevue,
      }));
      const nombreBacsCommandes = lignesPlanning.reduce((s, l) => s + l.quantitePrevue, 0);

      const planningExistant = await verrouillerPlanningParDate(tx, dateObj);
      if (planningExistant) {
        await tx.planningLigneProduit.deleteMany({ where: { planningId: planningExistant.id } });
        const resultat = await tx.planningProduction.updateMany({
          where: { id: planningExistant.id },
          data: { nombreBacsCommandes },
        });
        if (resultat.count !== 1) {
          throw new ErreurPlanningConcurrent("La planification a été modifiée simultanément");
        }
        if (lignesPlanning.length > 0) {
          await tx.planningLigneProduit.createMany({
            data: lignesPlanning.map((ligne) => ({ ...ligne, planningId: planningExistant.id })),
          });
        }
        const planningModifie = await tx.planningProduction.findUniqueOrThrow({
          where: { id: planningExistant.id },
          include: INCLUDE_PLANNING,
        });
        for (const ancienneLigne of planningExistant.lignes) {
          await auditerCaisseTx(tx, {
            module: "PRODUCTION",
            typeEntite: "PlanningLigneProduit",
            entiteId: ancienneLigne.id,
            action: "SUPPRESSION",
            avant: { ...ancienneLigne },
            apres: null,
          });
        }
        await auditerCaisseTx(tx, {
          module: "PRODUCTION",
          typeEntite: "PlanningProduction",
          entiteId: planningExistant.id,
          action: "MODIFICATION",
          avant: { ...planningExistant },
          apres: { ...planningModifie },
        });
      } else if (lignesPlanning.length > 0) {
        await tx.planningProduction.create({
          data: {
            datePrevue: dateObj,
            nombreBacsCommandes,
            creeParId: req.utilisateur!.id,
            lignes: { create: lignesPlanning },
          },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const schema = await chargerSchemaCommandeJour(date);
    busEvenements.emettreEvenement({
      type: "PREVISION_TRANSMISE",
      module: "PRODUCTION",
      emetteurId: req.utilisateur!.id,
      evenementRef: date,
      message: `Prévision transmise pour le ${date} — ${schema.totalGeneral} bac(s)`,
      donnees: { date, nombreClients: schema.clients.length, totalGeneral: schema.totalGeneral },
    });
    res.json(schema);
  } catch (e) {
    if (e instanceof ErreurCycleLivraison) {
      return res.status(e.statutHttp).json({
        code: e.code,
        erreur: e.message,
        ...(e.versionCourante === undefined ? {} : { versionCourante: e.versionCourante }),
      });
    }
    if (e instanceof ErreurPlanningConcurrent) {
      return res.status(409).json({
        code: "PREVISION_VERROUILLEE",
        erreur: e.message,
      });
    }
    if (estConflitPlanning(e)) {
      return res.status(409).json({
        code: "PREVISION_VERROUILLEE",
        erreur: "La prévision a été modifiée simultanément. Rechargez les données avant de réessayer.",
      });
    }
    next(e);
  }
});

// --- Bon de livraison (section 3.3 e) ----------------------------------------
//
// Digitalise le « Bon de livraison » papier : pour une date donnée, chaque
// Dépositaire livré apparaît en ligne, avec son détail par produit LIVRÉ, les
// bacs vides repris et les observations relevées à la livraison. Saisie
// VOLONTAIREMENT INDÉPENDANTE du Schéma de commande — aucune alimentation
// automatique dans un sens ni dans l'autre, la quantité livrée pouvant
// différer de la quantité commandée (rupture, ajustement de dernière minute).

async function chargerBonLivraisonJour(date: string): Promise<BonLivraisonJourDTO> {
  const dateObj = new Date(date);

  const [produitsCatalogue, clients, bonsExistants, schemasExistants] = await Promise.all([
    prisma.produit.findMany({ where: { nom: { in: [...NOMS_PRODUITS_SCHEMA_COMMANDE] } } }),
    prisma.client.findMany({
      where: { typeClient: { nom: "Dépositaire" } },
      include: { zoneDepositaire: { select: { nom: true } } },
      orderBy: { nom: "asc" },
    }),
    prisma.bonLivraison.findMany({ where: { date: dateObj }, include: { lignes: true } }),
    prisma.schemaCommande.findMany({ where: { date: dateObj }, include: { lignes: true } }),
  ]);

  const produits = NOMS_PRODUITS_SCHEMA_COMMANDE.map((nom) => produitsCatalogue.find((p) => p.nom === nom)).filter(
    (p): p is (typeof produitsCatalogue)[number] => !!p,
  );

  const bonParClientId = new Map(bonsExistants.map((b) => [b.clientId, b]));
  const totalCommandeParClientId = new Map(
    schemasExistants.map((s) => [s.clientId, s.lignes.reduce((sum, l) => sum + l.quantite, 0)]),
  );

  const clientsDTO: BonLivraisonClientDTO[] = clients.map((c) => {
    const existant = bonParClientId.get(c.id);
    const quantiteParProduitId = new Map((existant?.lignes ?? []).map((l) => [l.produitId, l.quantite]));
    const lignes = produits.map((p) => ({
      produitId: p.id,
      produitNom: p.nom,
      quantite: quantiteParProduitId.get(p.id) ?? 0,
    }));
    return {
      clientId: c.id,
      clientNom: c.nom,
      zoneDepositaireId: c.zoneDepositaireId,
      zoneDepositaireNom: c.zoneDepositaire?.nom ?? null,
      lignes,
      bacsVides: existant?.bacsVides ?? 0,
      livrePar: existant?.livrePar ?? null,
      observations: existant?.observations ?? null,
      total: lignes.reduce((s, l) => s + l.quantite, 0),
      totalCommande: totalCommandeParClientId.get(c.id) ?? 0,
    };
  });

  const totauxParProduit = produits.map((p) => ({
    produitId: p.id,
    produitNom: p.nom,
    quantite: clientsDTO.reduce((s, c) => s + (c.lignes.find((l) => l.produitId === p.id)?.quantite ?? 0), 0),
  }));

  return {
    date,
    clients: clientsDTO,
    totauxParProduit,
    totalGeneral: totauxParProduit.reduce((s, t) => s + t.quantite, 0),
    totalBacsVides: clientsDTO.reduce((s, c) => s + c.bacsVides, 0),
  };
}

productionRouter.get("/bons-livraison", lecture, async (req, res, next) => {
  try {
    const { date } = req.query as Record<string, string | undefined>;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ erreur: "Date requise (AAAA-MM-JJ)" });
    }
    res.json(await chargerBonLivraisonJour(date));
  } catch (e) {
    next(e);
  }
});

productionRouter.put("/bons-livraison", ecriture, async (req, res, next) => {
  try {
    const parsed = bonLivraisonJourSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { date, clients } = parsed.data;
    const clientIds = clients.map((client) => client.clientId);
    if (new Set(clientIds).size !== clientIds.length) {
      return res.status(400).json({ erreur: "Un client apparaît deux fois dans le bon de livraison" });
    }
    const produitIds = [...new Set(clients.flatMap((client) => client.lignes.map((ligne) => ligne.produitId)))];
    const dateObj = new Date(date);

    await prisma.$transaction(async (tx) => {
      // Le verrou de journée couvre aussi une journée encore vide. Les verrous
      // de lignes qui suivent rendent la sauvegarde incompatible avec un retour
      // physique concurrent et figent les références jusqu'au commit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"bon-livraison:" + date}))`;
      await tx.$queryRaw`
        SELECT c.id
        FROM "CycleLivraison" c
        JOIN "SchemaCommande" s ON s.id = c."schemaCommandeId"
        WHERE s.date = ${dateObj}
        FOR UPDATE OF c
      `;
      await tx.$queryRaw`SELECT id FROM "BonLivraison" WHERE date = ${dateObj} FOR UPDATE`;

      if (clientIds.length > 0) {
        const clientsConnus = await tx.client.findMany({
          where: { id: { in: clientIds }, typeClient: { nom: "Dépositaire" } },
          select: { id: true },
        });
        if (clientsConnus.length !== clientIds.length) {
          throw new ErreurBonLivraison("Client inconnu ou non Dépositaire dans le bon de livraison", 400, "CLIENT_INVALIDE");
        }
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Client" WHERE id IN (${Prisma.join([...clientIds].sort())}) FOR KEY SHARE`,
        );
      }
      if (produitIds.length > 0) {
        const produitsConnus = await tx.produit.findMany({
          where: { id: { in: produitIds } },
          select: { id: true },
        });
        if (produitsConnus.length !== produitIds.length) {
          throw new ErreurBonLivraison("Produit inconnu dans le bon de livraison", 400, "PRODUIT_INVALIDE");
        }
        await tx.$queryRaw(
          Prisma.sql`SELECT id FROM "Produit" WHERE id IN (${Prisma.join([...produitIds].sort())}) FOR KEY SHARE`,
        );
      }

      const retourPhysique = await tx.cycleLivraison.findFirst({
        where: { bonRetourne: true, schemaCommande: { date: dateObj } },
        select: { id: true },
      });
      if (retourPhysique) {
        throw new ErreurBonLivraison(
          "Les bons de cette journée sont figés : un bon physique a déjà été retourné",
          409,
          "BON_PHYSIQUE_DEJA_RETOURNE",
        );
      }

      const existants = await tx.bonLivraison.findMany({
        where: { date: dateObj },
        include: { lignes: true },
        orderBy: { id: "asc" },
      });
      const suppression = await tx.bonLivraison.deleteMany({ where: { date: dateObj } });
      if (suppression.count !== existants.length) {
        throw new ErreurBonLivraison(
          "Les bons ont été modifiés simultanément. Rechargez avant de réessayer.",
          409,
          "BONS_MODIFIES_SIMULTANEMENT",
        );
      }
      // Audit après la suppression réelle, mais dans la même transaction :
      // une panne d'AuditLog restaure donc exactement les bons et leurs lignes.
      // La cascade/deleteMany ne traverse jamais l'extension automatique.
      for (const bon of existants) {
        for (const ligne of [...bon.lignes].sort((a, b) => a.id.localeCompare(b.id))) {
          await auditerCaisseTx(tx, {
            module: "PRODUCTION",
            typeEntite: "BonLivraisonLigne",
            entiteId: ligne.id,
            action: "SUPPRESSION",
            avant: ligne,
            apres: null,
          });
        }
        await auditerCaisseTx(tx, {
          module: "PRODUCTION",
          typeEntite: "BonLivraison",
          entiteId: bon.id,
          action: "SUPPRESSION",
          avant: bon,
          apres: null,
        });
      }

      for (const client of clients) {
        const lignesUtiles = client.lignes.filter((ligne) => ligne.quantite > 0);
        const aUneValeur =
          lignesUtiles.length > 0 ||
          client.bacsVides > 0 ||
          !!client.livrePar ||
          !!client.observations;
        if (!aUneValeur) continue;
        await tx.bonLivraison.create({
          data: {
            date: dateObj,
            clientId: client.clientId,
            bacsVides: client.bacsVides,
            livrePar: client.livrePar || null,
            observations: client.observations || null,
            creeParId: req.utilisateur!.id,
            lignes: { create: lignesUtiles },
          },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    res.json(await chargerBonLivraisonJour(date));
  } catch (e) {
    if (e instanceof ErreurBonLivraison) {
      return res.status(e.statutHttp).json({ code: e.code, erreur: e.message });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
      return res.status(503).json({
        code: "BONS_CONCURRENCE_PERSISTANTE",
        erreur: "Conflit de concurrence sur les bons de livraison. Réessayez, aucune donnée partielle n'a été enregistrée.",
      });
    }
    next(e);
  }
});

// PDF imprimable (une fiche par Dépositaire livré) : lecture seule (comme
// l'export de rapports, section 3.13) — ne modifie rien, juste un export des
// données déjà enregistrées.
productionRouter.get("/bons-livraison/pdf", lecture, async (req, res, next) => {
  try {
    const { date } = req.query as Record<string, string | undefined>;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ erreur: "Date requise (AAAA-MM-JJ)" });
    }
    const jour = await chargerBonLivraisonJour(date);
    const aLivrer = jour.clients.filter((c) => c.total > 0 || c.bacsVides > 0 || c.livrePar || c.observations);
    if (aLivrer.length === 0) {
      return res.status(404).json({ erreur: "Aucun bon de livraison saisi pour cette date" });
    }
    const pdf = await construirePdfBonsLivraison(aLivrer, date, req.utilisateur!.nom);
    const nom = nomFichierPdf(`bons-de-livraison-${date}`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${nom}"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.end(pdf);
  } catch (e) {
    next(e);
  }
});

// --- Motifs de don (liste fixe extensible, section 3.3 b) -------------------

productionRouter.get("/motifs-don", lecture, async (_req, res, next) => {
  try {
    const motifs = await prisma.motifDon.findMany({ orderBy: { nom: "asc" } });
    res.json({ motifs: motifs.map((m): MotifDonDTO => ({ id: m.id, nom: m.nom })) });
  } catch (e) {
    next(e);
  }
});

// --- Motifs de perte et de non-conformité (liste fixe extensible, section 3.3 f) ---

productionRouter.get("/motifs-perte", lecture, async (_req, res, next) => {
  try {
    const motifs = await prisma.motifPerte.findMany({ orderBy: { nom: "asc" } });
    res.json({ motifs: motifs.map((m): MotifPerteDTO => ({ id: m.id, nom: m.nom })) });
  } catch (e) {
    next(e);
  }
});

productionRouter.get("/motifs-non-conformite", lecture, async (_req, res, next) => {
  try {
    const motifs = await prisma.motifNonConformite.findMany({ orderBy: { nom: "asc" } });
    res.json({ motifs: motifs.map((m): MotifNonConformiteDTO => ({ id: m.id, nom: m.nom })) });
  } catch (e) {
    next(e);
  }
});

// --- Productions enregistrées (section 3.3 b + c) ---------------------------

type ProductionAvecRelations = Prisma.ProductionGetPayload<{
  include: {
    dons: { include: { motifDon: { select: { id: true; nom: true } } } };
    pertes: { include: { motifPerte: { select: { id: true; nom: true } } } };
    controleQualite: { include: { motif: { select: { id: true; nom: true } }; controlePar: { select: { id: true; nom: true } } } };
    enregistrePar: { select: { id: true; nom: true } };
    clotureePar: { select: { id: true; nom: true } };
    mouvements: { include: { matierePremiere: { select: { nom: true; unite: true } } } };
  };
}>;

const INCLUDE_PRODUCTION = {
  dons: { include: { motifDon: { select: { id: true, nom: true } } } },
  pertes: { include: { motifPerte: { select: { id: true, nom: true } } } },
  controleQualite: { include: { motif: { select: { id: true, nom: true } }, controlePar: { select: { id: true, nom: true } } } },
  enregistrePar: { select: { id: true, nom: true } },
  clotureePar: { select: { id: true, nom: true } },
  mouvements: { include: { matierePremiere: { select: { nom: true, unite: true } } } },
} as const;

const versProductionDTO = (p: ProductionAvecRelations): ProductionDTO => {
  const dons = p.dons.map((d) => ({
    motifDonId: d.motifDonId,
    motifNom: d.motifDon.nom,
    nombreBacs: d.nombreBacs,
  }));
  const pertes = p.pertes.map((l) => ({
    motifPerteId: l.motifPerteId,
    motifNom: l.motifPerte.nom,
    nombreBacs: l.nombreBacs,
  }));
  const totalDestinations = totalDestinationsBacs({
    bacsLivresDepositaires: p.bacsLivresDepositaires,
    bacsLivresMamans: p.bacsLivresMamans,
    bacsVendusVC: p.bacsVendusVC,
    bacsRestants: p.bacsRestants,
    bacsFoutus: p.bacsFoutus,
    dons,
  });
  return {
    id: p.id,
    numero: p.numero,
    date: p.date.toISOString(),
    bacsProduits: p.bacsProduits,
    bacsLivresDepositaires: p.bacsLivresDepositaires,
    bacsLivresMamans: p.bacsLivresMamans,
    bacsVendusVC: p.bacsVendusVC,
    bacsRestants: p.bacsRestants,
    bacsFoutus: p.bacsFoutus,
    dons,
    totalDonnes: dons.reduce((s, d) => s + d.nombreBacs, 0),
    kgFarineAbimes: dec(p.kgFarineAbimes),
    sacsUtilises: p.sacsUtilises.toNumber(),
    paquetsLevureUtilises: p.paquetsLevureUtilises.toNumber(),
    kgSelUtilises: p.kgSelUtilises.toNumber(),
    quantiteHuileUtilisee: p.quantiteHuileUtilisee.toNumber(),
    observations: p.observations,
    enregistrePar: p.enregistrePar,
    consommations: p.mouvements.map((m) => ({
      matiereNom: m.matierePremiere.nom,
      unite: m.matierePremiere.unite,
      quantite: m.quantite.toNumber(),
    })),
    totalDestinations,
    ecartReconciliation: totalDestinations - p.bacsProduits,
    statut: p.statut,
    clotureeLe: p.clotureeLe ? p.clotureeLe.toISOString() : null,
    clotureePar: p.clotureePar,
    pertes,
    totalPertes: pertes.reduce((s, l) => s + l.nombreBacs, 0),
    controleQualite: p.controleQualite
      ? {
          verdict: p.controleQualite.verdict,
          motifId: p.controleQualite.motifId,
          motifNom: p.controleQualite.motif?.nom ?? null,
          observations: p.controleQualite.observations,
          controlePar: p.controleQualite.controlePar,
          controleLe: p.controleQualite.createdAt.toISOString(),
        }
      : null,
  };
};

productionRouter.get("/productions", lecture, async (req, res, next) => {
  try {
    const { du, au } = req.query as Record<string, string | undefined>;
    const date: Prisma.DateTimeFilter = {};
    if (du) date.gte = new Date(`${du}T00:00:00.000Z`);
    if (au) date.lte = new Date(`${au}T23:59:59.999Z`);

    const productions = await prisma.production.findMany({
      where: du || au ? { date } : {},
      include: INCLUDE_PRODUCTION,
      orderBy: { numero: "desc" },
      take: 60,
    });
    res.json({ productions: productions.map(versProductionDTO) });
  } catch (e) {
    next(e);
  }
});

productionRouter.post("/productions", ecriture, async (req, res, next) => {
  try {
    const parsed = productionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const d = parsed.data;

    const motifIds = d.dons.map((x) => x.motifDonId);
    if (new Set(motifIds).size !== motifIds.length) {
      return res.status(400).json({ erreur: "Un motif de don apparaît deux fois" });
    }
    if (motifIds.length > 0) {
      const connus = await prisma.motifDon.count({ where: { id: { in: motifIds } } });
      if (connus !== motifIds.length) {
        return res.status(400).json({ erreur: "Motif de don inconnu" });
      }
    }

    // Ingrédients utilisés → matières premières à décrémenter. La correspondance
    // passe par le code de la matière (pas par son nom). Une matière non
    // configurée n'empêche pas l'enregistrement : elle est signalée en retour.
    const quantitesParCode: [CodeIngredient, number][] = [
      ["FARINE", d.sacsUtilises],
      ["LEVURE", d.paquetsLevureUtilises],
      ["SEL", d.kgSelUtilises],
      ["HUILE", d.quantiteHuileUtilisee],
    ];
    const aConsommer = quantitesParCode.filter(([, q]) => q > 0);
    const matieres = await prisma.matierePremiere.findMany({
      where: { code: { in: aConsommer.map(([c]) => c) } },
    });
    const parCode = new Map(matieres.map((m) => [m.code as CodeIngredient, m]));
    const avertissements = aConsommer
      .filter(([code]) => !parCode.has(code))
      .map(
        ([code]) =>
          `Aucune matière première n'est reliée au code ${code} : le stock correspondant n'a pas été décrémenté.`,
      );

    // Production + mouvements SORTIE dans UNE transaction : la décrémentation
    // reste automatique et atomique (un stock insuffisant annule l'ensemble),
    // exactement comme l'ancien mécanisme fondé sur la recette.
    const resultat = await prisma.$transaction(
      async (tx) => {
        const production = await tx.production.create({
          data: {
            bacsProduits: d.bacsProduits,
            bacsLivresDepositaires: d.bacsLivresDepositaires,
            bacsLivresMamans: d.bacsLivresMamans,
            bacsVendusVC: d.bacsVendusVC,
            bacsRestants: d.bacsRestants,
            bacsFoutus: d.bacsFoutus,
            kgFarineAbimes: d.kgFarineAbimes ?? null,
            sacsUtilises: d.sacsUtilises,
            paquetsLevureUtilises: d.paquetsLevureUtilises,
            kgSelUtilises: d.kgSelUtilises,
            quantiteHuileUtilisee: d.quantiteHuileUtilisee,
            observations: d.observations ?? null,
            enregistreParId: req.utilisateur!.id,
            dons: { create: d.dons },
          },
        });

        const sousSeuil = [];
        for (const [code, quantite] of aConsommer) {
          const matiere = parCode.get(code);
          if (!matiere) continue;
          const { matiere: maj, franchitSeuil } = await appliquerMouvement(tx, {
            matierePremiereId: matiere.id,
            type: "SORTIE",
            quantite,
            reference: `Production n°${production.numero}`,
            productionId: production.id,
            auteurId: req.utilisateur!.id,
          });
          if (franchitSeuil) sousSeuil.push(maj);
        }

        const complete = await tx.production.findUniqueOrThrow({
          where: { id: production.id },
          include: INCLUDE_PRODUCTION,
        });
        return { production: complete, sousSeuil };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const dto = versProductionDTO(resultat.production);

    // Réconciliation : signalée, jamais bloquante (section 3.3 b).
    if (dto.ecartReconciliation !== 0) {
      const signe = dto.ecartReconciliation > 0 ? "de plus que" : "de moins que";
      avertissements.unshift(
        `Réconciliation : ${dto.totalDestinations} bac(s) répartis, soit ${Math.abs(dto.ecartReconciliation)} ${signe} les ${dto.bacsProduits} bac(s) produits.`,
      );
    }

    const detailConsommations = dto.consommations
      .map((c) => `${formatQuantite(c.quantite, c.unite)} ${c.matiereNom}`)
      .join(", ");
    busEvenements.emettreEvenement({
      type: "PRODUCTION_ENREGISTREE",
      module: "PRODUCTION",
      emetteurId: req.utilisateur!.id,
      evenementRef: dto.id,
      message: `Production n°${dto.numero} — ${dto.bacsProduits} bac(s) produits${detailConsommations ? ` (consommé : ${detailConsommations})` : ""}`,
      donnees: { productionId: dto.id, numero: dto.numero, bacsProduits: dto.bacsProduits },
    });
    // Alerte seuil critique déclenchée par la décrémentation : même canal que
    // pour un mouvement manuel (mécanisme réutilisé, non dupliqué).
    for (const matiere of resultat.sousSeuil) emettreAlerteSeuil(matiere, req.utilisateur!.id);

    res.status(201).json({ production: dto, avertissements });
  } catch (e) {
    if (e instanceof ErreurStock) return res.status(e.status).json({ erreur: e.message });
    return repondreErreurMutationProduction(e, res, next);
  }
});

// --- Contrôle qualité, pertes et clôture (section 3.3 f) --------------------
//
// Une Production naît OUVERTE : ses pertes et son contrôle qualité peuvent
// être saisis ou corrigés librement tant qu'elle n'est pas clôturée. La
// clôture verrouille définitivement l'ensemble (aucune modification possible
// ensuite, y compris des champs déjà immuables comme bacsProduits).

class ErreurMutationProduction extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    readonly code:
      | "PRODUCTION_INTROUVABLE"
      | "PRODUCTION_CLOTUREE"
      | "CONTROLE_QUALITE_MANQUANT"
      | "PERTES_NON_JUSTIFIEES",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Toute modification d'une Production OUVERTE commence par ce verrou de ligne
 * PostgreSQL, dans la même transaction que les écritures et leur AuditLog.
 * La relecture après FOR UPDATE fait seule foi : une vérification effectuée
 * avant la transaction laisserait une course avec la clôture.
 */
async function verrouillerProductionOuverte(tx: TxClient, id: string): Promise<ProductionAvecRelations> {
  const lignes = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Production" WHERE id = ${id} FOR UPDATE
  `;
  if (!lignes[0]) {
    throw new ErreurMutationProduction(404, "PRODUCTION_INTROUVABLE", "Production introuvable");
  }
  const production = await tx.production.findUniqueOrThrow({ where: { id }, include: INCLUDE_PRODUCTION });
  if (production.statut === "CLOTUREE") {
    throw new ErreurMutationProduction(
      409,
      "PRODUCTION_CLOTUREE",
      "Cette production est clôturée : plus aucune modification possible",
    );
  }
  return production;
}

function estConflitProduction(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return e.code === "P2034" || (e.code === "P2010" && (e.meta as { code?: string } | undefined)?.code === "40001");
}

function repondreErreurMutationProduction(e: unknown, res: Response, next: NextFunction) {
  if (e instanceof ErreurMutationProduction) {
    return res.status(e.status).json({ code: e.code, erreur: e.message });
  }
  if (estConflitProduction(e)) {
    return res.status(503).json({
      code: "PRODUCTION_CONFLIT_CONCURRENCE",
      erreur: "Une autre modification de cette production est en cours — réessayez. Rien n'a été enregistré.",
    });
  }
  return next(e);
}

// Remplace intégralement la répartition des pertes. Les suppressions sont
// auditées dans la même transaction : si l'audit échoue, l'ancien détail reste.
productionRouter.put("/productions/:id/pertes", ecriture, async (req, res, next) => {
  try {
    const parsed = productionPertesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { pertes } = parsed.data;

    const motifIds = pertes.map((x) => x.motifPerteId);
    if (new Set(motifIds).size !== motifIds.length) {
      return res.status(400).json({ erreur: "Un motif de perte apparaît deux fois" });
    }
    if (motifIds.length > 0) {
      const connus = await prisma.motifPerte.count({ where: { id: { in: motifIds } } });
      if (connus !== motifIds.length) {
        return res.status(400).json({ erreur: "Motif de perte inconnu" });
      }
    }

    const complete = await prisma.$transaction(
      async (tx) => {
        const production = await verrouillerProductionOuverte(tx, req.params.id);
        await tx.productionPerte.deleteMany({ where: { productionId: production.id } });
        if (pertes.length > 0) {
          await tx.productionPerte.createMany({
            data: pertes.map((l) => ({
              productionId: production.id,
              motifPerteId: l.motifPerteId,
              nombreBacs: l.nombreBacs,
            })),
          });
        }
        // L'audit vient volontairement après les écritures : son échec doit
        // exercer (et prouver en PostgreSQL réel) le rollback du remplacement.
        for (const ancienne of production.pertes) {
          await auditerCaisseTx(tx, {
            module: "PRODUCTION",
            typeEntite: "ProductionPerte",
            entiteId: ancienne.id,
            action: "SUPPRESSION",
            avant: { ...ancienne },
            apres: null,
          });
        }
        return tx.production.findUniqueOrThrow({ where: { id: production.id }, include: INCLUDE_PRODUCTION });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    res.json({ production: versProductionDTO(complete) });
  } catch (e) {
    return repondreErreurMutationProduction(e, res, next);
  }
});

// Un seul contrôle qualité par Production. Une création reste couverte par la
// politique centrale (pas d'AuditLog de création) ; une correction est écrite
// via updateMany puis auditée manuellement dans la transaction.
productionRouter.put("/productions/:id/controle-qualite", ecriture, async (req, res, next) => {
  try {
    const parsed = controleQualiteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { verdict, motifId, observations } = parsed.data;

    if (motifId) {
      const connu = await prisma.motifNonConformite.findUnique({ where: { id: motifId } });
      if (!connu) return res.status(400).json({ erreur: "Motif de non-conformité inconnu" });
    }

    const complete = await prisma.$transaction(
      async (tx) => {
        const production = await verrouillerProductionOuverte(tx, req.params.id);
        const donnees = {
          verdict,
          motifId: motifId ?? null,
          observations: observations ?? null,
          controleParId: req.utilisateur!.id,
        };

        if (production.controleQualite) {
          const resultat = await tx.controleQualite.updateMany({
            where: { id: production.controleQualite.id },
            data: donnees,
          });
          if (resultat.count !== 1) {
            throw new ErreurMutationProduction(409, "PRODUCTION_CLOTUREE", "Le contrôle qualité a été modifié simultanément");
          }
          const modifie = await tx.controleQualite.findUniqueOrThrow({
            where: { id: production.controleQualite.id },
          });
          await auditerCaisseTx(tx, {
            module: "PRODUCTION",
            typeEntite: "ControleQualite",
            entiteId: modifie.id,
            action: "MODIFICATION",
            avant: { ...production.controleQualite },
            apres: { ...modifie },
          });
        } else {
          await tx.controleQualite.create({
            data: { productionId: production.id, ...donnees },
          });
        }

        return tx.production.findUniqueOrThrow({ where: { id: production.id }, include: INCLUDE_PRODUCTION });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    res.json({ production: versProductionDTO(complete) });
  } catch (e) {
    return repondreErreurMutationProduction(e, res, next);
  }
});

// Verrou définitif : les préconditions sont relues sous le même verrou que la
// modification et son audit. Une perte ou un contrôle concurrent ne peut donc
// jamais se glisser après la clôture.
productionRouter.post("/productions/:id/cloturer", ecriture, async (req, res, next) => {
  try {
    const cloturee = await prisma.$transaction(
      async (tx) => {
        const production = await verrouillerProductionOuverte(tx, req.params.id);

        if (!production.controleQualite) {
          throw new ErreurMutationProduction(
            400,
            "CONTROLE_QUALITE_MANQUANT",
            "Le contrôle qualité doit être enregistré avant la clôture",
          );
        }
        const totalPertes = production.pertes.reduce((s, l) => s + l.nombreBacs, 0);
        if (!pertesJustifiees({ bacsFoutus: production.bacsFoutus, pertes: production.pertes })) {
          throw new ErreurMutationProduction(
            400,
            "PERTES_NON_JUSTIFIEES",
            `Les pertes ne sont pas entièrement motivées : ${totalPertes} bac(s) motivé(s) pour ${production.bacsFoutus} bac(s) foutu(s)`,
          );
        }

        const resultat = await tx.production.updateMany({
          where: { id: production.id, statut: "OUVERTE" },
          data: { statut: "CLOTUREE", clotureeLe: new Date(), clotureeParId: req.utilisateur!.id },
        });
        if (resultat.count !== 1) {
          throw new ErreurMutationProduction(409, "PRODUCTION_CLOTUREE", "Cette production vient d'être clôturée");
        }
        const apres = await tx.production.findUniqueOrThrow({ where: { id: production.id }, include: INCLUDE_PRODUCTION });
        await auditerCaisseTx(tx, {
          module: "PRODUCTION",
          typeEntite: "Production",
          entiteId: production.id,
          action: "MODIFICATION",
          avant: { ...production },
          apres: { ...apres },
        });
        return apres;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const dto = versProductionDTO(cloturee);
    busEvenements.emettreEvenement({
      type: "PRODUCTION_CLOTUREE",
      module: "PRODUCTION",
      emetteurId: req.utilisateur!.id,
      evenementRef: dto.id,
      message: `Production n°${dto.numero} clôturée`,
      donnees: { productionId: dto.id, numero: dto.numero },
    });
    res.json({ production: dto });
  } catch (e) {
    return repondreErreurMutationProduction(e, res, next);
  }
});

// --- Écarts prévu / réalisé pour une date (section 3.3) ---------------------

productionRouter.get("/ecarts", lecture, async (req, res, next) => {
  try {
    const { date } = req.query as Record<string, string | undefined>;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ erreur: "Date requise (AAAA-MM-JJ)" });
    }

    const planning = await prisma.planningProduction.findUnique({
      where: { datePrevue: new Date(date) },
      include: INCLUDE_PLANNING,
    });
    // Réalisé = cumul des productions enregistrées ce jour-là.
    const productions = await prisma.production.findMany({
      where: { date: { gte: new Date(`${date}T00:00:00.000Z`), lte: new Date(`${date}T23:59:59.999Z`) } },
    });

    const somme = (f: (p: (typeof productions)[number]) => number) => productions.reduce((s, p) => s + f(p), 0);
    const ligne = (cle: LigneEcartDTO["cle"], prevu: number, realise: number): LigneEcartDTO => ({
      cle,
      prevu,
      realise,
      ecart: Math.round((realise - prevu) * 1000) / 1000,
    });

    const dto: EcartsProductionDTO = {
      date,
      planning: planning ? versPlanningDTO(planning) : null,
      nbProductions: productions.length,
      lignes: [
        ligne("bacs", planning?.nombreBacsCommandes ?? 0, somme((p) => p.bacsProduits)),
        ligne("sacsFarine", planning?.sacsFarinePrevus.toNumber() ?? 0, somme((p) => p.sacsUtilises.toNumber())),
        ligne("paquetsLevure", planning?.paquetsLevurePrevus.toNumber() ?? 0, somme((p) => p.paquetsLevureUtilises.toNumber())),
        ligne("quantiteHuile", planning?.quantiteHuilePrevue.toNumber() ?? 0, somme((p) => p.quantiteHuileUtilisee.toNumber())),
        ligne("kgSel", planning?.kgSelPrevus.toNumber() ?? 0, somme((p) => p.kgSelUtilises.toNumber())),
      ],
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});
