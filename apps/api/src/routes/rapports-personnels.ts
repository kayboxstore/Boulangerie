import { Router } from "express";
import { Prisma } from "@prisma/client";
import {
  formatFc,
  formatQuantite,
  STATUT_PRESENCE_LABELS,
  TYPE_MOUVEMENT_LABELS,
  TYPES_ACTIVITE,
  type ActiviteDTO,
  type PorteeRapportsDTO,
  type StatutPresence,
  type TypeActivite,
  type TypeMouvementStock,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const rapportsPersonnelsRouter = Router();

rapportsPersonnelsRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Portée (note d'implémentation 3.13) : mécanisme DÉDIÉ, distinct de la
// matrice RolePermission — filtre par créePar/enregistrePar + exceptions
// nommées par rôle.
// ---------------------------------------------------------------------------

/** Rôles à portée globale : voient les rapports de tout le monde. */
const ROLES_PORTEE_GLOBALE = ["Directeur Général", "Administrateur"];

/** Exceptions nommées : rôle → rôles supplémentaires visibles (en plus de soi). */
const EXCEPTIONS_PORTEE: Record<string, string[]> = {
  "Caissier(ère)": ["Chargé des commandes"],
};

interface Portee {
  tous: boolean;
  /** IDs visibles quand `tous` est faux. */
  utilisateurIds: string[];
}

async function resoudrePortee(utilisateurId: string, roleNom: string): Promise<Portee> {
  if (ROLES_PORTEE_GLOBALE.includes(roleNom)) return { tous: true, utilisateurIds: [] };

  const ids = [utilisateurId];
  const rolesSupplementaires = EXCEPTIONS_PORTEE[roleNom] ?? [];
  if (rolesSupplementaires.length > 0) {
    const autres = await prisma.utilisateur.findMany({
      where: { role: { nom: { in: rolesSupplementaires } } },
      select: { id: true },
    });
    ids.push(...autres.map((u) => u.id));
  }
  return { tous: false, utilisateurIds: ids };
}

// Portée visible (pour le filtre « Qui » côté UI).
rapportsPersonnelsRouter.get("/portee", async (req, res, next) => {
  try {
    const portee = await resoudrePortee(req.utilisateur!.id, req.utilisateur!.role.nom);
    const utilisateurs = await prisma.utilisateur.findMany({
      where: portee.tous ? {} : { id: { in: portee.utilisateurIds } },
      select: { id: true, nom: true, role: { select: { nom: true } } },
      orderBy: { nom: "asc" },
    });
    const dto: PorteeRapportsDTO = {
      tous: portee.tous,
      utilisateurs: utilisateurs.map((u) => ({ id: u.id, nom: u.nom, roleNom: u.role.nom })),
    };
    res.json(dto);
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Journal d'activité — agrège les enregistrements créés par les utilisateurs
// visibles à travers les tables portant un auteur (créePar/enregistrePar…).
// ---------------------------------------------------------------------------

const LIMITE_PAR_SOURCE = 150;
const LIMITE_TOTALE = 200;

rapportsPersonnelsRouter.get("/", async (req, res, next) => {
  try {
    const { utilisateurId, du, au, type } = req.query as Record<string, string | undefined>;

    const portee = await resoudrePortee(req.utilisateur!.id, req.utilisateur!.role.nom);
    if (utilisateurId && !portee.tous && !portee.utilisateurIds.includes(utilisateurId)) {
      return res.status(403).json({ erreur: "Ces rapports sont hors de votre portée" });
    }

    // Cible : un utilisateur précis (dans la portée) ou toute la portée.
    const cibleIds = utilisateurId ? [utilisateurId] : portee.tous ? null : portee.utilisateurIds;
    // Portée globale : pas de filtre d'auteur (les lignes sans auteur — comptes
    // supprimés — sont écartées au moment de la construction du DTO).
    const filtreAuteur = (champ: string) => (cibleIds ? { [champ]: { in: cibleIds } } : {});

    const periode: Prisma.DateTimeFilter = {};
    if (du) periode.gte = new Date(`${du}T00:00:00`);
    if (au) periode.lte = new Date(`${au}T23:59:59.999`);
    const filtreDate = (champ: string) => (du || au ? { [champ]: periode } : {});

    const typesVoulus: TypeActivite[] =
      type && (TYPES_ACTIVITE as readonly string[]).includes(type)
        ? [type as TypeActivite]
        : [...TYPES_ACTIVITE];
    const voulu = (t: TypeActivite) => typesVoulus.includes(t);

    const activites: (ActiviteDTO & { _tri: number })[] = [];
    const pousser = (
      type: TypeActivite,
      id: string,
      date: Date,
      resume: string,
      utilisateur: { id: string; nom: string; role: { nom: string } } | null,
    ) => {
      if (!utilisateur) return;
      activites.push({
        id: `${type}:${id}`,
        type,
        date: date.toISOString(),
        resume,
        utilisateur: { id: utilisateur.id, nom: utilisateur.nom, roleNom: utilisateur.role.nom },
        _tri: date.getTime(),
      });
    };

    const AUTEUR = { select: { id: true, nom: true, role: { select: { nom: true } } } } as const;

    if (voulu("COMMANDE_CLIENT")) {
      const commandes = await prisma.commandeClient.findMany({
        where: { ...filtreAuteur("creeParId"), ...filtreDate("dateCreation") },
        include: { creePar: AUTEUR, client: { select: { nom: true } } },
        orderBy: { dateCreation: "desc" },
        take: LIMITE_PAR_SOURCE,
      });
      for (const c of commandes) {
        pousser(
          "COMMANDE_CLIENT",
          c.id,
          c.dateCreation,
          `Commande n°${c.numero} — ${c.client.nom}, ${c.quantiteBacs} bac(s), reçu ${formatFc(c.montantRecu)}${c.dette > 0 ? ` (dette ${formatFc(c.dette)})` : ""}`,
          c.creePar,
        );
      }
    }

    if (voulu("REGLEMENT")) {
      const reglements = await prisma.paiementCommande.findMany({
        where: { ...filtreAuteur("enregistreParId"), ...filtreDate("date") },
        include: {
          enregistrePar: AUTEUR,
          commandeClient: { select: { numero: true, client: { select: { nom: true } } } },
        },
        orderBy: { date: "desc" },
        take: LIMITE_PAR_SOURCE,
      });
      for (const r of reglements) {
        pousser(
          "REGLEMENT",
          r.id,
          r.date,
          `Règlement de ${formatFc(r.montant)} sur la commande n°${r.commandeClient.numero} (${r.commandeClient.client.nom})`,
          r.enregistrePar,
        );
      }
    }

    // Les ventes et clôtures de caisse ont disparu avec la refonte 3.1 ; le
    // journal personnel du Caissier trace désormais ses dépenses de registre.
    if (voulu("DEPENSE_CAISSE")) {
      const depenses = await prisma.depenseCaisse.findMany({
        where: { ...filtreAuteur("enregistreParId"), ...filtreDate("date") },
        include: { enregistrePar: AUTEUR },
        orderBy: { date: "desc" },
        take: LIMITE_PAR_SOURCE,
      });
      for (const d of depenses) {
        pousser(
          "DEPENSE_CAISSE",
          d.id,
          d.date,
          `Dépense de caisse — ${d.motif} : ${formatFc(d.montant)}`,
          d.enregistrePar,
        );
      }
    }

    if (voulu("PRODUCTION")) {
      const productions = await prisma.production.findMany({
        where: { ...filtreAuteur("enregistreParId"), ...filtreDate("date") },
        include: { enregistrePar: AUTEUR },
        orderBy: { date: "desc" },
        take: LIMITE_PAR_SOURCE,
      });
      for (const p of productions) {
        pousser(
          "PRODUCTION",
          p.id,
          p.date,
          `Production n°${p.numero} — ${p.bacsProduits} bac(s) produits`,
          p.enregistrePar,
        );
      }
    }

    if (voulu("MOUVEMENT_STOCK")) {
      const mouvements = await prisma.mouvementStock.findMany({
        where: { ...filtreAuteur("auteurId"), ...filtreDate("date") },
        include: { auteur: AUTEUR, matierePremiere: { select: { nom: true, unite: true } } },
        orderBy: { date: "desc" },
        take: LIMITE_PAR_SOURCE,
      });
      for (const m of mouvements) {
        pousser(
          "MOUVEMENT_STOCK",
          m.id,
          m.date,
          `${TYPE_MOUVEMENT_LABELS[m.type as TypeMouvementStock]} de stock : ${m.type === "ENTREE" ? "+" : "−"}${formatQuantite(m.quantite.toNumber(), m.matierePremiere.unite)} ${m.matierePremiere.nom}${m.reference ? ` — ${m.reference}` : ""}`,
          m.auteur,
        );
      }
    }

    if (voulu("COMMANDE_FOURNISSEUR") || voulu("RECEPTION_FOURNISSEUR")) {
      const commandes = await prisma.commandeFournisseur.findMany({
        where: {
          OR: [
            ...(voulu("COMMANDE_FOURNISSEUR") ? [{ ...filtreAuteur("creeParId"), ...filtreDate("date") }] : []),
            ...(voulu("RECEPTION_FOURNISSEUR")
              ? [{ ...filtreAuteur("recueParId"), statut: "RECUE" as const, ...(du || au ? { dateReception: periode } : {}) }]
              : []),
          ],
        },
        include: { creePar: AUTEUR, recuePar: AUTEUR, fournisseur: { select: { nom: true } }, lignes: true },
        orderBy: { numero: "desc" },
        take: LIMITE_PAR_SOURCE,
      });
      for (const c of commandes) {
        const total = c.lignes.reduce((s, l) => s + Math.round(l.quantite.toNumber() * l.prixUnitaire), 0);
        const dansPeriode = (d: Date) => (!periode.gte || d >= (periode.gte as Date)) && (!periode.lte || d <= (periode.lte as Date));
        const dansCible = (id: string | null) => !!id && (!cibleIds || cibleIds.includes(id));
        if (voulu("COMMANDE_FOURNISSEUR") && dansCible(c.creeParId) && dansPeriode(c.date)) {
          pousser(
            "COMMANDE_FOURNISSEUR",
            c.id,
            c.date,
            `Commande fournisseur n°${c.numero} — ${c.fournisseur.nom}, total ${formatFc(total)}`,
            c.creePar,
          );
        }
        if (voulu("RECEPTION_FOURNISSEUR") && c.dateReception && dansCible(c.recueParId) && dansPeriode(c.dateReception)) {
          pousser(
            "RECEPTION_FOURNISSEUR",
            c.id,
            c.dateReception,
            `Réception de la commande fournisseur n°${c.numero} (${c.fournisseur.nom}) — stock mis à jour`,
            c.recuePar,
          );
        }
      }
    }

    if (voulu("POINTAGE")) {
      const presences = await prisma.presence.findMany({
        where: { ...filtreAuteur("enregistreParId"), ...filtreDate("updatedAt") },
        include: { enregistrePar: AUTEUR, travailleur: { select: { nom: true } } },
        orderBy: { updatedAt: "desc" },
        take: LIMITE_PAR_SOURCE,
      });
      for (const p of presences) {
        pousser(
          "POINTAGE",
          p.id,
          p.updatedAt,
          `Pointage de ${p.travailleur.nom} le ${p.date.toISOString().slice(0, 10)} — ${STATUT_PRESENCE_LABELS[p.statut as StatutPresence]}${p.heureArrivee ? ` (arrivée ${p.heureArrivee})` : ""}`,
          p.enregistrePar,
        );
      }
    }

    activites.sort((a, b) => b._tri - a._tri);
    res.json({ activites: activites.slice(0, LIMITE_TOTALE).map(({ _tri, ...a }) => a) });
  } catch (e) {
    next(e);
  }
});
