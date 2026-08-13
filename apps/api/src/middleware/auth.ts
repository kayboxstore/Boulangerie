import type { Request, Response, NextFunction } from "express";
import type { Langue, Module, NiveauAcces, PermissionDTO, UtilisateurDTO } from "@lomoto/shared";
import { CODE_SESSION_REMPLACEE, LANGUES, MESSAGE_SESSION_REMPLACEE, MODULES } from "@lomoto/shared";
import { aAcces } from "@lomoto/shared";
import { verifyToken } from "../lib/jwt.js";
import { prisma } from "../lib/prisma.js";
import { dateSQLDepuisJourLomoto, jourLomoto } from "../lib/temps.js";
import { contexteRequete } from "../lib/contexteRequete.js";
import { logger } from "../lib/logger.js";
import { estHorsPerimetreAdmin, notifierInterventionAdmin } from "../services/interventionsAdmin.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      utilisateur?: UtilisateurDTO;
    }
  }
}

const RANG_NIVEAU: Record<NiveauAcces, number> = { AUCUN: 0, LECTURE: 1, ECRITURE: 2 };

/**
 * Construit le DTO utilisateur (rôle + permissions) renvoyé par l'API. Les
 * permissions effectives = matrice du rôle FUSIONNÉE avec les délégations
 * temporaires actives à la date du jour (section 3.7) : chaque délégation
 * accorde ECRITURE sur son module. L'évaluation par date se fait ici, à chaque
 * requête authentifiée, donc l'expiration est automatique (aucune tâche cron).
 */
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

  // Fusion base + délégations : on garde le niveau le plus élevé par module.
  const niveaux = new Map<Module, NiveauAcces>();
  for (const p of u.role.permissions) niveaux.set(p.module as Module, p.niveauAcces as NiveauAcces);

  // Admin PRINCIPAL = super utilisateur (section 2) : écriture sur absolument
  // tous les modules. Les deux niveaux d'Admin partageant un seul rôle, la
  // distinction ne peut pas vivre dans RolePermission — elle est appliquée ici,
  // au même endroit et de la même façon que les délégations temporaires.
  if (u.estAdminPrincipal) {
    for (const module of MODULES) niveaux.set(module, "ECRITURE");
  }

  const aujourdhui = dateSQLDepuisJourLomoto(jourLomoto());
  const delegations = await prisma.delegationRole.findMany({
    where: { utilisateurId: u.id, dateDebut: { lte: aujourdhui }, dateFin: { gte: aujourdhui } },
    select: { module: true },
  });
  for (const d of delegations) {
    const module = d.module as Module;
    const actuel = niveaux.get(module) ?? "AUCUN";
    if (RANG_NIVEAU["ECRITURE"] > RANG_NIVEAU[actuel]) niveaux.set(module, "ECRITURE");
  }

  return {
    id: u.id,
    nom: u.nom,
    email: u.email,
    estAdminPrincipal: u.estAdminPrincipal,
    motDePasseDoitChanger: u.motDePasseDoitChanger,
    role: {
      id: u.role.id,
      nom: u.role.nom,
      roleParentId: u.role.roleParentId,
      permissions: [...niveaux.entries()].map(([module, niveauAcces]) => ({ module, niveauAcces })),
    },
    languePreferee,
  };
}

export function cheminAutoriseAvecMotDePasseTemporaire(methode: string, originalUrl: string): boolean {
  const chemin = originalUrl.split("?")[0];
  return (
    (methode === "GET" && chemin === "/api/auth/me") ||
    (methode === "POST" && chemin === "/api/auth/mot-de-passe")
  );
}

/** Exige un JWT valide ; attache l'utilisateur (rôle + permissions) à la requête. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ erreur: "Authentification requise" });
  }
  try {
    const payload = verifyToken(header.slice("Bearer ".length));

    // Session unique (section 3.7) : vérifie AVANT toute autre chose que le sid
    // du jeton correspond encore à la session courante de l'utilisateur — une
    // connexion plus récente ailleurs l'aurait remplacé. Requête légère dédiée
    // (plutôt que de surcharger chargerUtilisateur, appelé aussi hors HTTP).
    const session = await prisma.utilisateur.findUnique({
      where: { id: payload.sub },
      select: { sessionActuelleId: true, motDePasseDoitChanger: true },
    });
    if (!session) {
      return res.status(401).json({ erreur: "Compte introuvable ou désactivé" });
    }
    if (!payload.sid || payload.sid !== session.sessionActuelleId) {
      return res.status(401).json({ code: CODE_SESSION_REMPLACEE, erreur: MESSAGE_SESSION_REMPLACEE });
    }

    if (session.motDePasseDoitChanger) {
      if (!cheminAutoriseAvecMotDePasseTemporaire(req.method, req.originalUrl)) {
        return res.status(403).json({
          code: "MOT_DE_PASSE_A_CHANGER",
          erreur: "Vous devez remplacer votre mot de passe temporaire avant de continuer.",
        });
      }
    }

    const utilisateur = await chargerUtilisateur(payload.sub);
    if (!utilisateur) {
      return res.status(401).json({ erreur: "Compte introuvable ou désactivé" });
    }
    req.utilisateur = utilisateur;
    // Ouvre le contexte de requête pour toute la suite du traitement : l'extension
    // d'audit y lira l'auteur des écritures Prisma (lib/audit.ts).
    contexteRequete.run({ id: utilisateur.id, nom: utilisateur.nom }, () => next());
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

    // Garde-fou (section 2) : écriture de l'Admin Principal hors de son
    // périmètre d'origine → le rôle propriétaire du module et le DG sont
    // notifiés. On attend la fin de la réponse pour n'alerter que sur une
    // action RÉELLEMENT aboutie (une validation refusée ne notifie personne).
    const auteur = req.utilisateur;
    if (
      auteur?.estAdminPrincipal &&
      niveau === "ECRITURE" &&
      req.method !== "GET" &&
      estHorsPerimetreAdmin(module)
    ) {
      res.once("finish", () => {
        if (res.statusCode >= 400) return;
        notifierInterventionAdmin({
          module,
          auteurId: auteur.id,
          auteurNom: auteur.nom,
          methode: req.method,
          chemin: req.originalUrl,
        }).catch((e) => logger.error("Échec de notification d'intervention Admin", { erreur: e }));
      });
    }

    next();
  };
}
