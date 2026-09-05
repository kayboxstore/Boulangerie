import { randomUUID } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import {
  CLE_LANGUE_DEFAUT,
  LANGUE_DEFAUT_PAR_DEFAUT,
  LANGUES,
  demandeReinitialisationSchema,
  languePrefereeSchema,
  loginSchema,
  motDePasseUpdateSchema,
  profilPriveUpdateSchema,
  reinitialisationMotDePasseSchema,
  verificationReinitialisationSchema,
  type AnniversairesDuJourDTO,
  type Langue,
  type ProfilPriveDTO,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { signToken } from "../lib/jwt.js";
import { chargerUtilisateur, requireAuth } from "../middleware/auth.js";
import { lireParametre } from "../lib/parametres.js";
import { invaliderSessionUtilisateur } from "../lib/realtime.js";
import {
  DELAI_ENTRE_DEMANDES_MS,
  expirationJetonReinitialisation,
  genererJetonReinitialisation,
  hacherJetonReinitialisation,
  jetonReinitialisationUtilisable,
} from "../lib/recuperationMotDePasse.js";
import { envoyerLienReinitialisation } from "../services/email.js";
import { logger } from "../lib/logger.js";
import { dateSQLDepuisJourLomoto, jourLomoto } from "../lib/temps.js";
import { nomsAnniversairesDuJour } from "../lib/anniversaires.js";

/** Langue par défaut de la boutique (repli quand l'utilisateur n'a pas de préférence). */
async function langueDefautBoutique(): Promise<Langue> {
  const valeur = await lireParametre(CLE_LANGUE_DEFAUT, LANGUE_DEFAUT_PAR_DEFAUT);
  return (LANGUES as readonly string[]).includes(valeur) ? (valeur as Langue) : LANGUE_DEFAUT_PAR_DEFAUT;
}

export const authRouter = Router();

export const MESSAGE_DEMANDE_REINITIALISATION =
  "Si cette adresse correspond à un compte actif, un lien de réinitialisation a été envoyé.";

async function chargerProfilPrive(utilisateurId: string): Promise<ProfilPriveDTO | null> {
  const utilisateur = await prisma.utilisateur.findUnique({
    where: { id: utilisateurId },
    include: {
      role: { select: { nom: true } },
      ficheTravailleur: {
        select: {
          id: true,
          poste: true,
          dateNaissance: true,
          departement: { select: { nom: true } },
        },
      },
    },
  });
  if (!utilisateur) return null;
  return {
    id: utilisateur.id,
    nom: utilisateur.nom,
    email: utilisateur.email,
    roleNom: utilisateur.role.nom,
    languePreferee: utilisateur.languePreferee as Langue | null,
    travailleur: utilisateur.ficheTravailleur
      ? {
          id: utilisateur.ficheTravailleur.id,
          poste: utilisateur.ficheTravailleur.poste,
          departementNom: utilisateur.ficheTravailleur.departement?.nom ?? null,
          dateNaissance: utilisateur.ficheTravailleur.dateNaissance?.toISOString().slice(0, 10) ?? null,
        }
      : null,
  };
}

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

    // Session unique (section 3.7) : un nouveau sid remplace l'ancien, ce qui
    // invalidera toute requête/socket encore porteuse de l'ancien jeton. On
    // avertit l'éventuel appareil déjà connecté AVANT de répondre à celui-ci.
    const sessionId = randomUUID();
    await prisma.utilisateur.update({
      where: { id: u.id },
      data: { sessionActuelleId: sessionId },
    });
    invaliderSessionUtilisateur(u.id);

    const token = signToken({ sub: u.id, roleId: u.roleId, sid: sessionId });
    res.json({ token, utilisateur, langueDefautBoutique: await langueDefautBoutique() });
  } catch (e) {
    next(e);
  }
});


// Récupération publique : la réponse reste strictement identique que le compte
// existe ou non, soit inactif, en temporisation ou que l'envoi échoue.
authRouter.post("/mot-de-passe-oublie", async (req, res) => {
  const parsed = demandeReinitialisationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Adresse e-mail invalide" });
  }

  try {
    const utilisateur = await prisma.utilisateur.findUnique({ where: { email: parsed.data.email } });
    if (!utilisateur?.actif) {
      return res.status(202).json({ message: MESSAGE_DEMANDE_REINITIALISATION });
    }

    const seuil = new Date(Date.now() - DELAI_ENTRE_DEMANDES_MS);
    const demandeRecente = await prisma.jetonReinitialisationMotDePasse.findFirst({
      where: { utilisateurId: utilisateur.id, utiliseLe: null, createdAt: { gte: seuil } },
      select: { id: true },
    });
    if (demandeRecente) {
      return res.status(202).json({ message: MESSAGE_DEMANDE_REINITIALISATION });
    }

    const jeton = genererJetonReinitialisation();
    const expireLe = expirationJetonReinitialisation();
    const enregistrement = await prisma.$transaction(async (tx) => {
      await tx.jetonReinitialisationMotDePasse.updateMany({
        where: { utilisateurId: utilisateur.id, utiliseLe: null },
        data: { utiliseLe: new Date() },
      });
      return tx.jetonReinitialisationMotDePasse.create({
        data: {
          utilisateurId: utilisateur.id,
          jetonHash: hacherJetonReinitialisation(jeton),
          expireLe,
        },
      });
    });

    try {
      await envoyerLienReinitialisation({
        destinataire: utilisateur.email,
        jeton,
        expireLe,
      });
    } catch (erreur) {
      await prisma.jetonReinitialisationMotDePasse.update({
        where: { id: enregistrement.id },
        data: { utiliseLe: new Date() },
      });
      logger.error("Échec de l'envoi du lien de réinitialisation", {
        erreur,
        utilisateurId: utilisateur.id,
      });
    }
  } catch (erreur) {
    logger.error("Échec interne de la demande de réinitialisation", { erreur });
  }

  return res.status(202).json({ message: MESSAGE_DEMANDE_REINITIALISATION });
});

authRouter.post("/reinitialisation/verifier", async (req, res) => {
  const parsed = verificationReinitialisationSchema.safeParse(req.body);
  if (!parsed.success) return res.json({ valide: false });
  try {
    const jeton = await prisma.jetonReinitialisationMotDePasse.findUnique({
      where: { jetonHash: hacherJetonReinitialisation(parsed.data.jeton) },
      select: { expireLe: true, utiliseLe: true },
    });
    return res.json({ valide: jetonReinitialisationUtilisable(jeton) });
  } catch (erreur) {
    logger.error("Échec de vérification d'un jeton de réinitialisation", { erreur });
    return res.json({ valide: false });
  }
});

authRouter.post("/reinitialisation", async (req, res, next) => {
  try {
    const parsed = reinitialisationMotDePasseSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }

    const maintenant = new Date();
    const jetonHash = hacherJetonReinitialisation(parsed.data.jeton);
    const motDePasseHash = await bcrypt.hash(parsed.data.nouveauMotDePasse, 10);
    const utilisateur = await prisma.$transaction(async (tx) => {
      const jeton = await tx.jetonReinitialisationMotDePasse.findUnique({
        where: { jetonHash },
        include: { utilisateur: true },
      });
      if (!jetonReinitialisationUtilisable(jeton, maintenant) || !jeton?.utilisateur.actif) return null;

      const reserve = await tx.jetonReinitialisationMotDePasse.updateMany({
        where: { id: jeton.id, utiliseLe: null, expireLe: { gt: maintenant } },
        data: { utiliseLe: maintenant },
      });
      if (reserve.count !== 1) return null;

      const maj = await tx.utilisateur.update({
        where: { id: jeton.utilisateurId },
        data: {
          motDePasseHash,
          motDePasseDoitChanger: false,
          sessionActuelleId: null,
        },
        select: { id: true, nom: true },
      });
      await tx.jetonReinitialisationMotDePasse.updateMany({
        where: { utilisateurId: maj.id, id: { not: jeton.id }, utiliseLe: null },
        data: { utiliseLe: maintenant },
      });
      await tx.auditLog.create({
        data: {
          utilisateurId: maj.id,
          utilisateurNom: maj.nom,
          module: "EQUIPE",
          typeEntite: "Utilisateur",
          entiteId: maj.id,
          action: "MODIFICATION",
          avant: { motDePasse: "secret", sessionRevoquee: false },
          apres: { motDePasse: "modifie", sessionRevoquee: true },
        },
      });
      return maj;
    });

    if (!utilisateur) {
      return res.status(400).json({
        code: "JETON_INVALIDE_OU_EXPIRE",
        erreur: "Ce lien de réinitialisation est invalide, expiré ou déjà utilisé.",
      });
    }
    invaliderSessionUtilisateur(utilisateur.id);
    return res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Assistant de premier lancement (section 3.7, nouveau) — accessible sans
// authentification : c'est justement ce qui décide si l'écran de connexion
// normal ou l'assistant guidé doit s'afficher.
authRouter.get("/etat-initial", async (_req, res, next) => {
  try {
    const nombreComptes = await prisma.utilisateur.count();
    res.json({ premierLancement: nombreComptes === 0 });
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


authRouter.get("/profil", requireAuth, async (req, res, next) => {
  try {
    const profil = await chargerProfilPrive(req.utilisateur!.id);
    if (!profil) return res.status(404).json({ erreur: "Profil introuvable" });
    res.json({ profil });
  } catch (e) {
    next(e);
  }
});

authRouter.put("/profil", requireAuth, async (req, res, next) => {
  try {
    const parsed = profilPriveUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Date de naissance invalide" });
    }
    const travailleur = await prisma.travailleur.findUnique({
      where: { utilisateurId: req.utilisateur!.id },
      select: { id: true },
    });
    if (!travailleur) {
      return res.status(409).json({ erreur: "Aucune fiche Travailleur n'est liée à ce compte" });
    }
    await prisma.travailleur.update({
      where: { id: travailleur.id },
      data: {
        dateNaissance: parsed.data.dateNaissance
          ? dateSQLDepuisJourLomoto(parsed.data.dateNaissance)
          : null,
      },
    });
    res.json({ profil: await chargerProfilPrive(req.utilisateur!.id) });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/anniversaires/aujourdhui", requireAuth, async (req, res, next) => {
  try {
    const date = jourLomoto();
    const dateSQL = dateSQLDepuisJourLomoto(date);
    const travailleurs = await prisma.travailleur.findMany({
      where: { dateNaissance: { not: null } },
      select: { nom: true, dateNaissance: true },
    });
    const noms = nomsAnniversairesDuJour(travailleurs, date);
    const vide: AnniversairesDuJourDTO = { date, noms: [], dejaAffiche: false };
    if (!noms.length) return res.json(vide);

    try {
      await prisma.affichageAnniversaire.create({
        data: { utilisateurId: req.utilisateur!.id, date: dateSQL },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const deja: AnniversairesDuJourDTO = { date, noms: [], dejaAffiche: true };
        return res.json(deja);
      }
      throw e;
    }

    const resultat: AnniversairesDuJourDTO = { date, noms, dejaAffiche: false };
    return res.json(resultat);
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
      data: { motDePasseHash: await bcrypt.hash(nouveauMotDePasse, 10), motDePasseDoitChanger: false },
    });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
