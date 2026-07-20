import { Router } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import {
  compteCreateSchema,
  compteUpdateSchema,
  MAX_COMPTES_ADMIN,
  ROLE_ADMINISTRATEUR,
  type CompteDTO,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const equipeRouter = Router();

equipeRouter.use(requireAuth);

type CompteAvecRole = Prisma.UtilisateurGetPayload<{
  include: { role: { select: { id: true; nom: true } } };
}>;

const INCLUDE_COMPTE = { role: { select: { id: true, nom: true } } } as const;

const versCompteDTO = (u: CompteAvecRole): CompteDTO => ({
  id: u.id,
  nom: u.nom,
  email: u.email,
  actif: u.actif,
  estAdminPrincipal: u.estAdminPrincipal,
  role: u.role,
  dateCreation: u.createdAt.toISOString(),
});

/**
 * Garde la limite de la section 3.7 : au plus 3 comptes Administrateur
 * (1 Principal + 2 secondaires). `ignorerId` exclut le compte en cours de
 * modification (changer le nom d'un admin ne doit pas compter double).
 */
async function verifierQuotaAdmins(roleId: string, ignorerId?: string): Promise<string | null> {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) return "Rôle introuvable";
  if (role.nom !== ROLE_ADMINISTRATEUR) return null;
  const admins = await prisma.utilisateur.count({
    where: { role: { nom: ROLE_ADMINISTRATEUR }, ...(ignorerId ? { id: { not: ignorerId } } : {}) },
  });
  return admins >= MAX_COMPTES_ADMIN
    ? `Limite atteinte : au plus ${MAX_COMPTES_ADMIN} comptes Administrateur (1 Principal + 2 secondaires)`
    : null;
}

// Roster de l'équipe : Admin (écriture) et DG (lecture seule, section 2).
equipeRouter.get("/", requirePermission("EQUIPE", "LECTURE"), async (_req, res, next) => {
  try {
    const comptes = await prisma.utilisateur.findMany({
      include: INCLUDE_COMPTE,
      orderBy: [{ role: { nom: "asc" } }, { nom: "asc" }],
    });
    res.json({ comptes: comptes.map(versCompteDTO) });
  } catch (e) {
    next(e);
  }
});

// Création d'un compte réel : nom, e-mail, rôle, mot de passe initial défini
// par l'Admin (section 3.7).
equipeRouter.post("/", requirePermission("EQUIPE", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = compteCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { nom, email, roleId, motDePasse } = parsed.data;

    const existant = await prisma.utilisateur.findUnique({ where: { email } });
    if (existant) return res.status(409).json({ erreur: "Un compte utilise déjà cette adresse e-mail" });

    const quota = await verifierQuotaAdmins(roleId);
    if (quota) return res.status(quota === "Rôle introuvable" ? 404 : 409).json({ erreur: quota });

    const compte = await prisma.utilisateur.create({
      data: { nom, email, roleId, motDePasseHash: await bcrypt.hash(motDePasse, 10) },
      include: INCLUDE_COMPTE,
    });
    res.status(201).json({ compte: versCompteDTO(compte) });
  } catch (e) {
    next(e);
  }
});

equipeRouter.put("/:id", requirePermission("EQUIPE", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = compteUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existant = await prisma.utilisateur.findUnique({ where: { id: req.params.id }, include: INCLUDE_COMPTE });
    if (!existant) return res.status(404).json({ erreur: "Compte introuvable" });

    const { nom, email, roleId } = parsed.data;

    if (email && email !== existant.email) {
      const doublon = await prisma.utilisateur.findUnique({ where: { email } });
      if (doublon) return res.status(409).json({ erreur: "Un compte utilise déjà cette adresse e-mail" });
    }

    if (roleId && roleId !== existant.roleId) {
      // L'Admin Principal garde son rôle Administrateur tant que le statut
      // Principal n'a pas été transféré (index unique en base, retrofit).
      if (existant.estAdminPrincipal) {
        return res.status(409).json({
          erreur: "Transférez d'abord le statut d'Administrateur principal avant de changer ce rôle",
        });
      }
      const quota = await verifierQuotaAdmins(roleId, existant.id);
      if (quota) return res.status(quota === "Rôle introuvable" ? 404 : 409).json({ erreur: quota });
    }

    const compte = await prisma.utilisateur.update({
      where: { id: existant.id },
      data: { nom, email, roleId },
      include: INCLUDE_COMPTE,
    });
    res.json({ compte: versCompteDTO(compte) });
  } catch (e) {
    next(e);
  }
});

// Transfert du statut d'Administrateur principal (section 3.7 : un seul
// Principal à la fois). La cible doit être un Administrateur ; l'index unique
// partiel en base garantit l'unicité, la transaction retire puis attribue.
equipeRouter.post("/:id/principal", requirePermission("EQUIPE", "ECRITURE"), async (req, res, next) => {
  try {
    const cible = await prisma.utilisateur.findUnique({ where: { id: req.params.id }, include: INCLUDE_COMPTE });
    if (!cible) return res.status(404).json({ erreur: "Compte introuvable" });
    if (cible.role.nom !== ROLE_ADMINISTRATEUR) {
      return res.status(409).json({ erreur: "Seul un compte Administrateur peut devenir Principal" });
    }
    if (cible.estAdminPrincipal) return res.status(409).json({ erreur: "Ce compte est déjà l'Administrateur principal" });

    const compte = await prisma.$transaction(async (tx) => {
      await tx.utilisateur.updateMany({
        where: { estAdminPrincipal: true },
        data: { estAdminPrincipal: false },
      });
      return tx.utilisateur.update({
        where: { id: cible.id },
        data: { estAdminPrincipal: true },
        include: INCLUDE_COMPTE,
      });
    });
    res.json({ compte: versCompteDTO(compte) });
  } catch (e) {
    next(e);
  }
});

// Suppression directe (le workflow d'approbation pour les Admins secondaires
// arrive en Phase 10). Un compte lié à de l'activité (ventes, commandes,
// clôtures…) ne peut pas être supprimé : la désactivation arrive avec le
// module Activation (3.14, Phase 10).
equipeRouter.delete("/:id", requirePermission("EQUIPE", "ECRITURE"), async (req, res, next) => {
  try {
    const compte = await prisma.utilisateur.findUnique({ where: { id: req.params.id } });
    if (!compte) return res.status(404).json({ erreur: "Compte introuvable" });
    if (compte.id === req.utilisateur!.id) {
      return res.status(409).json({ erreur: "Impossible de supprimer votre propre compte" });
    }
    if (compte.estAdminPrincipal) {
      return res.status(409).json({ erreur: "Transférez d'abord le statut d'Administrateur principal" });
    }

    await prisma.utilisateur.delete({ where: { id: compte.id } });
    res.status(204).end();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      return res.status(409).json({
        erreur:
          "Suppression impossible : ce compte a de l'activité enregistrée (ventes, commandes…). La désactivation de compte arrive avec le module Activation.",
      });
    }
    next(e);
  }
});
