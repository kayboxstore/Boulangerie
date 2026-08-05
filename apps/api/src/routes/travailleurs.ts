import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  absenceDeclarerSchema,
  absenceDecisionSchema,
  emailProCreerSchema,
  pointageCreerSchema,
  pointageModifierSchema,
  ROLE_ADMINISTRATEUR,
  travailleurCreateSchema,
  travailleurUpdateSchema,
  type AbsenceDTO,
  type PointageDTO,
  type StatutDecisionAbsence,
  type StatutEmailPro,
  type TravailleurDTO,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { declencherEmailPro, verifierEmailPro } from "../services/emailPro.js";
import { busEvenements } from "../lib/events.js";

export const travailleursRouter = Router();

travailleursRouter.use(requireAuth);

type TravailleurAvecCompte = Prisma.TravailleurGetPayload<{
  include: {
    utilisateur: { select: { id: true; nom: true; email: true } };
    departement: { select: { id: true; nom: true } };
    groupe: { select: { id: true; nom: true } };
  };
}>;

export const INCLUDE_TRAVAILLEUR = {
  utilisateur: { select: { id: true, nom: true, email: true } },
  departement: { select: { id: true, nom: true } },
  groupe: { select: { id: true, nom: true } },
} as const;

export const versTravailleurDTO = (t: TravailleurAvecCompte): TravailleurDTO => ({
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
  departement: t.departement,
  groupe: t.groupe,
});

/**
 * Vérifie la cohérence département/groupe (3.18) : un groupe appartient
 * toujours à un département précis, un Travailleur ne peut donc pas être
 * rattaché à un groupe qui n'est pas celui de son propre département. Un
 * département nul entraîne systématiquement un groupe nul (pas de groupe
 * « orphelin » d'un département).
 */
async function validerDepartementGroupe(
  departementId: string | null,
  groupeId: string | null,
): Promise<{ status: number; erreur: string } | { departementId: string | null; groupeId: string | null }> {
  if (!departementId) return { departementId: null, groupeId: null };

  const departement = await prisma.departement.findUnique({ where: { id: departementId } });
  if (!departement) return { status: 404, erreur: "Département introuvable" };

  if (!groupeId) return { departementId, groupeId: null };

  const groupe = await prisma.groupe.findUnique({ where: { id: groupeId } });
  if (!groupe) return { status: 404, erreur: "Groupe introuvable" };
  if (groupe.departementId !== departementId) {
    return { status: 400, erreur: "Le groupe sélectionné n'appartient pas à ce département" };
  }
  return { departementId, groupeId };
}

type PointageAvecRelations = Prisma.PointageGetPayload<{
  include: {
    travailleur: { select: { id: true; nom: true; poste: true } };
    enregistrePar: { select: { id: true; nom: true } };
  };
}>;

const INCLUDE_POINTAGE = {
  travailleur: { select: { id: true, nom: true, poste: true } },
  enregistrePar: { select: { id: true, nom: true } },
} as const;

const versPointageDTO = (p: PointageAvecRelations): PointageDTO => ({
  id: p.id,
  travailleur: p.travailleur,
  horodatageEntree: p.horodatageEntree.toISOString(),
  horodatageSortie: p.horodatageSortie?.toISOString() ?? null,
  enregistrePar: p.enregistrePar,
});

type AbsenceAvecRelations = Prisma.AbsenceGetPayload<{
  include: {
    travailleur: { select: { id: true; nom: true; poste: true } };
    declarePar: { select: { id: true; nom: true } };
    decidePar: { select: { id: true; nom: true } };
  };
}>;

const INCLUDE_ABSENCE = {
  travailleur: { select: { id: true, nom: true, poste: true } },
  declarePar: { select: { id: true, nom: true } },
  decidePar: { select: { id: true, nom: true } },
} as const;

const versAbsenceDTO = (a: AbsenceAvecRelations): AbsenceDTO => ({
  id: a.id,
  travailleur: a.travailleur,
  date: a.date.toISOString().slice(0, 10),
  motif: a.motif,
  declarePar: a.declarePar,
  decisionStatut: a.decisionStatut as StatutDecisionAbsence,
  decidePar: a.decidePar,
  dateDecision: a.dateDecision?.toISOString() ?? null,
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
    const { nom, telephone, poste, dateEmbauche, utilisateurId, departementId, groupeId } = parsed.data;

    if (utilisateurId) {
      const invalide = await verifierCompteLie(utilisateurId);
      if (invalide) return res.status(invalide.status).json({ erreur: invalide.erreur });
    }

    const depGroupe = await validerDepartementGroupe(departementId, groupeId ?? null);
    if ("erreur" in depGroupe) return res.status(depGroupe.status).json({ erreur: depGroupe.erreur });

    const travailleur = await prisma.travailleur.create({
      data: {
        nom,
        telephone: telephone ?? null,
        poste,
        dateEmbauche: new Date(dateEmbauche),
        utilisateurId: utilisateurId ?? null,
        departementId: depGroupe.departementId,
        groupeId: depGroupe.groupeId,
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

    const { nom, telephone, poste, dateEmbauche, utilisateurId, departementId, groupeId } = parsed.data;

    if (utilisateurId) {
      const invalide = await verifierCompteLie(utilisateurId, existant.id);
      if (invalide) return res.status(invalide.status).json({ erreur: invalide.erreur });
    }

    // undefined = champ non touché par cette requête ; on part alors de la
    // valeur actuelle pour revalider la cohérence département/groupe.
    const departementFinal = departementId !== undefined ? departementId : existant.departementId;
    const groupeFinal = groupeId !== undefined ? groupeId : existant.groupeId;
    const depGroupe = await validerDepartementGroupe(departementFinal, groupeFinal);
    if ("erreur" in depGroupe) return res.status(depGroupe.status).json({ erreur: depGroupe.erreur });

    const travailleur = await prisma.travailleur.update({
      where: { id: existant.id },
      data: {
        nom,
        telephone,
        poste,
        dateEmbauche: dateEmbauche ? new Date(dateEmbauche) : undefined,
        // undefined = intact ; null = délier ; id = lier.
        utilisateurId,
        departementId: depGroupe.departementId,
        groupeId: depGroupe.groupeId,
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
// Logique de génération/appels Cloudflare : services/emailPro.ts, partagée
// avec l'Assistant de premier lancement (routes/premierLancement.ts).

travailleursRouter.post("/:id/email-pro", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const travailleur = await prisma.travailleur.findUnique({ where: { id: req.params.id } });
    if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });

    const parsed = emailProCreerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }

    const maj = await declencherEmailPro(travailleur, parsed.data.emailDestination);
    const complet = await prisma.travailleur.findUnique({ where: { id: maj.id }, include: INCLUDE_TRAVAILLEUR });
    res.status(201).json({ travailleur: versTravailleurDTO(complet!) });
  } catch (e) {
    next(e);
  }
});

travailleursRouter.post("/:id/email-pro/verifier", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const travailleur = await prisma.travailleur.findUnique({ where: { id: req.params.id } });
    if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });

    const resultat = await verifierEmailPro(travailleur);
    if (resultat.erreur) return res.status(resultat.status ?? 400).json({ erreur: resultat.erreur });

    const complet = await prisma.travailleur.findUnique({ where: { id: resultat.travailleur.id }, include: INCLUDE_TRAVAILLEUR });
    res.json({ travailleur: versTravailleurDTO(complet!) });
  } catch (e) {
    next(e);
  }
});

// --- Pointage (section 3.18, remplace Presence) ------------------------------
// Horodatage réel d'entrée/sortie (date + heure, pas juste une date) : gère
// nativement les équipes de nuit à cheval sur deux jours calendaires — c'est
// l'horodatage lui-même qui fait foi, jamais une "date du pointage" isolée.

// Filtres : ?travailleurId, ?du, ?au (AAAA-MM-JJ, bornent horodatageEntree) —
// « Tout afficher » sans paramètres, même pattern que Commandes/Commissions.
travailleursRouter.get("/pointages", requirePermission("TRAVAILLEURS", "LECTURE"), async (req, res, next) => {
  try {
    const { travailleurId, du, au } = req.query as Record<string, string | undefined>;
    const horodatageEntree: Prisma.DateTimeFilter = {};
    if (du) horodatageEntree.gte = new Date(du);
    if (au) horodatageEntree.lte = new Date(`${au}T23:59:59.999Z`);

    const pointages = await prisma.pointage.findMany({
      where: {
        ...(travailleurId ? { travailleurId } : {}),
        ...(du || au ? { horodatageEntree } : {}),
      },
      include: INCLUDE_POINTAGE,
      orderBy: { horodatageEntree: "desc" },
      take: 200,
    });
    res.json({ pointages: pointages.map(versPointageDTO) });
  } catch (e) {
    next(e);
  }
});

// Création : entrée seule (pointage "ouvert", personne encore en poste) ou
// entrée+sortie d'emblée (saisie a posteriori d'un pointage déjà complet).
travailleursRouter.post("/pointages", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = pointageCreerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { travailleurId, horodatageEntree, horodatageSortie } = parsed.data;

    const travailleur = await prisma.travailleur.findUnique({ where: { id: travailleurId } });
    if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });

    if (horodatageSortie && new Date(horodatageSortie) <= new Date(horodatageEntree)) {
      return res.status(400).json({ erreur: "L'horodatage de sortie doit être postérieur à l'horodatage d'entrée" });
    }

    const pointage = await prisma.pointage.create({
      data: {
        travailleurId,
        horodatageEntree: new Date(horodatageEntree),
        horodatageSortie: horodatageSortie ? new Date(horodatageSortie) : null,
        enregistreParId: req.utilisateur!.id,
      },
      include: INCLUDE_POINTAGE,
    });
    res.status(201).json({ pointage: versPointageDTO(pointage) });
  } catch (e) {
    next(e);
  }
});

// Modification : clôturer la sortie d'un pointage encore ouvert, ou corriger
// une saisie (horodatageSortie: null rouvre le pointage).
travailleursRouter.put("/pointages/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = pointageModifierSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existant = await prisma.pointage.findUnique({ where: { id: req.params.id } });
    if (!existant) return res.status(404).json({ erreur: "Pointage introuvable" });

    const { horodatageEntree, horodatageSortie } = parsed.data;
    const entreeFinale = horodatageEntree ? new Date(horodatageEntree) : existant.horodatageEntree;
    const sortieFinale = horodatageSortie === undefined ? existant.horodatageSortie : horodatageSortie ? new Date(horodatageSortie) : null;
    if (sortieFinale && sortieFinale <= entreeFinale) {
      return res.status(400).json({ erreur: "L'horodatage de sortie doit être postérieur à l'horodatage d'entrée" });
    }

    const pointage = await prisma.pointage.update({
      where: { id: existant.id },
      data: { horodatageEntree: entreeFinale, horodatageSortie: sortieFinale },
      include: INCLUDE_POINTAGE,
    });
    res.json({ pointage: versPointageDTO(pointage) });
  } catch (e) {
    next(e);
  }
});

travailleursRouter.delete("/pointages/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const pointage = await prisma.pointage.findUnique({ where: { id: req.params.id } });
    if (!pointage) return res.status(404).json({ erreur: "Pointage introuvable" });
    await prisma.pointage.delete({ where: { id: pointage.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// --- Absence (section 3.18, nouveau) -----------------------------------------
// Entité distincte du Pointage : motif déclaré + décision séparée (en_attente/
// justifiée/non_justifiée), tranchée par l'Admin secondaire ou Principal —
// jamais par le chef de département (purement organisationnel, 3.18).

travailleursRouter.get("/absences", requirePermission("TRAVAILLEURS", "LECTURE"), async (req, res, next) => {
  try {
    const { travailleurId, du, au } = req.query as Record<string, string | undefined>;
    const date: Prisma.DateTimeFilter = {};
    if (du) date.gte = new Date(du);
    if (au) date.lte = new Date(au);

    const absences = await prisma.absence.findMany({
      where: {
        ...(travailleurId ? { travailleurId } : {}),
        ...(du || au ? { date } : {}),
      },
      include: INCLUDE_ABSENCE,
      orderBy: [{ date: "desc" }, { travailleur: { nom: "asc" } }],
      take: 200,
    });
    res.json({ absences: absences.map(versAbsenceDTO) });
  } catch (e) {
    next(e);
  }
});

// Déclaration initiale : motif + date, decisionStatut démarre à EN_ATTENTE
// (jamais choisi ici — c'est la route de décision, plus bas, qui la tranche).
travailleursRouter.post("/absences", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = absenceDeclarerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { travailleurId, date, motif } = parsed.data;

    const travailleur = await prisma.travailleur.findUnique({ where: { id: travailleurId } });
    if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });

    const absence = await prisma.absence.create({
      data: { travailleurId, date: new Date(date), motif, declareParId: req.utilisateur!.id },
      include: INCLUDE_ABSENCE,
    });
    res.status(201).json({ absence: versAbsenceDTO(absence) });
  } catch (e) {
    next(e);
  }
});

travailleursRouter.delete("/absences/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const absence = await prisma.absence.findUnique({ where: { id: req.params.id } });
    if (!absence) return res.status(404).json({ erreur: "Absence introuvable" });
    await prisma.absence.delete({ where: { id: absence.id } });
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Décision : acte distinct de la déclaration — réservé aux mêmes rôles
// (TRAVAILLEURS écriture), sans exiger que ce soit une personne différente
// de celle qui a déclaré l'absence. Notifie en temps réel quand la décision
// est NON_JUSTIFIEE (le travailleur concerné, s'il a un compte, + les Admins).
travailleursRouter.put("/absences/:id/decision", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = absenceDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const existant = await prisma.absence.findUnique({ where: { id: req.params.id }, include: INCLUDE_ABSENCE });
    if (!existant) return res.status(404).json({ erreur: "Absence introuvable" });

    const absence = await prisma.absence.update({
      where: { id: existant.id },
      data: {
        decisionStatut: parsed.data.decisionStatut,
        decideParId: req.utilisateur!.id,
        dateDecision: new Date(),
      },
      include: INCLUDE_ABSENCE,
    });

    if (parsed.data.decisionStatut === "NON_JUSTIFIEE") {
      const autresAdmins = await prisma.utilisateur.findMany({
        where: { actif: true, id: { not: req.utilisateur!.id }, role: { nom: ROLE_ADMINISTRATEUR } },
        select: { id: true },
      });
      const destinataires = new Set(autresAdmins.map((a) => a.id));
      const travailleurConcerne = await prisma.travailleur.findUnique({ where: { id: existant.travailleurId } });
      if (travailleurConcerne?.utilisateurId) destinataires.add(travailleurConcerne.utilisateurId);
      if (destinataires.size > 0) {
        busEvenements.emettreEvenement({
          type: "ABSENCE_NON_JUSTIFIEE",
          module: "TRAVAILLEURS",
          emetteurId: req.utilisateur!.id,
          evenementRef: absence.id,
          priorite: "HAUTE",
          destinataireIdsDirects: [...destinataires],
          message: `Absence de ${absence.travailleur.nom} le ${absence.date.toISOString().slice(0, 10)} tranchée non justifiée`,
          donnees: { absenceId: absence.id, travailleurId: absence.travailleur.id },
        });
      }
    }

    res.json({ absence: versAbsenceDTO(absence) });
  } catch (e) {
    next(e);
  }
});
