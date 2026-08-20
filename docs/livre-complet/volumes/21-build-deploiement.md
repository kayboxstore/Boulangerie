# Volume 21 — Construction et déploiement

> Dernier volume de la série 19-21 (Tests, Performances, Déploiement), avant le basculement vers le Guide complet d'utilisation (Volume 22). Ce chapitre s'appuie sur deux sources documentaires jusqu'ici seulement identifiées, jamais lues intégralement : `DEPLOIEMENT.md` (guide pratique) et `docs/MISE-EN-PRODUCTION.md` (rapport d'audit d'une mise en production réelle, daté). Contrairement à `docs/spec-boulangerie.md` (comportement voulu, intemporel), ces deux fichiers décrivent un **état constaté à une date donnée** — ce chapitre le signale explicitement partout où c'est pertinent, plutôt que de présenter des faits datés comme une vérité permanente du code.
>
> **Mise à jour (correctif P0-01, 19-20/08/2026, complété après revue externe)** : ce chapitre décrit le `buildCommand` de `render.yaml` d'AVANT ce correctif — il exécutait `npm run db:seed` (créant des comptes de démonstration à mot de passe connu) à chaque déploiement de production. Ce n'est plus le cas : le build appelle désormais `npm run typecheck --workspace apps/api` puis `npm run db:bootstrap:production` (rôles/permissions/motifs fixes uniquement, jamais un compte, jamais rejoué de façon destructive). Voir `DEPLOIEMENT.md` § « Correctif P0-01 » pour l'état actuel faisant foi ; ce chapitre reste un instantané et n'est pas réécrit au-delà de cette note.

## 1. L'architecture de déploiement : un seul service

Déjà entrevu au Volume 5 (variables d'environnement) et au Volume 8 (repli SPA dans `app.ts`) : en production, **il n'y a qu'un seul processus Node.js à déployer**, pas un frontend et un backend séparés. `DEPLOIEMENT.md` le formule ainsi : « il n'y a plus de serveur de dev Vite ni de proxy. L'API Express sert elle-même le frontend compilé ». Concrètement, cela confirme et referme un fait déjà déduit indirectement au Volume 8 (`app.ts` sert les fichiers statiques puis répond en repli SPA) et au Volume 18d (asymétrie de build : `apps/api` n'est jamais compilé, `apps/web` l'est via `vite build`) — le dossier `apps/web/dist` généré par ce `vite build` est ce que `app.ts` sert directement, sur la **même origine** que l'API. C'est ce qui permet aux appels `/api` et `/socket.io` d'être écrits en chemins relatifs partout dans le frontend (déjà observé dès le Volume 11b), sans jamais avoir besoin de CORS ni d'URL codée en dur — un seul domaine, une seule origine, cohérent avec `lib/origines.ts` (Volume 14) qui n'a jamais besoin d'autoriser qu'un seul domaine canonique en production.

`render.yaml` (déjà lu intégralement au Volume 5) est le blueprint qui décrit ce service unique + une base PostgreSQL à l'hébergeur **Render** : création de la base, injection automatique de `DATABASE_URL`, génération d'un `JWT_SECRET` secret, exécution des migrations, insertion des données de démonstration (`prisma/seed.ts`, Volume 13), puis démarrage.

## 2. La procédure de déploiement, résumée

`DEPLOIEMENT.md` décrit une procédure entièrement pilotable depuis un navigateur, y compris depuis un téléphone (cohérent avec l'exigence « accessible depuis un téléphone n'importe où » du même document) : pousser le code sur GitHub, créer un compte Render, autoriser l'accès au dépôt, choisir **New → Blueprint**, sélectionner la branche voulue — Render lit `render.yaml` automatiquement et affiche les ressources qu'il va créer (1 service web + 1 base PostgreSQL) avant de les provisionner. Ce chapitre ne détaille pas davantage cette procédure pas à pas (elle relève de l'utilisation de l'interface Render elle-même, hors du code de ce dépôt) mais retient un point structurel : **le déploiement entier repose sur un seul fichier déclaratif** (`render.yaml`), sans script de déploiement personnalisé ni pipeline CI/CD distinct — confirmé par l'absence de tout dossier `.github/workflows` dans le dépôt (vérifié par recherche exhaustive).

### 2.1 Déploiement sur un autre hébergeur

`DEPLOIEMENT.md` documente aussi la procédure manuelle pour un hébergeur autre que Render (Railway, Fly.io, un VPS...), qui ne fait que rendre explicites les étapes que `render.yaml` automatise :

```
npm install --include=dev
npx prisma generate
npx prisma migrate deploy
npm run db:seed            # optionnel
npm run build --workspace apps/web
npm run start --workspace apps/api   # écoute sur $PORT
```

Chacune de ces commandes a déjà été rencontrée séparément dans ce livre : `prisma generate`/`migrate deploy`/`db:seed` (Volume 13), `build --workspace apps/web` (le script `"build": "tsc --noEmit && vite build"`, Volume 18d), `start --workspace apps/api` (`tsx src/index.ts` sans étape de compilation, également Volume 18d). Ce passage confirme que l'application ne dépend d'aucune fonctionnalité propriétaire de Render — seules deux variables d'environnement sont réellement indispensables quel que soit l'hébergeur : `DATABASE_URL` et `JWT_SECRET`.

## 3. Sauvegarde et restauration : le complément opérationnel du Volume 18a

`DEPLOIEMENT.md` reprend en détail les services déjà expliqués au Volume 11z-4 (sauvegarde locale quotidienne, abandon documenté de Google Drive) et le script déjà expliqué au Volume 18a (`scripts/restaurer-sauvegarde.ts`), sans rien y changer sur le plan du code — mais il ajoute une information opérationnelle réelle, absente du code lui-même, qui mérite d'être consignée ici :

**Piège rencontré en testant réellement la restauration** (cité tel quel, car il documente un fait d'exploitation vérifié empiriquement, pas déductible de la seule lecture du code) : sur un hôte où plusieurs versions du client PostgreSQL sont installées côte à côte, l'outil `pg_restore` peut résoudre vers une version différente de celle utilisée pour produire la sauvegarde ou de celle du serveur cible. Deux symptômes possibles :
- Un paramètre de session inconnu (`unrecognized configuration parameter "transaction_timeout"`) — la restauration réussit malgré tout en pratique, ce qui justifie que l'étape de vérification après coup (compter les lignes de tables clés) reste **obligatoire** plutôt qu'un simple conseil.
- Une version de fichier non supportée (`unsupported version (x.xx) in file header`) — bloquant, résolu en pointant explicitement `PG_RESTORE_PATH` (déjà vu comme variable d'environnement au Volume 18a) vers le binaire de la bonne version.

Sur Render, une seule version du client PostgreSQL est installée : `DEPLOIEMENT.md` précise que ce piège spécifique ne s'y pose pas — c'est un risque propre à un hébergement manuel avec plusieurs versions coexistantes, pas à l'infrastructure Render elle-même.

## 4. Rapport d'audit de mise en production (`docs/MISE-EN-PRODUCTION.md`) — état constaté, pas comportement du code

Ce document a une nature différente de tout ce qui a été lu jusqu'ici dans ce livre : ce n'est pas une spécification ni une documentation de fonctionnement, mais un **rapport d'audit daté** (dernière vérification : 2026-08-06), qui distingue lui-même explicitement trois catégories de constats — vérifié en direct sur le déploiement réel, déduit du code, ou non vérifiable depuis la session d'audit qui l'a produit. Ce chapitre respecte la même discipline et ne présente aucun de ces constats comme une propriété permanente du code.

### 4.1 Le risque le plus sérieux documenté dans tout ce livre : expiration de la base gratuite

Le point le plus grave relevé par ce rapport, classé « le plus urgent de tout le document » par ses propres termes : `render.yaml` déclare la base PostgreSQL en `plan: free`. Sur Render, une base gratuite **expire 30 jours après sa création**, suivie de 14 jours de grâce, après quoi **l'instance et toutes ses données sont supprimées définitivement** — un phénomène distinct et bien plus grave que la simple mise en veille du service web (§4.2). Ce n'est pas quelque chose que le code de l'application peut détecter ou signaler lui-même (aucune API Render n'expose cette date au code applicatif) : c'est une caractéristique de l'infrastructure d'hébergement, à surveiller manuellement dans le tableau de bord Render, hors du périmètre de ce qui peut être vérifié en lisant le dépôt.

**Conséquence pour la sauvegarde locale** (à mettre en regard du Volume 11z-4) : l'offre gratuite Postgres n'inclut aucune sauvegarde gérée par Render, et la sauvegarde automatique quotidienne de l'application elle-même écrit sur le disque du service web — qui est **éphémère** sur l'offre gratuite (réinitialisé à chaque redéploiement). Autrement dit, sur cette offre, ni la base ni le mécanisme de sauvegarde de l'application ne garantissent une conservation durable des données sans intervention manuelle régulière (le téléchargement vers un support externe déjà documenté au Volume 11z-4 et rappelé au §3 ci-dessus).

### 4.2 Mise en veille du service web (offre gratuite) — gênant, pas destructeur

À distinguer clairement du point précédent : le service web gratuit se met en veille après 15 minutes sans trafic (~1 minute de réveil au premier accès de la journée), avec un plafond de 750 heures d'instance gratuite par mois pour l'ensemble du compte Render. Contrairement à l'expiration de la base, ceci **ne détruit aucune donnée** — c'est un temps de chargement, pas une perte.

### 4.3 Aucun mode hors-ligne

Le rapport affirme l'absence de tout mécanisme hors-ligne dans le frontend. **Vérifié indépendamment pour ce chapitre** (recherche exhaustive de `serviceWorker`/`workbox`/enregistrement de service worker dans `apps/web/src` et `apps/web/index.html`) : confirmé, aucune trace d'un tel mécanisme. Une coupure de connexion internet bloque donc toute action pour l'utilisateur concerné — cohérent avec l'absence de toute mention d'un mode hors-ligne dans `docs/spec-boulangerie.md`.

### 4.4 Variables d'environnement : statut constaté vs rôle déjà documenté

Le Volume 5 a déjà expliqué le **rôle** de chaque variable d'environnement de `.env.example`, sans jamais en révéler la valeur (conformément à la contrainte de sécurité de ce livre). Ce rapport d'audit ajoute une information complémentaire légitime — non pas la valeur des secrets, mais leur **statut constaté** (configurée et fonctionnelle / non configurée / sans impact actuel) sur un déploiement réel à une date donnée :

| Variable | Rôle (rappel, Volume 5) | Statut constaté (2026-08-06, non permanent) |
|---|---|---|
| `DATABASE_URL`, `JWT_SECRET` | Obligatoires | Injectées automatiquement par Render, aucune action requise |
| `GMAIL_USER` / `GMAIL_APP_PASSWORD` | Envoi de rapports par e-mail (3.13) | Constatées configurées et fonctionnelles à la date de l'audit (vérifié via `GET /api/export/capacites`) |
| `CLOUDFLARE_API_TOKEN`/`ZONE_ID`/`ACCOUNT_ID` | Email professionnel des Travailleurs (3.18) | Obligatoires pour créer un nouveau compte Équipe (le compte exige un email pro actif, Volume 11k-1) ; déduites configurées d'un fait vérifié (un email professionnel réel avait déjà été créé et activé) |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Assistant IA (3.19) | Sans impact à la date de l'audit : `ASSISTANT_IA_ACTIF` constaté à `false` en production, aucun appel Gemini déclenché |
| `BACKUP_*`, `PG_DUMP_PATH` | Réglages de sauvegarde (Volume 11z-4/18a) | Valeurs par défaut constatées fonctionnelles (cron quotidien, rétention, `pg_dump` présent) |

Ce tableau ne dit rien de la configuration **actuelle** du déploiement au moment où ce livre est lu — seulement de son état à la date où l'audit source a été réalisé. Conformément à la contrainte de sécurité de ce livre, aucune valeur de ces variables n'est reproduite ici, uniquement leur rôle et leur statut de configuration constaté.

### 4.5 Ordre imposé par l'application pour la mise en place initiale d'une équipe

Le rapport confirme, en le croisant avec le code (`routes/premierLancement.ts`, `routes/equipe.ts`, `travailleurCreateSchema`), un enchaînement déjà rencontré séparément aux Volumes 11d et 11z-4 : Assistant de premier lancement (fiche Travailleur → email pro → compte Admin Principal) puis, pour chaque membre suivant, fiche Travailleur → email pro vérifié → compte Équipe — jamais l'inverse, la création de compte exigeant `emailProStatut = ACTIF`. Le rapport ajoute une précision utile non isolée aussi explicitement dans les chapitres précédents : le **département** et le **salaire mensuel** (avec les jours travaillés par mois) sont des champs **obligatoires dès la création de toute nouvelle fiche** (hors la toute première créée par l'Assistant de premier lancement) — seul le Groupe reste facultatif. Pour les fiches déjà existantes avant l'ajout de la fonctionnalité de paie, ces deux champs peuvent rester vides, mais le calcul de paie reste alors bloqué (`409`, déjà rencontré au Volume 11k-3) tant qu'ils ne sont pas renseignés.

### 4.6 Langues non relues par un locuteur natif — rappel opérationnel du Volume 17

Le rapport reprend, sous un angle opérationnel de mise en production, l'observation déjà faite au Volume 17 : les dictionnaires `ln.json` (lingala) et `sw.json` (kiswahili) portent chacun une clé `_note` explicite les désignant comme un premier jet non définitif, à faire relire par un locuteur natif avant tout usage par du personnel qui en dépendrait réellement. Le rapport en tire une recommandation opérationnelle concrète que le code seul ne peut pas exprimer : ne pas proposer ces deux langues à du personnel non francophone tant que cette relecture n'a pas eu lieu, en particulier pour le vocabulaire métier (dette, avance, bac, commission, seuil...).

### 4.7 Comptes de démonstration

`DEPLOIEMENT.md` documente l'existence de comptes de démonstration créés par `prisma/seed.ts` (Volume 13, `upsertRole`/jeu de données de démonstration), un pour chaque rôle principal, partageant un mot de passe commun documenté dans ce même fichier. Conformément à la contrainte de sécurité de ce livre, ce mot de passe n'est **pas reproduit ici** — le lecteur souhaitant le consulter est renvoyé directement à `DEPLOIEMENT.md`. Les deux documents (guide et rapport d'audit) recommandent tous deux, une fois l'équipe réelle constituée selon la procédure du §4.5, de changer ce mot de passe ou de désactiver ces comptes (écran Équipe → Activation, qui préserve leur historique plutôt que de les supprimer, cohérent avec la suppression bloquée par les bulletins de paie déjà vue au Volume 11k-1) — particulièrement si le déploiement est exposé publiquement, l'URL étant alors accessible à quiconque la connaît.

> **Mise à jour (correctif P0-01)** : depuis ce correctif, le chemin de production **ne crée plus** ces comptes de démonstration — `prisma/seed.ts` (renommé `prisma/seed-demo.ts`) n'est plus jamais exécuté par `render.yaml`. Ce paragraphe reste néanmoins pertinent pour tout déploiement antérieur au correctif : des comptes créés par un ancien déploiement peuvent y subsister réellement tant qu'un assainissement manuel n'a pas été effectué — voir la procédure manuelle post-incident (document séparé, jamais automatisée) plutôt que la désactivation via l'écran Équipe décrite ci-dessus, qui suppose un accès déjà fonctionnel avec le vrai compte Administrateur Principal.

## 5. Ce qui n'est pas vérifiable dans l'environnement de rédaction de ce livre

Cohérent avec la limite déjà répétée depuis le Volume 4 : aucun accès à un tableau de bord Render réel, à une base de données déployée, ni à l'infrastructure de production n'était disponible pendant la rédaction de ce livre. Toutes les informations de ce chapitre proviennent de la lecture de `DEPLOIEMENT.md` et `docs/MISE-EN-PRODUCTION.md` (des documents déjà présents dans le dépôt, rédigés à partir d'une session d'audit antérieure ayant eu un accès réel), pas d'une vérification indépendante en direct — à l'exception du point §4.3 (absence de service worker), vérifiable par simple lecture du code source du dépôt, et donc revérifié indépendamment pour ce chapitre.

## 6. Résumé du chapitre

| Sujet | Point clé |
|---|---|
| Architecture de déploiement | Un seul service Node (API + frontend compilé servi en repli SPA) + une base PostgreSQL, décrits par `render.yaml` |
| Portabilité | Ne dépend d'aucune fonctionnalité propriétaire de Render — seules `DATABASE_URL` et `JWT_SECRET` sont strictement indispensables ailleurs |
| CI/CD | Aucun pipeline dédié — le blueprint `render.yaml` est le seul mécanisme de déploiement automatisé |
| Restauration | Piège opérationnel réel documenté (versions multiples de `pg_restore` sur un hôte non-Render) |
| Risque le plus grave | Expiration définitive (avec perte de données) d'une base PostgreSQL gratuite Render après 30+14 jours — sans lien avec le code, à surveiller manuellement |
| Risque secondaire | Mise en veille du service gratuit après 15 min — gênant, non destructeur |
| Mode hors-ligne | Absent, vérifié indépendamment pour ce chapitre |
| Langues ln/sw | Rappel opérationnel : ne pas déployer pour du personnel qui en dépendrait avant relecture native (Volume 17) |

Aucun écart spec/code identifié dans ce chapitre — la spec ne fixe aucune exigence de déploiement ou d'infrastructure, ce chapitre documente donc une réalité opérationnelle plutôt qu'une conformité à un texte de référence. **Ce chapitre clôt la série des Volumes 19-21** ; le livre bascule maintenant vers le Volume 22 (Guide complet d'utilisation).
