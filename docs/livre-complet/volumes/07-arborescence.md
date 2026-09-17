# Volume 7 — Arborescence détaillée du projet

**Niveau de risque : 3 — Support/infrastructure.** Traitement concis : ce chapitre explique le **rôle de chaque dossier**, pas fichier par fichier — pour le détail fichier par fichier avec niveau de risque, se reporter à `INVENTAIRE_DU_PROJET.md`, déjà exhaustif sur ce point. L'objectif ici est de donner au lecteur un plan mental du dépôt avant d'y naviguer.

## 5.1 Vue d'ensemble

```
Boulangerie/
├── apps/
│   ├── api/        # Backend Express + TypeScript
│   └── web/         # Frontend React + Vite + TypeScript
├── packages/
│   └── shared/       # Types, schémas Zod et fonctions pures partagés
├── prisma/           # Schéma de base de données, migrations, seed
├── docs/              # Spécification et notes de mise en production
├── scripts/           # Outils d'exploitation en ligne de commande
├── README.md, DEPLOIEMENT.md, render.yaml, .env.example, package.json...
```

Trois paquets npm (`apps/api`, `apps/web`, `packages/shared`) liés par les *workspaces* npm (Volume 3) : `packages/shared` n'est jamais compilé séparément, il est importé comme source TypeScript brute par les deux autres.

## 5.2 `apps/api/src/` — le serveur

| Dossier | Contenu | Rôle |
|---|---|---|
| `routes/` | 26 fichiers | Un fichier par domaine fonctionnel (`commandes.ts`, `caisse.ts`, `travailleurs.ts`...) — chacun exporte un `Router` Express monté dans `app.ts` (Volume 8). C'est ici que vivent la quasi-totalité des 26 fichiers Niveau 1 déjà couverts aux volumes 11a-11k. |
| `lib/` | 11 fichiers | Utilitaires transversaux, indépendants d'un domaine métier précis : `jwt.ts`, `prisma.ts`, `audit.ts`, `contexteRequete.ts` (Volumes 11b, 11g), `logger.ts` (Volume 16, à venir), `origines.ts` (CORS, Volume 8/14), `events.ts` (bus d'événements, Volume 12), `realtime.ts` (Socket.io, Volume 12), `parametres.ts`, `ia.ts`, `cloudflareEmail.ts` (Volume 18). |
| `middleware/` | 1 fichier | `auth.ts` — `requireAuth`/`requirePermission`/`chargerUtilisateur` (Volume 11b), le seul middleware Express personnalisé du projet en dehors de ceux posés directement dans `app.ts`. |
| `services/` | 11 fichiers | Logique orchestrant plusieurs sources ou effets de bord au-delà d'une simple route CRUD : `actionsCritiques.ts` (Volume 11f), `emailPro.ts`/`email.ts` (Cloudflare/Gmail, Volume 18), `pdf.ts` (export, Volume 18), `sauvegarde.ts`/`sauvegardeLocale.ts`/`planificateurSauvegarde.ts`/`reinitialisation.ts` (Volume 23), `notifications.ts` (Volume 12), `interventionsAdmin.ts`, `stocks.ts`. |

Un point de convention à noter : `routes/` contient la logique HTTP (validation, réponses, codes de statut) tandis que `services/` contient une logique réutilisable **indépendante** du contexte HTTP — appelée par une ou plusieurs routes, mais qui ne connaît jamais `req`/`res` directement (à l'exception de `actionsCritiques.ts`, qui reçoit `req` pour lire l'auteur, Volume 11f).

## 5.3 `apps/web/src/` — le client

| Dossier | Contenu | Rôle |
|---|---|---|
| `pages/` | 22 fichiers | Un composant par écran, chargé en lazy depuis `App.tsx` (Volume 10) sauf `Login.tsx` et `PremierLancement.tsx` (Volume 8). Chaque fichier correspond presque toujours à un module de la matrice de permissions. |
| `components/` | 14 fichiers (hors `ui/`) | Composants réutilisés par plusieurs pages ou par la coquille de l'application : `Layout.tsx` (Volume 9), `EcranDemarrage.tsx` (Volume 8), `FeedbackProvider.tsx`, `NotificationBell.tsx`, `BarreExport.tsx`, `PaieCard.tsx` (Volume 11k-3), `PanneauEmailPro.tsx`, `DepartementsCard.tsx`, `ZonesDepositaireCard.tsx`, `DialogNouvelleZone.tsx`, `ActivityFeed.tsx`, `IndicateurConnexion.tsx`, `ChargementModule.tsx`. |
| `components/ui/` | 11 fichiers | Primitives d'interface génériques, sans logique métier — `button.tsx`, `card.tsx`, `dialog.tsx`, `table.tsx`, `carte-ligne.tsx` (vue mobile, Volume 9), `select.tsx`, `sheet.tsx`, `input.tsx`, `label.tsx`, `textarea.tsx`, `badge.tsx`. |
| `lib/` | 6 fichiers | `api.ts`/`auth.tsx` (Volume 11b), `socket.tsx` (Socket.io côté client, Volume 12), `theme.tsx` (clair/sombre), `csv.ts` (export, Volume 18), `utils.ts` (`cn`, fusion de classes Tailwind). |
| `i18n/` | 5 fichiers | `fr.json`, `en.json`, `ln.json`, `sw.json` (les 4 langues, Volume 17) et `index.ts` (initialisation react-i18next). |

Un fichier de configuration propre au frontend mérite d'être noté ici : `apps/web/components.json`, qui pilote **shadcn/ui** (Volume 3) — pas une bibliothèque installée comme dépendance classique, mais un générateur qui copie des composants Radix pré-stylés directement dans `components/ui/`, expliquant pourquoi ce dossier appartient au code du projet plutôt qu'à `node_modules`.

## 5.4 `packages/shared/src/`

Un seul fichier central, déjà largement couvert : `index.ts` (1942 lignes, Volume 11a et suivants) et son fichier de test `index.test.ts` (Volume 11a). Aucune subdivision en sous-dossiers — un choix délibéré déjà commenté au Volume 2 : toute la surface de contrat entre le client et le serveur (types, schémas Zod, DTO, fonctions de calcul pures) vit dans un seul point d'import (`@lomoto/shared`), pour qu'un changement de contrat soit toujours visible en un seul endroit.

## 5.5 `prisma/`

Déjà entièrement couvert au Volume 13 : `schema.prisma`, `migrations/` (29 dossiers horodatés), `seed.ts`.

## 5.6 `docs/` et `scripts/`

`docs/spec-boulangerie.md` est la spécification fonctionnelle — la source de vérité de l'intention, citée à chaque chapitre de ce livre. `scripts/` contient des outils d'exploitation en ligne de commande, dont `restaurer-sauvegarde.ts` (Volume 23, déjà mentionné dans l'historique de ce projet comme testé en conditions réelles).

## 5.7 Résumé

L'arborescence suit une séparation stricte entre trois paquets (API, Web, partagé), chacun organisé par **rôle technique** (routes/lib/middleware/services côté serveur ; pages/components/lib côté client) plutôt que par domaine métier — c'est la convention de nommage des fichiers eux-mêmes (`commandes.ts`, `Caisse.tsx`...) qui porte le découpage fonctionnel à l'intérieur de cette structure technique.

---

**Suite →** Volume 8 — Cycle de démarrage, qui trace le chemin exact parcouru par le code depuis le lancement du serveur et du navigateur jusqu'au premier écran affiché.
