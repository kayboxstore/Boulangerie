# Volume 4 — Installation de l'environnement

**Niveau de risque : 3 — Support/infrastructure.** Traitement correct et concis, conforme au mandat pour cette catégorie de fichiers. Ce chapitre s'appuie sur `README.md` (source principale des étapes de démarrage) et sur ce qui a pu être **réellement vérifié** dans l'environnement de rédaction de ce livre — jamais supposé.

> **Mise à jour (correctif P0-01, 19-20/08/2026, complété après revue externe)** : ce chapitre décrit `prisma/seed.ts` et le script npm `db:seed`, qui n'existent plus sous ces noms. Le seed de démonstration a été renommé `prisma/seed-demo.ts`, invoqué par `npm run db:seed:demo` (et non plus `npx prisma db seed` directement — cette dernière commande refuse désormais de s'exécuter si `NODE_ENV` n'est pas explicitement `development`/`test` **et** que `DATABASE_URL` ne pointe pas vers un hôte local). Un script séparé, `prisma/bootstrap-production.ts` (`npm run db:bootstrap:production`), gère désormais le chemin de production — voir `DEPLOIEMENT.md` § « Correctif P0-01 » pour le comportement actuel faisant foi. Ce chapitre reste un instantané du code tel qu'il existait à sa rédaction et n'est pas réécrit au-delà de cette note.

## Fiche d'identité

| Fichier | Rôle |
|---|---|
| `README.md` | Démarrage rapide : prérequis, étapes d'installation, comptes de démonstration |
| `package.json` (racine) | Scripts npm partagés (`dev`, `build`, `test`, `prisma:*`, `db:bootstrap:production`, `db:seed:demo` — anciennement `db:seed`, voir la mise à jour ci-dessus) |

## 5.1 Prérequis annoncés — vérifiés dans cet environnement

Le `README.md` annonce deux prérequis : **Node.js ≥ 20 et npm**, et **PostgreSQL** (« le plus simple : Docker »). Vérification directe dans l'environnement où ce chapitre a été rédigé :

```
$ node --version
v22.22.2
$ npm --version
10.9.7
```

Node 22 satisfait bien la contrainte « ≥ 20 ». **Non vérifiable dans cet environnement** : la disponibilité de Docker pour la base de données — le binaire `docker` est présent, mais son démon (`dockerd`) n'est pas accessible ici (`connect: no such file or directory`), et aucun serveur PostgreSQL n'écoute sur le port attendu. Ce chapitre distingue donc, à chaque étape qui suit, ce qui a été **réellement exécuté et confirmé** de ce qui **n'a pas pu l'être** faute d'une base de données disponible.

## 5.2 Les cinq étapes du `README.md`

```bash
# 1. Dépendances
npm install

# 2. Base de données PostgreSQL (Docker)
docker run -d --name lomoto-postgres \
  -e POSTGRES_PASSWORD=lomoto_dev \
  -e POSTGRES_DB=boulangerie_lomoto \
  -p 5434:5432 postgres:16-alpine

# 3. Variables d'environnement
cp .env.example .env

# 4. Migration + données initiales (rôles, permissions, comptes de démo, produits)
npx prisma migrate dev
npx prisma db seed

# 5. Lancer API (http://localhost:3001) + Web (http://localhost:5173)
npm run dev
```

Le projet est un monorepo à **npm workspaces** (Volume 2, Volume 3) : `npm install`, exécuté une seule fois à la racine, installe simultanément les dépendances des trois paquets (`apps/api`, `apps/web`, `packages/shared`) et les relie entre eux (`@lomoto/shared` devient directement importable depuis les deux applications, sans étape de build intermédiaire).

**Étape 1 (installation des dépendances)** — **vérifié** : le dossier `node_modules` est déjà présent et complet dans cet environnement, confirmant qu'une installation via `npm install` a réussi.

**Étape 2 (base de données Docker)** — **non vérifiable ici**, faute de démon Docker actif. La commande crée un conteneur PostgreSQL 16 (image officielle légère `alpine`), avec le mot de passe et le nom de base codés en dur dans l'exemple — cohérents avec `DATABASE_URL` de `.env.example` (Volume 5). Le port hôte choisi, `5434` (plutôt que le `5432` par défaut de PostgreSQL), évite un conflit avec une éventuelle instance PostgreSQL déjà installée nativement sur la machine du développeur.

**Étape 3 (copie du fichier d'environnement)** — action triviale, une simple copie de fichier ; le contenu de `.env` résultant est détaillé au Volume 5.

**Étape 4 (migration et seed)** — **non vérifiable de bout en bout ici**, faute de base accessible. Ce qui a pu être confirmé indépendamment : `npx prisma validate` (une commande qui ne nécessite aucune connexion à une base — elle vérifie seulement la syntaxe de `schema.prisma`, Volume 13) répond *« The schema at prisma/schema.prisma is valid »*. `npx prisma migrate dev` appliquerait, sur une base neuve, l'intégralité des 29 migrations dans l'ordre chronologique (Volume 13, §5.6) ; `npx prisma db seed` exécuterait ensuite `prisma/seed.ts` (Volume 13, §5.7), qui crée la matrice de rôles/permissions, 8 comptes de démonstration, 3 Qualités de clients, un catalogue de 4 produits, 6 matières premières, 2 motifs de don et 2 fournisseurs.

**Étape 5 (lancement)** — `npm run dev` (défini dans le `package.json` racine) lance en parallèle, via `npm-run-all2`, `dev:api` (`tsx watch src/index.ts`, rechargement automatique à chaque modification) et `dev:web` (`vite`, serveur de développement du frontend). **Non vérifiable de bout en bout ici** : sans base de données accessible, le serveur API ne peut pas établir sa connexion Prisma au démarrage — une tentative de lancement dans cet environnement n'a pas permis d'observer un démarrage réussi dans le délai imparti, cohérent avec l'absence de base disponible plutôt qu'avec un défaut du code.

## 5.3 Ce qui a été vérifié indépendamment des étapes ci-dessus

Deux commandes ne nécessitant aucune base de données ont été exécutées avec succès dans l'environnement de rédaction :

```
$ npx prisma validate
The schema at prisma/schema.prisma is valid 🚀

$ npm test
✓ packages/shared/src/index.test.ts (11 tests) 19ms
Test Files  1 passed (1)
     Tests  11 passed (11)
```

Les 11 tests Vitest du paquet partagé (déjà présentés au Volume 11a) passent tous — une confirmation directe, indépendante de toute base de données, que les fonctions financières critiques (`calculerCommande`, `calculerDepenseFarine`, `aAcces`) se comportent comme attendu dans cet environnement précis.

## 5.4 Une information périmée dans `README.md`, à corriger

La première ligne utile du fichier annonce : *« Phase actuelle : 4 — Caisse (vente au comptoir, pain exonéré de TVA, moyens de paiement espèces/mobile money/carte, clôture journalière, alerte transaction inhabituelle au-dessus du seuil configuré) »*. Cette phrase décrit un état du projet **antérieur à la refonte de la Caisse** déjà documentée en détail au Volume 11j : la « vente au comptoir » (paiement par produit, clôture, alerte de transaction inhabituelle) a été **retirée** du périmètre de l'application — la spec elle-même l'indique explicitement en tête de sa section 3.1 (*« refonte : la vente au comptoir est retirée »*), et le code de `apps/api/src/routes/caisse.ts` (Volume 11j) ne contient plus aucune route de ce type, uniquement le registre journalier (taux du jour, dépenses, dont la dépense farine).

Le bas du fichier (section « Conventions ») porte la même trace : il documente encore `POST /api/caisse/ventes` et `POST /api/caisse/cloture` — deux routes qui n'existent plus dans le code actuel, vérifié directement au Volume 11j. **Ce n'est pas un écart entre la spécification et le code** (le code, lui, est bien conforme à la spec actuelle, comme établi au Volume 11j) — c'est une incohérence entre le code et sa **propre documentation d'installation**, du même ordre que le commentaire obsolète relevé dans `schema.prisma` au Volume 13. À l'inverse, la ligne consacrée aux Commissions dans ce même fichier (*« vue dérivée des commandes dont la Qualité a `commissionParBac > 0`... »*) correspond exactement à ce qui a été vérifié au Volume 11i — le fichier n'est donc pas uniformément obsolète, seule sa section Caisse ne reflète plus le code actuel. **Recommandation** (distincte d'un constat) : mettre à jour la mention de « Phase actuelle » et la section Caisse des Conventions pour refléter le registre journalier actuel.

## 5.5 Comptes de démonstration

Le tableau du `README.md` (mot de passe commun `Lomoto2026!`, jamais utilisé en production, Volume 5) correspond exactement aux 8 comptes créés par `prisma/seed.ts` (Volume 13, §5.7) et à la matrice de rôles qui y est définie — vérifié par lecture croisée directe des deux fichiers, sans divergence trouvée.

## 5.6 Cas limites et points de vigilance

| Situation | Constat |
|---|---|
| `npm install` sur une machine sans les workspaces npm à jour | Non testé spécifiquement ; `package.json` racine déclare `"workspaces": ["apps/*", "packages/*"]`, une fonctionnalité stable de npm depuis longtemps. |
| Port 5434 déjà occupé sur la machine de développement | La commande Docker du README échouerait ; aucune détection ni message d'aide spécifique du projet pour ce cas — un simple conflit de port Docker standard. |
| Lancer `npm run dev` sans base de données accessible | Le serveur API ne peut pas démarrer normalement (Prisma requiert une connexion active) — confirmé indirectement dans cet environnement, sans message d'erreur précis capturé dans le délai imparti. |
| Suivre les instructions « Phase actuelle » / Conventions Caisse du README à la lettre | Induirait en erreur : ces routes n'existent plus (§5.4). |

## 5.7 Croisement avec la spécification

Ce chapitre porte sur un guide d'installation, pas directement sur une section fonctionnelle de la spec. Le seul point de croisement direct — le retrait de la vente au comptoir — confirme que c'est bien le **code** qui suit la spec actuelle (Volume 11j), et le `README.md` qui accuse un retard de documentation (§5.4) : une incohérence de documentation interne, pas un écart spec/code au sens où ce livre l'entend, donc non ajoutée à `annexes/ecarts-spec-code.md`.

## 5.8 Résumé

L'installation du projet suit cinq étapes standards pour un monorepo npm avec PostgreSQL. Deux d'entre elles (installation des dépendances, validité du schéma et des tests unitaires) ont pu être vérifiées directement dans l'environnement de rédaction de ce livre ; les étapes nécessitant une base de données active (migration, seed, démarrage complet du serveur) n'ont pas pu l'être, faute d'infrastructure disponible ici — un état de fait signalé explicitement plutôt que supposé résolu. Le `README.md` contient par ailleurs une section « Phase actuelle » et une partie de sa section Conventions obsolètes par rapport au code actuel de la Caisse, à corriger.

---

**Suite →** Volume 5 — Configuration et variables d'environnement, qui détaille le contenu de `.env.example` et de `render.yaml`.
