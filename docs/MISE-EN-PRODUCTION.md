# Mise en production — Boulangerie Lomoto

> Dernière vérification : **2026-08-06**, à partir de l'état réel du code (commit `17187c6`) et de vérifications **en direct** sur `https://boulangerie-lomoto.com` (santé API, `/api/etat-systeme`, `/api/export/capacites`, `/api/apropos`, connexion avec un compte réel). Chaque point ci-dessous précise s'il a été **vérifié en direct**, **déduit** du code, ou **non vérifiable** depuis cette session.

Légende : 🔴 Obligatoire · 🟡 Recommandé · ⚪ Optionnel

---

## 1. Infrastructure technique

### 🔴 Obligatoire — expiration de la base PostgreSQL gratuite

`render.yaml` déclare la base `lomoto-db` en `plan: free`. **Ceci n'est pas un simple ralentissement comme la mise en veille du service web** : chez Render, une base PostgreSQL gratuite **expire 30 jours après sa création**, puis dispose de 14 jours de grâce pour être mise à niveau — passé ce délai, **l'instance et toutes ses données sont supprimées définitivement**. Ce n'est pas vérifiable depuis cette session (aucun accès au tableau de bord Render, et l'API applicative n'expose pas la date de création de la base) : **va vérifier la date d'expiration exacte dans le tableau de bord Render dès maintenant** (page de la base → colonne « Expires on »), et passe la base sur une offre payante avant cette date. C'est le point le plus urgent de tout ce document — au-delà de la mise en veille, il s'agit ici d'une suppression pure et simple des données réelles de l'entreprise.

L'offre gratuite Postgres n'inclut de toute façon aucune sauvegarde gérée par Render lui-même ; la sauvegarde automatique quotidienne actuelle (voir plus bas) est écrite par l'application sur le disque du service web, qui est **éphémère** sur l'offre gratuite (perdu à chaque redéploiement).

### 🟡 Recommandé — service web sur offre payante

`render.yaml` déclare aussi le service web `boulangerie-lomoto` en `plan: free`. **Vérifié dans la doc Render** : un service gratuit se met en veille après 15 minutes sans trafic, avec ~1 minute de réveil (page de chargement affichée), et la limite est de 750h d'instance gratuite par mois pour tout le compte. Contrairement au point précédent, ceci ne détruit aucune donnée — juste un temps de chargement au premier accès de la journée. Passer sur une offre payante supprime la veille et le plafond d'heures.

### 🔴 Obligatoire — connexion internet fiable

**Vérifié dans le code** : aucun service worker, aucune librairie offline (`workbox` ou équivalent) n'est présente dans `apps/web`. L'application n'a aucun mode hors-ligne — une coupure réseau bloque toute action pour l'utilisateur concerné.

### Variables d'environnement — état réel constaté

| Variable | Rôle | Statut constaté |
|---|---|---|
| `DATABASE_URL` | Connexion PostgreSQL | 🔴 Obligatoire — injectée automatiquement par Render (`fromDatabase`), **vérifié en direct** : latence 2 ms, connexion active |
| `JWT_SECRET` | Signature des sessions | 🔴 Obligatoire — `generateValue: true` dans `render.yaml` : Render la génère et la garde secrète lui-même, aucune action requise. *(Le code a un repli `"dev-secret-lomoto-change-me-in-production"` si absente — sans impact ici puisque Render la fournit toujours, mais à ne **jamais** laisser vide sur un déploiement hors de ce blueprint.)* |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Envoi de rapports par email (3.13) | 🟡 Recommandé — **vérifié en direct** (`GET /api/export/capacites` → `{"email":true}`) : **configurée et fonctionnelle en production**. Sans elle, seuls l'impression et le PDF restent disponibles (pas bloquant). |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_ACCOUNT_ID` | Email pro des Travailleurs (3.18) | 🔴 Obligatoire pour créer de nouveaux comptes Équipe (le compte se crée désormais uniquement depuis une fiche Travailleur avec email pro actif). Pas de diagnostic direct exposé par l'API, mais **déduit d'un fait vérifié** : un email pro réel a déjà été créé et activé en production (`kayembe.augustin@boulangerie-lomoto.com`), ce qui n'est possible que si les trois variables sont correctement renseignées. À considérer comme configurée. |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Assistant IA (3.19) | ⚪ Optionnel — non vérifiable directement (aucun diagnostic exposé), mais **sans impact actuel** : `ASSISTANT_IA_ACTIF` est à `false` en production (vérifié en direct via `/api/etat-systeme`), donc la clé n'est de toute façon pas sollicitée. Le code est écrit et prêt ; à activer seulement quand la facturation Google Cloud sera réglée. |
| `ASSISTANT_IA_ACTIF` | Bascule de l'Assistant IA | ⚪ Optionnel — **vérifié en direct : `false`**. Tant que c'est le cas, l'Assistant fonctionne en mode humain seul (escalade directe vers un Admin), aucun appel Gemini n'est déclenché. |
| `BACKUP_CRON`, `BACKUP_TIMEZONE`, `BACKUP_LOCAL_DIR`, `BACKUP_LOCAL_RETENTION`, `PG_DUMP_PATH` | Réglages sauvegarde | ⚪ Optionnel — surcharges facultatives, non définies en production ; les valeurs par défaut s'appliquent et **sont vérifiées en direct fonctionnelles** : cron quotidien `30 2 * * *` (02h30 Kinshasa), rétention 14 sauvegardes, `pg_dump` présent (version 18.4), historique des 7 derniers jours 100 % en succès. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | Surcharge SMTP (test / autre fournisseur) | ⚪ Optionnel — non définies, Gmail par défaut utilisé (cohérent avec `GMAIL_USER` fonctionnel). |
| `PGSSLMODE`, `WEB_DIST`, `PORT`, `NODE_VERSION` | Réglages internes | ⚪ Optionnel — gérées automatiquement par Render (`NODE_VERSION="22"` fixé dans `render.yaml`, `PORT` fourni par la plateforme). Aucune action requise. |

**Point d'attention découvert en vérifiant** : la sauvegarde automatique quotidienne fonctionne parfaitement (dernier succès aujourd'hui, 117 Ko), mais elle écrit sur `/opt/render/project/src/apps/api/sauvegardes-locales` — un disque qui **ne survit pas à un redéploiement** sur l'offre gratuite. Tant que le service web reste gratuit, le téléchargement manuel régulier (section 3 ci-dessous) reste la seule copie vraiment durable.

---

## 2. Contenu & langues

### 🔴 Obligatoire avant usage par du personnel non francophone

**Vérifié dans le code** : les fichiers `apps/web/src/i18n/ln.json` et `sw.json` portent chacun une clé `_note` explicite, non retirée :
- Lingala : *« PREMIER JET — NON DÉFINITIF (...) doit être relue par un locuteur natif avant toute mise en production pour le personnel. »*
- Kiswahili : *« RASIMU YA KWANZA — SIYO YA MWISHO (...) unahitaji kusomwa na msemaji asilia kabla ya matumizi rasmi. »*

Ces deux langues ne doivent pas être proposées à du personnel qui en dépendrait réellement pour comprendre l'interface tant qu'une relecture native n'a pas eu lieu, en particulier le vocabulaire métier (dette/nyongo, avance/avanse, bac, commission, clôture, seuil…).

### 🟡 Recommandé

- Vérifier le catalogue de produits (page **Produits**) et les types de clients (Dépositaire / Vente cash / Maman, avec leurs prix et commissions) — ce sont des données de démonstration au départ, à confirmer ou ajuster avant le premier vrai cycle de vente.
- Vérifier les informations **À propos** (nom, adresse, contact, présentation, horaires, réseaux sociaux) — éditables directement par l'Admin depuis l'écran À propos. **Vérifié en direct** : le nom, l'adresse et le contact (`+243 810 000 000 · contact@boulangerie-lomoto.com`) sont déjà à jour au nouveau domaine ; en revanche « Présentation » et « Réseaux sociaux » sont vides — à compléter si souhaité.

---

## 3. Comptes & organisation

La base a été réinitialisée à zéro ; **vérifié dans le code** (`apps/api/src/routes/premierLancement.ts` et `packages/shared/src/index.ts`), l'ordre ci-dessous est imposé par l'application elle-même, pas seulement recommandé :

1. 🔴 **Premier lancement** — tant qu'aucun compte n'existe, l'écran de connexion est remplacé par un assistant guidé qui crée, dans l'ordre : la fiche Travailleur du futur Admin Principal (nom/téléphone/poste/date d'embauche seulement — pas encore de département ni de salaire à ce stade, ces notions n'existent pas encore) → son email pro (déclenchement + vérification Cloudflare) → son compte Admin Principal. **Aucun accès à l'application n'est possible avant que ce parcours soit complété.** *(Déjà fait en production — vérifié en direct : la connexion réussit avec un compte réel migré.)*
2. 🔴 **Pour chaque membre de l'équipe** — créer sa fiche Travailleur, générer et vérifier son email pro, PUIS créer son compte Équipe à partir de cette fiche (impossible autrement : la création de compte exige `emailProStatut = ACTIF`, plus de saisie libre d'email — **vérifié dans le code**, `apps/api/src/routes/equipe.ts`).
   **Précision importante, vérifiée dans le schéma partagé (`travailleurCreateSchema`)** : contrairement à une simple recommandation, le **département** (`departementId`) et le **salaire** (`salaireMensuel` + `joursTravaillesParMois`) sont tous les trois des champs **obligatoires dès la création de toute nouvelle fiche** (hors la toute première, à l'étape 1) — le formulaire ne laisse pas les créer sans. Seul le **Groupe** est réellement facultatif à tout moment.
3. 🔴 **Département obligatoire, Groupe optionnel** — chaque nouvelle fiche doit être rattachée à un Département (créés/gérés depuis l'écran Travailleurs) ; le Groupe reste purement organisationnel et sans impact sur les permissions (**vérifié dans le code**, aucune vérification de permission ne s'appuie sur lui).
4. 🔴 **Salaire et jours travaillés** — `salaireMensuel` et `joursTravaillesParMois` (26, 13, ou toute autre valeur propre à l'agent) sont requis à la création de toute nouvelle fiche, indépendamment de l'intention d'utiliser la paie tout de suite. Pour les fiches **déjà existantes avant cette fonctionnalité**, ces deux champs peuvent rester vides — dans ce cas précis, le calcul de paie reste bloqué (409) pour cet agent jusqu'à ce qu'ils soient renseignés.

### 🟡 Recommandé

Télécharger une sauvegarde manuelle (écran État système → Admin Principal uniquement) une fois les vrais comptes créés et les comptes de démo nettoyés/désactivés — avant de commencer l'exploitation réelle.

**Point vérifié en direct, à connaître** : les 9 comptes de démonstration historiques (`admin@…`, `caisse@…`, etc.) ont déjà été migrés du domaine `@lomoto.cd` vers `@boulangerie-lomoto.com` (déploiement du jour). Ils restent néanmoins des comptes génériques sans personne réelle derrière — à désactiver (écran Équipe → Activation, qui préserve leur historique) une fois les vrais comptes de l'équipe créés selon le parcours ci-dessus.

---

## 4. Matériel

- 🔴 Un smartphone, une tablette ou un PC par utilisateur quotidien, avec connexion internet sur place (voir section 1 — aucun mode hors-ligne).
- 🟡 Une tablette ou un PC dédié à la Caisse, pour éviter les interruptions liées au partage d'un même appareil.
- 🟡 Une imprimante si des tickets papier sont nécessaires ; sinon l'export PDF (déjà fonctionnel, avec ou sans envoi par email) suffit.

---

## 5. Ce qui n'est PAS nécessaire

**Vérifié dans le dépôt** : aucun `Dockerfile`, `docker-compose.yml` ou équivalent n'est présent. Docker et une instance PostgreSQL locale ne servent qu'au développement de l'application elle-même (comme dans cette session) — ils n'ont aucune place dans le déploiement de production, qui repose entièrement sur le blueprint `render.yaml` (build + démarrage automatiques, base managée par Render). Aucune installation locale n'est requise pour utiliser l'application en production : navigateur web suffit.

---

## Résumé express (les deux urgences)

1. 🔴 **Vérifier dans le tableau de bord Render la date d'expiration réelle de la base PostgreSQL gratuite** et passer sur une offre payante avant cette échéance — sans quoi les données de l'entreprise seront supprimées, pas seulement mises en veille.
2. 🔴 **Créer les vraies fiches Travailleur + emails pro + comptes Équipe** pour chaque membre réel de l'équipe (département, salaire et jours travaillés inclus dès la création), puis désactiver les comptes de démo restants.
