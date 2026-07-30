import { Router } from "express";
import {
  NOM_APP,
  VERSION_APP,
  type EtatSystemeDTO,
  type SauvegardeDTO,
  type StatutSauvegarde,
  type TypeSauvegarde,
} from "@lomoto/shared";
import type { SauvegardeBase, Utilisateur } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import {
  construireDump,
  coordonneesBase,
  ErreurSauvegarde,
  nomFichierSauvegarde,
  outilSauvegardeDisponible,
} from "../services/sauvegarde.js";
import { driveConfigure, emailCompteService } from "../services/googleDrive.js";
import {
  executerSauvegardeAutomatique,
  planificationActive,
  planificationSauvegarde,
  prochaineSauvegarde,
  TAILLE_HISTORIQUE,
} from "../services/planificateurSauvegarde.js";

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
        driveConfigure: driveConfigure(),
        emailCompteService: emailCompteService(),
        outilDisponible: outil.disponible,
        outilVersion: outil.version,
        historique: historique.map(versDTO),
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
 * serveur, et Google Drive n'intervient pas.
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
      .catch((erreurJournal) => console.error("Journalisation de l'échec impossible :", erreurJournal));

    if (e instanceof ErreurSauvegarde) return res.status(e.status).json({ erreur: e.message });
    next(e);
  }
});

// ---------------------------------------------------------------------------
// OUTIL DE VÉRIFICATION TEMPORAIRE — à retirer après confirmation en
// production que l'envoi vers Google Drive fonctionne (section 3.15).
// Déclenche la routine AUTOMATIQUE (donc avec upload Drive) à la demande, sans
// attendre l'échéance du cron ni modifier BACKUP_CRON. Réservé à l'Admin
// Principal, comme la sauvegarde manuelle ci-dessus.
// ---------------------------------------------------------------------------
etatSystemeRouter.post("/sauvegarde/declencher-auto-test", async (req, res, next) => {
  if (!req.utilisateur!.estAdminPrincipal) {
    return res
      .status(403)
      .json({ erreur: "Seul l'Administrateur principal peut déclencher une sauvegarde" });
  }
  try {
    await executerSauvegardeAutomatique();
    const derniere = await prisma.sauvegardeBase.findFirst({
      where: { type: "AUTOMATIQUE" },
      orderBy: { createdAt: "desc" },
      include: { declenchePar: { select: { nom: true } } },
    });
    res.json({ sauvegarde: derniere ? versDTO(derniere) : null });
  } catch (e) {
    next(e);
  }
});
