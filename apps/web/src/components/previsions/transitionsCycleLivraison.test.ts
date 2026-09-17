import { describe, expect, it } from "vitest";
import { STATUTS_CYCLE_LIVRAISON } from "@lomoto/shared/cycles-livraison";
import {
  actionProductionSuivante,
  actionRequiertChauffeur,
  actionRequiertLignes,
  champPrereplissagePourAction,
  cleBoutonAction,
  cleDescriptionAction,
  cleLibelleAction,
} from "./transitionsCycleLivraison";

describe("actionProductionSuivante — action Production disponible par statut (F5A)", () => {
  it("propose exactement les six transitions Production, dans l'ordre du contrat C4 §7", () => {
    expect(actionProductionSuivante("PREVISION")).toBe("RETENIR_PRODUCTION");
    expect(actionProductionSuivante("RETENUE_PRODUCTION")).toBe("CONFIRMER_PREPARATION");
    expect(actionProductionSuivante("PREPAREE")).toBe("CONFIRMER_REMISE_MAGASIN");
    expect(actionProductionSuivante("REMISE_MAGASIN")).toBe("CONFIRMER_CHARGEMENT");
    expect(actionProductionSuivante("CHARGEE")).toBe("CONFIRMER_DEPART");
    expect(actionProductionSuivante("EN_TOURNEE")).toBe("SIGNALER_DEPOT");
  });

  it("ne propose jamais CONFIRMER_ACCEPTATION — action F5B réservée au module Commandes", () => {
    for (const statut of STATUTS_CYCLE_LIVRAISON) {
      expect(actionProductionSuivante(statut)).not.toBe("CONFIRMER_ACCEPTATION");
    }
  });

  it("n'a aucune action Production sur EN_ATTENTE_CONFIRMATION — attend CONFIRMER_ACCEPTATION (F5B), pas une action Production", () => {
    expect(actionProductionSuivante("EN_ATTENTE_CONFIRMATION")).toBeNull();
  });

  it("n'a aucune action sur les quatre statuts finaux — terminaux", () => {
    expect(actionProductionSuivante("PARTIELLEMENT_ACCEPTEE")).toBeNull();
    expect(actionProductionSuivante("ACCEPTEE")).toBeNull();
    expect(actionProductionSuivante("RETOUR_TOTAL")).toBeNull();
    expect(actionProductionSuivante("ANNULEE")).toBeNull();
  });
});

describe("actionRequiertLignes — CONFIRMER_DEPART est la seule action sans quantité (contrat C4 §7)", () => {
  it("toutes les actions requièrent des lignes sauf CONFIRMER_DEPART", () => {
    expect(actionRequiertLignes("RETENIR_PRODUCTION")).toBe(true);
    expect(actionRequiertLignes("CONFIRMER_PREPARATION")).toBe(true);
    expect(actionRequiertLignes("CONFIRMER_REMISE_MAGASIN")).toBe(true);
    expect(actionRequiertLignes("CONFIRMER_CHARGEMENT")).toBe(true);
    expect(actionRequiertLignes("SIGNALER_DEPOT")).toBe(true);
    expect(actionRequiertLignes("CONFIRMER_DEPART")).toBe(false);
  });
});

describe("actionRequiertChauffeur — seul le chargement identifie le chauffeur (contrat C4 §7, livrePar)", () => {
  it("uniquement CONFIRMER_CHARGEMENT requiert le champ chauffeur", () => {
    expect(actionRequiertChauffeur("CONFIRMER_CHARGEMENT")).toBe(true);
    expect(actionRequiertChauffeur("RETENIR_PRODUCTION")).toBe(false);
    expect(actionRequiertChauffeur("CONFIRMER_PREPARATION")).toBe(false);
    expect(actionRequiertChauffeur("CONFIRMER_REMISE_MAGASIN")).toBe(false);
    expect(actionRequiertChauffeur("CONFIRMER_DEPART")).toBe(false);
    expect(actionRequiertChauffeur("SIGNALER_DEPOT")).toBe(false);
  });
});

describe("champPrereplissagePourAction — préremplissage depuis l'étape précédente, jamais depuis la prévision au-delà de la première étape", () => {
  it("chaque action se préremplit depuis le champ de l'étape immédiatement précédente", () => {
    expect(champPrereplissagePourAction("RETENIR_PRODUCTION")).toBe("quantitePrevue");
    expect(champPrereplissagePourAction("CONFIRMER_PREPARATION")).toBe("quantiteRetenueProduction");
    expect(champPrereplissagePourAction("CONFIRMER_REMISE_MAGASIN")).toBe("quantitePreparee");
    expect(champPrereplissagePourAction("CONFIRMER_CHARGEMENT")).toBe("quantiteRemiseMagasin");
    expect(champPrereplissagePourAction("SIGNALER_DEPOT")).toBe("quantiteChargee");
  });

  it("CONFIRMER_DEPART n'a pas de champ de préremplissage — il ne porte aucune quantité", () => {
    expect(champPrereplissagePourAction("CONFIRMER_DEPART")).toBeNull();
  });
});

describe("clés i18n des actions — une clé stable par action, jamais de jargon interne", () => {
  it("génère des clés previsions.actions.<ACTION>.* cohérentes", () => {
    expect(cleLibelleAction("RETENIR_PRODUCTION")).toBe("previsions.actions.RETENIR_PRODUCTION.label");
    expect(cleDescriptionAction("SIGNALER_DEPOT")).toBe("previsions.actions.SIGNALER_DEPOT.description");
    expect(cleBoutonAction("CONFIRMER_CHARGEMENT")).toBe("previsions.actions.CONFIRMER_CHARGEMENT.bouton");
  });
});
