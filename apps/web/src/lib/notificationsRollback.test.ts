import { describe, expect, it } from "vitest";
import {
  ID_RESTE_NON_CHARGE,
  annulerApresEchec,
  annulerLectureCiblee,
  compterNonLues,
  confirmerSucces,
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
    expect(compterNonLues(etat)).toBe(5 + 2); // "1" et "2" non lus dans le tableau
  });

  it("reflète immédiatement une modification du tableau, sans recalcul manuel", () => {
    const etat: EtatNotifications<Notif> = { notifications: marquerIdCommeLu(jeu, "1").notifications, resteNonLues: 5 };
    expect(compterNonLues(etat)).toBe(5 + 1); // seul "2" reste non lu dans le tableau
  });
});

describe("creerRegistreDePropriete", () => {
  it("un rollback n'agit que sur ce qu'il possède encore", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jetonA = Symbol("marquerLue-1");
    registre.reclamer(["1"], jetonA);
    expect(registre.idsEncoreReclamesPar(["1"], jetonA)).toEqual(["1"]);
  });

  it("reclamer() par un jeton plus récent retire la propriété du précédent", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jetonA = Symbol("A");
    const jetonB = Symbol("B");
    registre.reclamer(["1"], jetonA);
    registre.reclamer(["1"], jetonB);

    expect(registre.idsEncoreReclamesPar(["1"], jetonA)).toEqual([]);
    expect(registre.idsEncoreReclamesPar(["1"], jetonB)).toEqual(["1"]);
  });

  it("confirmer() rend un identifiant définitivement irrécupérable, même par un jeton plus récent", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jetonA = Symbol("A");
    registre.reclamer(["1"], jetonA);
    registre.confirmer(["1"]);

    const jetonB = Symbol("B");
    registre.reclamer(["1"], jetonB); // ne doit avoir aucun effet sur un id confirmé
    expect(registre.idsEncoreReclamesPar(["1"], jetonB)).toEqual([]);
  });

  it("libérer() ne retire que la propriété du jeton correspondant", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jetonA = Symbol("A");
    const jetonB = Symbol("B");
    registre.reclamer(["1"], jetonA);
    registre.reclamer(["1"], jetonB);
    registre.liberer(["1"], jetonA); // A tente de libérer ce qu'il ne possède plus

    expect(registre.idsEncoreReclamesPar(["1"], jetonB)).toEqual(["1"]); // B garde la main
  });

  it("identifiants indépendants : aucune influence croisée", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jetonGlobal = Symbol("toutMarquerLu");
    registre.reclamer(["1", "2"], jetonGlobal);
    const jetonIndividuel = Symbol("marquerLue-3");
    registre.reclamer(["3"], jetonIndividuel);

    expect(registre.idsEncoreReclamesPar(["1", "2"], jetonGlobal)).toEqual(["1", "2"]);
    expect(registre.idsEncoreReclamesPar(["3"], jetonIndividuel)).toEqual(["3"]);
  });
});

/**
 * Scénarios de concurrence exigés en revue (round 3), exercés via les MÊMES
 * orchestrateurs que `socket.tsx` (demarrerMarquerLue, demarrerToutMarquerLu,
 * confirmerSucces, annulerApresEchec) — aucune logique parallèle réécrite ici.
 * `etat` est réassigné pas à pas comme le serait `etatRef.current` dans le
 * composant réel, jamais lu/écrit "en parallèle" par accident : chaque étape
 * représente un évènement asynchrone résolu dans un ordre précis et contrôlé.
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
    let etat = etatInitial();

    const individuel = demarrerMarquerLue(etat, "1", registre);
    etat = individuel.etat;
    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(true);

    const global = demarrerToutMarquerLu(etat, registre);
    etat = global.etat;

    etat = confirmerSucces(etat, global.idsReclames, registre);

    const resultat = annulerApresEchec(etat, individuel.idsReclames, individuel.jeton, individuel.resteNonLuesAvant, registre);
    expect(resultat).toBeNull(); // l'individuel ne possède plus "1" : rien à annuler

    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(true);
    expect(etat.notifications.find((n) => n.id === "2")?.lu).toBe(true);
    expect(compterNonLues(etat)).toBe(0);
  });

  it("2) individuel en vol → global échoué → individuel réussi : la lecture individuelle reste acquise", () => {
    const registre = creerRegistreDePropriete<symbol>();
    let etat = etatInitial();

    const individuel = demarrerMarquerLue(etat, "1", registre);
    etat = individuel.etat;

    const global = demarrerToutMarquerLu(etat, registre);
    etat = global.etat;

    const resultatGlobal = annulerApresEchec(etat, global.idsReclames, global.jeton, global.resteNonLuesAvant, registre);
    expect(resultatGlobal).not.toBeNull();
    etat = resultatGlobal!;
    // "1" avait été marqué lu par l'individuel (pas par le global lui-même) —
    // le rollback global le repasse temporairement à non lu, en attendant
    // que l'issue réelle de l'appel individuel soit connue.
    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(false);
    expect(etat.notifications.find((n) => n.id === "2")?.lu).toBe(false);

    // L'appel individuel réussit ensuite : il réaffirme "1" comme lu, quelle
    // que soit l'issue déjà connue du global.
    etat = confirmerSucces(etat, individuel.idsReclames, registre);
    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(true);
    expect(etat.notifications.find((n) => n.id === "2")?.lu).toBe(false);
    expect(compterNonLues(etat)).toBe(1);
  });

  it("3) individuel et global échouent tous les deux, individuel en premier : tout redevient non lu", () => {
    const registre = creerRegistreDePropriete<symbol>();
    let etat = etatInitial();

    const individuel = demarrerMarquerLue(etat, "1", registre);
    etat = individuel.etat;
    const global = demarrerToutMarquerLu(etat, registre);
    etat = global.etat;

    const resultatIndividuel = annulerApresEchec(etat, individuel.idsReclames, individuel.jeton, individuel.resteNonLuesAvant, registre);
    expect(resultatIndividuel).toBeNull(); // propriété déjà reprise par le global
    // etat inchangé par cet échec

    const resultatGlobal = annulerApresEchec(etat, global.idsReclames, global.jeton, global.resteNonLuesAvant, registre);
    expect(resultatGlobal).not.toBeNull();
    etat = resultatGlobal!;

    expect(etat.notifications.every((n) => !n.lu)).toBe(true);
    expect(compterNonLues(etat)).toBe(2); // les DEUX notifications, pas seulement celle du global
  });

  it("4) individuel et global échouent tous les deux, global en premier : tout redevient non lu", () => {
    const registre = creerRegistreDePropriete<symbol>();
    let etat = etatInitial();

    const individuel = demarrerMarquerLue(etat, "1", registre);
    etat = individuel.etat;
    const global = demarrerToutMarquerLu(etat, registre);
    etat = global.etat;

    const resultatGlobal = annulerApresEchec(etat, global.idsReclames, global.jeton, global.resteNonLuesAvant, registre);
    expect(resultatGlobal).not.toBeNull();
    etat = resultatGlobal!;
    expect(etat.notifications.every((n) => !n.lu)).toBe(true);

    // L'individuel échoue ensuite : il ne possède plus "1" (repris puis
    // libéré par le rollback global) — rien à annuler une seconde fois.
    const resultatIndividuel = annulerApresEchec(etat, individuel.idsReclames, individuel.jeton, individuel.resteNonLuesAvant, registre);
    expect(resultatIndividuel).toBeNull();

    expect(etat.notifications.every((n) => !n.lu)).toBe(true);
    expect(compterNonLues(etat)).toBe(2);
  });

  it("5) deux appels individuels sur le même identifiant : le second ne déclenche aucune action", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const etat = etatInitial();

    const premier = demarrerMarquerLue(etat, "1", registre);
    expect(premier.aDemarre).toBe(true);

    // Le second appel lit l'état DÉJÀ optimiste du premier (comme le ferait
    // `etatRef.current` en production) — "1" y est déjà lu.
    const second = demarrerMarquerLue(premier.etat, "1", registre);
    expect(second.aDemarre).toBe(false); // rien à faire : pas de requête réseau, pas de réclamation

    // Si le premier échoue ensuite, il possède toujours "1" (jamais repris) :
    const resultat = annulerApresEchec(premier.etat, premier.idsReclames, premier.jeton, premier.resteNonLuesAvant, registre);
    expect(resultat).not.toBeNull();
    expect(resultat!.notifications.find((n) => n.id === "1")?.lu).toBe(false);
  });

  it("6) compteur global (120) très supérieur au nombre de notifications chargées (2) : restauré fidèlement, pas à 2", () => {
    const registre = creerRegistreDePropriete<symbol>();
    // 120 non lues au total côté serveur, mais seules 2 sont chargées localement.
    let etat: EtatNotifications<Notif> = {
      notifications: [
        { id: "1", lu: false, titre: "A" },
        { id: "2", lu: false, titre: "B" },
      ],
      resteNonLues: 118, // 120 - 2 chargées
    };
    expect(compterNonLues(etat)).toBe(120);

    const global = demarrerToutMarquerLu(etat, registre);
    etat = global.etat;
    expect(compterNonLues(etat)).toBe(0); // tout optimistiquement lu, chargé ou non

    const resultat = annulerApresEchec(etat, global.idsReclames, global.jeton, global.resteNonLuesAvant, registre);
    expect(resultat).not.toBeNull();
    etat = resultat!;

    // Exigence explicite de la revue : revient à 120, pas à 2.
    expect(compterNonLues(etat)).toBe(120);
    expect(etat.resteNonLues).toBe(118);
    expect(etat.notifications.every((n) => !n.lu)).toBe(true);
  });

  it("7a) notification Socket.io reçue pendant une réussite : conservée telle quelle, comptée en plus", () => {
    const registre = creerRegistreDePropriete<symbol>();
    let etat = etatInitial();

    const global = demarrerToutMarquerLu(etat, registre);
    etat = global.etat; // "1" et "2" lus, resteNonLues 0 → compterNonLues = 0

    // Une notification "3" arrive PENDANT l'appel réseau (avant sa résolution).
    etat = { notifications: [{ id: "3", lu: false, titre: "Nouvelle" }, ...etat.notifications], resteNonLues: etat.resteNonLues };
    expect(compterNonLues(etat)).toBe(1); // uniquement la nouvelle arrivée

    etat = confirmerSucces(etat, global.idsReclames, registre);

    expect(etat.notifications.find((n) => n.id === "3")).toBeTruthy();
    expect(etat.notifications.find((n) => n.id === "3")?.lu).toBe(false); // jamais touchée par la confirmation du global
    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(true);
    expect(compterNonLues(etat)).toBe(1); // toujours uniquement la nouvelle arrivée
  });

  it("7b) notification Socket.io reçue pendant un rollback : conservée telle quelle, comptée en plus", () => {
    const registre = creerRegistreDePropriete<symbol>();
    let etat = etatInitial();

    const global = demarrerToutMarquerLu(etat, registre);
    etat = global.etat;

    // Une notification "3" arrive PENDANT l'appel réseau, qui échoue ensuite.
    etat = { notifications: [{ id: "3", lu: false, titre: "Nouvelle" }, ...etat.notifications], resteNonLues: etat.resteNonLues };

    const resultat = annulerApresEchec(etat, global.idsReclames, global.jeton, global.resteNonLuesAvant, registre);
    expect(resultat).not.toBeNull();
    etat = resultat!;

    // "1" et "2" restaurés à non lu (le global les avait marqués lus) ; "3"
    // n'a jamais été touché par le rollback (il n'en faisait pas partie).
    expect(etat.notifications.find((n) => n.id === "1")?.lu).toBe(false);
    expect(etat.notifications.find((n) => n.id === "2")?.lu).toBe(false);
    expect(etat.notifications.find((n) => n.id === "3")?.lu).toBe(false);
    expect(compterNonLues(etat)).toBe(3); // les 2 restaurées + la nouvelle arrivée, aucune perdue ni comptée en double
  });

  it("le reste non chargé (ID_RESTE_NON_CHARGE) n'est jamais réclamé par une action individuelle", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const etat: EtatNotifications<Notif> = { notifications: [{ id: "1", lu: false, titre: "A" }], resteNonLues: 50 };

    const individuel = demarrerMarquerLue(etat, "1", registre);
    expect(individuel.idsReclames).not.toContain(ID_RESTE_NON_CHARGE);
  });
});
