import { Router } from "express";
import { VERSION_APP, type EtatSystemeDTO } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const etatSystemeRouter = Router();

// État système (section 3.15) — réservé aux Admins (écriture Équipe).
etatSystemeRouter.use(requireAuth, requirePermission("EQUIPE", "ECRITURE"));

etatSystemeRouter.get("/", async (_req, res, next) => {
  try {
    // Connexion testée en direct au moment de l'appel (pas « supposée
    // connectée ») : un SELECT 1 chronométré. En cas d'échec, on rapporte
    // l'état déconnecté plutôt que de faire échouer la requête.
    let connectee = false;
    let latenceMs: number | null = null;
    try {
      const t0 = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      latenceMs = Date.now() - t0;
      connectee = true;
    } catch {
      connectee = false;
      latenceMs = null;
    }

    // Le comptage des utilisateurs actifs dépend de la base : ne l'interroge
    // que si la connexion tient.
    const utilisateursActifs = connectee
      ? await prisma.utilisateur.count({ where: { actif: true } })
      : 0;

    const etat: EtatSystemeDTO = {
      baseDeDonnees: { connectee, latenceMs },
      version: VERSION_APP,
      utilisateursActifs,
      // Aucun mécanisme de sauvegarde n'existe dans le projet (section 3.15) :
      // champ non configuré, jamais un placeholder trompeur.
      derniereSauvegarde: null,
      horodatage: new Date().toISOString(),
    };
    res.json({ etat });
  } catch (e) {
    next(e);
  }
});
