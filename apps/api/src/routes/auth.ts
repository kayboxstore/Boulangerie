import { Router } from "express";
import bcrypt from "bcryptjs";
import { loginSchema, motDePasseUpdateSchema } from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import { chargerUtilisateur, requireAuth } from "../middleware/auth.js";

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

    if (!u || !u.actif) return identifiantsInvalides();
    const ok = await bcrypt.compare(motDePasse, u.motDePasseHash);
    if (!ok) return identifiantsInvalides();

    const utilisateur = await chargerUtilisateur(u.id);
    if (!utilisateur) return identifiantsInvalides();

    const token = signToken({ sub: u.id, roleId: u.roleId });
    res.json({ token, utilisateur });
  } catch (e) {
    next(e);
  }
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ utilisateur: req.utilisateur });
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
