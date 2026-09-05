# Inventaire du projet — Boulangerie Lomoto

> Ce document est le résultat de la **Phase 1 (audit préalable)** du livre technique. Il recense tous les fichiers propriétaires du dépôt, les classe par niveau de risque métier, et sert de base à `MATRICE_DE_COUVERTURE.md`.

## État du dépôt au moment de l'audit

| Élément | Valeur |
|---|---|
| Commit analysé | `ffe2e749ee1b6b5fcb39b69303f6518df5a65370` |
| Branche | `main-a7fm5x` |
| Date de l'audit | 2026-08-07 |
| Arbre de travail | Propre (aucune modification en attente au moment de l'audit) |

`CLAUDE.md` et `AGENTS.md` : **absents de ce dépôt** (recherche exhaustive effectuée, y compris dans les sous-dossiers). Aucune instruction spécifique à un agent IA n'existe donc en dehors de ce livre lui-même. Le dossier `.claude/` ne contient qu'un `launch.json` (configuration d'environnement de session, hors périmètre du livre).

## 1. Vue d'ensemble technique

L'application « Boulangerie Lomoto » est un monorepo npm workspaces à trois paquets :

| Paquet | Rôle | Techno principale |
|---|---|---|
| `apps/api` | Serveur HTTP + API REST + Socket.io | Express 4, Prisma 6, PostgreSQL, TypeScript (ESM) |
| `apps/web` | Interface web | React 19, Vite 6, Tailwind CSS 4, TypeScript |
| `packages/shared` | Types, schémas de validation (Zod) et fonctions de calcul partagés entre `api` et `web` | TypeScript pur, consommé en source (pas de build séparé) |

À la racine : `prisma/` (schéma de base de données + migrations + jeu de données de démonstration), `scripts/` (outils d'exploitation en ligne de commande), `docs/` (spécification fonctionnelle et notes de mise en production), et la configuration de premier niveau (`package.json`, `vitest.config.ts`, `render.yaml`, `.env.example`).

Détail complet des dépendances : voir Volume 3 (Technologies, langages et dépendances).

## 2. Grille de classification par niveau de risque métier

Grille appliquée telle que définie par la commande de ce livre :

- **Niveau 1 — Critique** : avance/dette client, registre de Caisse, commissions, paie et bulletins (calcul, arrondi, gel), permissions, workflow d'approbation, authentification.
- **Niveau 2 — Fonctionnel standard** : CRUD des autres modules, notifications temps réel, i18n, intégrations externes non financières.
- **Niveau 3 — Support/infrastructure** : configuration, scripts de build, fichiers de démarrage, primitives d'interface génériques, migrations générées.

Une quatrième catégorie hors grille est utilisée dans ce livre : **Source documentaire** — les fichiers Markdown qui décrivent déjà le comportement voulu (`docs/spec-boulangerie.md` en premier lieu) ne sont pas du code à expliquer, mais des références à croiser systématiquement.

## 3. Inventaire par zone du dépôt

Les tableaux ci-dessous listent **tous** les fichiers propriétaires retenus pour le livre. Les nombres de lignes sont ceux mesurés au commit audité (`wc -l`) et évolueront avec le code — se fier au nom de fichier et aux symboles, pas au numéro de ligne exact, en cas de dérive.

### 3.1 `apps/api/src/` — cœur du serveur (13 fichiers)

| Fichier | Lignes | Rôle | Niveau |
|---|---:|---|:---:|
| `app.ts` | 125 | Assemble l'application Express : CORS, montage de tous les routers, redirection canonique, 404 JSON, gestion d'erreurs centralisée | 2 |
| `index.ts` | 18 | Point d'entrée du process : crée le serveur HTTP, démarre Socket.io, le service de notifications et le planificateur de sauvegarde | 3 |
| `lib/audit.ts` | 188 | Extension Prisma qui journalise automatiquement les opérations `update`/`delete` dans `AuditLog` | 1 |
| `lib/cloudflareEmail.ts` | 120 | Intégration Cloudflare Email Routing (création d'adresses professionnelles) | 2 |
| `lib/contexteRequete.ts` | 15 | `AsyncLocalStorage` portant l'identité de l'auteur d'une requête jusqu'aux extensions Prisma | 2 |
| `lib/events.ts` | 45 | Bus d'événements interne (émission/écoute) utilisé par les notifications temps réel | 2 |
| `lib/ia.ts` | 155 | Appel REST à l'API Gemini pour l'Assistant IA (désactivé par défaut) | 2 |
| `lib/jwt.ts` | 24 | Signature et vérification des jetons JWT de session | 1 |
| `lib/logger.ts` | 35 | Logger structuré maison (JSON, sans dépendance externe) | 3 |
| `lib/origines.ts` | 50 | Liste blanche CORS + redirection de domaine canonique | 2 |
| `lib/parametres.ts` | 23 | Lecture/écriture générique de la table `ParametreBoutique` (clé/valeur) | 2 |
| `lib/prisma.ts` | 20 | Client Prisma singleton | 3 |
| `lib/realtime.ts` | 91 | Initialisation Socket.io, gestion des salles par utilisateur | 2 |

### 3.2 `apps/api/src/middleware/` (1 fichier)

| Fichier | Lignes | Rôle | Niveau |
|---|---:|---|:---:|
| `auth.ts` | 154 | `requireAuth`, `requirePermission`, chargement de l'utilisateur (rôle + permissions fusionnées + délégations + bump Admin Principal), vérification de session unique | 1 |

### 3.3 `apps/api/src/routes/` — endpoints REST (26 fichiers)

| Fichier | Lignes | Rôle | Niveau |
|---|---:|---|:---:|
| `approbations.ts` | 108 | File des demandes d'approbation (actions critiques différées pour un Admin secondaire) | 1 |
| `apropos.ts` | 76 | Page « À propos » éditable (contenu boutique, réseaux sociaux) | 2 |
| `assistant.ts` | 365 | Messagerie Assistant (humain + IA), captures d'écran, escalade | 2 |
| `audit.ts` | 59 | Lecture du journal d'audit | 2 |
| `auth.ts` | 139 | Connexion, session, changement de mot de passe, langue préférée | 1 |
| `caisse.ts` | 330 | Registre journalier de caisse, dépenses (dont dépense farine calculée) | 1 |
| `clients.ts` | 232 | CRUD fiche client (+ `typeClients`), zone de dépôt | 2 |
| `commandes.ts` | 498 | Enregistrement des commandes clients, calcul avance/dette, détection de doublon, alertes | 1 |
| `commissions.ts` | 50 | Calcul et consultation des commissions (clientes « Maman ») | 1 |
| `delegations.ts` | 93 | Délégation temporaire d'un droit d'écriture à un utilisateur | 1 |
| `departements.ts` | 210 | Départements et Groupes (organisation RH) | 2 |
| `equipe.ts` | 267 | Comptes utilisateurs, rôles, transfert du statut Admin Principal | 1 |
| `etat-systeme.ts` | 254 | Tableau de bord de maintenance : sauvegardes, réinitialisation, diagnostics | 2 |
| `export.ts` | 83 | Capacités d'export (PDF/email) exposées au frontend | 2 |
| `fournisseurs.ts` | 271 | Fournisseurs et commandes fournisseurs | 2 |
| `notifications.ts` | 71 | Liste et accusé de lecture des notifications d'un utilisateur | 2 |
| `parametres.ts` | 63 | Paramètres globaux (taux du jour, etc.) | 2 |
| `premierLancement.ts` | 139 | Assistant de premier lancement (base vide → création du premier Admin) | 2 |
| `production.ts` | 717 | Planning de production, Schéma de commande, Bon de livraison, écarts | 2 |
| `produits.ts` | 91 | Catalogue produits | 2 |
| `rapports-personnels.ts` | 328 | Rapports/exports à portée résolue par rôle | 2 |
| `rapports.ts` | 333 | Rapports agrégés (tableau de bord, exports) | 2 |
| `roles.ts` | 53 | Lecture/écriture de la matrice de permissions par rôle | 1 |
| `stocks.ts` | 191 | Matières premières, mouvements de stock | 2 |
| `travailleurs.ts` | 985 | Fiches employés, pointages, absences, sanctions, **salaire et bulletins de paie** | 1 |
| `zones-depositaires.ts` | 101 | Zones de dépôt (organisation, purement descriptif) | 2 |

### 3.4 `apps/api/src/services/` — logique métier réutilisable (11 fichiers)

| Fichier | Lignes | Rôle | Niveau |
|---|---:|---|:---:|
| `actionsCritiques.ts` | 175 | Exécution directe (Admin Principal) vs mise en attente d'approbation (Admin secondaire) des actions sensibles | 1 |
| `email.ts` | 86 | Envoi d'e-mails (rapports) via SMTP/Gmail | 2 |
| `emailPro.ts` | 140 | Orchestration de la création d'adresse professionnelle (Cloudflare) | 2 |
| `interventionsAdmin.ts` | 63 | Notifie les autres Admins d'une action hors du périmètre habituel d'un Admin secondaire | 2 |
| `notifications.ts` | 143 | Construction et diffusion des notifications (DTO, temps réel, ciblage par rôle) | 2 |
| `pdf.ts` | 361 | Génération de tous les documents PDF (factures, bulletins, bons de livraison) | 2 |
| `planificateurSauvegarde.ts` | 130 | Tâche cron quotidienne de sauvegarde | 2 |
| `reinitialisation.ts` | 117 | Réinitialisation complète de la base (suppression de toutes les données) | 2 |
| `sauvegarde.ts` | 155 | Production du dump `pg_dump` | 2 |
| `sauvegardeLocale.ts` | 87 | Stockage/rotation des sauvegardes sur disque local | 2 |
| `stocks.ts` | 96 | Fonctions de calcul de mouvement de stock | 2 |

> **Note de classification** : `reinitialisation.ts` a un impact potentiel catastrophique (perte totale des données) mais ne correspond à aucun des critères Niveau 1 explicitement listés (argent, permissions, approbation). Il est classé Niveau 2 par fidélité stricte à la grille fournie ; le chapitre correspondant signalera néanmoins sa criticité opérationnelle.

### 3.5 `packages/shared/src/` (2 fichiers)

| Fichier | Lignes | Rôle | Niveau |
|---|---:|---|:---:|
| `index.ts` | 1942 | **Fichier central du monorepo** : types, énumérations, schémas Zod de validation, DTO, et fonctions de calcul pures (`calculerCommande`, `calculerDepenseFarine`, `avanceAvantCommande`, `aAcces`, `formatFc`, etc.) | 1 |
| `index.test.ts` | 88 | Tests Vitest des fonctions critiques ci-dessus | 1 |

### 3.6 `prisma/` (31 fichiers)

| Fichier | Lignes | Rôle | Niveau |
|---|---:|---|:---:|
| `schema.prisma` | 980 | Modèle de données complet : 40 modèles, 14 énumérations, règles de cascade | 1 |
| `seed.ts` | 343 | Jeu de données de démonstration (rôles, comptes, clients, produits...) | 3 |
| `migrations/*.sql` (29 fichiers) | — | Historique des migrations, généré par Prisma à chaque évolution du schéma | 3 |

### 3.7 `scripts/` (1 fichier)

| Fichier | Lignes | Rôle | Niveau |
|---|---:|---|:---:|
| `restaurer-sauvegarde.ts` | 106 | Script CLI de restauration d'une sauvegarde `pg_restore` (jamais une route web) | 2 |

### 3.8 `apps/web/src/` — cœur applicatif frontend (8 fichiers hors pages/composants)

| Fichier | Lignes | Rôle | Niveau |
|---|---:|---|:---:|
| `App.tsx` | 244 | Arbre de routes, gardes de permission (`RequiertLecture`/`RequiertEcriture`), écran de démarrage | 2 |
| `main.tsx` | 38 | Point d'entrée React (montage racine, providers globaux) | 3 |
| `lib/api.ts` | 76 | Client HTTP (jeton, en-têtes, gestion des 401/session remplacée) | 1 |
| `lib/auth.tsx` | 173 | Contexte d'authentification frontend (`useAuth`, `peutLire`/`peutEcrire`) | 1 |
| `lib/socket.tsx` | 164 | Connexion Socket.io côté client, réception temps réel | 2 |
| `lib/theme.tsx` | 70 | Thème clair/sombre | 3 |
| `lib/csv.ts` | 36 | Export CSV générique | 3 |
| `lib/utils.ts` | 6 | Fonction utilitaire `cn` (fusion de classes Tailwind) | 3 |

### 3.9 `apps/web/src/i18n/` (5 fichiers)

| Fichier | Rôle | Niveau |
|---|---|:---:|
| `index.ts` | Initialisation i18next, résolution de la langue effective | 2 |
| `fr.json`, `en.json`, `ln.json`, `sw.json` | Dictionnaires de traduction (français, anglais, lingala, swahili) | 2 |

### 3.10 `apps/web/src/pages/` — écrans (22 fichiers)

| Fichier | Lignes | Rôle | Niveau |
|---|---:|---|:---:|
| `Approbations.tsx` | 159 | File des demandes d'approbation | 1 |
| `APropos.tsx` | 357 | Écran « À propos » | 2 |
| `Assistant.tsx` | 411 | Messagerie Assistant | 2 |
| `Audit.tsx` | 296 | Journal d'audit | 2 |
| `BonsLivraison.tsx` | 316 | Bon de livraison (sous-module Production) | 2 |
| `Caisse.tsx` | 507 | Registre de caisse | 1 |
| `Clients.tsx` | 383 | Fiche client (sous-module Commandes) | 2 |
| `Commandes.tsx` | 908 | Écran principal des commandes clients | 1 |
| `Commissions.tsx` | 207 | Écran des commissions | 1 |
| `Dashboard.tsx` | 593 | Tableau de bord (agrégation multi-modules) | 2 |
| `Equipe.tsx` | 700 | Comptes, rôles, permissions | 1 |
| `EtatSysteme.tsx` | 577 | Sauvegardes, réinitialisation, diagnostics | 2 |
| `Fournisseurs.tsx` | 621 | Fournisseurs et achats | 2 |
| `Login.tsx` | 170 | Connexion | 1 |
| `Parametres.tsx` | 333 | Paramètres globaux | 2 |
| `PremierLancement.tsx` | 200 | Assistant de premier lancement | 2 |
| `Production.tsx` | 1003 | Planning, Schéma de commande, écarts | 2 |
| `Produits.tsx` | 272 | Catalogue produits | 2 |
| `Profil.tsx` | 265 | Profil utilisateur (mot de passe, langue) | 2 |
| `RapportsPersonnels.tsx` | 197 | Rapports personnels | 2 |
| `Stocks.tsx` | 533 | Matières premières, mouvements | 2 |
| `Travailleurs.tsx` | 1054 | Fiches employés, pointages, absences, sanctions, paie et bulletins | 1 |

### 3.11 `apps/web/src/components/` — composants réutilisables (13 fichiers hors `ui/`)

| Fichier | Lignes | Rôle | Niveau |
|---|---:|---|:---:|
| `ActivityFeed.tsx` | 107 | Fil d'activité temps réel | 2 |
| `BarreExport.tsx` | 195 | Barre d'export (CSV/PDF/e-mail) réutilisable | 2 |
| `ChargementModule.tsx` | 16 | Indicateur de chargement générique | 3 |
| `DepartementsCard.tsx` | 316 | Gestion des départements/groupes | 2 |
| `DialogNouvelleZone.tsx` | 113 | Dialogue de création rapide d'une zone de dépôt | 2 |
| `EcranDemarrage.tsx` | 101 | Écran de démarrage (splash) | 3 |
| `FeedbackProvider.tsx` | 121 | Fournisseur de toasts/confirmations globaux | 3 |
| `IndicateurConnexion.tsx` | 33 | Indicateur de connexion Socket.io | 3 |
| `Layout.tsx` | 379 | Ossature de page (menu, en-tête), navigation filtrée par permission | 2 |
| `NotificationBell.tsx` | 97 | Cloche de notifications | 2 |
| `PaieCard.tsx` | 516 | Carte de calcul et génération des bulletins de paie | 1 |
| `PanneauEmailPro.tsx` | 147 | Panneau de gestion de l'adresse e-mail professionnelle | 2 |
| `ZonesDepositaireCard.tsx` | 182 | Gestion des zones de dépôt | 2 |

### 3.12 `apps/web/src/components/ui/` — primitives d'interface (11 fichiers, tous Niveau 3)

`badge.tsx`, `button.tsx`, `card.tsx`, `carte-ligne.tsx`, `dialog.tsx`, `input.tsx`, `label.tsx`, `select.tsx`, `sheet.tsx`, `table.tsx`, `textarea.tsx` — wrappers stylés au-dessus de Radix UI (voir Volume 3), peu ou pas de logique métier.

### 3.13 Configuration et outillage (11 fichiers, tous Niveau 3)

`package.json` (racine), `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/components.json`, `packages/shared/package.json`, `vitest.config.ts`, `render.yaml`, `.env.example`.

### 3.14 Sources documentaires (non classées 1/2/3 — références à croiser)

| Fichier | Rôle |
|---|---|
| `docs/spec-boulangerie.md` | Spécification fonctionnelle tenue à jour — **source de vérité sur le comportement voulu** |
| `README.md` | Démarrage rapide, comptes de démonstration |
| `DEPLOIEMENT.md` | Guide de déploiement en ligne (Render), sauvegarde/restauration |
| `docs/MISE-EN-PRODUCTION.md` | Rapport d'audit de mise en production (état constaté à une date donnée) |

## 4. Récapitulatif chiffré

| Zone | Fichiers | Niveau 1 | Niveau 2 | Niveau 3 |
|---|---:|---:|---:|---:|
| `apps/api/src/` (cœur) | 13 | 2 | 8 | 3 |
| `apps/api/src/middleware/` | 1 | 1 | 0 | 0 |
| `apps/api/src/routes/` | 26 | 9 | 17 | 0 |
| `apps/api/src/services/` | 11 | 1 | 10 | 0 |
| `packages/shared/src/` | 2 | 2 | 0 | 0 |
| `prisma/` | 31 | 1 | 0 | 30 |
| `scripts/` | 1 | 0 | 1 | 0 |
| `apps/web/src/` (cœur) | 8 | 2 | 2 | 4 |
| `apps/web/src/i18n/` | 5 | 0 | 5 | 0 |
| `apps/web/src/pages/` | 22 | 7 | 15 | 0 |
| `apps/web/src/components/` (hors ui) | 13 | 1 | 8 | 4 |
| `apps/web/src/components/ui/` | 11 | 0 | 0 | 11 |
| Configuration/outillage | 11 | 0 | 0 | 11 |
| **Total code** | **155** | **26** | **66** | **63** |
| Sources documentaires (hors grille) | 4 | — | — | — |
| **Total général** | **159** | | | |

Lignes de code propriétaires (hors migrations SQL et JSON i18n) : environ **26 000 lignes** (`apps/api/src` ≈ 8 700, `apps/web/src` ≈ 13 700, `packages/shared/src` ≈ 2 000, `prisma/schema.prisma` + `seed.ts` ≈ 1 300, `scripts/` ≈ 100).

## 5. Fichiers explicitement hors périmètre du traitement ligne à ligne

Conformément aux règles de la mission :

- `node_modules/` (toutes dépendances) — jamais analysé.
- `apps/web/dist/`, tout dossier `dist/` ou `build/` — artefacts générés.
- `package-lock.json` — généré, non expliqué ligne à ligne (son rôle général est mentionné au Volume 3).
- `prisma/migrations/*.sql` — générées automatiquement par `prisma migrate` ; couvertes de façon groupée (une ligne de synthèse par migration) au chapitre Base de données, pas ligne à ligne.
- `.git/`, `.claude/launch.json` — configuration d'environnement, hors périmètre applicatif.

## 6. Prochaine étape

Voir `ETAT_DE_PROGRESSION.md` pour l'estimation de calibrage et le plan de travail détaillé, et `MATRICE_DE_COUVERTURE.md` pour le suivi fichier par fichier.
