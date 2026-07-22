import type { Request, Response, NextFunction } from "express";
import type { Langue, Module, NiveauAcces, PermissionDTO, UtilisateurDTO } from "@lomoto/shared";
import { LANGUES } from "@lomoto/shared";
import { aAcces } from "@lomoto/shared";
import { verifyToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      utilisateur?: UtilisateurDTO;
    }
  }
}

/** Construit le DTO utilisateur (avec rôle + permissions) renvoyé par l'API. */
export async function chargerUtilisateur(id: string): Promise<UtilisateurDTO | null> {
  const u = await prisma.utilisateur.findUnique({
    where: { id },
    include: { role: { include: { permissions: true } } },
  });
  if (!u || !u.actif) return null;
  const languePreferee =
    u.languePreferee && (LANGUES as readonly string[]).includes(u.languePreferee)
      ? (u.languePreferee as Langue)
      : null;
  return {
    id: u.id,
    nom: u.nom,
    email: u.email,
    role: {
      id: u.role.id,
      nom: u.role.nom,
      roleParentId: u.role.roleParentId,
      permissions: u.role.permissions.map((p) => ({
        module: p.module as Module,
        niveauAcces: p.niveauAcces as NiveauAcces,
      })),
    },
    languePreferee,
  };
}

/** Exige un JWT valide ; attache l'utilisateur (rôle + permissions) à la requête. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ erreur: "Authentification requise" });
  }
  try {
    const payload = verifyToken(header.slice("Bearer ".length));
    const utilisateur = await chargerUtilisateur(payload.sub);
    if (!utilisateur) {
      return res.status(401).json({ erreur: "Compte introuvable ou désactivé" });
    }
    req.utilisateur = utilisateur;
    next();
  } catch {
    return res.status(401).json({ erreur: "Jeton invalide ou expiré" });
  }
}

/**
 * Exige au moins `niveau` sur `module` selon la matrice de permissions du rôle.
 * ECRITURE implique LECTURE. Le DG, en lecture seule partout, ne passe donc
 * jamais un garde en écriture.
 */
export function requirePermission(module: Module, niveau: Exclude<NiveauAcces, "AUCUN">) {
  return (req: Request, res: Response, next: NextFunction) => {
    const permissions: PermissionDTO[] = req.utilisateur?.role.permissions ?? [];
    if (!aAcces(permissions, module, niveau)) {
      return res.status(403).json({
        erreur: `Accès refusé : ${niveau.toLowerCase()} requis sur le module ${module}`,
      });
    }
    next();
  };
}
