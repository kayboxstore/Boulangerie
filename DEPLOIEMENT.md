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
`JWT_SECRET` secret, lance les migrations, insère les données de démonstration,
puis démarre le service.

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

## Activer la sauvegarde quotidienne vers Google Drive (section 3.15)

Le **téléchargement manuel** d'une sauvegarde (Admin Principal, écran *État
système*) fonctionne sans rien configurer. L'**envoi automatique quotidien vers
Google Drive** demande un **compte de service Google Cloud** — un mécanisme
différent du mot de passe d'application Gmail ci-dessus, avec ses propres
identifiants.

### À faire une fois dans la Google Cloud Console (console.cloud.google.com)

1. **Créer un projet** (ou réutiliser un projet existant).
2. **Activer l'API Google Drive** : *APIs & Services → Library → Google Drive
   API → Enable*.
3. **Créer un compte de service** : *IAM & Admin → Service Accounts → Create
   service account*. Un nom suffit ; aucun rôle IAM n'est nécessaire (les droits
   viennent du partage Drive, à l'étape 6).
4. **Créer une clé JSON** : sur le compte de service → *Keys → Add key → Create
   new key → JSON*. Le fichier se télécharge une seule fois — garde-le.
5. **Relever l'email du compte de service**, de la forme
   `quelque-chose@mon-projet.iam.gserviceaccount.com`.
6. **Dans Google Drive**, créer un dossier de sauvegardes et le **partager en
   Éditeur avec cet email**. Sans ce partage, l'envoi échoue en « dossier
   introuvable » même si le dossier existe.
7. **Relever l'identifiant du dossier** : c'est le suffixe de son URL,
   `https://drive.google.com/drive/folders/<IDENTIFIANT>`.

### Variables d'environnement

| Variable | Valeur |
|----------|--------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | le contenu **entier** du fichier JSON de l'étape 4, sur une seule ligne — ou encodé en base64, les deux sont acceptés |
| `GOOGLE_DRIVE_FOLDER_ID` | l'identifiant du dossier de l'étape 7 |

À renseigner **deux fois, séparément** : dans le `.env` local **et** dans Render →
service `boulangerie-lomoto` → *Environment*. Rien ne se propage automatiquement.

Facultatif : `BACKUP_CRON` (défaut `30 2 * * *`) et `BACKUP_TIMEZONE` (défaut
`Africa/Kinshasa`) pour changer l'heure de la sauvegarde.

L'écran *État système* affiche l'email du compte de service lu depuis la clé,
ainsi que le statut de chaque tentative — c'est là qu'on vérifie que tout est en
place.

### Un point à vérifier après le déploiement

La sauvegarde utilise l'outil **`pg_dump`**, qui doit être présent sur le serveur.
L'écran *État système* l'indique explicitement : si un bandeau signale que
`pg_dump` est absent, aucune sauvegarde n'est possible tant que le client
PostgreSQL n'est pas installé sur l'hôte (variable `PG_DUMP_PATH` si l'outil est
installé ailleurs que dans le `PATH`). Dans ce cas, s'appuyer en attendant sur les
sauvegardes de la base managée fournies par l'hébergeur.

## Se connecter

Comptes de démonstration (mot de passe commun **`Lomoto2026!`**) :

| Rôle | E-mail |
|------|--------|
| Administrateur principal | `admin@lomoto.cd` |
| Administrateur secondaire | `admin2@lomoto.cd` |
| Directeur Général | `dg@lomoto.cd` |
| Caissière | `caisse@lomoto.cd` |
| Chargé des commandes | `commandes@lomoto.cd` |

> ⚠️ **Change ces mots de passe** (ou supprime les comptes de démo) si le
> déploiement est exposé publiquement — l'URL est accessible à tous.

## Bon à savoir (offre gratuite Render)

- Le service **s'endort** après ~15 min d'inactivité : la 1ʳᵉ ouverture après une
  pause prend ~30 s à se réveiller, puis c'est fluide.
- La base PostgreSQL gratuite a une **durée de vie limitée** (Render l'indique à
  la création) — parfait pour tester, à repasser en offre payante pour un usage
  durable.
- Les données de démonstration sont ré-insérées à chaque redéploiement, mais de
  façon **non destructive** (les ventes/commandes que tu crées ne sont pas
  effacées ; seuls les comptes/produits de base sont garantis présents).

## Autres hébergeurs

L'app étant un service Node standard qui sert son propre frontend, elle tourne
aussi ailleurs (Railway, Fly.io, un VPS…). Il suffit de fournir les mêmes
variables d'environnement — `DATABASE_URL` (PostgreSQL) et `JWT_SECRET` — puis :

```
npm install --include=dev
npx prisma generate
npx prisma migrate deploy
npm run db:seed            # optionnel : données de démonstration
npm run build --workspace apps/web
npm run start --workspace apps/api   # écoute sur $PORT
```
