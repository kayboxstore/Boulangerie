# Volume 11i — Commissions

**Niveau de risque : 1 — Critique.** Traitement exhaustif malgré la taille réduite du module — il s'agit d'argent réellement dû à des clientes, même si le module lui-même n'écrit jamais rien en base (voir §5.1). Ce chapitre est court : `commissions.ts` ne contient qu'une seule route, et réutilise entièrement les données déjà produites par le Volume 11h.

## Fiche d'identité des fichiers couverts

| Fichier | Lignes | Rôle |
|---|---:|---|
| `apps/api/src/routes/commissions.ts` | 65 | Unique route : liste des commandes génératrices de commission, avec le total de la période |
| `apps/web/src/pages/Commissions.tsx` | 207 | Écran de consultation, filtrable par période, exportable |
| `packages/shared/src/index.ts` (extrait) | — | `montantTotalPaye`, `CommissionLigneDTO` |

- **Qui les appelle** : `commissionsRouter` est monté sur `/api/commissions` dans `app.ts` ; `CommissionsPage` est affichée par la route `/commissions` de `App.tsx`.
- **Ce qu'ils appellent** : `prisma.commandeClient` (lecture seule — **aucun modèle `Commission` n'existe** dans le schéma, voir §5.1), `montantTotalPaye` (fonction pure partagée), `BarreExport` (composant Niveau 2/3 d'export impression/PDF/e-mail, déjà utilisé ailleurs dans l'application — non détaillé dans ce chapitre, traité au Volume 18).
- **Données modifiées** : **aucune**. C'est le premier module Niveau 1 de ce livre entièrement en lecture seule — voir §5.1.

## 5.1 Vue d'ensemble intuitive — un champ figé, relu mais jamais recalculé

> ### 3.11 Commissions
> Vue dédiée aux commandes dont la commission a été générée (les « Mamans », les seules à en générer une). Calcul **automatique** — aucune saisie manuelle. Visible en lecture seule par le Caissier(ère), le Chargé des commandes et le DG.
> — `docs/spec-boulangerie.md`, section 3.11

Le mot « vue » dans la spec désigne un écran de consultation, pas — comme on pourrait le supposer à tort — un recalcul permanent à la lecture : il n'existe, dans `prisma/schema.prisma`, **aucun modèle `Commission` séparé** (sur ce point la spec ne ment pas), mais `CommandeClient` porte bel et bien un champ propre, `commission` (`Int`, non nul en base), qui est écrit **une seule fois**, au moment où la commande est créée ou modifiée par le flux manuel (`apps/api/src/routes/commandes.ts`, Volume 11h), puis **jamais retouché ensuite**. `GET /api/commissions` ne fait que **relire** ce champ déjà calculé — il ne le recalcule à aucun moment.

**Correction importante à noter (Lot 7 pt 6)** : la commission a longtemps été recalculée dynamiquement à chaque lecture, à partir du taux *courant* de `TypeClient.commissionParBac` — un comportement corrigé précisément parce qu'il réécrivait rétroactivement l'historique si le taux changeait ensuite en Paramètres, ou si le client était reclassé dans une autre Qualité entre-temps. Le commentaire en tête de `apps/api/src/routes/commissions.ts` (lignes 12-18) est explicite sur l'état actuel : *« La commission est figée sur `CommandeClient` au taux en vigueur au moment de l'enregistrement (Lot 7 pt 6) : filtrer/afficher cette valeur, jamais le taux courant du `TypeClient` »*. `calculerCommission` (`packages/shared/src/index.ts`, `quantiteBacs × commissionParBac`) n'est appelée que depuis `commandes.ts` — jamais depuis `commissions.ts`, qui ne fait que lire `CommandeClient.commission`. La distinction entre un module qui *écrit* sa propre donnée et un module qui se contente de *relire* une donnée déjà figée ailleurs reste le point de compréhension central pour ce chapitre — sans lui, on pourrait chercher à tort une route d'écriture qui n'existe pas dans ce fichier, ou croire, à tort désormais, que modifier le taux d'une Qualité changerait rétroactivement les commissions déjà affichées.

## 5.2 `GET /api/commissions` — l'unique route

```ts
commissionsRouter.use(requireAuth);

// Module Commissions (section 3.11) : vue dérivée des commandes dont la
// commission a été générée (> 0 Fc/bac — les « Mamans »). La commission est
// figée sur CommandeClient au taux en vigueur au moment de l'enregistrement
// (Lot 7 pt 6) : filtrer/afficher cette valeur, jamais le taux courant du
// TypeClient, pour ne pas réécrire rétroactivement l'historique si le taux
// change ensuite ou si le client est reclassé dans une autre Qualité.
// Lecture seule : Caissier(ère) et DG via la matrice de permissions.
commissionsRouter.get("/", requirePermission("COMMISSIONS", "LECTURE"), async (req, res, next) => {
  try {
    const { du, au } = req.query as Record<string, string | undefined>;

    if (du && !dateISOSchema.safeParse(du).success) {
      return res.status(400).json({ erreur: "Date de début invalide (AAAA-MM-JJ)" });
    }
    if (au && !dateISOSchema.safeParse(au).success) {
      return res.status(400).json({ erreur: "Date de fin invalide (AAAA-MM-JJ)" });
    }
    if (du && au && du > au) {
      return res.status(400).json({ erreur: "La date de fin doit suivre la date de début" });
    }

    const dateCreation: Prisma.DateTimeFilter = {};
    if (du) dateCreation.gte = bornesJourLomoto(du)[0];
    if (au) dateCreation.lte = bornesJourLomoto(au)[1];

    const commandes = await prisma.commandeClient.findMany({
      where: { commission: { gt: 0 }, ...(du || au ? { dateCreation } : {}) },
      include: { client: { select: { nom: true } } },
      orderBy: { numero: "desc" },
    });

    const lignes: CommissionLigneDTO[] = commandes.map((c) => ({
      commandeId: c.id, numero: c.numero, dateCreation: c.dateCreation.toISOString(),
      clientNom: c.client.nom, quantiteBacs: c.quantiteBacs,
      montantTotalPaye: montantTotalPaye(c),
      commission: c.commission,
    }));

    res.json({ commissions: lignes, totalCommissions: lignes.reduce((somme, l) => somme + l.commission, 0) });
  } catch (e) { next(e); }
});
```

**Le filtre qui définit tout le module** : `commission: { gt: 0 }`, directement sur le champ **stocké** de `CommandeClient` — pas, comme un stade antérieur du code le faisait, un test sur `client.typeClient.commissionParBac` (qui n'aurait donné que le taux *courant* de la Qualité, jamais celui réellement en vigueur à l'enregistrement de chaque commande). Aucune commande de Qualité Dépositaire ou Vente cash n'apparaît jamais dans cette liste, pour une raison de fond équivalente à l'ancien comportement — leur `commissionParBac` par défaut vaut 0 Fc, donc `calculerCommission` (appelée dans `commandes.ts`) leur écrit `commission: 0` dès la création — mais avec une nuance temporelle désormais différente : un client **reclassé après coup** d'une Qualité à commission vers une Qualité sans commission conserve toutes ses commandes déjà enregistrées dans ce module (leur `commission` stockée reste positive, figée), alors que le comportement précédent (recalcul à la lecture sur le taux courant) les aurait fait disparaître rétroactivement de la liste. Symétriquement, relever `commissionParBac` d'une Qualité existante en Paramètres n'ajoute aucune commission aux commandes déjà enregistrées sous l'ancien taux — seules les commandes **futures** de cette Qualité porteront le nouveau taux, figé à leur tour dès leur enregistrement.

**Une conséquence directe** : si un Admin créait, via les Paramètres (Volume 11f, `MODIFIER_TYPE_CLIENT`), une quatrième Qualité avec une commission non nulle, les commandes **futures** de ses clients apparaîtraient automatiquement ici — `calculerCommission` leur écrirait une `commission` positive dès leur enregistrement — sans aucune modification de ce fichier. Le module Commissions ne connaît toujours pas la notion de « Maman » en tant que telle, seulement la règle générale « toute commande dont la `commission` enregistrée est strictement positive ». La spec, elle, parle explicitement des « commandes des Mamans » — une formulation plus étroite en apparence, mais qui correspond exactement à l'unique Qualité ayant une commission non nulle au moment de l'audit (Volume 11a : Dépositaire et Vente cash à 0 Fc de commission, Maman à 1 650 Fc). Le code généralise donc une règle que la spec énonce pour le cas particulier actuellement en vigueur — pas une contradiction, une implémentation par une condition plus générale que ce que l'énoncé littéral suggère.

Le filtre de dates (`du`/`au`) valide chaque borne avec `dateISOSchema` (`400` si mal formée) et rejette `du > au` (`400`), puis délègue à `bornesJourLomoto` (`apps/api/src/lib/temps.ts`) pour convertir chaque date en bornes de **jour Lomoto** — même fonction que celle déjà rencontrée pour le résumé de clôture quotidien (Volume 11z-5) — plutôt que de construire les bornes à la main avec un suffixe `T00:00:00`/`T23:59:59.999` en heure locale implicite comme le faisait un stade antérieur du code.

**Le calcul de chaque ligne**, pour une commande incluse dans le résultat :
- `montantTotalPaye(c)` : une fonction pure partagée (§5.3).
- `commission: c.commission` — une simple **lecture** du champ déjà figé sur `CommandeClient`, **aucune multiplication n'a lieu dans cette route** : le calcul (`quantiteBacs × commissionParBac`) a déjà eu lieu une fois pour toutes, à l'enregistrement de la commande, dans `commandes.ts` (Volume 11h).

`totalCommissions` : la somme de toutes les commissions de la période filtrée, calculée en une ligne (`reduce`) après coup — un total qui n'existe dans aucun champ de base, purement dérivé de la réponse déjà construite.

## 5.3 `montantTotalPaye` — une nuance financière à ne pas manquer

```ts
/**
 * « Montant total payé » du module Commissions : si la commande est soldée
 * (dette = 0), on affiche le brut — payé à 100 % même si une partie vient de
 * l'avance ; sinon le montant partiel effectivement remis.
 */
export function montantTotalPaye(commande: { dette: number; montantBrut: number; montantRecu: number }): number {
  return commande.dette === 0 ? commande.montantBrut : commande.montantRecu;
}
```

Une fonction pure de deux lignes, mais dont le sens n'est pas immédiat sans exemple. La question qu'elle répond : *combien la cliente a-t-elle effectivement payé pour cette commande, pour l'affichage du module Commissions ?* On pourrait s'attendre à ce que la réponse soit toujours `montantRecu` (l'argent physiquement remis à cette commande précise) — ce n'est **pas** ce que fait cette fonction, et c'est volontaire.

**Exemple chiffré** — reprenons le premier exemple du Volume 11a (client Maman, 6 000 Fc/bac) :

| | Bacs | Brut | Avance utilisée | À percevoir | Reçu | Dette |
|---|---|---|---|---|---|---|
| Commande #1 | 3 | 18 000 | 0 | 18 000 | 20 000 | 0 |
| Commande #2 (lendemain) | 5 | 30 000 | 2 000 | 28 000 | 28 000 | 0 |

Pour la commande #2 : `montantRecu = 28000`, mais `montantBrut = 30000` — la différence de 2 000 Fc a été couverte par l'avance générée par la commande #1, pas par un paiement en espèces ce jour-là. `montantTotalPaye` renvoie ici `30000` (le brut), parce que `dette === 0` : **du point de vue du module Commissions, cette commande est considérée payée intégralement**, y compris la part venue de l'avance — la spec le formule explicitement : *« considéré payé à 100 % même si une partie vient de l'avance »*. La logique : l'avance elle-même provient d'un paiement réel, effectué lors d'une commande antérieure (ici, les 2 000 Fc en trop de la commande #1) — l'argent a bien été remis à l'entreprise à un moment donné, seulement pas nécessairement à l'occasion de *cette* commande précise. Le module Commissions s'intéresse à *ce qui a été effectivement réglé au total pour ce lot de bacs*, pas à sa provenance chronologique exacte.

**À l'inverse**, si une commande a encore une dette ouverte (`dette > 0`), `montantTotalPaye` renvoie `montantRecu` — le montant partiellement versé, sans y ajouter de brut fictif : la commande n'est pas soldée, donc rien ne justifie d'afficher plus que ce qui a réellement été remis. La commission elle-même (§5.2), en revanche, **ne dépend jamais de `montantTotalPaye`** — elle se calcule uniquement à partir de `quantiteBacs`, qu'il y ait dette ou non. Une cliente Maman qui a reçu ses bacs mais n'a pas encore fini de payer génère malgré tout la commission correspondante, dès l'enregistrement de la commande : `montantTotalPaye` n'affecte que la colonne d'affichage « Montant total payé » de l'écran, jamais le montant de la commission elle-même.

## 5.4 Côté client — `CommissionsPage`

Un écran de consultation pure, sans aucune mutation (`useMutation`) dans tout le fichier — cohérent avec un module entièrement en lecture (§5.1). Les filtres de période (`du`/`au`, deux champs `<input type="date">`) pilotent la clé de la requête TanStack Query, exactement sur le même schéma que le Journal d'audit (Volume 11g) et la liste des Commandes (Volume 11h) : chaque changement déclenche une nouvelle requête filtrée côté serveur, pas un filtrage en mémoire sur des données déjà chargées.

**`construireSections`** prépare les données de la page pour `BarreExport`, un composant partagé (Volume 18) qui propose l'impression, l'export PDF et l'envoi par e-mail d'un document reprenant le contenu affiché — deux sections : le tableau des commandes Maman de la période (mêmes six colonnes que l'écran), et une section « Total » isolée avec le total de la période. Ce fichier ne détaille pas lui-même comment `BarreExport` transforme ces sections en PDF ou en pièce jointe e-mail — ce mécanisme, commun à plusieurs écrans de rapport de l'application, est traité une seule fois au Volume 18 plutôt que d'être répété à chaque chapitre qui l'utilise.

Un détail d'interface pensé pour l'impression, visible dans le JSX via la classe `lomoto-print-only` : la carte de filtres elle-même (les champs de date) porte la classe `no-print` — elle ne doit pas apparaître sur un document imprimé, où les contrôles interactifs n'ont pas de sens — tandis qu'un paragraphe distinct, normalement invisible à l'écran, **n'apparaît qu'à l'impression** pour rappeler en texte simple la période sélectionnée (*« du ... au ... »*) : sans lui, un document imprimé sans période affichée ne permettrait pas de savoir sur quoi porte le total qui y figure. Le commentaire du code le dit explicitement : *« si le papier ne dirait pas sur quoi porte le total »*.

## 5.5 Cas limites

| Situation | Comportement |
|---|---|
| Nouvelle Qualité créée avec une commission non nulle | Les commandes **futures** de ses clients apparaissent automatiquement dans ce module dès leur enregistrement, sans modification du code (§5.2) ; aucune commande passée ne peut y apparaître rétroactivement. |
| `commissionParBac` d'une Qualité relevé ou abaissé en Paramètres après coup | Aucun effet sur les commandes déjà enregistrées : leur `commission` reste celle figée à leur propre enregistrement (Lot 7 pt 6, §5.1). Seules les commandes créées après le changement portent le nouveau taux. |
| Client reclassé d'une Qualité à commission vers une Qualité sans commission (ou l'inverse) | Ses commandes déjà enregistrées gardent leur `commission` d'origine, figée à l'enregistrement — elles ne disparaissent ni n'apparaissent rétroactivement dans ce module suite à la reclassification (§5.2). |
| Commande soldée grâce à une avance, sans aucun paiement en espèces ce jour-là | `montantTotalPaye` affiche le montant brut complet, pas `montantRecu` (§5.3). |
| Commande avec dette encore ouverte | `montantTotalPaye` affiche `montantRecu` (le montant partiel réellement remis) ; la commission, elle, reste calculée sur `quantiteBacs` sans égard à la dette (§5.3). |
| Aucun filtre de date fourni | Toutes les commandes générant une commission sont renvoyées, sans plafond ni pagination — même constat qu'au Volume 11h pour `GET /api/commandes`. |
| Aucune commande Maman sur la période filtrée | Liste vide, `totalCommissions: 0` ; l'écran affiche un message vide plutôt qu'un tableau sans lignes. |

## 5.6 Croisement avec la spécification

Aucun écart trouvé. Les six champs de la spec (N°, Date, Nom du client, Bacs, Montant total payé, Commission disponible) correspondent exactement aux six champs de `CommissionLigneDTO`, avec les mêmes règles de calcul, y compris la formulation quasi verbatim de la règle « payé à 100 % même si une partie vient de l'avance » retrouvée dans le commentaire du code source lui-même. Le champ 6 de la spec (« Commission disponible ») précise explicitement, depuis le Lot 7 pt 6, qu'elle est *« calculée au taux de commission en vigueur à l'enregistrement de la commande... **figée** sur la commande elle-même : un changement ultérieur du taux dans les Paramètres, ou un changement de Qualité du client, ne modifie jamais la commission déjà affichée ici »* (`docs/spec-boulangerie.md`, section 3.11) — correspondance exacte avec `CommandeClient.commission` (§5.1) et `calculerCommission` (Volume 11h). La seule nuance relevée (§5.2, généralisation à « toute commande dont la `commission` enregistrée est non nulle » plutôt qu'un test explicite sur le nom « Maman ») ne contredit rien dans la spec — elle en est une implémentation plus générale, cohérente avec le comportement actuellement observable.

## 5.7 Résumé

Le module Commissions est le premier module Niveau 1 de ce livre à ne posséder aucune donnée propre — mais, depuis la correction Lot 7 pt 6, c'est une simple **relecture** d'un champ déjà figé, jamais un recalcul à la lecture : `CommandeClient.commission` est écrit une fois pour toutes à l'enregistrement de la commande (`calculerCommande`/`calculerCommission`, Volume 11h), au taux `TypeClient.commissionParBac` en vigueur à cet instant précis, puis ne varie plus jamais, même si ce taux change ensuite en Paramètres ou si le client change de Qualité. Le module filtre et affiche donc toute commande dont la `commission` enregistrée est strictement positive — jamais une Qualité nommément « Maman » au sens littéral du code, mais l'implémentation courante fait que seule cette Qualité produit aujourd'hui des commandes à commission non nulle. Sa seule vraie subtilité financière, `montantTotalPaye`, mérite d'être bien comprise : une commande soldée grâce à une avance est affichée comme intégralement payée, parce que l'argent correspondant a réellement été versé, seulement lors d'une commande antérieure. Aucun écart avec la spécification.

---

**Suite →** Volume 11j — Caisse (`apps/api/src/routes/caisse.ts`, `apps/web/src/pages/Caisse.tsx`), le registre journalier déjà mentionné au Volume 11a pour sa formule de dépense farine.
