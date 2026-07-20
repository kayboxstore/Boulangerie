import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  presencePointageSchema,
  travailleurCreateSchema,
  travailleurUpdateSchema,
  type PresenceDTO,
  type StatutPresence,
  type TravailleurDTO,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

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
