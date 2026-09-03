# Boulangerie Lomoto — Gestion commerciale

Application web de gestion pour la Boulangerie Lomoto : caisse, stocks, production, commandes clients, fournisseurs et pilotage en temps réel. Spécification complète : [docs/spec-boulangerie.md](docs/spec-boulangerie.md).

**Phase actuelle : Lots 0 à 7 intégrés**, plus deux corrections de bugs
terrain (lien matière première ↔ ingrédient de production, discipline de
clôture de caisse) et le plan d'action issu de l'audit complet du
19/08/2026 — couvre désormais l'ensemble des modules de la spécification :
Caisse, Stocks, Production (dont le cycle de livraison C4), Commandes,
Clients, Fournisseurs, Équipe/Travailleurs, Commissions, Rapports,
Paramètres, Notifications temps réel, Journal d'audit et Assistant.

La branche d'intégration à jour est `main-a7fm5x`.

## Structure du monorepo

```
apps/
  web/       # Frontend React + TypeScript + Vite + Tailwind + shadcn/ui
  api/       # Backend Node.js + TypeScript + Express
packages/
  shared/    # Types & schémas Zod partagés front/back
prisma/      # Schéma de base de données + bootstrap de production + seed de démonstration
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

# 4. Migration + données de démonstration LOCALES UNIQUEMENT (rôles, permissions,
#    comptes de démo à mot de passe connu, produits) — refuse de s'exécuter hors
#    d'un environnement de développement/test avec une base locale (voir
#    « Comptes de démonstration » ci-dessous et DEPLOIEMENT.md § Correctif P0-01)
npx prisma migrate dev
npm run db:seed:demo

# 5. Lancer API (http://localhost:3001) + Web (http://localhost:5173)
npm run dev
```

## Tests

```bash
npm ci
npm audit
npm test
npm run build
```

La suite automatisée couvre les règles partagées, les routes API critiques, l’authentification, les permissions, l’idempotence, les frontières de journée Kinshasa, les composants React/DOM, ainsi que le bootstrap de production (non-destructif et atomique) et la garde du seed de démonstration (correctif P0-01). Dernière validation : **896 tests sur 896** (90 fichiers), plus une vérification d'intégration dédiée contre une vraie base PostgreSQL en CI, audit sans vulnérabilité, migrations PostgreSQL, génération Prisma et compilation API/web réussis.

## Comptes de démonstration

> ⚠️ **Destinés au développement local.** Ces comptes sont créés par
> `npm run db:seed:demo`, qui refuse de s'exécuter sauf si `NODE_ENV` vaut
> exactement `development`/`test` **et** que `DATABASE_URL` pointe vers un
> hôte local (liste blanche, sans contournement silencieux) — et n'est jamais
> invoqué par le déploiement (`render.yaml`), voir DEPLOIEMENT.md § « Correctif
> P0-01 ». Sur une base neuve, le premier compte de production (Administrateur
> Principal) est créé uniquement via l'Assistant de premier lancement, avec un
> mot de passe choisi par le véritable responsable. **Ceci décrit le nouveau
> chemin de déploiement** : un déploiement de production antérieur à ce
> correctif a pu exécuter l'ancien seed et créer réellement ces comptes —
> voir DEPLOIEMENT.md § « Se connecter » pour l'assainissement manuel dans ce
> cas.

Mot de passe commun (dev uniquement) : `Lomoto2026!` — figé volontairement pour la
commodité de l'équipe en local ; il n'a jamais aucun effet en production (garde
ci-dessus) et figure déjà en clair dans `prisma/seed-demo.ts`, sur ce même dépôt
**privé** : sa présence ici n'ouvre donc aucune exposition supplémentaire.

| Rôle | E-mail | Écriture | Lecture seule supplémentaire |
|---|---|---|---|
| Directeur Général | dg@boulangerie-lomoto.com | *(aucune)* | Tous les modules **sauf Paramètres** (aucun accès) |
| Administrateur (principal) | admin@boulangerie-lomoto.com | Paramètres, Équipe, Travailleurs | — |
| Administrateur (secondaire) | admin2@boulangerie-lomoto.com | Paramètres, Équipe, Travailleurs | — |
| Caissier(ère) | caisse@boulangerie-lomoto.com | Caisse | Commandes, Commissions, Production |
| Chargé des commandes | commandes@boulangerie-lomoto.com | Commandes | Commissions |
| Responsable de production | production@boulangerie-lomoto.com | Production | — |
| Responsable Stock/Achats et Fournisseurs | achats@boulangerie-lomoto.com, stock@boulangerie-lomoto.com | Stocks, Fournisseurs | — |

Le rôle Administrateur peut avoir jusqu'à 3 comptes (1 principal + 2 secondaires) — champ `Utilisateur.estAdminPrincipal`, unicité du principal garantie par index partiel ; le workflow d'approbation des 5 tâches critiques d'un Admin secondaire (section 2) est en place (`/api/approbations`, écran Approbations).

## Conventions

- **Devise** : Franc Congolais (Fc), montants entiers — helper `formatFc()` dans `@lomoto/shared`.
- **TVA** : le pain est exonéré (`tauxTaxe = 0`) ; le taux reste configurable par produit.
- **Permissions** : matrice rôle × module (`RolePermission`), niveaux `AUCUN | LECTURE | ECRITURE` ; `ECRITURE` implique `LECTURE`. La hiérarchie est portée par `Role.roleParentId` — extensible sans changement de code.
- **Notifications temps réel** : Socket.io authentifié par JWT (rooms `user:{id}` et `role:{id}`). Destinataires d'un événement = tous les rôles ayant ≥ `LECTURE` sur le module (la matrice encode déjà « le supérieur lit le périmètre de son subordonné », les exceptions du Caissier et le DG) ∪ supérieur direct de l'émetteur — émetteur exclu, Administrateur exclu (aucune permission métier). Chaque notification est persistée (`Notification`) puis poussée ; l'historique (`GET /api/notifications`) permet le rattrapage après déconnexion.
- **Commandes & avances** (section 3.4 de la spec) : à l'enregistrement, `brut = bacs × prix de la Qualité`, l'avance du client est déduite en premier (`montantAPercevoir = brut − avanceUtilisee`), puis `dette = max(0, àPercevoir − reçu)` et `avanceGeneree = max(0, reçu − àPercevoir)` ; le solde d'avance est porté par le **client** et se reporte d'une commande à l'autre. Calcul dans `calculerCommande()` (`@lomoto/shared`), partagé entre l'API (transaction Serializable) et l'aperçu du formulaire. Seul le Chargé des commandes enregistre (matrice stricte) ; Caissière et DG consultent.
- **Commissions** (section 3.11) : vue dérivée des commandes dont la Qualité a `commissionParBac > 0` (les « Mamans »). `Montant total payé = brut si dette = 0, sinon montant reçu` ; `commission = bacs × 1 650 Fc`. Lecture seule Caissière + DG + Chargé des commandes.
- **Règlement de dette** : `POST /api/commandes/:id/reglements` (écriture Commandes) — le montant s'ajoute au montant reçu, dette/avance recalculées via `calculerCommande()`, journal dans `PaiementCommande`, notification temps réel `REGLEMENT_COMMANDE`. Un trop-versé devient une avance du client.
- **Caisse** (section 3.1) : `POST /api/caisse/ventes` (écriture Caisse) — prix et taux de taxe lus en base, jamais depuis le client ; pain exonéré (`tauxTaxe = 0`). `POST /api/caisse/cloture` fige les ventes ouvertes avec totaux par moyen de paiement.
- **Alerte transaction inhabituelle** (section 3.10) : toute vente ou tout règlement dépassant le seuil (`ParametreBoutique.seuil_alerte_transaction`, 100 000 Fc par défaut, modifiable en base) déclenche une notification `TRANSACTION_INHABITUELLE` **priorité HAUTE**, dédiée au DG, visuellement distincte dans le feed.
- **Menu** : tous les modules sont listés pour tous les rôles ; ceux hors permission ou pas encore construits apparaissent grisés/non cliquables (règle d'interface, spec section 2).
