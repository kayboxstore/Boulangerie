import { Router, type Request, type Response } from "express";
import {
  emailProCreerSchema,
  premierLancementFinaliserSchema,
  premierLancementTravailleurSchema,
} from "@lomoto/shared";
import { ErreurAction } from "../lib/erreurAction.js";
import { prisma } from "../lib/prisma.js";
import { declencherEmailPro, verifierEmailPro } from "../services/emailPro.js";
import {
  ErreurFinalisationReessayable,
  finaliserPremierLancementDirect,
  secretPremierLancementValide,
} from "../services/premierLancement.js";
import { INCLUDE_TRAVAILLEUR, versTravailleurDTO } from "./travailleurs.js";

const EN_TETE_SECRET = "x-secret-premier-lancement";

/**
 * Assistant de premier lancement (section 3.7, corrigé P1-A le 28/08/2026)
 * — quand la base ne contient AUCUN compte Utilisateur, l'écran de
 * connexion est remplacé par ce parcours guidé. Public par nécessité
 * (personne ne peut s'authentifier tant qu'aucun compte n'existe), mais
 * chaque appel revérifie ici que la base est toujours vide ET qu'un secret
 * de bootstrap valide (généré hors dépôt, voir
 * `services/premierLancement.ts`) est fourni dans l'en-tête
 * `X-Secret-Premier-Lancement` — sans quoi n'importe quel visiteur pourrait
 * devenir Administrateur Principal sur une base neuve ou réinitialisée
 * avant l'administrateur légitime.
 */
export const premierLancementRouter = Router();

async function exigerBaseVide(res: Response): Promise<boolean> {
  const nombreComptes = await prisma.utilisateur.count();
  if (nombreComptes > 0) {
    res.status(409).json({ erreur: "La configuration initiale est déjà terminée — connectez-vous normalement." });
    return false;
  }
  return true;
}

// Aperçu léger, un rejet honnête et rapide — jamais la garantie de sécurité
// réelle (celle-ci n'existe que dans la réservation atomique de
// finaliserPremierLancementDirect). Appliqué aux 4 routes : sans lui, un
// visiteur sans secret pourrait déjà créer des fiches Travailleur et
// déclencher des envois d'email pro avant même d'atteindre /finaliser.
premierLancementRouter.use(async (req, res, next) => {
  try {
    const secretFourni = req.get(EN_TETE_SECRET);
    if (!(await secretPremierLancementValide(prisma, secretFourni))) {
      return res.status(401).json({ erreur: "Secret de premier lancement requis, invalide, expiré ou déjà utilisé" });
    }
    next();
  } catch (e) {
    next(e);
  }
});

// Étape 1 : fiche Travailleur du futur Admin Principal.
premierLancementRouter.post("/travailleur", async (req: Request, res, next) => {
  try {
    if (!(await exigerBaseVide(res))) return;

    const parsed = premierLancementTravailleurSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { nom, telephone, poste, dateEmbauche } = parsed.data;

    const travailleur = await prisma.travailleur.create({
      data: { nom, telephone: telephone ?? null, poste, dateEmbauche: new Date(dateEmbauche) },
      include: INCLUDE_TRAVAILLEUR,
    });
    res.status(201).json({ travailleur: versTravailleurDTO(travailleur) });
  } catch (e) {
    next(e);
  }
});

// Étape 2 : déclenche l'email pro (même mécanisme que sur une fiche Travailleur normale).
premierLancementRouter.post("/travailleur/:id/email-pro", async (req, res, next) => {
  try {
    if (!(await exigerBaseVide(res))) return;

    const travailleur = await prisma.travailleur.findUnique({ where: { id: req.params.id } });
    if (!travailleur) return res.status(404).json({ erreur: "Fiche introuvable" });
    if (travailleur.utilisateurId) {
      return res.status(409).json({ erreur: "Cette fiche a déjà un compte de connexion" });
    }

    const parsed = emailProCreerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }

    const maj = await declencherEmailPro(travailleur, parsed.data.emailDestination);
    const complet = await prisma.travailleur.findUnique({ where: { id: maj.id }, include: INCLUDE_TRAVAILLEUR });
    res.status(201).json({ travailleur: versTravailleurDTO(complet!) });
  } catch (e) {
    next(e);
  }
});

// Étape 3 : re-vérifie l'état côté Cloudflare (bouton, ou actualisation automatique).
premierLancementRouter.post("/travailleur/:id/email-pro/verifier", async (req, res, next) => {
  try {
    if (!(await exigerBaseVide(res))) return;

    const travailleur = await prisma.travailleur.findUnique({ where: { id: req.params.id } });
    if (!travailleur) return res.status(404).json({ erreur: "Fiche introuvable" });

    const resultat = await verifierEmailPro(travailleur);
    if (resultat.erreur) return res.status(resultat.status ?? 400).json({ erreur: resultat.erreur });

    const complet = await prisma.travailleur.findUnique({ where: { id: resultat.travailleur.id }, include: INCLUDE_TRAVAILLEUR });
    res.json({ travailleur: versTravailleurDTO(complet!) });
  } catch (e) {
    next(e);
  }
});

// Étape 4 : email pro actif -> création automatique du compte Administrateur
// principal. Le mot de passe est celui saisi par l'utilisateur dans
// l'assistant ; le frontend enchaîne avec un login normal (pas de token
// renvoyé ici, pour ne pas dupliquer la logique de connexion). Toute la
// logique de réservation atomique du secret + revérification de la base
// vide + création est dans services/premierLancement.ts — voir sa
// documentation pour les garanties de concurrence.
premierLancementRouter.post("/finaliser", async (req, res, next) => {
  try {
    const parsed = premierLancementFinaliserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }

    try {
      await finaliserPremierLancementDirect(prisma, {
        secretFourni: req.get(EN_TETE_SECRET),
        travailleurId: parsed.data.travailleurId,
        motDePasse: parsed.data.motDePasse,
      });
    } catch (e) {
      if (e instanceof ErreurAction) return res.status(e.status).json({ erreur: e.message });
      if (e instanceof ErreurFinalisationReessayable) return res.status(503).json({ erreur: e.message });
      throw e;
    }

    res.status(201).json({ ok: true });
  } catch (e) {
    next(e);
  }
});
