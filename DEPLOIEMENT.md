# Déploiement en ligne — Boulangerie Lomoto

Objectif : rendre l'application accessible depuis un téléphone **n'importe où**,
sans PC allumé. On la déploie sur un hébergeur cloud. Tout se fait **depuis le
navigateur** (y compris depuis un téléphone) — aucun terminal nécessaire.

## Comment c'est construit

En production, il n'y a plus de serveur de dev Vite ni de proxy. L'**API Express
sert elle-même le frontend compilé** : tout est sur la même origine, donc les
appels `/api` et `/socket.io` (relatifs) fonctionnent sans CORS ni URL codée en
dur. C'est **un seul service** à déployer + une base PostgreSQL.

Le fichier `render.yaml` (à la racine) décrit tout ça pour l'hébergeur
**Render** : il crée la base, injecte automatiquement `DATABASE_URL`, génère un
`JWT_SECRET` secret, lance les migrations, prépare la configuration
structurelle minimale (rôles, permissions, motifs fixes — **aucun compte,
aucun mot de passe, aucune donnée de démonstration**, voir « Se connecter »
ci-dessous), puis démarre le service.

## Étapes (depuis le navigateur du téléphone)

1. **Pousser le code sur GitHub** — déjà fait (branche `main-a7fm5x`). Idéalement
   fusionner sur `main` pour déployer la branche par défaut, ou choisir la
   branche à l'étape 4.
2. Aller sur **https://render.com** et créer un compte (connexion avec GitHub =
   le plus simple).
3. Autoriser Render à accéder au dépôt **kayboxstore/Boulangerie**.
4. **New → Blueprint** → sélectionner le dépôt (et la branche voulue). Render lit
   `render.yaml` automatiquement et affiche les ressources qu'il va créer
   (1 service web + 1 base PostgreSQL).
5. Cliquer **Apply / Create**. Render construit puis démarre (quelques minutes).
6. Une fois « Live », l'URL publique s'affiche, du type
   `https://boulangerie-lomoto.onrender.com` — **ouvre-la sur le téléphone**.

## Activer l'envoi des rapports par email (section 3.13)

L'impression et le téléchargement PDF fonctionnent sans rien configurer. L'envoi
par email demande deux variables d'environnement — Render les réclame à l'étape 5
(`sync: false` dans `render.yaml`, donc **aucune valeur n'est stockée dans le
dépôt**) :

| Variable | Valeur |
|----------|--------|
| `GMAIL_USER` | l'adresse Gmail / Google Workspace expéditrice |
| `GMAIL_APP_PASSWORD` | le **mot de passe d'application** Google (16 caractères), pas le mot de passe du compte |

À renseigner **deux fois, séparément** : dans le `.env` local ET dans Render →
service `boulangerie-lomoto` → *Environment*. Les deux environnements sont
indépendants, rien ne se propage automatiquement.

Tant qu'elles sont vides, le bouton « Envoyer par email » ne s'affiche pas ;
« Imprimer » et « Télécharger en PDF » restent disponibles.

Variables facultatives pour un autre fournisseur SMTP : `SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`.

## Sauvegarde quotidienne de la base (section 3.15)

La sauvegarde automatique tourne chaque jour (par défaut 02h30, heure de
Kinshasa) et écrit le dump **localement sur le disque du serveur** — aucune
configuration requise pour l'activer.

> Une première version envoyait ces sauvegardes vers Google Drive via un compte
> de service Google Cloud. Abandonné : les comptes de service n'ont pas de quota
> de stockage propre sur Google Drive (seuls les Drive partagés Workspace en
> offrent un), ce qui aurait demandé de créer et maintenir un Drive partagé pour
> un gain incertain. La sauvegarde automatique écrit désormais localement.

### Le disque du serveur n'est pas garanti persistant

Sur l'offre gratuite Render, le disque du service peut être réinitialisé à
chaque redéploiement. La sauvegarde locale protège contre une erreur de
manipulation *entre* deux redéploiements ; elle ne remplace pas une copie
régulière vers un support externe. L'écran *État système* propose donc deux
téléchargements pour l'Admin Principal :

- **Télécharger la dernière sauvegarde locale** — récupère directement le
  fichier déjà produit par la sauvegarde automatique de la nuit, sans
  regénérer d'export.
- **Télécharger une sauvegarde maintenant** — génère un export frais à la
  demande.

Dans les deux cas, le fichier obtenu est à copier sur une clé USB ou un disque
externe. L'écran affiche aussi le statut de chaque tentative automatique
(succès/échec) dans son historique.

### Décision d'infrastructure restante — stockage durable externe

**Non traité par ce lot** (hors périmètre : aucun stockage externe, aucun
service Neon/Render/Cloudflare n'a été configuré ou modifié) — à trancher par
Augustin avant le pilote réel si le risque est jugé insuffisamment couvert :

- Le projet Neon réel utilisé en production est actuellement sur l'offre
  **gratuite**, dont la fenêtre d'historique (point-in-time recovery) n'est
  que de **21 600 secondes (6 heures)**. Au-delà, seule la dernière
  sauvegarde locale (disque éphémère Render) ou téléchargée à la main fait
  foi.
- Le disque local du service Render n'est **pas garanti persistant** (voir
  ci-dessus) : sans téléchargement régulier vers un support externe, une
  sauvegarde peut disparaître à un redéploiement avant d'avoir jamais quitté
  le serveur.
- Options à évaluer (coût et mise en place à décider, non engagées ici) :
  passer le projet Neon sur une offre payante avec une fenêtre de PITR plus
  longue ; ajouter un envoi automatique des sauvegardes locales vers un
  stockage objet externe (ex. Cloudflare R2, déjà utilisé pour l'email pro) ;
  ou formaliser une routine humaine de téléchargement régulier via le bouton
  déjà existant.

### Variables facultatives

| Variable | Rôle | Défaut |
|----------|------|--------|
| `BACKUP_CRON` | expression cron de l'heure de sauvegarde | `30 2 * * *` |
| `BACKUP_TIMEZONE` | fuseau appliqué à `BACKUP_CRON` | `Africa/Kinshasa` |
| `BACKUP_LOCAL_DIR` | répertoire de stockage local | dossier `sauvegardes-locales` à côté du code de l'API |
| `BACKUP_LOCAL_RETENTION` | nombre de sauvegardes locales conservées avant purge des plus anciennes | `14` |

Si l'hébergeur propose un disque persistant (ex. Render *Persistent Disk*, en
option payante), pointer `BACKUP_LOCAL_DIR` vers son point de montage rend les
sauvegardes automatiques réellement durables d'un redéploiement à l'autre.

### Un point à vérifier après le déploiement

La sauvegarde utilise l'outil **`pg_dump`**, qui doit être présent sur le serveur.
L'écran *État système* l'indique explicitement : si un bandeau signale que
`pg_dump` est absent, aucune sauvegarde n'est possible tant que le client
PostgreSQL n'est pas installé sur l'hôte (variable `PG_DUMP_PATH` si l'outil est
installé ailleurs que dans le `PATH`). Dans ce cas, s'appuyer en attendant sur les
sauvegardes de la base managée fournies par l'hébergeur.

### Intégrité et cohérence garanties (Lot P0, 30/08/2026 — durci round 2 le 30/08/2026)

Avant d'être considérée réussie, toute sauvegarde (automatique, manuelle ou de
sûreté avant réinitialisation) est **validée réellement** en DEUX passes —
`pg_dump` doit réussir, l'archive ne doit pas être vide, sa table des
matières doit être lisible par `pg_restore --list`, **et** son contenu
complet doit pouvoir être intégralement redécodé (`pg_restore` reconstruit le
flux SQL entier sans se connecter à aucune base, ce qui détecte un bloc de
DONNÉES corrompu que la seule table des matières laisserait passer) — puis
écrite sur disque de façon **atomique** (fichier temporaire puis renommage) :
aucune archive tronquée ou partielle n'est jamais annoncée comme une
sauvegarde réussie. Les deux binaires (`pg_dump`, `pg_restore`) sont soumis à
un délai maximal : un processus resté bloqué reçoit d'abord `SIGTERM`, puis
`SIGKILL` après un délai de grâce s'il refuse de s'arrêter, plutôt que de
suspendre indéfiniment l'opération. Cette borne couvre `pg_dump`, la lecture
du TOC et le parcours intégral par `pg_restore`.

**Limite assumée et documentée, jamais présentée comme plus qu'elle n'est** :
même ces deux passes ne sont PAS une preuve complète de restaurabilité —
elles éliminent les archives tronquées/corrompues détectables sans rien
écrire nulle part, mais seule une restauration réelle réussie (voir
« Restaurer une sauvegarde » ci-dessous) le prouve vraiment. `pg_restore
--list`, en particulier, ne lit que l'en-tête de l'archive et ne doit jamais
être présenté comme une preuve de restaurabilité.

La **réinitialisation de la base** (irréversible) active en outre une
**barrière d'écriture** avant de produire son dump : plus aucune écriture
(HTTP ou tâche de fond) ne peut commencer, et celles déjà engagées sont
laissées se terminer avant que le dump ne démarre — le dump et l'état effacé
juste après représentent ainsi strictement la même frontière logique, sans
risque qu'une écriture arrivée entre les deux soit perdue. Le décompte d'une
écriture suivie ne se fait que sur la fin RÉELLEMENT prouvée de sa réponse
(`finish`), jamais sur une simple déconnexion réseau du client (`close`), qui
peut survenir alors qu'un handler continue réellement d'écrire en base —
règle conservatrice assumée : en cas de doute, la barrière échoue par
timeout plutôt que de risquer un drainage prématuré. Cette barrière est un
mécanisme **en mémoire du process**, valable pour la configuration Render
actuelle à **une seule instance** ; un passage futur à plusieurs instances
exigerait de la remplacer par une coordination distribuée réelle (verrou
consultatif PostgreSQL `pg_advisory_lock`) — voir le commentaire de tête de
`apps/api/src/lib/barriereEcriture.ts`.

**Réinitialisation désactivée par défaut en production** : si `NODE_ENV=production`,
la route `POST /api/etat-systeme/reinitialiser` (et le service sous-jacent)
refusent systématiquement avec un `403` explicite, sauf si la variable
d'environnement `REINITIALISATION_PRODUCTION_AUTORISEE` vaut **exactement**
`true` — jamais activée via `render.yaml` ni aucun script npm, à définir
uniquement à la main, temporairement, pour l'opération elle-même. L'écran
*État système* reflète cet état honnêtement (bouton désactivé avec le motif
exact renvoyé par le serveur), mais la garde qui compte est côté serveur.

Toutes ces garanties (validation d'archive en deux passes, écriture atomique,
barrière, désactivation en production, écriture concurrente jamais perdue,
notifications asynchrones suivies par la même barrière, réinitialisation
réelle avec conservation du référentiel/mise à zéro du stock, restauration
atomique via le vrai script `restaurer-sauvegarde.ts`) sont prouvées contre
une **vraie base PostgreSQL** par `scripts/verifier-sauvegarde-reinitialisation-ci.ts`,
exécuté à chaque CI — 15 scénarios numérotés, complétés par des preuves OS/PG
réelles : `pg_dump` ignorant `SIGTERM` puis tué par `SIGKILL`, archive au
TOC lisible mais au bloc de données tronqué, et réinitialisation traversant la
vraie route HTTP `createApp()` avec auth et PostgreSQL réels.

### Restaurer une sauvegarde

Une sauvegarde ne sert à rien si elle n'a jamais été restaurée avec succès —
la procédure ci-dessous est **prouvée automatiquement à chaque CI**, en
appelant le VRAI `scripts/restaurer-sauvegarde.ts` (jamais une
réimplémentation de l'appel `pg_restore`) contre une vraie base PostgreSQL :
sans confirmation (zéro modification), avec une confirmation fausse (refusé,
zéro modification), avec un nom de base identique mais un hôte différent
(refusé, zéro modification), avec la confirmation exacte (restauration
réelle réussie, données relues indépendamment), avec un échec injecté APRÈS
le début réel de la restauration sur une cible **préremplie et volontairement
différente du dump** (le vrai `pg_restore --clean` est observé bloqué sur un
verrou destructif via `pg_blocking_pids`, puis sa connexion est coupée —
`--single-transaction` restaure exactement les tables et données préalables),
et un nettoyage
systématique des bases temporaires même en cas d'échec — voir
`scripts/verifier-sauvegarde-reinitialisation-ci.ts`.

**Obligatoire avant toute restauration en production** : répéter d'abord
cette même procédure avec succès contre une base ou branche **isolée** (une
base Neon de développement/staging distincte, ou une instance PostgreSQL
locale jetable) — jamais la toute première exécution d'une restauration
directement sur les données réelles de l'entreprise.

Volontairement **un script à lancer à la main, jamais un bouton dans
l'application** : une restauration remplace le contenu de la base cible, un
clic malheureux sur une page web serait bien trop facile sur les données
réelles de l'entreprise. Nécessite un accès à l'environnement où tourne
l'API (mêmes prérequis que `npx prisma migrate deploy`).

**Durci round 2 (correctif Codex, 30/08/2026)** : la confirmation n'est plus
liée au seul **nom** de la base — plusieurs environnements Neon distincts
portent couramment le même nom par défaut (`neondb`), ce qui ne protégeait en
rien contre une confirmation valide mais pointant vers le **mauvais
serveur**. Elle exige désormais un identifiant complet **hôte + port + base**
(`--confirmer=<hote>:<port>/<base>`, affiché par le script, à recopier
exactement — jamais l'utilisateur ni le mot de passe). La restauration
elle-même est en outre réellement **atomique** : `--single-transaction`
(complété par `--exit-on-error`) enveloppe tout le flux dans une seule
transaction — toute erreur en cours de route annule tout au `COMMIT` final,
la cible reste alors strictement inchangée, jamais à moitié effacée. L'archive
est validée en deux passes **avant** tout appel à `--clean` — voir la limite
assumée ci-dessus (une validation lisible n'est pas une preuve complète de
restaurabilité).

```bash
# 1. Récupérer un fichier .dump (bouton "Télécharger..." de l'écran État
#    système, ou un fichier déjà copié sur un support externe)

# 2. Se placer à la racine du dépôt, avec DATABASE_URL pointant vers la base
#    À RESTAURER (une base ISOLÉE d'abord — jamais la production directement) :
export DATABASE_URL="postgresql://utilisateur:motdepasse@hote:5432/base"

# 3. Vérification à blanc — valide l'archive et affiche l'identifiant complet
#    de la cible SANS toucher à rien (ne restaure jamais sans --confirmer) :
npm run restore:backup -- chemin/vers/fichier.dump

# 4. Restauration réelle — <hote>:<port>/<base> DOIT être exactement
#    l'identifiant affiché à l'étape 3 (ATTENTION : --clean --if-exists
#    supprime les tables existantes de la base ciblée avant d'y recharger
#    le dump ; en cas d'erreur en cours de route, tout est annulé) :
npm run restore:backup -- chemin/vers/fichier.dump --confirmer=<hote>:<port>/<base>

# 5. Vérifier après coup (obligatoire) : se connecter à l'application ou
#    interroger la base pour confirmer que les données attendues sont bien
#    là (ex. compter les lignes de quelques tables clés).
```

**Piège rencontré en testant** : sur un hôte où plusieurs versions du client
PostgreSQL sont installées (ex. 16 et 18 en parallèle), l'outil peut résoudre
vers une version différente de celle utilisée pour la sauvegarde ou du
serveur cible, et `pg_restore` affiche alors une erreur du type
`unrecognized configuration parameter "transaction_timeout"` ou
`unsupported version (x.xx) in file header`. Dans le premier cas (paramètre
de session inconnu), la restauration réussit quand même en pratique — c'est
justement pourquoi l'étape 5 (vérification après coup) n'est pas optionnelle.
Dans le second cas (format de fichier), utiliser `PG_RESTORE_PATH` pour
pointer explicitement vers le binaire de la bonne version (ex.
`PG_RESTORE_PATH=/usr/lib/postgresql/16/bin/pg_restore`). Sur Render, une
seule version du client est installée : ce piège ne s'y pose pas.

## Se connecter

**Depuis ce correctif (P0-01, 19-20/08/2026 — voir plus bas), le chemin de
déploiement ne crée plus jamais de compte de démonstration ni de mot de passe
connu.** Sur une base neuve, la base est vide au premier démarrage : l'écran
de connexion est automatiquement remplacé par l'**Assistant de premier
lancement**, qui guide la création du tout premier compte — l'Administrateur
Principal — avec un mot de passe choisi par le véritable responsable, jamais
présumé par le code. Une fois ce compte créé, l'assistant se referme de
lui-même (la base n'est plus vide) et l'écran de connexion normal reprend sa
place, pour toujours.

> ⚠️ **Ceci décrit le comportement du NOUVEAU chemin de déploiement, pas
> nécessairement l'état d'une base déjà en production avant ce correctif.**
> Si ce déploiement existait avant le 19-20/08/2026, il a pu exécuter l'ancien
> `npm run db:seed` à un déploiement antérieur — dans ce cas, des comptes de
> démonstration à mot de passe connu (`Lomoto2026!`) peuvent encore exister
> réellement dans cette base tant qu'un assainissement manuel n'a pas été
> effectué. Ce correctif empêche un futur redéploiement d'en recréer ou d'en
> réattribuer le statut principal ; il ne supprime et ne modifie **aucune**
> donnée déjà présente. Voir la procédure manuelle post-incident (documentée
> séparément, jamais automatisée) pour l'inventaire et l'assainissement
> contrôlé des comptes existants.

> Les identifiants `admin@boulangerie-lomoto.com` / `Lomoto2026!` mentionnés
> ailleurs dans ce dépôt (`README.md`, `prisma/seed-demo.ts`) sont **destinés
> au développement local** — `npm run db:seed:demo` refuse explicitement de
> s'exécuter hors d'un environnement de développement/test reconnu (voir
> « Correctif P0-01 » ci-dessous) et n'est jamais invoqué par `render.yaml` ni
> par aucun chemin de déploiement.

## Bon à savoir (offre gratuite Render)

- Le service **s'endort** après ~15 min d'inactivité : la 1ʳᵉ ouverture après une
  pause prend ~30 s à se réveiller, puis c'est fluide.
- La base PostgreSQL gratuite a une **durée de vie limitée** (Render l'indique à
  la création) — parfait pour tester, à repasser en offre payante pour un usage
  durable.
- Un redéploiement rejoue les migrations et le bootstrap de production
  (rôles/permissions/motifs fixes). Sur une base déjà initialisée, ce
  bootstrap **ne modifie et ne supprime plus jamais** une permission, un
  niveau d'accès ou une hiérarchie de rôle existants — même si un
  Administrateur les a modifiés entre-temps — et ne touche jamais aux comptes
  existants ni à l'Administrateur Principal déjà en place. Voir « Correctif
  P0-01 » ci-dessous.

## Correctif P0-01 — séparation bootstrap de production / seed de démonstration (19-20/08/2026)

Avant ce correctif, `render.yaml` exécutait `npm run db:seed` à **chaque**
déploiement — un script qui crée des comptes à mot de passe connu et publié
dans ce dépôt, et qui **réattribuait de force** le statut d'Administrateur
Principal au compte générique `admin@boulangerie-lomoto.com`, même si le
véritable responsable en avait délégué la propriété entre-temps. Un simple
redéploiement pouvait donc rouvrir un accès connu et retirer le statut
principal au vrai responsable.

Le chemin de production et le chemin de développement sont maintenant
complètement séparés :

| | Production (`render.yaml`) | Développement local |
|---|---|---|
| Commande | `npm run db:bootstrap:production` | `npm run db:seed:demo` |
| Fichier | `prisma/bootstrap-production.ts` | `prisma/seed-demo.ts` |
| Crée | Rôles, permissions, motifs fixes (don/perte/non-conformité) — **jamais un compte** | Tout ce que fait le bootstrap, **plus** des comptes de démo à mot de passe connu, des clients/fournisseurs/stocks fictifs |
| Sur une base déjà initialisée | Ignore intégralement tout rôle déjà existant (ne touche ni ses permissions ni sa hiérarchie) — n'installe que ce qui est réellement absent | Toujours réservé au dev — jamais exécuté en production |
| `estAdminPrincipal` | Jamais touché | Réattribué de force à `admin@boulangerie-lomoto.com` (comportement historique, sans risque hors dev) |
| Garde | Sûr par construction (le type `ClientBootstrap` rend `prisma.utilisateur.*` non compilable, y compris depuis l'intérieur de sa transaction atomique) | Liste **blanche** : refuse sauf si `NODE_ENV` vaut exactement `development`/`test` **ET** `DATABASE_URL` pointe vers un hôte local — un `NODE_ENV` absent, `staging` ou `preview` est refusé, tout comme un hôte distant, **sans aucune exception ni opt-in possible** (round 3 : l'opt-in round 2 a été jugé inacceptable et entièrement retiré) |

Le premier compte de production (Administrateur Principal) est créé
**exclusivement** par l'Assistant de premier lancement (voir « Se
connecter » ci-dessus), jamais par un script de seed.

### Round 2 (revue Codex externe) : non-destructivité, atomicité, vérification en CI

Une revue externe (Codex) a identifié trois points supplémentaires, depuis
corrigés :

- **Non-destructif et atomique** — `bootstrap-production.ts` n'installe
  désormais un rôle (et ses permissions) que s'il est **totalement absent** ;
  un rôle déjà présent n'est plus jamais retouché, qu'il ait été créé par un
  bootstrap précédent ou modifié depuis par un Administrateur via
  `PUT /api/roles/:id/permissions`. Toute l'installation initiale tourne dans
  une seule transaction PostgreSQL : un échec en cours de route n'écrit rien
  (aucune initialisation partielle possible). Un futur changement de la
  matrice d'un rôle **déjà déployé** doit passer par une migration Prisma
  versionnée, plus jamais par un rejeu du bootstrap.
- **Garde en liste blanche** — voir le tableau ci-dessus ; corrige le fait
  qu'un `NODE_ENV` absent ou mal configuré laissait auparavant passer le seed
  de démonstration.
- **Vérifié en CI contre une vraie base PostgreSQL**, en plus des tests
  unitaires mockés : `.github/workflows/ci.yml` exécute
  `scripts/verifier-integration-bootstrap-ci.ts`.

### Round 3 (revue Codex externe) : suppression du contournement, robustesse multiplateforme, preuves CI complètes

Une seconde revue externe (Codex) a identifié quatre points supplémentaires,
depuis corrigés :

- **Contournement distant supprimé sans remplacement** — l'opt-in round 2
  (`SEED_DEMO_HOTE_DISTANT_AUTORISE`) a été jugé inacceptable pour un script
  qui crée des comptes à mot de passe connu : retiré entièrement (code, tests,
  documentation). Un `DATABASE_URL` distant est désormais refusé sans
  exception, quel que soit `NODE_ENV`.
- **Robustesse multiplateforme** — `prisma/bootstrap-production.ts` détectait
  son exécution directe via une comparaison manuelle `` `file://${process.argv[1]}` ``,
  qui échoue silencieusement sous Windows et pour tout chemin nécessitant un
  encodage URL (espaces...) — remplacée par `pathToFileURL` (le mécanisme
  standard recommandé par Node), vérifié par un vrai sous-processus depuis un
  chemin contenant un espace. Le script `db:seed:demo` utilisait une syntaxe
  shell POSIX (`` NODE_ENV="${NODE_ENV:-development}" ``, Unix uniquement) —
  remplacée par `scripts/lancer-seed-demo.mjs`, un lanceur Node pur,
  multiplateforme, qui préserve exactement la même règle (défaut seulement si
  `NODE_ENV` est absent, jamais un écrasement).
- **La vérification d'intégration CI se protège elle-même** — le script
  effectue de vraies écritures destructives volontaires (modification/
  suppression de permission, échec de transaction injecté) ; il exige
  désormais lui-même, avant tout accès Prisma, un hôte local, le nom de base
  exact `lomoto_ci`, et une confirmation d'environnement propre à ce script
  (voir `scripts/garde-integration-ci.ts`).
- **Preuves PostgreSQL complètes** — la CI prouve désormais aussi qu'une
  permission supprimée manuellement n'est jamais recréée, qu'une hiérarchie de
  rôle modifiée n'est jamais réécrite, qu'un échec injecté en cours
  d'installation entraîne un rollback RÉEL (zéro donnée partielle), qu'une
  exécution normale après cet échec réussit intégralement, et exerce le VRAI
  chemin `npm run db:bootstrap:production` (pas seulement la fonction
  importée directement). Le refus du seed de démonstration en production
  vérifie désormais le message précis de la garde, pas seulement un code de
  sortie non nul.

## Autres hébergeurs

L'app étant un service Node standard qui sert son propre frontend, elle tourne
aussi ailleurs (Railway, Fly.io, un VPS…). Il suffit de fournir les mêmes
variables d'environnement — `DATABASE_URL` (PostgreSQL) et `JWT_SECRET` — puis :

```
npm install --include=dev
NODE_ENV=production npx prisma generate
NODE_ENV=production npx prisma migrate deploy
NODE_ENV=production npm run db:bootstrap:production
npm run build --workspace apps/web
NODE_ENV=production npm run start --workspace apps/api   # écoute sur $PORT
```

`NODE_ENV=production` n'est pas qu'une convention ici : c'est ce qui, en
défense en profondeur, ferait échouer immédiatement toute tentative
(volontaire ou accidentelle) de lancer `npm run db:seed:demo` contre cette
base.
