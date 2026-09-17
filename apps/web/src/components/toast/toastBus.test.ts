import { describe, expect, it, beforeEach } from "vitest";
import {
  emettreToast,
  selectionnerToastsVisibles,
  sabonnerAuxToasts,
  reinitialiserCompteurToastPourTests,
  type ToastAffiche,
} from "./toastBus";

describe("selectionnerToastsVisibles", () => {
  it("laisse passer une file plus courte que la limite", () => {
    expect(selectionnerToastsVisibles([1, 2], 3)).toEqual([1, 2]);
  });

  it("ne garde que les PREMIERS éléments quand la file dépasse la limite (ordre d'arrivée, règle UX-17 : 3 max)", () => {
    expect(selectionnerToastsVisibles([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3]);
  });

  it("un toast persistant en tête de file n'est jamais évincé par l'arrivée d'un 4ᵉ toast", () => {
    // Le toast "1" est persistant et déjà visible ; 3 autres arrivent ensuite.
    const file = [
      { id: 1, persistant: true },
      { id: 2, persistant: false },
      { id: 3, persistant: false },
      { id: 4, persistant: false },
    ];
    const visibles = selectionnerToastsVisibles(file, 3);
    expect(visibles.some((t) => t.id === 1)).toBe(true);
    expect(visibles).toHaveLength(3);
    // Le 4ᵉ toast n'est pas perdu : il reste dans la file complète, simplement pas encore visible.
    expect(file).toHaveLength(4);
  });

  it("renvoie une liste vide si la limite est nulle ou négative", () => {
    expect(selectionnerToastsVisibles([1, 2], 0)).toEqual([]);
    expect(selectionnerToastsVisibles([1, 2], -1)).toEqual([]);
  });

  it("ne mute pas la file d'origine", () => {
    const source = [1, 2, 3];
    const resultat = selectionnerToastsVisibles(source, 2);
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
