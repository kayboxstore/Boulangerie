# Volume 11a — Noyau financier et permissions

**Niveau de risque : 1 — Critique.** Traitement exhaustif : chaque ligne de logique est expliquée, avec tables de vérité et exemples chiffrés bout en bout.

## Fiche d'identité du fichier

- **Chemin exact** : `packages/shared/src/index.ts`
- **Responsabilité** : ce fichier unique (1942 lignes) est le point de convergence de tout le projet — il définit dans un seul endroit les types, les énumérations, les schémas de validation Zod, les DTO (formes de réponse d'API) et un petit nombre de **fonctions de calcul pures** partagées entre le serveur et le client. Ce chapitre ne couvre que les quatre fonctions les plus critiques financièrement et pour la sécurité : `calculerCommande`, `avanceAvantCommande`, `calculerDepenseFarine` et `aAcces`. Le reste du fichier (DTO et schémas des autres modules) est couvert au fil des chapitres correspondants — voir la note de `ETAT_DE_PROGRESSION.md` §6.
- **Pourquoi il existe à cet endroit précis** : ces fonctions doivent produire **exactement le même résultat** que le calcul ait lieu côté serveur (source de vérité, celle qui écrit en base) ou côté client (aperçu affiché avant l'enregistrement). Les dupliquer dans `apps/api` et `apps/web` créerait un risque réel de divergence — un bug corrigé d'un côté et oublié de l'autre afficherait un aperçu inexact au caissier. Le monorepo (Volume 2 et 3) existe en grande partie pour rendre ce partage possible sans copier-coller.
- **Qui l'importe** : `apps/api/src/routes/commandes.ts`, `apps/api/src/routes/caisse.ts`, `apps/api/src/middleware/auth.ts`, `apps/api/src/routes/zones-depositaires.ts`, `apps/api/src/routes/export.ts`, `apps/api/src/routes/travailleurs.ts`, `apps/web/src/pages/Commandes.tsx`, `apps/web/src/pages/Caisse.tsx`, `apps/web/src/lib/auth.tsx`, et bien d'autres fichiers pour les types/DTO non couverts dans ce chapitre.
- **Ce qu'il importe** : uniquement `zod`, pour construire les schémas de validation (voir Volume 15).
- **Entrées** : aucune (ce sont des fonctions pures — voir §Notion ci-dessous — leurs seules entrées sont leurs paramètres).
- **Sorties** : des valeurs calculées, retournées à l'appelant. Aucune écriture en base, aucun appel réseau.
- **Données ou états modifiés** : **aucun**. C'est la propriété la plus importante de ce chapitre — voir §2.6.
- **Place dans l'architecture** : c'est la couche la plus basse et la plus stable du projet. Tout en dépend ; elle ne dépend de rien d'applicatif.

## 2.1 Notion préalable : qu'est-ce qu'une « fonction pure » ?

Avant d'entrer dans le détail, une notion revient sans cesse dans ce chapitre : la **fonction pure**. Une fonction est dite pure quand elle respecte deux règles :

1. **Son résultat ne dépend que de ses paramètres** — appelée deux fois avec les mêmes valeurs, elle renvoie toujours exactement le même résultat, peu importe l'heure, l'état de la base de données, ou tout autre facteur externe.
2. **Elle ne modifie rien en dehors d'elle-même** — pas d'écriture en base, pas d'appel réseau, pas de modification d'une variable extérieure (« effet de bord »).

Les quatre fonctions de ce chapitre sont toutes pures. C'est un choix de conception déterminant : une fonction pure est **triviale à tester** (il suffit de vérifier des couples entrée/sortie, voir §2.7), **impossible à faire échouer par un problème réseau ou de base de données**, et peut être appelée aussi bien côté serveur (Node.js) que côté client (navigateur) sans aucune adaptation — exactement ce qui est exploité ici.

## 2.2 `calculerCommande` — le calcul au cœur du module Commandes

### Explication intuitive

Quand un client passe une commande, cinq nombres doivent être calculés à partir de trois informations de départ (combien de bacs, à quel prix, combien le client a payé) et d'une quatrième qui vient de l'historique du client (l'avance dont il disposait déjà). Faire ce calcul à la main, des dizaines de fois par jour, avec la règle « l'avance existante se déduit **avant** d'afficher ce qu'il reste à payer », est exactement le genre de tâche répétitive où une erreur humaine finit par arriver — et où elle coûte de l'argent réel. `calculerCommande` fait ce calcul une fois, correctement, et le même code est utilisé pour l'aperçu affiché en direct dans le formulaire et pour l'enregistrement définitif.

### Explication technique — signature

```ts
// packages/shared/src/index.ts, lignes 261-289
export interface CalculCommande {
  montantBrut: number;
  avanceUtilisee: number;
  montantAPercevoir: number;
  dette: number;
  avanceGeneree: number;
  nouvelleAvance: number;
}

export function calculerCommande(params: {
  quantiteBacs: number;
  prixParBac: number;
  avanceExistante: number;
  montantRecu: number;
}): CalculCommande {
  const { quantiteBacs, prixParBac, avanceExistante, montantRecu } = params;
  const montantBrut = quantiteBacs * prixParBac;
  const avanceUtilisee = Math.min(avanceExistante, montantBrut);
  const montantAPercevoir = montantBrut - avanceUtilisee;
  const dette = Math.max(0, montantAPercevoir - montantRecu);
  const avanceGeneree = Math.max(0, montantRecu - montantAPercevoir);
  const nouvelleAvance = avanceExistante - avanceUtilisee + avanceGeneree;
  return { montantBrut, avanceUtilisee, montantAPercevoir, dette, avanceGeneree, nouvelleAvance };
}
```

| Élément | Détail |
|---|---|
| **Paramètres** (un seul objet, 4 champs) | `quantiteBacs: number` — nombre de bacs commandés ; `prixParBac: number` — prix unitaire du type de client (Fc) ; `avanceExistante: number` — solde d'avance du client avant cette commande (Fc, peut être 0) ; `montantRecu: number` — somme effectivement encaissée pour cette commande (Fc) |
| **Valeur de retour** | Un objet `CalculCommande` à 6 champs (voir déroulement ci-dessous) |
| **État initial requis** | Aucun — fonction pure, pas d'état à préparer |
| **Effets de bord** | Aucun |
| **Dépendances** | Aucune (utilise uniquement `Math.min`/`Math.max`, natifs de JavaScript) |

### Déroulement étape par étape

L'ordre des 6 lignes de calcul n'est pas arbitraire — chaque valeur dépend de la précédente, dans une chaîne stricte :

1. **`montantBrut = quantiteBacs * prixParBac`** — le montant total avant toute déduction. Simple multiplication, mais c'est la base de tout le reste.
2. **`avanceUtilisee = Math.min(avanceExistante, montantBrut)`** — l'avance du client est utilisée pour payer cette commande, mais **jamais plus que ce que la commande coûte**. `Math.min` garantit qu'on ne peut jamais « utiliser » plus d'avance que le montant brut de la commande elle-même — sans cette borne, un client avec une grosse avance et une petite commande verrait une `avanceUtilisee` supérieure à `montantBrut`, ce qui rendrait `montantAPercevoir` négatif à l'étape suivante.
3. **`montantAPercevoir = montantBrut - avanceUtilisee`** — ce qu'il reste réellement à faire payer au client après déduction de son avance. Ne peut jamais être négatif, grâce à la borne de l'étape 2.
4. **`dette = Math.max(0, montantAPercevoir - montantRecu)`** — si le client a payé moins que ce qui lui était demandé, la différence devient une dette. `Math.max(0, ...)` empêche une « dette négative » : si le client a payé **plus** que demandé, ce n'est pas une dette négative, c'est un trop-perçu, traité à l'étape suivante.
5. **`avanceGeneree = Math.max(0, montantRecu - montantAPercevoir)`** — le miroir exact de l'étape précédente : si le client a payé plus que le montant demandé, l'excédent devient une nouvelle avance à son crédit. Notez qu'à un instant donné, `dette` et `avanceGeneree` **ne peuvent jamais être tous les deux strictement positifs** — soit le client a payé moins (dette), soit plus (avance), soit exactement ce qu'il fallait (les deux valent 0). C'est une conséquence mathématique directe des étapes 4 et 5, jamais vérifiée explicitement par un `if` — la table de vérité du §2.2.4 le démontre par le calcul plutôt que par une assertion dans le code.
6. **`nouvelleAvance = avanceExistante - avanceUtilisee + avanceGeneree`** — le nouveau solde d'avance du client après cette commande : on retire ce qui vient d'être consommé (étape 2) et on ajoute ce qui vient d'être généré (étape 5). C'est cette valeur qui sera écrite en base sur la fiche du client (`Client.avanceDisponible`) par l'appelant — `calculerCommande` elle-même ne le fait pas, voir §2.6.

### Exemple chiffré bout en bout

Cet exemple reprend celui documenté dans `docs/spec-boulangerie.md` (section 3.4) pour un client de qualité « Maman » (6 000 Fc/bac), sur deux commandes successives.

**Commande #1** — 3 bacs, aucune avance de départ, le client paie 20 000 Fc (plus que demandé) :

| Étape | Calcul | Résultat |
|---|---|---:|
| `montantBrut` | 3 × 6 000 | **18 000** |
| `avanceUtilisee` | min(0, 18 000) | **0** |
| `montantAPercevoir` | 18 000 − 0 | **18 000** |
| `dette` | max(0, 18 000 − 20 000) = max(0, −2 000) | **0** |
| `avanceGeneree` | max(0, 20 000 − 18 000) | **2 000** |
| `nouvelleAvance` | 0 − 0 + 2 000 | **2 000** |

Le client a payé 2 000 Fc de plus que ce qu'il devait : cette somme devient une avance à son crédit, disponible pour la prochaine commande.

**Commande #2** (le lendemain) — 5 bacs, avance existante = 2 000 Fc (héritée de la commande #1), le client paie exactement 28 000 Fc :

| Étape | Calcul | Résultat |
|---|---|---:|
| `montantBrut` | 5 × 6 000 | **30 000** |
| `avanceUtilisee` | min(2 000, 30 000) | **2 000** |
| `montantAPercevoir` | 30 000 − 2 000 | **28 000** |
| `dette` | max(0, 28 000 − 28 000) | **0** |
| `avanceGeneree` | max(0, 28 000 − 28 000) | **0** |
| `nouvelleAvance` | 2 000 − 2 000 + 0 | **0** |

L'avance de 2 000 Fc a été intégralement consommée pour réduire le montant à percevoir de la commande #2 (30 000 → 28 000), et le client a payé exactement cette somme réduite : dette et avance retombent toutes deux à zéro.

### Cas limites

| Situation | Ce qui se passe | Pourquoi |
|---|---|---|
| `montantRecu = 0` | `montantAPercevoir` devient intégralement une `dette` | Étape 4 : `max(0, montantAPercevoir - 0) = montantAPercevoir` |
| `avanceExistante` très supérieure à `montantBrut` | `avanceUtilisee` plafonne à `montantBrut`, le reste de l'avance survit dans `nouvelleAvance` | Étape 2 (`Math.min`) puis étape 6 : l'avance non consommée (`avanceExistante - avanceUtilisee`) reste intacte |
| `quantiteBacs = 0` | `montantBrut = 0`, donc `avanceUtilisee = 0`, `montantAPercevoir = 0` | Ce cas n'est normalement jamais atteint en pratique : l'appelant (`commandes.ts`) valide `quantiteBacs` par un schéma Zod qui exige un entier strictement positif avant même d'appeler cette fonction (voir Volume 15) — `calculerCommande` elle-même ne fait aucune vérification de ce type, elle fait confiance à son appelant |
| `montantRecu` négatif | La fonction ne le rejette pas ; `dette` serait alors gonflée artificiellement | **Non confirmé dans le code actuel** que ce cas soit strictement impossible en amont — le schéma Zod appelant impose un montant positif ou nul, donc ce cas ne devrait jamais atteindre cette fonction en pratique, mais `calculerCommande` elle-même n'a aucune garde interne contre une valeur négative |

### Erreurs fréquentes (pour qui modifierait ce code)

- **Inverser l'ordre des étapes 2 et 4** casserait tout le calcul en aval : `avanceUtilisee` doit être connue avant de calculer `montantAPercevoir`, qui doit lui-même être connu avant `dette` et `avanceGeneree`.
- **Oublier le `Math.min` à l'étape 2** permettrait à un client avec une grosse avance de faire passer `montantAPercevoir` en négatif, ce qui ferait ensuite passer `dette` à 0 de façon incorrecte (un `Math.max(0, négatif - X)` reste 0, masquant le bug plutôt que de le révéler par une erreur visible).
- **Confondre `avanceExistante` (avant la commande) et le solde après** : c'est précisément le rôle de `avanceAvantCommande` (§2.3) d'éviter cette confusion lors de la modification d'une commande déjà enregistrée.

### Conséquences d'une modification

Cette fonction est appelée à **5 endroits** du code (voir §2.6, Qui l'appelle). Toute modification de sa logique change simultanément : le calcul serveur qui écrit en base (`apps/api/src/routes/commandes.ts`), l'aperçu en direct affiché pendant la saisie (`apps/web/src/pages/Commandes.tsx`), et — de façon moins visible — la donnée réelle stockée sur la fiche de chaque client (`Client.avanceDisponible`). Une régression ici a un impact financier direct et immédiat sur des données réelles de l'entreprise.

### Tests qui couvrent ce comportement

`packages/shared/src/index.test.ts` contient 5 tests dédiés (`describe("calculerCommande (section 3.4)", ...)`) : le cas sans avance ni dette, l'exemple à deux commandes ci-dessus (repris presque à l'identique), le plafonnement de l'avance au montant brut, la génération d'une dette, et la génération d'une nouvelle avance par trop-perçu. Ces 5 tests couvrent chacune des 6 lignes de calcul au moins une fois dans un cas où sa valeur n'est pas triviale (ni 0, ni égale à un paramètre d'entrée).

## 2.3 `avanceAvantCommande` — reconstituer un état passé

### Explication intuitive

Imaginez que vous modifiez une commande déjà enregistrée hier. La fiche du client affiche aujourd'hui son solde d'avance **après** l'effet de cette commande d'hier. Si vous recalculez la commande modifiée en utilisant ce solde actuel comme point de départ, vous appliqueriez l'effet de la commande **deux fois** — une fois hier, une fois aujourd'hui en la « remodifiant ». `avanceAvantCommande` sert exactement à annuler mentalement l'effet d'une commande existante, pour retrouver le solde du client tel qu'il était juste avant qu'elle soit enregistrée la première fois.

### Signature et déroulement

```ts
// packages/shared/src/index.ts, lignes 296-302
export function avanceAvantCommande(params: {
  avanceDisponibleClient: number;
  avanceUtilisee: number;
  avanceGeneree: number;
}): number {
  return params.avanceDisponibleClient + params.avanceUtilisee - params.avanceGeneree;
}
```

| Paramètre | Sens |
|---|---|
| `avanceDisponibleClient` | Le solde d'avance **actuel** du client (après l'effet de la commande existante) |
| `avanceUtilisee` | Ce que la commande existante avait consommé au moment de son enregistrement |
| `avanceGeneree` | Ce que la commande existante avait généré au moment de son enregistrement |

Le calcul inverse exactement l'étape 6 de `calculerCommande` (`nouvelleAvance = avanceExistante - avanceUtilisee + avanceGeneree`) : en partant de `nouvelleAvance` (devenu ici `avanceDisponibleClient`) et en réappliquant les mêmes termes avec les signes opposés, on retrouve `avanceExistante`. C'est une **fonction inverse** au sens mathématique, appliquée à un problème métier concret.

### Exemple chiffré

En reprenant la commande #2 de l'exemple précédent (`avanceUtilisee = 2 000`, `avanceGeneree = 0`, résultat `nouvelleAvance = 0`) : si le solde actuel du client est `avanceDisponibleClient = 0` (c'est bien ce que la commande #2 a laissé), alors `avanceAvantCommande({ avanceDisponibleClient: 0, avanceUtilisee: 2000, avanceGeneree: 0 })` = 0 + 2 000 − 0 = **2 000** — on retrouve exactement l'avance de 2 000 Fc que le client avait avant la commande #2, celle qui avait été utilisée comme `avanceExistante` dans le calcul original.

### Qui l'appelle et pourquoi c'est nécessaire ici précisément

Seul appelant recensé : `apps/api/src/routes/commandes.ts` (ligne 329), dans la branche de mise à jour d'une commande existante (cas de doublon avec stratégie « MODIFIER » ou « REMPLACER » — voir Volume 11h pour le détail complet de cette route). Sans cette fonction, modifier une commande existante appliquerait son nouvel effet par-dessus l'ancien déjà comptabilisé, faussant le solde d'avance du client de façon cumulative à chaque modification.

## 2.4 `calculerDepenseFarine` — une formule métier à trois constantes

### Explication intuitive

Chaque jour, la boulangerie utilise un certain nombre de sacs de farine, dont le coût dépend du taux du jour (un prix de référence qui varie). Plutôt que de laisser un opérateur multiplier à la main, une formule fixe convertit automatiquement le taux du jour et le nombre de sacs utilisés en une dépense en Fc.

### Signature et code complet

```ts
// packages/shared/src/index.ts, lignes 478-485
export const FARINE_COEFFICIENT_TAUX = 33.5;
export const FARINE_SUPPLEMENT_FC = 500;

export function calculerDepenseFarine(taux: number, sacsUtilises: number): number {
  return Math.round((FARINE_COEFFICIENT_TAUX * taux + FARINE_SUPPLEMENT_FC) * sacsUtilises);
}
```

| Paramètre | Sens |
|---|---|
| `taux: number` | Le taux du jour (`TauxDuJour.valeur` en base — voir Volume 13), une valeur de change/référence saisie quotidiennement |
| `sacsUtilises: number` | Le nombre de sacs de farine utilisés ce jour |

### Déroulement

La formule est : `montant = round((33,5 × taux + 500) × sacsUtilises)`.

1. `FARINE_COEFFICIENT_TAUX * taux` — le taux du jour est multiplié par un coefficient fixe (33,5). Ces deux constantes (`FARINE_COEFFICIENT_TAUX`, `FARINE_SUPPLEMENT_FC`) sont exportées, donc réutilisables ailleurs si un affichage doit un jour détailler la formule — **non confirmé dans le code actuel** qu'un tel affichage existe réellement aujourd'hui.
2. `+ FARINE_SUPPLEMENT_FC` — un supplément fixe de 500 est ajouté, indépendant du taux.
3. Le tout est multiplié par `sacsUtilises` — le coût par sac (taux + supplément) devient un coût total pour tous les sacs utilisés ce jour.
4. `Math.round(...)` — le résultat est arrondi à l'entier le plus proche, cohérent avec la règle générale du projet : **aucun montant en Fc ne comporte de décimales** (voir Volume 2, §2.3).

### Exemple chiffré

Avec un taux du jour de 1 500 et 10 sacs utilisés : `calculerDepenseFarine(1500, 10)` = round((33,5 × 1 500 + 500) × 10) = round((50 250 + 500) × 10) = round(50 750 × 10) = round(507 500) = **507 500 Fc**.

### Cas limite

`sacsUtilises = 0` → le résultat est 0, quel que soit le taux (le terme `(33,5 × taux + 500)` est multiplié par 0). Testé explicitement dans `index.test.ts` (`"zéro sac utilisé -> zéro dépense, quel que soit le taux"`).

### Qui l'appelle

`apps/api/src/routes/caisse.ts` (deux appels : un pour l'estimation en direct dans le résumé du registre, un pour l'enregistrement effectif de la dépense) et `apps/web/src/pages/Caisse.tsx` (aperçu en direct côté client, même logique de duplication contrôlée que pour `calculerCommande`). Le détail complet de l'écran Caisse est traité au Volume 11j.

## 2.5 `aAcces` — la porte d'entrée de tout le système de permissions

### Explication intuitive

Presque chaque action de l'application pose la même question : « cet utilisateur a-t-il le droit de faire ceci ? ». Plutôt que de réécrire cette logique à chaque route et à chaque bouton d'interface, une seule petite fonction répond à cette question, de façon identique partout — côté serveur pour bloquer réellement une action non autorisée, côté client pour ne même pas afficher un bouton inutile.

### Signature complète

```ts
// packages/shared/src/index.ts, lignes 1876-1885
export function aAcces(
  permissions: PermissionDTO[],
  module: Module,
  niveau: Exclude<NiveauAcces, "AUCUN">,
): boolean {
  const p = permissions.find((x) => x.module === module);
  if (!p || p.niveauAcces === "AUCUN") return false;
  if (niveau === "LECTURE") return true; // ECRITURE implique LECTURE
  return p.niveauAcces === "ECRITURE";
}
```

| Paramètre | Type | Sens |
|---|---|---|
| `permissions` | `PermissionDTO[]` | La liste des permissions effectives de l'utilisateur (un couple `{ module, niveauAcces }` par module où il a un droit) |
| `module` | `Module` | Le module dont on veut vérifier l'accès (ex. `"CAISSE"`) |
| `niveau` | `Exclude<NiveauAcces, "AUCUN">` | Le niveau demandé : `"LECTURE"` ou `"ECRITURE"` **uniquement** — voir la remarque sur le type ci-dessous |

**Remarque sur la signature** : le type `Exclude<NiveauAcces, "AUCUN">` est une garantie posée **au moment de la compilation**, pas à l'exécution. `NiveauAcces` vaut `"AUCUN" | "LECTURE" | "ECRITURE"` (voir `NIVEAUX_ACCES`, ligne 58) ; `Exclude<..., "AUCUN">` retire la première valeur du type autorisé pour ce paramètre. Concrètement, cela signifie qu'il est **impossible d'écrire dans le code** `aAcces(permissions, "CAISSE", "AUCUN")` — TypeScript refuserait de compiler ce code, car demander « ai-je le droit AUCUN » n'a pas de sens (la réponse serait toujours vraie de façon triviale). Cette contrainte n'existe qu'à la compilation ; elle disparaît une fois le code transformé en JavaScript exécutable.

### Déroulement étape par étape

1. **`permissions.find((x) => x.module === module)`** — cherche, dans la liste des permissions de l'utilisateur, l'entrée correspondant au module demandé. Si l'utilisateur n'a **aucune** entrée pour ce module (il n'apparaît pas du tout dans son rôle), `find` renvoie `undefined`.
2. **`if (!p || p.niveauAcces === "AUCUN") return false;`** — deux cas fusionnés dans une seule condition : soit le module est totalement absent de la liste (`!p`), soit il y figure explicitement avec un niveau `"AUCUN"`. Dans les deux cas, le résultat est le même : refus. C'est une simplification volontaire — un rôle peut choisir de lister explicitement `{ module: "CAISSE", niveauAcces: "AUCUN" }`, ou simplement ne pas mentionner `"CAISSE"` du tout ; les deux sont traités identiquement par cette fonction.
3. **`if (niveau === "LECTURE") return true;`** — si on est arrivé jusqu'ici, c'est que `p.niveauAcces` vaut soit `"LECTURE"` soit `"ECRITURE"` (le cas `"AUCUN"` a été éliminé à l'étape 2). Si la question posée était « ai-je au moins la lecture ? », la réponse est donc automatiquement oui, peu importe lequel des deux niveaux restants l'utilisateur possède réellement.
4. **`return p.niveauAcces === "ECRITURE";`** — dernière ligne, atteinte uniquement si la question posée était « ai-je l'écriture ? ». La réponse est vraie seulement si le niveau réel est exactement `"ECRITURE"` — un utilisateur en `"LECTURE"` seule reçoit `false` ici.

### Table de vérité complète

| `p` trouvé ? | `p.niveauAcces` | `niveau` demandé | Résultat | Ligne atteinte |
|:---:|:---:|:---:|:---:|---|
| Non | — | `LECTURE` | **false** | étape 2 |
| Non | — | `ECRITURE` | **false** | étape 2 |
| Oui | `AUCUN` | `LECTURE` | **false** | étape 2 |
| Oui | `AUCUN` | `ECRITURE` | **false** | étape 2 |
| Oui | `LECTURE` | `LECTURE` | **true** | étape 3 |
| Oui | `LECTURE` | `ECRITURE` | **false** | étape 4 |
| Oui | `ECRITURE` | `LECTURE` | **true** | étape 3 (« ECRITURE implique LECTURE ») |
| Oui | `ECRITURE` | `ECRITURE` | **true** | étape 4 |

Cette table révèle la règle métier centrale de tout le système de permissions, résumée dans le commentaire du code lui-même : **`ECRITURE` implique toujours `LECTURE`**. Il n'existe dans ce projet aucune notion de « droit d'écrire sans pouvoir lire » — ce serait d'ailleurs incohérent avec l'usage réel (modifier une donnée qu'on ne peut pas afficher n'a pas de sens dans cette interface).

### Ce qui se passerait si une condition était supprimée ou incorrecte

- **Si l'étape 2 était supprimée** : un utilisateur sans aucune permission sur un module (`p` vaut `undefined`) provoquerait une erreur d'exécution à l'étape 4 (`p.niveauAcces` sur `undefined` lève une exception `TypeError`), ce qui ferait planter la requête entière plutôt que de refuser proprement l'accès — un bug de disponibilité, pas de sécurité, mais qui bloquerait l'application pour cet utilisateur.
- **Si l'étape 3 était supprimée** (retirer le court-circuit `LECTURE`) : un utilisateur en `ECRITURE` recevrait quand même `true` en dernière ligne pour une demande de `LECTURE` (car `p.niveauAcces === "ECRITURE"` ne dépend pas de `niveau`) — donc **aucune régression visible dans ce cas précis**, la ligne 4 seule suffirait presque... sauf que sans l'étape 3, un utilisateur en `LECTURE` demandant `LECTURE` recevrait `p.niveauAcces === "ECRITURE"` → `false`, un refus incorrect. L'étape 3 est donc indispensable exactement pour ce cas.
- **Si la comparaison de l'étape 4 devenait `!==` par erreur** (inversion d'opérateur) : toute permission `ECRITURE` réelle refuserait l'écriture, et toute permission `LECTURE` seule l'autoriserait — une inversion totale et dangereuse du système de permissions, qui donnerait des droits d'écriture à des comptes qui ne devraient en avoir aucun.

### Qui l'appelle (recensement complet à ce stade du livre)

| Appelant | Fichier | Usage |
|---|---|---|
| `requirePermission` | `apps/api/src/middleware/auth.ts` | Garde d'accès posée sur presque toutes les routes API — refuse la requête (403) si `aAcces` renvoie `false`. Détaillé au Volume 11b. |
| `peutConsulterBulletinsDe` | `apps/api/src/routes/travailleurs.ts` | Vérifie l'accès en lecture au module `TRAVAILLEURS` avant d'autoriser la consultation de bulletins de paie d'un tiers |
| `ecritureZones` | `apps/api/src/routes/zones-depositaires.ts` | Vérifie l'écriture sur `COMMANDES` **ou** `PRODUCTION` (un `\|\|` entre deux appels à `aAcces`) |
| (fonction anonyme) | `apps/api/src/routes/export.ts` | Vérifie la lecture sur une liste de modules avant d'autoriser un export |
| `peutLire` / `peutEcrire` | `apps/web/src/lib/auth.tsx` | Les deux fonctions exposées par le contexte d'authentification React, utilisées dans presque tous les composants d'écran pour décider quoi afficher — détaillé au Volume 11b |

### Erreur fréquente à ne pas commettre

Confondre « le module n'apparaît pas dans la liste » et « le module apparaît avec `AUCUN` » comme s'ils devaient être traités différemment — le code les traite volontairement de façon identique (étape 2), et une modification qui tenterait de les distinguer devrait avoir une raison métier explicite pour ne pas introduire une incohérence avec le reste du système.

### Tests qui couvrent ce comportement

`packages/shared/src/index.test.ts`, bloc `describe("aAcces (matrice de permissions)", ...)` : 4 tests couvrant explicitement chacune des 4 lignes de la table de vérité regroupées par cas (`ECRITURE implique LECTURE`, `LECTURE seule n'accorde pas ECRITURE`, `AUCUN refuse LECTURE et ECRITURE`, `module absent de la liste équivaut à AUCUN`).

## 2.6 Ce que ces quatre fonctions NE font PAS (et pourquoi c'est important)

Aucune des quatre fonctions de ce chapitre :

- **n'écrit rien en base de données** — c'est toujours l'appelant (une route de `apps/api/src/routes/`) qui prend le résultat retourné et l'utilise dans un appel Prisma (`prisma.client.update(...)`, etc.).
- **ne vérifie une autorisation autrement qu'en répondant `true`/`false`** — `aAcces` ne lève jamais d'exception et ne renvoie jamais de code d'erreur HTTP ; c'est à l'appelant de décider quoi faire d'un `false` (typiquement, renvoyer une réponse 403).
- **n'accède à aucune variable globale ni fichier de configuration** — tout ce dont elles ont besoin arrive en paramètre.

Cette séparation stricte entre « calculer/décider » (ce fichier) et « agir » (les routes) est ce qui permet à ces fonctions d'être testées unitairement sans base de données (voir Volume 19) et d'être partagées telles quelles entre serveur et navigateur.

## Croisement avec la spécification

| Fonction | Section de `docs/spec-boulangerie.md` | Correspondance |
|---|---|---|
| `calculerCommande` | 3.4, tableau « Champs d'une commande » et « Exemple confirmé » | **Conforme** — l'exemple chiffré de ce chapitre reproduit fidèlement l'exemple de la spec |
| `avanceAvantCommande` | 3.4 (implicite, non nommée dans la spec) | **Conforme** au comportement décrit (« Le solde d'avance est porté par le client... et se reporte automatiquement ») ; la spec ne détaille pas ce mécanisme technique de recalcul, ce qui est normal — c'est un détail d'implémentation, pas une règle métier visible par l'utilisateur |
| `calculerDepenseFarine` | 3.1, « Constantes du calcul de la dépense farine : [(33,5 × taux) + 500] × sacs » | **Conforme** — la formule du code correspond exactement, terme à terme |
| `aAcces` | 2, « Matrice des permissions » | **Conforme** — le principe « ECRITURE implique LECTURE » n'est pas énoncé littéralement dans la spec sous cette forme, mais aucune permission de la matrice de la section 2 ne contredit cette règle |

Aucun écart n'a été repéré pour ce chapitre — rien à ajouter à `annexes/ecarts-spec-code.md` à ce stade.

## Résumé du chapitre

Quatre fonctions pures, sans effet de bord, forment le socle financier et sécuritaire du projet : `calculerCommande` (avance/dette/trop-perçu, vérifié conforme à la spec avec un exemple chiffré à deux commandes), `avanceAvantCommande` (annule l'effet d'une commande existante pour permettre sa modification sans double-comptage), `calculerDepenseFarine` (formule fixe à trois constantes), et `aAcces` (la porte d'entrée unique de tout le système de permissions, avec la règle « ECRITURE implique LECTURE »). Leur caractère pur — aucune écriture, aucun appel réseau — est ce qui permet de les partager identiquement entre le serveur et le navigateur, et de les tester unitairement sans dépendance externe.

**Suite** → Volume 11b : Authentification et permissions bout en bout (`middleware/auth.ts`, `lib/auth.tsx`, `lib/api.ts`).
