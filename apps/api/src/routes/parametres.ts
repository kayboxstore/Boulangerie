import { Router } from "express";
import {
  CLE_BOUTIQUE_ADRESSE,
  CLE_BOUTIQUE_CONTACT,
  CLE_BOUTIQUE_NOM,
  CLE_LANGUE_DEFAUT,
  LANGUE_DEFAUT_PAR_DEFAUT,
  LANGUES,
  parametresBoutiqueSchema,
  type Langue,
  type ParametresBoutiqueDTO,
} from "@lomoto/shared";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { ecrireParametre, lireParametre } from "../lib/parametres.js";

export const parametresRouter = Router();

parametresRouter.use(requireAuth);

// Écriture ET lecture réservées à l'Administrateur (section 3.9). Le DG n'a
// AUCUN accès à ce module — contrairement au catalogue Produits et à Équipe,
// où sa lecture est confirmée ; l'exception ne s'étend pas au reste de
// Paramètres.
const lectureParametres = requirePermission("PARAMETRES", "LECTURE");
const ecritureParametres = requirePermission("PARAMETRES", "ECRITURE");

async function chargerParametres(): Promise<ParametresBoutiqueDTO> {
  const langue = await lireParametre(CLE_LANGUE_DEFAUT, LANGUE_DEFAUT_PAR_DEFAUT);
  return {
    boutiqueNom: await lireParametre(CLE_BOUTIQUE_NOM),
    boutiqueAdresse: await lireParametre(CLE_BOUTIQUE_ADRESSE),
    boutiqueContact: await lireParametre(CLE_BOUTIQUE_CONTACT),
    langueDefaut: (LANGUES as readonly string[]).includes(langue)
      ? (langue as Langue)
      : LANGUE_DEFAUT_PAR_DEFAUT,
  };
}

parametresRouter.get("/", lectureParametres, async (_req, res, next) => {
  try {
    res.json({ parametres: await chargerParametres() });
  } catch (e) {
    next(e);
  }
});

parametresRouter.put("/", ecritureParametres, async (req, res, next) => {
  try {
    const parsed = parametresBoutiqueSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const p = parsed.data;
    await ecrireParametre(CLE_BOUTIQUE_NOM, p.boutiqueNom);
    await ecrireParametre(CLE_BOUTIQUE_ADRESSE, p.boutiqueAdresse);
    await ecrireParametre(CLE_BOUTIQUE_CONTACT, p.boutiqueContact);
    await ecrireParametre(CLE_LANGUE_DEFAUT, p.langueDefaut);

    res.json({ parametres: await chargerParametres() });
  } catch (e) {
    next(e);
  }
});
