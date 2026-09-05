/**
 * Preuves (P0, correctif Codex round 2, 30/08/2026) que les notifications
 * asynchrones (`publierEvenement`, déclenché par `initNotificationService`
 * sur le bus d'événements interne) ne peuvent JAMAIS écrire en base après
 * l'activation de la barrière — donc jamais entre le snapshot du dump et
 * l'effacement de `reinitialiserBase()` (voir `services/reinitialisation.ts`,
 * qui active la barrière, attend le drainage, PUIS seulement construit le
 * dump et efface, avant d'abaisser la barrière).
 *
 * Aucun mock de `executerTacheDeFondSuivie`/`barriereEcriture.ts` : c'est le
 * VRAI mécanisme (déjà prouvé en isolation dans `lib/barriereEcriture.test.ts`)
 * qui est exercé ici, avec seulement Prisma et Socket.io mockés (aucune base
 * réelle nécessaire pour ce fichier).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rolePermissionFindMany: vi.fn(),
  utilisateurFindMany: vi.fn(),
  notificationCreate: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    rolePermission: { findMany: mocks.rolePermissionFindMany },
    utilisateur: { findMany: mocks.utilisateurFindMany },
    notification: { create: mocks.notificationCreate },
  },
}));

vi.mock("../lib/realtime.js", () => ({
  getIo: () => ({ to: () => ({ emit: mocks.emit }) }),
  roomUtilisateur: (id: string) => `user:${id}`,
}));

const { initNotificationService } = await import("./notifications.js");
const { busEvenements } = await import("../lib/events.js");
const {
  activerBarriereEtAttendreDrainage,
  abaisserBarriere,
  barriereReinitialisationActive,
  ecrituresEnVol,
  reinitialiserBarrierePourTests,
} = await import("../lib/barriereEcriture.js");

function evenementSysteme() {
  return {
    type: "DETTE_NON_PAYEE" as const,
    module: "COMMANDES" as const,
    emetteurId: null,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  busEvenements.removeAllListeners("evenement");
  reinitialiserBarrierePourTests();
});

describe("initNotificationService — suivi par la barrière d'écriture", () => {
  it("une publication déjà commencée est drainée AVANT que la barrière ne résolve (donc avant tout dump)", async () => {
    // Porte manuelle sur le premier appel Prisma de `publierEvenement`
    // (rolePermission.findMany, chemin événement SYSTÈME) : simule une
    // notification dont l'écriture est encore réellement en cours.
    let debloquer!: () => void;
    const porte = new Promise<void>((resolve) => {
      debloquer = resolve;
    });
    mocks.rolePermissionFindMany.mockImplementation(async () => {
      await porte;
      return [];
    });
    // Aucun rôle destinataire ensuite → `utilisateur.findMany` n'a même pas
    // besoin d'être configuré, `publierEvenement` s'arrête après (liste vide).
    mocks.utilisateurFindMany.mockResolvedValue([]);

    initNotificationService();
    busEvenements.emettreEvenement(evenementSysteme());

    // Attend que `executerTacheDeFondSuivie` ait bien incrémenté le compteur
    // — entrelacement déterministe, jamais un délai qui espère.
    await vi.waitFor(() => {
      if (ecrituresEnVol() !== 1) throw new Error("publication pas encore comptée");
    });

    const pBarriere = activerBarriereEtAttendreDrainage(500);
    // Toujours en attente : la publication n'a pas fini (porte fermée).
    const etat = await Promise.race([
      pBarriere.then(() => "resolue"),
      new Promise((r) => setTimeout(() => r("en-attente"), 30)),
    ]);
    expect(etat).toBe("en-attente");
    expect(barriereReinitialisationActive()).toBe(true);

    debloquer();
    await pBarriere;
    expect(ecrituresEnVol()).toBe(0);
    abaisserBarriere();
  });

  it("aucune NOUVELLE publication ne démarre pendant que la barrière est active — la fonction n'est même pas appelée", async () => {
    initNotificationService();
    await activerBarriereEtAttendreDrainage();
    expect(barriereReinitialisationActive()).toBe(true);

    busEvenements.emettreEvenement(evenementSysteme());
    // Laisse une microtask s'écouler pour que le handler synchrone
    // (`executerTacheDeFondSuivie`) ait pu s'exécuter — il retourne
    // immédiatement `undefined` sans jamais appeler `publierEvenement`.
    await new Promise((r) => setTimeout(r, 10));

    expect(mocks.rolePermissionFindMany).not.toHaveBeenCalled();
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
    expect(ecrituresEnVol()).toBe(0);

    abaisserBarriere();
  });

  it("aucune notification ne peut apparaître entre le snapshot du dump et l'effacement — composite des deux garanties ci-dessus sur tout l'intervalle activation→abaissement", async () => {
    // Reproduit exactement la séquence de `reinitialiserBase()` : activer,
    // attendre le drainage, PUIS (ici, simulé) dump+effacement, PUIS abaisser
    // — et prouve qu'aucun événement émis PENDANT cet intervalle entier ne
    // déclenche la moindre écriture Prisma issue d'une notification.
    initNotificationService();
    await activerBarriereEtAttendreDrainage();

    // Plusieurs événements arrivent pendant la fenêtre dump→effacement.
    busEvenements.emettreEvenement(evenementSysteme());
    busEvenements.emettreEvenement(evenementSysteme());
    busEvenements.emettreEvenement(evenementSysteme());
    await new Promise((r) => setTimeout(r, 10));

    expect(mocks.rolePermissionFindMany).not.toHaveBeenCalled();
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
    expect(ecrituresEnVol()).toBe(0);

    // Fin de la fenêtre (équivalent de la fin de `reinitialiserBase()`) :
    // seulement maintenant les nouveaux événements peuvent à nouveau
    // déclencher une vraie publication.
    abaisserBarriere();
    mocks.rolePermissionFindMany.mockResolvedValue([]);
    mocks.utilisateurFindMany.mockResolvedValue([]);
    busEvenements.emettreEvenement(evenementSysteme());
    await vi.waitFor(() => {
      if (!mocks.rolePermissionFindMany.mock.calls.length) throw new Error("pas encore appelée");
    });
  });
});
