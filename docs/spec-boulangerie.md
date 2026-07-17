# Spécification — Application de gestion commerciale (Boulangerie)

## 1. Vision

Une application web (responsive mobile) qui centralise toute la gestion quotidienne d'une boulangerie : vente en caisse, stocks de matières premières, production/recettes, commandes clients spéciales, fournisseurs et pilotage de l'activité. Utilisée par une petite équipe de 2 à 5 personnes organisée selon une hiérarchie de rôles, avec remontée d'information **en temps réel** vers les supérieurs hiérarchiques.

## 2. Rôles, hiérarchie & permissions

**Organigramme :**
```
Directeur Général (DG) — lecture seule sur tous les modules MÉTIER
                           aucun accès aux Réglages/Paramètres (même en lecture)
├── Caissier(ère) — écriture Caisse ; lecture Commandes, Commissions, Production
│    └── Chargé des commandes — écriture Commandes ; lecture Commissions
├── Responsable de production — écriture Production
├── Responsable Stock/Achats et Fournisseurs — écriture Stocks + Fournisseurs/Achats
└── Chargé du personnel — écriture Travailleurs

Administrateur — rôle technique séparé de la hiérarchie métier, jusqu'à 3 comptes
├── Admin Principal — écriture Paramètres, Équipe, Activation, État système ; approuve les tâches critiques
└── Admin secondaire (0 à 2) — mêmes droits, mais tâches critiques soumises à l'approbation de l'Admin Principal
```

**Règle par défaut** : un supérieur a un accès en lecture seule sur le périmètre de son subordonné direct, en plus de l'écriture sur son propre périmètre. Exceptions explicites :
- Le **DG** voit tout en lecture seule, SAUF **l'édition** des Réglages/Paramètres (taxes, seuils, types de clients, infos boutique, langue par défaut), strictement réservée aux Admins. Il ne modifie jamais rien lui-même dans l'application. *Précision (suite audit Claude Code)* : la **consultation** du catalogue produits (prix) et de l'Équipe (qui, quel rôle, actif/inactif) reste accessible au DG en lecture seule — seule l'**édition** de ces données (créer/modifier un produit, un compte, une permission) est bloquée, via Paramètres.
- Le **Caissier(ère)** a un accès en lecture seule supplémentaire sur la **Production**, bien que hors de sa chaîne hiérarchique directe.
- Le **Chargé des commandes** a un accès en lecture seule sur **Commissions**, en plus de l'écriture sur Commandes.
- Les **Admins** sont hors hiérarchie métier : aucune permission sur les modules métier, uniquement l'édition de Paramètres/Équipe/Activation/État système.

**Workflow d'approbation (Admin Principal)** : certaines actions d'un Admin secondaire ne s'exécutent qu'après validation de l'Admin Principal. Liste proposée des tâches critiques *(à confirmer/compléter)* :
- Supprimer un utilisateur
- Réinitialiser la base de données
- Créer ou supprimer un compte Admin
- Modifier les prix ou commissions par Qualité de client
- Modifier le taux de taxe
- Modifier les permissions d'un rôle

Quand un Admin secondaire déclenche une de ces actions, une demande est créée (statut "en attente") et l'Admin Principal reçoit une **notification temps réel instantanée** (réutilise le socle de la section 3.10). Il approuve ou rejette depuis le module Approbations (3.16) ; l'action ne s'exécute qu'après validation.

**Matrice des permissions :**

| Rôle | Écriture | Lecture seule (supplémentaire) |
|---|---|---|
| Directeur Général | *(aucune)* | Tous les modules métier — PAS Paramètres |
| Admin Principal | Paramètres, Équipe, Activation, État système | — |
| Admin secondaire | *(idem, tâches critiques soumises à approbation)* | — |
| Caissier(ère) | Caisse | Commandes, Commissions, Production |
| Chargé des commandes | Commandes | Commissions |
| Responsable de production | Production | — |
| Responsable Stock/Achats et Fournisseurs | Stocks, Fournisseurs & achats | — |
| Chargé du personnel | Travailleurs | — |

**À propos et Rapports** (3.12, 3.13) : accessibles à tous, portée par personne (voir 3.13).

**Règle d'interface** : tous les modules apparaissent dans le menu pour tout le monde ; ceux hors du périmètre du rôle connecté restent visibles mais **grisés/non cliquables**, pour que chacun ait une vue d'ensemble du système sans y accéder.

La liste des rôles est conçue pour être extensible (ajout d'un rôle et de ses permissions sans changement de code).

⚠️ **Impact sur l'existant** : les Phases 1 et 2 ont déjà été codées avec l'ancienne liste de rôles (Administrateur unique, Chargé du stock séparé du Responsable Fournisseurs, pas de Chargé du personnel, DG en lecture sur Paramètres). Une session de retrofit sera nécessaire pour aligner le seed de rôles/permissions déjà en base sur cette nouvelle version avant de continuer.

## 3. Périmètre fonctionnel (v1 — scope complet)

### 3.1 Point de vente (Caisse)
Vente au comptoir, panier, **pas de TVA sur le pain** (produit exonéré). Un taux de taxe reste configurable par l'Administrateur au niveau du produit, pour couvrir d'éventuels articles hors pain non exonérés (*voir Questions ouvertes*). Moyens de paiement (espèces, mobile money, CB), impression/génération de ticket, clôture de caisse journalière. Devise : Franc Congolais (Fc).

### 3.2 Stocks & matières premières
Suivi des quantités (farine, beurre, sucre, etc.), mouvements de stock (entrée/sortie), seuils d'alerte, historique.

### 3.3 Production & recettes
Fiches recettes (ingrédients + quantités), planning de production journalier, décrémentation automatique du stock de matières premières à la production.

### 3.4 Commandes clients

**Types de clients** ("Qualité" dans l'app), configurés dans les Paramètres :
- **Dépositaires** : prix par bac 4.100 Fc, pas de commission
- **Vente cash (VC)** : prix par bac 4.350 Fc, pas de commission *(hypothèse — voir Questions ouvertes)*
- **Mamans** : prix par bac 6.000 Fc, commission de 1.650 Fc/bac (27,5 %)

**Champs d'une commande** (numérotation automatique, date) :

| # | Champ | Calcul |
|---|---|---|
| 1 | N° commande | Auto-incrémenté |
| 2 | Date | — |
| 3 | Nom du client | — |
| 4 | Qualité | Dépositaire / Maman / VC |
| 5 | Nombre de bacs reçus | Saisi |
| 6 | **Montant à percevoir** | `(bacs × prix unitaire) − Avance utilisée` *(l'avance du client est déduite automatiquement AVANT affichage — voir exemple)* |
| 7 | Montant reçu | Saisi |
| 8 | **Dette** | `max(0, Montant à percevoir − Montant reçu)` |
| 9 | **Avance disponible** (générée par cette commande) | `max(0, Montant reçu − Montant à percevoir)` |
| 10 | **Avance utilisée** | `min(avance existante du client, bacs × prix unitaire)` — déduite en premier, avant le champ 6 |
| 11 | **Nouvelle avance** (balance client) | `(avance existante − Avance utilisée) + Avance disponible` |

**Exemple confirmé (client Maman, 6.000 Fc/bac) :**

| | Bacs | Brut (bacs×prix) | Avance utilisée | Montant à percevoir | Reçu | Dette | Avance générée | Nouvelle avance |
|---|---|---|---|---|---|---|---|---|
| Commande #1 | 3 | 18.000 | 0 | 18.000 | 20.000 | 0 | 2.000 | **2.000** |
| Commande #2 (lendemain) | 5 | 30.000 | 2.000 | **28.000** | 28.000 | 0 | 0 | **0** |

Le solde d'avance est porté par le **client** (pas par la commande) et se reporte automatiquement d'une commande à l'autre.

**Filtres & affichage :**
- Filtre par Qualité (Dépositaire / Maman / VC)
- Filtre/tri par date
- Bouton "Tout afficher"

**Règlement d'une dette (ajout suite retour d'expérience Phase 3)** : une commande avec Dette > 0 peut recevoir un ou plusieurs paiements ultérieurs. Chaque règlement :
- Écriture réservée au **Chargé des commandes** (seul rôle en écriture sur Commandes)
- S'ajoute au Montant reçu de la commande visée ; Dette, Avance disponible et Nouvelle avance sont recalculés avec la même formule qu'à la création (un trop-perçu lors du règlement génère de l'avance, comme pour une commande normale)
- Chaque règlement est journalisé (montant, date, auteur) pour la traçabilité
- Déclenche une notification temps réel (même circuit que `NOUVELLE_COMMANDE`)

Couvre aussi les commandes spéciales (gâteaux personnalisés, événements) avec acompte, date de retrait/livraison, statut (en attente/en préparation/prête/livrée).

### 3.5 Clients & fidélité
Fiche client, historique d'achats, programme de fidélité (points ou carte tampon numérique).

### 3.6 Fournisseurs & achats
Fiches fournisseurs, bons de commande, réception de marchandises (met à jour le stock).

### 3.7 Équipe & droits d'accès
Comptes utilisateurs rattachés à un rôle, hiérarchie et matrice de permissions lecture/écriture par module (voir section 2). Le rôle Administrateur supporte jusqu'à 3 comptes (1 Principal + 2 secondaires) ; un seul compte est marqué "Principal" à la fois.

**Délégation temporaire de rôle** *(nouveau)* : un Admin peut accorder à un utilisateur les droits d'écriture d'un module précis pour une période donnée (ex. remplacement du Chargé des commandes absent 3 jours), sans changer son rôle permanent. À l'expiration, les droits reviennent automatiquement à la normale. La vérification de permission devient : *droits du rôle de base* **OU** *délégation active couvrant ce module à la date du jour*.

### 3.8 Tableau de bord & rapports — ultra moderne & sophistiqué
CA du jour/semaine/mois, meilleures ventes, marge par produit, export comptable (CSV). Contenu strictement filtré selon le rôle connecté et sa matrice de permissions (section 2) — aucune action de modification visible pour le DG.

**Résumé de clôture quotidien** *(nouveau)* : en fin de journée, un digest auto-généré est disponible pour le DG (et les Admins) — CA du jour, nombre de commandes, dettes en cours, alertes stock actives. Objectif : réduire la dépendance au fil temps réel pour une vue d'ensemble, sans avoir à rejouer toute la journée de notifications.

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
- **Bilingue** *(nouveau)* : bascule Français/Lingala pour l'interface (labels uniquement — les données saisies, ex. noms de clients, restent telles quelles)

### 3.9 Paramètres
Catalogue produits, prix, taxes, informations boutique, gestion des rôles/hiérarchie, gestion des types de clients (prix et commission par bac). Écriture réservée à l'**Administrateur**.

**Ajouts** *(nouveau)* :
- Seuil d'alerte transaction élevée (Fc) — déclenche une notification spéciale au DG (voir 3.10)
- Langue par défaut de l'application (Français / Lingala), modifiable aussi par chaque utilisateur individuellement

### 3.10 Notifications temps réel
Quand un événement clé est enregistré (nouvelle commande client, alerte stock bas, nouvelle vente/clôture de caisse, réception fournisseur), une notification s'affiche **instantanément** chez le(s) supérieur(s) hiérarchique(s) concerné(s), sans rechargement de page. Portée : commandes, stock et ventes.

**Alerte transaction inhabituelle** *(nouveau)* : toute vente (Caisse) ou tout règlement (Commandes) dépassant le seuil configuré en Paramètres déclenche une notification dédiée au DG, visuellement distincte (priorité haute) du flux normal.

### 3.11 Commissions
Vue dédiée aux commandes de type **Maman** (les seules à générer une commission). Calcul **automatique** — aucune saisie manuelle. Visible en lecture seule par le Caissier(ère), le Chargé des commandes et le DG.

**Champs :**
| # | Champ | Calcul |
|---|---|---|
| 1 | N° | Auto-incrémenté |
| 2 | Date | — |
| 3 | Nom du client | — |
| 4 | Nombre de bacs reçus | — |
| 5 | Montant total payé | Si Dette de la commande = 0 → `bacs × prix unitaire` (brut, considéré payé à 100% même si une partie vient de l'avance) ; sinon → `Montant reçu` (le montant partiel effectivement remis) |
| 6 | Commission disponible | `bacs × 1.650 Fc` |

**Filtres & affichage :** tri/filtre par date, bouton "Tout afficher".

### 3.12 À propos
Page accessible à **tous** les rôles : informations sur Boulangerie Lomoto, logo, tagline "Pain Lia o Tonda", version de l'application, contact.

### 3.13 Rapports
Journal d'activité **personnel**, distinct du Tableau de bord/KPI (3.8) : chaque utilisateur y voit ses propres enregistrements (ce qu'il a créé/modifié dans les modules auxquels il a accès), par ordre chronologique. Portée élargie pour certains rôles :
- **DG et Admins** : voient les rapports de tout le monde
- **Caissier(ère)** : voit ses propres rapports + ceux du Chargé des commandes
- Les autres rôles ne voient que leurs propres rapports

Le DG peut ainsi suivre l'activité de chacun de deux façons : directement dans chaque module (lecture seule), ou de façon consolidée ici.

*Note d'implémentation* : la portée de ce module (par personne + exceptions nommées) ne se réduit pas à une entrée standard dans `RolePermission` — prévoir un mécanisme dédié (filtre par `créePar`/`enregistrePar` + liste d'exceptions), distinct de la matrice de permissions habituelle. Module technique séparé de 3.8 (Tableau de bord), qui lui reste piloté par la matrice standard.

### 3.14 Activation *(Admin uniquement)*
Active/désactive un compte utilisateur sans le supprimer (ex. employé en congé ou départ temporaire) — l'utilisateur désactivé ne peut plus se connecter, mais son historique reste intact.

### 3.15 État système *(Admin uniquement)*
Statut de la base de données (connectée/déconnectée), version de l'application, nombre d'utilisateurs actifs, dernière sauvegarde *(contenu exact à affiner)*.

### 3.16 Approbations *(Admin Principal uniquement)*
File d'attente des demandes soumises par les Admins secondaires pour les tâches critiques (voir section 2). Chaque demande : type d'action, demandeur, données de l'action, date, statut. Notification temps réel instantanée à l'Admin Principal dès qu'une demande arrive ; approbation ou rejet en un clic, avec effet immédiat sur l'action en attente.

### 3.17 Journal d'audit *(nouveau — DG et Admins uniquement, lecture seule)*
Historique **immuable** de toute modification ou suppression (pas seulement les créations, déjà tracées via créePar/enregistrePar) : qui, quoi, quand, valeur avant/après. Protège l'ensemble de l'équipe — y compris les Admins, dont les actions y sont également journalisées. Filtrable par utilisateur, module, période.

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
- En tant que Responsable Stock/Achats et Fournisseurs, je veux être alerté quand une matière première passe sous le seuil critique pour anticiper la commande fournisseur.

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
- En tant que Responsable Stock/Achats et Fournisseurs, je veux que le DG soit notifié immédiatement quand je signale une rupture pour qu'il puisse arbitrer rapidement.

## 6. Modèle de données (entités principales)

```
Role (id, nom, roleParentId)                              # hiérarchie portée par le rôle
RolePermission (id, roleId, module, niveauAcces)          # niveauAcces: aucun | lecture | ecriture
Utilisateur (id, nom, email, roleId, motDePasseHash, actif, estAdminPrincipal, languePreferee)
DemandeApprobation (id, type, demandeParId, donnees, statut, approuveParId, dateDemande, dateDecision)  # statut: en_attente | approuvee | rejetee
JournalAudit (id, utilisateurId, action, module, entiteType, entiteId, donneesAvant, donneesApres, dateAction)  # action: modification | suppression
DelegationRole (id, utilisateurDelegantId, utilisateurDelegataireId, module, dateDebut, dateFin, creePar)
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
Client (id, nom, téléphone, typeClientId, avanceDisponible, pointsFidélité)   # avanceDisponible = solde reporté d'une commande à l'autre
CommandeClient (id, numero, clientId, quantitéBacs, montantBrut, avanceUtilisee, montantAPercevoir, montantRecu, dette, avanceGeneree, statut, dateRetrait, créePar)
PaiementCommande (id, commandeClientId, montant, date, enregistrePar)   # règlements successifs d'une dette
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
| Internationalisation | react-i18next | Bascule Français/Lingala sur les labels d'interface |
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

1. **Fondations** — auth, rôles hiérarchiques, catalogue produits, structure du projet ✅ *(terminé)*
2. **Couche temps réel** — WebSocket + système de notifications (socle réutilisé par tous les modules suivants) ✅ *(terminé)*
2bis. **Retrofit rôles + règlement de dette** — fusion Stock/Fournisseurs, Chargé du personnel, multi-admin, DG sans édition Paramètres, PaiementCommande ✅ *(terminé)*
2ter. **Retrofit UI "modules grisés"** — le menu doit afficher tous les modules pour tout le monde, grisés/non cliquables hors permission (actuellement les entrées non accessibles sont cachées, pas grisées) — *à faire avant la Phase 4*
3. **Commandes clients & Commissions** — système d'avance/dette porté par le client ✅ *(terminé)*
4. **Caisse** — vente, clôture journalière, notification au supérieur, alerte transaction inhabituelle (seuil : **100.000 Fc**, configurable ensuite dans Paramètres)
5. **Stocks & production** — matières premières, recettes, alertes temps réel
6. **Fournisseurs & achats** — notification de réception
7. **Tableau de bord & rapports** — vue KPI globale (DG), vue filtrée (autres rôles), résumé de clôture quotidien
8. **Rapports personnels, À propos** — journal d'activité par utilisateur (3.13), page statique (3.12)
9. **Travailleurs & Utilisateurs** — module du Chargé du personnel *(scope détaillé à définir — voir Questions ouvertes)*
10. **Admin : Activation, État système, Approbations, Délégation temporaire** — gestion des comptes, statut système, workflow d'approbation multi-admin, délégation de droits
11. **Journal d'audit** — traçabilité modifications/suppressions, en continu à partir de cette phase ; retrofit des phases 1-3 en option, moins urgent

*Interface bilingue (Français/Lingala, section 3.8/3.9)* : concerne toutes les phases UI. Plus tôt elle est intégrée, moins coûteux sera le retrofit des écrans déjà construits (Commandes/Commissions actuellement en français uniquement) — à prioriser selon vos contraintes de temps.

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

**Avance générée — premier trop-perçu**
- Étant donné un client Maman sans avance qui commande 3 bacs (18.000 Fc) et paie 20.000 Fc
- Quand la commande est enregistrée
- Alors Dette = 0, Avance disponible générée = 2.000 Fc, Nouvelle avance du client = 2.000 Fc

**Avance utilisée — commande suivante**
- Étant donné ce même client (avance de 2.000 Fc) qui commande ensuite 5 bacs (30.000 Fc brut)
- Quand la commande est enregistrée
- Alors l'avance de 2.000 Fc est déduite automatiquement en premier, le Montant à percevoir affiché est 28.000 Fc (pas 30.000)

**Commission — Montant payé, commande soldée**
- Étant donné une commande Maman de 5 bacs (30.000 Fc brut) où le client n'a plus de dette (payée via avance + cash)
- Quand on consulte le module Commissions
- Alors "Montant total payé" affiche 30.000 Fc (le brut), pas le montant reçu lors de cette transaction

**Commission — Montant payé, commande partielle**
- Étant donné une commande Maman où le client devait 30.000 Fc et n'a payé que 25.000 Fc (dette de 5.000 Fc)
- Quand on consulte le module Commissions
- Alors "Montant total payé" affiche 25.000 Fc (le montant réellement reçu), et la dette de 5.000 Fc reste visible côté Commandes

**Alerte stock**
- Étant donné une matière première dont le stock passe sous le seuil défini
- Quand le stock est mis à jour
- Alors une alerte apparaît en temps réel chez le DG (supérieur direct du Responsable Stock/Achats et Fournisseurs, qui a émis l'événement et est donc exclu de sa propre notification)

**Notification temps réel — nouvelle commande**
- Étant donné qu'un Caissier(ère) enregistre une nouvelle commande client
- Quand la commande est validée
- Alors le Chargé des commandes voit apparaître une notification instantanée, sans rechargement de page

**DG — lecture seule**
- Étant donné que le DG est connecté, sur n'importe quel module
- Quand il consulte l'interface
- Alors aucune action de création/modification/suppression n'est disponible

**Règlement de dette**
- Étant donné une commande avec une dette de 1.000 Fc
- Quand le Chargé des commandes enregistre un règlement de 1.500 Fc
- Alors la dette repasse à 0, l'excédent de 500 Fc génère une avance de 500 Fc pour le client, et le Caissier(ère)/DG reçoivent une notification temps réel

**Alerte transaction inhabituelle**
- Étant donné un seuil configuré à 50.000 Fc et une vente de 60.000 Fc encaissée par le Caissier(ère)
- Quand la vente est validée
- Alors le DG reçoit une notification temps réel distincte, signalée comme prioritaire

**Journal d'audit**
- Étant donné un Admin qui modifie le prix par bac d'une Qualité de client
- Quand la modification est enregistrée
- Alors le Journal d'audit affiche qui, quand, l'ancienne et la nouvelle valeur — visible par le DG et les autres Admins

**DG — aucun accès aux Paramètres**
- Étant donné que le DG est connecté
- Quand il regarde le menu
- Alors le module Paramètres n'apparaît pas accessible même en lecture (grisé), contrairement aux autres modules qu'il voit en lecture seule

**Approbation — Admin secondaire**
- Étant donné un Admin secondaire qui tente de supprimer un utilisateur
- Quand il valide l'action
- Alors l'action ne s'exécute pas immédiatement ; une demande est créée et l'Admin Principal reçoit une notification temps réel

**Module grisé**
- Étant donné un Chargé du personnel connecté
- Quand il consulte le menu
- Alors il voit tous les modules listés, mais seul "Travailleurs" (et À propos/Rapports) est cliquable — les autres apparaissent grisés

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
- Le module "Travailleurs" (phase 9) : quel contenu exact (fiches employés, présence, paie) ? Le document exclut la RH complète (section 4) — à clarifier au moment de le construire.
- La liste des "tâches critiques" nécessitant l'approbation de l'Admin Principal (section 2) est une proposition — à valider/compléter.
- "État système" (3.15) : quelles informations exactes afficher, au-delà du statut base de données ?
- Un Admin secondaire peut-il lui-même approuver/rejeter une demande d'un autre Admin secondaire, ou seul l'Admin Principal le peut ?
- Quel seuil (en Fc) déclenche l'alerte transaction inhabituelle (3.10) ? **Résolu : 100.000 Fc**, valeur par défaut modifiable ensuite dans Paramètres.
- Une délégation temporaire de rôle (3.7) peut-elle chevaucher plusieurs modules à la fois, ou un seul module par délégation ?
- Le Journal d'audit (3.17) doit-il aussi inclure les tentatives d'accès refusées (403), utile pour la sécurité, ou seulement les actions réussies ?
- Les "commandes spéciales" (gâteaux personnalisés, événements — fin de la section 3.4) n'ont pas encore de statut/dateRetrait en base (omis volontairement en Phase 3, qui couvrait les commandes en bacs). À quel moment les construire ? Pas encore placé dans l'ordre des phases (section 9).

## 12. Prochaines étapes

1. Valider ou ajuster ce document avec le gérant/l'équipe
2. Ouvrir Claude Code dans un dossier de projet et lui fournir ce fichier comme référence
3. Démarrer par la Phase 1 (fondations + catalogue produits)
