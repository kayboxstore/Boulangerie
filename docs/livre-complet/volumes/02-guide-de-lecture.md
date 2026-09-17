# Volume 2 — Guide de lecture et notions fondamentales

## 2.1 Comment ce livre est construit

Ce livre n'est pas un roman à lire de la première à la dernière page. C'est une base de connaissances organisée en **volumes indépendants**, chacun consacré à un aspect du projet (voir `TABLE_DES_MATIERES.md`). Trois fichiers vous aident à naviguer :

- `TABLE_DES_MATIERES.md` — la liste des volumes et leur état d'avancement ;
- `INDEX_DU_CODE.md` — si vous partez d'un nom de fichier ou de fonction et voulez savoir où il est expliqué ;
- `GLOSSAIRE.md` — si vous partez d'un mot que vous ne comprenez pas.

Chaque volume traitant d'un fichier de code commence par une fiche d'identité (chemin exact, rôle, qui l'appelle, ce qu'il modifie) avant de rentrer dans le détail — vous pouvez vous arrêter à cette fiche si vous cherchez juste une vue d'ensemble.

## 2.2 Comment lire un extrait de code annoté

Dans ce livre, un extrait de code est toujours accompagné :

1. du **chemin exact du fichier** d'où il vient ;
2. du **nom du symbole** concerné (fonction, composant...) plutôt que d'un simple numéro de ligne, car le code évolue — le numéro de ligne donné correspond à la version analysée (commit `ffe2e749ee1b6b5fcb39b69303f6518df5a65370`) et peut légèrement dériver après une modification mineure du fichier ;
3. d'une explication qui **déroule l'exécution**, pas seulement une paraphrase du code.

Exemple de la forme utilisée dans ce livre :

> **Fichier** : `packages/shared/src/index.ts` — fonction `calculerCommande`
> ```ts
> const montantBrut = quantiteBacs * prixParBac;
> ```
> Cette ligne calcule le montant total avant toute déduction d'avance : le nombre de bacs commandés multiplié par le prix unitaire du type de client. C'est la première valeur de la chaîne de calcul — toutes les valeurs suivantes (avance utilisée, montant à percevoir, dette) en dérivent.

## 2.3 Notions transversales à connaître avant de commencer

Ces notions reviennent dans presque tous les volumes. Les redéfinir à chaque fois alourdirait le livre — elles sont donc posées ici une fois pour toutes (et répétées dans `GLOSSAIRE.md` pour une recherche rapide).

### Monorepo et *workspaces* npm

Ce projet n'est **pas** un seul programme, mais **trois paquets npm distincts** vivant dans un seul dépôt Git :

```
Boulangerie/
├── apps/api/         → le serveur (paquet npm "@lomoto/api")
├── apps/web/         → l'interface web (paquet npm "@lomoto/web")
├── packages/shared/   → le code partagé entre les deux (paquet npm "@lomoto/shared")
└── package.json       → déclare les workspaces, orchestre les commandes communes
```

C'est ce qu'on appelle un **monorepo** : un seul dépôt, plusieurs paquets. La mécanique qui relie ces paquets entre eux s'appelle les *workspaces* npm : `apps/api` et `apps/web` déclarent tous les deux une dépendance vers `@lomoto/shared`, et npm résout cette dépendance directement vers le dossier `packages/shared` du même dépôt (pas de version publiée, pas de copie) — un changement dans `packages/shared/src/index.ts` est donc immédiatement visible des deux côtés, sans étape de publication ni de build intermédiaire. Le Volume 3 explique ce mécanisme plus en détail.

### Rôle et permission

Un **rôle** (ex. « Caissier(ère) ») est un ensemble nommé de droits. Chaque droit est un couple **module** (domaine fonctionnel, ex. `CAISSE`) × **niveau d'accès** (`AUCUN`, `LECTURE` ou `ECRITURE`). Un compte utilisateur a toujours exactement un rôle, et hérite de tous ses droits. Ce mécanisme est central : il conditionne quasiment chaque route de l'API et chaque écran de l'interface — le Volume 11b (Authentification et permissions bout en bout) lui est entièrement consacré.

### DTO (Data Transfer Object)

Quand le serveur répond à une requête, il ne renvoie jamais directement une ligne de base de données brute. Il la transforme en un objet dont la forme est **volontairement différente et plus restreinte** — par exemple sans le mot de passe haché d'un utilisateur. Cette forme s'appelle un DTO. Dans ce projet, chaque DTO a un nom qui se termine par `DTO` (ex. `CommandeDTO`, `UtilisateurDTO`) et est défini une seule fois, dans `packages/shared/src/index.ts`, pour être utilisé identiquement côté serveur (qui le construit) et côté client (qui le reçoit et le type).

### Validation par schéma (Zod)

Avant d'accepter une donnée envoyée par un formulaire ou un appel d'API, le serveur la fait passer par un **schéma de validation** écrit avec la bibliothèque Zod. Un schéma décrit la forme attendue (« `quantiteBacs` doit être un entier positif ») et Zod la vérifie réellement à l'exécution — ce n'est pas qu'une déclaration de type qui disparaît à la compilation, comme le ferait un simple type TypeScript. Le Volume 15 (Validation des données) détaille ce mécanisme.

### Convention de nommage : le français assumé

Ce projet fait un choix inhabituel dans le développement logiciel international : **les identifiants du domaine métier sont en français** (`calculerCommande`, `quantiteBacs`, `avanceUtilisee`), alors que la structure du code (mots-clés du langage, noms de bibliothèques) reste en anglais, comme c'est la norme en programmation. Ce choix reflète le contexte réel du projet — une équipe et un métier francophones — et ce livre le respecte : il ne traduit jamais un nom de symbole en anglais dans ses explications, pour que vous puissiez toujours retrouver exactement ce dont il parle dans le code source.

### Fc (Franc congolais)

Tous les montants de l'application sont exprimés en Fc, **toujours en nombre entier** (jamais de centimes, jamais de nombre à virgule flottante pour un montant final). Ce choix a une conséquence technique importante détaillée au Volume 11a : il élimine une classe entière de bugs d'arrondi qui affecterait un système financier stockant ses montants en nombres à virgule flottante.

## 2.4 Ce que signifient les niveaux de risque utilisés dans ce livre

Chaque fichier de code documenté dans ce livre porte une étiquette **Niveau 1, 2 ou 3**, visible dans `INVENTAIRE_DU_PROJET.md` et `MATRICE_DE_COUVERTURE.md`. Cette étiquette n'est pas un jugement de qualité du code — c'est une indication du **degré de détail** avec lequel ce livre le traite :

- **Niveau 1** (argent réel, calculs financiers, permissions, workflow d'approbation) → traitement ligne à ligne, avec tables de vérité et exemples chiffrés bout en bout.
- **Niveau 2** (fonctionnalité standard) → chaque fonction et chaque route sont expliquées complètement, mais les lignes répétitives ou évidentes sont regroupées.
- **Niveau 3** (configuration, infrastructure, primitives d'interface génériques) → couverture correcte mais concise.

## 2.5 Ce que signifient les mentions spéciales de ce livre

Vous croiserez trois formulations récurrentes, à bien distinguer :

- **« Non confirmé dans le code actuel »** — l'information ne peut être ni confirmée ni infirmée avec certitude à partir du dépôt disponible (ex. un comportement qui dépend d'un service externe non accessible depuis cet environnement).
- **« Écart entre spec et code — à confirmer avec l'équipe »** — le code et `docs/spec-boulangerie.md` ne décrivent pas exactement la même chose ; ce livre expose les deux versions sans trancher.
- **« Recommandation »** (toujours étiquetée comme telle) — une suggestion d'amélioration de l'auteur de ce livre, clairement distincte d'une description du comportement actuel.

## Résumé du volume

Ce livre est une base de connaissances navigable, pas un texte linéaire. Une poignée de notions transversales — monorepo, rôle/permission, DTO, validation Zod, convention de nommage en français, montants entiers en Fc — reviennent dans presque tous les chapitres et sont posées une fois pour toutes ici. Le niveau de risque (1/2/3) affiché pour chaque fichier indique le degré de détail attendu, pas une note de qualité.

**Suite** → Volume 3 : Technologies, langages et dépendances.
