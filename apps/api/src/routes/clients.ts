import { Router } from "express";
import { clientCreateSchema, type ClientDTO } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

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

// Les qualités (types de clients) — donnée de référence pour les formulaires.
typeClientsRouter.get("/", async (_req, res, next) => {
  try {
    const typeClients = await prisma.typeClient.findMany({ orderBy: { nom: "asc" } });
    res.json({
      typeClients: typeClients.map((t) => ({
        id: t.id,
        nom: t.nom,
        prixParBac: t.prixParBac,
        commissionParBac: t.commissionParBac,
      })),
    });
  } catch (e) {
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
