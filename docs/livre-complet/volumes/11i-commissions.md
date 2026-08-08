# Volume 11i — Commissions

**Niveau de risque : 1 — Critique.** Traitement exhaustif malgré la taille réduite du module — il s'agit d'argent réellement dû à des clientes, même si le module lui-même n'écrit jamais rien en base (voir §5.1). Ce chapitre est court : `commissions.ts` ne contient qu'une seule route, et réutilise entièrement les données déjà produites par le Volume 11h.

## Fiche d'identité des fichiers couverts

| Fichier | Lignes | Rôle |
|---|---:|---|
| `apps/api/src/routes/commissions.ts` | 50 | Unique route : liste des commandes génératrices de commission, avec le total de la période |
| `apps/web/src/pages/Commissions.tsx` | 207 | Écran de consultation, filtrable par période, exportable |
| `packages/shared/src/index.ts` (extrait) | — | `montantTotalPaye`, `CommissionLigneDTO` |

- **Qui les appelle** : `commissionsRouter` est monté sur `/api/commissions` dans `app.ts` ; `CommissionsPage` est affichée par la route `/commissions` de `App.tsx`.
- **Ce qu'ils appellent** : `prisma.commandeClient` (lecture seule — **aucun modèle `Commission` n'existe** dans le schéma, voir §5.1), `montantTotalPaye` (fonction pure partagée), `BarreExport` (composant Niveau 2/3 d'export impression/PDF/e-mail, déjà utilisé ailleurs dans l'application — non détaillé dans ce chapitre, traité au Volume 18).
- **Données modifiées** : **aucune**. C'est le premier module Niveau 1 de ce livre entièrement en lecture seule — voir §5.1.

## 5.1 Vue d'ensemble intuitive — une vue, pas une table

> ### 3.11 Commissions
> Vue dédiée aux commandes de type **Maman** (les seules à générer une commission). Calcul **automatique** — aucune saisie manuelle. Visible en lecture seule par le Caissier(ère), le Chargé des commandes et le DG.
> — `docs/spec-boulangerie.md`, section 3.11

Le mot « vue » dans la spec n'est pas une figure de style : il n'existe, dans `prisma/schema.prisma`, **aucun modèle `Commission`**. Chaque commande d'une cliente de Qualité « Maman » génère déjà, au moment de son enregistrement (Volume 11h), une commande `CommandeClient` classique — la commission n'est **jamais stockée séparément**, elle est **recalculée à la lecture**, à chaque appel de `GET /api/commissions`, à partir des commandes déjà existantes. C'est cohérent avec le glossaire du code, déjà repéré au Volume 11h (index « par terme métier ») : ce module est qualifié en commentaire de *« vue dérivée des commandes Maman »*. La distinction entre un module qui *écrit* sa propre donnée et un module qui se contente de *recalculer une projection* d'une donnée qui vit ailleurs est un point de compréhension central pour ce chapitre — sans lui, on pourrait chercher à tort une table ou une route d'écriture qui n'existent tout simplement pas.

## 5.2 `GET /api/commissions` — l'unique route

```ts
commissionsRouter.use(requireAuth);

commissionsRouter.get("/", requirePermission("COMMISSIONS", "LECTURE"), async (req, res, next) => {
  try {
    const { du, au } = req.query as Record<string, string | undefined>;
    const dateCreation: Prisma.DateTimeFilter = {};
    if (du) dateCreation.gte = new Date(`${du}T00:00:00`);
    if (au) dateCreation.lte = new Date(`${au}T23:59:59.999`);

    const commandes = await prisma.commandeClient.findMany({
      where: { client: { typeClient: { commissionParBac: { gt: 0 } } }, ...(du || au ? { dateCreation } : {}) },
      include: { client: { select: { nom: true, typeClient: { select: { commissionParBac: true } } } } },
      orderBy: { numero: "desc" },
    });

    const lignes: CommissionLigneDTO[] = commandes.map((c) => ({
      commandeId: c.id, numero: c.numero, dateCreation: c.dateCreation.toISOString(),
      clientNom: c.client.nom, quantiteBacs: c.quantiteBacs,
      montantTotalPaye: montantTotalPaye(c),
      commission: c.quantiteBacs * c.client.typeClient.commissionParBac,
    }));

    res.json({ commissions: lignes, totalCommissions: lignes.reduce((somme, l) => somme + l.commission, 0) });
  } catch (e) { next(e); }
});
```

**Le filtre qui définit tout le module** : `client: { typeClient: { commissionParBac: { gt: 0 } } }`. Aucune commande de Qualité Dépositaire ou Vente cash n'apparaît jamais dans cette liste — non pas parce que le code vérifie explicitement `typeClient.nom === "Maman"`, mais parce qu'il interroge directement le champ numérique `commissionParBac` de la Qualité associée au client. **Une conséquence directe et importante** : si un Admin créait, via les Paramètres (Volume 11f, `MODIFIER_TYPE_CLIENT`), une quatrième Qualité avec une commission non nulle, ses commandes apparaîtraient automatiquement ici, sans aucune modification de ce fichier — le module Commissions ne connaît pas la notion de « Maman » en tant que telle, seulement la règle générale « toute Qualité dont la commission par bac est strictement positive ». La spec, elle, parle explicitement des « commandes de type Maman » — une formulation plus étroite en apparence, mais qui correspond exactement à l'unique Qualité ayant une commission non nulle au moment de l'audit (Volume 11a : Dépositaire et Vente cash à 0 Fc de commission, Maman à 1 650 Fc). Le code généralise donc une règle que la spec énonce pour le cas particulier actuellement en vigueur — pas une contradiction, une implémentation par une condition plus générale que ce que l'énoncé littéral suggère.

Le filtre de dates (`du`/`au`) reprend exactement la même technique — bornes en heure locale implicite, sans suffixe UTC — que celle déjà rencontrée dans `GET /api/commandes` (Volume 11h, §5.7), cohérent puisque les deux routes filtrent le même champ (`CommandeClient.dateCreation`).

**Le calcul de chaque ligne**, pour une commande incluse dans le résultat :
- `montantTotalPaye(c)` : une fonction pure partagée (§5.3).
- `commission: c.quantiteBacs * c.client.typeClient.commissionParBac` — calculée ici, directement dans la route, **pas** via une fonction dédiée de `packages/shared`. C'est la seule multiplication du fichier, suffisamment simple pour ne pas justifier une fonction séparée (à la différence de `calculerCommande`, Volume 11a, dont la complexité — six champs interdépendants — justifiait pleinement son extraction).

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
| Nouvelle Qualité créée avec une commission non nulle | Ses commandes apparaissent automatiquement dans ce module, sans modification du code (§5.2). |
| Commande soldée grâce à une avance, sans aucun paiement en espèces ce jour-là | `montantTotalPaye` affiche le montant brut complet, pas `montantRecu` (§5.3). |
| Commande avec dette encore ouverte | `montantTotalPaye` affiche `montantRecu` (le montant partiel réellement remis) ; la commission, elle, reste calculée sur `quantiteBacs` sans égard à la dette (§5.3). |
| Aucun filtre de date fourni | Toutes les commandes générant une commission sont renvoyées, sans plafond ni pagination — même constat qu'au Volume 11h pour `GET /api/commandes`. |
| Aucune commande Maman sur la période filtrée | Liste vide, `totalCommissions: 0` ; l'écran affiche un message vide plutôt qu'un tableau sans lignes. |

## 5.6 Croisement avec la spécification

Aucun écart trouvé. Les six champs de la spec (N°, Date, Nom du client, Bacs, Montant total payé, Commission disponible) correspondent exactement aux six champs de `CommissionLigneDTO`, avec les mêmes règles de calcul, y compris la formulation quasi verbatim de la règle « payé à 100 % même si une partie vient de l'avance » retrouvée dans le commentaire du code source lui-même. La seule nuance relevée (§5.2, généralisation à « toute Qualité à commission non nulle » plutôt qu'un test explicite sur le nom « Maman ») ne contredit rien dans la spec — elle en est une implémentation plus générale, cohérente avec le comportement actuellement observable.

## 5.7 Résumé

Le module Commissions est le premier module Niveau 1 de ce livre à ne posséder aucune donnée propre : c'est une simple relecture, recalculée à chaque consultation, des commandes de clientes dont la Qualité porte une commission non nulle — jamais une Qualité nommément « Maman » au sens littéral du code, mais toute Qualité dont `commissionParBac > 0`. Sa seule vraie subtilité financière, `montantTotalPaye`, mérite d'être bien comprise : une commande soldée grâce à une avance est affichée comme intégralement payée, parce que l'argent correspondant a réellement été versé, seulement lors d'une commande antérieure. Aucun écart avec la spécification.

---

**Suite →** Volume 11j — Caisse (`apps/api/src/routes/caisse.ts`, `apps/web/src/pages/Caisse.tsx`), le registre journalier déjà mentionné au Volume 11a pour sa formule de dépense farine.
