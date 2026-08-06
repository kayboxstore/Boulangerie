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

## Se connecter

Comptes de démonstration (mot de passe commun **`Lomoto2026!`**) :

| Rôle | E-mail |
|------|--------|
| Administrateur principal | `admin@boulangerie-lomoto.com` |
| Administrateur secondaire | `admin2@boulangerie-lomoto.com` |
| Directeur Général | `dg@boulangerie-lomoto.com` |
| Caissière | `caisse@boulangerie-lomoto.com` |
| Chargé des commandes | `commandes@boulangerie-lomoto.com` |

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
