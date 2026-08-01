import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import {
  emailProCreerSchema,
  premierLancementFinaliserSchema,
  premierLancementTravailleurSchema,
  ROLE_ADMINISTRATEUR,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { declencherEmailPro, verifierEmailPro } from "../services/emailPro.js";
import { INCLUDE_TRAVAILLEUR, versTravailleurDTO } from "./travailleurs.js";

/**
 * Assistant de premier lancement (section 3.7, nouveau) — quand la base ne
 * contient AUCUN compte Utilisateur, l'écran de connexion est remplacé par ce
 * parcours guidé. Public par nécessité (personne ne peut s'authentifier tant
 * qu'aucun compte n'existe), mais chaque appel revérifie ici que la base est
 * toujours vide : une fois le premier Admin créé, ce router se referme de
 * lui-même — plus aucune requête n'y passe la garde.
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
// renvoyé ici, pour ne pas dupliquer la logique de connexion).
premierLancementRouter.post("/finaliser", async (req, res, next) => {
  try {
    if (!(await exigerBaseVide(res))) return;

    const parsed = premierLancementFinaliserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { travailleurId, motDePasse } = parsed.data;

    const travailleur = await prisma.travailleur.findUnique({ where: { id: travailleurId } });
    if (!travailleur) return res.status(404).json({ erreur: "Fiche introuvable" });
    if (travailleur.utilisateurId) {
      return res.status(409).json({ erreur: "Cette fiche a déjà un compte de connexion" });
    }
    if (travailleur.emailProStatut !== "ACTIF" || !travailleur.emailProAdresse) {
      return res.status(409).json({ erreur: "L'adresse email professionnelle n'est pas encore active" });
    }

    const role = await prisma.role.findUnique({ where: { nom: ROLE_ADMINISTRATEUR } });
    if (!role) return res.status(500).json({ erreur: "Rôle Administrateur introuvable — configuration incomplète" });

    const motDePasseHash = await bcrypt.hash(motDePasse, 10);
    await prisma.$transaction(async (tx) => {
      const compte = await tx.utilisateur.create({
        data: {
          nom: travailleur.nom,
          email: travailleur.emailProAdresse!,
          roleId: role.id,
          motDePasseHash,
          estAdminPrincipal: true,
        },
      });
      await tx.travailleur.update({ where: { id: travailleur.id }, data: { utilisateurId: compte.id } });
    });

    res.status(201).json({ ok: true });
  } catch (e) {
    next(e);
  }
});
