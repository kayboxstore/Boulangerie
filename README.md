# Boulangerie Lomoto — Gestion commerciale

Application web de gestion pour la Boulangerie Lomoto : caisse, stocks, production, commandes clients, fournisseurs et pilotage en temps réel. Spécification complète : [docs/spec.md](docs/spec.md).

**Phase actuelle : 2 — Couche temps réel** (Socket.io authentifié par JWT, NotificationService routé par la matrice de permissions + hiérarchie, feed d'activité animé, historique + non-lues).

> Route temporaire de test : `POST /api/test/trigger-event` (`{ module, type?, message? }`) simule un événement métier pour valider le routage — **à retirer avant la Phase 3**.

## Structure du monorepo

```
apps/
  web/       # Frontend React + TypeScript + Vite + Tailwind + shadcn/ui
  api/       # Backend Node.js + TypeScript + Express
packages/
  shared/    # Types & schémas Zod partagés front/back
prisma/      # Schéma de base de données + seed
docs/        # Spécification
```

## Prérequis

- Node.js ≥ 20 et npm
- PostgreSQL (le plus simple : Docker)

## Démarrage

```bash
# 1. Dépendances
npm install

# 2. Base de données PostgreSQL (Docker)
docker run -d --name lomoto-postgres \
  -e POSTGRES_PASSWORD=lomoto_dev \
  -e POSTGRES_DB=boulangerie_lomoto \
  -p 5434:5432 postgres:16-alpine

# 3. Variables d'environnement
cp .env.example .env

# 4. Migration + données initiales (rôles, permissions, comptes de démo, produits)
npx prisma migrate dev
npx prisma db seed

# 5. Lancer API (http://localhost:3001) + Web (http://localhost:5173)
npm run dev
```

## Comptes de démonstration

Mot de passe commun : `Lomoto2026!`

| Rôle | E-mail | Écriture | Lecture seule supplémentaire |
|---|---|---|---|
| Directeur Général | dg@lomoto.cd | *(aucune — lecture seule partout)* | Tous les modules |
| Administrateur | admin@lomoto.cd | Paramètres, Équipe | — |
| Caissier(ère) | caisse@lomoto.cd | Caisse | Commandes, Commissions, Production |
| Chargé des commandes | commandes@lomoto.cd | Commandes | — |
| Responsable de production | production@lomoto.cd | Production | — |
| Responsable Fournisseurs/achats | achats@lomoto.cd | Fournisseurs | Stocks |
| Chargé du stock | stock@lomoto.cd | Stocks | — |

## Conventions

- **Devise** : Franc Congolais (Fc), montants entiers — helper `formatFc()` dans `@lomoto/shared`.
- **TVA** : le pain est exonéré (`tauxTaxe = 0`) ; le taux reste configurable par produit.
- **Permissions** : matrice rôle × module (`RolePermission`), niveaux `AUCUN | LECTURE | ECRITURE` ; `ECRITURE` implique `LECTURE`. La hiérarchie est portée par `Role.roleParentId` — extensible sans changement de code.
- **Notifications temps réel** : Socket.io authentifié par JWT (rooms `user:{id}` et `role:{id}`). Destinataires d'un événement = tous les rôles ayant ≥ `LECTURE` sur le module (la matrice encode déjà « le supérieur lit le périmètre de son subordonné », les exceptions du Caissier et le DG) ∪ supérieur direct de l'émetteur — émetteur exclu, Administrateur exclu (aucune permission métier). Chaque notification est persistée (`Notification`) puis poussée ; l'historique (`GET /api/notifications`) permet le rattrapage après déconnexion.
