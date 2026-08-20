# Volume 11j — Caisse

**Niveau de risque : 1 — Critique.** Traitement exhaustif. Ce chapitre réutilise directement `calculerDepenseFarine`, déjà expliquée avec exemple chiffré au Volume 11a, et referme la boucle commencée aux volumes 11h (Commandes) et 11i (Commissions) : le registre de Caisse est la troisième et dernière vue qui recombine les mêmes données de commandes, sous un angle différent — celui de la trésorerie du jour plutôt que du client ou de la commission.

## Fiche d'identité des fichiers couverts

> **Mise à jour du 19/08/2026** : ce chapitre décrivait la version de `caisse.ts` d'avant le Lot 6 (330 lignes, aucune notion de session ni de clôture réelle — voir la citation de la spec, désormais obsolète, qui ouvrait le §5.1 d'origine). Le fichier a depuis grossi de 330 à 958 lignes : Lot 6 y a ajouté les sessions de caisse, la clôture réelle et les règlements déclaré/confirmé (`docs/spec-boulangerie.md`, section 3.1, points 4 et 5) ; deux corrections plus récentes (bug terrain du 19/08 : discipline chronologique étendue à toute écriture ; plan d'audit du même jour : verrou optimiste sur la clôture) s'y ajoutent. Cette révision du chapitre documente le fichier **tel qu'il est aujourd'hui**, en conservant tout ce qui reste exact de la rédaction d'origine (§5.3 à §5.6 ci-dessous, sur le registre lui-même, inchangées dans leur logique).

| Fichier | Lignes | Rôle |
|---|---:|---|
| `apps/api/src/routes/caisse.ts` | 958 | Registre journalier, taux du jour, dépenses libres, case « dépense farine », **sessions de caisse (ouverture/clôture/correction), discipline chronologique, remises, règlements déclaré/confirmé** |
| `apps/web/src/pages/Caisse.tsx` | 1290 | Écran du registre : sélecteur de date, tuiles de synthèse, dialogues taux/dépense, **bandeau de session bloquante, dialogues session/remise/confirmation**, export (`BarreExport`, Lot 7 pt 4 — hors périmètre de ce chapitre) |

- **Qui les appelle** : `caisseRouter` est monté sur `/api/caisse` dans `app.ts` ; `CaissePage` est affichée par la route `/caisse` de `App.tsx`, réservée en écriture au Caissier(ère), lecture seule pour le DG et les autres rôles y ayant accès.
- **Ce qu'ils appellent** : `calculerDepenseFarine` et `calculerCommande` (Volume 11a) ; `busEvenements.emettreEvenement` (Volume 12) ; `executerEcritureIdempotente`/`ajouterEnteteRejeu` de `apps/api/src/lib/idempotence.ts` (148 lignes — mécanisme d'idempotence serveur, pas encore couvert par un chapitre dédié dans ce livre, voir la note du §5.10) ; `jourLomoto`/`dateSQLDepuisJourLomoto`/`bornesJourLomoto` de `apps/api/src/lib/temps.ts` (46 lignes — mêmes remarques, voir §5.2 ci-dessous) ; en lecture, `prisma.commandeClient`, `prisma.paiementCommande` et `prisma.production` (module Production, hors périmètre de ce chapitre) pour reconstituer le registre.
- **Données modifiées** : `TauxDuJour` (création/mise à jour), `DepenseCaisse` (création/suppression), et depuis le Lot 6 : `SessionCaisse` (création à l'ouverture, mise à jour à la clôture et à la correction), `RemiseCaisse` (création). **Toujours aucune écriture directe** sur `CommandeClient` en dehors de `POST /sessions/:id/confirmer-reglements` (§5.13, la seule route de ce fichier qui modifie une commande) ; le registre lui-même reste un calcul en lecture seule sur `CommandeClient`/`PaiementCommande`.

## 5.1 Vue d'ensemble intuitive — un calcul quotidien, désormais verrouillable

> La Caisse devient un **registre journalier** : ce qui est entré, ce qui est sorti, ce qui reste. [...] **Session de caisse, remise contradictoire et clôture** (Lot 6 — correction de l'écart P0-02 : la Caisse dispose désormais d'une clôture réelle, nominative et non falsifiable).
> — `docs/spec-boulangerie.md`, section 3.1 (points 2 et 5)

**Correction de ce chapitre** : la citation d'origine ci-dessus s'arrêtait à *« il n'y a pas d'action de clôture »* — exacte au moment où ce chapitre a été rédigé, mais rendue obsolète par le Lot 6, qui a ajouté une action de clôture réelle. Le principe de fond reste néanmoins intact et vaut la peine d'être gardé : il n'existe, dans `prisma/schema.prisma`, **aucun modèle « Registre »**. Pour une date donnée, le **registre** (Entrées/Dettes payées/Dépenses/Solde) est toujours **entièrement recalculé à chaque lecture** à partir de trois sources — commandes du jour, règlements du jour, dépenses du jour — exactement la même philosophie que le module Commissions (Volume 11i). Ce qui a changé, c'est qu'une **`SessionCaisse`**, elle, **est** un objet figé une fois clôturée : elle capture une photographie du registre du jour (`soldeTheoriqueFermeture`) au moment de la clôture, avec le solde réellement compté et l'écart entre les deux — pas un calcul recommencé à chaque lecture comme le registre lui-même. Le registre reste un calcul ; la session de caisse qui l'enveloppe, elle, se fige. Quatre tables sont désormais en écriture directe dans ce module : `TauxDuJour` et `DepenseCaisse` (entrées manuelles du registre, comme avant), et `SessionCaisse`/`RemiseCaisse` (Lot 6, détaillées à partir du §5.10).

## 5.2 Bornage de date — désormais centralisé dans `lib/temps.ts` (fuseau Kinshasa)

```ts
import { bornesJourLomoto, dateSQLDepuisJourLomoto, jourLomoto } from "../lib/temps.js";
```

**Correction de ce chapitre** : la version d'origine décrivait deux fonctions **locales** à `caisse.ts` (`bornesLocales`, `dateSQL`), utilisant l'heure du serveur. Ce n'est plus le cas : le fichier importe aujourd'hui trois fonctions partagées de `apps/api/src/lib/temps.ts` (46 lignes, **pas encore couvert par un chapitre dédié dans ce livre** — voir la note de fin de section), qui fixent explicitement le calcul sur le fuseau **`Africa/Kinshasa`** plutôt que sur l'heure du serveur (potentiellement différente selon l'hébergeur). Le principe reste le même que dans la version d'origine — deux techniques pour deux types de colonnes Prisma — mais la source de vérité a changé :

- **`dateSQLDepuisJourLomoto(iso)`** construit l'instant à stocker pour les colonnes `@db.Date` (`TauxDuJour.date`, `DepenseCaisse.date`, `SessionCaisse.date`) — équivalent fonctionnel de l'ancien `dateSQL`.
- **`bornesJourLomoto(iso)`** construit les deux extrémités du jour civil de Kinshasa (pas de l'heure du serveur) pour borner les colonnes `DateTime` classiques (`CommandeClient.dateCreation`, `PaiementCommande.date`) — équivalent fonctionnel de l'ancien `bornesLocales`, mais insensible au fuseau de la machine qui exécute le serveur.
- **`jourLomoto(date?)`** convertit une `Date` JavaScript en chaîne `AAAA-MM-JJ` du jour civil de Kinshasa — utilisée aussi bien pour lire (`jourLomoto()` sans argument = aujourd'hui à Kinshasa, remplace l'ancien `aujourdhui()`) que pour formater une date déjà stockée dans les réponses JSON (`versTauxDTO`, `versSessionDTO`...).

Ce n'est toujours pas une incohérence : ce sont deux techniques pour deux types de colonnes, désormais centralisées pour être réutilisées par tous les modules qui ont besoin du même fuseau (Production, Rapports...) — plutôt que chaque route ne réimplémente sa propre notion de « jour ». `dateISOSchema.safeParse(date)` (schéma partagé, `packages/shared/src/index.ts`) sécurise le paramètre `?date=` reçu en `query string` — une date absente ou invalide retombe systématiquement sur `jourLomoto()`.

*Note* : `apps/api/src/lib/temps.ts` et `apps/api/src/lib/idempotence.ts` (mentionné au §5.10) sont deux fichiers d'infrastructure transversale, utilisés par plusieurs modules au-delà de la Caisse — aucun des deux n'a encore de chapitre propre dans ce livre. Signalé dans `ETAT_DE_PROGRESSION.md` comme un manque à combler, plutôt que traité superficiellement ici.

## 5.3 `construireRegistre` — le cœur du chapitre

```ts
async function construireRegistre(date: string): Promise<RegistreCaisseDTO> {
  const [debut, fin] = bornesJourLomoto(date);

  const commandesDuJour = await prisma.commandeClient.findMany({
    where: { dateCreation: { gte: debut, lte: fin } },
    select: { montantRecu: true, reglements: { where: { statut: "CONFIRME" }, select: { montant: true } } },
  });
  const entrees = commandesDuJour.reduce((somme, c) => {
    const verseALaCreation = c.montantRecu - c.reglements.reduce((s, r) => s + r.montant, 0);
    return somme + Math.max(0, verseALaCreation);
  }, 0);

  const reglementsDuJour = await prisma.paiementCommande.findMany({
    where: { date: { gte: debut, lte: fin }, statut: "CONFIRME" },
    include: { commandeClient: { select: { numero: true, client: { select: { nom: true } } } } },
    orderBy: { date: "asc" },
  });
  const dettesPayees = reglementsDuJour.reduce((s, r) => s + r.montant, 0);

  const depenses = await prisma.depenseCaisse.findMany({ where: { date: dateSQLDepuisJourLomoto(date) }, include: INCLUDE_DEPENSE, orderBy: { createdAt: "asc" } });
  const totalDepenses = depenses.reduce((s, d) => s + d.montant, 0);

  const taux = await prisma.tauxDuJour.findUnique({ where: { date: dateSQLDepuisJourLomoto(date) }, include: INCLUDE_TAUX });
  const sacsUtilisesJour = await sacsUtilisesLe(date);

  let blocage: BlocageFarine | null = null;
  if (!taux) blocage = "TAUX_MANQUANT";
  else if (sacsUtilisesJour <= 0) blocage = "PRODUCTION_MANQUANTE";

  return {
    date, entrees, dettesPayees,
    detailDettesPayees: reglementsDuJour.map((r) => ({ id: r.id, clientNom: r.commandeClient.client.nom, commandeNumero: r.commandeClient.numero, montant: r.montant, date: r.date.toISOString() })),
    depenses: depenses.map(versDepenseDTO), totalDepenses,
    solde: entrees + dettesPayees - totalDepenses,
    taux: taux ? versTauxDTO(taux) : null,
    sacsUtilisesJour,
    farine: { active: depenses.some((d) => d.origine === "FARINE"), blocage, montantEstime: blocage ? null : calculerDepenseFarine(taux!.valeur.toNumber(), sacsUtilisesJour) },
  };
}
```

**Correction de ce chapitre — troisième filtre ajouté par le Lot 6** : la version d'origine de cette fonction n'excluait aucun règlement par statut ; elle a depuis gagné un `where: { statut: "CONFIRME" }` sur les deux requêtes qui touchent `PaiementCommande` (directement, et via `commandeClient.reglements`). Raison : le Lot 6 introduit la distinction **DECLARE / CONFIRME** (§5.13) — un règlement déclaré par le Chargé des commandes n'est **pas encore vérifié** par la Caisse, donc pas encore un fait de trésorerie établi. Sans ce filtre, un règlement encore DECLARE apparaîtrait dans le registre alors qu'aucun argent n'a été physiquement compté et remis à la Caisse — c'est exactement l'écart terrain (P0-07, « argent transporté confondu avec règlement officiel ») que le Lot 6 corrige.

### Le point le plus important du chapitre : entrées et dettes payées sont disjointes par construction

Le commentaire du code, juste avant cette fonction, l'annonce sans détour : *« Les deux postes automatiques sont DISJOINTS par construction, pour qu'aucun franc ne soit compté deux fois »*. Le problème qu'ils résolvent : `CommandeClient.montantRecu` (Volume 11h) est un champ **cumulatif** — il inclut non seulement ce qui a été versé à la création de la commande, mais aussi tous les règlements **CONFIRME** ultérieurs sur cette même commande (chaque confirmation via `POST /sessions/:id/confirmer-reglements`, §5.13, l'incrémente — pas la déclaration elle-même, Volume 11h §5.9). Si le registre additionnait naïvement `montantRecu` de chaque commande du jour **et** la somme des règlements confirmés du jour, un règlement confirmé le jour même de la création de sa commande serait compté **deux fois** — une fois dans « Entrées », une fois dans « Dettes payées ».

La solution : pour chaque commande créée aujourd'hui, `entrees` ne retient que `montantRecu − (somme de ses propres règlements CONFIRME)` — c'est-à-dire l'argent **réellement versé au moment précis de la création**, avec ses règlements confirmés ultérieurs soustraits pour ne pas les compter ici. `Math.max(0, verseALaCreation)` protège contre un résultat négatif — impossible en théorie (un règlement ne peut jamais dépasser ce qui a été reçu, il ne fait qu'ajouter au montant reçu), mais la protection reste posée par précaution. `dettesPayees`, de son côté, prend **tous** les règlements **CONFIRME** datés d'aujourd'hui, sans aucune exclusion — y compris ceux qui portent sur une commande créée aujourd'hui même. Le résultat : la part « à la création » d'une commande atterrit dans `entrees`, sa part « confirmée après coup » (même le jour même) atterrit dans `dettesPayees` — jamais les deux à la fois pour le même franc, et jamais un franc encore seulement DECLARE.

**Exemple chiffré** : une commande créée aujourd'hui pour 50 000 Fc, avec 30 000 Fc reçus à la création, puis un règlement de 20 000 Fc **déclaré puis confirmé** plus tard dans la même journée (§5.13 — tant qu'il reste DECLARE, il n'entre dans aucun des deux postes). `montantRecu` vaut, une fois ce règlement confirmé, `50000` (30 000 + 20 000, cumulé sur la commande). Pour cette commande : `verseALaCreation = 50000 − 20000 = 30000` (le règlement confirmé de 20 000 Fc est soustrait) — donc `entrees` reçoit `30000`. Le règlement de 20 000 Fc, lui, apparaît séparément dans `reglementsDuJour`, donc dans `dettesPayees`. Total pour cette commande sur le registre du jour : `30000 + 20000 = 50000`, exactement ce qui a réellement été vérifié — jamais 70 000, jamais 30 000, et rien tant que le règlement reste seulement déclaré.

### Le solde et la ligne farine

`solde: entrees + dettesPayees − totalDepenses`, exactement la formule de la spec. Le **blocage de la case farine** est calculé en deux temps successifs (`if / else if`, pas deux conditions indépendantes) : d'abord l'absence de taux du jour (`TAUX_MANQUANT`), puis seulement si un taux existe, l'absence de production enregistrée (`sacsUtilisesJour <= 0`, `PRODUCTION_MANQUANTE`) — un seul des deux blocages est jamais renvoyé à la fois, celui qui bloque en premier dans cet ordre de priorité. `montantEstime` n'est calculé (via `calculerDepenseFarine`, Volume 11a) que si **aucun** blocage n'est actif — sinon il vaut `null`, cohérent avec le commentaire du code : *« indisponible tant qu'il manque le taux ou la production du jour — on l'explique plutôt que de calculer sur une valeur absente ou un zéro trompeur »*. Un « zéro trompeur » aurait été le cas si le code avait renvoyé `0` en l'absence de sacs utilisés (`0` sacs → `0` Fc, arithmétiquement correct mais visuellement indiscernable d'une vraie dépense nulle) — le champ `blocage`, en donnant une **raison explicite**, évite cette ambiguïté à l'écran.

## 5.4 `sacsUtilisesLe` — le pont avec le module Production

```ts
async function sacsUtilisesLe(date: string): Promise<number> {
  const [debut, fin] = bornesJourLomoto(date);
  const agg = await prisma.production.aggregate({ where: { date: { gte: debut, lte: fin } }, _sum: { sacsUtilises: true } });
  return agg._sum.sacsUtilises?.toNumber() ?? 0;
}
```

Une agrégation Prisma (`_sum`) sur le modèle `Production` (module Production, hors périmètre de ce chapitre — un `Decimal` en base, converti en nombre JavaScript via `.toNumber()`) : la somme des sacs de farine réellement utilisés en production, toutes les sessions de production enregistrées ce jour-là confondues (`agg._sum.sacsUtilises` peut être `null` si aucune ligne ne correspond, d'où le repli `?? 0`). C'est la seule dépendance de ce chapitre vers un module non encore traité dans ce livre — une dépendance **en lecture seule**, la Caisse ne modifie jamais rien dans Production.

## 5.5 `GET /registre`, `PUT /taux`, dépenses (`POST`/`DELETE`), case farine (`PUT`)

```ts
caisseRouter.get("/registre", lecture, async (req, res, next) => {
  const { date } = req.query as Record<string, string | undefined>;
  const cible = estDateValide(date) ? date : aujourdhui();
  res.json({ registre: await construireRegistre(cible) });
});
```

La route la plus simple du fichier : elle ne fait que déléguer à `construireRegistre` (§5.3), après avoir validé ou substitué la date. Aucune autre logique.

```ts
caisseRouter.put("/taux", ecriture, async (req, res, next) => {
  const parsed = tauxDuJourSchema.safeParse(req.body);
  ...
  if (await sessionFermeePourDate(date)) {
    return res.status(409).json({ erreur: "La session de caisse de cette date est clôturée : plus aucune écriture possible" });
  }
  const anterieure = await sessionAnterieureOuverteAvant(date);
  if (anterieure) return res.status(409).json(erreurSessionAnterieure(anterieure));

  const taux = await prisma.$transaction(async (tx) => {
    const existant = await tx.tauxDuJour.findUnique({ where: { date: dateSQLDepuisJourLomoto(date) } });
    if (existant) return tx.tauxDuJour.update({ where: { id: existant.id }, data: { valeur, definiParId: req.utilisateur!.id }, include: INCLUDE_TAUX });
    return tx.tauxDuJour.create({ data: { date: dateSQLDepuisJourLomoto(date), valeur, definiParId: req.utilisateur!.id }, include: INCLUDE_TAUX });
  });
  ...
});
```

`TauxDuJour.date` est déclaré `@unique` dans le schéma — une seule valeur possible par date. La route l'exploite directement en « upsert manuel » (chercher, puis créer ou mettre à jour selon le résultat) plutôt que d'utiliser `prisma.tauxDuJour.upsert()` (l'opérateur natif de Prisma pour ce même motif, déjà rencontré ailleurs — par exemple dans `MODIFIER_PERMISSIONS_ROLE`, Volume 11f). Les deux approches produisent le même résultat ici ; le commentaire du code (*« un second envoi sur la même date met à jour la valeur »*) confirme l'intention : redéfinir le taux d'un jour déjà renseigné n'est pas une erreur, c'est un cas normal, explicitement pris en charge, et **tracé** par le Journal d'audit (Volume 11g) comme n'importe quelle autre modification.

**Ajout du Lot 6, présent sur les deux lignes qui précèdent le `$transaction`** — et systématiquement répété à l'identique en tête de **chaque** route d'écriture de ce fichier depuis les deux corrections du 19/08/2026 (§5.11) : `sessionFermeePourDate` bloque toute écriture sur le registre d'une date déjà **clôturée** (`SessionCaisse.statut === "FERMEE"` pour cette date précise) ; `sessionAnterieureOuverteAvant` bloque toute écriture tant qu'une session **antérieure** est restée ouverte, quelle que soit la date visée par l'écriture elle-même — la discipline chronologique détaillée au §5.11. Cette dernière garde n'existait pas du tout à l'écriture d'origine de ce chapitre (elle ne couvrait alors que l'ouverture d'une nouvelle session, §5.10) ; elle a été étendue à `PUT /taux` (ici), `POST`/`DELETE /depenses`, `PUT /depenses/farine`, `POST /sessions/:id/remises` et `POST /sessions/:id/confirmer-reglements` — soit toutes les routes d'écriture de ce fichier sauf `POST /sessions/:id/cloturer` (l'unique porte de sortie, qui doit rester atteignable même quand elle est elle-même la session bloquante) et `POST /sessions/:id/corriger` (qui porte sur une session déjà fermée, donc orthogonale à cette discipline).

```ts
caisseRouter.post("/depenses", ecriture, async (req, res, next) => {
  const parsed = depenseCreateSchema.safeParse(req.body);
  ...
  // mêmes gardes sessionFermeePourDate / sessionAnterieureOuverteAvant qu'en §5.5
  const execution = await executerEcritureIdempotente(
    req, "POST:/api/caisse/depenses", parsed.data,
    async (tx) => tx.depenseCaisse.create({ data: { date: dateSQLDepuisJourLomoto(date), motif, montant, origine: "MANUELLE", enregistreParId: req.utilisateur!.id }, include: INCLUDE_DEPENSE }),
    (depense) => ({ statutHttp: 201, corps: { depense: versDepenseDTO(depense) } }),
  );
  ...
  res.status(execution.statutHttp).json(execution.corps);
});

caisseRouter.delete("/depenses/:id", ecriture, async (req, res, next) => {
  const depense = await prisma.depenseCaisse.findUnique({ where: { id: req.params.id } });
  if (!depense) return res.status(404).json({ erreur: "Dépense introuvable" });
  // mêmes gardes, calculées sur jourLomoto(depense.date) — la date de LA DÉPENSE, pas d'aujourd'hui
  await prisma.depenseCaisse.delete({ where: { id: depense.id } });
  ...
  res.status(204).end();
});
```

Une dépense manuelle (`origine: "MANUELLE"`, l'une des deux valeurs de l'énumération `OrigineDepense`, §5.1 du schéma) : motif libre, montant entier positif. Les conventions déjà rencontrées à de nombreuses reprises dans ce livre restent valables (validation Zod, `404` si introuvable, `204` sur suppression réussie, notification temps réel après coup). **Deux ajouts depuis la rédaction d'origine de ce chapitre** : (1) les mêmes gardes de discipline chronologique qu'au §5.5, avec une nuance sur `DELETE` — la date testée est celle **de la dépense elle-même** (`jourLomoto(depense.date)`), pas la date du jour où la suppression est demandée, pour rester cohérent même si un Admin consulte une dépense ancienne ; (2) `POST /depenses` est désormais enveloppée dans `executerEcritureIdempotente` (`lib/idempotence.ts`) — un double-clic ou un retry réseau avec la même `Idempotency-Key` rejoue la même réponse plutôt que de créer une seconde dépense identique. `DELETE /depenses/:id`, elle, n'a pas besoin de ce mécanisme : une suppression est déjà idempotente par nature (répéter la même suppression sur un enregistrement déjà supprimé retombe simplement sur le `404`).

```ts
caisseRouter.put("/depenses/farine", ecriture, async (req, res, next) => {
  const parsed = depenseFarineSchema.safeParse(req.body);
  ...
  const { date, active } = parsed.data;
  // mêmes gardes sessionFermeePourDate / sessionAnterieureOuverteAvant qu'en §5.5
  const existante = await prisma.depenseCaisse.findFirst({ where: { date: dateSQLDepuisJourLomoto(date), origine: "FARINE" } });

  if (!active) {
    if (existante) await prisma.depenseCaisse.delete({ where: { id: existante.id } });
    return res.json({ registre: await construireRegistre(date) });
  }
  if (existante) return res.status(409).json({ erreur: "La dépense farine est déjà enregistrée pour cette date" });

  const taux = await prisma.tauxDuJour.findUnique({ where: { date: dateSQLDepuisJourLomoto(date) } });
  if (!taux) return res.status(409).json({ erreur: "Définissez d'abord le taux du jour pour cette date" });
  const sacs = await sacsUtilisesLe(date);
  if (sacs <= 0) return res.status(409).json({ erreur: "Aucune production enregistrée pour cette date : le nombre de sacs utilisés est inconnu" });

  const valeurTaux = taux.valeur.toNumber();
  const depense = await prisma.depenseCaisse.create({
    data: { date: dateSQLDepuisJourLomoto(date), motif: MOTIF_DEPENSE_FARINE, montant: calculerDepenseFarine(valeurTaux, sacs), origine: "FARINE", tauxApplique: valeurTaux, sacsUtilises: sacs, enregistreParId: req.utilisateur!.id },
    include: INCLUDE_DEPENSE,
  });
  ...
  res.status(201).json({ registre: await construireRegistre(date) });
});
```

Cette route traite « cocher » et « décocher » la case farine comme **une seule et même opération**, pilotée par un booléen `active` — pas deux routes séparées. **Décocher** (`active: false`) est trivial : si une ligne farine existe pour cette date, elle est supprimée, sans aucune condition supplémentaire — on peut toujours retirer une ligne farine déjà posée, même si les conditions qui avaient permis de la créer ont depuis changé (ex. la production du jour a été supprimée après coup). **Cocher** (`active: true`) est gardé par trois vérifications successives : (1) pas de doublon (`409` si une ligne farine existe déjà pour cette date — cohérent avec le fait que l'écran affiche une simple case à cocher, pas un formulaire répétable) ; (2) un taux du jour doit exister (`409` sinon, avec un message qui guide directement vers l'action à faire) ; (3) au moins un sac doit avoir été utilisé en production ce jour-là (`409` sinon, avec un message qui explique pourquoi plutôt que de laisser deviner). Seulement alors, `calculerDepenseFarine` (Volume 11a) est appelé et son résultat stocké — avec, en plus du montant, les **entrées du calcul elles-mêmes** (`tauxApplique`, `sacsUtilises`) recopiées sur la ligne de dépense créée, pour que cette ligne reste **vérifiable après coup**, y compris si le taux du jour était modifié plus tard (§5.6, `PUT /taux` autorise cette modification) — la ligne farine déjà enregistrée garde la valeur du taux **au moment où elle a été calculée**, jamais recalculée rétroactivement.

Notez que les deux branches (cocher et décocher) renvoient `{ registre: ... }`, le registre complet reconstruit — pas seulement la dépense créée/supprimée comme le font `POST /depenses` et `DELETE /depenses/:id` — pratique pour le client (§5.6), qui peut directement rafraîchir tout l'écran avec la réponse de cette seule requête plutôt que d'en émettre une seconde.

## 5.6 Côté client — `CaissePage`

```tsx
const blocage: BlocageFarine | null = registre.farine.blocage;
const caseFarineDesactivee = !editable || (!registre.farine.active && blocage !== null);
```

La case à cocher est désactivée dans deux cas distincts, combinés par un `||` : l'utilisateur n'a pas l'écriture sur `CAISSE` (`!editable`), **ou** la case n'est pas encore active et un blocage existe. Cette seconde condition mérite d'être lue attentivement : elle ne désactive **jamais** la case si elle est déjà active (`registre.farine.active === true`), même si `blocage` n'est pas `null` — cohérent avec la route serveur (§5.5) : décocher une ligne farine déjà posée reste toujours possible, seule la création d'une nouvelle ligne est bloquée par l'absence de taux ou de production.

**Tuile `Poste`** — le composant qui affiche chaque montant du registre (Entrées, Dettes payées, Dépenses, Solde) porte une prop `alerteSiNegatif`, utilisée uniquement pour le Solde : si son montant est négatif, la tuile bascule sur une mise en forme dédiée — bordure et texte en `rouge-alerte` (une couleur explicitement hors palette de marque habituelle du projet, Volume 9), poids de police renforcé (`font-extrabold`), et une ligne de texte d'avertissement supplémentaire. Correspond exactement à la spec : *« affiché en gras et en rouge vif [...] pour qu'il saute aux yeux »*.

L'estimation affichée à côté de la case farine réutilise, comme au Volume 11h pour `calculerCommande`, directement `calculerDepenseFarine` importée du paquet partagé :

```tsx
registre.farine.montantEstime ?? (registre.taux ? calculerDepenseFarine(registre.taux.valeur, registre.sacsUtilisesJour) : null)
```

Un repli à deux niveaux : si le serveur a déjà fourni `montantEstime` (cas normal, aucun blocage — §5.3), on l'utilise tel quel ; sinon, si un taux existe malgré tout (utile pour un état transitoire d'affichage), le client recalcule lui-même l'estimation avec la même fonction pure, plutôt que de laisser un vide. `basculerFarine`, `enregistrerTaux`, `ajouterDepense` et `supprimerDepense` sont quatre mutations TanStack Query suivant exactement le même schéma déjà vu à de nombreuses reprises dans ce livre (dialogue local, erreur affichée dans le formulaire pour une création, `toastErreur` global pour une suppression) — non détaillées ligne à ligne ici pour éviter de répéter un motif déjà exhaustivement couvert.

## 5.10 Session de caisse — ouverture

```ts
caisseRouter.post("/sessions", ecriture, async (req, res, next) => {
  const execution = await executerEcritureIdempotente(req, "POST:/api/caisse/sessions", parsed.data,
    async (tx) => {
      const existante = await tx.sessionCaisse.findUnique({ where: { date: dateSQLDepuisJourLomoto(date) } });
      if (existante) return { type: "existante" as const };
      const anterieureOuverte = await tx.sessionCaisse.findFirst({
        where: { statut: "OUVERTE", date: { lt: dateSQLDepuisJourLomoto(date) } }, orderBy: { date: "asc" },
      });
      if (anterieureOuverte) return { type: "anterieureOuverte" as const, date: jourLomoto(anterieureOuverte.date) };
      const session = await tx.sessionCaisse.create({ data: { date: dateSQLDepuisJourLomoto(date), soldeOuverture, ouverteParId: req.utilisateur!.id }, include: INCLUDE_SESSION });
      return { type: "creee" as const, session };
    },
    (resultat) => { /* 409 si déjà existante ou antérieure ouverte, sinon 201 */ },
  );
  ...
});
```

`SessionCaisse.date` est `@unique` : une session par date, comme `TauxDuJour`. Mais contrairement à `PUT /taux` (upsert, §5.5), tenter d'ouvrir une session sur une date déjà pourvue est un `409` explicite (« Une session de caisse existe déjà pour cette date ») — une session, contrairement au taux, n'est jamais un simple réglage qu'on écrase, c'est un événement métier daté (« le Caissier a ouvert la caisse ce jour-là avec tel solde ») qu'on ne réécrit pas silencieusement. La deuxième vérification, `anterieureOuverte`, est la version *originelle* de la discipline chronologique — présente depuis le Lot 6, avant même la correction bug terrain du §5.11 : on ne peut pas ouvrir la session d'une nouvelle date tant qu'une session plus ancienne reste `OUVERTE`. Toute la logique (recherche + création) tourne dans le callback `executerEcritureIdempotente`, donc dans une transaction unique — une clé `Idempotency-Key` répétée avec le même corps renvoie la même réponse sans réévaluer les conditions une seconde fois.

## 5.11 Discipline chronologique — correction bug terrain du 19/08/2026

```ts
async function sessionFermeePourDate(date: string): Promise<boolean> {
  const session = await prisma.sessionCaisse.findUnique({ where: { date: dateSQLDepuisJourLomoto(date) } });
  return session?.statut === "FERMEE";
}

async function sessionAnterieureOuverteAvant(date: string): Promise<string | null> {
  const anterieure = await prisma.sessionCaisse.findFirst({
    where: { statut: "OUVERTE", date: { lt: dateSQLDepuisJourLomoto(date) } },
    orderBy: { date: "asc" },
  });
  return anterieure ? jourLomoto(anterieure.date) : null;
}
```

**L'anomalie corrigée** : avant cette correction, la règle « impossible d'ouvrir une nouvelle session tant qu'une session antérieure reste ouverte » (§5.10) ne couvrait que l'**ouverture**. Oublier de clôturer un jour laissait toutes les *autres* écritures du module — taux, dépenses, case farine, remise, confirmation de règlement — possibles le lendemain, comme si de rien n'était : un Caissier distrait pouvait continuer indéfiniment sans jamais être forcé de clôturer la veille. `sessionAnterieureOuverteAvant` généralise exactement le même calcul que la vérification faite à l'ouverture, mais appelée désormais en tête de **chaque** route d'écriture de ce fichier (§5.5, §5.12, §5.13) sauf deux, volontairement épargnées : `POST /sessions/:id/cloturer` (§5.14) — l'unique porte de sortie, qui doit rester atteignable même quand la session bloquante est précisément celle qu'on est en train de clôturer — et `POST /sessions/:id/corriger` (§5.15), qui porte sur une session déjà `FERMEE`, donc hors du champ de cette discipline (qui ne concerne que les sessions encore `OUVERTE`).

```ts
caisseRouter.get("/session-bloquante", lecture, async (_req, res, next) => {
  res.json({ date: await sessionAnterieureOuverteAvant(jourLomoto()) });
});
```

**Côté client** — plutôt que de laisser l'utilisateur découvrir le blocage à la première écriture refusée (un `409` après avoir rempli un formulaire), `CaissePage` interroge `GET /session-bloquante` **indépendamment de la date consultée** dès l'ouverture de l'écran (`useQuery`, clé `["session-bloquante"]`, invalidée par `rafraichir()` comme les autres requêtes du module). Si une date est renvoyée, un bandeau d'avertissement (icône `Lock`, couleur `terracotta`) s'affiche en haut de l'écran : *« Caisse non clôturée. La session du {date} est restée ouverte — clôturez-la avant de continuer »*, avec un bouton « Aller à cette date » qui bascule le sélecteur de date sur le jour bloquant (masqué si l'utilisateur consulte déjà cette date) — pour l'amener directement sur l'écran où il peut agir (saisir la remise manquante, puis clôturer) plutôt que de le laisser deviner. C'est la même route qui alimente le bandeau **et** qui sert de garde côté serveur : aucune divergence possible entre ce que l'écran affiche et ce que le serveur autorise réellement.

`sessionFermeePourDate`, elle, existait déjà avant cette correction — c'est la garde « une session déjà `FERMEE` verrouille le registre de sa date » (spec 3.1, point 5), inchangée. Les deux fonctions sont complémentaires et **toujours appelées ensemble** sur les routes qui portent une date explicite (§5.5) : la première protège la date visée elle-même, la seconde protège contre l'oubli d'une date antérieure.

## 5.12 Remise contradictoire

```ts
caisseRouter.post("/sessions/:id/remises", ecriture, async (req, res, next) => {
  const { session, erreur } = await chargerSessionCaisseOuverte(req.params.id);
  if (erreur) return res.status(erreur.status).json({ erreur: erreur.message });
  const anterieure = await sessionAnterieureOuverteAvant(jourLomoto(session!.date));
  if (anterieure) return res.status(409).json(erreurSessionAnterieure(anterieure));
  ...
  const execution = await executerEcritureIdempotente(req, `POST:/api/caisse/sessions/${req.params.id}/remises`, parsed.data,
    async (tx) => tx.remiseCaisse.create({ data: { sessionCaisseId: session!.id, montant, remisParNom, recuParId: req.utilisateur!.id, enregistreParId: req.utilisateur!.id, reference, observation }, include: INCLUDE_REMISE }),
    (remise) => ({ statutHttp: 201, corps: { remise: versRemiseDTO(remise) } }),
  );
  ...
});
```

Un transfert d'espèces documenté : émetteur en texte libre (`remisParNom`, qui peut ne pas avoir de compte applicatif — un livreur, par exemple), receveur (`recuParId`, l'utilisateur connecté), référence et observation facultatives. **Point subtil sur la discipline chronologique** : ici, `sessionAnterieureOuverteAvant` est calculée sur `jourLomoto(session!.date)` — la date de **la session ciblée par l'URL** (`:id`), pas sur la date d'aujourd'hui. Nécessaire pour un cas précis : si la session bloquante est justement celle sur laquelle on ajoute la remise (le Caissier prépare sa clôture en retard), la garde doit laisser passer — on ne peut pas exiger de clôturer une session avant d'avoir pu y enregistrer la remise qui justement permettra de la clôturer correctement. `chargerSessionCaisseOuverte` (§5.14) refuse en amont toute remise sur une session déjà `FERMEE`.

## 5.13 Règlements déclaré / confirmé — la seule route qui modifie une commande

```ts
caisseRouter.post("/sessions/:id/confirmer-reglements", ecriture, async (req, res, next) => {
  ...
  const execution = await executerEcritureIdempotente(req, `POST:/api/caisse/sessions/${req.params.id}/confirmer-reglements`, parsed.data,
    async (tx) => {
      // validation d'abord (tous les paiementCommandeIds doivent être DECLARE), sans écriture
      const remise = await tx.remiseCaisse.create({ data: { sessionCaisseId: session.id, montant: montantTotal, remisParNom, ... } });
      for (const id of ids) {
        const calcul = calculerCommande({ quantiteBacs, prixParBac, avanceExistante, montantRecu: commande.montantRecu + paiement.montant });
        await tx.commandeClient.update({ where: { id: commande.id }, data: { montantRecu: ..., dette: calcul.dette, avanceGeneree: calcul.avanceGeneree, nouvelleAvance: ... } });
        await tx.client.update({ where: { id: commande.clientId }, data: { avanceDisponible: ... } });
        await tx.paiementCommande.update({ where: { id }, data: { statut: "CONFIRME", confirmeLe: new Date(), confirmeParId: req.utilisateur!.id, remiseCaisseId: remise.id } });
      }
    },
  );
});
```

C'est la route la plus dense du module, et **la seule de tout `caisse.ts`** qui écrit sur `CommandeClient`/`Client` (§5.1 rappelle que le registre lui-même reste toujours en lecture seule sur ces tables). Elle referme un cycle amorcé au Volume 11h : `POST /commandes/:id/reglements` **déclare** un règlement (statut `DECLARE`) sans toucher à `montantRecu` ni `dette` — le Chargé des commandes dit avoir reçu de l'argent, mais rien n'est encore vérifié. Ici, la Caisse **confirme** un ou plusieurs règlements DECLARE d'un seul geste : elle crée **une seule** `RemiseCaisse` dont le montant est la somme exacte des règlements sélectionnés (`ids`), puis, pour chacun, rejoue `calculerCommande` (Volume 11a, la même fonction pure qu'à la création de la commande) avec le `montantRecu` mis à jour — exactement le même calcul, jamais une formule ad hoc dupliquée — avant de faire passer son statut à `CONFIRME` et de le rattacher à la remise (`remiseCaisseId`). La validation de tous les `paiementCommandeIds` (chacun doit exister et être encore `DECLARE`) se fait **avant** toute écriture, dans la même transaction : une sélection partiellement invalide ne confirme jamais les autres règlements du lot, elle échoue intégralement (`code: "REGLEMENT_INVALIDE"`).

Note sur la discipline chronologique : cette route calcule `sessionAnterieureOuverteAvant` **avant** d'entrer dans `executerEcritureIdempotente` (contrairement aux autres routes du fichier), à partir d'une lecture légère de la session (`select: { date: true }`) — nécessaire car son idempotence dépend du corps de la requête, indépendant de la session elle-même ; si la session ciblée n'existe pas, ce contrôle préalable est simplement ignoré et l'erreur `404` normale (à l'intérieur de la transaction) prend le relais.

## 5.14 Clôture — le théorique calculé côté serveur, et son verrou optimiste (audit du 19/08/2026)

```ts
caisseRouter.post("/sessions/:id/cloturer", ecriture, async (req, res, next) => {
  const { session, erreur } = await chargerSessionCaisseOuverte(req.params.id);
  ...
  const registre = await construireRegistre(dateStr);
  const soldeTheoriqueFermeture = session!.soldeOuverture + registre.solde;
  const ecartFermeture = soldeCompteFermeture - soldeTheoriqueFermeture;
  if (ecartFermeture !== 0 && !motif) return res.status(400).json({ code: "ECART_NON_MOTIVE", ... });

  const { count } = await prisma.sessionCaisse.updateMany({
    where: { id: session!.id, statut: "OUVERTE" },
    data: { statut: "FERMEE", soldeTheoriqueFermeture, soldeCompteFermeture, ecartFermeture, motifEcart: ..., fermeeLe: new Date(), fermeeParId: req.utilisateur!.id },
  });
  if (count === 0) return res.status(409).json({ erreur: "Cette session vient d'être clôturée ailleurs — rechargez la page" });

  const fermee = await prisma.sessionCaisse.findUniqueOrThrow({ where: { id: session!.id }, include: INCLUDE_SESSION });
  ...
});
```

Le théorique (`soldeOuverture + registre.solde`, appuyé sur `construireRegistre`, §5.3) est **toujours recalculé côté serveur** — jamais reçu du client, pour qu'aucun compte ne puisse être manipulé en modifiant une requête. L'écart (`compté − théorique`) est calculé immédiatement après ; s'il est non nul, un motif est obligatoire (`400 ECART_NON_MOTIVE`) avant même de tenter l'écriture — sinon la clôture perdrait toute valeur de comptage contradictoire.

**Correction de l'audit du 19/08/2026, ajoutée à cette route précisément** : `prisma.sessionCaisse.update({ where: { id: ... } })` (un `update` inconditionnel par identifiant) a été remplacé par `prisma.sessionCaisse.updateMany({ where: { id, statut: "OUVERTE" } })`, avec vérification du nombre de lignes réellement affectées (`count`). Le problème que corrige ce changement est un cas de concurrence bien réel : deux requêtes de clôture presque simultanées sur la **même** session (deux onglets ouverts, un double clic avant que le bouton ne se désactive) liraient toutes les deux `chargerSessionCaisseOuverte` → `statut === "OUVERTE"` avant qu'aucune des deux n'ait écrit. Avec un `update` inconditionnel, la seconde requête écraserait silencieusement le théorique/compté/écart déjà posés par la première — une clôture « fantôme » sans aucune erreur visible. En ajoutant `statut: "OUVERTE"` à la clause `WHERE` de l'écriture elle-même, seule la requête qui **gagne réellement la course** (celle dont l'écriture atomique voit encore `OUVERTE` au moment précis de l'exécution SQL, pas seulement au moment de la lecture précédente) modifie une ligne (`count === 1`) ; l'autre modifie zéro ligne (`count === 0`) et reçoit un `409` explicite l'invitant à recharger la page. C'est **exactement le même idiome** que celui déjà employé par le module Cycle de livraison (voir le nouveau chapitre dédié) pour ses propres transitions d'état concurrentes — ce module servait déjà de modèle, il n'était simplement pas encore repris ici avant cette correction.

## 5.15 Correction post-clôture — droit spécial de l'Admin Principal

```ts
caisseRouter.post("/sessions/:id/corriger", ecriture, async (req, res, next) => {
  if (!req.utilisateur!.estAdminPrincipal) return res.status(403).json({ erreur: "..." });
  const session = await prisma.sessionCaisse.findUnique({ where: { id: req.params.id }, include: INCLUDE_SESSION });
  if (session.statut !== "FERMEE") return res.status(409).json({ erreur: "Seule une session déjà clôturée peut être corrigée" });
  const ecartFermeture = soldeCompteFermeture - session.soldeTheoriqueFermeture!;
  const corrigee = await prisma.sessionCaisse.update({ where: { id: session.id }, data: { soldeCompteFermeture, ecartFermeture, motifEcart: ..., derniereCorrectionLe: new Date(), derniereCorrectionParId: req.utilisateur!.id, motifCorrection: motif } });
  ...
});
```

Symétrique de §5.14 : réservée à l'Admin Principal (garde identique à `POST /approbations/:id/approuver`, Volume 11f), applicable **seulement** sur une session déjà `FERMEE` — l'inverse exact de `chargerSessionCaisseOuverte`. Le **théorique reste inchangé** (il ne peut plus bouger, la session `FERMEE` bloque toute nouvelle écriture sur le registre de sa date, §5.11) ; seuls le compté et l'écart peuvent être révisés, avec motif obligatoire à chaque fois, et la trace de la **dernière** correction affichée en permanence (`derniereCorrectionLe`/`Par`/`motifCorrection` — un seul jeu de champs, pas un historique complet des corrections successives : seule la plus récente est conservée sur la ligne elle-même, l'historique complet des `update` restant néanmoins accessible via le Journal d'audit, Volume 11g). Notifiée en priorité **HAUTE** à l'ensemble des Admins, comme une action sensible.

## 5.16 Cas limites

| Situation | Comportement |
|---|---|
| Commande créée et réglée intégralement le jour même | Le montant reçu à la création va dans `entrees`, le règlement **confirmé** va dans `dettesPayees` — jamais compté deux fois, et rien tant qu'il reste DECLARE (§5.3, §5.13). |
| Redéfinir le taux d'un jour déjà renseigné | Mise à jour de la même ligne (`TauxDuJour.date` unique), pas de doublon, tracé au Journal d'audit (§5.5). |
| Cocher la case farine sans taux du jour | `409 Définissez d'abord le taux du jour pour cette date` (§5.5). |
| Cocher la case farine sans production enregistrée ce jour-là | `409 Aucune production enregistrée [...]` (§5.5). |
| Cocher la case farine alors qu'une ligne farine existe déjà pour cette date | `409 La dépense farine est déjà enregistrée pour cette date` (§5.5). |
| Décocher la case farine après que le taux ou la production aient changé/disparu | Toujours autorisé, aucune re-vérification des conditions de création (§5.5, §5.6). |
| Taux du jour modifié après qu'une ligne farine a déjà été calculée pour cette date | La ligne déjà enregistrée garde ses propres `tauxApplique`/`sacsUtilises` d'origine, jamais recalculée rétroactivement (§5.5). |
| Solde négatif | Affiché en gras et rouge vif, sur le registre et le tableau de bord (§5.6 ; tableau de bord hors périmètre de ce chapitre). |
| Écriture tentée sur une date dont la session est déjà `FERMEE` | `409` (`sessionFermeePourDate`, §5.11). |
| Écriture tentée alors qu'une session **antérieure** (autre date) est restée `OUVERTE` | `409` avec la date bloquante, sauf sur la session bloquante elle-même pour une remise, et sauf `/cloturer`/`/corriger` (§5.11). |
| Deux clôtures quasi simultanées sur la même session (double clic, deux onglets) | La première réussit ; la seconde reçoit `409` (« clôturée ailleurs — rechargez la page ») au lieu d'écraser silencieusement le théorique/compté/écart (§5.14). |
| Ouvrir une session sur une date qui en a déjà une | `409 Une session de caisse existe déjà pour cette date` (§5.10). |
| Correction post-clôture par un Admin secondaire | `403` — réservée à l'Admin Principal, même si son rôle a l'écriture Caisse (§5.15). |
| Correction tentée sur une session encore `OUVERTE` | `409 Seule une session déjà clôturée peut être corrigée` (§5.15). |
| Sélection de règlements à confirmer incluant un règlement déjà confirmé ou inexistant | Rejet intégral du lot (`REGLEMENT_INVALIDE`, 409), aucune confirmation partielle (§5.13). |
| Double-clic sur « Ajouter la dépense » ou « Ouvrir la session » | La même `Idempotency-Key` (corps identique) rejoue la réponse déjà obtenue plutôt que de créer un doublon (§5.5, §5.10). |

## 5.17 Croisement avec la spécification

Toujours aucun écart trouvé — vérifié à nouveau lors de cette révision contre la version actuelle de la section 3.1 de `docs/spec-boulangerie.md` (8 points, y compris les points 4 et 5 sur les règlements déclaré/confirmé et les sessions de caisse, absents au moment de la rédaction d'origine de ce chapitre). Les quatre postes du registre, leur formule exacte, la règle de non-double-comptage, la formule de la dépense farine (`[(33,5 × taux) + 500] × sacs`, Volume 11a), les deux conditions de blocage de la case farine, l'affichage du solde négatif en rouge vif, l'absence de toute référence à `Vente`/`LigneVente`/`ClotureCaisse` dans `caisse.ts`, le cycle DECLARE/CONFIRME des règlements, la discipline chronologique étendue à toute écriture, le théorique calculé côté serveur avec motif obligatoire en cas d'écart, et la correction post-clôture réservée à l'Admin Principal correspondent tous exactement au texte actuel de la spec.

**Correction (établie au Volume 13, lors de l'étude de l'historique des migrations)** : ce chapitre affirmait initialement que `Vente`/`LigneVente`/`ClotureCaisse` « restent orphelines en base » — une reprise fidèle du commentaire présent dans `schema.prisma` à l'époque de la rédaction de ce chapitre, mais qui s'est révélée **obsolète** : la migration `20260806134719_absence_alerte_et_nettoyage_orphelines` a en réalité **supprimé ces trois tables** (avec `Presence`), après avoir vérifié qu'elles étaient bien vides. Le commentaire correspondant dans `schema.prisma`, lui, n'a jamais été mis à jour pour refléter cette suppression — voir Volume 13 pour le détail de cette incohérence documentaire (un commentaire du code, pas un écart avec la spécification).

**Deux corrections bug terrain vérifiées à jour lors de cette révision (19/08/2026)** : (1) le lien matière première ↔ ingrédient de production, hors périmètre de ce chapitre (voir Volume 11z-1) ; (2) la discipline chronologique étendue à toute écriture Caisse, désormais intégralement décrite au §5.11 ci-dessus — les deux corrigent des écarts entre l'intention de la spec et le comportement réel du code, pas des écarts entre la spec et sa propre rédaction.

## 5.18 Résumé

Le registre de Caisse referme la trilogie Commandes/Commissions/Caisse : trois modules Niveau 1 qui relisent, chacun sous un angle différent, les mêmes données de commandes déjà enregistrées, sans jamais dupliquer d'état. Sa plus grande subtilité — rendre « Entrées » et « Dettes payées » strictement disjointes malgré un champ `montantRecu` cumulatif sur les commandes — est résolue par une simple soustraction, appliquée systématiquement, désormais restreinte aux seuls règlements **CONFIRME**. La case farine illustre un principe déjà croisé à plusieurs reprises dans ce livre : préférer un blocage explicite et expliqué à un calcul silencieux sur une valeur absente.

Depuis la rédaction d'origine de ce chapitre, le module a grandi dans une direction différente : à côté du registre, qui reste un pur calcul recalculé à chaque lecture, une **`SessionCaisse`** vient désormais l'envelopper d'un objet réellement figé à la clôture — solde théorique, compté et écart, protégés par un motif obligatoire en cas d'écart et, depuis le 19/08/2026, par un verrou optimiste contre les clôtures concurrentes. La discipline chronologique, elle, est passée d'une garde ponctuelle (seulement à l'ouverture) à une garde systématique (sur toute écriture) après un signalement terrain — l'exemple même, dans ce livre, d'un écart entre l'**intention** de la spec (« aucune inclusion implicite d'un autre jour ») et son application **incomplète** dans le code, corrigé sans que la spec elle-même n'ait eu tort. Toujours aucun écart avec la spécification actuelle.

---

**Suite →** Volume 11k — Travailleurs et Paie (`apps/api/src/routes/travailleurs.ts`, 985 lignes — probablement scindé en plusieurs sous-chapitres — `apps/web/src/pages/Travailleurs.tsx`, `apps/web/src/components/PaieCard.tsx`), le dernier grand chapitre Niveau 1 avant de clore ce niveau de risque.
