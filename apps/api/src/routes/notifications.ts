import { Router } from "express";
import type { Module, NotificationDTO, TypeEvenement } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

// Historique des notifications de l'utilisateur connecté (rattrapage après
// déconnexion) + compteur de non-lues.
notificationsRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const [notifications, nonLues] = await Promise.all([
      prisma.notification.findMany({
        where: { destinataireId: req.utilisateur!.id },
        orderBy: { dateCreation: "desc" },
        take: limit,
        include: { emetteur: { select: { id: true, nom: true, role: { select: { nom: true } } } } },
      }),
      prisma.notification.count({
        where: { destinataireId: req.utilisateur!.id, lu: false },
      }),
    ]);

    const dtos: NotificationDTO[] = notifications.map((n) => ({
      id: n.id,
      type: n.type as TypeEvenement,
      module: n.module as Module,
      message: n.message,
      evenementRef: n.evenementRef,
      donnees: n.donnees,
      priorite: n.priorite,
      lu: n.lu,
      dateCreation: n.dateCreation.toISOString(),
      emetteur: n.emetteur ? { id: n.emetteur.id, nom: n.emetteur.nom, roleNom: n.emetteur.role.nom } : null,
    }));

    res.json({ notifications: dtos, nonLues });
  } catch (e) {
    next(e);
  }
});

// Marquer une notification comme lue (uniquement les siennes).
notificationsRouter.post("/:id/lu", async (req, res, next) => {
  try {
    const { count } = await prisma.notification.updateMany({
      where: { id: req.params.id, destinataireId: req.utilisateur!.id },
      data: { lu: true },
    });
    if (count === 0) return res.status(404).json({ erreur: "Notification introuvable" });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Tout marquer comme lu.
notificationsRouter.post("/lu", async (req, res, next) => {
  try {
    await prisma.notification.updateMany({
      where: { destinataireId: req.utilisateur!.id, lu: false },
      data: { lu: true },
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
