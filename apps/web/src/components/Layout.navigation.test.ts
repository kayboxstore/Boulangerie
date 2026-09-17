import { describe, expect, it } from "vitest";
import type { Module } from "@lomoto/shared";
import { calculerLiens } from "./Layout";

const identite = (cle: string) => cle;

describe("Layout — calculerLiens (navigation basée sur les rôles, F2 tâche 11)", () => {
  it("un rôle avec accès complet voit tous les liens construits comme actifs", () => {
    const liens = calculerLiens(
      () => true,
      () => true,
      identite,
    );
    const construits = liens.filter((l) => l.to);
    expect(construits.every((l) => l.actif)).toBe(true);
    expect(construits.every((l) => l.motif === undefined)).toBe(true);
  });

  it("un lien nécessitant la lecture d'un module est grisé (inactif, avec motif) quand ce module est hors périmètre", () => {
    const peutLire = (m: Module) => m !== "CAISSE";
    const liens = calculerLiens(peutLire, () => false, identite);
    const caisse = liens.find((l) => l.to === "/caisse")!;
    expect(caisse.actif).toBe(false);
    expect(caisse.motif).toBe("nav.outOfScope");
  });

  it("un lien réservé à l'écriture (ex. Approbations) reste inactif même avec la lecture seule", () => {
    const liens = calculerLiens(
      () => true, // lecture accordée partout
      () => false, // écriture refusée partout
      identite,
    );
    const approbations = liens.find((l) => l.to === "/approbations")!;
    expect(approbations.actif).toBe(false);

    const approbationsAvecEcriture = calculerLiens(
      () => true,
      () => true,
      identite,
    ).find((l) => l.to === "/approbations")!;
    expect(approbationsAvecEcriture.actif).toBe(true);
  });

  it("un lien sans `module` (ex. Tableau de bord, Assistant) est toujours actif, quel que soit le rôle", () => {
    const liens = calculerLiens(
      () => false,
      () => false,
      identite,
    );
    expect(liens.find((l) => l.to === "/")!.actif).toBe(true);
    expect(liens.find((l) => l.to === "/assistant")!.actif).toBe(true);
  });

  it("aucun module n'est retiré de la liste par manque de permission — la politique de visibilité (grisé, jamais masqué) est préservée", () => {
    const avecTout = calculerLiens(
      () => true,
      () => true,
      identite,
    );
    const sansRien = calculerLiens(
      () => false,
      () => false,
      identite,
    );
    expect(sansRien).toHaveLength(avecTout.length);
    expect(sansRien.map((l) => l.labelKey)).toEqual(avecTout.map((l) => l.labelKey));
  });
});
