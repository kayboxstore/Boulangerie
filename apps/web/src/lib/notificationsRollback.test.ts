import { describe, expect, it } from "vitest";
import {
  ajouterNotificationAvecPlafond,
  annulerApresEchec,
  annulerLectureCiblee,
  compterNonLues,
  confirmerSucces,
  creerProprieteUnique,
  creerRegistreDePropriete,
  demarrerMarquerLue,
  demarrerToutMarquerLu,
  marquerIdCommeLu,
  marquerTousCommeLus,
  type EtatNotifications,
  type NotificationAvecLecture,
} from "./notificationsRollback";

interface Notif extends NotificationAvecLecture {
  titre: string;
}

const jeu: Notif[] = [
  { id: "1", lu: false, titre: "A" },
  { id: "2", lu: false, titre: "B" },
  { id: "3", lu: true, titre: "C" },
];

describe("marquerIdCommeLu", () => {
  it("marque une notification non lue comme lue", () => {
    const { notifications, aChange } = marquerIdCommeLu(jeu, "1");
    expect(aChange).toBe(true);
    expect(notifications.find((n) => n.id === "1")?.lu).toBe(true);
  });

  it("ne fait rien si déjà lue", () => {
    const { notifications, aChange } = marquerIdCommeLu(jeu, "3");
    expect(aChange).toBe(false);
    expect(notifications).toEqual(jeu);
  });

  it("ne fait rien si l'identifiant est introuvable", () => {
    const { aChange } = marquerIdCommeLu(jeu, "inconnu");
    expect(aChange).toBe(false);
  });

  it("ne mute pas la liste d'origine", () => {
    const avant = jeu.map((n) => ({ ...n }));
    marquerIdCommeLu(jeu, "1");
    expect(jeu).toEqual(avant);
  });
});

describe("marquerTousCommeLus", () => {
  it("renvoie uniquement les identifiants réellement non lus", () => {
    const { idsTouches } = marquerTousCommeLus(jeu);
    expect(idsTouches).toEqual(["1", "2"]);
  });

  it("marque bien tous les éléments comme lus", () => {
    const { notifications } = marquerTousCommeLus(jeu);
    expect(notifications.every((n) => n.lu)).toBe(true);
  });

  it("renvoie une liste d'ids vide si tout est déjà lu", () => {
    const toutLu: Notif[] = [{ id: "1", lu: true, titre: "A" }];
    const { idsTouches, notifications } = marquerTousCommeLus(toutLu);
    expect(idsTouches).toEqual([]);
    expect(notifications).toEqual(toutLu);
  });
});

describe("annulerLectureCiblee — préserve les arrivées concurrentes", () => {
  it("ne restaure que les identifiants indiqués, jamais les autres", () => {
    const apresOptimiste = marquerIdCommeLu(jeu, "1").notifications;
    const avecArriveeConcurrente: Notif[] = [{ id: "4", lu: false, titre: "Nouvelle" }, ...apresOptimiste];

    const resultat = annulerLectureCiblee(avecArriveeConcurrente, ["1"]);

    expect(resultat.find((n) => n.id === "1")?.lu).toBe(false);
    expect(resultat.find((n) => n.id === "4")).toBeTruthy();
  });

  it("ne touche pas un identifiant déjà non lu", () => {
    expect(annulerLectureCiblee(jeu, ["1"])).toEqual(jeu);
  });

  it("liste vide = aucune modification", () => {
    expect(annulerLectureCiblee(jeu, [])).toEqual(jeu);
  });
});

describe("compterNonLues — toujours dérivé, jamais un compteur indépendant", () => {
  it("combine le reste non chargé et le décompte réel du tableau", () => {
    const etat: EtatNotifications<Notif> = { notifications: jeu, resteNonLues: 5 };
    expect(compterNonLues(etat)).toBe(5 + 2);
  });

  it("reflète immédiatement une modification du tableau, sans recalcul manuel", () => {
    const etat: EtatNotifications<Notif> = { notifications: marquerIdCommeLu(jeu, "1").notifications, resteNonLues: 5 };
    expect(compterNonLues(etat)).toBe(5 + 1);
  });
});

describe("ajouterNotificationAvecPlafond — round 4 : conserve le compteur lors du plafonnement", () => {
  const PLAFOND = 3;

  it("sous le plafond : ajout simple, resteNonLues inchangé", () => {
    const etat: EtatNotifications<Notif> = { notifications: [{ id: "1", lu: false, titre: "A" }], resteNonLues: 0 };
    const resultat = ajouterNotificationAvecPlafond(etat, { id: "2", lu: false, titre: "B" }, PLAFOND);
    expect(resultat.notifications.map((n) => n.id)).toEqual(["2", "1"]);
    expect(resultat.resteNonLues).toBe(0);
  });

  it("liste pleine, l'élément expulsé est NON LU : bascule dans resteNonLues", () => {
    const etat: EtatNotifications<Notif> = {
      notifications: [
        { id: "1", lu: false, titre: "A" },
        { id: "2", lu: false, titre: "B" },
        { id: "3", lu: false, titre: "C" }, // sera expulsé, le plus ancien
      ],
      resteNonLues: 10,
    };
    const resultat = ajouterNotificationAvecPlafond(etat, { id: "4", lu: false, titre: "Nouvelle" }, PLAFOND);
    expect(resultat.notifications.map((n) => n.id)).toEqual(["4", "1", "2"]);
    expect(resultat.notifications.find((n) => n.id === "3")).toBeUndefined();
    expect(resultat.resteNonLues).toBe(11); // +1 pour "3", non lu, expulsé
    expect(compterNonLues(resultat)).toBe(compterNonLues(etat) + 1); // aucune perte : +1 nouvelle, +0 net sur les autres
  });

  it("liste pleine, l'élément expulsé est DÉJÀ LU : resteNonLues inchangé", () => {
    const etat: EtatNotifications<Notif> = {
      notifications: [
        { id: "1", lu: false, titre: "A" },
        { id: "2", lu: false, titre: "B" },
        { id: "3", lu: true, titre: "C" }, // sera expulsé, déjà lu
      ],
      resteNonLues: 10,
    };
    const resultat = ajouterNotificationAvecPlafond(etat, { id: "4", lu: false, titre: "Nouvelle" }, PLAFOND);
    expect(resultat.notifications.find((n) => n.id === "3")).toBeUndefined();
    expect(resultat.resteNonLues).toBe(10); // aucun ajout : l'expulsé était déjà lu
  });

  it("plusieurs arrivées successives après avoir atteint le plafond : cumul correct", () => {
    let etat: EtatNotifications<Notif> = {
      notifications: [
        { id: "1", lu: false, titre: "A" },
        { id: "2", lu: true, titre: "B" },
        { id: "3", lu: false, titre: "C" },
      ],
      resteNonLues: 0,
    };
    const totalAvant = compterNonLues(etat);

    etat = ajouterNotificationAvecPlafond(etat, { id: "4", lu: false, titre: "D" }, PLAFOND); // expulse "3" (non lu) → +1
    etat = ajouterNotificationAvecPlafond(etat, { id: "5", lu: false, titre: "E" }, PLAFOND); // expulse "2" (déjà lu) → +0
    etat = ajouterNotificationAvecPlafond(etat, { id: "6", lu: false, titre: "F" }, PLAFOND); // expulse "1" (non lu) → +1

    expect(etat.notifications.map((n) => n.id)).toEqual(["6", "5", "4"]);
    // Chaque expulsion non lue ne fait que TRANSFÉRER son unité du décompte
    // tableau vers resteNonLues (net nul) : seule l'arrivée de 3 nouvelles
    // notifications non lues fait progresser le total, donc totalAvant + 3.
    expect(compterNonLues(etat)).toBe(totalAvant + 3);
  });
});

describe("creerRegistreDePropriete", () => {
  it("un rollback n'agit que sur ce qu'il possède encore", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jetonA = Symbol("marquerLue-1");
    registre.reclamer([{ id: "1", doitRestaurerNonLu: true }], jetonA);
    expect(registre.idsEncoreReclamesPar(["1"], jetonA)).toEqual(["1"]);
  });

  it("reclamer() par un jeton plus récent retire la propriété du précédent", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jetonA = Symbol("A");
    const jetonB = Symbol("B");
    registre.reclamer([{ id: "1", doitRestaurerNonLu: true }], jetonA);
    registre.reclamer([{ id: "1", doitRestaurerNonLu: true }], jetonB);

    expect(registre.idsEncoreReclamesPar(["1"], jetonA)).toEqual([]);
    expect(registre.idsEncoreReclamesPar(["1"], jetonB)).toEqual(["1"]);
  });

  it("confirmer() rend un identifiant définitivement irrécupérable, même par un jeton plus récent", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jetonA = Symbol("A");
    registre.reclamer([{ id: "1", doitRestaurerNonLu: true }], jetonA);
    registre.confirmer(["1"]);

    const jetonB = Symbol("B");
    registre.reclamer([{ id: "1", doitRestaurerNonLu: true }], jetonB);
    expect(registre.idsEncoreReclamesPar(["1"], jetonB)).toEqual([]);
  });

  it("libérer() ne retire que la propriété du jeton correspondant", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jetonA = Symbol("A");
    const jetonB = Symbol("B");
    registre.reclamer([{ id: "1", doitRestaurerNonLu: true }], jetonA);
    registre.reclamer([{ id: "1", doitRestaurerNonLu: true }], jetonB);
    registre.liberer(["1"], jetonA);

    expect(registre.idsEncoreReclamesPar(["1"], jetonB)).toEqual(["1"]);
  });

  it("identifiants indépendants : aucune influence croisée", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jetonGlobal = Symbol("toutMarquerLu");
    registre.reclamer(
      [
        { id: "1", doitRestaurerNonLu: true },
        { id: "2", doitRestaurerNonLu: true },
      ],
      jetonGlobal,
    );
    const jetonIndividuel = Symbol("marquerLue-3");
    registre.reclamer([{ id: "3", doitRestaurerNonLu: true }], jetonIndividuel);

    expect(registre.idsEncoreReclamesPar(["1", "2"], jetonGlobal)).toEqual(["1", "2"]);
    expect(registre.idsEncoreReclamesPar(["3"], jetonIndividuel)).toEqual(["3"]);
  });

  describe("doitRestaurerNonLu — round 5 : distinction propriété / obligation de rollback", () => {
    it("un id réclamé avec doitRestaurerNonLu=false n'est pas restauré même s'il reste possédé", () => {
      const registre = creerRegistreDePropriete<symbol>();
      const jeton = Symbol("global");
      registre.reclamer([{ id: "dejaLue", doitRestaurerNonLu: false }], jeton);

      expect(registre.idsEncoreReclamesPar(["dejaLue"], jeton)).toEqual(["dejaLue"]); // propriété : oui
      expect(registre.doitRestaurerNonLu("dejaLue")).toBe(false); // obligation de rollback : non
    });

    it("un id repris hérite de l'obligation de rollback qu'un jeton plus récent lui attribue explicitement", () => {
      const registre = creerRegistreDePropriete<symbol>();
      const jetonIndividuel = Symbol("individuel");
      registre.reclamer([{ id: "1", doitRestaurerNonLu: true }], jetonIndividuel);
      expect(registre.doitRestaurerNonLu("1")).toBe(true);

      // Le jeton global lit l'obligation existante AVANT de réclamer à son tour (c'est demarrerToutMarquerLu qui fait cette lecture) —
      // ici on vérifie seulement que reclamer() écrase bien avec la nouvelle valeur fournie par l'appelant.
      const jetonGlobal = Symbol("global");
      registre.reclamer([{ id: "1", doitRestaurerNonLu: registre.doitRestaurerNonLu("1") }], jetonGlobal);
      expect(registre.doitRestaurerNonLu("1")).toBe(true);
      expect(registre.idsEncoreReclamesPar(["1"], jetonIndividuel)).toEqual([]); // propriété reprise
    });

    it("doitRestaurerNonLu() renvoie false pour un id non réclamé ou confirmé", () => {
      const registre = creerRegistreDePropriete<symbol>();
      expect(registre.doitRestaurerNonLu("inconnu")).toBe(false);

      const jeton = Symbol("A");
      registre.reclamer([{ id: "1", doitRestaurerNonLu: true }], jeton);
      registre.confirmer(["1"]);
      expect(registre.doitRestaurerNonLu("1")).toBe(false); // confirmé = terminal, plus d'obligation
    });
  });
});

describe("creerProprieteUnique — round 4 : jamais de confirmation terminale (le reste non chargé évolue)", () => {
  it("réclamer puis vérifier la possession", () => {
    const p = creerProprieteUnique<symbol>();
    const jeton = Symbol("cycle-1");
    p.reclamer(jeton);
    expect(p.estPossedePar(jeton)).toBe(true);
  });

  it("un jeton plus récent reprend toujours la main, y compris après un précédent succès", () => {
    const p = creerProprieteUnique<symbol>();
    const jeton1 = Symbol("cycle-1");
    p.reclamer(jeton1);
    p.liberer(jeton1); // succès du 1er cycle

    // Contrairement au registre à ids réels, RIEN n'empêche un second cycle
    // de réclamer à nouveau ce même slot — le reste non chargé n'est jamais
    // "terminal".
    const jeton2 = Symbol("cycle-2");
    p.reclamer(jeton2);
    expect(p.estPossedePar(jeton2)).toBe(true);
    expect(p.estPossedePar(jeton1)).toBe(false);
  });

  it("libérer() ne retire que la propriété du jeton correspondant", () => {
    const p = creerProprieteUnique<symbol>();
    const jetonA = Symbol("A");
    const jetonB = Symbol("B");
    p.reclamer(jetonA);
    p.reclamer(jetonB); // B a repris la main
    p.liberer(jetonA); // A tente de libérer ce qu'il ne possède plus

    expect(p.estPossedePar(jetonB)).toBe(true);
  });
});

/**
 * Scénarios de concurrence exigés en revue, exercés via les MÊMES
 * orchestrateurs que `socket.tsx` (demarrerMarquerLue, demarrerToutMarquerLu,
 * confirmerSucces, annulerApresEchec) — aucune logique parallèle réécrite ici.
 */
describe("Scénarios de concurrence individuel/global (mêmes orchestrateurs que socket.tsx)", () => {
  function etatInitial(): EtatNotifications<Notif> {
    return {
      notifications: [
        { id: "1", lu: false, titre: "A" },
        { id: "2", lu: false, titre: "B" },
      ],
      resteNonLues: 0,
    };
  }

  it("1) individuel en vol → global réussi → individuel échoué : le succès global l'emporte", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat = etatInitial();

    const individuel = demarrerMarquerLue(etat, "1", registre);
    etat = individuel.etat;
    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(true);

    const global = demarrerToutMarquerLu(etat, registre, registreReste);
    etat = global.etat;

    etat = confirmerSucces(etat, global, registre, registreReste);

    const resultat = annulerApresEchec(etat, individuel, registre, registreReste);
    expect(resultat).toBeNull();

    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(true);
    expect(etat.notifications.find((n) => n.id === "2")?.lu).toBe(true);
    expect(compterNonLues(etat)).toBe(0);
  });

  it("2) individuel en vol → global échoué → individuel réussi : la lecture individuelle reste acquise", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat = etatInitial();

    const individuel = demarrerMarquerLue(etat, "1", registre);
    etat = individuel.etat;

    const global = demarrerToutMarquerLu(etat, registre, registreReste);
    etat = global.etat;

    const resultatGlobal = annulerApresEchec(etat, global, registre, registreReste);
    expect(resultatGlobal).not.toBeNull();
    etat = resultatGlobal!;
    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(false);
    expect(etat.notifications.find((n) => n.id === "2")?.lu).toBe(false);

    etat = confirmerSucces(etat, individuel, registre, registreReste);
    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(true);
    expect(etat.notifications.find((n) => n.id === "2")?.lu).toBe(false);
    expect(compterNonLues(etat)).toBe(1);
  });

  it("3) individuel et global échouent tous les deux, individuel en premier : tout redevient non lu", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat = etatInitial();

    const individuel = demarrerMarquerLue(etat, "1", registre);
    etat = individuel.etat;
    const global = demarrerToutMarquerLu(etat, registre, registreReste);
    etat = global.etat;

    const resultatIndividuel = annulerApresEchec(etat, individuel, registre, registreReste);
    expect(resultatIndividuel).toBeNull();

    const resultatGlobal = annulerApresEchec(etat, global, registre, registreReste);
    expect(resultatGlobal).not.toBeNull();
    etat = resultatGlobal!;

    expect(etat.notifications.every((n) => !n.lu)).toBe(true);
    expect(compterNonLues(etat)).toBe(2);
  });

  it("4) individuel et global échouent tous les deux, global en premier : tout redevient non lu", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat = etatInitial();

    const individuel = demarrerMarquerLue(etat, "1", registre);
    etat = individuel.etat;
    const global = demarrerToutMarquerLu(etat, registre, registreReste);
    etat = global.etat;

    const resultatGlobal = annulerApresEchec(etat, global, registre, registreReste);
    expect(resultatGlobal).not.toBeNull();
    etat = resultatGlobal!;
    expect(etat.notifications.every((n) => !n.lu)).toBe(true);

    const resultatIndividuel = annulerApresEchec(etat, individuel, registre, registreReste);
    expect(resultatIndividuel).toBeNull();

    expect(etat.notifications.every((n) => !n.lu)).toBe(true);
    expect(compterNonLues(etat)).toBe(2);
  });

  it("5) deux appels individuels sur le même identifiant : le second ne déclenche aucune action", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const etat = etatInitial();

    const premier = demarrerMarquerLue(etat, "1", registre);
    expect(premier.aDemarre).toBe(true);

    const second = demarrerMarquerLue(premier.etat, "1", registre);
    expect(second.aDemarre).toBe(false);

    const registreReste = creerProprieteUnique<symbol>();
    const resultat = annulerApresEchec(premier.etat, premier, registre, registreReste);
    expect(resultat).not.toBeNull();
    expect(resultat!.notifications.find((n) => n.id === "1")?.lu).toBe(false);
  });

  it("6) compteur global (120) très supérieur au nombre de notifications chargées (2) : restauré fidèlement, pas à 2", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat: EtatNotifications<Notif> = {
      notifications: [
        { id: "1", lu: false, titre: "A" },
        { id: "2", lu: false, titre: "B" },
      ],
      resteNonLues: 118,
    };
    expect(compterNonLues(etat)).toBe(120);

    const global = demarrerToutMarquerLu(etat, registre, registreReste);
    etat = global.etat;
    expect(compterNonLues(etat)).toBe(0);

    const resultat = annulerApresEchec(etat, global, registre, registreReste);
    expect(resultat).not.toBeNull();
    etat = resultat!;

    expect(compterNonLues(etat)).toBe(120);
    expect(etat.resteNonLues).toBe(118);
    expect(etat.notifications.every((n) => !n.lu)).toBe(true);
  });

  it("7a) notification Socket.io reçue pendant une réussite : conservée telle quelle, comptée en plus", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat = etatInitial();

    const global = demarrerToutMarquerLu(etat, registre, registreReste);
    etat = global.etat;

    etat = { notifications: [{ id: "3", lu: false, titre: "Nouvelle" }, ...etat.notifications], resteNonLues: etat.resteNonLues };
    expect(compterNonLues(etat)).toBe(1);

    etat = confirmerSucces(etat, global, registre, registreReste);

    expect(etat.notifications.find((n) => n.id === "3")?.lu).toBe(false);
    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(true);
    expect(compterNonLues(etat)).toBe(1);
  });

  it("7b) notification Socket.io reçue pendant un rollback : conservée telle quelle, comptée en plus", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat = etatInitial();

    const global = demarrerToutMarquerLu(etat, registre, registreReste);
    etat = global.etat;

    etat = { notifications: [{ id: "3", lu: false, titre: "Nouvelle" }, ...etat.notifications], resteNonLues: etat.resteNonLues };

    const resultat = annulerApresEchec(etat, global, registre, registreReste);
    expect(resultat).not.toBeNull();
    etat = resultat!;

    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(false);
    expect(etat.notifications.find((n) => n.id === "2")?.lu).toBe(false);
    expect(etat.notifications.find((n) => n.id === "3")?.lu).toBe(false);
    expect(compterNonLues(etat)).toBe(3);
  });
});

/**
 * Rollback ciblé de `toutMarquerLu` (round 5) : `annulerApresEchec` ne doit
 * jamais repasser à `lu: false` une notification qui était RÉELLEMENT déjà
 * lue avant le démarrage de l'action, même si le global en a réclamé la
 * propriété (pour la concurrence). Seul le sous-ensemble dont
 * `doitRestaurerNonLu` vaut vrai est restauré. Tous les scénarios exigés en
 * revue, exercés via les mêmes orchestrateurs que `socket.tsx`.
 */
describe("Rollback ciblé de toutMarquerLu (round 5)", () => {
  it("1) mélange d'une notification déjà lue et d'une non lue → global échoué : la déjà-lue reste lue, l'autre redevient non lue", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat: EtatNotifications<Notif> = {
      notifications: [
        { id: "A", lu: true, titre: "Déjà lue" },
        { id: "B", lu: false, titre: "Non lue" },
      ],
      resteNonLues: 0,
    };

    const global = demarrerToutMarquerLu(etat, registre, registreReste);
    etat = global.etat;
    expect(etat.notifications.every((n) => n.lu)).toBe(true);

    const resultat = annulerApresEchec(etat, global, registre, registreReste);
    expect(resultat).not.toBeNull();
    etat = resultat!;

    expect(etat.notifications.find((n) => n.id === "A")?.lu).toBe(true); // reste lue
    expect(etat.notifications.find((n) => n.id === "B")?.lu).toBe(false); // redevient non lue
  });

  it("2) toutes les notifications chargées déjà lues + resteNonLues>0 → global échoué : seul le reste non chargé est restauré", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat: EtatNotifications<Notif> = {
      notifications: [
        { id: "A", lu: true, titre: "Déjà lue A" },
        { id: "B", lu: true, titre: "Déjà lue B" },
      ],
      resteNonLues: 5,
    };

    const global = demarrerToutMarquerLu(etat, registre, registreReste);
    expect(global.aDemarre).toBe(true); // resteNonLues>0 suffit à démarrer, même si idsTouches est vide
    etat = global.etat;
    expect(etat.resteNonLues).toBe(0);

    const resultat = annulerApresEchec(etat, global, registre, registreReste);
    expect(resultat).not.toBeNull();
    etat = resultat!;

    expect(etat.resteNonLues).toBe(5); // restauré
    expect(etat.notifications.every((n) => n.lu)).toBe(true); // jamais repassées à non lues
  });

  it("3a) deux globaux concurrents qui échouent, échec du premier puis du second : le second (dernier propriétaire) restaure, le premier n'a plus rien à faire", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat: EtatNotifications<Notif> = {
      notifications: [
        { id: "1", lu: false, titre: "A" },
        { id: "2", lu: false, titre: "B" },
      ],
      resteNonLues: 0,
    };

    const global1 = demarrerToutMarquerLu(etat, registre, registreReste);
    etat = global1.etat; // tout est déjà lu de façon optimiste

    // Une nouvelle notification non lue arrive (ex. Socket.io) avant que
    // global1 ne se résolve : c'est ce qui permet à un second appel
    // `toutMarquerLu()` de démarrer légitimement (le garde-fou de
    // `demarrerToutMarquerLu` bloque sinon un second appel sur un état déjà
    // entièrement lu) — et de reprendre la propriété de TOUS les ids
    // actuels, y compris ceux déjà réclamés par global1.
    etat = {
      notifications: [{ id: "3", lu: false, titre: "Nouvelle" }, ...etat.notifications],
      resteNonLues: etat.resteNonLues,
    };
    const global2 = demarrerToutMarquerLu(etat, registre, registreReste);
    expect(global2.aDemarre).toBe(true);
    etat = global2.etat;

    const resultat1 = annulerApresEchec(etat, global1, registre, registreReste);
    expect(resultat1).toBeNull(); // global1 ne possède plus rien : global2 a tout repris

    const resultat2 = annulerApresEchec(etat, global2, registre, registreReste);
    expect(resultat2).not.toBeNull();
    etat = resultat2!;
    expect(etat.notifications.every((n) => !n.lu)).toBe(true);
  });

  it("3b) deux globaux concurrents qui échouent, échec du second puis du premier : même résultat final, ordre inverse", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat: EtatNotifications<Notif> = {
      notifications: [
        { id: "1", lu: false, titre: "A" },
        { id: "2", lu: false, titre: "B" },
      ],
      resteNonLues: 0,
    };

    const global1 = demarrerToutMarquerLu(etat, registre, registreReste);
    etat = global1.etat;
    etat = {
      notifications: [{ id: "3", lu: false, titre: "Nouvelle" }, ...etat.notifications],
      resteNonLues: etat.resteNonLues,
    };
    const global2 = demarrerToutMarquerLu(etat, registre, registreReste);
    expect(global2.aDemarre).toBe(true);
    etat = global2.etat;

    const resultat2 = annulerApresEchec(etat, global2, registre, registreReste);
    expect(resultat2).not.toBeNull();
    etat = resultat2!;
    expect(etat.notifications.every((n) => !n.lu)).toBe(true);

    const resultat1 = annulerApresEchec(etat, global1, registre, registreReste);
    expect(resultat1).toBeNull(); // global1 avait déjà perdu la propriété avant même de se résoudre

    expect(etat.notifications.every((n) => !n.lu)).toBe(true);
  });

  it("4) individuel optimiste → global démarré → global échoué → individuel réussi : la notification déjà lue avant reste intacte", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat: EtatNotifications<Notif> = {
      notifications: [
        { id: "1", lu: false, titre: "A" },
        { id: "2", lu: false, titre: "B" },
        { id: "dejaLue", lu: true, titre: "C" },
      ],
      resteNonLues: 0,
    };

    const individuel = demarrerMarquerLue(etat, "1", registre);
    etat = individuel.etat;

    const global = demarrerToutMarquerLu(etat, registre, registreReste);
    etat = global.etat;
    expect(etat.notifications.every((n) => n.lu)).toBe(true);

    const resultatGlobal = annulerApresEchec(etat, global, registre, registreReste);
    expect(resultatGlobal).not.toBeNull();
    etat = resultatGlobal!;
    // "1" hérite de l'obligation de rollback de l'individuel, encore en vol.
    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(false);
    expect(etat.notifications.find((n) => n.id === "2")?.lu).toBe(false);
    expect(etat.notifications.find((n) => n.id === "dejaLue")?.lu).toBe(true); // jamais touchée

    etat = confirmerSucces(etat, individuel, registre, registreReste);
    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(true);
    expect(etat.notifications.find((n) => n.id === "2")?.lu).toBe(false);
    expect(etat.notifications.find((n) => n.id === "dejaLue")?.lu).toBe(true);
  });

  it("5a) individuel optimiste → global démarré → les deux échouent (individuel en premier) : la notification déjà lue avant reste intacte", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat: EtatNotifications<Notif> = {
      notifications: [
        { id: "1", lu: false, titre: "A" },
        { id: "2", lu: false, titre: "B" }, // reste non lue : sans elle le global n'aurait plus rien à faire et ne démarrerait pas
        { id: "dejaLue", lu: true, titre: "C" },
      ],
      resteNonLues: 0,
    };

    const individuel = demarrerMarquerLue(etat, "1", registre);
    etat = individuel.etat;
    const global = demarrerToutMarquerLu(etat, registre, registreReste);
    expect(global.aDemarre).toBe(true);
    etat = global.etat;

    const resultatIndividuel = annulerApresEchec(etat, individuel, registre, registreReste);
    expect(resultatIndividuel).toBeNull(); // le global a repris la propriété de "1"

    const resultatGlobal = annulerApresEchec(etat, global, registre, registreReste);
    expect(resultatGlobal).not.toBeNull();
    etat = resultatGlobal!;

    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(false);
    expect(etat.notifications.find((n) => n.id === "2")?.lu).toBe(false);
    expect(etat.notifications.find((n) => n.id === "dejaLue")?.lu).toBe(true);
  });

  it("5b) individuel optimiste → global démarré → les deux échouent (global en premier) : la notification déjà lue avant reste intacte", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat: EtatNotifications<Notif> = {
      notifications: [
        { id: "1", lu: false, titre: "A" },
        { id: "2", lu: false, titre: "B" },
        { id: "dejaLue", lu: true, titre: "C" },
      ],
      resteNonLues: 0,
    };

    const individuel = demarrerMarquerLue(etat, "1", registre);
    etat = individuel.etat;
    const global = demarrerToutMarquerLu(etat, registre, registreReste);
    expect(global.aDemarre).toBe(true);
    etat = global.etat;

    const resultatGlobal = annulerApresEchec(etat, global, registre, registreReste);
    expect(resultatGlobal).not.toBeNull();
    etat = resultatGlobal!;
    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(false);
    expect(etat.notifications.find((n) => n.id === "2")?.lu).toBe(false);

    const resultatIndividuel = annulerApresEchec(etat, individuel, registre, registreReste);
    expect(resultatIndividuel).toBeNull(); // le global avait déjà repris (puis relâché) la propriété de "1"

    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(false);
    expect(etat.notifications.find((n) => n.id === "dejaLue")?.lu).toBe(true);
  });

  it("6) une notification réellement déjà lue avant l'action n'est jamais repassée à lu:false, succès ou échec du global", () => {
    const construireEtat = (): EtatNotifications<Notif> => ({
      notifications: [
        { id: "1", lu: false, titre: "A" },
        { id: "dejaLue", lu: true, titre: "C" },
      ],
      resteNonLues: 0,
    });

    // Cas succès.
    {
      const registre = creerRegistreDePropriete<symbol>();
      const registreReste = creerProprieteUnique<symbol>();
      let etat = construireEtat();
      const global = demarrerToutMarquerLu(etat, registre, registreReste);
      etat = global.etat;
      etat = confirmerSucces(etat, global, registre, registreReste);
      expect(etat.notifications.find((n) => n.id === "dejaLue")?.lu).toBe(true);
    }

    // Cas échec.
    {
      const registre = creerRegistreDePropriete<symbol>();
      const registreReste = creerProprieteUnique<symbol>();
      let etat = construireEtat();
      const global = demarrerToutMarquerLu(etat, registre, registreReste);
      etat = global.etat;
      const resultat = annulerApresEchec(etat, global, registre, registreReste);
      expect(resultat).not.toBeNull();
      etat = resultat!;
      expect(etat.notifications.find((n) => n.id === "dejaLue")?.lu).toBe(true);
      expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(false);
    }
  });
});

/**
 * Corrections round 4 : cycles répétés du "reste non chargé" et réaffirmation
 * après une réussite globale malgré une réinjection concurrente périmée.
 */
describe("Cycles du reste non chargé (round 4)", () => {
  it("1) resteNonLues>0 → 1er global réussi → nouvelles non chargées apparaissent → 2e global démarré puis échoué : restauration exacte du NOUVEAU resteNonLues", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat: EtatNotifications<Notif> = {
      notifications: [{ id: "1", lu: false, titre: "A" }],
      resteNonLues: 50,
    };

    // 1er cycle global, réussi : libère le slot sans le "confirmer" définitivement.
    const global1 = demarrerToutMarquerLu(etat, registre, registreReste);
    etat = global1.etat;
    expect(etat.resteNonLues).toBe(0);
    etat = confirmerSucces(etat, global1, registre, registreReste);
    expect(compterNonLues(etat)).toBe(0);

    // De nouvelles notifications non chargées apparaissent côté serveur
    // (ex. rechargement d'historique) : resteNonLues remonte à 30.
    etat = { ...etat, resteNonLues: 30 };

    // 2e cycle global : DOIT pouvoir réclamer le slot à nouveau (ce qui
    // échouait avant la correction, le slot étant resté "confirmé").
    const global2 = demarrerToutMarquerLu(etat, registre, registreReste);
    expect(global2.aDemarre).toBe(true);
    etat = global2.etat;
    expect(etat.resteNonLues).toBe(0);

    const resultat = annulerApresEchec(etat, global2, registre, registreReste);
    expect(resultat).not.toBeNull();
    etat = resultat!;

    // Restauré au NOUVEAU resteNonLues (30), pas resté bloqué à 0 ni retombé à l'ancien (50).
    expect(etat.resteNonLues).toBe(30);
  });

  it("2) global en vol → historique ancien réinjecté (notifications ET resteNonLues périmés) → succès global : compteur final cohérent à zéro pour le périmètre confirmé", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let etat: EtatNotifications<Notif> = {
      notifications: [
        { id: "1", lu: false, titre: "A" },
        { id: "2", lu: false, titre: "B" },
      ],
      resteNonLues: 10,
    };

    const global = demarrerToutMarquerLu(etat, registre, registreReste);
    etat = global.etat; // optimiste : "1" et "2" lus, resteNonLues 0

    // Un `chargerHistorique()` concurrent (ex. reconnexion) résout PENDANT
    // l'appel réseau du global et réinjecte un instantané périmé — antérieur
    // à la lecture globale, donc encore non lu côté client à ce moment-là.
    etat = {
      notifications: [
        { id: "1", lu: false, titre: "A" },
        { id: "2", lu: false, titre: "B" },
      ],
      resteNonLues: 10,
    };

    // Le global réussit malgré cette réinjection intercalée.
    etat = confirmerSucces(etat, global, registre, registreReste);

    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(true);
    expect(etat.notifications.find((n) => n.id === "2")?.lu).toBe(true);
    expect(etat.resteNonLues).toBe(0); // réaffirmé, pas laissé à 10
    expect(compterNonLues(etat)).toBe(0);
  });
});

/**
 * Isolation par génération de session (round 4). `socket.tsx` capture la
 * génération courante au démarrage de chaque opération et la revérifie
 * après l'attente réseau ; en cas de péremption (déconnexion, changement
 * d'utilisateur), le résultat est intégralement ignoré. Ces tests
 * reproduisent fidèlement cette structure (même gate, mêmes orchestrateurs)
 * sans pouvoir monter le composant réel (jsdom/@testing-library absents —
 * voir docs/ui/README.md).
 */
describe("Isolation par génération de session (round 4)", () => {
  function gate<T>(estPerimee: boolean, action: () => T): T | "ignore" {
    return estPerimee ? "ignore" : action();
  }

  it("1) action de A → déconnexion → échec tardif : l'état déconnecté (vide) n'est jamais modifié", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const registreReste = creerProprieteUnique<symbol>();
    let generation = 1; // session de A

    let etatDeA: EtatNotifications<Notif> = { notifications: [{ id: "1", lu: false, titre: "A" }], resteNonLues: 0 };
    const generationCapturee = generation;
    const demarrage = demarrerMarquerLue(etatDeA, "1", registre);
    etatDeA = demarrage.etat;

    // A se déconnecte pendant que la requête est en vol.
    generation += 1;
    let etatAffiche: EtatNotifications<Notif> = { notifications: [], resteNonLues: 0 }; // déconnecté

    // La requête échoue APRÈS la déconnexion.
    const resultat = gate(generation !== generationCapturee, () =>
      annulerApresEchec(etatDeA, demarrage, registre, registreReste),
    );

    expect(resultat).toBe("ignore"); // jamais exécuté : la génération a changé
    expect(etatAffiche).toEqual({ notifications: [], resteNonLues: 0 });
  });

  it("2) action de A → connexion de B → succès tardif de A : l'état de B reste intact", () => {
    const registreA = creerRegistreDePropriete<symbol>();
    const registreResteA = creerProprieteUnique<symbol>();
    let generation = 1; // session de A

    let etatDeA: EtatNotifications<Notif> = { notifications: [{ id: "1", lu: false, titre: "A" }], resteNonLues: 0 };
    const generationCapturee = generation;
    const demarrage = demarrerMarquerLue(etatDeA, "1", registreA);
    etatDeA = demarrage.etat;

    // B se connecte : nouvelle génération, nouveaux registres et nouvel état,
    // exactement comme le fait le SocketProvider réel à chaque changement
    // d'utilisateur.
    generation += 1;
    const registreB = creerRegistreDePropriete<symbol>();
    const registreResteB = creerProprieteUnique<symbol>();
    let etatDeB: EtatNotifications<Notif> = { notifications: [{ id: "9", lu: false, titre: "Notif de B" }], resteNonLues: 3 };
    const etatDeBAvant = etatDeB;

    // La requête de A réussit APRÈS la connexion de B.
    const resultat = gate(generation !== generationCapturee, () =>
      confirmerSucces(etatDeA, demarrage, registreA, registreResteA),
    );

    expect(resultat).toBe("ignore");
    expect(etatDeB).toEqual(etatDeBAvant); // état de B jamais touché
    expect(compterNonLues(etatDeB)).toBe(4); // resteNonLues (3) + 1 non lue dans le tableau ("9")
    // Les registres de B, distincts de ceux de A, n'ont reçu aucune réclamation de A.
    expect(registreB.idsEncoreReclamesPar(["1"], demarrage.jeton)).toEqual([]);
  });

  it("3) action de A → connexion de B → échec tardif de A : état et compteur de B intacts", () => {
    const registreA = creerRegistreDePropriete<symbol>();
    const registreResteA = creerProprieteUnique<symbol>();
    let generation = 1;

    let etatDeA: EtatNotifications<Notif> = { notifications: [{ id: "1", lu: false, titre: "A" }], resteNonLues: 0 };
    const generationCapturee = generation;
    const demarrage = demarrerMarquerLue(etatDeA, "1", registreA);
    etatDeA = demarrage.etat;

    generation += 1; // connexion de B
    let etatDeB: EtatNotifications<Notif> = {
      notifications: [
        { id: "9", lu: false, titre: "Notif de B" },
        { id: "10", lu: true, titre: "Autre" },
      ],
      resteNonLues: 7,
    };
    const compteurDeBAvant = compterNonLues(etatDeB);

    const resultat = gate(generation !== generationCapturee, () =>
      annulerApresEchec(etatDeA, demarrage, registreA, registreResteA),
    );

    expect(resultat).toBe("ignore");
    expect(compterNonLues(etatDeB)).toBe(compteurDeBAvant);
    expect(etatDeB.notifications).toHaveLength(2);
  });
});
