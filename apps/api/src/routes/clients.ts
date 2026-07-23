import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  clientCreateSchema,
  typeClientCreateSchema,
  typeClientUpdateSchema,
  type ClientDTO,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { traiterActionCritique } from "../services/actionsCritiques.js";

export const clientsRouter = Router();
export const typeClientsRouter = Router();

clientsRouter.use(requireAuth);
typeClientsRouter.use(requireAuth);

const versClientDTO = (c: {
  id: string;
  nom: string;
  telephone: string | null;
  avanceDisponible: number;
  typeClient: { id: string; nom: string; prixParBac: number; commissionParBac: number };
}): ClientDTO => ({
  id: c.id,
  nom: c.nom,
  telephone: c.telephone,
  avanceDisponible: c.avanceDisponible,
  typeClient: {
    id: c.typeClient.id,
    nom: c.typeClient.nom,
    prixParBac: c.typeClient.prixParBac,
    commissionParBac: c.typeClient.commissionParBac,
  },
});

const versTypeClientDTO = (t: {
  id: string;
  nom: string;
  prixParBac: number;
  commissionParBac: number;
}) => ({ id: t.id, nom: t.nom, prixParBac: t.prixParBac, commissionParBac: t.commissionParBac });

// Écriture des types de clients réservée à l'Administrateur (Paramètres, 3.9).
const ecritureParametres = requirePermission("PARAMETRES", "ECRITURE");

// Les qualités (types de clients) — donnée de référence pour les formulaires,
// lisible par tout utilisateur authentifié (comme le catalogue Produits).
typeClientsRouter.get("/", async (_req, res, next) => {
  try {
    const typeClients = await prisma.typeClient.findMany({ orderBy: { nom: "asc" } });
    res.json({ typeClients: typeClients.map(versTypeClientDTO) });
  } catch (e) {
    next(e);
  }
});

typeClientsRouter.post("/", ecritureParametres, async (req, res, next) => {
  try {
    const parsed = typeClientCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existant = await prisma.typeClient.findUnique({ where: { nom: parsed.data.nom } });
    if (existant) return res.status(409).json({ erreur: "Une qualité porte déjà ce nom" });

    const typeClient = await prisma.typeClient.create({ data: parsed.data });
    res.status(201).json({ typeClient: versTypeClientDTO(typeClient) });
  } catch (e) {
    next(e);
  }
});

// Modifier prix/commission : n'affecte que les commandes FUTURES — les
// commandes existantes ont figé leur montantBrut à l'enregistrement (3.4).
typeClientsRouter.put("/:id", ecritureParametres, async (req, res, next) => {
  try {
    const parsed = typeClientUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existant = await prisma.typeClient.findUnique({ where: { id: req.params.id } });
    if (!existant) return res.status(404).json({ erreur: "Qualité introuvable" });

    if (parsed.data.nom && parsed.data.nom !== existant.nom) {
      const doublon = await prisma.typeClient.findUnique({ where: { nom: parsed.data.nom } });
      if (doublon) return res.status(409).json({ erreur: "Une qualité porte déjà ce nom" });
    }

    // Modifier prix/commission d'une qualité est une tâche critique (section 2).
    const r = await traiterActionCritique(
      req,
      "MODIFIER_TYPE_CLIENT",
      { typeClientId: existant.id, data: parsed.data },
      `modifier la qualité « ${existant.nom} » (prix/commission)`,
    );
    res.status(r.http).json(r.body);
  } catch (e) {
    next(e);
  }
});

// Suppression bloquée si des clients utilisent encore cette qualité (FK).
typeClientsRouter.delete("/:id", ecritureParametres, async (req, res, next) => {
  try {
    const typeClient = await prisma.typeClient.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { clients: true } } },
    });
    if (!typeClient) return res.status(404).json({ erreur: "Qualité introuvable" });
    if (typeClient._count.clients > 0) {
      return res.status(409).json({
        erreur: `Suppression impossible : ${typeClient._count.clients} client(s) utilisent cette qualité`,
      });
    }
    await prisma.typeClient.delete({ where: { id: typeClient.id } });
    res.status(204).end();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return res.status(409).json({ erreur: "Suppression impossible : des clients utilisent cette qualité" });
    }
    next(e);
  }
});

clientsRouter.get("/", requirePermission("COMMANDES", "LECTURE"), async (_req, res, next) => {
  try {
    const clients = await prisma.client.findMany({
      include: { typeClient: true },
      orderBy: { nom: "asc" },
    });
    res.json({ clients: clients.map(versClientDTO) });
  } catch (e) {
    next(e);
  }
});

clientsRouter.post("/", requirePermission("COMMANDES", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = clientCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const typeClient = await prisma.typeClient.findUnique({ where: { id: parsed.data.typeClientId } });
    if (!typeClient) return res.status(400).json({ erreur: "Qualité inconnue" });

    const client = await prisma.client.create({
      data: {
        nom: parsed.data.nom,
        telephone: parsed.data.telephone || null,
        typeClientId: typeClient.id,
      },
      include: { typeClient: true },
    });
    res.status(201).json({ client: versClientDTO(client) });
  } catch (e) {
    next(e);
  }
});
