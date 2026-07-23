import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  CLE_LANGUE_DEFAUT,
  LANGUE_DEFAUT_PAR_DEFAUT,
  LANGUES,
  languePrefereeSchema,
  loginSchema,
  motDePasseUpdateSchema,
  type Langue,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import { chargerUtilisateur, requireAuth } from "../middleware/auth.js";
import { lireParametre } from "../lib/parametres.js";

/** Langue par défaut de la boutique (repli quand l'utilisateur n'a pas de préférence). */
async function langueDefautBoutique(): Promise<Langue> {
  const valeur = await lireParametre(CLE_LANGUE_DEFAUT, LANGUE_DEFAUT_PAR_DEFAUT);
  return (LANGUES as readonly string[]).includes(valeur) ? (valeur as Langue) : LANGUE_DEFAUT_PAR_DEFAUT;
}

export const authRouter = Router();

authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { email, motDePasse } = parsed.data;

    const u = await prisma.utilisateur.findUnique({ where: { email } });
    const identifiantsInvalides = () =>
      res.status(401).json({ erreur: "E-mail ou mot de passe incorrect" });

    if (!u) return identifiantsInvalides();
    const ok = await bcrypt.compare(motDePasse, u.motDePasseHash);
    if (!ok) return identifiantsInvalides();

    // Identifiants corrects mais compte désactivé (section 3.14) : refus
    // EXPLICITE, distinct d'un mot de passe erroné, une fois l'identité prouvée.
    if (!u.actif) {
      return res.status(401).json({ erreur: "Compte désactivé — contactez un administrateur." });
    }

    const utilisateur = await chargerUtilisateur(u.id);
    if (!utilisateur) return identifiantsInvalides();

    const token = signToken({ sub: u.id, roleId: u.roleId });
    res.json({ token, utilisateur, langueDefautBoutique: await langueDefautBoutique() });
  } catch (e) {
    next(e);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    res.json({ utilisateur: req.utilisateur, langueDefautBoutique: await langueDefautBoutique() });
  } catch (e) {
    next(e);
  }
});

// Langue par défaut de la boutique, accessible sans authentification : la page
// de connexion (pré-login) l'utilise pour choisir sa langue d'affichage.
authRouter.get("/langue-defaut", async (_req, res, next) => {
  try {
    res.json({ langueDefaut: await langueDefautBoutique() });
  } catch (e) {
    next(e);
  }
});

// Changement de sa propre langue d'interface (« Mon profil », section 3.9).
authRouter.put("/langue", requireAuth, async (req, res, next) => {
  try {
    const parsed = languePrefereeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Langue invalide" });
    }
    await prisma.utilisateur.update({
      where: { id: req.utilisateur!.id },
      data: { languePreferee: parsed.data.languePreferee },
    });
    const utilisateur = await chargerUtilisateur(req.utilisateur!.id);
    res.json({ utilisateur, langueDefautBoutique: await langueDefautBoutique() });
  } catch (e) {
    next(e);
  }
});

// Changement de son propre mot de passe (« Mon profil », section 3.7) —
// accessible à tout employé connecté, l'ancien mot de passe fait foi.
authRouter.post("/mot-de-passe", requireAuth, async (req, res, next) => {
  try {
    const parsed = motDePasseUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { motDePasseActuel, nouveauMotDePasse } = parsed.data;

    const u = await prisma.utilisateur.findUniqueOrThrow({ where: { id: req.utilisateur!.id } });
    const ok = await bcrypt.compare(motDePasseActuel, u.motDePasseHash);
    if (!ok) return res.status(401).json({ erreur: "Mot de passe actuel incorrect" });

    await prisma.utilisateur.update({
      where: { id: u.id },
      data: { motDePasseHash: await bcrypt.hash(nouveauMotDePasse, 10) },
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
