# Volume 22d — Production

> Quatrième sous-chapitre du Guide complet d'utilisation. Le module Production regroupe cinq volets sur un même écran (plus un écran séparé pour le Bon de livraison) — ce chapitre explique comment s'en servir au quotidien, du point de vue du Responsable de production, en s'appuyant sur le comportement déjà vérifié techniquement au Volume 11z-2.

## 1. Cinq volets, une seule idée directrice

Le module raisonne en **bacs** et en **ingrédients consommés sur la journée**, plutôt qu'en recettes détaillées par produit — plus proche de la façon dont une boulangerie fonctionne réellement. Cinq volets se complètent :

- **Planning** — ce qui est prévu pour le lendemain.
- **Schéma de commande** — la version numérique de la fiche remplie la veille, qui alimente automatiquement le Planning.
- **Productions enregistrées** — ce qui a réellement été produit, avec ses destinations.
- **Bon de livraison** — la fiche remplie au moment de la livraison, volontairement indépendante du Schéma.
- **Écarts** — une vue qui compare le prévu (Planning) au réalisé (Productions du jour).

## 2. Le Schéma de commande alimente automatiquement le Planning

Remplir le Schéma de commande (le tableau des quantités par client, Dépositaires groupés par zone et Mamans en liste à part, exactement comme la fiche papier) met à jour **automatiquement** le Planning de la même date avec le nombre de bacs et le détail par produit — sans avoir à ressaisir ces informations une seconde fois dans l'écran Planning.

**Ce qui n'est jamais écrasé par cette mise à jour automatique** : les prévisions d'ingrédients (sacs de farine, paquets de levure...) et les observations, saisies séparément dans le Planning, restent intactes quel que soit le nombre de fois où le Schéma est modifié par la suite. Un Schéma entièrement vide ne crée pas non plus de Planning vide — s'il n'y a rien à prévoir, rien n'est créé.

**Enregistrer un nouveau Schéma pour une date déjà remplie** ne crée jamais de doublon : la saisie précédente est simplement remplacée par la nouvelle, pour cette date précise.

## 3. Le Bon de livraison — volontairement indépendant du Schéma

Contrairement au Schéma, le Bon de livraison ne liste que les clients **Dépositaires** (les Mamans n'apparaissent pas sur cette fiche — la livraison par camion ne les concerne pas). Point important à comprendre : le Bon de livraison **n'est jamais automatiquement rempli** à partir du Schéma, et inversement. La quantité effectivement livrée peut différer de la quantité commandée (rupture, ajustement de dernière minute) — le Bon de livraison affiche simplement, à titre d'indice visuel, le total qui avait été commandé pour ce client, mais la saisie de ce qui a réellement été livré reste entièrement libre.

**Exporter le Bon de livraison en PDF** produit une fiche imprimable par Dépositaire livré, avec un tableau produit/quantité/bacs vides/observations et deux lignes de signature (Chauffeur, Dépositaire) à signer à la main sur le document imprimé — ces signatures ne sont jamais capturées numériquement par l'application, seulement sur le papier.

## 4. Enregistrer une production

Après une fournée, la saisie d'une production comporte trois éléments : le nombre de bacs produits, les ingrédients réellement utilisés (sacs de farine, paquets de levure, kg de sel, quantité d'huile), et la répartition des bacs vers leurs destinations (livrés Dépositaires, livrés Mamans, vendus en Vente cash, donnés, restants, foutus).

### 4.1 La décrémentation automatique du stock

Chaque quantité d'ingrédient saisie décrémente **automatiquement** le stock de la matière première correspondante — exactement le même mécanisme que pour une réception fournisseur ou un ajustement manuel de stock (Volume 22e). Si le stock d'une matière première venait à être insuffisant pour couvrir la quantité déclarée, **la production entière n'est pas enregistrée** — aucun risque de production « à moitié » enregistrée avec un stock devenu incohérent.

### 4.2 Les dons

Un bac donné doit être associé à un motif (par exemple « Police » ou « Baraka ») — la liste des motifs disponibles est configurable, pas figée dans le code.

### 4.3 La réconciliation : signalée, jamais bloquante

Un aperçu s'affiche **avant même l'enregistrement**, comparant la somme de toutes les destinations déclarées (livré + vendu + donné + restant + foutu) au nombre de bacs produits annoncé. Si les deux ne correspondent pas exactement, un écart s'affiche — mais **il n'empêche jamais d'enregistrer la production**. C'est un choix assumé de l'application : la réalité constatée sur le terrain prime toujours sur l'équilibre théorique des chiffres. L'écart reste néanmoins visible après coup (un badge sur la ligne de la production concernée), pour investigation si besoin.

**Exemple concret** : une production de 200 bacs enregistrée avec 120 livrés Dépositaires, 50 livrés Mamans, 20 vendus, 5 donnés, 3 restants, 1 foutu — la somme des destinations fait 199, pas 200. Un écart de **−1** s'affiche sur cette production (un bac produit n'a été retrouvé dans aucune destination déclarée, probablement une erreur de saisie), mais la production est enregistrée normalement, sans aucun blocage.

## 5. La vue Écarts : prévu contre réalisé

Un onglet séparé compare, pour une date donnée, ce qui avait été planifié (Planning) à ce qui a été réellement produit (somme des Productions enregistrées ce jour), sur cinq indicateurs : nombre de bacs, sacs de farine, paquets de levure, quantité d'huile, kg de sel. C'est un outil de suivi, pas un contrôle bloquant — il aide à repérer, jour après jour, si les prévisions sont globalement fiables ou systématiquement optimistes/pessimistes.

## 6. Les zones de dépôt

Une règle pratique à connaître : l'écran de gestion des zones de dépôt (qui permet de regrouper des Dépositaires par secteur géographique, par exemple « Centre-ville ») est modifiable aussi bien depuis le module Commandes que depuis le module Production — un Responsable de production n'a donc pas besoin d'un accès au module Commandes pour réorganiser les zones, et réciproquement.

## 7. Résumé du sous-chapitre

| Question | Réponse |
|---|---|
| Remplir le Schéma met-il à jour le Planning tout seul ? | Oui, automatiquement — sauf les prévisions d'ingrédients et les observations, jamais touchées |
| Le Bon de livraison suit-il ce qui a été commandé dans le Schéma ? | Non, volontairement indépendant — seul un indice visuel du total commandé est affiché |
| Que se passe-t-il si les destinations des bacs ne totalisent pas le nombre produit ? | Un écart s'affiche, mais rien n'est bloqué — la production est enregistrée telle quelle |
| Que se passe-t-il si le stock est insuffisant pour les ingrédients déclarés ? | La production entière est refusée, rien n'est enregistré à moitié |
| Qui peut modifier les zones de dépôt ? | Commandes et Production ont tous deux le droit, indépendamment l'un de l'autre |

**Prochain sous-chapitre** : Volume 22e — Matières premières et Fournisseurs.
