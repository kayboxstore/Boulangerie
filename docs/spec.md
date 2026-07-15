# Spécification — Application de gestion commerciale (Boulangerie)

## 1. Vision

Une application web (responsive mobile) qui centralise toute la gestion quotidienne d'une boulangerie : vente en caisse, stocks de matières premières, production/recettes, commandes clients spéciales, fournisseurs et pilotage de l'activité. Utilisée par une petite équipe de 2 à 5 personnes organisée selon une hiérarchie de rôles, avec remontée d'information **en temps réel** vers les supérieurs hiérarchiques.

## 2. Rôles, hiérarchie & permissions

**Organigramme :**
```
Directeur Général (DG) — lecture seule sur TOUT, aucune modification
├── Caissier(ère)
│    └── Chargé des commandes
├── Responsable de production
└── Responsable Fournisseurs/achats
     └── Chargé du stock

Administrateur — rôle technique séparé de la chaîne opérationnelle
```

**Règle par défaut** : un supérieur a un accès en lecture seule sur le périmètre de son subordonné direct, en plus de l'écriture sur son propre périmètre. Exceptions explicites à cette règle :
- Le **DG** déroge à la règle générale : lecture seule partout, y compris sur son propre périmètre — il ne modifie jamais rien directement dans l'application. C'est lui qui décide, mais c'est l'**Administrateur** qui exécute techniquement les changements de paramètres.
- Le **Caissier(ère)** bénéficie d'un accès en lecture seule supplémentaire sur la **Production**, bien que ce module ne soit pas dans sa chaîne hiérarchique directe.
- L'**Administrateur** est hors de la hiérarchie opérationnelle : il ne supervise personne et ne reçoit pas les notifications métier, mais dispose des droits d'écriture sur les Paramètres et la gestion des comptes/rôles.

**Matrice des permissions :**

| Rôle | Rapporte à | Écriture (son périmètre) | Lecture seule (supplémentaire) |
|---|---|---|---|
| Directeur Général | — | *(aucune)* | Tous les modules |
| Administrateur | DG *(organisationnellement)* | Paramètres, Équipe & droits d'accès | — |
| Caissier(ère) | DG | Caisse / Ventes | Commandes clients, Commissions, Production |
| Chargé des commandes | Caissier(ère) | Commandes clients | — |
| Responsable de production | DG | Production & recettes | — |
| Responsable Fournisseurs/achats | DG | Fournisseurs & achats | Stocks *(son subordonné)* |
| Chargé du stock | Responsable Fournisseurs/achats | Stocks (matières premières) | — |

La liste des rôles est conçue pour être extensible (ajout d'un rôle et de ses permissions sans changement de code).

## 3. Périmètre fonctionnel (v1 — scope complet)

### 3.1 Point de vente (Caisse)
Vente au comptoir, panier, **pas de TVA sur le pain** (produit exonéré). Un taux de taxe reste configurable par l'Administrateur au niveau du produit, pour couvrir d'éventuels articles hors pain non exonérés (*voir Questions ouvertes*). Moyens de paiement (espèces, mobile money, CB), impression/génération de ticket, clôture de caisse journalière. Devise : Franc Congolais (Fc).

### 3.2 Stocks & matières premières
Suivi des quantités (farine, beurre, sucre, etc.), mouvements de stock (entrée/sortie), seuils d'alerte, historique.

### 3.3 Production & recettes
Fiches recettes (ingrédients + quantités), planning de production journalier, décrémentation automatique du stock de matières premières à la production.

### 3.4 Commandes clients
Trois catégories de clients avec tarification et commission propres, configurées dans les Paramètres :
- **Dépositaires** : prix par bac 4.100 Fc, pas de commission
- **Vente cash (VC)** : prix par bac 4.350 Fc, pas de commission *(à confirmer — voir Questions ouvertes)*
- **Mamans** : prix par bac 6.000 Fc, commission de 1.650 Fc/bac (27,5 %)

À l'enregistrement d'une commande, le prix total et la commission éventuelle sont **calculés automatiquement** selon le type du client et le nombre de bacs — aucune saisie manuelle. La liste des types de clients (prix/commission) est extensible pour ajouter d'autres catégories plus tard.

Couvre aussi les commandes spéciales (gâteaux personnalisés, événements) avec acompte, date de retrait/livraison, statut (en attente/en préparation/prête/livrée).

### 3.5 Clients & fidélité
Fiche client, historique d'achats, programme de fidélité (points ou carte tampon numérique).

### 3.6 Fournisseurs & achats
Fiches fournisseurs, bons de commande, réception de marchandises (met à jour le stock).

### 3.7 Équipe & droits d'accès
Comptes utilisateurs rattachés à un rôle, hiérarchie et matrice de permissions lecture/écriture par module (voir section 2).

### 3.8 Tableau de bord & rapports — ultra moderne & sophistiqué
CA du jour/semaine/mois, meilleures ventes, marge par produit, export comptable (CSV). Contenu strictement filtré selon le rôle connecté et sa matrice de permissions (section 2) — aucune action de modification visible pour le DG.

**Identité visuelle** (extraite du logo Boulangerie Lomoto) :
- Bleu marine `#0F1923` — texte, éléments structurants, mode sombre
- Or/moutarde `#DA9F4E` — accents, liserés, indicateurs positifs
- Crème `#FAF8F3` — fond clair
- Terracotta `#AD5416` — CTA, alertes/indicateurs chauds
- Beige chaud `#CBAF91` — surfaces secondaires, cartes

**Direction design :**
- Cartes KPI avec micro-animations (compteurs animés, indicateurs de tendance colorés)
- Graphiques interactifs (courbes de CA, répartition des ventes, comparaisons de périodes)
- Feed d'activité temps réel avec animation d'apparition à chaque nouvel événement
- Mode clair / sombre basé sur la palette ci-dessus
- Logo Boulangerie Lomoto en en-tête (sidebar/topbar) et favicon ; tagline "Pain Lia o Tonda" utilisable en pied de page ou écran de connexion
- Composants sur-mesure, pas de template admin générique

### 3.9 Paramètres
Catalogue produits, prix, taxes, informations boutique, gestion des rôles/hiérarchie, gestion des types de clients (prix et commission par bac). Écriture réservée à l'**Administrateur**.

### 3.10 Notifications temps réel
Quand un événement clé est enregistré (nouvelle commande client, alerte stock bas, nouvelle vente/clôture de caisse, réception fournisseur), une notification s'affiche **instantanément** chez le(s) supérieur(s) hiérarchique(s) concerné(s), sans rechargement de page. Portée : commandes, stock et ventes.

### 3.11 Commissions
Calcul **automatique** à l'enregistrement de chaque commande, selon le type de client (section 3.4) — aucune saisie manuelle. Exemple (Boulangerie Lomoto) : commande d'une Maman → commission de 1.650 Fc/bac générée automatiquement ; commande d'un Dépositaire → 0 Fc. Visible en lecture seule par le Caissier(ère) et le DG.

## 4. Hors périmètre (v1)

- Gestion multi-boutiques (plusieurs points de vente) — à revoir en v2
- Application mobile native (le web responsive couvre le besoin)
- Paiement en ligne / e-commerce
- Gestion de la paie des employés (RH complète)
- Mode hors-ligne complet de la caisse (à évaluer séparément — voir questions ouvertes)

## 5. User stories principales

**Caisse**
- En tant que Caissier(ère), je veux encaisser une vente en moins de 30 secondes pour ne pas faire attendre le client.
- En tant que Caissier(ère), je veux que la TVA soit calculée automatiquement selon le type de vente (sur place/à emporter).

**Stocks**
- En tant que Chargé du stock, je veux être alerté quand une matière première passe sous le seuil critique pour anticiper la commande fournisseur.

**Production**
- En tant que Responsable de production, je veux voir le planning de production du jour basé sur les commandes et l'historique de vente.

**Commandes clients**
- En tant que Chargé des commandes, je veux que le prix et la commission se calculent automatiquement selon le type de client (Dépositaire/Maman) pour ne jamais avoir à les saisir à la main.

**Paramètres**
- En tant qu'Administrateur, je veux configurer le prix et la commission par bac pour chaque type de client afin que le calcul automatique reste toujours à jour.

**Rapports**
- En tant que Directeur Général, je veux voir le chiffre d'affaires et les produits les plus vendus pour piloter l'activité, sans avoir à intervenir directement dans les modules.

**Hiérarchie & temps réel**
- En tant que Chargé des commandes, je veux voir apparaître instantanément une commande enregistrée par un Caissier(ère) pour la valider sans délai.
- En tant que Directeur Général, je veux voir en temps réel tous les événements clés (commandes, stock, ventes) sans avoir à rafraîchir la page.
- En tant que Chargé du stock, je veux que mon supérieur soit notifié immédiatement quand je signale une rupture pour qu'il puisse arbitrer rapidement.

## 6. Modèle de données (entités principales)

```
Role (id, nom, roleParentId)                              # hiérarchie portée par le rôle
RolePermission (id, roleId, module, niveauAcces)          # niveauAcces: aucun | lecture | ecriture
Utilisateur (id, nom, email, roleId, motDePasseHash)
Notification (id, destinataireId, type, événementRef, message, lu, dateCréation)
TypeClient (id, nom, prixParBac, commissionParBac)        # Dépositaire (4100, 0), Vente cash (4350, 0), Maman (6000, 1650)
Commission (id, commandeClientId, utilisateurId, montant, dateCalcul)  # généré automatiquement
Produit (id, nom, prixVente, tauxTaxe, catégorie)
Recette (id, produitId, instructions)
IngredientRecette (recetteId, matierePremiereId, quantité)
MatierePremiere (id, nom, unité, quantitéStock, seuilAlerte)
MouvementStock (id, matierePremiereId, type, quantité, date, référence)
Fournisseur (id, nom, contact)
CommandeFournisseur (id, fournisseurId, statut, date)
LigneCommandeFournisseur (commandeId, matierePremiereId, quantité, prixUnitaire)
Client (id, nom, téléphone, typeClientId, pointsFidélité)
CommandeClient (id, clientId, quantitéBacs, montantTotal, statut, dateRetrait, acompte, créePar)
Vente (id, date, vendeurId, total, moyenPaiement)
LigneVente (venteId, produitId, quantité, prixUnitaire, tauxTaxe)
```

## 7. Stack technique recommandée

| Couche | Choix | Pourquoi |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Rapide à développer, écosystème mature |
| UI | Tailwind CSS + shadcn/ui | Responsive natif, composants accessibles |
| Données serveur | React Query | Cache, synchronisation, gestion des états de chargement |
| Backend | Node.js + TypeScript + Express (ou Fastify) | Cohérence du langage front/back |
| Base de données | PostgreSQL + Prisma (ORM) | Données relationnelles (stocks, ventes, commandes) |
| Authentification | JWT + rôles hiérarchiques | Simple à mettre en place pour une petite équipe |
| Temps réel | Socket.io (WebSocket) | Notifications instantanées, s'intègre nativement à Express, gère la reconnexion automatique |
| Visualisation de données | Recharts | Graphiques interactifs pour un dashboard riche |
| Animations | Framer Motion | Micro-interactions, feed d'activité animé — look sophistiqué demandé |
| Tests | Vitest (unitaires) + Playwright (E2E) | Standard, bien supporté par Claude Code |

**Note technique** : côté serveur, un émetteur d'événements interne (EventEmitter Node) déclenche l'envoi Socket.io vers la ou les "room" correspondant au(x) supérieur(s) hiérarchique(s) concerné(s) à chaque création d'un événement clé (commande, mouvement de stock, vente).

## 8. Organisation du repo (monorepo suggéré)

```
bakery-app/
├── apps/
│   ├── web/          # Frontend React
│   │   └── public/
│   │       └── logo-lomoto.png   # Logo (favicon + en-tête)
│   └── api/           # Backend Node/Express
├── packages/
│   └── shared/         # Types & validation Zod partagés front/back
├── prisma/
│   └── schema.prisma
└── docs/
    └── spec.md          # Ce document
```

## 9. Ordre de construction technique suggéré

Le périmètre v1 est complet, mais Claude Code construira plus efficacement dans cet ordre logique (dépendances techniques, pas de coupe fonctionnelle) :

1. **Fondations** — auth, rôles hiérarchiques, catalogue produits, structure du projet
2. **Couche temps réel** — WebSocket + système de notifications (socle réutilisé par tous les modules suivants)
3. **Caisse** — vente, calcul TVA, clôture journalière, notification au supérieur
4. **Stocks & production** — matières premières, recettes, alertes temps réel
5. **Clients & commandes spéciales** — notification instantanée au Chargé des commandes
6. **Fournisseurs & achats** — notification de réception
7. **Tableau de bord & rapports** — vue globale (DG) et vue filtrée (autres rôles)

## 10. Exemples de critères d'acceptation

**Vente en caisse**
- Étant donné un panier de pain
- Quand le Caissier(ère) valide la vente
- Alors le ticket affiche le total sans TVA (produit exonéré)

**Commission — client Maman**
- Étant donné une commande de 10 bacs pour un client de type Maman (6.000 Fc/bac)
- Quand la commande est enregistrée
- Alors le système calcule automatiquement une commission de 16.500 Fc (1.650 Fc × 10), sans saisie manuelle

**Commission — client Dépositaire**
- Étant donné une commande pour un client de type Dépositaire (4.100 Fc/bac)
- Quand la commande est enregistrée
- Alors la commission générée est de 0 Fc

**Commission — Vente cash**
- Étant donné une commande pour un client de type Vente cash (4.350 Fc/bac)
- Quand la commande est enregistrée
- Alors la commission générée est de 0 Fc *(hypothèse à confirmer)*

**Alerte stock**
- Étant donné une matière première dont le stock passe sous le seuil défini
- Quand le stock est mis à jour
- Alors une alerte apparaît en temps réel chez le Chargé du stock et le Responsable Fournisseurs/achats

**Notification temps réel — nouvelle commande**
- Étant donné qu'un Caissier(ère) enregistre une nouvelle commande client
- Quand la commande est validée
- Alors le Chargé des commandes voit apparaître une notification instantanée, sans rechargement de page

**DG — lecture seule**
- Étant donné que le DG est connecté, sur n'importe quel module
- Quand il consulte l'interface
- Alors aucune action de création/modification/suppression n'est disponible

**Visibilité croisée — Caissier**
- Étant donné qu'un rapport de production est publié par le Responsable de production
- Quand le Caissier(ère) consulte son dashboard
- Alors il voit ce rapport en lecture seule, bien que la production ne soit pas dans sa chaîne hiérarchique directe

## 11. Questions ouvertes

- Faut-il un mode dégradé/hors-ligne pour la caisse en cas de coupure internet ? *(technique — à trancher avant la phase 2)*
- Quel prestataire pour l'encaissement (mobile money local, carte) ? *(métier)*
- Le programme de fidélité : points cumulés ou carte tampon simple ? *(métier)*
- Le pain est exonéré de TVA (confirmé). Les autres produits éventuels (pâtisseries, gâteaux sur commande) sont-ils eux aussi exonérés, ou un taux s'applique-t-il ? *(métier)*
- Si un rôle a plusieurs titulaires (ex. deux caissiers), la notification doit-elle aller à tous les titulaires du rôle supérieur, ou à une seule personne assignée ? *(métier)*
- Le DG doit-il disposer d'une action exceptionnelle malgré l'accès lecture seule (ex. annuler une vente frauduleuse), ou cela doit-il toujours passer par l'Administrateur ? *(métier)*
- La catégorie **Vente cash (VC)** génère-t-elle bien 0 Fc de commission, comme les Dépositaires ? *(métier — hypothèse actuelle, à confirmer)*
- Au-delà de ces 3 types (Dépositaires, Vente cash, Mamans), d'autres catégories sont-elles prévues à terme ? *(métier — n'affecte pas l'architecture, juste la configuration)*

## 12. Prochaines étapes

1. Valider ou ajuster ce document avec le gérant/l'équipe
2. Ouvrir Claude Code dans un dossier de projet et lui fournir ce fichier comme référence
3. Démarrer par la Phase 1 (fondations + catalogue produits)
