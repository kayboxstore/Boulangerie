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
