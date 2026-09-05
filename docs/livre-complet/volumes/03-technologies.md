# Volume 3 — Technologies, langages et dépendances

Ce chapitre répond à la question : *avec quoi ce projet est-il construit, et pourquoi ?* Chaque affirmation ci-dessous est déduite d'un usage réel constaté dans le code (imports, configuration) — ce chapitre n'affirme jamais qu'une bibliothèque est utilisée si son usage n'a pas été repéré dans le dépôt.

## 3.1 Le langage : TypeScript, partout

L'intégralité du code propriétaire (serveur, interface, paquet partagé) est écrite en **TypeScript**, un langage qui ajoute un système de types statique par-dessus JavaScript. Concrètement :

- Le code est écrit avec des types (`function calculerCommande(params: { quantiteBacs: number; ... })`) ;
- Un outil (`tsc`, le compilateur TypeScript) vérifie la cohérence de ces types **avant l'exécution** — une erreur de type (ex. passer une chaîne de caractères là où un nombre est attendu) est détectée en développement, jamais découverte en production par un utilisateur.
- Les trois paquets utilisent le mode **ESM** (`"type": "module"` dans chaque `package.json`) — le système de modules standard actuel de JavaScript (`import`/`export`), par opposition à l'ancien système CommonJS (`require`/`module.exports`).

TypeScript n'est **jamais exécuté directement** par Node.js ou le navigateur : il est soit compilé (`tsc`, utilisé pour vérifier les types du serveur au moment du build), soit transformé à la volée par un outil comme `tsx` (serveur, en développement) ou `vite` (interface, en développement et en production). Ce point est développé au Volume 8 (Cycle de démarrage).

## 3.2 Le serveur — `apps/api`

| Dépendance | Rôle dans ce projet |
|---|---|
| **Express** (`express`) | Le framework HTTP qui reçoit les requêtes, les route vers la bonne fonction (`routes/*.ts`), et renvoie une réponse. C'est le squelette de toute l'API REST. |
| **Prisma** (`@prisma/client`, et le CLI `prisma` en outil de développement) | L'ORM (*Object-Relational Mapper*) qui traduit les appels TypeScript (`prisma.commandeClient.findMany(...)`) en requêtes SQL vers PostgreSQL, et génère automatiquement des types TypeScript à partir du schéma de base de données (`prisma/schema.prisma`). Détaillé au Volume 13. |
| **PostgreSQL** | Le système de gestion de base de données relationnelle utilisé en production et en développement (pas embarqué dans le code — un serveur PostgreSQL séparé, dont l'adresse est fournie par `DATABASE_URL`). |
| **jsonwebtoken** | Génère et vérifie les jetons JWT utilisés pour authentifier chaque requête après la connexion. Voir `lib/jwt.ts`, Volume 11b. |
| **bcryptjs** | Hache les mots de passe avant stockage (jamais en clair) et vérifie un mot de passe saisi contre son hachage. |
| **Socket.io** (`socket.io`) | Bibliothèque de communication temps réel bidirectionnelle entre le serveur et le navigateur (notifications instantanées, fil d'activité, déconnexion forcée) — au-dessus des WebSockets, avec repli automatique si la connexion directe échoue. |
| **Zod** (`zod`) | Bibliothèque de validation de schémas — décrit la forme attendue d'une donnée entrante et la vérifie réellement à l'exécution. Utilisée dans `packages/shared` et donc partagée avec le frontend. Voir Volume 15. |
| **node-cron** | Planifie l'exécution périodique d'une fonction (ici, la sauvegarde automatique quotidienne de la base). Voir `services/planificateurSauvegarde.ts`. |
| **PDFKit** (`pdfkit`) | Génère des documents PDF programmatiquement (factures, bulletins de paie, bons de livraison) sans passer par un moteur de rendu HTML. Voir `services/pdf.ts`. |
| **Nodemailer** (`nodemailer`) | Envoie des e-mails via un serveur SMTP (Gmail dans la configuration observée). Voir `services/email.ts`. |
| **cors** | Middleware Express qui applique la politique CORS définie dans `lib/origines.ts`. |
| **dotenv** | Charge les variables d'environnement depuis un fichier `.env` en développement. |
| **tsx** | Exécute directement un fichier TypeScript sans étape de compilation séparée — utilisé pour lancer le serveur en développement (`tsx watch`) et pour exécuter les scripts (`prisma/seed.ts`, `scripts/restaurer-sauvegarde.ts`). |

## 3.3 L'interface web — `apps/web`

| Dépendance | Rôle dans ce projet |
|---|---|
| **React** (`react`, `react-dom`), version 19 | Bibliothèque de construction d'interface par composants. Chaque écran (`pages/*.tsx`) et chaque élément réutilisable (`components/*.tsx`) est un composant React. |
| **Vite** | Outil de développement et de build. En développement, il sert les fichiers avec rechargement instantané ; en production (`vite build`), il assemble et minifie tout le code en fichiers statiques déployables. Voir Volume 21. |
| **Tailwind CSS**, version 4 (`tailwindcss`, `@tailwindcss/vite`) | Framework CSS utilitaire — les styles sont appliqués directement dans le JSX via des classes (`className="flex items-center gap-2"`) plutôt que dans des fichiers CSS séparés. |
| **Radix UI** (`@radix-ui/react-dialog`, `@radix-ui/react-label`, `@radix-ui/react-slot`) | Bibliothèque de composants d'interface *sans style visuel imposé*, qui gère uniquement le comportement accessible (focus, clavier, ARIA) — ex. une boîte de dialogue qui piège le focus et se ferme avec Échap. Les composants de `components/ui/` habillent ces primitives avec le style Tailwind du projet (voir Volume 9). |
| **TanStack Query** (`@tanstack/react-query`) | Gère la récupération, la mise en cache et l'invalidation des données venant du serveur. Chaque appel `useQuery`/`useMutation` du code passe par cette bibliothèque. Voir Volume 10 (Navigation et gestion de l'état). |
| **react-router-dom**, version 7 | Gère la navigation entre écrans sans recharger la page (routage côté client). Voir `App.tsx`, Volume 10. |
| **i18next** / **react-i18next** | Système d'internationalisation : charge les dictionnaires (`i18n/*.json`) et fournit la fonction `t()` utilisée dans tous les composants pour afficher un texte traduit. Voir Volume 17. |
| **lucide-react** | Bibliothèque d'icônes SVG utilisées dans toute l'interface. |
| **class-variance-authority**, **clsx**, **tailwind-merge** | Trois petites bibliothèques combinées dans la fonction utilitaire `cn` (`lib/utils.ts`) pour composer des classes Tailwind conditionnelles sans conflit (ex. une classe passée en prop qui doit l'emporter sur une classe par défaut). |
| **recharts** | Bibliothèque de graphiques (utilisée dans `pages/Dashboard.tsx` pour les visualisations du tableau de bord). |
| **framer-motion** | Bibliothèque d'animations, utilisée pour des transitions d'interface (ex. `components/ActivityFeed.tsx`, `components/NotificationBell.tsx`, `components/IndicateurConnexion.tsx`, `components/Layout.tsx`). |
| **socket.io-client** | Le pendant côté navigateur de Socket.io, pour recevoir les événements temps réel émis par le serveur. |

## 3.4 Le paquet partagé — `packages/shared`

Ce paquet n'a qu'une seule dépendance de production : **Zod**. Il ne contient aucune dépendance vers `apps/api` ni `apps/web` — c'est une règle d'architecture implicite mais respectée dans tout le code observé : le partagé ne dépend jamais de ceux qui en dépendent (voir Volume 6, Architecture générale, pour le schéma de cette relation).

Particularité technique importante : `packages/shared/package.json` ne déclare **aucune étape de build**. Son `main` et ses `exports` pointent directement vers `./src/index.ts` — le fichier TypeScript source, pas un fichier compilé. C'est possible parce que les deux consommateurs (`apps/api` via `tsx`, `apps/web` via Vite) savent tous les deux transformer du TypeScript à la volée. Conséquence concrète : modifier `packages/shared/src/index.ts` est immédiatement visible dans `apps/api` et `apps/web` sans étape de publication ni de recompilation manuelle.

## 3.5 Outillage transverse (racine du monorepo)

| Outil | Rôle |
|---|---|
| **npm workspaces** | Mécanisme natif de npm qui permet de gérer plusieurs paquets (`apps/*`, `packages/*`) depuis un seul `package.json` racine, avec des dépendances internes résolues sans publication. Voir Volume 2 (§ Monorepo) et Volume 6. |
| **Vitest** | Framework de tests, ajouté au projet pour les tests unitaires de `packages/shared/src/index.test.ts`. Exécuté avec `npm test` (`vitest run`). Voir Volume 19. |
| **npm-run-all2** (`npm-run-all`) | Utilitaire qui permet de lancer plusieurs scripts npm en parallèle (`npm run dev` démarre `dev:api` et `dev:web` simultanément). |

## 3.6 Ce qui n'est PAS utilisé (constat, pas une critique)

Pour éviter toute supposition erronée du lecteur venant d'autres projets similaires, ce livre note explicitement l'absence de certains outils que l'on pourrait s'attendre à trouver :

- **Aucun framework de composants complet** (type Material UI ou Ant Design) — l'interface est construite à la main au-dessus de Radix UI et Tailwind.
- **Aucun ORM alternatif ni requêtes SQL manuelles généralisées** — Prisma est le seul point d'accès à la base de données (à une exception ponctuelle près, documentée au Volume 13).
- **Aucune bibliothèque de gestion d'état globale dédiée** (type Redux) — l'état serveur passe par TanStack Query, l'état local par les hooks React natifs (`useState`, contextes).
- **Aucun logger externe** (type Winston ou Pino) — un petit module maison (`lib/logger.ts`) suffit au volume du projet. Voir Volume 16.

## Résumé du volume

Le serveur repose sur Express, Prisma/PostgreSQL, JWT et Socket.io ; l'interface sur React 19, Vite, Tailwind CSS 4 et Radix UI ; les deux partagent un unique paquet de types et de validations Zod, consommé en TypeScript source sans étape de build. L'outillage transverse (npm workspaces, Vitest) reste volontairement minimal, cohérent avec la taille du projet.

**Suite** → Volume 6 : Architecture générale *(les Volumes 4 et 5 — Installation et Configuration — seront rédigés dans un lot ultérieur, voir `ETAT_DE_PROGRESSION.md`)*. Pour la suite immédiate de ce lot de travail, voir Volume 11a : Noyau financier et permissions.
