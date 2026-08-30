import { Router } from "express";
import {
  MESSAGE_BASE_REINITIALISEE,
  NOM_APP,
  reinitialisationSchema,
  VERSION_APP,
  type EtatSystemeDTO,
  type SauvegardeDTO,
  type StatutSauvegarde,
  type TypeSauvegarde,
} from "@lomoto/shared";
import type { SauvegardeBase, Utilisateur } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import {
  construireDump,
  coordonneesBase,
  ErreurSauvegarde,
  nomFichierSauvegarde,
  outilSauvegardeDisponible,
} from "../services/sauvegarde.js";
import { lireSauvegardeLocale, repertoireLocal, retentionLocale } from "../services/sauvegardeLocale.js";
import {
  planificationActive,
  planificationSauvegarde,
  prochaineSauvegarde,
  TAILLE_HISTORIQUE,
} from "../services/planificateurSauvegarde.js";
import {
  ErreurReinitialisation,
  MESSAGE_REINITIALISATION_DESACTIVEE_PRODUCTION,
  reinitialiserBase,
  reinitialisationAutoriseeIci,
} from "../services/reinitialisation.js";
import { getIo } from "../lib/realtime.js";

export const etatSystemeRouter = Router();

// État système (section 3.15) — réservé aux Admins (écriture Équipe). Les deux
// niveaux d'Admin lisent cet écran ; seules les ACTIONS (sauvegarde manuelle)
// sont réservées à l'Admin Principal, vérifié route par route.
etatSystemeRouter.use(requireAuth, requirePermission("EQUIPE", "ECRITURE"));

type SauvegardeAvecAuteur = SauvegardeBase & { declenchePar: Pick<Utilisateur, "nom"> | null };

function versDTO(s: SauvegardeAvecAuteur): SauvegardeDTO {
  return {
    id: s.id,
    type: s.type as TypeSauvegarde,
    statut: s.statut as StatutSauvegarde,
    tailleOctets: s.tailleOctets,
    nomFichier: s.nomFichier,
    destination: s.destination,
    erreur: s.erreur,
    dureeMs: s.dureeMs,
    declencheParNom: s.declenchePar?.nom ?? null,
    date: s.createdAt.toISOString(),
  };
}

etatSystemeRouter.get("/", async (_req, res, next) => {
  try {
    // Connexion testée en direct au moment de l'appel (pas « supposée
    // connectée ») : un SELECT 1 chronométré. En cas d'échec, on rapporte
    // l'état déconnecté plutôt que de faire échouer la requête.
    let connectee = false;
    let latenceMs: number | null = null;
    try {
      const t0 = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      latenceMs = Date.now() - t0;
      connectee = true;
    } catch {
      connectee = false;
      latenceMs = null;
    }

    // Tout ce qui vient de la base n'est interrogé que si la connexion tient.
    const [utilisateursActifs, historique, dernierSucces] = connectee
      ? await Promise.all([
          prisma.utilisateur.count({ where: { actif: true } }),
          prisma.sauvegardeBase.findMany({
            orderBy: { createdAt: "desc" },
            take: TAILLE_HISTORIQUE,
            include: { declenchePar: { select: { nom: true } } },
          }),
          prisma.sauvegardeBase.findFirst({
            where: { statut: "SUCCES" },
            orderBy: { createdAt: "desc" },
            include: { declenchePar: { select: { nom: true } } },
          }),
        ])
      : [0, [] as SauvegardeAvecAuteur[], null];

    const outil = await outilSauvegardeDisponible();
    const { hote, port, base } = coordonneesBase();

    const etat: EtatSystemeDTO = {
      nomApplication: NOM_APP,
      version: VERSION_APP,
      // Pas de système de licence avant la version White label (section 3.15).
      licence: { configuree: false },
      baseDeDonnees: { connectee, latenceMs, hote, port, base },
      utilisateursActifs,
      sauvegardes: {
        derniere: historique[0] ? versDTO(historique[0]) : null,
        dernierSucces: dernierSucces ? versDTO(dernierSucces) : null,
        prochainePrevue: prochaineSauvegarde(),
        planificationActive: planificationActive(),
        expressionCron: planificationSauvegarde.EXPRESSION,
        fuseau: planificationSauvegarde.FUSEAU,
        repertoireLocal: repertoireLocal(),
        retentionLocale: retentionLocale(),
        outilDisponible: outil.disponible,
        outilVersion: outil.version,
        historique: historique.map(versDTO),
      },
      // Section 3.19 : reflète simplement ASSISTANT_IA_ACTIF, sans appeler Gemini.
      assistantIaActif: process.env.ASSISTANT_IA_ACTIF === "true",
      // P0 (30/08/2026) : reflète honnêtement l'état RÉEL côté serveur — la
      // route POST /reinitialiser applique exactement la même condition
      // (reinitialisationAutoriseeIci) et refuserait de toute façon avec un
      // 403 explicite. L'écran ne doit jamais laisser croire que le bouton
      // marche quand il ne le peut pas, ni l'inverse.
      reinitialisation: {
        autorisee: reinitialisationAutoriseeIci(),
        motifIndisponibilite: reinitialisationAutoriseeIci() ? null : MESSAGE_REINITIALISATION_DESACTIVEE_PRODUCTION,
      },
      horodatage: new Date().toISOString(),
    };
    res.json({ etat });
  } catch (e) {
    next(e);
  }
});

/**
 * Sauvegarde manuelle (section 3.15) — réservée à l'Admin Principal. Le dump
 * repart directement dans le navigateur : aucune copie n'est écrite sur le
 * serveur (contrairement à la sauvegarde automatique, écrite localement).
 */
etatSystemeRouter.post("/sauvegarde", async (req, res, next) => {
  if (!req.utilisateur!.estAdminPrincipal) {
    return res
      .status(403)
      .json({ erreur: "Seul l'Administrateur principal peut déclencher une sauvegarde" });
  }

  const t0 = Date.now();
  const nomFichier = nomFichierSauvegarde();
  try {
    const dump = await construireDump();
    // Journalisée comme les automatiques : l'historique doit dire qui a
    // téléchargé une copie de la base, et quand.
    await prisma.sauvegardeBase.create({
      data: {
        type: "MANUELLE",
        statut: "SUCCES",
        tailleOctets: dump.length,
        nomFichier,
        destination: "TELECHARGEMENT",
        dureeMs: Date.now() - t0,
        declencheParId: req.utilisateur!.id,
      },
    });

    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${nomFichier}"`);
    res.setHeader("Content-Length", String(dump.length));
    res.end(dump);
  } catch (e) {
    const message = e instanceof Error ? e.message : "erreur inconnue";
    // L'échec est consigné avant de répondre : une sauvegarde qui n'a pas
    // abouti doit apparaître dans l'historique, pas seulement dans une alerte
    // fugace du navigateur.
    await prisma.sauvegardeBase
      .create({
        data: {
          type: "MANUELLE",
          statut: "ECHEC",
          nomFichier,
          destination: "TELECHARGEMENT",
          erreur: message.slice(0, 1000),
          dureeMs: Date.now() - t0,
          declencheParId: req.utilisateur!.id,
        },
      })
      .catch((erreurJournal) => logger.error("Journalisation de l'échec impossible", { erreur: erreurJournal }));

    if (e instanceof ErreurSauvegarde) return res.status(e.status).json({ erreur: e.message });
    next(e);
  }
});

/**
 * Téléchargement de la dernière sauvegarde AUTOMATIQUE déjà écrite localement
 * (section 3.15) — réservé à l'Admin Principal. Sert le fichier tel quel, sans
 * regénérer de dump : c'est le geste rapide « je récupère la sauvegarde de
 * cette nuit sur une clé USB avant le prochain redéploiement ».
 */
etatSystemeRouter.get("/sauvegarde/derniere-locale", async (req, res, next) => {
  if (!req.utilisateur!.estAdminPrincipal) {
    return res
      .status(403)
      .json({ erreur: "Seul l'Administrateur principal peut télécharger une sauvegarde" });
  }
  try {
    const derniere = await prisma.sauvegardeBase.findFirst({
      where: { type: "AUTOMATIQUE", statut: "SUCCES", destination: "LOCAL" },
      orderBy: { createdAt: "desc" },
    });
    if (!derniere?.nomFichier) {
      return res.status(404).json({ erreur: "Aucune sauvegarde automatique locale disponible pour l'instant." });
    }
    const contenu = await lireSauvegardeLocale(derniere.nomFichier);
    if (!contenu) {
      // Le fichier a pu disparaître (redéploiement, purge de rétention) même si
      // son entrée reste dans l'historique — l'historique ne ment pas sur ce
      // qui s'est passé, mais le fichier n'est plus là pour autant.
      return res.status(404).json({
        erreur:
          "Ce fichier n'est plus disponible sur le serveur (redéploiement ou rotation). La prochaine sauvegarde automatique en créera un nouveau.",
      });
    }
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${derniere.nomFichier}"`);
    res.setHeader("Content-Length", String(contenu.length));
    res.end(contenu);
  } catch (e) {
    next(e);
  }
});

/**
 * Réinitialisation de la base (section 3.15) — Admin Principal uniquement,
 * irréversible. Confirmation par saisie exacte d'un mot (validée par
 * reinitialisationSchema), pas un simple clic. Déclenche systématiquement une
 * sauvegarde de sûreté avant d'effacer quoi que ce soit (voir
 * services/reinitialisation.ts) : si elle échoue, rien n'est effacé.
 *
 * Une fois terminée, TOUS les comptes ont disparu — y compris celui qui vient
 * d'agir : on déconnecte immédiatement toute session ouverte (comme la
 * session unique, 3.7) plutôt que de laisser chacun le découvrir à sa
 * prochaine requête.
 */
etatSystemeRouter.post("/reinitialiser", async (req, res, next) => {
  if (!req.utilisateur!.estAdminPrincipal) {
    return res.status(403).json({ erreur: "Seul l'Administrateur principal peut réinitialiser la base" });
  }
  // Désactivation sûre en production (P0, section 3.15) : revérifiée ici,
  // AVANT même de parser le corps de la requête, pour un refus rapide et
  // explicite — la garde qui compte reste celle, identique, dans
  // reinitialiserBase() elle-même (jamais seulement côté route).
  if (!reinitialisationAutoriseeIci()) {
    return res.status(403).json({
      erreur: MESSAGE_REINITIALISATION_DESACTIVEE_PRODUCTION,
      code: "REINITIALISATION_DESACTIVEE_PRODUCTION",
    });
  }
  try {
    const parsed = reinitialisationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }

    const resultat = await reinitialiserBase(parsed.data.raison);

    const io = getIo();
    io.emit("sessionInvalidee", { message: MESSAGE_BASE_REINITIALISEE });
    io.disconnectSockets(true);

    res.json({ ok: true, sauvegardeId: resultat.sauvegardeId });
  } catch (e) {
    if (e instanceof ErreurReinitialisation) return res.status(e.status).json({ erreur: e.message, code: e.code });
    next(e);
  }
});
