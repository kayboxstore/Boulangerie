import { describe, expect, it } from "vitest";
import {
  annulerLectureCiblee,
  creerRegistreDePropriete,
  marquerIdCommeLu,
  marquerTousCommeLus,
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
    // Une notification "4" arrive via Socket.io PENDANT l'appel réseau —
    // un rollback par remplacement complet du tableau l'aurait fait disparaître.
    const avecArriveeConcurrente: Notif[] = [{ id: "4", lu: false, titre: "Nouvelle" }, ...apresOptimiste];

    const resultat = annulerLectureCiblee(avecArriveeConcurrente, ["1"]);

    expect(resultat.find((n) => n.id === "1")?.lu).toBe(false); // rollback appliqué
    expect(resultat.find((n) => n.id === "4")).toBeTruthy(); // arrivée concurrente préservée
  });

  it("ne touche pas un identifiant déjà non lu (rollback déjà effectif ou jamais appliqué)", () => {
    const resultat = annulerLectureCiblee(jeu, ["1"]); // "1" est déjà lu:false dans le jeu de base
    expect(resultat).toEqual(jeu);
  });

  it("liste vide = aucune modification", () => {
    expect(annulerLectureCiblee(jeu, [])).toEqual(jeu);
  });
});

describe("creerRegistreDePropriete — scénarios de concurrence simulés", () => {
  it("un rollback n'agit que sur ce qu'il possède encore", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jetonA = Symbol("marquerLue-1");
    registre.reclamer(["1"], jetonA);

    // Rien d'autre n'a repris la main : le rollback peut s'appliquer.
    expect(registre.idsEncorePossedesPar(["1"], jetonA)).toEqual(["1"]);
  });

  it("toutMarquerLu qui démarre après retire la propriété d'un marquerLue en vol pour le même id", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jetonMarquerLue = Symbol("marquerLue-1");
    registre.reclamer(["1"], jetonMarquerLue);

    // toutMarquerLu se déclenche entre-temps et reprend la propriété de "1"
    // (parmi d'autres identifiants) avec son propre jeton.
    const jetonToutMarquerLu = Symbol("toutMarquerLu");
    registre.reclamer(["1", "2", "3"], jetonToutMarquerLu);

    // Si marquerLue("1") échoue maintenant, il ne doit plus rien annuler :
    // toutMarquerLu a pris le relais entre-temps.
    expect(registre.idsEncorePossedesPar(["1"], jetonMarquerLue)).toEqual([]);
    // toutMarquerLu, lui, possède toujours "1" au moment de son propre échec éventuel.
    expect(registre.idsEncorePossedesPar(["1", "2", "3"], jetonToutMarquerLu)).toEqual(["1", "2", "3"]);
  });

  it("un second marquerLue sur le même id après succès du premier ne peut plus rien annuler", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jeton1 = Symbol("appel-1");
    registre.reclamer(["5"], jeton1);
    // Le premier appel réussit et libère sa propriété.
    registre.liberer(["5"], jeton1);

    const jeton2 = Symbol("appel-2");
    registre.reclamer(["5"], jeton2);

    // Le premier jeton, désormais périmé, ne possède plus rien.
    expect(registre.idsEncorePossedesPar(["5"], jeton1)).toEqual([]);
    // Le second est bien le propriétaire courant.
    expect(registre.idsEncorePossedesPar(["5"], jeton2)).toEqual(["5"]);
  });

  it("libérer() ne retire que la propriété du jeton correspondant, jamais celle d'un autre", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jetonA = Symbol("A");
    const jetonB = Symbol("B");
    registre.reclamer(["1"], jetonA);
    registre.reclamer(["1"], jetonB); // B a repris "1"

    registre.liberer(["1"], jetonA); // A tente de libérer ce qu'il ne possède plus

    expect(registre.idsEncorePossedesPar(["1"], jetonB)).toEqual(["1"]); // B garde la main
  });

  it("plusieurs identifiants indépendants ne s'influencent pas entre eux", () => {
    const registre = creerRegistreDePropriete<symbol>();
    const jetonToutMarquerLu = Symbol("toutMarquerLu");
    registre.reclamer(["1", "2"], jetonToutMarquerLu);

    const jetonMarquerLueSeul = Symbol("marquerLue-3");
    registre.reclamer(["3"], jetonMarquerLueSeul);

    expect(registre.idsEncorePossedesPar(["1", "2"], jetonToutMarquerLu)).toEqual(["1", "2"]);
    expect(registre.idsEncorePossedesPar(["3"], jetonMarquerLueSeul)).toEqual(["3"]);
  });
});
