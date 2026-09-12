import { Router, type Response } from "express";
import { licenceActiverSchema } from "@lomoto/shared";
import { requireAuth } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { activerLicence, calculerEtatLicencePourFrontend, rafraichirEtatLicence } from "../services/licenceLocale.js";
import { ErreurServiceLicences } from "../services/licenceCentrale.js";

/**
 * Licence marque blanche (source de vérité = service central, dépôt séparé
 * kayboxstore/licences-activation — voir services/licenceLocale.ts).
 *
 * POST /activer est volontairement PUBLIC (pas de JWT) : c'est la SEULE
 * route qui transmet une clé de licence saisie par l'utilisateur au service
 * central — le navigateur ne doit jamais connaître SECRET_SERVICE_LICENCES
 * ni appeler ce service directement. Elle doit fonctionner dans deux
 * contextes qui n'ont PAS de JWT en commun : l'étape 1 de l'assistant de
 * premier lancement (aucun compte n'existe encore) ET l'écran de blocage
 * d'une instance déjà configurée dont la licence a expiré (l'app entière est
 * remplacée par cet écran). Rate-limitée dans app.ts comme les autres routes
 * publiques sensibles.
 *
 * GET /etat est authentifiée : elle ne sert qu'à l'app déjà connectée
 * (bandeau d'avertissement / écran de blocage post-connexion).
 */
export const licenceRouter = Router();

licenceRouter.post("/activer", async (req, res, next) => {
  try {
    const parsed = licenceActiverSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    try {
      const resultat = await activerLicence(parsed.data.cleLicence);
      res.json(resultat);
    } catch (e) {
      if (e instanceof ErreurServiceLicences) {
        return res.status(503).json({ erreur: "Service de licences injoignable — réessayez dans quelques instants." });
      }
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

async function repondreEtatLicence(res: Response) {
  const etat = await prisma.etatLicence.findUnique({ where: { id: 1 } });
  res.json(calculerEtatLicencePourFrontend(etat));
}

licenceRouter.get("/etat", requireAuth, async (_req, res, next) => {
  try {
    await repondreEtatLicence(res);
  } catch (e) {
    next(e);
  }
});

// Bouton "Vérifier maintenant" du bandeau d'avertissement (maquette validée) :
// force un contact immédiat avec le service central plutôt que d'attendre la
// prochaine échéance horaire du planificateur, puis renvoie l'état à jour.
licenceRouter.post("/rafraichir", requireAuth, async (_req, res, next) => {
  try {
    await rafraichirEtatLicence();
    await repondreEtatLicence(res);
  } catch (e) {
    next(e);
  }
});
