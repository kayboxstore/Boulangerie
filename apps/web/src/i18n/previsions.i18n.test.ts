import { describe, expect, it } from "vitest";
import fr from "./fr.json";
import en from "./en.json";
import ln from "./ln.json";
import sw from "./sw.json";
import {
  STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON,
  STATUTS_FINAUX_CYCLE_LIVRAISON,
} from "../components/previsions/cycleLivraisonLogique";

/**
 * Vérifie directement le contenu réel des quatre dictionnaires i18n pour la
 * légende du cycle prévision → livraison (F4 round 5, suite à la revue
 * indépendante). Importe fr/en/ln/sw.json — pas de fixtures ni de mocks — de
 * sorte qu'une régression de traduction (formulation erronée réintroduite,
 * statut manquant) fasse échouer ce test, langue par langue.
 */

const DICTIONNAIRES = { fr, en, ln, sw } as const;
type Langue = keyof typeof DICTIONNAIRES;
const LANGUES: Langue[] = ["fr", "en", "ln", "sw"];

// Anciennes formulations erronées corrigées lors des revues précédentes —
// ne doivent plus jamais réapparaître dans aucune langue.
const FORMULATIONS_INTERDITES: Record<string, RegExp[]> = {
  fr: [/indépendant/i, /confirmée par les deux/i, /réellement produite/i, /de cette ligne/i],
  en: [/independent/i, /confirmed by both/i, /actually produced/i, /this line/i],
  // Lingala/Swahili : mêmes idées interdites, formulées dans leurs propres
  // termes historiques (voir rounds précédents).
  ln: [/moko na moko ekesani na mosusu/i, /endimami na bango mibale/i, /esalemi mpenza na Bosali/i, /molongo oyo/i],
  sw: [/huru dhidi ya mengine/i, /pande zote mbili/i, /kilichozalishwa na Uzalishaji/i, /mstari huu/i],
};

// Référence interne (numéro de PR GitHub, nom de branche) qui n'a aucun sens
// pour un utilisateur final et devient fausse dès la fusion de la PR — ne
// doit jamais apparaître dans un texte visible ou lu par un lecteur d'écran
// (round 5, revue indépendante). Commun aux quatre langues.
const REFERENCE_INTERNE_INTERDITE = /PR ?#\d+|codex\/previsions-commandes/i;

function texteComplet(previsions: Record<string, unknown>): string {
  return JSON.stringify(previsions);
}

describe("i18n prévisions — couverture réelle des quatre dictionnaires (F4 round 5)", () => {
  for (const langue of LANGUES) {
    describe(`langue: ${langue}`, () => {
      const previsions = DICTIONNAIRES[langue].previsions as Record<string, any>;

      it("expose les onze statuts C4 exacts (sept chronologiques + quatre finaux)", () => {
        const clesChronologie = Object.keys(previsions.chronologie);
        const clesFinaux = Object.keys(previsions.statutsFinaux);
        expect(clesChronologie).toEqual([...STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON]);
        expect(clesFinaux).toEqual([...STATUTS_FINAUX_CYCLE_LIVRAISON]);
        expect(clesChronologie).toHaveLength(7);
        expect(clesFinaux).toHaveLength(4);
      });

      it("chaque statut (chronologique ou final) a un label et une description non vides", () => {
        for (const statut of [...STATUTS_CHRONOLOGIE_CYCLE_LIVRAISON]) {
          expect(previsions.chronologie[statut].label).toBeTruthy();
          expect(previsions.chronologie[statut].description).toBeTruthy();
        }
        for (const statut of [...STATUTS_FINAUX_CYCLE_LIVRAISON]) {
          expect(previsions.statutsFinaux[statut].label).toBeTruthy();
          expect(previsions.statutsFinaux[statut].description).toBeTruthy();
        }
      });

      it("n'emploie aucune des formulations erronées corrigées lors des revues précédentes", () => {
        const texte = texteComplet(previsions);
        for (const motif of FORMULATIONS_INTERDITES[langue]) {
          expect(texte).not.toMatch(motif);
        }
      });

      it("n'expose aucune référence interne (numéro de PR, nom de branche) dans un texte utilisateur", () => {
        // apps/web/src/i18n/{fr,en,ln,sw}.json — round 5, revue indépendante :
        // « (PR #12) » figurait dans previsions.facturable.description et
        // bonsLivraison.cyclePendingNote, visible en tooltip et lu au clavier
        // (aria-describedby) — jargon dev, faux dès la fusion de la PR.
        const texteBonsLivraison = JSON.stringify(DICTIONNAIRES[langue].bonsLivraison);
        expect(texteComplet(previsions)).not.toMatch(REFERENCE_INTERNE_INTERDITE);
        expect(texteBonsLivraison).not.toMatch(REFERENCE_INTERNE_INTERDITE);
      });

      it("PARTIELLEMENT_ACCEPTEE n'est jamais présentée comme un statut de ligne produit", () => {
        const description: string = previsions.statutsFinaux.PARTIELLEMENT_ACCEPTEE.description;
        // Le statut appartient au cycle complet (CycleLivraisonDTO.statut),
        // déterminé par les totaux acceptés/déposés — jamais par une ligne.
        expect(description).not.toMatch(/ligne|line|molongo|mstari/i);
        expect(description).not.toMatch(/résume|summar|ezongisaka|inafupisha/i);
      });
    });
  }

  it("les quatre langues décrivent PARTIELLEMENT_ACCEPTEE avec la même règle exacte C4 (accepté > 0 et < déposé)", () => {
    // Chaque langue doit encoder : (a) un seuil bas non nul, (b) un plafond
    // strictement inférieur au déposé, (c) le maintien de l'affichage séparé
    // des trois quantités — sans jamais dire que le statut les « résume ».
    const fr_ = fr.previsions.statutsFinaux.PARTIELLEMENT_ACCEPTEE.description;
    expect(fr_).toContain("supérieur à zéro");
    expect(fr_).toContain("inférieur au total déposé");
    expect(fr_).toMatch(/restent affichées séparément/);

    const en_ = en.previsions.statutsFinaux.PARTIELLEMENT_ACCEPTEE.description;
    expect(en_).toMatch(/greater than zero/i);
    expect(en_).toMatch(/lower than the total dropped-off quantity/i);
    expect(en_).toMatch(/displayed separately/i);
  });
});
