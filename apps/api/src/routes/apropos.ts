import { Router } from "express";
import {
  aProposEditSchema,
  CLE_BOUTIQUE_ADRESSE,
  CLE_BOUTIQUE_CONTACT,
  CLE_BOUTIQUE_HORAIRES,
  CLE_BOUTIQUE_NOM,
  CLE_BOUTIQUE_PRESENTATION,
  CLE_BOUTIQUE_RESEAUX_SOCIAUX,
  type AProposDTO,
  type ReseauSocial,
} from "@lomoto/shared";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { ecrireParametre, lireParametre } from "../lib/parametres.js";

export const aProposRouter = Router();

aProposRouter.use(requireAuth);

function lireReseauxSociaux(brut: string): ReseauSocial[] {
  if (!brut) return [];
  try {
    const valeur = JSON.parse(brut);
    return Array.isArray(valeur) ? valeur : [];
  } catch {
    // Valeur corrompue/manuelle en base : mieux vaut un tableau vide qu'un
    // crash de la page accessible à tous les rôles.
    return [];
  }
}

async function chargerAPropos(): Promise<AProposDTO> {
  return {
    boutiqueNom: await lireParametre(CLE_BOUTIQUE_NOM),
    boutiqueAdresse: await lireParametre(CLE_BOUTIQUE_ADRESSE),
    boutiqueContact: await lireParametre(CLE_BOUTIQUE_CONTACT),
    presentation: await lireParametre(CLE_BOUTIQUE_PRESENTATION),
    horaires: await lireParametre(CLE_BOUTIQUE_HORAIRES),
    reseauxSociaux: lireReseauxSociaux(await lireParametre(CLE_BOUTIQUE_RESEAUX_SOCIAUX)),
  };
}

// Lecture accessible à TOUS les rôles connectés (section 3.12) — contrairement
// à Paramètres, réservé à l'Administrateur : aucune vérification de module ici,
// seule l'authentification est exigée.
aProposRouter.get("/", async (_req, res, next) => {
  try {
    res.json({ apropos: await chargerAPropos() });
  } catch (e) {
    next(e);
  }
});

// Écriture réservée à l'Administrateur (Principal et secondaire — pas une
// tâche critique de la section 2, donc directe, sans approbation). Mêmes
// clés ParametreBoutique que /api/parametres pour nom/adresse/contact :
// modifier ici se reflète immédiatement là-bas, et inversement.
aProposRouter.put("/", requirePermission("PARAMETRES", "ECRITURE"), async (req, res, next) => {
  try {
    const parsed = aProposEditSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const p = parsed.data;
    await ecrireParametre(CLE_BOUTIQUE_NOM, p.boutiqueNom);
    await ecrireParametre(CLE_BOUTIQUE_ADRESSE, p.boutiqueAdresse);
    await ecrireParametre(CLE_BOUTIQUE_CONTACT, p.boutiqueContact);
    await ecrireParametre(CLE_BOUTIQUE_PRESENTATION, p.presentation);
    await ecrireParametre(CLE_BOUTIQUE_HORAIRES, p.horaires);
    await ecrireParametre(CLE_BOUTIQUE_RESEAUX_SOCIAUX, JSON.stringify(p.reseauxSociaux));

    res.json({ apropos: await chargerAPropos() });
  } catch (e) {
    next(e);
  }
});
