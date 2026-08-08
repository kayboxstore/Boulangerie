# Volume 11j — Caisse

**Niveau de risque : 1 — Critique.** Traitement exhaustif. Ce chapitre réutilise directement `calculerDepenseFarine`, déjà expliquée avec exemple chiffré au Volume 11a, et referme la boucle commencée aux volumes 11h (Commandes) et 11i (Commissions) : le registre de Caisse est la troisième et dernière vue qui recombine les mêmes données de commandes, sous un angle différent — celui de la trésorerie du jour plutôt que du client ou de la commission.

## Fiche d'identité des fichiers couverts

| Fichier | Lignes | Rôle |
|---|---:|---|
| `apps/api/src/routes/caisse.ts` | 330 | Registre journalier, taux du jour, dépenses libres, case à cocher « dépense farine » |
| `apps/web/src/pages/Caisse.tsx` | 507 | Écran du registre, avec sélecteur de date, tuiles de synthèse, dialogues taux/dépense |

- **Qui les appelle** : `caisseRouter` est monté sur `/api/caisse` dans `app.ts` ; `CaissePage` est affichée par la route `/caisse` de `App.tsx`, réservée en écriture au Caissier(ère), lecture seule pour le DG et les autres rôles y ayant accès.
- **Ce qu'ils appellent** : `calculerDepenseFarine` (Volume 11a) ; `busEvenements.emettreEvenement` (Volume 12) ; en lecture, `prisma.commandeClient`, `prisma.paiementCommande` et `prisma.production` (module Production, hors périmètre de ce chapitre) pour reconstituer le registre.
- **Données modifiées** : `TauxDuJour` (création/mise à jour), `DepenseCaisse` (création/suppression). **Aucune écriture** sur `CommandeClient` ni `PaiementCommande` — le registre les *lit* pour se construire, il ne les modifie jamais.

## 5.1 Vue d'ensemble intuitive — un calcul, jamais un objet figé

> La Caisse devient un **registre journalier** : ce qui est entré, ce qui est sorti, ce qui reste. [...] Le registre étant un **calcul par date** et non un objet que l'on fige, il n'y a **pas d'action de clôture**.
> — `docs/spec-boulangerie.md`, section 3.1

Point de méthode déjà annoncé au Volume 11a (glossaire) et confirmé ici en détail : il n'existe, dans `prisma/schema.prisma`, **aucun modèle « Registre »**. Pour une date donnée, le registre est **entièrement reconstruit à chaque lecture** à partir de trois sources : les commandes du jour, les règlements du jour, et les dépenses du jour — exactement la même philosophie que le module Commissions (Volume 11i), appliquée ici à une échelle plus large (toute la caisse, pas seulement les commandes Maman). Deux tables existent bien en écriture directe dans ce module — `TauxDuJour` et `DepenseCaisse` — mais elles ne sont, l'une comme l'autre, que des **entrées manuelles** du registre, jamais son résultat stocké.

## 5.2 Deux techniques de bornage de date, pour deux types de colonnes

```ts
const jour = (d: Date) => d.toISOString().slice(0, 10);
const aujourdhui = () => jour(new Date());
const dateSQL = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function bornesLocales(iso: string): [Date, Date] {
  const [a, m, j] = iso.split("-").map(Number);
  return [new Date(a, m - 1, j, 0, 0, 0, 0), new Date(a, m - 1, j, 23, 59, 59, 999)];
}
```

Un point à comprendre avant tout le reste, car il explique pourquoi ce fichier emploie **deux fonctions différentes** pour manipuler des dates, chacune pour un type de colonne Prisma distinct :

- **`dateSQL`** construit un instant fixe (minuit UTC) pour les colonnes déclarées `@db.Date` dans le schéma (`TauxDuJour.date`, `DepenseCaisse.date`) — un vrai type SQL `DATE`, sans composante horaire, où stocker un jour signifie stocker exactement cette seule valeur, sans plage à borner.
- **`bornesLocales`** construit les deux extrémités (minuit à 23h59:59.999) d'un jour, en **heure locale explicite** (`new Date(année, mois, jour, ...)`, qui utilise le fuseau du serveur, contrairement à `dateSQL`, volontairement en UTC) — nécessaire pour les colonnes `DateTime` classiques (`CommandeClient.dateCreation`, `PaiementCommande.date`), qui portent un horodatage complet et pour lesquelles « le jour X » signifie une **plage**, pas une valeur unique.

Ce n'est pas une incohérence du code : ce sont deux techniques différentes, chacune adaptée au type de colonne réellement interrogé. Un lecteur qui ne remarquerait pas cette distinction pourrait être surpris de voir deux façons de gérer des dates dans le même fichier — la raison est précisément dans la différence entre `@db.Date` et `DateTime` au niveau du schéma Prisma.

`estDateValide` (une simple expression régulière `^\d{4}-\d{2}-\d{2}$`) sécurise le paramètre `?date=` reçu en `query string` avant de le passer à ces fonctions — une date absente ou malformée retombe systématiquement sur `aujourdhui()`.

## 5.3 `construireRegistre` — le cœur du chapitre

```ts
async function construireRegistre(date: string): Promise<RegistreCaisseDTO> {
  const [debut, fin] = bornesLocales(date);

  const commandesDuJour = await prisma.commandeClient.findMany({
    where: { dateCreation: { gte: debut, lte: fin } },
    select: { montantRecu: true, reglements: { select: { montant: true } } },
  });
  const entrees = commandesDuJour.reduce((somme, c) => {
    const verseALaCreation = c.montantRecu - c.reglements.reduce((s, r) => s + r.montant, 0);
    return somme + Math.max(0, verseALaCreation);
  }, 0);

  const reglementsDuJour = await prisma.paiementCommande.findMany({
    where: { date: { gte: debut, lte: fin } },
    include: { commandeClient: { select: { numero: true, client: { select: { nom: true } } } } },
    orderBy: { date: "asc" },
  });
  const dettesPayees = reglementsDuJour.reduce((s, r) => s + r.montant, 0);

  const depenses = await prisma.depenseCaisse.findMany({ where: { date: dateSQL(date) }, include: INCLUDE_DEPENSE, orderBy: { createdAt: "asc" } });
  const totalDepenses = depenses.reduce((s, d) => s + d.montant, 0);

  const taux = await prisma.tauxDuJour.findUnique({ where: { date: dateSQL(date) }, include: INCLUDE_TAUX });
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

### Le point le plus important du chapitre : entrées et dettes payées sont disjointes par construction

Le commentaire du code, juste avant cette fonction, l'annonce sans détour : *« Les deux postes automatiques sont DISJOINTS par construction, pour qu'aucun franc ne soit compté deux fois »*. Le problème qu'ils résolvent : `CommandeClient.montantRecu` (Volume 11h) est un champ **cumulatif** — il inclut non seulement ce qui a été versé à la création de la commande, mais aussi tous les règlements ultérieurs sur cette même commande (chaque `POST /:id/reglements` l'incrémente, Volume 11h §5.9). Si le registre additionnait naïvement `montantRecu` de chaque commande du jour **et** la somme des règlements du jour, un règlement encaissé le jour même de la création de sa commande serait compté **deux fois** — une fois dans « Entrées », une fois dans « Dettes payées ».

La solution : pour chaque commande créée aujourd'hui, `entrees` ne retient que `montantRecu − (somme de ses propres règlements)` — c'est-à-dire l'argent **réellement versé au moment précis de la création**, avec ses règlements ultérieurs soustraits pour ne pas les compter ici. `Math.max(0, verseALaCreation)` protège contre un résultat négatif — impossible en théorie (un règlement ne peut jamais dépasser ce qui a été reçu, il ne fait qu'ajouter au montant reçu), mais la protection reste posée par précaution. `dettesPayees`, de son côté, prend **tous** les règlements datés d'aujourd'hui, sans aucune exclusion — y compris ceux qui portent sur une commande créée aujourd'hui même. Le résultat : la part « à la création » d'une commande atterrit dans `entrees`, sa part « réglée après coup » (même le jour même) atterrit dans `dettesPayees` — jamais les deux à la fois pour le même franc.

**Exemple chiffré** : une commande créée aujourd'hui pour 50 000 Fc, avec 30 000 Fc reçus à la création, puis un règlement de 20 000 Fc encaissé plus tard dans la même journée. `montantRecu` vaut, à ce stade, `50000` (30 000 + 20 000, cumulé sur la commande). Pour cette commande : `verseALaCreation = 50000 − 20000 = 30000` (le règlement de 20 000 Fc est soustrait) — donc `entrees` reçoit `30000`. Le règlement de 20 000 Fc, lui, apparaît séparément dans `reglementsDuJour`, donc dans `dettesPayees`. Total pour cette commande sur le registre du jour : `30000 + 20000 = 50000`, exactement ce qui a réellement été encaissé — jamais 70 000, jamais 30 000.

### Le solde et la ligne farine

`solde: entrees + dettesPayees − totalDepenses`, exactement la formule de la spec. Le **blocage de la case farine** est calculé en deux temps successifs (`if / else if`, pas deux conditions indépendantes) : d'abord l'absence de taux du jour (`TAUX_MANQUANT`), puis seulement si un taux existe, l'absence de production enregistrée (`sacsUtilisesJour <= 0`, `PRODUCTION_MANQUANTE`) — un seul des deux blocages est jamais renvoyé à la fois, celui qui bloque en premier dans cet ordre de priorité. `montantEstime` n'est calculé (via `calculerDepenseFarine`, Volume 11a) que si **aucun** blocage n'est actif — sinon il vaut `null`, cohérent avec le commentaire du code : *« indisponible tant qu'il manque le taux ou la production du jour — on l'explique plutôt que de calculer sur une valeur absente ou un zéro trompeur »*. Un « zéro trompeur » aurait été le cas si le code avait renvoyé `0` en l'absence de sacs utilisés (`0` sacs → `0` Fc, arithmétiquement correct mais visuellement indiscernable d'une vraie dépense nulle) — le champ `blocage`, en donnant une **raison explicite**, évite cette ambiguïté à l'écran.

## 5.4 `sacsUtilisesLe` — le pont avec le module Production

```ts
async function sacsUtilisesLe(date: string): Promise<number> {
  const [debut, fin] = bornesLocales(date);
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
  const taux = await prisma.$transaction(async (tx) => {
    const existant = await tx.tauxDuJour.findUnique({ where: { date: dateSQL(date) } });
    if (existant) return tx.tauxDuJour.update({ where: { id: existant.id }, data: { valeur, definiParId: req.utilisateur!.id }, include: INCLUDE_TAUX });
    return tx.tauxDuJour.create({ data: { date: dateSQL(date), valeur, definiParId: req.utilisateur!.id }, include: INCLUDE_TAUX });
  });
  ...
});
```

`TauxDuJour.date` est déclaré `@unique` dans le schéma — une seule valeur possible par date. La route l'exploite directement en « upsert manuel » (chercher, puis créer ou mettre à jour selon le résultat) plutôt que d'utiliser `prisma.tauxDuJour.upsert()` (l'opérateur natif de Prisma pour ce même motif, déjà rencontré ailleurs — par exemple dans `MODIFIER_PERMISSIONS_ROLE`, Volume 11f). Les deux approches produisent le même résultat ici ; le commentaire du code (*« un second envoi sur la même date met à jour la valeur »*) confirme l'intention : redéfinir le taux d'un jour déjà renseigné n'est pas une erreur, c'est un cas normal, explicitement pris en charge, et **tracé** par le Journal d'audit (Volume 11g) comme n'importe quelle autre modification.

```ts
caisseRouter.post("/depenses", ecriture, async (req, res, next) => {
  const parsed = depenseCreateSchema.safeParse(req.body);
  ...
  const depense = await prisma.depenseCaisse.create({ data: { date: dateSQL(date), motif, montant, origine: "MANUELLE", enregistreParId: req.utilisateur!.id }, include: INCLUDE_DEPENSE });
  ...
  res.status(201).json({ depense: dto });
});

caisseRouter.delete("/depenses/:id", ecriture, async (req, res, next) => {
  const depense = await prisma.depenseCaisse.findUnique({ where: { id: req.params.id } });
  if (!depense) return res.status(404).json({ erreur: "Dépense introuvable" });
  await prisma.depenseCaisse.delete({ where: { id: depense.id } });
  ...
  res.status(204).end();
});
```

Une dépense manuelle (`origine: "MANUELLE"`, l'une des deux valeurs de l'énumération `OrigineDepense`, §5.1 du schéma) : motif libre, montant entier positif. Rien de spécifique à commenter au-delà des conventions déjà rencontrées à de nombreuses reprises dans ce livre (validation Zod, `404` si introuvable, `204` sur suppression réussie, notification temps réel après coup).

```ts
caisseRouter.put("/depenses/farine", ecriture, async (req, res, next) => {
  const parsed = depenseFarineSchema.safeParse(req.body);
  ...
  const { date, active } = parsed.data;
  const existante = await prisma.depenseCaisse.findFirst({ where: { date: dateSQL(date), origine: "FARINE" } });

  if (!active) {
    if (existante) await prisma.depenseCaisse.delete({ where: { id: existante.id } });
    return res.json({ registre: await construireRegistre(date) });
  }
  if (existante) return res.status(409).json({ erreur: "La dépense farine est déjà enregistrée pour cette date" });

  const taux = await prisma.tauxDuJour.findUnique({ where: { date: dateSQL(date) } });
  if (!taux) return res.status(409).json({ erreur: "Définissez d'abord le taux du jour pour cette date" });
  const sacs = await sacsUtilisesLe(date);
  if (sacs <= 0) return res.status(409).json({ erreur: "Aucune production enregistrée pour cette date : le nombre de sacs utilisés est inconnu" });

  const valeurTaux = taux.valeur.toNumber();
  const depense = await prisma.depenseCaisse.create({
    data: { date: dateSQL(date), motif: MOTIF_DEPENSE_FARINE, montant: calculerDepenseFarine(valeurTaux, sacs), origine: "FARINE", tauxApplique: valeurTaux, sacsUtilises: sacs, enregistreParId: req.utilisateur!.id },
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

## 5.7 Cas limites

| Situation | Comportement |
|---|---|
| Commande créée et réglée intégralement le jour même | Le montant reçu à la création va dans `entrees`, le règlement va dans `dettesPayees` — jamais compté deux fois (§5.3). |
| Redéfinir le taux d'un jour déjà renseigné | Mise à jour de la même ligne (`TauxDuJour.date` unique), pas de doublon, tracé au Journal d'audit (§5.5). |
| Cocher la case farine sans taux du jour | `409 Définissez d'abord le taux du jour pour cette date` (§5.5). |
| Cocher la case farine sans production enregistrée ce jour-là | `409 Aucune production enregistrée [...]` (§5.5). |
| Cocher la case farine alors qu'une ligne farine existe déjà pour cette date | `409 La dépense farine est déjà enregistrée pour cette date` (§5.5). |
| Décocher la case farine après que le taux ou la production aient changé/disparu | Toujours autorisé, aucune re-vérification des conditions de création (§5.5, §5.6). |
| Taux du jour modifié après qu'une ligne farine a déjà été calculée pour cette date | La ligne déjà enregistrée garde ses propres `tauxApplique`/`sacsUtilises` d'origine, jamais recalculée rétroactivement (§5.5). |
| Solde négatif | Affiché en gras et rouge vif, sur le registre et le tableau de bord (§5.6 ; tableau de bord hors périmètre de ce chapitre). |

## 5.8 Croisement avec la spécification

Aucun écart trouvé. Les quatre postes du registre (Entrées, Dettes payées, Dépenses, Solde), leur formule exacte, la règle de non-double-comptage (reproduite mot pour mot dans le commentaire du code source), la formule de la dépense farine (`[(33,5 × taux) + 500] × sacs`, Volume 11a), les deux conditions de blocage de la case farine, l'affichage du solde négatif en rouge vif, l'absence d'action de clôture, et le fait que `Vente`/`LigneVente`/`ClotureCaisse` restent orphelines en base (confirmé : aucune de ces tables n'est référencée dans `caisse.ts`) correspondent tous exactement à la section 3.1 de `docs/spec-boulangerie.md`.

## 5.9 Résumé

Le registre de Caisse referme la trilogie Commandes/Commissions/Caisse : trois modules Niveau 1 qui relisent, chacun sous un angle différent, les mêmes données de commandes déjà enregistrées, sans jamais dupliquer d'état. Sa plus grande subtilité — rendre « Entrées » et « Dettes payées » strictement disjointes malgré un champ `montantRecu` cumulatif sur les commandes — est résolue par une simple soustraction, appliquée systématiquement. La case farine illustre un principe déjà croisé à plusieurs reprises dans ce livre : préférer un blocage explicite et expliqué à un calcul silencieux sur une valeur absente. Aucun écart avec la spécification.

---

**Suite →** Volume 11k — Travailleurs et Paie (`apps/api/src/routes/travailleurs.ts`, 985 lignes — probablement scindé en plusieurs sous-chapitres — `apps/web/src/pages/Travailleurs.tsx`, `apps/web/src/components/PaieCard.tsx`), le dernier grand chapitre Niveau 1 avant de clore ce niveau de risque.
