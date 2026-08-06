# Boulangerie Lomoto — Gestion commerciale

Application web de gestion pour la Boulangerie Lomoto : caisse, stocks, production, commandes clients, fournisseurs et pilotage en temps réel. Spécification complète : [docs/spec.md](docs/spec.md).

**Phase actuelle : 4 — Caisse** (vente au comptoir, pain exonéré de TVA, moyens de paiement espèces/mobile money/carte, clôture journalière, alerte transaction inhabituelle au-dessus du seuil configuré).

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
| Directeur Général | dg@boulangerie-lomoto.com | *(aucune)* | Tous les modules **sauf Paramètres** (aucun accès) |
| Administrateur (principal) | admin@boulangerie-lomoto.com | Paramètres, Équipe, Travailleurs | — |
| Administrateur (secondaire) | admin2@boulangerie-lomoto.com | Paramètres, Équipe, Travailleurs | — |
| Caissier(ère) | caisse@boulangerie-lomoto.com | Caisse | Commandes, Commissions, Production |
| Chargé des commandes | commandes@boulangerie-lomoto.com | Commandes | Commissions |
| Responsable de production | production@boulangerie-lomoto.com | Production | — |
| Responsable Stock/Achats et Fournisseurs | achats@boulangerie-lomoto.com, stock@boulangerie-lomoto.com | Stocks, Fournisseurs | — |

Le rôle Administrateur peut avoir jusqu'à 3 comptes (1 principal + 2 secondaires) — champ `Utilisateur.estAdminPrincipal`, unicité du principal garantie par index partiel ; le workflow d'approbation arrive en Phase 10.

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
