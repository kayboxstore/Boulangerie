import { Router } from "express";
import bcrypt from "bcryptjs";
import { loginSchema } from "@lomoto/shared";
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
