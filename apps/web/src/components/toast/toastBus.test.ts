import { describe, expect, it, beforeEach } from "vitest";
import {
  emettreToast,
  limiterToasts,
  sabonnerAuxToasts,
  reinitialiserCompteurToastPourTests,
  type ToastAffiche,
} from "./toastBus";

describe("limiterToasts", () => {
  it("laisse passer une liste plus courte que la limite", () => {
    expect(limiterToasts([1, 2], 3)).toEqual([1, 2]);
  });

  it("ne garde que les derniers éléments quand la liste dépasse la limite (règle UX-17 : 3 max)", () => {
    expect(limiterToasts([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });

  it("renvoie une liste vide si la limite est nulle ou négative", () => {
    expect(limiterToasts([1, 2], 0)).toEqual([]);
    expect(limiterToasts([1, 2], -1)).toEqual([]);
  });

  it("ne mute pas la liste d'origine", () => {
    const source = [1, 2, 3];
    const resultat = limiterToasts(source, 2);
    expect(source).toEqual([1, 2, 3]);
    expect(resultat).not.toBe(source);
  });
});

describe("emettreToast / sabonnerAuxToasts", () => {
  beforeEach(() => {
    reinitialiserCompteurToastPourTests();
  });

  it("notifie chaque abonné avec un id croissant", () => {
    const recus: number[] = [];
    const desabonner = sabonnerAuxToasts((toast) => recus.push(toast.id));

    const id1 = emettreToast({ variante: "information", message: "Un" });
    const id2 = emettreToast({ variante: "succes", message: "Deux" });

    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(recus).toEqual([1, 2]);

    desabonner();
  });

  it("n'appelle plus un abonné après désabonnement", () => {
    const recus: number[] = [];
    const desabonner = sabonnerAuxToasts((toast) => recus.push(toast.id));
    desabonner();

    emettreToast({ variante: "erreur", message: "Ignoré" });

    expect(recus).toEqual([]);
  });

  it("ne lève aucune erreur s'il n'y a aucun abonné", () => {
    expect(() => emettreToast({ variante: "avertissement", message: "Silence" })).not.toThrow();
  });

  it("transmet fidèlement les champs optionnels", () => {
    let recu: ToastAffiche | undefined;
    sabonnerAuxToasts((toast) => {
      recu = toast;
    });

    emettreToast({ variante: "erreur", titre: "Échec", message: "Réseau indisponible", persistant: true });

    expect(recu).toMatchObject({
      variante: "erreur",
      titre: "Échec",
      message: "Réseau indisponible",
      persistant: true,
    });
  });
});
