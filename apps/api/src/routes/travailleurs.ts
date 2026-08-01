import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  emailProCreerSchema,
  presencePointageSchema,
  travailleurCreateSchema,
  travailleurUpdateSchema,
  type PresenceDTO,
  type StatutEmailPro,
  type StatutPresence,
  type TravailleurDTO,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { APEX } from "../lib/origines.js";
import { creerOuObtenirDestination, creerRegleRoutage, ErreurCloudflare, obtenirDestination } from "../lib/cloudflareEmail.js";

export const travailleursRouter = Router();

travailleursRouter.use(requireAuth);

type TravailleurAvecCompte = Prisma.TravailleurGetPayload<{
  include: { utilisateur: { select: { id: true; nom: true; email: true } } };
}>;

const INCLUDE_TRAVAILLEUR = {
  utilisateur: { select: { id: true, nom: true, email: true } },
} as const;

const versTravailleurDTO = (t: TravailleurAvecCompte): TravailleurDTO => ({
  id: t.id,
  nom: t.nom,
  telephone: t.telephone,
  poste: t.poste,
  dateEmbauche: t.dateEmbauche.toISOString().slice(0, 10),
  compte: t.utilisateur,
  emailDestination: t.emailDestination,
  emailProAdresse: t.emailProAdresse,
  emailProStatut: t.emailProStatut as StatutEmailPro,
  emailProErreur: t.emailProErreur,
});

type PresenceAvecRelations = Prisma.PresenceGetPayload<{
  include: {
    travailleur: { select: { id: true; nom: true; poste: true } };
    enregistrePar: { select: { id: true; nom: true } };
  };
}>;

const INCLUDE_PRESENCE = {
  travailleur: { select: { id: true, nom: true, poste: true } },
  enregistrePar: { select: { id: true, nom: true } },
} as const;

const versPresenceDTO = (p: PresenceAvecRelations): PresenceDTO => ({
  id: p.id,
  travailleur: p.travailleur,
  date: p.date.toISOString().slice(0, 10),
  statut: p.statut as StatutPresence,
  heureArrivee: p.heureArrivee,
  heureDepart: p.heureDepart,
  enregistrePar: p.enregistrePar,
});

/** Vérifie que le compte Utilisateur à lier existe et n'a pas déjà une fiche. */
async function verifierCompteLie(utilisateurId: string, ignorerTravailleurId?: string): Promise<{ status: number; erreur: string } | null> {
  const compte = await prisma.utilisateur.findUnique({ where: { id: utilisateurId } });
  if (!compte) return { status: 404, erreur: "Compte utilisateur introuvable" };
  const dejaLie = await prisma.travailleur.findUnique({ where: { utilisateurId } });
  if (dejaLie && dejaLie.id !== ignorerTravailleurId) {
    return { status: 409, erreur: `Ce compte est déjà lié à la fiche de ${dejaLie.nom}` };
  }
  return null;
}

// --- Fiches travailleurs (CRUD) ---------------------------------------------

travailleursRouter.get("/", requirePermission("TRAVAILLEURS", "LECTURE"), async (_req, res, next) => {
  try {
    const travailleurs = await prisma.travailleur.findMany({
      include: INCLUDE_TRAVAILLEUR,
      orderBy: { nom: "asc" },
    });
    res.json({ travailleurs: travailleurs.map(versTravailleurDTO) });
  } catch (e) {
    next(e);
  }
});

// Comptes liables (id, nom, e-mail) : liste minimale pour le champ « lien vers
// un compte » de la fiche — réservée à l'écriture Travailleurs, pour ne pas
// élargir la lecture du roster Équipe.
travailleursRouter.get("/comptes-liables", requirePermission("TRAVAILLEURS", "ECRITURE"), async (_req, res, next) => {
  try {
    const comptes = await prisma.utilisateur.findMany({
      where: { actif: true },
      select: { id: true, nom: true, email: true },
      orderBy: { nom: "asc" },
    });
    res.json({ comptes });
  } catch (e) {
    next(e);
  }
});

travailleursRouter.post("/", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = travailleurCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { nom, telephone, poste, dateEmbauche, utilisateurId } = parsed.data;

    if (utilisateurId) {
      const invalide = await verifierCompteLie(utilisateurId);
      if (invalide) return res.status(invalide.status).json({ erreur: invalide.erreur });
    }

    const travailleur = await prisma.travailleur.create({
      data: {
        nom,
        telephone: telephone ?? null,
        poste,
        dateEmbauche: new Date(dateEmbauche),
        utilisateurId: utilisateurId ?? null,
      },
      include: INCLUDE_TRAVAILLEUR,
    });
    res.status(201).json({ travailleur: versTravailleurDTO(travailleur) });
  } catch (e) {
    next(e);
  }
});

travailleursRouter.put("/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = travailleurUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existant = await prisma.travailleur.findUnique({ where: { id: req.params.id } });
    if (!existant) return res.status(404).json({ erreur: "Travailleur introuvable" });

    const { nom, telephone, poste, dateEmbauche, utilisateurId } = parsed.data;

    if (utilisateurId) {
      const invalide = await verifierCompteLie(utilisateurId, existant.id);
      if (invalide) return res.status(invalide.status).json({ erreur: invalide.erreur });
    }

    const travailleur = await prisma.travailleur.update({
      where: { id: existant.id },
      data: {
        nom,
        telephone,
        poste,
        dateEmbauche: dateEmbauche ? new Date(dateEmbauche) : undefined,
        // undefined = intact ; null = délier ; id = lier.
        utilisateurId,
      },
      include: INCLUDE_TRAVAILLEUR,
    });
    res.json({ travailleur: versTravailleurDTO(travailleur) });
  } catch (e) {
    next(e);
  }
});

// La suppression retire aussi les pointages (cascade) — la fiche fait foi.
travailleursRouter.delete("/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const travailleur = await prisma.travailleur.findUnique({ where: { id: req.params.id } });
    if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });
    await prisma.travailleur.delete({ where: { id: travailleur.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// --- Adresse email professionnelle (section 3.18, nouveau) ------------------

/** Retire les accents/diacritiques et ne garde que [a-z0-9]. */
function normaliserPourEmail(segment: string): string {
  return segment
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** prenom.nom — premier mot du nom complet = prénom, le reste = nom de famille. */
function baseAdresseDepuisNom(nomComplet: string): string {
  const mots = nomComplet.trim().split(/\s+/);
  const prenom = normaliserPourEmail(mots[0] ?? "");
  const nom = normaliserPourEmail(mots.slice(1).join(""));
  if (prenom && nom) return `${prenom}.${nom}`;
  return prenom || nom || "employe";
}

/** Ajoute un suffixe numérique (2, 3…) si l'adresse de base est déjà prise par un AUTRE travailleur — collision de prénom+nom. */
async function genererAdresseProUnique(nomComplet: string, ignorerTravailleurId: string): Promise<string> {
  const base = baseAdresseDepuisNom(nomComplet);
  for (let suffixe = 1; ; suffixe++) {
    const local = suffixe === 1 ? base : `${base}${suffixe}`;
    const adresse = `${local}@${APEX}`;
    const existant = await prisma.travailleur.findUnique({ where: { emailProAdresse: adresse } });
    if (!existant || existant.id === ignorerTravailleurId) return adresse;
  }
}

const messageErreurCloudflare = (e: unknown): string =>
  e instanceof ErreurCloudflare ? e.message : e instanceof Error ? e.message : "Erreur inconnue";

// Déclenche la création : adresse de destination Cloudflare (envoie l'email
// de vérification à l'employé) + adresse pro générée (avec suffixe en cas de
// collision). La règle de routage n'est créée immédiatement que si la
// destination est DÉJÀ vérifiée (rare à ce stade) — sinon /verifier la
// complète une fois l'employé passé par le lien reçu.
travailleursRouter.post("/:id/email-pro", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const travailleur = await prisma.travailleur.findUnique({ where: { id: req.params.id } });
    if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });

    const parsed = emailProCreerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { emailDestination } = parsed.data;
    const emailProAdresse = travailleur.emailProAdresse ?? (await genererAdresseProUnique(travailleur.nom, travailleur.id));

    try {
      const destination = await creerOuObtenirDestination(emailDestination);
      let statut: StatutEmailPro = "EN_ATTENTE_VERIFICATION";
      let cloudflareRegleId = travailleur.cloudflareRegleId;
      let erreur: string | null = null;

      // Destination déjà vérifiée (ex. réutilisée d'une fiche précédente) :
      // la règle peut être posée tout de suite, pas besoin d'attendre.
      if (destination.verified) {
        try {
          const regle = await creerRegleRoutage(emailProAdresse, emailDestination);
          cloudflareRegleId = regle.id;
          statut = "ACTIF";
        } catch (e) {
          statut = "ECHEC";
          erreur = messageErreurCloudflare(e);
        }
      }

      const maj = await prisma.travailleur.update({
        where: { id: travailleur.id },
        data: {
          emailDestination,
          emailProAdresse,
          emailProStatut: statut,
          emailProErreur: erreur,
          cloudflareAdresseId: destination.id,
          cloudflareRegleId,
        },
        include: INCLUDE_TRAVAILLEUR,
      });
      res.status(201).json({ travailleur: versTravailleurDTO(maj) });
    } catch (e) {
      // Échec de l'appel Cloudflare lui-même (jeton invalide, compte/zone
      // incorrects, adresse refusée…) — jamais silencieux : le motif exact
      // remonte jusqu'à la fiche pour que l'Admin puisse agir.
      const maj = await prisma.travailleur.update({
        where: { id: travailleur.id },
        data: { emailDestination, emailProAdresse, emailProStatut: "ECHEC", emailProErreur: messageErreurCloudflare(e) },
        include: INCLUDE_TRAVAILLEUR,
      });
      res.status(201).json({ travailleur: versTravailleurDTO(maj) });
    }
  } catch (e) {
    next(e);
  }
});

// Re-vérifie l'état côté Cloudflare (asynchrone : dépend du clic de
// l'employé sur le lien reçu, hors du contrôle de l'app) et pose la règle de
// routage dès que la destination est vérifiée.
travailleursRouter.post("/:id/email-pro/verifier", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const travailleur = await prisma.travailleur.findUnique({ where: { id: req.params.id } });
    if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });

    if (travailleur.emailProStatut === "AUCUNE") {
      return res.status(400).json({ erreur: "Aucune adresse professionnelle n'a encore été demandée pour ce travailleur." });
    }
    if (travailleur.emailProStatut === "ACTIF") {
      const complet = await prisma.travailleur.findUnique({ where: { id: travailleur.id }, include: INCLUDE_TRAVAILLEUR });
      return res.json({ travailleur: versTravailleurDTO(complet!) });
    }
    if (!travailleur.cloudflareAdresseId || !travailleur.emailProAdresse || !travailleur.emailDestination) {
      return res.status(409).json({ erreur: "État incomplet pour la vérification — relancez la création de l'adresse pro." });
    }

    try {
      const destination = await obtenirDestination(travailleur.cloudflareAdresseId);
      if (!destination.verified) {
        // Toujours en attente : rien à faire, l'employé n'a pas encore cliqué
        // le lien — l'UI réessaiera plus tard (bouton ou actualisation automatique).
        const inchange = await prisma.travailleur.findUnique({ where: { id: travailleur.id }, include: INCLUDE_TRAVAILLEUR });
        return res.json({ travailleur: versTravailleurDTO(inchange!) });
      }

      const regle = await creerRegleRoutage(travailleur.emailProAdresse, travailleur.emailDestination);
      const maj = await prisma.travailleur.update({
        where: { id: travailleur.id },
        data: { emailProStatut: "ACTIF", cloudflareRegleId: regle.id, emailProErreur: null },
        include: INCLUDE_TRAVAILLEUR,
      });
      res.json({ travailleur: versTravailleurDTO(maj) });
    } catch (e) {
      const maj = await prisma.travailleur.update({
        where: { id: travailleur.id },
        data: { emailProStatut: "ECHEC", emailProErreur: messageErreurCloudflare(e) },
        include: INCLUDE_TRAVAILLEUR,
      });
      res.json({ travailleur: versTravailleurDTO(maj) });
    }
  } catch (e) {
    next(e);
  }
});

// --- Présence / pointage quotidien ------------------------------------------

// Filtres : ?travailleurId, ?du, ?au (dates AAAA-MM-JJ) — « Tout afficher »
// sans paramètres, même pattern que Commandes/Commissions.
travailleursRouter.get("/presences", requirePermission("TRAVAILLEURS", "LECTURE"), async (req, res, next) => {
  try {
    const { travailleurId, du, au } = req.query as Record<string, string | undefined>;
    const date: Prisma.DateTimeFilter = {};
    if (du) date.gte = new Date(du);
    if (au) date.lte = new Date(au);

    const presences = await prisma.presence.findMany({
      where: {
        ...(travailleurId ? { travailleurId } : {}),
        ...(du || au ? { date } : {}),
      },
      include: INCLUDE_PRESENCE,
      orderBy: [{ date: "desc" }, { travailleur: { nom: "asc" } }],
      take: 200,
    });
    res.json({ presences: presences.map(versPresenceDTO) });
  } catch (e) {
    next(e);
  }
});

// Pointage : une ligne par travailleur et par jour — re-pointer le même jour
// corrige la ligne existante (upsert sur la contrainte unique), en gardant la
// trace de qui a enregistré la dernière version.
travailleursRouter.post("/presences", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = presencePointageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { travailleurId, date, statut, heureArrivee, heureDepart } = parsed.data;

    const travailleur = await prisma.travailleur.findUnique({ where: { id: travailleurId } });
    if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });

    const donnees = {
      statut,
      heureArrivee: heureArrivee ?? null,
      heureDepart: heureDepart ?? null,
      enregistreParId: req.utilisateur!.id,
    };
    const presence = await prisma.presence.upsert({
      where: { travailleurId_date: { travailleurId, date: new Date(date) } },
      update: donnees,
      create: { travailleurId, date: new Date(date), ...donnees },
      include: INCLUDE_PRESENCE,
    });
    res.status(201).json({ presence: versPresenceDTO(presence) });
  } catch (e) {
    next(e);
  }
});
