# Volume 5 — Configuration et variables d'environnement

**Niveau de risque : 3 — Support/infrastructure.** Traitement correct et concis. Ce chapitre explique le **rôle** de chaque variable d'environnement du projet — jamais sa valeur, conformément aux règles de sécurité de ce livre — en local (`.env.example`) et sur l'hébergeur (`render.yaml`).

> **Mise à jour (correctif P0-01, 19-20/08/2026, complété après revue externe)** : la `buildCommand` de `render.yaml` citée dans ce chapitre (`npm run db:seed`) n'est plus exacte — le build de production n'exécute plus jamais le seed de démonstration. Elle appelle désormais `npm run typecheck --workspace apps/api` puis `npm run db:bootstrap:production` (rôles/permissions/motifs fixes uniquement, jamais un compte) à la place. Voir `DEPLOIEMENT.md` § « Correctif P0-01 » pour le `buildCommand` actuel faisant foi. Ce chapitre reste un instantané du code tel qu'il existait à sa rédaction et n'est pas réécrit au-delà de cette note.

## Fiche d'identité

| Fichier | Rôle |
|---|---:|
| `.env.example` | Modèle des variables d'environnement locales, à copier en `.env` (Volume 4) |
| `render.yaml` | Blueprint de déploiement Render : base de données managée + service web, avec ses propres variables |

## 5.1 Vue d'ensemble — deux environnements, deux fichiers, jamais de valeurs partagées

Un principe affiché explicitement dans les deux fichiers, à plusieurs reprises : les valeurs des variables **ne se propagent jamais** d'un environnement à l'autre. `.env.example` le précise pour les identifiants Gmail (*« À renseigner SÉPARÉMENT en local et sur l'hébergeur »*) ; `render.yaml` le confirme pour les mêmes variables (*« À saisir ici ET dans le .env local : les deux environnements sont indépendants »*). Ce chapitre ne révèle ni ne suppose aucune valeur réelle — seulement le **rôle** de chaque variable et son **repli** (comportement de l'application quand elle est absente).

## 5.2 Variables obligatoires

| Variable | Rôle | Comportement si absente |
|---|---|---|
| `DATABASE_URL` | Chaîne de connexion PostgreSQL (protocole, identifiants, hôte, port, nom de base) | L'application ne peut pas démarrer — Prisma ne peut établir aucune connexion (Volume 13). Sur Render, injectée **automatiquement** depuis la base managée (`fromDatabase`, §5.4) — jamais saisie à la main sur cet hébergeur. |
| `JWT_SECRET` | Clé de signature des jetons JWT (Volume 11b) | **Échec rapide et volontaire en production** : le serveur refuse de démarrer plutôt que de signer des jetons avec une clé absente ou prévisible — comportement déjà détaillé au Volume 11b (`lib/jwt.ts`). Sur Render, générée automatiquement par la plateforme (`generateValue: true`, §5.4) — jamais choisie ni visible par un humain. |
| `PORT` | Port d'écoute du serveur API en local | `.env.example` fixe `3001` (cohérent avec le `README.md`, Volume 4) ; Render gère son propre port en interne et ne l'expose pas comme variable de ce type. |

Ces trois variables forment le socle minimal sans lequel l'application ne peut fonctionner d'aucune manière — toutes les autres variables de ce chapitre sont **optionnelles**, chacune activant une fonctionnalité précise sans jamais bloquer le reste de l'application en son absence (principe rappelé explicitement à plusieurs endroits des deux fichiers, §5.3).

## 5.3 Variables optionnelles — chacune avec un repli documenté

### Envoi des rapports par e-mail (spec section 3.13)

| Variable | Rôle |
|---|---|
| `GMAIL_USER` | Adresse Gmail/Google Workspace utilisée comme expéditeur |
| `GMAIL_APP_PASSWORD` | **Mot de passe d'application** Google — explicitement pas le mot de passe du compte lui-même (une distinction de sécurité propre à Google : un mot de passe d'application est révocable indépendamment, sans changer le mot de passe principal du compte) |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE` | Surcharges facultatives, pour un fournisseur SMTP autre que Gmail (tests, environnement alternatif) |

**Repli si absentes** : le bouton « Envoyer par e-mail » d'un rapport exporté (Volume 11i pour Commissions, et les autres modules concernés par la spec 3.13) ne s'affiche tout simplement pas — l'impression et le téléchargement PDF, eux, continuent de fonctionner normalement (`render.yaml`, commentaire explicite). Aucune fonctionnalité cœur de métier n'est affectée.

### Adresse e-mail professionnelle (spec section 3.18, Volume 11k-1)

| Variable | Rôle |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Jeton d'API Cloudflare — **deux portées distinctes requises simultanément**, un détail de sécurité que les deux fichiers prennent soin d'expliquer : *« Email Routing Addresses: Edit »* est une permission de **compte**, nécessaire pour créer une adresse de destination ; *« Email Routing Rules: Edit »* est une permission de **zone** (limitable au seul domaine de messagerie du projet), nécessaire pour créer la règle de routage elle-même. Un jeton scopé uniquement à la seconde ne suffit pas. |
| `CLOUDFLARE_ZONE_ID` | Identifiant de la zone DNS Cloudflare (visible dans le tableau de bord Cloudflare, page du domaine) |
| `CLOUDFLARE_ACCOUNT_ID` | Identifiant du compte Cloudflare — une portée différente du Zone ID, requise pour les adresses de destination |

**Repli si absentes** : le bouton « Créer l'adresse pro » (Volume 11k-1) reste visible mais échoue avec un message d'erreur clair, plutôt que de planter silencieusement — aucune autre fonctionnalité du module Travailleurs n'est affectée.

### Assistant IA (spec section 3.19)

| Variable | Rôle |
|---|---|
| `GEMINI_API_KEY` | Clé de l'API Gemini (Google) pour la couche IA de premier niveau de l'Assistant |
| `GEMINI_MODEL` | Identifiant du modèle Gemini à utiliser — optionnel, replié sur une valeur par défaut codée dans `lib/ia.ts` en son absence |
| `ASSISTANT_IA_ACTIF` | Bascule fonctionnelle (`"true"`/`"false"`), **indépendante de la présence de la clé** — même si `GEMINI_API_KEY` était renseignée, cette variable permet de désactiver la couche IA sans toucher au code |

**Repli si absentes** : conforme à la spec (§5.2 ci-dessus, section 3.19 citée) — l'Assistant reste pleinement utilisable en mode humain, chaque message bascule simplement en escalade automatique directe vers un Admin, sans appel à l'API Gemini. `render.yaml` fixe explicitement `ASSISTANT_IA_ACTIF: "false"` en valeur par défaut sur Render — la couche IA y est donc désactivée intentionnellement au moment de la rédaction de ce livre, cohérent avec la note de la spec (*« bloquée par la facturation Google Cloud à finaliser »*).

### Sauvegarde de la base (spec section 3.15, Volume 23 à venir)

| Variable | Rôle |
|---|---|
| `BACKUP_CRON` | Expression cron de la sauvegarde automatique quotidienne |
| `BACKUP_TIMEZONE` | Fuseau horaire d'interprétation de cette expression cron |
| `BACKUP_LOCAL_DIR` | Répertoire de stockage local des sauvegardes — utile si l'hébergeur propose un disque persistant |
| `BACKUP_LOCAL_RETENTION` | Nombre de sauvegardes locales conservées avant purge des plus anciennes |
| `PG_DUMP_PATH` | Chemin explicite vers l'exécutable `pg_dump`, si l'hôte ne le place pas dans le `PATH` |

Toutes optionnelles, avec des valeurs par défaut codées dans `services/sauvegardeLocale.ts` (Volume 23) — ce chapitre n'entre pas dans le détail de ces valeurs par défaut, réservé au chapitre applicatif dédié. Le commentaire du fichier rappelle l'historique déjà connu de ce livre (Volume 13, `INVENTAIRE_DU_PROJET.md`) : *« un compte de service Google Cloud a été essayé puis abandonné, les comptes de service n'ayant pas de quota de stockage propre sur Google Drive »* — la sauvegarde automatique écrit donc en local sur le disque du serveur, jamais vers un service externe.

## 5.4 `render.yaml` — au-delà des variables, la structure du déploiement

Au-delà des variables déjà couvertes ci-dessus (chacune retrouvée à l'identique, avec les mêmes explications, dans `render.yaml`), ce fichier définit la **forme** du déploiement lui-même :

```yaml
databases:
  - name: lomoto-db
    plan: free
    databaseName: boulangerie_lomoto
    user: lomoto
    region: frankfurt

services:
  - type: web
    name: boulangerie-lomoto
    runtime: node
    plan: free
    region: frankfurt
    buildCommand: >-
      npm install --include=dev &&
      npx prisma generate &&
      npx prisma migrate deploy &&
      npm run db:seed &&
      npm run build --workspace apps/web
    startCommand: npm run start --workspace apps/api
    healthCheckPath: /api/health
```

**Un seul service web** héberge à la fois l'API et le frontend compilé — le commentaire d'en-tête du fichier le précise (*« l'API Express sert aussi le frontend compilé »*), une architecture plus simple qu'un déploiement à deux services séparés, cohérente avec l'offre gratuite de Render visée par ce projet (`plan: free` sur les deux ressources).

**`--include=dev`** dans la commande de build est un détail technique qui mérite d'être compris : Render positionne `NODE_ENV=production` pendant le déploiement, ce qui ferait normalement ignorer les `devDependencies` par `npm install` — or le build a justement besoin d'outils qui y résident (`vite`, le CLI Prisma). Le commentaire du fichier l'explique explicitement. La commande de build enchaîne cinq étapes dans un ordre logique : installer (avec les outils de dev), générer le client Prisma (Volume 13), appliquer les migrations déjà écrites (`migrate deploy`, la variante non interactive de `migrate dev` utilisée en local, Volume 4 — elle ne génère jamais de nouvelle migration, seulement applique celles déjà présentes dans le dépôt), exécuter le seed (Volume 13 — rejouable sans risque, `upsert` partout), puis construire le frontend. `startCommand: npm run start --workspace apps/api` lance ensuite `tsx src/index.ts` (le script `start` du workspace API, sans le rechargement automatique de `dev`, Volume 4) — c'est ce même serveur Express qui sert aussi les fichiers statiques du frontend compilé (détail vérifiable dans `apps/api/src/app.ts`, Volume 8, à venir).

**`healthCheckPath: /api/health`** : Render interroge périodiquement cette route pour savoir si le service est opérationnel — un mécanisme standard de la plateforme, distinct des routes applicatives déjà couvertes dans ce livre.

`NODE_VERSION: "22"` fixe explicitement la version de Node.js utilisée sur Render — cohérente avec la version confirmée dans l'environnement de rédaction de ce livre (Volume 4, §5.1), garantissant que le comportement observé localement se reproduit sur l'hébergeur.

## 5.5 Cas limites

| Situation | Comportement |
|---|---|
| `JWT_SECRET` absent en production | Démarrage du serveur refusé (Volume 11b) — jamais de valeur par défaut silencieuse. |
| `GMAIL_USER`/`GMAIL_APP_PASSWORD` absents | Export PDF et impression fonctionnent ; seul l'envoi par e-mail est masqué. |
| Jeton Cloudflare avec une seule des deux portées requises | La création de l'adresse pro échoue avec un message d'erreur clair (Volume 11k-1) plutôt qu'un succès partiel silencieux. |
| `ASSISTANT_IA_ACTIF` absent | D'après `render.yaml`, une valeur explicite `"false"` est toujours définie sur Render — l'absence pure ne survient qu'en local, où le repli documenté au Volume 5.3 (mode humain) s'applique. |
| Variables Render marquées `sync: false` | Jamais stockées dans le dépôt Git — saisies manuellement dans l'interface Render, indépendamment du `.env` local. |

## 5.6 Croisement avec la spécification

Chaque groupe de variables optionnelles correspond exactement à la section de spec qui motive sa fonctionnalité (3.13 pour l'e-mail, 3.15 pour la sauvegarde, 3.18 pour l'e-mail professionnel, 3.19 pour l'Assistant IA) — déjà vérifié section par section dans ce chapitre. Aucun écart trouvé.

## 5.7 Résumé

La configuration du projet suit une règle simple, répétée dans les deux fichiers : trois variables sont strictement obligatoires (connexion base de données, secret JWT, port local), toutes les autres sont optionnelles et chacune a un repli documenté qui désactive proprement une fonctionnalité précise sans jamais mettre en péril le reste de l'application. `render.yaml` ajoute à cela la structure du déploiement lui-même — un seul service Node qui sert à la fois l'API et le frontend compilé, avec une chaîne de build qui régénère systématiquement le client Prisma et applique les migrations (voir la mise à jour en tête de chapitre : depuis le correctif P0-01, ce n'est plus le seed de démonstration qui est rejoué à chaque déploiement, mais le bootstrap de production, non destructif).

---

**Suite →** Volume 6 — Architecture générale, qui assemblera la vue d'ensemble du système (client/serveur/base/Socket.io/services externes) à partir de tout ce qui a été établi jusqu'ici.
