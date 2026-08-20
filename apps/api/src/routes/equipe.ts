import { Router } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import {
  activationSchema,
  compteCreateSchema,
  compteUpdateSchema,
  MAX_COMPTES_ADMIN,
  ROLE_ADMINISTRATEUR,
  type CompteDTO,
  type MotDePasseTemporaireDTO,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { traiterActionCritique } from "../services/actionsCritiques.js";
import { busEvenements } from "../lib/events.js";
import { genererMotDePasseTemporaire } from "../lib/recuperationMotDePasse.js";
import { invaliderSessionUtilisateur } from "../lib/realtime.js";

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
  motDePasseDoitChanger: u.motDePasseDoitChanger,
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

// Création d'un compte réel (section 3.7, nouveau) : plus d'email saisi
// librement — on sélectionne une fiche Travailleur dont l'email pro est actif
// (3.18), qui devient l'identifiant de connexion, non modifiable. Équipe
// (rôle) et mot de passe initial restent définis par l'Admin.
equipeRouter.post("/", requirePermission("EQUIPE", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = compteCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { travailleurId, roleId, motDePasse } = parsed.data;

    const travailleur = await prisma.travailleur.findUnique({ where: { id: travailleurId } });
    if (!travailleur) return res.status(404).json({ erreur: "Fiche Travailleur introuvable" });
    if (travailleur.utilisateurId) {
      return res.status(409).json({ erreur: "Cette fiche a déjà un compte de connexion" });
    }
    if (travailleur.emailProStatut !== "ACTIF" || !travailleur.emailProAdresse) {
      return res.status(409).json({ erreur: "L'adresse email professionnelle de cette fiche n'est pas encore active" });
    }
    const nom = travailleur.nom;
    const email = travailleur.emailProAdresse;

    const existant = await prisma.utilisateur.findUnique({ where: { email } });
    if (existant) return res.status(409).json({ erreur: "Un compte utilise déjà cette adresse e-mail" });

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) return res.status(404).json({ erreur: "L'équipe sélectionnée est introuvable" });

    const motDePasseHash = await bcrypt.hash(motDePasse, 10);

    // Créer un compte Administrateur est une tâche critique (section 2) :
    // différée si l'auteur est un Admin secondaire. Un compte non-admin est créé
    // directement.
    if (role.nom === ROLE_ADMINISTRATEUR) {
      const quota = await verifierQuotaAdmins(roleId);
      if (quota) return res.status(409).json({ erreur: quota });
      const r = await traiterActionCritique(
        req,
        "CREER_COMPTE_ADMIN",
        { nom, email, roleId, motDePasseHash, travailleurId: travailleur.id },
        `créer le compte Administrateur « ${nom} » (${email})`,
      );
      return res.status(r.http).json(r.body);
    }

    const compte = await prisma.$transaction(async (tx) => {
      const c = await tx.utilisateur.create({ data: { nom, email, roleId, motDePasseHash, motDePasseDoitChanger: true }, include: INCLUDE_COMPTE });
      await tx.travailleur.update({ where: { id: travailleur.id }, data: { utilisateurId: c.id } });
      return c;
    });
    res.status(201).json({ compte: versCompteDTO(compte) });
  } catch (e) {
    next(e);
  }
});


equipeRouter.post(
  "/:id/mot-de-passe-temporaire",
  requirePermission("EQUIPE", "ECRITURE"),
  async (req, res, next) => {
    try {
      if (req.params.id === req.utilisateur!.id) {
        return res.status(409).json({ erreur: "Utilisez votre profil pour modifier votre propre mot de passe" });
      }
      const cible = await prisma.utilisateur.findUnique({
        where: { id: req.params.id },
        select: { id: true, estAdminPrincipal: true },
      });
      if (!cible) return res.status(404).json({ erreur: "Compte introuvable" });
      if (cible.estAdminPrincipal && !req.utilisateur!.estAdminPrincipal) {
        return res.status(403).json({
          erreur: "Seul l'Administrateur principal peut réinitialiser son propre compte",
        });
      }

      const motDePasseTemporaire = genererMotDePasseTemporaire();
      await prisma.utilisateur.update({
        where: { id: cible.id },
        data: {
          motDePasseHash: await bcrypt.hash(motDePasseTemporaire, 10),
          motDePasseDoitChanger: true,
          sessionActuelleId: null,
        },
      });
      invaliderSessionUtilisateur(cible.id);

      const resultat: MotDePasseTemporaireDTO = {
        motDePasseTemporaire,
        doitChanger: true,
      };
      return res.status(201).json(resultat);
    } catch (e) {
      next(e);
    }
  },
);

// Activation / désactivation d'un compte (section 3.14) — action directe (pas
// critique), tout Admin. Un compte inactif ne peut plus se connecter : dès
// avant le round 4, `requireAuth` rejetait déjà un compte devenu inactif (401)
// via `chargerUtilisateur`, qui renvoie `null` si `!u.actif`. Ce qui manquait :
// `sessionActuelleId` n'était pas explicitement effacé, et surtout une
// connexion Socket.io déjà établie n'est réévaluée qu'au handshake — elle
// pouvait donc rester connectée et continuer à recevoir des événements après
// la désactivation HTTP. Le round 4 a ajouté l'effacement explicite du SID
// (même écriture Prisma que `actif: false`) puis la déconnexion temps réel
// via `invaliderSessionUtilisateur`, une fois cette écriture confirmée
// réussie — jamais avant, jamais en cas d'échec. Une réactivation ne crée
// jamais de nouvelle session artificielle : seul `actif` est modifié,
// `sessionActuelleId` reste tel quel (déjà `null` depuis la désactivation) —
// la prochaine connexion réelle en créera une.
//
// Correctif P0-01 (round 5, revue Codex, point 1) : cette route ne bloquait
// que l'auto-désactivation. Un Admin secondaire (qui possède aussi
// EQUIPE:ECRITURE) pouvait donc désactiver le Principal lui-même, laissant
// `estAdminPrincipal=true` sur un compte inactif — un état qui rend tout
// transfert normal impossible (`POST /:id/principal` exige que l'appelant SOIT
// le Principal). Garde ajoutée, indépendante de l'appelant : impossible de
// désactiver un compte qui porte encore `estAdminPrincipal=true` ; le statut
// doit d'abord être transféré (`POST /:id/principal`), après quoi l'ancien
// Principal, devenu un Administrateur ordinaire, redevient désactivable
// normalement.
equipeRouter.put("/:id/activation", requirePermission("EQUIPE", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = activationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const compte = await prisma.utilisateur.findUnique({ where: { id: req.params.id }, include: INCLUDE_COMPTE });
    if (!compte) return res.status(404).json({ erreur: "Compte introuvable" });
    if (compte.id === req.utilisateur!.id && !parsed.data.actif) {
      return res.status(409).json({ erreur: "Impossible de désactiver votre propre compte" });
    }
    if (compte.estAdminPrincipal && !parsed.data.actif) {
      return res.status(409).json({
        erreur: "Transférez d'abord le statut d'Administrateur principal avant de désactiver ce compte",
      });
    }
    const maj = await prisma.utilisateur.update({
      where: { id: compte.id },
      data: parsed.data.actif ? { actif: true } : { actif: false, sessionActuelleId: null },
      include: INCLUDE_COMPTE,
    });
    if (!parsed.data.actif) {
      invaliderSessionUtilisateur(compte.id);
    }
    res.json({ compte: versCompteDTO(maj) });
  } catch (e) {
    next(e);
  }
});

// Réaffectation d'équipe (section 3.7, nouveau) : changer le rôle d'un compte
// existant se fait ici. L'identifiant de connexion (email pro) ne change
// jamais — compteUpdateSchema n'accepte plus que nom/roleId. Le titulaire
// reçoit une notification temps réel dès que son équipe change ; la
// modification est déjà tracée au Journal d'audit (extension Prisma centrale,
// lib/audit.ts, branchée sur `update`).
equipeRouter.put("/:id", requirePermission("EQUIPE", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = compteUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existant = await prisma.utilisateur.findUnique({ where: { id: req.params.id }, include: INCLUDE_COMPTE });
    if (!existant) return res.status(404).json({ erreur: "Compte introuvable" });

    const { nom, roleId } = parsed.data;
    const equipeChangee = !!roleId && roleId !== existant.roleId;

    if (equipeChangee) {
      // L'Admin Principal garde son rôle Administrateur tant que le statut
      // Principal n'a pas été transféré (index unique en base, retrofit).
      if (existant.estAdminPrincipal) {
        return res.status(409).json({
          erreur: "Transférez d'abord le statut d'Administrateur principal avant de changer cette équipe",
        });
      }
      const quota = await verifierQuotaAdmins(roleId, existant.id);
      if (quota) return res.status(quota === "Rôle introuvable" ? 404 : 409).json({ erreur: quota });
    }

    const compte = await prisma.utilisateur.update({
      where: { id: existant.id },
      data: { nom, roleId },
      include: INCLUDE_COMPTE,
    });

    if (equipeChangee) {
      busEvenements.emettreEvenement({
        type: "REAFFECTATION_EQUIPE",
        module: "EQUIPE",
        emetteurId: req.utilisateur!.id,
        evenementRef: compte.id,
        priorite: "HAUTE",
        destinataireIdsDirects: [compte.id],
        message: `Vous êtes maintenant affecté à ${compte.role.nom}`,
        donnees: { compteId: compte.id, roleId: compte.role.id },
      });
    }

    res.json({ compte: versCompteDTO(compte) });
  } catch (e) {
    next(e);
  }
});

// Transfert du statut d'Administrateur principal (section 3.7 : un seul
// Principal à la fois). Réservé au Principal EN EXERCICE : contrairement aux
// autres actions sensibles du module (suppression, permissions), ce transfert
// s'exécute immédiatement sans passer par traiterActionCritique — il doit
// donc être verrouillé ici, sinon un Admin secondaire (même rôle, même
// EQUIPE écriture) pourrait se l'attribuer lui-même. La cible doit être un
// Administrateur ACTIF (round 5, revue Codex, point 2 : un compte inactif ne
// peut pas devenir Principal — sinon la base se retrouve sans personne
// capable d'agir avec ce statut) ; l'index unique partiel en base garantit
// l'unicité, la transaction retire puis attribue.
equipeRouter.post("/:id/principal", requirePermission("EQUIPE", "ECRITURE"), async (req, res, next) => {
  try {
    if (!req.utilisateur!.estAdminPrincipal) {
      return res.status(403).json({ erreur: "Seul l'Administrateur principal peut transférer ce statut" });
    }
    const cible = await prisma.utilisateur.findUnique({ where: { id: req.params.id }, include: INCLUDE_COMPTE });
    if (!cible) return res.status(404).json({ erreur: "Compte introuvable" });
    if (cible.role.nom !== ROLE_ADMINISTRATEUR) {
      return res.status(409).json({ erreur: "Seul un compte Administrateur peut devenir Principal" });
    }
    if (!cible.actif) {
      return res.status(409).json({ erreur: "Ce compte est désactivé : il ne peut pas devenir Administrateur principal" });
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

// Supprimer un utilisateur est une tâche critique (section 2) : exécutée
// directement par l'Admin Principal, différée en demande d'approbation pour un
// Admin secondaire. Les garde-fous immédiats (soi-même, Admin Principal) sont
// vérifiés avant l'aiguillage.
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

    const r = await traiterActionCritique(
      req,
      "SUPPRIMER_UTILISATEUR",
      { utilisateurId: compte.id },
      `supprimer le compte « ${compte.nom} »`,
    );
    res.status(r.http).json(r.body);
  } catch (e) {
    next(e);
  }
});
