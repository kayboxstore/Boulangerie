import { Router } from "express";
import { Prisma } from "@prisma/client";
import { aAcces, zoneDepositaireCreateSchema, zoneDepositaireUpdateSchema, type ZoneDepositaireDTO } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import type { NextFunction, Request, Response } from "express";

/**
 * Zones de dépôt (section 3.3 d) : purement organisationnel, aucune
 * permission propre. La lecture est ouverte à tout utilisateur authentifié
 * (donnée de référence pour les menus déroulants, comme Produit/TypeClient).
 *
 * L'écriture est rattachée à la fiche Client (module COMMANDES) OU à l'écran
 * de Production qui héberge la carte de gestion (module PRODUCTION) — les
 * deux seuls écrans d'où une zone est réellement gérable. Un seul des deux
 * suffit : ni le Chargé des commandes (aucun accès Production, donc aucun
 * moyen d'atteindre l'écran) ni le Responsable de production (aucun accès
 * Commandes) ne pouvaient sinon jamais créer de zone, alors que l'un comme
 * l'autre en a l'usage quotidien.
 */
function ecritureZones(req: Request, res: Response, next: NextFunction) {
  const permissions = req.utilisateur?.role.permissions ?? [];
  if (aAcces(permissions, "COMMANDES", "ECRITURE") || aAcces(permissions, "PRODUCTION", "ECRITURE")) {
    return next();
  }
  return res.status(403).json({
    erreur: "Accès refusé : écriture requise sur le module Commandes ou Production",
  });
}

export const zonesDepositaireRouter = Router();

zonesDepositaireRouter.use(requireAuth);

const versZoneDTO = (z: { id: string; nom: string; ordre: number }): ZoneDepositaireDTO => ({
  id: z.id,
  nom: z.nom,
  ordre: z.ordre,
});

zonesDepositaireRouter.get("/", async (_req, res, next) => {
  try {
    const zones = await prisma.zoneDepositaire.findMany({ orderBy: [{ ordre: "asc" }, { nom: "asc" }] });
    res.json({ zones: zones.map(versZoneDTO) });
  } catch (e) {
    next(e);
  }
});

zonesDepositaireRouter.post("/", ecritureZones, async (req, res, next) => {
  try {
    const parsed = zoneDepositaireCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existante = await prisma.zoneDepositaire.findUnique({ where: { nom: parsed.data.nom } });
    if (existante) return res.status(409).json({ erreur: "Une zone porte déjà ce nom" });

    const zone = await prisma.zoneDepositaire.create({ data: parsed.data });
    res.status(201).json({ zone: versZoneDTO(zone) });
  } catch (e) {
    next(e);
  }
});

zonesDepositaireRouter.put("/:id", ecritureZones, async (req, res, next) => {
  try {
    const parsed = zoneDepositaireUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existante = await prisma.zoneDepositaire.findUnique({ where: { id: req.params.id } });
    if (!existante) return res.status(404).json({ erreur: "Zone introuvable" });

    if (parsed.data.nom && parsed.data.nom !== existante.nom) {
      const doublon = await prisma.zoneDepositaire.findUnique({ where: { nom: parsed.data.nom } });
      if (doublon) return res.status(409).json({ erreur: "Une zone porte déjà ce nom" });
    }

    const zone = await prisma.zoneDepositaire.update({ where: { id: existante.id }, data: parsed.data });
    res.json({ zone: versZoneDTO(zone) });
  } catch (e) {
    next(e);
  }
});

// Suppression : les clients rattachés retombent simplement sans zone
// (onDelete: SetNull sur Client.zoneDepositaireId) — pas de blocage.
zonesDepositaireRouter.delete("/:id", ecritureZones, async (req, res, next) => {
  try {
    const zone = await prisma.zoneDepositaire.findUnique({ where: { id: req.params.id } });
    if (!zone) return res.status(404).json({ erreur: "Zone introuvable" });
    await prisma.zoneDepositaire.delete({ where: { id: zone.id } });
    res.status(204).end();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return res.status(409).json({ erreur: "Suppression impossible : des clients utilisent encore cette zone" });
    }
    next(e);
  }
});
