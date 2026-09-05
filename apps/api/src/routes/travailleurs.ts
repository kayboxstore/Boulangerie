import { Router } from "express";
import type { Request } from "express";
import { Prisma } from "@prisma/client";
import {
  aAcces,
  absenceDeclarerSchema,
  absenceDecisionSchema,
  emailProCreerSchema,
  moisISO,
  pointageCreerSchema,
  pointageModifierSchema,
  ROLE_ADMINISTRATEUR,
  sanctionCreateSchema,
  travailleurCreateSchema,
  travailleurUpdateSchema,
  type AbsenceDTO,
  type AlerteAbsenceDTO,
  type BulletinPaieDTO,
  type CalculPaieDTO,
  type DocumentExportInput,
  type PointageDTO,
  type SanctionDTO,
  type StatutDecisionAbsence,
  type StatutEmailPro,
  type TravailleurDTO,
  type TypeSanction,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import type { TxClient } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { declencherEmailPro, verifierEmailPro } from "../services/emailPro.js";
import { construirePdf, nomFichierPdf } from "../services/pdf.js";
import { busEvenements } from "../lib/events.js";
import { ErreurAction } from "../lib/erreurAction.js";
import {
  auditerCaisseTx,
  ErreurEcritureCaisseReessayable,
  estViolationContrainteUnique,
  executerAvecReessaiP2034,
  transactionSerializable,
} from "../services/caisseAtomique.js";

export const travailleursRouter = Router();

travailleursRouter.use(requireAuth);

const transactionTravailleurs = <T>(executer: (tx: TxClient) => Promise<T>): Promise<T> =>
  executerAvecReessaiP2034(() => transactionSerializable(prisma, executer));

async function verrouillerTravailleur(tx: TxClient, id: string): Promise<boolean> {
  const lignes = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Travailleur" WHERE "id" = ${id} FOR UPDATE
  `;
  return lignes.length === 1;
}

async function verrouillerPointage(tx: TxClient, id: string): Promise<boolean> {
  const lignes = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Pointage" WHERE "id" = ${id} FOR UPDATE
  `;
  return lignes.length === 1;
}

async function verrouillerAbsence(tx: TxClient, id: string): Promise<boolean> {
  const lignes = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Absence" WHERE "id" = ${id} FOR UPDATE
  `;
  return lignes.length === 1;
}

async function verrouillerSanction(tx: TxClient, id: string): Promise<boolean> {
  const lignes = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Sanction" WHERE "id" = ${id} FOR UPDATE
  `;
  return lignes.length === 1;
}

function erreurMutationTravailleurs(e: unknown): { status: number; erreur: string } | null {
  if (e instanceof ErreurAction) return { status: e.status, erreur: e.message };
  if (e instanceof ErreurEcritureCaisseReessayable) {
    return { status: 503, erreur: "Conflit de concurrence persistant — réessayez. Rien n'a été enregistré." };
  }
  if (estViolationContrainteUnique(e)) {
    return { status: 409, erreur: "Cette opération entre en conflit avec un enregistrement existant." };
  }
  return null;
}

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
  salaireMensuel: t.salaireMensuel,
  joursTravaillesParMois: t.joursTravaillesParMois,
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
  db: Pick<TxClient, "departement" | "groupe"> = prisma,
): Promise<{ status: number; erreur: string } | { departementId: string | null; groupeId: string | null }> {
  if (!departementId) return { departementId: null, groupeId: null };

  const departement = await db.departement.findUnique({ where: { id: departementId } });
  if (!departement) return { status: 404, erreur: "Département introuvable" };

  if (!groupeId) return { departementId, groupeId: null };

  const groupe = await db.groupe.findUnique({ where: { id: groupeId } });
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
  alerteEnvoyeeLe: a.alerteEnvoyeeLe?.toISOString() ?? null,
});

/** Vérifie que le compte Utilisateur à lier existe et n'a pas déjà une fiche. */
async function verifierCompteLie(
  utilisateurId: string,
  ignorerTravailleurId?: string,
  db: Pick<TxClient, "utilisateur" | "travailleur"> = prisma,
): Promise<{ status: number; erreur: string } | null> {
  const compte = await db.utilisateur.findUnique({ where: { id: utilisateurId } });
  if (!compte) return { status: 404, erreur: "Compte utilisateur introuvable" };
  const dejaLie = await db.travailleur.findUnique({ where: { utilisateurId } });
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
    const { nom, telephone, poste, dateEmbauche, utilisateurId, departementId, groupeId, salaireMensuel, joursTravaillesParMois } = parsed.data;

    try {
      const travailleur = await transactionTravailleurs(async (tx) => {
        if (utilisateurId) {
          const invalide = await verifierCompteLie(utilisateurId, undefined, tx);
          if (invalide) throw new ErreurAction(invalide.status, invalide.erreur);
        }

        const depGroupe = await validerDepartementGroupe(departementId, groupeId ?? null, tx);
        if ("erreur" in depGroupe) throw new ErreurAction(depGroupe.status, depGroupe.erreur);

        return tx.travailleur.create({
          data: {
            nom,
            telephone: telephone ?? null,
            poste,
            dateEmbauche: new Date(dateEmbauche),
            utilisateurId: utilisateurId ?? null,
            creeParId: req.utilisateur!.id,
            departementId: depGroupe.departementId,
            groupeId: depGroupe.groupeId,
            salaireMensuel,
            joursTravaillesParMois,
          } as unknown as Prisma.TravailleurUncheckedCreateInput,
          include: INCLUDE_TRAVAILLEUR,
        });
      });
      res.status(201).json({ travailleur: versTravailleurDTO(travailleur) });
    } catch (e) {
      const erreur = erreurMutationTravailleurs(e);
      if (erreur) return res.status(erreur.status).json({ erreur: erreur.erreur });
      throw e;
    }
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
    const { nom, telephone, poste, dateEmbauche, utilisateurId, departementId, groupeId, salaireMensuel, joursTravaillesParMois } = parsed.data;
    try {
      const travailleur = await transactionTravailleurs(async (tx) => {
        if (!(await verrouillerTravailleur(tx, req.params.id))) {
          throw new ErreurAction(404, "Travailleur introuvable");
        }
        const existant = await tx.travailleur.findUnique({ where: { id: req.params.id } });
        if (!existant) throw new ErreurAction(404, "Travailleur introuvable");

        if (utilisateurId) {
          const invalide = await verifierCompteLie(utilisateurId, existant.id, tx);
          if (invalide) throw new ErreurAction(invalide.status, invalide.erreur);
        }

        const departementFinal = departementId !== undefined ? departementId : existant.departementId;
        const groupeFinal = groupeId !== undefined ? groupeId : existant.groupeId;
        const depGroupe = await validerDepartementGroupe(departementFinal, groupeFinal, tx);
        if ("erreur" in depGroupe) throw new ErreurAction(depGroupe.status, depGroupe.erreur);

        const { count } = await tx.travailleur.updateMany({
          where: { id: existant.id, utilisateurId: existant.utilisateurId },
          data: {
            nom,
            telephone,
            poste,
            dateEmbauche: dateEmbauche ? new Date(dateEmbauche) : undefined,
            utilisateurId,
            departementId: depGroupe.departementId,
            groupeId: depGroupe.groupeId,
            salaireMensuel,
            joursTravaillesParMois,
          },
        });
        if (count !== 1) throw new ErreurAction(409, "La fiche a changé entre-temps — réessayez.");

        const apres = await tx.travailleur.findUniqueOrThrow({ where: { id: existant.id }, include: INCLUDE_TRAVAILLEUR });
        await auditerCaisseTx(tx, {
          module: "TRAVAILLEURS",
          typeEntite: "Travailleur",
          entiteId: existant.id,
          action: "MODIFICATION",
          avant: existant,
          apres,
        });
        return apres;
      });
      res.json({ travailleur: versTravailleurDTO(travailleur) });
    } catch (e) {
      const erreur = erreurMutationTravailleurs(e);
      if (erreur) return res.status(erreur.status).json({ erreur: erreur.erreur });
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

// La suppression retire aussi pointages/absences/sanctions (cascade, purement
// opérationnel) — la fiche fait foi. Les bulletins de paie, eux, sont un
// historique officiel (mêmes principe que les commandes d'un client, voir
// clients.ts) : jamais supprimés silencieusement avec la fiche.
travailleursRouter.delete("/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    try {
      await transactionTravailleurs(async (tx) => {
        if (!(await verrouillerTravailleur(tx, req.params.id))) {
          throw new ErreurAction(404, "Travailleur introuvable");
        }
        const travailleur = await tx.travailleur.findUniqueOrThrow({
          where: { id: req.params.id },
          include: { _count: { select: { bulletinsPaie: true, pointages: true, absences: true, sanctions: true } } },
        });
        if (travailleur._count.bulletinsPaie > 0) {
          throw new ErreurAction(
            409,
            `Suppression impossible : ${travailleur._count.bulletinsPaie} bulletin(s) de paie enregistré(s) pour ce travailleur`,
          );
        }

        const { count } = await tx.travailleur.deleteMany({ where: { id: travailleur.id } });
        if (count !== 1) throw new ErreurAction(409, "La fiche a changé entre-temps — réessayez.");
        await auditerCaisseTx(tx, {
          module: "TRAVAILLEURS",
          typeEntite: "Travailleur",
          entiteId: travailleur.id,
          action: "SUPPRESSION",
          avant: {
            ...travailleur,
            nombrePointages: travailleur._count.pointages,
            nombreAbsences: travailleur._count.absences,
            nombreSanctions: travailleur._count.sanctions,
            nombreBulletinsPaie: travailleur._count.bulletinsPaie,
          },
          apres: null,
        });
      });
      res.status(204).end();
    } catch (e) {
      const erreur = erreurMutationTravailleurs(e);
      if (erreur) return res.status(erreur.status).json({ erreur: erreur.erreur });
      throw e;
    }
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
async function verifierAucunChevauchementPointage(
  tx: TxClient,
  travailleurId: string,
  entree: Date,
  sortie: Date | null,
  ignorerId?: string,
): Promise<void> {
  const borneSortie = sortie ?? new Date("9999-12-31T23:59:59.999Z");
  const conflit = await tx.pointage.findFirst({
    where: {
      travailleurId,
      ...(ignorerId ? { id: { not: ignorerId } } : {}),
      horodatageEntree: { lt: borneSortie },
      OR: [{ horodatageSortie: null }, { horodatageSortie: { gt: entree } }],
    },
    select: { id: true },
  });
  if (conflit) throw new ErreurAction(409, "Ce pointage chevauche déjà une autre période de présence de ce travailleur.");
}

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

    const entree = new Date(horodatageEntree);
    const sortie = horodatageSortie ? new Date(horodatageSortie) : null;
    if (sortie && sortie <= entree) {
      return res.status(400).json({ erreur: "L'horodatage de sortie doit être postérieur à l'horodatage d'entrée" });
    }
    try {
      const pointage = await transactionTravailleurs(async (tx) => {
        if (!(await verrouillerTravailleur(tx, travailleurId))) throw new ErreurAction(404, "Travailleur introuvable");
        await verifierAucunChevauchementPointage(tx, travailleurId, entree, sortie);
        return tx.pointage.create({
          data: { travailleurId, horodatageEntree: entree, horodatageSortie: sortie, enregistreParId: req.utilisateur!.id },
          include: INCLUDE_POINTAGE,
        });
      });
      res.status(201).json({ pointage: versPointageDTO(pointage) });
    } catch (e) {
      const erreur = erreurMutationTravailleurs(e);
      if (erreur) return res.status(erreur.status).json({ erreur: erreur.erreur });
      throw e;
    }
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
    const { horodatageEntree, horodatageSortie } = parsed.data;
    try {
      const avantPrelecture = await prisma.pointage.findUnique({ where: { id: req.params.id }, select: { travailleurId: true } });
      if (!avantPrelecture) throw new ErreurAction(404, "Pointage introuvable");
      const pointage = await transactionTravailleurs(async (tx) => {
        if (!(await verrouillerTravailleur(tx, avantPrelecture.travailleurId))) throw new ErreurAction(404, "Travailleur introuvable");
        if (!(await verrouillerPointage(tx, req.params.id))) throw new ErreurAction(404, "Pointage introuvable");
        const existant = await tx.pointage.findUniqueOrThrow({ where: { id: req.params.id } });
        if (existant.travailleurId !== avantPrelecture.travailleurId) throw new ErreurAction(409, "Le pointage a changé — réessayez.");

        const entreeFinale = horodatageEntree ? new Date(horodatageEntree) : existant.horodatageEntree;
        const sortieFinale = horodatageSortie === undefined ? existant.horodatageSortie : horodatageSortie ? new Date(horodatageSortie) : null;
        if (sortieFinale && sortieFinale <= entreeFinale) {
          throw new ErreurAction(400, "L'horodatage de sortie doit être postérieur à l'horodatage d'entrée");
        }
        await verifierAucunChevauchementPointage(tx, existant.travailleurId, entreeFinale, sortieFinale, existant.id);
        const { count } = await tx.pointage.updateMany({
          where: { id: existant.id },
          data: { horodatageEntree: entreeFinale, horodatageSortie: sortieFinale },
        });
        if (count !== 1) throw new ErreurAction(409, "Le pointage a changé — réessayez.");
        const apres = await tx.pointage.findUniqueOrThrow({ where: { id: existant.id }, include: INCLUDE_POINTAGE });
        await auditerCaisseTx(tx, {
          module: "TRAVAILLEURS",
          typeEntite: "Pointage",
          entiteId: existant.id,
          action: "MODIFICATION",
          avant: existant,
          apres,
        });
        return apres;
      });
      res.json({ pointage: versPointageDTO(pointage) });
    } catch (e) {
      const erreur = erreurMutationTravailleurs(e);
      if (erreur) return res.status(erreur.status).json({ erreur: erreur.erreur });
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

travailleursRouter.delete("/pointages/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    try {
      const prelecture = await prisma.pointage.findUnique({ where: { id: req.params.id }, select: { travailleurId: true } });
      if (!prelecture) throw new ErreurAction(404, "Pointage introuvable");
      await transactionTravailleurs(async (tx) => {
        if (!(await verrouillerTravailleur(tx, prelecture.travailleurId))) throw new ErreurAction(404, "Travailleur introuvable");
        if (!(await verrouillerPointage(tx, req.params.id))) throw new ErreurAction(404, "Pointage introuvable");
        const pointage = await tx.pointage.findUniqueOrThrow({ where: { id: req.params.id } });
        const { count } = await tx.pointage.deleteMany({ where: { id: pointage.id } });
        if (count !== 1) throw new ErreurAction(409, "Le pointage a changé — réessayez.");
        await auditerCaisseTx(tx, {
          module: "TRAVAILLEURS",
          typeEntite: "Pointage",
          entiteId: pointage.id,
          action: "SUPPRESSION",
          avant: pointage,
          apres: null,
        });
      });
      res.status(204).end();
    } catch (e) {
      const erreur = erreurMutationTravailleurs(e);
      if (erreur) return res.status(erreur.status).json({ erreur: erreur.erreur });
      throw e;
    }
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

    try {
      const dateAbsence = new Date(date);
      const absence = await transactionTravailleurs(async (tx) => {
        if (!(await verrouillerTravailleur(tx, travailleurId))) throw new ErreurAction(404, "Travailleur introuvable");
        const doublon = await tx.absence.findFirst({ where: { travailleurId, date: dateAbsence }, select: { id: true } });
        if (doublon) throw new ErreurAction(409, "Une absence existe déjà pour ce travailleur à cette date.");
        return tx.absence.create({
          data: { travailleurId, date: dateAbsence, motif, declareParId: req.utilisateur!.id },
          include: INCLUDE_ABSENCE,
        });
      });
      res.status(201).json({ absence: versAbsenceDTO(absence) });
    } catch (e) {
      const erreur = erreurMutationTravailleurs(e);
      if (erreur) return res.status(erreur.status).json({ erreur: erreur.erreur });
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

travailleursRouter.delete("/absences/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    try {
      const prelecture = await prisma.absence.findUnique({ where: { id: req.params.id }, select: { travailleurId: true } });
      if (!prelecture) throw new ErreurAction(404, "Absence introuvable");
      await transactionTravailleurs(async (tx) => {
        if (!(await verrouillerTravailleur(tx, prelecture.travailleurId))) throw new ErreurAction(404, "Travailleur introuvable");
        if (!(await verrouillerAbsence(tx, req.params.id))) throw new ErreurAction(404, "Absence introuvable");
        const absence = await tx.absence.findUniqueOrThrow({ where: { id: req.params.id } });
        const { count } = await tx.absence.deleteMany({ where: { id: absence.id } });
        if (count !== 1) throw new ErreurAction(409, "L'absence a changé — réessayez.");
        await auditerCaisseTx(tx, {
          module: "TRAVAILLEURS",
          typeEntite: "Absence",
          entiteId: absence.id,
          action: "SUPPRESSION",
          avant: absence,
          apres: null,
        });
      });
      res.status(204).end();
    } catch (e) {
      const erreur = erreurMutationTravailleurs(e);
      if (erreur) return res.status(erreur.status).json({ erreur: erreur.erreur });
      throw e;
    }
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
    try {
      const prelecture = await prisma.absence.findUnique({ where: { id: req.params.id }, select: { travailleurId: true } });
      if (!prelecture) throw new ErreurAction(404, "Absence introuvable");
      const absence = await transactionTravailleurs(async (tx) => {
        if (!(await verrouillerTravailleur(tx, prelecture.travailleurId))) throw new ErreurAction(404, "Travailleur introuvable");
        if (!(await verrouillerAbsence(tx, req.params.id))) throw new ErreurAction(404, "Absence introuvable");
        const existant = await tx.absence.findUniqueOrThrow({ where: { id: req.params.id } });
        if (existant.decisionStatut !== "EN_ATTENTE") {
          throw new ErreurAction(409, "Cette absence a déjà été tranchée.");
        }
        const { count } = await tx.absence.updateMany({
          where: { id: existant.id, decisionStatut: "EN_ATTENTE" },
          data: { decisionStatut: parsed.data.decisionStatut, decideParId: req.utilisateur!.id, dateDecision: new Date() },
        });
        if (count !== 1) throw new ErreurAction(409, "Cette absence a déjà été tranchée.");
        const apres = await tx.absence.findUniqueOrThrow({ where: { id: existant.id }, include: INCLUDE_ABSENCE });
        await auditerCaisseTx(tx, {
          module: "TRAVAILLEURS",
          typeEntite: "Absence",
          entiteId: existant.id,
          action: "MODIFICATION",
          avant: existant,
          apres,
        });
        return apres;
      });

      if (parsed.data.decisionStatut === "NON_JUSTIFIEE") {
      const autresAdmins = await prisma.utilisateur.findMany({
        where: { actif: true, id: { not: req.utilisateur!.id }, role: { nom: ROLE_ADMINISTRATEUR } },
        select: { id: true },
      });
      const destinataires = new Set(autresAdmins.map((a) => a.id));
      const travailleurConcerne = await prisma.travailleur.findUnique({ where: { id: absence.travailleur.id } });
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
      const erreur = erreurMutationTravailleurs(e);
      if (erreur) return res.status(erreur.status).json({ erreur: erreur.erreur });
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

const debutAujourdhui = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Rappel « absence en attente » (section 3.18, nouveau) — vérification
 * PARESSEUSE au chargement de l'app, même pattern exact que l'alerte « dette
 * non payée » (3.4, `verifierAlertesDette` dans routes/commandes.ts) : pas de
 * tâche planifiée, `updateMany` gardé sur `alerteEnvoyeeLe: null` en
 * compare-and-set atomique pour ne jamais renvoyer deux fois.
 *
 * Concernées : les absences déclarées avant aujourd'hui, encore EN_ATTENTE.
 * Événement SYSTÈME (aucun émetteur humain), restreint aux Admins (secondaire
 * + Principal) — pas le DG, qui a pourtant lecture sur Travailleurs.
 *
 * Exportée pour être aussi rejouée par le balayage périodique
 * (`services/planificateurAlertes.ts`, Lot 7 pt 2) — un filet de sécurité
 * pour les absences qu'aucun écran n'a rouvertes.
 */
export async function verifierAlertesAbsenceEnAttente(): Promise<void> {
  const debut = debutAujourdhui();

  const enAttente = await prisma.absence.findMany({
    where: { decisionStatut: "EN_ATTENTE", date: { lt: debut }, alerteEnvoyeeLe: null },
    include: { travailleur: { select: { nom: true } } },
    take: 200,
  });

  for (const a of enAttente) {
    const { count } = await prisma.absence.updateMany({
      where: { id: a.id, alerteEnvoyeeLe: null },
      data: { alerteEnvoyeeLe: new Date() },
    });
    if (count !== 1) continue;

    busEvenements.emettreEvenement({
      type: "ABSENCE_EN_ATTENTE",
      module: "TRAVAILLEURS",
      emetteurId: null, // déclenchée par le système
      evenementRef: a.id,
      priorite: "HAUTE",
      restreindreAuxRoles: [ROLE_ADMINISTRATEUR],
      message: `Absence de ${a.travailleur.nom} le ${a.date.toISOString().slice(0, 10)} toujours en attente de décision`,
      donnees: { absenceId: a.id, travailleurId: a.travailleurId },
    });
  }
}

/**
 * Déclenche la vérification paresseuse puis renvoie les absences en attente
 * antérieures à aujourd'hui, toujours ouvertes. La notification ne part
 * qu'une fois ; la liste, elle, reste affichée tant que la décision n'est
 * pas tranchée.
 */
travailleursRouter.get("/alertes-absence", requirePermission("TRAVAILLEURS", "LECTURE"), async (_req, res, next) => {
  try {
    await verifierAlertesAbsenceEnAttente();

    const debut = debutAujourdhui();
    const enAttente = await prisma.absence.findMany({
      where: { decisionStatut: "EN_ATTENTE", date: { lt: debut } },
      include: { travailleur: { select: { nom: true } } },
      orderBy: { date: "asc" },
      take: 100,
    });

    const alertes: AlerteAbsenceDTO[] = enAttente.map((a) => ({
      absenceId: a.id,
      travailleurNom: a.travailleur.nom,
      motif: a.motif,
      date: a.date.toISOString().slice(0, 10),
      joursDepuis: Math.max(1, Math.floor((debut.getTime() - a.date.getTime()) / 86_400_000)),
      alerteEnvoyeeLe: a.alerteEnvoyeeLe?.toISOString() ?? null,
    }));
    res.json({ alertes });
  } catch (e) {
    next(e);
  }
});

// --- Sanction (section 3.18, nouveau) -----------------------------------------
// Punition ou retenue disciplinaire — distincte des déductions automatiques
// pour absence, s'additionne à elles dans le calcul de paie (montant réservé
// aux retenues, jamais aux punitions non financières : validé par
// sanctionCreateSchema).

type SanctionAvecRelations = Prisma.SanctionGetPayload<{
  include: {
    travailleur: { select: { id: true; nom: true; poste: true } };
    enregistrePar: { select: { id: true; nom: true } };
  };
}>;

const INCLUDE_SANCTION = {
  travailleur: { select: { id: true, nom: true, poste: true } },
  enregistrePar: { select: { id: true, nom: true } },
} as const;

const versSanctionDTO = (s: SanctionAvecRelations): SanctionDTO => ({
  id: s.id,
  travailleur: s.travailleur,
  type: s.type as TypeSanction,
  motif: s.motif,
  montant: s.montant,
  date: s.date.toISOString().slice(0, 10),
  enregistrePar: s.enregistrePar,
});

travailleursRouter.get("/sanctions", requirePermission("TRAVAILLEURS", "LECTURE"), async (req, res, next) => {
  try {
    const { travailleurId, du, au } = req.query as Record<string, string | undefined>;
    const date: Prisma.DateTimeFilter = {};
    if (du) date.gte = new Date(du);
    if (au) date.lte = new Date(au);

    const sanctions = await prisma.sanction.findMany({
      where: {
        ...(travailleurId ? { travailleurId } : {}),
        ...(du || au ? { date } : {}),
      },
      include: INCLUDE_SANCTION,
      orderBy: [{ date: "desc" }, { travailleur: { nom: "asc" } }],
      take: 200,
    });
    res.json({ sanctions: sanctions.map(versSanctionDTO) });
  } catch (e) {
    next(e);
  }
});

travailleursRouter.post("/sanctions", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = sanctionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { travailleurId, type, motif, date, montant } = parsed.data;

    try {
      const sanction = await transactionTravailleurs(async (tx) => {
        if (!(await verrouillerTravailleur(tx, travailleurId))) throw new ErreurAction(404, "Travailleur introuvable");
        return tx.sanction.create({
          data: { travailleurId, type, motif, date: new Date(date), montant: montant ?? null, enregistreParId: req.utilisateur!.id },
          include: INCLUDE_SANCTION,
        });
      });
      res.status(201).json({ sanction: versSanctionDTO(sanction) });
    } catch (e) {
      const erreur = erreurMutationTravailleurs(e);
      if (erreur) return res.status(erreur.status).json({ erreur: erreur.erreur });
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

travailleursRouter.delete("/sanctions/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    try {
      const prelecture = await prisma.sanction.findUnique({ where: { id: req.params.id }, select: { travailleurId: true } });
      if (!prelecture) throw new ErreurAction(404, "Sanction introuvable");
      await transactionTravailleurs(async (tx) => {
        if (!(await verrouillerTravailleur(tx, prelecture.travailleurId))) throw new ErreurAction(404, "Travailleur introuvable");
        if (!(await verrouillerSanction(tx, req.params.id))) throw new ErreurAction(404, "Sanction introuvable");
        const sanction = await tx.sanction.findUniqueOrThrow({ where: { id: req.params.id } });
        const { count } = await tx.sanction.deleteMany({ where: { id: sanction.id } });
        if (count !== 1) throw new ErreurAction(409, "La sanction a changé — réessayez.");
        await auditerCaisseTx(tx, {
          module: "TRAVAILLEURS",
          typeEntite: "Sanction",
          entiteId: sanction.id,
          action: "SUPPRESSION",
          avant: sanction,
          apres: null,
        });
      });
      res.status(204).end();
    } catch (e) {
      const erreur = erreurMutationTravailleurs(e);
      if (erreur) return res.status(erreur.status).json({ erreur: erreur.erreur });
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

// --- Calcul de paie (section 3.18, nouveau) -----------------------------------
// AUCUN arrondi intermédiaire : tauxJournalier et retenueAbsences restent en
// précision complète (décimales) pour que la somme des lignes affichées
// corresponde exactement au détail. Seul salaireNet est arrondi (au Fc le
// plus proche), une seule fois, à la toute fin. Factorisé ici : réutilisé à
// la fois par la vue dynamique (GET .../paie) et par la génération d'un
// Bulletin de paie (instantané figé, plus bas).
async function calculerPaieBrute(
  db: Pick<TxClient, "absence" | "sanction">,
  travailleurId: string,
  salaireMensuel: number,
  joursTravaillesParMois: number,
  mois: string,
) {
  // Bornes du mois en UTC — Absence.date/Sanction.date sont des colonnes
  // DATE pures (@db.Date), sans fuseau : cohérent avec le reste de l'app.
  const debut = new Date(`${mois}-01T00:00:00.000Z`);
  const fin = new Date(debut);
  fin.setUTCMonth(fin.getUTCMonth() + 1);

  const absences = await db.absence.findMany({
    where: { travailleurId, decisionStatut: "NON_JUSTIFIEE", date: { gte: debut, lt: fin } },
    orderBy: { date: "asc" },
  });
  const sanctions = await db.sanction.findMany({
    where: { travailleurId, type: "RETENUE", date: { gte: debut, lt: fin } },
    orderBy: { date: "asc" },
  });

  const tauxJournalier = salaireMensuel / joursTravaillesParMois;
  const retenueAbsences = absences.length * tauxJournalier;
  const totalRetenuesDisciplinaires = sanctions.reduce((s, x) => s + (x.montant ?? 0), 0);
  const salaireNet = Math.round(salaireMensuel - retenueAbsences - totalRetenuesDisciplinaires);

  return { absences, sanctions, tauxJournalier, retenueAbsences, totalRetenuesDisciplinaires, salaireNet };
}

travailleursRouter.get("/:id/paie", requirePermission("TRAVAILLEURS", "LECTURE"), async (req, res, next) => {
  try {
    const parsedMois = moisISO.safeParse(req.query.mois);
    if (!parsedMois.success) {
      return res.status(400).json({ erreur: "Mois invalide (AAAA-MM attendu, ex. 2026-02)" });
    }
    const mois = parsedMois.data;

    try {
      const dto = await transactionTravailleurs(async (tx): Promise<CalculPaieDTO> => {
        if (!(await verrouillerTravailleur(tx, req.params.id))) throw new ErreurAction(404, "Travailleur introuvable");
        const travailleur = await tx.travailleur.findUniqueOrThrow({ where: { id: req.params.id } });
        if (travailleur.salaireMensuel === null || travailleur.joursTravaillesParMois === null) {
          throw new ErreurAction(
            409,
            "Le salaire mensuel et le nombre de jours travaillés doivent être renseignés sur la fiche avant de calculer la paie.",
          );
        }
        const calcul = await calculerPaieBrute(tx, travailleur.id, travailleur.salaireMensuel, travailleur.joursTravaillesParMois, mois);
        return {
          travailleurId: travailleur.id,
          travailleurNom: travailleur.nom,
          mois,
          salaireMensuel: travailleur.salaireMensuel,
          joursTravaillesParMois: travailleur.joursTravaillesParMois,
          tauxJournalier: calcul.tauxJournalier,
          absencesNonJustifiees: calcul.absences.map((a) => ({ absenceId: a.id, date: a.date.toISOString().slice(0, 10), motif: a.motif })),
          retenueAbsences: calcul.retenueAbsences,
          sanctionsRetenues: calcul.sanctions.map((s) => ({
            sanctionId: s.id,
            date: s.date.toISOString().slice(0, 10),
            motif: s.motif,
            montant: s.montant!,
          })),
          totalRetenuesDisciplinaires: calcul.totalRetenuesDisciplinaires,
          salaireNet: calcul.salaireNet,
        };
      });
      res.json({ paie: dto });
    } catch (e) {
      const erreur = erreurMutationTravailleurs(e);
      if (erreur) return res.status(erreur.status).json({ erreur: erreur.erreur });
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

// --- Bulletin de paie (section 3.18, nouveau) ---------------------------------
// Document PDF par Travailleur/mois — instantané FIGÉ du calcul de paie au
// moment de la génération (jamais recalculé depuis Absence/Sanction après
// coup). Réutilise le mécanisme d'export PDF déjà en place (logo en
// filigrane, sans crédit développeur — services/pdf.ts).

const MOIS_LABELS_FR = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];
const formatMoisLisible = (mois: string): string => {
  const [annee, m] = mois.split("-");
  return `${MOIS_LABELS_FR[Number(m) - 1]} ${annee}`;
};
const formatMontantPdf = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/**
 * Accès aux bulletins de paie (3.18) : un Admin (lecture TRAVAILLEURS) voit
 * tout ; un Travailleur avec compte lié voit UNIQUEMENT les siens — aucun
 * autre rôle, même un autre Travailleur avec compte, n'y accède. Vérification
 * manuelle (pas via requirePermission) car un compte sans aucun accès au
 * module Travailleurs doit tout de même pouvoir lire SES PROPRES bulletins.
 */
function peutConsulterBulletinsDe(req: Request, travailleur: { utilisateurId: string | null }): boolean {
  const permissions = req.utilisateur?.role.permissions ?? [];
  if (aAcces(permissions, "TRAVAILLEURS", "LECTURE")) return true;
  return !!req.utilisateur && travailleur.utilisateurId === req.utilisateur.id;
}

type BulletinAvecRelations = Prisma.BulletinPaieGetPayload<{
  include: {
    travailleur: { select: { id: true; nom: true; poste: true } };
    generePar: { select: { id: true; nom: true } };
  };
}>;

const versBulletinDTO = (b: BulletinAvecRelations): BulletinPaieDTO => ({
  id: b.id,
  travailleur: b.travailleur,
  mois: b.mois,
  salaireMensuel: b.salaireMensuel,
  joursTravaillesParMois: b.joursTravaillesParMois,
  tauxJournalier: b.tauxJournalier,
  absencesNonJustifiees: b.absencesNonJustifiees as { date: string; motif: string }[],
  retenueAbsences: b.retenueAbsences,
  sanctionsRetenues: b.sanctionsRetenues as { date: string; motif: string; montant: number }[],
  totalRetenuesDisciplinaires: b.totalRetenuesDisciplinaires,
  salaireNet: b.salaireNet,
  generePar: b.generePar,
  dateGeneration: b.dateGeneration.toISOString(),
});

const INCLUDE_BULLETIN = {
  travailleur: { select: { id: true, nom: true, poste: true } },
  generePar: { select: { id: true, nom: true } },
} as const;

// Génération : réservée à Admin secondaire/Principal, comme le reste du
// module. Chaque appel crée un NOUVEL instantané — aucune contrainte
// d'unicité sur (travailleurId, mois), régénérer ne modifie jamais un
// bulletin déjà émis.
travailleursRouter.post("/:id/bulletins-paie", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  try {
    const parsedMois = moisISO.safeParse(req.query.mois);
    if (!parsedMois.success) {
      return res.status(400).json({ erreur: "Mois invalide (AAAA-MM attendu, ex. 2026-02)" });
    }
    const mois = parsedMois.data;

    try {
      const bulletin = await transactionTravailleurs(async (tx) => {
        if (!(await verrouillerTravailleur(tx, req.params.id))) throw new ErreurAction(404, "Travailleur introuvable");
        const travailleur = await tx.travailleur.findUniqueOrThrow({ where: { id: req.params.id } });
        if (travailleur.salaireMensuel === null || travailleur.joursTravaillesParMois === null) {
          throw new ErreurAction(
            409,
            "Le salaire mensuel et le nombre de jours travaillés doivent être renseignés sur la fiche avant de générer un bulletin.",
          );
        }
        const calcul = await calculerPaieBrute(tx, travailleur.id, travailleur.salaireMensuel, travailleur.joursTravaillesParMois, mois);
        return tx.bulletinPaie.create({
          data: {
            travailleurId: travailleur.id,
            mois,
            salaireMensuel: travailleur.salaireMensuel,
            joursTravaillesParMois: travailleur.joursTravaillesParMois,
            tauxJournalier: calcul.tauxJournalier,
            absencesNonJustifiees: calcul.absences.map((a) => ({ date: a.date.toISOString().slice(0, 10), motif: a.motif })),
            retenueAbsences: calcul.retenueAbsences,
            sanctionsRetenues: calcul.sanctions.map((s) => ({ date: s.date.toISOString().slice(0, 10), motif: s.motif, montant: s.montant! })),
            totalRetenuesDisciplinaires: calcul.totalRetenuesDisciplinaires,
            salaireNet: calcul.salaireNet,
            genereParId: req.utilisateur!.id,
          },
          include: INCLUDE_BULLETIN,
        });
      });
      res.status(201).json({ bulletin: versBulletinDTO(bulletin) });
    } catch (e) {
      const erreur = erreurMutationTravailleurs(e);
      if (erreur) return res.status(erreur.status).json({ erreur: erreur.erreur });
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

// Raccourci pour le Travailleur connecté (fiche liée à son compte) : évite au
// frontend de devoir connaître son propre travailleurId. Ouvert à TOUT
// utilisateur authentifié — sans fiche liée, retourne simplement une liste
// vide (pas une erreur : rien à cacher, il n'y a rien à voir).
travailleursRouter.get("/mes-bulletins-paie", requireAuth, async (req, res, next) => {
  try {
    const travailleur = await prisma.travailleur.findUnique({ where: { utilisateurId: req.utilisateur!.id } });
    if (!travailleur) return res.json({ bulletins: [] });

    const bulletins = await prisma.bulletinPaie.findMany({
      where: { travailleurId: travailleur.id },
      include: INCLUDE_BULLETIN,
      orderBy: { dateGeneration: "desc" },
    });
    res.json({ bulletins: bulletins.map(versBulletinDTO) });
  } catch (e) {
    next(e);
  }
});

// Liste : Admin (tous) ou le Travailleur concerné lui-même (les siens).
travailleursRouter.get("/:id/bulletins-paie", requireAuth, async (req, res, next) => {
  try {
    const travailleur = await prisma.travailleur.findUnique({ where: { id: req.params.id } });
    if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });
    if (!peutConsulterBulletinsDe(req, travailleur)) {
      return res.status(403).json({ erreur: "Accès refusé : vous ne pouvez consulter que vos propres bulletins de paie" });
    }

    const bulletins = await prisma.bulletinPaie.findMany({
      where: { travailleurId: travailleur.id },
      include: INCLUDE_BULLETIN,
      orderBy: { dateGeneration: "desc" },
    });
    res.json({ bulletins: bulletins.map(versBulletinDTO) });
  } catch (e) {
    next(e);
  }
});

// Téléchargement PDF d'un bulletin précis — reconstruit le document
// UNIQUEMENT à partir des chiffres figés stockés (jamais un recalcul), pour
// que le PDF reste identique quels que soient les changements intervenus
// depuis la génération.
travailleursRouter.get("/bulletins-paie/:bulletinId/pdf", requireAuth, async (req, res, next) => {
  try {
    const bulletin = await prisma.bulletinPaie.findUnique({
      where: { id: req.params.bulletinId },
      include: {
        travailleur: { select: { id: true, nom: true, poste: true, utilisateurId: true, departement: { select: { nom: true } } } },
      },
    });
    if (!bulletin) return res.status(404).json({ erreur: "Bulletin introuvable" });
    if (!peutConsulterBulletinsDe(req, bulletin.travailleur)) {
      return res.status(403).json({ erreur: "Accès refusé : vous ne pouvez consulter que vos propres bulletins de paie" });
    }

    const absences = bulletin.absencesNonJustifiees as { date: string; motif: string }[];
    const sanctions = bulletin.sanctionsRetenues as { date: string; motif: string; montant: number }[];

    const document: DocumentExportInput = {
      titre: `Bulletin de paie — ${bulletin.travailleur.nom}`,
      sousTitre: `${formatMoisLisible(bulletin.mois)} — ${bulletin.travailleur.poste}${bulletin.travailleur.departement ? ` — ${bulletin.travailleur.departement.nom}` : ""}`,
      modules: [],
      sections: [
        {
          titre: "Rémunération",
          entetes: ["Élément", "Montant (Fc)"],
          lignes: [
            ["Salaire de base", formatMontantPdf(bulletin.salaireMensuel)],
            [`Taux journalier (${bulletin.joursTravaillesParMois} jours/mois)`, formatMontantPdf(bulletin.tauxJournalier)],
          ],
        },
        {
          titre: `Absences non justifiées retenues (${absences.length})`,
          entetes: ["Date", "Motif"],
          lignes: absences.map((a) => [a.date, a.motif]),
        },
        {
          titre: "Retenue absences",
          entetes: ["Élément", "Montant (Fc)"],
          lignes: [["Total retenue absences", formatMontantPdf(bulletin.retenueAbsences)]],
        },
        {
          titre: `Retenues disciplinaires (${sanctions.length})`,
          entetes: ["Date", "Motif", "Montant (Fc)"],
          lignes: sanctions.map((s) => [s.date, s.motif, formatMontantPdf(s.montant)]),
        },
        {
          titre: "Salaire net",
          entetes: ["Élément", "Montant (Fc)"],
          lignes: [["Salaire net à payer", formatMontantPdf(bulletin.salaireNet)]],
        },
      ],
    };

    const pdf = await construirePdf(document, req.utilisateur!.nom);
    const nom = nomFichierPdf(`bulletin-paie-${bulletin.travailleur.nom}-${bulletin.mois}`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${nom}"`);
    res.setHeader("Content-Length", String(pdf.length));
    res.end(pdf);
  } catch (e) {
    next(e);
  }
});
