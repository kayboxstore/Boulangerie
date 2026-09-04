import { Router } from "express";
import {
  demandePubliqueIdentifierSchema,
  demandePubliqueCreateSchema,
  demandePubliqueRejeterSchema,
  formatFc,
  type DemandeCommandePubliqueDTO,
} from "@lomoto/shared";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { busEvenements } from "../lib/events.js";
import { executerAvecReessaiP2034 } from "../services/caisseAtomique.js";
import { executerCreationOuMiseAJourCommande, ErreurClientInconnu } from "./commandes.js";
import { ajouterEnteteRejeu, executerEcritureIdempotente } from "../lib/idempotence.js";

// Dérivé directement de la fonction plutôt que redéclaré à la main : évite
// toute divergence si son type de retour évolue un jour dans commandes.ts.
type ResultatConfirmation = Awaited<ReturnType<typeof executerCreationOuMiseAJourCommande>>;

interface CorpsConfirmationDemande {
  erreur?: string;
  conflit?: boolean;
  commandeId?: string;
}

export const demandesCommandePubliquesPubliqueRouter = Router();
export const demandesCommandePubliquesRouter = Router();
// Contrairement au routeur public ci-dessus (aucune authentification), tout
// ce routeur exige un compte connecté — même convention que
// commandesRouter.use(requireAuth) dans commandes.ts. requirePermission seul
// ne suffit pas : il ne fait QUE lire req.utilisateur, jamais le définir.
demandesCommandePubliquesRouter.use(requireAuth);

const INCLUDE_CLIENT = { client: { include: { typeClient: true } } } as const;

function versDTO(d: {
  id: string;
  client: { id: string; nom: string; typeClient: { nom: string } };
  quantiteBacs: number;
  dateSouhaitee: Date | null;
  note: string | null;
  statut: "EN_ATTENTE" | "CONFIRMEE" | "REJETEE";
  commandeCreeeId: string | null;
  motifRejet: string | null;
  createdAt: Date;
}): DemandeCommandePubliqueDTO {
  return {
    id: d.id,
    client: { id: d.client.id, nom: d.client.nom, typeClient: d.client.typeClient.nom },
    quantiteBacs: d.quantiteBacs,
    dateSouhaitee: d.dateSouhaitee ? d.dateSouhaitee.toISOString() : null,
    note: d.note,
    statut: d.statut,
    commandeCreeeId: d.commandeCreeeId,
    motifRejet: d.motifRejet,
    createdAt: d.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Routes PUBLIQUES (site vitrine, aucune authentification) — enregistrées
// sans requirePermission ni requireAuth. Le rate limiting est appliqué dans
// app.ts, au même titre que les autres routes publiques sensibles
// (/api/auth/*) — jamais ici, pour garder une seule source de vérité sur les
// limites (voir app.ts).
// ---------------------------------------------------------------------------

/**
 * Identification par téléphone. Ne révèle QUE si un Dépositaire/Maman
 * correspondant existe, avec son nom et sa Qualité — jamais son solde, son
 * historique, ni aucune autre donnée. Réponse volontairement minimale mais
 * PAS du type "ne révèle jamais si le compte existe" (contrairement au mot
 * de passe oublié) : le mécanisme même du formulaire exige de confirmer
 * l'identité pour que le visiteur puisse continuer — mais rien de plus que
 * cette confirmation n'est exposé.
 */
demandesCommandePubliquesPubliqueRouter.post("/identifier", async (req, res, next) => {
  try {
    const parsed = demandePubliqueIdentifierSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const client = await prisma.client.findFirst({
      where: { telephone: parsed.data.telephone, typeClient: { nom: { in: ["Dépositaire", "Maman"] } } },
      include: { typeClient: true },
    });
    if (!client) {
      return res.status(404).json({ trouve: false, erreur: "Aucun compte Dépositaire/Maman ne correspond à ce numéro." });
    }
    return res.json({ trouve: true, clientId: client.id, nom: client.nom, typeClient: client.typeClient.nom });
  } catch (e) {
    next(e);
  }
});

/**
 * Crée la demande. Revérifie le téléphone côté serveur (jamais confiance
 * dans un clientId envoyé par le formulaire public sans le prouver à nouveau
 * par le même téléphone) — sinon rien n'empêcherait un visiteur de deviner
 * un clientId et de soumettre une demande au nom d'un autre Dépositaire.
 */
demandesCommandePubliquesPubliqueRouter.post("/", async (req, res, next) => {
  try {
    const parsed = demandePubliqueCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { telephone, quantiteBacs, dateSouhaitee, note } = parsed.data;
    const client = await prisma.client.findFirst({
      where: { telephone, typeClient: { nom: { in: ["Dépositaire", "Maman"] } } },
      include: { typeClient: true },
    });
    if (!client) {
      return res.status(404).json({ erreur: "Aucun compte Dépositaire/Maman ne correspond à ce numéro." });
    }

    const demande = await prisma.demandeCommandePublique.create({
      data: {
        clientId: client.id,
        quantiteBacs,
        dateSouhaitee: dateSouhaitee ? new Date(dateSouhaitee) : null,
        note,
      },
      include: INCLUDE_CLIENT,
    });

    busEvenements.emettreEvenement({
      type: "DEMANDE_COMMANDE_PUBLIQUE",
      module: "COMMANDES",
      emetteurId: null,
      evenementRef: demande.id,
      message: `Nouvelle demande de commande (site vitrine) — ${client.nom} (${client.typeClient.nom}) : ${quantiteBacs} bac(s) souhaité(s).`,
      donnees: { demandeId: demande.id },
    });

    return res.status(201).json({ demande: versDTO(demande) });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Routes INTERNES (authentifiées, permission COMMANDES) — file d'attente et
// traitement par le Chargé des commandes.
// ---------------------------------------------------------------------------

demandesCommandePubliquesRouter.get("/", requirePermission("COMMANDES", "LECTURE"), async (req, res, next) => {
  try {
    const statut = typeof req.query.statut === "string" ? req.query.statut : undefined;
    const demandes = await prisma.demandeCommandePublique.findMany({
      where: statut ? { statut: statut as "EN_ATTENTE" | "CONFIRMEE" | "REJETEE" } : undefined,
      include: INCLUDE_CLIENT,
      orderBy: { createdAt: "desc" },
    });
    return res.json({ demandes: demandes.map(versDTO) });
  } catch (e) {
    next(e);
  }
});

/**
 * Confirme une demande : délègue à executerCreationOuMiseAJourCommande, le
 * MÊME cœur transactionnel que la création normale (POST /api/commandes) —
 * pas une réimplémentation. Un doublon (le client a déjà une commande
 * aujourd'hui) renvoie le même conflit 409 que le flux manuel, avec le même
 * choix Modifier/Remplacer à faire depuis l'écran de traitement de la
 * demande.
 */
demandesCommandePubliquesRouter.post(
  "/:id/confirmer",
  requirePermission("COMMANDES", "ECRITURE"),
  async (req, res, next) => {
    try {
      const demande = await prisma.demandeCommandePublique.findUnique({
        where: { id: req.params.id },
        include: INCLUDE_CLIENT,
      });
      if (!demande) return res.status(404).json({ erreur: "Demande introuvable" });
      if (demande.statut !== "EN_ATTENTE") {
        return res.status(409).json({ erreur: `Cette demande est déjà ${demande.statut === "CONFIRMEE" ? "confirmée" : "rejetée"}.` });
      }

      const strategie = req.body?.strategie as "MODIFIER" | "REMPLACER" | undefined;

      const execution = await executerAvecReessaiP2034(() =>
        executerEcritureIdempotente<ResultatConfirmation, CorpsConfirmationDemande>(
          req,
          `POST:/api/demandes-commande-publiques/${demande.id}/confirmer`,
          { demandeId: demande.id, strategie },
          (tx) =>
            executerCreationOuMiseAJourCommande(
              tx,
              { clientId: demande.clientId, quantiteBacs: demande.quantiteBacs, montantRecu: 0, strategie },
              req.utilisateur!.id,
            ),
          (resultat) => {
            if (resultat.type === "conflit") {
              return {
                statutHttp: 409,
                corps: {
                  erreur: `${demande.client.nom} a déjà une commande aujourd'hui. Choisissez Modifier ou Remplacer.`,
                  conflit: true,
                },
              };
            }
            if (resultat.type === "reglementsPresents" || resultat.type === "cycleImmuable") {
              return { statutHttp: 409, corps: { erreur: "Cette commande ne peut pas être modifiée automatiquement." } };
            }
            return { statutHttp: 200, corps: { commandeId: resultat.commande.id } };
          },
        ),
      );

      ajouterEnteteRejeu(res, execution.rejoue);
      if (!execution.rejoue && execution.corps.commandeId) {
        await prisma.demandeCommandePublique.updateMany({
          where: { id: demande.id },
          data: { statut: "CONFIRMEE", commandeCreeeId: execution.corps.commandeId, traiteParId: req.utilisateur!.id, traiteLe: new Date() },
        });
      }
      return res.status(execution.corps.conflit ? 409 : 200).json(execution.corps);
    } catch (e) {
      if (e instanceof ErreurClientInconnu) {
        return res.status(404).json({ erreur: "Client introuvable" });
      }
      next(e);
    }
  },
);

demandesCommandePubliquesRouter.post(
  "/:id/rejeter",
  requirePermission("COMMANDES", "ECRITURE"),
  async (req, res, next) => {
    try {
      const parsed = demandePubliqueRejeterSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
      }
      const demande = await prisma.demandeCommandePublique.findUnique({ where: { id: req.params.id } });
      if (!demande) return res.status(404).json({ erreur: "Demande introuvable" });
      if (demande.statut !== "EN_ATTENTE") {
        return res.status(409).json({ erreur: `Cette demande est déjà ${demande.statut === "CONFIRMEE" ? "confirmée" : "rejetée"}.` });
      }
      const maj = await prisma.demandeCommandePublique.update({
        where: { id: demande.id },
        data: { statut: "REJETEE", motifRejet: parsed.data.motif, traiteParId: req.utilisateur!.id, traiteLe: new Date() },
        include: INCLUDE_CLIENT,
      });
      return res.json({ demande: versDTO(maj) });
    } catch (e) {
      next(e);
    }
  },
);
