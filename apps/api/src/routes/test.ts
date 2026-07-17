// =============================================================================
// ROUTE TEMPORAIRE (Phase 2) — À RETIRER AVANT LA PHASE 3.
// Simule un événement métier pour valider le routage des notifications tant
// que les modules métier (caisse, stocks, commandes…) n'existent pas encore.
// =============================================================================
import { Router } from "express";
import { triggerEventSchema } from "@lomoto/shared";
import { requireAuth } from "../middleware/auth.js";
import { publierEvenement } from "../services/notifications.js";

export const testRouter = Router();

testRouter.post("/trigger-event", requireAuth, async (req, res, next) => {
  try {
    const parsed = triggerEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { module, type, message } = parsed.data;

    // Passe par le service directement pour pouvoir renvoyer les destinataires
    // au client de test ; les modules métier passeront par busEvenements.
    const notifications = await publierEvenement({
      type,
      module,
      emetteurId: req.utilisateur!.id,
      message:
        message ??
        `[TEST] ${req.utilisateur!.nom} (${req.utilisateur!.role.nom}) a déclenché un événement ${type} sur le module ${module}`,
      donnees: { simulation: true },
    });

    res.status(201).json({
      envoyees: notifications.length,
      // id des notifications créées, une par destinataire
      notifications: notifications.map((n) => n.id),
    });
  } catch (e) {
    next(e);
  }
});