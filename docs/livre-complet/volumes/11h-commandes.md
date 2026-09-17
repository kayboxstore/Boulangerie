# Volume 11h — Commandes

**Niveau de risque : 1 — Critique.** Traitement exhaustif. Ce chapitre couvre le cœur du module Commandes — enregistrement d'une commande, détection de doublon, règlement d'une dette — et réutilise directement `calculerCommande` et `avanceAvantCommande`, déjà expliqués en détail avec exemple chiffré au Volume 11a. Les écrans satellites du même sous-système (fiche Client, Schéma de commande, Bon de livraison, Zones de dépôt) sont volontairement **hors de ce chapitre** — ce sont des écrans Niveau 2 distincts, traités au Volume 18.

## Fiche d'identité des fichiers couverts

| Fichier | Lignes | Rôle |
|---|---:|---|
| `apps/api/src/routes/commandes.ts` | 498 | Résumé du jour, alertes de dette, liste filtrée, création/mise à jour d'une commande, règlement d'une dette |
| `apps/web/src/pages/Commandes.tsx` | 908 | Écran principal : tableau de bord du jour, liste, formulaire de commande, dialogue de conflit, dialogue de règlement, création rapide de client |

- **Qui les appelle** : `commandesRouter` est monté sur `/api/commandes` dans `app.ts` ; `CommandesPage` est affichée par la route `/commandes` de `App.tsx`, protégée par le module `COMMANDES` (Volume 11a, écriture réservée au Chargé des commandes, lecture ouverte au Caissier(ère) et au DG).
- **Ce qu'ils appellent** : `calculerCommande` et `avanceAvantCommande` (Volume 11a) — importées **telles quelles**, aucune formule locale redéfinie ; `busEvenements.emettreEvenement` (notifications temps réel, Volume 12) ; l'extension d'audit (Volume 11g, transparente : `CommandeClient` et `PaiementCommande` figurent dans `MODELE_MODULE` sous le module `COMMANDES`).
- **Données modifiées** : `CommandeClient` (création, mise à jour), `PaiementCommande` (création), `Client.avanceDisponible` (mis à jour à chaque commande et à chaque règlement).

## 5.1 Vue d'ensemble intuitive

Une commande représente ce qu'un client a reçu un jour donné, et combien il a payé pour cela. La règle centrale, déjà rencontrée avec ses chiffres au Volume 11a, est que l'avance disponible du client est **automatiquement déduite avant affichage** du montant à percevoir, et que tout trop-perçu redevient une avance pour la prochaine commande — le client ne manipule jamais lui-même son solde d'avance, il se reconstitue tout seul à chaque transaction. Ce chapitre ajoute une règle supplémentaire, propre à `commandes.ts`, non couverte au Volume 11a : **un client ne peut jamais avoir deux commandes le même jour**.

> **Détection de doublon — une seule commande par client et par jour.** Un même client (même `clientId`) ne peut jamais avoir deux commandes à la même date — la règle vaut pour les trois Qualités. [...] Quand une nouvelle saisie arrive pour un client qui a déjà une commande ce jour-là, l'application ne l'enregistre pas d'office : elle propose un choix à l'utilisateur, appliqué sur LA MÊME commande (même numéro, jamais une nouvelle).
> — `docs/spec-boulangerie.md`, section 3.4

## 5.2 `versCommandeDTO` et `INCLUDE_RELATIONS`

```ts
type CommandeAvecRelations = Prisma.CommandeClientGetPayload<{
  include: {
    client: { select: { id: true; nom: true; typeClient: { select: { nom: true } } } };
    creePar: { select: { id: true; nom: true } };
    reglements: { include: { enregistrePar: { select: { id: true; nom: true } } }; orderBy: { date: "asc" } };
  };
}>;

const versCommandeDTO = (c: CommandeAvecRelations): CommandeDTO => ({
  id: c.id, numero: c.numero, dateCreation: c.dateCreation.toISOString(),
  client: { id: c.client.id, nom: c.client.nom }, qualite: c.client.typeClient.nom,
  quantiteBacs: c.quantiteBacs, montantBrut: c.montantBrut, avanceUtilisee: c.avanceUtilisee,
  montantAPercevoir: c.montantAPercevoir, montantRecu: c.montantRecu, dette: c.dette,
  avanceGeneree: c.avanceGeneree, nouvelleAvance: c.nouvelleAvance,
  creePar: c.creePar ? { id: c.creePar.id, nom: c.creePar.nom } : null,
  reglements: c.reglements.map((r) => ({ id: r.id, montant: r.montant, date: r.date.toISOString(), enregistrePar: r.enregistrePar ? { id: r.enregistrePar.id, nom: r.enregistrePar.nom } : null })),
});
```

Une conversion directe modèle Prisma → DTO réseau, sans logique de calcul (les six champs financiers — `montantBrut`, `avanceUtilisee`, `montantAPercevoir`, `dette`, `avanceGeneree`, `nouvelleAvance` — sont **déjà stockés tels quels en base**, calculés une seule fois au moment de l'écriture, jamais recalculés à la lecture). C'est un point de conception important pour tout ce chapitre : une fois une commande créée, ses montants sont figés dans la base — relire la commande ne relance jamais `calculerCommande`. `qualite` prend directement le nom du `TypeClient` associé (`c.client.typeClient.nom`), pas son identifiant — pratique pour l'affichage, mais signifie que si une Qualité était renommée après coup (Volume 11f, `MODIFIER_TYPE_CLIENT`), les commandes déjà enregistrées afficheraient rétroactivement le **nouveau** nom, puisque ce champ n'est pas lui-même figé comme le sont les montants — à la différence des montants, la relation vers `TypeClient` reste vivante.

## 5.3 `bornesDuJour` — une fonction utilisée cinq fois dans ce fichier

```ts
function bornesDuJour(d: Date): [Date, Date] {
  const debut = new Date(d);
  debut.setHours(0, 0, 0, 0);
  const fin = new Date(d);
  fin.setHours(23, 59, 59, 999);
  return [debut, fin];
}
```

Renvoie les deux bornes (minuit à minuit moins une milliseconde) du jour civil contenant la date `d`, dans le **fuseau horaire du serveur** (`setHours` opère en heure locale du processus Node.js, pas en UTC) — une différence de technique par rapport au filtre par date de `routes/audit.ts` (Volume 11g, qui construisait ses bornes en UTC explicite avec `T00:00:00.000Z`). Cette fonction est le pivot de toute la logique « une commande par jour » : elle sert à borner la recherche d'une commande existante à la création (§5.8), au calcul du résumé du jour (§5.4), et à la détection des dettes en retard « avant aujourd'hui » (§5.6).

## 5.4 `GET /resume-jour` — le tableau de bord journalier

```ts
commandesRouter.get("/resume-jour", requirePermission("COMMANDES", "LECTURE"), async (_req, res, next) => {
  const [debut, fin] = bornesDuJour(new Date());
  const duJour = await prisma.commandeClient.findMany({
    where: { dateCreation: { gte: debut, lte: fin } },
    select: { quantiteBacs: true, montantAPercevoir: true, montantRecu: true, dette: true },
  });
  const somme = (f) => duJour.reduce((s, c) => s + f(c), 0);
  const avecDette = duJour.filter((c) => c.dette > 0);
  const dto: ResumeCommandesJourDTO = {
    date: debut.toISOString().slice(0, 10),
    nombreCommandes: duJour.length,
    totalBacs: somme((c) => c.quantiteBacs),
    totalAPercevoir: somme((c) => c.montantAPercevoir),
    totalRecu: somme((c) => c.montantRecu),
    nbSoldees: duJour.length - avecDette.length,
    nbAvecDette: avecDette.length,
    totalDettes: avecDette.reduce((s, c) => s + c.dette, 0),
  };
  res.json(dto);
});
```

Sept agrégats calculés en mémoire sur les commandes du jour (`select` limité aux quatre champs nécessaires — pas de sur-lecture des relations). `somme` est une petite fonction d'ordre supérieur (elle prend une fonction en paramètre) réutilisée trois fois pour éviter de répéter le motif `reduce` — un `Array.prototype.reduce` classique : part de `0`, additionne `f(c)` pour chaque commande `c`. `nbSoldees` se déduit par soustraction (`total − avecDette`) plutôt que d'être recompté séparément — une commande est soit soldée (`dette === 0`), soit avec dette (`dette > 0`), les deux ensembles sont donc complémentaires par construction.

## 5.5 `GET /livraisons-du-jour` — pré-remplissage optionnel depuis le Bon de livraison

```ts
commandesRouter.get("/livraisons-du-jour", requirePermission("COMMANDES", "LECTURE"), async (req, res, next) => {
  const { date } = req.query as Record<string, string | undefined>;
  const dateStr = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : jourISO(new Date());
  const dateObj = new Date(dateStr);
  const bons = await prisma.bonLivraison.findMany({ where: { date: dateObj }, include: { lignes: true } });
  const totauxParClientId: Record<string, number> = {};
  for (const bon of bons) totauxParClientId[bon.clientId] = bon.lignes.reduce((s, l) => s + l.quantite, 0);
  res.json({ date: dateStr, totauxParClientId });
});
```

Une route de confort, explicitement documentée comme « amélioration proactive, aucun lien rigide entre les deux modules » : elle calcule, pour chaque client ayant un Bon de livraison (module Production, hors périmètre de ce chapitre) à une date donnée, le total de bacs livrés — une simple carte `{ clientId → total }`. Le client HTTP (§5.11) s'en sert uniquement pour pré-remplir le champ « bacs reçus » d'une nouvelle commande, à titre indicatif — cette route ne crée, ne modifie ni ne verrouille rien ; le champ pré-rempli reste librement modifiable par l'utilisateur, exactement comme le veut la spec.

## 5.6 Alerte « dette non payée » — vérification paresseuse

```ts
async function verifierAlertesDette(): Promise<void> {
  const [debutAujourdhui] = bornesDuJour(new Date());
  const enRetard = await prisma.commandeClient.findMany({
    where: { dette: { gt: 0 }, dateCreation: { lt: debutAujourdhui }, alerteDetteEnvoyeeLe: null },
    include: { client: { select: { nom: true } } },
    take: 200,
  });
  for (const c of enRetard) {
    const { count } = await prisma.commandeClient.updateMany({
      where: { id: c.id, alerteDetteEnvoyeeLe: null },
      data: { alerteDetteEnvoyeeLe: new Date() },
    });
    if (count !== 1) continue;
    busEvenements.emettreEvenement({ type: "DETTE_NON_PAYEE", module: "COMMANDES", emetteurId: null, ... });
  }
}
```

Le commentaire d'en-tête de cette fonction dans le code résume bien le principe : *« vérification PARESSEUSE, sans tâche planifiée : elle tourne au chargement de l'app [...], sur le même principe que l'expiration des délégations (évaluée à la date plutôt que par un cron) »* — une philosophie déjà rencontrée deux fois dans ce livre (Volume 11e, délégations ; spec section 3.18, absences). Pas de `node-cron` ici : la fonction s'exécute à chaque appel de `GET /alertes-dette` (§5.6 bis), c'est-à-dire à chaque ouverture de l'écran par un utilisateur ayant accès au module.

**Le mécanisme anti-doublon de notification mérite une lecture attentive**, car il gère un cas de concurrence réel. Le filtre `dette > 0`, `dateCreation < aujourd'hui`, `alerteDetteEnvoyeeLe: null` sélectionne les commandes en retard **jamais encore notifiées**. Pour chacune, plutôt qu'un simple `update`, le code utilise `updateMany` avec, dans son `where`, **la même condition `alerteDetteEnvoyeeLe: null`** répétée — c'est ce qui transforme l'opération en un **compare-and-set atomique** au niveau de la base de données : la mise à jour ne réussit (`count === 1`) que si la ligne satisfait encore cette condition **au moment précis de l'exécution du `UPDATE`** en base, pas seulement au moment de la lecture initiale. Si deux utilisateurs ouvrent l'écran Commandes au même instant, déclenchant chacun un appel à `verifierAlertesDette()` en parallèle, les deux liront la même commande « non notifiée » — mais un seul des deux `updateMany` réussira à passer `alerteDetteEnvoyeeLe` de `null` à une date (le second, arrivant après, ne trouvera plus aucune ligne correspondant à `alerteDetteEnvoyeeLe: null` pour cet `id`, donc `count` vaudra `0`) : `if (count !== 1) continue;` saute alors l'envoi de la notification pour ce processus-là. **Résultat garanti : une seule notification part, jamais deux**, sans verrou explicite ni file d'attente — la garantie vient uniquement de l'atomicité native d'une commande `UPDATE ... WHERE` en SQL.

`emetteurId: null` signale un événement **système**, sans auteur humain — cohérent avec le fait que cette alerte n'est déclenchée par aucune action volontaire d'un utilisateur, seulement par l'écoulement du temps constaté au prochain chargement.

```ts
commandesRouter.get("/alertes-dette", requirePermission("COMMANDES", "LECTURE"), async (_req, res, next) => {
  await verifierAlertesDette();
  const [debutAujourdhui] = bornesDuJour(new Date());
  const enRetard = await prisma.commandeClient.findMany({
    where: { dette: { gt: 0 }, dateCreation: { lt: debutAujourdhui } },
    include: { client: { select: { nom: true } } }, orderBy: { dateCreation: "asc" }, take: 100,
  });
  const alertes: AlerteDetteDTO[] = enRetard.map((c) => ({
    commandeId: c.id, numero: c.numero, clientNom: c.client.nom, dette: c.dette,
    dateCreation: c.dateCreation.toISOString(),
    joursDepuis: Math.max(1, Math.floor((debutAujourdhui.getTime() - bornesDuJour(c.dateCreation)[0].getTime()) / 86_400_000)),
    alerteEnvoyeeLe: c.alerteDetteEnvoyeeLe?.toISOString() ?? null,
  }));
  res.json({ alertes });
});
```

Cette route fait deux choses distinctes, dans cet ordre : (1) déclenche `verifierAlertesDette()` (qui peut envoyer de nouvelles notifications, sans rapport direct avec ce que la route va renvoyer), puis (2) relit et renvoie **toutes** les dettes en retard encore ouvertes — **sans filtrer sur `alerteDetteEnvoyeeLe`** cette fois. C'est volontaire : la notification ponctuelle (la cloche) ne part qu'une fois, mais la **liste affichée dans l'écran** (§5.11) doit continuer de montrer une dette en retard tant qu'elle n'est pas soldée, qu'une alerte ait déjà été envoyée ou non — deux préoccupations différentes traitées par le même appel, l'une en écriture (une fois), l'autre en lecture (à chaque appel). `joursDepuis` calcule un nombre entier de jours écoulés depuis la création, borné à un minimum de `1` (`Math.max(1, ...)`) — une commande créée hier et toujours en retard aujourd'hui affiche donc toujours au moins « 1 jour », jamais « 0 ».

## 5.7 `GET /` — liste avec filtres

```ts
commandesRouter.get("/", requirePermission("COMMANDES", "LECTURE"), async (req, res, next) => {
  const { typeClientId, du, au } = req.query as Record<string, string | undefined>;
  const dateCreation: Prisma.DateTimeFilter = {};
  if (du) dateCreation.gte = new Date(`${du}T00:00:00`);
  if (au) dateCreation.lte = new Date(`${au}T23:59:59.999`);
  const commandes = await prisma.commandeClient.findMany({
    where: { ...(typeClientId ? { client: { typeClientId } } : {}), ...(du || au ? { dateCreation } : {}) },
    include: INCLUDE_RELATIONS, orderBy: { numero: "desc" },
  });
  res.json({ commandes: commandes.map(versCommandeDTO) });
});
```

Trois filtres combinables (Qualité via `typeClientId`, période via `du`/`au`), tous optionnels — sans aucun filtre, la route renvoie l'intégralité des commandes, triées par numéro décroissant (les plus récentes en premier, puisque `numero` est auto-incrémenté chronologiquement, §5.2 du schéma). **Aucune pagination ni plafond** (`take`) sur cette route, à la différence de toutes les listes rencontrées jusqu'ici dans ce livre (délégations, approbations, journal d'audit, toutes plafonnées à 100 ou 200) — sur un historique de commandes qui grandit indéfiniment, cette route renverra un jour l'ensemble complet de l'historique en une seule réponse. **Non confirmé dans le code actuel** que cela pose un problème de performance mesurable à ce stade (dépend du volume réel de commandes accumulées) ; un point à surveiller si l'application est utilisée sur plusieurs années sans purge ni archivage — voir Volume 20 (Performances) pour un traitement transversal de ce type de constat sur l'ensemble du projet.

À noter, une différence de technique par rapport à `bornesDuJour` (§5.3) : ce filtre de dates construit ses bornes en heure **locale implicite** (`${du}T00:00:00`, sans suffixe `Z`), pas en UTC explicite comme au Volume 11g — une différence mineure entre deux routes du projet, sans conséquence pratique tant que le serveur tourne dans un seul fuseau horaire constant, mais qui illustre que le projet ne suit pas une convention unique et systématique pour construire des bornes de date.

## 5.8 `POST /` — le cœur du chapitre : créer, ou fusionner avec l'existante

C'est la route la plus dense du fichier — elle combine la formule financière du Volume 11a avec la règle de doublon de la spec (§5.1). Toute son exécution a lieu dans une transaction Prisma en isolation `Serializable` — le niveau d'isolation le plus strict que PostgreSQL propose, qui garantit qu'aucune autre transaction concurrente ne peut voir ni produire un état intermédiaire incohérent (deux commandes créées « en même temps » pour le même client le même jour, par exemple) : si deux requêtes concurrentes entraient en conflit réel, PostgreSQL ferait automatiquement échouer l'une des deux transactions plutôt que de laisser une incohérence s'installer.

### Cas 1 — pas de doublon : création normale

```ts
const client = await tx.client.findUnique({ where: { id: clientId }, include: { typeClient: true } });
if (!client) throw new ErreurClientInconnu();

const [debut, fin] = bornesDuJour(new Date());
const existante = await tx.commandeClient.findFirst({
  where: { clientId: client.id, dateCreation: { gte: debut, lte: fin } },
  include: INCLUDE_RELATIONS, orderBy: { numero: "asc" },
});

if (!existante) {
  const calcul = calculerCommande({
    quantiteBacs, prixParBac: client.typeClient.prixParBac,
    avanceExistante: client.avanceDisponible, montantRecu,
  });
  const creee = await tx.commandeClient.create({
    data: { clientId: client.id, quantiteBacs, montantBrut: calcul.montantBrut, avanceUtilisee: calcul.avanceUtilisee,
      montantAPercevoir: calcul.montantAPercevoir, montantRecu, dette: calcul.dette,
      avanceGeneree: calcul.avanceGeneree, nouvelleAvance: calcul.nouvelleAvance, creeParId: req.utilisateur!.id },
    include: INCLUDE_RELATIONS,
  });
  await tx.client.update({ where: { id: client.id }, data: { avanceDisponible: calcul.nouvelleAvance } });
  return { type: "creee" as const, commande: creee };
}
```

Recherche d'une commande existante pour ce client, aujourd'hui (`bornesDuJour`, §5.3). Si aucune n'existe : `calculerCommande` (Volume 11a) est appelé avec l'avance **actuelle** du client (`client.avanceDisponible`, la valeur telle qu'elle est en base à cet instant), et le résultat est écrit à la fois dans la nouvelle `CommandeClient` **et** dans `Client.avanceDisponible` (mis à jour vers `calcul.nouvelleAvance`) — deux écritures dans la même transaction, donc atomiques l'une par rapport à l'autre : impossible qu'une commande soit créée sans que le solde du client ne soit mis à jour en cohérence, ou inversement.

### Cas 2 — doublon détecté, aucune stratégie fournie : on demande à l'utilisateur

```ts
if (!strategie) {
  return { type: "conflit" as const, existante };
}
```

Si une commande existe déjà pour ce client aujourd'hui et que le corps de la requête ne précise pas de `strategie` (`commandeCreateSchema`, §5.2 : `strategie` est un champ **optionnel**), la fonction s'arrête ici et renvoie l'objet `existante` tel quel, encapsulé dans un type `"conflit"`. Rien n'est écrit en base à ce stade — la transaction se termine sans aucune modification, uniquement pour lire l'état existant de façon cohérente (le niveau `Serializable` garantit qu'aucune autre commande n'a pu apparaître entre la lecture et le retour de cette information à l'appelant).

### Cas 3 — doublon avec stratégie choisie : mise à jour de la même commande

```ts
if (strategie === "REMPLACER" && existante.reglements.length > 0) {
  return { type: "reglementsPresents" as const, existante };
}

const totaux = strategie === "MODIFIER"
  ? { quantiteBacs: existante.quantiteBacs + quantiteBacs, montantRecu: existante.montantRecu + montantRecu }
  : { quantiteBacs, montantRecu };

const avanceExistante = avanceAvantCommande({
  avanceDisponibleClient: client.avanceDisponible,
  avanceUtilisee: existante.avanceUtilisee,
  avanceGeneree: existante.avanceGeneree,
});

const calcul = calculerCommande({ quantiteBacs: totaux.quantiteBacs, prixParBac: client.typeClient.prixParBac, avanceExistante, montantRecu: totaux.montantRecu });

const maj = await tx.commandeClient.update({ where: { id: existante.id }, data: { quantiteBacs: totaux.quantiteBacs, montantBrut: calcul.montantBrut, avanceUtilisee: calcul.avanceUtilisee, montantAPercevoir: calcul.montantAPercevoir, montantRecu: totaux.montantRecu, dette: calcul.dette, avanceGeneree: calcul.avanceGeneree, nouvelleAvance: calcul.nouvelleAvance }, include: INCLUDE_RELATIONS });
await tx.client.update({ where: { id: client.id }, data: { avanceDisponible: calcul.nouvelleAvance } });
return { type: "miseAJour" as const, commande: maj, strategie };
```

Trois points à comprendre dans l'ordre :

1. **Le garde-fou `REMPLACER` + règlements existants** : si la commande visée a déjà reçu un ou plusieurs `PaiementCommande` (§5.9) et que la stratégie demandée est `REMPLACER`, la fonction refuse (`reglementsPresents`, traité en §5.8 réponse HTTP ci-dessous) **avant même de calculer quoi que ce soit**. La raison, documentée en commentaire et dans la spec (§5.1) : remplacer écraserait `montantRecu`, ce qui rendrait la somme des règlements déjà encaissés supérieure au nouveau montant reçu — une incohérence que le code choisit de refuser plutôt que d'effacer silencieusement des paiements réels. `MODIFIER` reste toujours disponible dans ce cas, car il additionne plutôt qu'il n'écrase.

2. **`totaux`** : selon la stratégie, soit la nouvelle saisie s'additionne à l'ancienne (`MODIFIER` : bacs et montant reçu cumulés), soit elle la remplace entièrement (`REMPLACER` : seule la nouvelle saisie compte, l'ancienne est oubliée). Aucune troisième possibilité — `strategie` est typé `StrategieDoublon`, une énumération à deux valeurs exactement (§5.2 des shared).

3. **`avanceAvantCommande`** (Volume 11a) : c'est ici que cette fonction, jusqu'ici seulement définie sans être appliquée dans les chapitres précédents, trouve son unique point d'usage dans tout le code applicatif. Le problème qu'elle résout : `client.avanceDisponible` **inclut déjà l'effet** de la commande `existante` (elle a été appliquée au solde au moment de sa création ou de sa dernière mise à jour) — si on utilisait cette valeur telle quelle comme `avanceExistante` pour recalculer la commande mise à jour, l'effet de la commande sur elle-même serait compté deux fois. `avanceAvantCommande` **inverse** cet effet déjà appliqué (`avanceDisponibleClient + avanceUtilisee − avanceGeneree` — additionner ce qui avait été prélevé, soustraire ce qui avait été généré) pour reconstituer l'avance telle qu'elle était **avant** que cette commande précise n'existe. `calculerCommande` est ensuite appelé avec cette avance reconstituée et les nouveaux totaux — exactement la même fonction, les mêmes règles, qu'à la création.

### La réponse HTTP — trois issues possibles

```ts
if (resultat.type === "conflit") {
  const existant = versCommandeDTO(resultat.existante);
  return res.status(409).json({
    erreur: `${existant.client.nom} a déjà la commande n°${existant.numero} aujourd'hui (...). Choisissez Modifier ou Remplacer.`,
    conflit: true, commandeExistante: existant,
    apercu: {
      MODIFIER: { quantiteBacs: existant.quantiteBacs + quantiteBacs, montantRecu: existant.montantRecu + montantRecu },
      REMPLACER: { quantiteBacs, montantRecu },
    },
  });
}
if (resultat.type === "reglementsPresents") {
  return res.status(409).json({ erreur: `La commande n°${resultat.existante.numero} a déjà reçu ${resultat.existante.reglements.length} règlement(s) : elle ne peut pas être remplacée. Utilisez « Modifier ».` });
}
```

Le cas `"conflit"` renvoie, en plus du message d'erreur, un **aperçu chiffré des deux choix possibles** (`apercu.MODIFIER` et `apercu.REMPLACER`) — calculé ici directement en arithmétique simple (addition ou substitution des valeurs saisies), **sans appeler `calculerCommande`** : c'est un aperçu des totaux bruts (bacs, montant reçu) avant recalcul financier complet, suffisant pour que l'interface (§5.11) affiche à l'utilisateur ce que chaque choix impliquerait avant qu'il ne le confirme. Le calcul financier complet (avec dette, avance générée, etc.) n'a lieu qu'une fois la stratégie effectivement choisie et soumise à nouveau.

En cas de succès (`"creee"` ou `"miseAJour"`), une notification temps réel `NOUVELLE_COMMANDE` est émise, avec un message composé dynamiquement (préfixe différent selon le type de résultat, mention conditionnelle de la dette et de l'avance générée uniquement si elles sont non nulles) — et le code de statut HTTP distingue les deux cas : `201 Created` pour une création, `200 OK` pour une mise à jour (cohérent avec la convention REST : `201` implique la création d'une nouvelle ressource, ce qui n'est pas le cas d'un `MODIFIER`/`REMPLACER`, qui opère toujours sur la ressource déjà existante).

## 5.9 `POST /:id/reglements` — régler une dette

```ts
commandesRouter.post("/:id/reglements", requirePermission("COMMANDES", "ECRITURE"), async (req, res, next) => {
  const parsed = reglementCreateSchema.safeParse(req.body);
  ...
  const resultat = await prisma.$transaction(async (tx) => {
    const commande = await tx.commandeClient.findUnique({ where: { id: req.params.id }, include: { client: true } });
    if (!commande) return { erreur: 404 as const };
    if (commande.dette <= 0) return { erreur: 409 as const };

    const calcul = calculerCommande({
      quantiteBacs: commande.quantiteBacs,
      prixParBac: commande.montantBrut / commande.quantiteBacs,
      avanceExistante: commande.avanceUtilisee,
      montantRecu: commande.montantRecu + montant,
    });
    const deltaAvance = calcul.avanceGeneree - commande.avanceGeneree;

    await tx.paiementCommande.create({ data: { commandeClientId: commande.id, montant, enregistreParId: req.utilisateur!.id } });
    const maj = await tx.commandeClient.update({ where: { id: commande.id }, data: { montantRecu: commande.montantRecu + montant, dette: calcul.dette, avanceGeneree: calcul.avanceGeneree, nouvelleAvance: commande.nouvelleAvance + deltaAvance }, include: INCLUDE_RELATIONS });
    await tx.client.update({ where: { id: commande.clientId }, data: { avanceDisponible: commande.client.avanceDisponible + deltaAvance } });
    return { commande: maj };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  ...
});
```

Un règlement ajoute un paiement à une commande déjà enregistrée dont la dette est encore ouverte (`404` si la commande n'existe pas, `409` si sa dette vaut déjà `0` — pas de règlement possible sur une commande déjà soldée). Le recalcul réutilise **encore une fois** `calculerCommande`, mais avec un choix délibéré : `prixParBac: commande.montantBrut / commande.quantiteBacs` — plutôt que de relire le prix actuel de la Qualité (qui a pu changer depuis, Volume 11f), on **reconstitue** le prix unitaire d'origine à partir des valeurs déjà figées sur la commande. Un règlement ne doit jamais changer rétroactivement le prix auquel la commande a été facturée, même si le tarif de la Qualité a été modifié entre-temps.

**`deltaAvance`** est le point le plus subtil de cette route : plutôt que de remplacer `avanceGeneree`/`nouvelleAvance` par les valeurs fraîchement recalculées (ce qui écraserait, à tort, toute avance déjà générée par d'autres commandes du client entre-temps), le code calcule **la différence** entre la nouvelle avance générée par cette commande et l'ancienne (`calcul.avanceGeneree − commande.avanceGeneree`), puis **ajoute** cette différence à `commande.nouvelleAvance` (le solde tel qu'affiché sur cette commande) et à `commande.client.avanceDisponible` (le solde réel du client, potentiellement déjà modifié par d'autres commandes créées après celle-ci). C'est cette logique différentielle, plutôt qu'un simple remplacement, qui garantit que régler une ancienne commande en retard ne perturbe pas l'avance déjà consommée ou générée par des commandes plus récentes du même client.

## 5.10 `ErreurClientInconnu`

```ts
class ErreurClientInconnu extends Error {}
```

Une classe d'erreur minimale, locale à ce fichier (contrairement à `ErreurAction`, Volume 11f, qui est exportée et réutilisée ailleurs) — levée dans la transaction si `clientId` ne correspond à aucun client existant, et capturée juste après la transaction pour répondre `400 Client inconnu`. N'embarque aucun code de statut personnalisé comme `ErreurAction` (elle n'a besoin que d'un seul cas d'usage, toujours `400`), ce qui justifie sa simplicité par rapport à la classe plus générique du Volume 11f.

## 5.11 Côté client — `CommandesPage`

Le point le plus intéressant côté frontend, à souligner en premier : **`apercu` réutilise directement `calculerCommande`, la même fonction pure importée du même paquet partagé** (Volume 2, Volume 11a) :

```tsx
const apercu = useMemo(() => {
  const nbBacs = Number(bacs);
  if (!clientChoisi || !Number.isInteger(nbBacs) || nbBacs < 1) return null;
  return calculerCommande({
    quantiteBacs: nbBacs, prixParBac: clientChoisi.typeClient.prixParBac,
    avanceExistante: clientChoisi.avanceDisponible, montantRecu: Number(recu) >= 0 ? Number(recu) || 0 : 0,
  });
}, [clientChoisi, bacs, recu]);
```

Ce n'est **pas une réimplémentation** de la formule côté client (ce qui créerait un risque de divergence si l'une des deux copies était modifiée sans l'autre) — c'est **exactement le même code**, exécuté deux fois : une fois dans le navigateur pour afficher un aperçu instantané pendant la saisie (avant tout appel réseau), une fois sur le serveur (§5.8) pour le calcul qui fait réellement foi et qui sera stocké en base. Le monorepo (Volume 2, Volume 3) rend cette réutilisation triviale — `calculerCommande` vit dans `packages/shared`, importée à l'identique des deux côtés. La même technique est reprise pour `apercuReglement` (aperçu d'un règlement avant soumission), avec le même calcul que celui de la route `POST /:id/reglements` (§5.9), reconstitution du prix unitaire d'origine comprise.

**Pré-remplissage** (§5.5) : un `useEffect` observe `clientId` et la réponse de `GET /livraisons-du-jour` — si le client choisi a une livraison du jour et que le champ « bacs » est encore vide, il se remplit automatiquement avec le total livré, et `bacsPreRemplis` passe à `true` pour afficher l'indice visuel (`commandes.bacsPreRemplisHint`, une simple phrase informative, pas un verrou). Le champ reste un `<input>` standard, librement modifiable ensuite — aucune protection contre la modification, cohérent avec la spec (« un indice modifiable »).

**Le dialogue de conflit** : `creerCommande` est une mutation dont le gestionnaire d'échec (`onError`) inspecte spécifiquement le cas `409` avec un corps de forme `ConflitCommandeDTO` :

```tsx
onError: (e) => {
  if (e instanceof ApiError && e.status === 409) {
    const corps = e.corps as ConflitCommandeDTO | undefined;
    if (corps?.conflit) { setConflit(corps); return; }
  }
  setErreurCommande(e instanceof Error ? e.message : t("commandes.saveError"));
},
```

Un `409` avec `conflit: true` dans le corps n'est **pas traité comme une erreur générique** — il ouvre le dialogue de choix (Modifier / Remplacer), pré-rempli avec les deux aperçus renvoyés par le serveur (§5.8). L'utilisateur choisit, et la mutation est relancée avec la `strategie` correspondante (`creerCommande.mutate("MODIFIER")` ou `"REMPLACER"`) — un second appel réseau à la même route `POST /`, cette fois avec le champ `strategie` renseigné, qui emprunte le Cas 3 de la route serveur (§5.8) plutôt que le Cas 2. Un `409` sans `conflit: true` (par exemple, le cas `reglementsPresents`) tombe dans la branche générique et s'affiche comme un message d'erreur simple dans le formulaire.

**Création rapide de client** : un dialogue séparé (`dialogClient`), accessible depuis le formulaire de commande pour ne pas interrompre la saisie — conforme à la spec (§5.1) qui distingue explicitement cette création rapide de la gestion complète des clients (écran séparé, hors périmètre de ce chapitre). Sur succès, le client nouvellement créé est automatiquement présélectionné dans le formulaire de commande en cours (`setClientId(r.client.id)`), pour enchaîner directement sur la saisie de sa première commande sans ressaisir sa sélection.

## 5.12 Exemple chiffré bout en bout — la détection de doublon

Reprenons l'exemple exact donné par la spécification (section 3.4), pour un client Dépositaire à 4 100 Fc/bac, avec une commande n°12 déjà enregistrée aujourd'hui : 50 bacs, 205 000 Fc reçus. Une seconde saisie arrive pour ce même client, aujourd'hui : 10 bacs, 41 000 Fc reçus.

1. `POST /api/commandes` avec `{ clientId, quantiteBacs: 10, montantRecu: 41000 }`, sans `strategie`.
2. La route trouve `existante` (commande n°12) via `bornesDuJour`. Aucune `strategie` fournie → réponse `409`, avec `commandeExistante` (n°12, 50 bacs, 205 000 Fc) et un aperçu des deux choix : `MODIFIER: { quantiteBacs: 60, montantRecu: 246000 }`, `REMPLACER: { quantiteBacs: 10, montantRecu: 41000 }` — exactement les chiffres donnés par la spec.
3. L'utilisateur choisit **Modifier**. Second appel : `POST /api/commandes` avec `{ clientId, quantiteBacs: 10, montantRecu: 41000, strategie: "MODIFIER" }`.
4. `totaux = { quantiteBacs: 60, montantRecu: 246000 }` (50+10, 205000+41000). Supposons que le client n'avait aucune avance avant la commande n°12 et que la commande n°12 elle-même n'avait ni dette ni avance générée (`avanceUtilisee: 0`, `avanceGeneree: 0`) : `avanceAvantCommande({ avanceDisponibleClient: 0, avanceUtilisee: 0, avanceGeneree: 0 }) = 0`.
5. `calculerCommande({ quantiteBacs: 60, prixParBac: 4100, avanceExistante: 0, montantRecu: 246000 })` → `montantBrut = 246000`, `avanceUtilisee = 0`, `montantAPercevoir = 246000`, `dette = max(0, 246000 − 246000) = 0`, `avanceGeneree = max(0, 246000 − 246000) = 0`, `nouvelleAvance = 0`.
6. La commande n°12 (toujours le même numéro, jamais un nouveau) est mise à jour : 60 bacs, 246 000 Fc reçus, toujours soldée. Réponse `200` (mise à jour, pas `201`).

**Variante Remplacer** : si l'utilisateur avait choisi Remplacer à l'étape 3, `totaux = { quantiteBacs: 10, montantRecu: 41000 }` (la saisie de 50 bacs / 205 000 Fc est oubliée) ; la commande n°12 finirait avec seulement 10 bacs et 41 000 Fc reçus. Si la commande n°12 avait déjà un règlement enregistré (§5.9), cette même tentative de Remplacer serait refusée avec `409` avant tout calcul, invitant à utiliser Modifier à la place.

## 5.13 Cas limites

| Situation | Comportement |
|---|---|
| `clientId` inexistant | `400 Client inconnu` (`ErreurClientInconnu`, §5.10). |
| Deuxième commande le même jour, sans `strategie` | `409` avec aperçu des deux choix, aucune écriture (§5.8, Cas 2). |
| `REMPLACER` sur une commande ayant déjà des règlements | `409`, refusé explicitement, `MODIFIER` reste possible (§5.8). |
| Règlement sur une commande sans dette (`dette <= 0`) | `409 Cette commande n'a pas de dette à régler` (§5.9). |
| Règlement sur une commande introuvable | `404 Commande introuvable` (§5.9). |
| Deux requêtes concurrentes créant/modifiant la même commande le même jour | Isolation `Serializable` : l'une des deux transactions échoue plutôt que de produire un état incohérent (§5.8). |
| Deux ouvertures simultanées de l'écran déclenchant `verifierAlertesDette` pour la même commande en retard | Une seule notification part, garanti par le `updateMany` compare-and-set (§5.6). |
| Liste `GET /` sur un historique très volumineux | Aucune pagination ni plafond — toutes les commandes correspondant aux filtres sont renvoyées (§5.7). |
| Qualité renommée après la création d'une commande | Le nom affiché (`qualite`) change rétroactivement (relation vivante) ; les montants, eux, restent figés (§5.2). |

## 5.14 Croisement avec la spécification

Aucun écart trouvé. La formule financière (déjà validée au Volume 11a), la règle « une commande par client et par jour » avec ses deux stratégies Modifier/Remplacer, le refus de Remplacer sur une commande déjà réglée, le recalcul via `avanceAvantCommande` hors l'effet de la commande elle-même, le tableau de bord journalier, l'alerte de dette ponctuelle et non répétée, et le pré-remplissage optionnel depuis le Bon de livraison correspondent tous, point par point et jusqu'aux chiffres de l'exemple (§5.12), à la section 3.4 de `docs/spec-boulangerie.md`.

## 5.15 Résumé

`commandes.ts` est le point où la formule pure du Volume 11a rencontre une vraie règle métier de concurrence : une seule commande par client et par jour, avec un choix explicite laissé à l'utilisateur (Modifier ou Remplacer) plutôt qu'une décision automatique. La transaction `Serializable` et le compare-and-set de l'alerte de dette montrent, dans un seul fichier, deux techniques différentes pour garantir la cohérence sous concurrence sans verrou explicite. Côté client, `calculerCommande` est réutilisée telle quelle pour l'aperçu instantané — un exemple concret du bénéfice du monorepo déjà présenté au Volume 3. Aucun écart avec la spécification, y compris sur l'exemple chiffré exact qu'elle donne.

---

**Suite →** Volume 11i — Commissions (`apps/api/src/routes/commissions.ts`, `apps/web/src/pages/Commissions.tsx`), qui dérive directement des commandes de Qualité « Maman » traitées dans ce chapitre.
