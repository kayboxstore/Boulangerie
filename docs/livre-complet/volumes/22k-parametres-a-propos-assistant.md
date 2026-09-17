# Volume 22k — Paramètres, À propos et Assistant

> Onzième sous-chapitre du Guide complet d'utilisation. Trois écrans très différents dans leur usage — l'un réservé aux Admins, l'un public, l'un conversationnel — mais qui partagent des données ou des mécanismes déjà rencontrés ailleurs dans ce livre. Comportement déjà vérifié techniquement aux Volumes 11z-4 et 11z-5.

## 1. Paramètres : les réglages de la boutique

L'écran Paramètres, réservé aux Administrateurs (ni le DG, ni aucun autre rôle métier n'y a accès, même en lecture — une exception notable, puisque le DG a par ailleurs un accès en lecture à presque tout le reste de l'application), regroupe deux types de réglages bien distincts.

### 1.1 Les qualités de clients (déjà vu au Volume 22c)

Modifier le prix ou la commission d'une Qualité (Dépositaire, Maman, Vente cash) se fait depuis cet écran — rappel du Volume 22b : c'est l'une des cinq actions les plus sensibles de l'application, soumise à l'approbation de l'Admin Principal si c'est un Admin secondaire qui la déclenche.

### 1.2 Les informations de la boutique

Nom, adresse, contact et langue par défaut de la boutique se règlent également ici. Un point à connaître : **les trois premiers champs (nom, adresse, contact) sont partagés avec la page À propos** (§2) — ce ne sont pas deux copies séparées, modifier l'un depuis Paramètres met immédiatement à jour l'autre écran, et réciproquement.

## 2. À propos : la page publique

À propos est la seule page, avec Rapports personnels et l'Assistant, accessible à **tous** les rôles sans restriction de module — même les rôles qui n'ont accès à aucun module métier particulier peuvent la consulter.

### 2.1 Ce qui s'affiche

En plus des trois champs partagés avec Paramètres (§1.2), cette page propose trois champs qui lui sont propres : une présentation libre, les horaires d'ouverture, et une liste de réseaux sociaux (chacun avec sa plateforme et son lien).

### 2.2 Un crédit affiché uniquement ici

Un point à connaître si l'export de documents (Volume 22l) est utilisé : le crédit du développeur de l'application, affiché sur cette page, **n'apparaît jamais** sur un rapport exporté en PDF ou envoyé par e-mail — c'est une restriction volontaire, propre à cette page uniquement.

## 3. L'Assistant : support humain, avec un premier niveau IA optionnel

L'Assistant est un espace de conversation, également accessible à tout le monde, pour poser une question ou signaler un problème.

### 3.1 Le fonctionnement par défaut

Par défaut, l'Assistant fonctionne en **mode humain uniquement** — chaque message envoyé est automatiquement transmis à tous les Administrateurs actifs, qui reçoivent une notification temps réel et peuvent répondre directement dans le fil de conversation. Un bouton « Parler à un Admin » permet aussi de demander explicitement une intervention humaine sans attendre.

### 3.2 Si l'assistance par intelligence artificielle est activée

Une bascule technique, réservée à l'Administrateur (visible et testable depuis l'écran État système, Volume 22j), peut activer un premier niveau de réponse automatique par intelligence artificielle avant l'escalade vers un humain. **Un point rassurant à connaître** : quelle que soit la raison d'un éventuel échec de cette IA (panne, configuration manquante, réponse invalide), l'utilisateur **n'est jamais laissé sans réponse** — un échec de l'IA déclenche automatiquement et silencieusement l'escalade vers un Admin humain, exactement comme si l'IA n'avait jamais été sollicitée. Une fois qu'un Admin humain a rejoint une conversation, l'IA n'intervient plus jamais sur cette conversation précise.

### 3.3 Joindre une capture d'écran

Le champ de saisie de l'Assistant permet de joindre une capture d'écran directement au message, pour illustrer un problème sans avoir à le décrire entièrement par écrit.

## 4. Résumé du sous-chapitre

| Question | Réponse |
|---|---|
| Qui peut modifier les réglages de la boutique ? | Les Administrateurs uniquement, ni le DG ni aucun autre rôle |
| Le nom/adresse/contact de la boutique sont-ils dupliqués entre Paramètres et À propos ? | Non, une seule donnée partagée entre les deux écrans |
| Le crédit du développeur apparaît-il sur un document exporté ? | Non, jamais — réservé à la page À propos elle-même |
| Que se passe-t-il si l'IA de l'Assistant échoue à répondre ? | Escalade automatique et silencieuse vers un Admin humain, jamais de message sans réponse |
| L'IA peut-elle répondre après qu'un Admin a rejoint la conversation ? | Non, plus jamais sur cette conversation |

**Prochain sous-chapitre** : Volume 22l — Rapports et Exports, dernier sous-chapitre du Volume 22.
