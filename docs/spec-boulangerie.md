# Spécification — Application de gestion commerciale (Boulangerie)

## 1. Vision

Une application web (responsive mobile) qui centralise toute la gestion quotidienne d'une boulangerie : vente en caisse, stocks de matières premières, production, commandes clients, fournisseurs et pilotage de l'activité. Utilisée par une petite équipe de 2 à 5 personnes organisée selon une hiérarchie de rôles, avec remontée d'information **en temps réel** vers les supérieurs hiérarchiques.

## 2. Rôles, hiérarchie & permissions

**Organigramme :**
```
Directeur Général (DG) — lecture seule sur tous les modules MÉTIER
                           aucun accès aux Réglages/Paramètres (même en lecture)
├── Caissier(ère) — écriture Caisse ; lecture Commandes, Commissions, Production
│    └── Chargé des commandes — écriture Commandes ; lecture Commissions
├── Responsable de production — écriture Production
└── Responsable Stock/Achats et Fournisseurs — écriture Stocks + Fournisseurs/Achats

Administrateur — rôle technique séparé de la hiérarchie métier, jusqu'à 3 comptes
├── Admin Principal — SUPER UTILISATEUR : écriture sur ABSOLUMENT TOUS les modules,
│                     métier compris ; approuve les tâches critiques
└── Admin secondaire (0 à 2) — lecture sur ABSOLUMENT TOUT (comme le DG, y compris
                      État système et Approbations) ; écriture limitée à
                      Paramètres/Équipe/Activation/État système/Travailleurs, tâches
                      critiques soumises à l'approbation de l'Admin Principal
```

**Règle par défaut** : un supérieur a un accès en lecture seule sur le périmètre de son subordonné direct, en plus de l'écriture sur son propre périmètre. Exceptions explicites :
- Le **DG** voit tout en lecture seule, SAUF **l'édition** des Réglages/Paramètres (taxes, seuils, types de clients, infos boutique, langue par défaut), strictement réservée aux Admins. Il ne modifie **jamais rien** lui-même dans l'application — **aucune exception** (l'annulation de vente, seule exception qui avait existé, disparaît avec la refonte de la Caisse en 3.1). *Précision (suite audit Claude Code)* : la **consultation** du catalogue produits (prix) et de l'Équipe (qui, quel rôle, actif/inactif) reste accessible au DG en lecture seule — seule l'**édition** de ces données (créer/modifier un produit, un compte, une permission) est bloquée, via Paramètres.
- Le **Caissier(ère)** a un accès en lecture seule supplémentaire sur la **Production**, bien que hors de sa chaîne hiérarchique directe.
- Le **Chargé des commandes** a un accès en lecture seule sur **Commissions**, en plus de l'écriture sur Commandes.
- ~~Les **Admins** sont hors hiérarchie métier : aucune permission sur les modules métier, uniquement l'édition de Paramètres/Équipe/Activation/État système.~~ **Règle entièrement abrogée** — remplacée par les deux points ci-dessous.
- L'**Admin Principal** est un **super utilisateur** : il a l'**écriture sur absolument tous les modules**, y compris les modules métier (Commandes, Caisse, Stocks, Production, Fournisseurs, Travailleurs), en plus de Paramètres/Équipe/Activation/État système/Approbations.
- L'**Admin secondaire** a la **lecture sur absolument tout**, comme le DG — y compris État système et Approbations. Son **écriture** reste cantonnée à son périmètre d'origine (Paramètres/Équipe/Activation/État système/Travailleurs), et ses tâches critiques restent soumises à l'approbation de l'Admin Principal. La lecture n'a jamais été soumise à approbation : ses nouveaux droits de consultation ne changent rien au workflow.

**Garde-fou — intervention de l'Admin Principal hors de son périmètre d'origine** : quand l'Admin Principal **écrit** dans un module métier qui n'est pas Paramètres/Équipe/Activation/État système/Approbations, le **rôle propriétaire de ce module** (celui qui y détient l'écriture — ex. Chargé des commandes pour Commandes) **et le DG** reçoivent une **notification temps réel** signalant l'intervention. Ce signal s'ajoute à la trace automatique au Journal d'audit (3.17), qui capte déjà toute modification ou suppression. Objectif : un pouvoir total reste possible, mais jamais discret.

**Workflow d'approbation (Admin Principal)** : certaines actions d'un Admin secondaire ne s'exécutent qu'après validation de l'Admin Principal. Tâches critiques (liste figée — 5 items) :
- Supprimer un utilisateur
- Créer ou supprimer un compte Admin
- Modifier les prix ou commissions par Qualité de client
- Modifier le taux de taxe
- Modifier les permissions d'un rôle

*La « réinitialisation de la base de données » ne figure PAS dans cette liste : c'est une procédure manuelle côté infrastructure, jamais un bouton dans l'application, même gardé par approbation.*

Quand un Admin secondaire déclenche une de ces actions, une demande est créée (statut "en attente") et l'Admin Principal reçoit une **notification temps réel instantanée** (réutilise le socle de la section 3.10). Il approuve ou rejette depuis le module Approbations (3.16) ; l'action ne s'exécute qu'après validation. **Seul l'Admin Principal peut approuver ou rejeter une demande** — un Admin secondaire ne peut jamais approuver, même une demande émise par un autre Admin secondaire. Quand l'Admin Principal déclenche lui-même une de ces actions, elle s'exécute directement, sans passer par une demande (il n'a pas à s'auto-approuver).

**Matrice des permissions :**

| Rôle | Écriture | Lecture seule (supplémentaire) |
|---|---|---|
| Directeur Général | *(aucune)* | Tous les modules métier — PAS Paramètres |
| Admin Principal | **TOUS les modules sans exception** (métier compris) + Paramètres, Équipe, Activation, État système, Approbations | — *(déjà tout en écriture)* |
| Admin secondaire | Paramètres, Équipe, Activation, État système, Travailleurs *(tâches critiques soumises à approbation)* | **TOUS les autres modules**, y compris État système et Approbations |
| Caissier(ère) | Caisse | Commandes, Commissions, Production |
| Chargé des commandes | Commandes | Commissions |
| Responsable de production | Production | — |
| Responsable Stock/Achats et Fournisseurs | Stocks, Fournisseurs & achats | — |

**À propos et Rapports** (3.12, 3.13) : accessibles à tous, portée par personne (voir 3.13).

**Règle d'interface** : tous les modules apparaissent dans le menu pour tout le monde ; ceux hors du périmètre du rôle connecté restent visibles mais **grisés/non cliquables**, pour que chacun ait une vue d'ensemble du système sans y accéder.

La liste des rôles est conçue pour être extensible (ajout d'un rôle et de ses permissions sans changement de code).

⚠️ **Impact sur l'existant** : les Phases 1 et 2 ont déjà été codées avec l'ancienne liste de rôles (Administrateur unique, Chargé du stock séparé du Responsable Fournisseurs, pas de Chargé du personnel, DG en lecture sur Paramètres). Une session de retrofit sera nécessaire pour aligner le seed de rôles/permissions déjà en base sur cette nouvelle version avant de continuer.

## 3. Périmètre fonctionnel (v1 — scope complet)

### 3.1 Caisse — registre journalier *(refonte : la vente au comptoir est retirée)*

La **vente au comptoir** (panier, vente par produit) est **retirée du périmètre** :
la boulangerie ne vend pas à l'unité au comptoir, tout passe par les commandes
clients (3.4). Sont retirés avec elle :

- le **panier et la vente par produit** — les tables `Vente`/`LigneVente` sont
  laissées **orphelines en base** (aucune route, aucune UI) plutôt que supprimées ;
- l'**exception DG « annuler une vente »** — bouton, route et permission spéciale
  disparaissent : il n'y a plus rien à annuler. Le DG redevient **strictement en
  lecture seule sur toute l'application, sans aucune exception** ;
- l'**alerte transaction inhabituelle** (seuil de 100.000 Fc) — notification et
  paramètre de configuration supprimés.

La Caisse devient un **registre journalier** : ce qui est entré, ce qui est sorti,
ce qui reste. Devise : Franc Congolais (Fc).

**1. Taux du jour** — une valeur **par date**, saisie par le Caissier (première
tâche de la journée). Tant qu'aucun taux n'est défini pour aujourd'hui, la
**dépense farine** (point 3) reste **désactivée** ; le reste du registre
fonctionne normalement.

**2. Registre du jour** — calculé pour la date sélectionnée (aujourd'hui par
défaut) :

| Poste | Origine | Calcul |
|---|---|---|
| **Entrées** | AUTOMATIQUE | Argent reçu **à la création** des commandes du jour (module Commandes) |
| **Dettes payées** | AUTOMATIQUE | Somme des règlements **CONFIRME** (`PaiementCommande`, voir point 4) datés du jour — **total + liste détaillée** (client, montant) |
| **Dépenses** | SAISIES | Liste libre : motif (texte) + montant ; total = somme des lignes |
| **Solde** | AUTOMATIQUE | `(Entrées + Dettes payées) − Dépenses` |

**Solde négatif** : quand le solde passe sous zéro, il est affiché **en gras et en
rouge vif** (couleur d'alerte volontairement hors palette de marque), partout où
il apparaît — registre de Caisse et tableau de bord — pour qu'il saute aux yeux.

**Pas de double comptage (point d'attention)** : le montant reçu porté par une
commande **inclut ses règlements CONFIRME ultérieurs**. Un règlement confirmé le
jour même de la commande apparaîtrait donc dans les deux postes. La règle
retenue rend les deux ensembles **disjoints par construction** :

- **Entrées** = pour chaque commande créée ce jour, `montant reçu − somme de ses
  règlements CONFIRME` — soit uniquement l'argent encaissé **au moment de la
  création** ;
- **Dettes payées** = **tous** les règlements **CONFIRME** datés de ce jour, y
  compris ceux portant sur une commande créée le même jour. Un règlement encore
  DECLARE (point 4) n'entre dans aucun des deux postes tant qu'il n'est pas
  confirmé par la Caisse — sinon le théorique de clôture (point 5) compterait de
  l'argent jamais vérifié.

Chaque franc n'est ainsi compté qu'une seule fois, et chaque poste porte bien le
sens de son libellé. *(Décision validée.)*

**3. Dépense spéciale farine (case à cocher)** — quand elle est cochée, une ligne
de dépense **automatique** est ajoutée, au motif fixe « Achat farine » :

```
montant = [ (33,5 × taux du jour) + 500 ] × nombre de sacs utilisés
```

Le **nombre de sacs utilisés** provient du module Production (3.3) — les
*ingrédients utilisés* du jour (`Production.sacsUtilises` pour cette date). Cette
ligne compte dans le total des dépenses et dans le solde **comme les autres**.

La case est **désactivée**, avec l'explication du blocage, tant que :
- aucun **taux du jour** n'est défini, ou
- **aucune production n'est enregistrée** ce jour-là — plutôt qu'un calcul sur une
  valeur absente ou un zéro trompeur, ou
- la **session de caisse** de cette date est déjà **clôturée** (point 5).

**4. Règlement déclaré / confirmé** *(Lot 6 — correction de l'écart P0-07 :
« argent transporté confondu avec règlement officiel »)* — un règlement
(`PaiementCommande`) naît **DECLARE** : le Chargé des commandes déclare, depuis
le module Commandes, l'argent qu'il dit avoir reçu (`POST
/commandes/:id/reglements`), mais **la dette du client n'est pas réduite** à ce
stade. Seule sa **confirmation** par la Caisse — rattachement à une remise
contradictoire (point 5) après comptage — fait passer le règlement à
**CONFIRME** et applique alors, et alors seulement, l'effet sur `montantRecu`,
`dette`, avance générée et nouvelle avance (même calcul qu'à l'enregistrement,
`calculerCommande`). Un client peut donc avoir des montants « déclarés, en
attente de confirmation » visibles sur sa commande sans que sa dette officielle
ait bougé. *(Le montant reçu saisi à la création d'une commande reste, lui,
immédiat — hors périmètre de cette distinction, signalé comme extension
possible d'une vague ultérieure.)*

**5. Session de caisse, remise contradictoire et clôture** *(Lot 6 — correction
de l'écart P0-02 : la Caisse dispose désormais d'une clôture réelle, nominative
et non falsifiable)* :

- **Session nominative** — une session par date (`SessionCaisse`), ouverte par
  le Caissier avec un solde d'ouverture. On ne peut pas ouvrir la session d'une
  date tant qu'une session **antérieure** reste ouverte : discipline
  chronologique, aucune inclusion implicite d'un autre jour.
- **Remise contradictoire** — transfert d'espèces documenté avec émetteur
  (`remisParNom`, texte libre — peut ne pas avoir de compte applicatif),
  receveur (le Caissier connecté) et référence/observation facultatives
  (`RemiseCaisse`). Purement documentaire : n'affecte ni le registre ni la
  dette, sauf lorsqu'elle **confirme des règlements déclarés** (point 4) — dans
  ce cas précis, son montant est la somme des règlements sélectionnés.
- **Clôture** — le Caissier saisit le solde **compté** ; le solde
  **théorique** (`soldeOuverture + solde du registre`) est calculé **côté
  serveur**, jamais fourni par le client. L'écart (`compté − théorique`) est
  affiché ; s'il est **non nul**, un **motif est obligatoire** pour clôturer.
  Une fois **FERMEE**, la session verrouille définitivement le registre de sa
  date : plus aucune écriture (taux, dépense) n'y est permise.
- **Correction post-clôture (droit spécial)** — réservée à l'**Administrateur
  Principal** : peut corriger le solde compté et l'écart d'une session déjà
  clôturée, avec motif obligatoire. Chaque correction est tracée intégralement
  au Journal d'audit (avant/après) ; la session affiche la dernière correction
  (auteur, date, motif).

**6. Permissions — inchangées** : Caissier(ère) en écriture, DG en **lecture
seule** (désormais sans aucune exception), autres rôles selon la matrice
existante. Le Caissier conserve sa lecture sur Commandes, Commissions et
Production. La correction post-clôture (point 5) ajoute une garde
supplémentaire : réservée à l'Admin Principal, même si son rôle a déjà
l'écriture Caisse.

**7. Notifications temps réel** : mêmes circuit et principe que le reste de
l'application, sur les écritures réelles du registre (taux du jour défini,
dépense ajoutée ou supprimée) et sur les nouvelles écritures du Lot 6
(ouverture/clôture de session, remise enregistrée, règlement confirmé) ; la
correction post-clôture est notifiée en priorité haute à l'ensemble des Admins,
comme une demande d'approbation.

**8. Journal d'audit (3.17)** : les modifications et suppressions sur
`DepenseCaisse`, `TauxDuJour`, `SessionCaisse` et `RemiseCaisse` sont tracées
**automatiquement** par l'extension Prisma déjà en place — rien de spécifique à
ajouter. La confirmation d'un règlement (`PaiementCommande.statut` DECLARE →
CONFIRME) est un `update`, donc également tracée sans code dédié.

### 3.2 Stocks & matières premières
Suivi des quantités (farine, beurre, sucre, etc.), mouvements de stock (entrée/sortie), seuils d'alerte, historique.

**Alerte seuil — couverture du cas « seuil relevé sans mouvement »** (Lot 7
pt 2) : le franchissement du seuil est détecté en priorité au moment du
mouvement de stock qui le provoque (entrée/sortie, y compris via la
production, 3.3c). Mais relever manuellement le seuil d'alerte d'une matière
(sans toucher au stock lui-même) peut aussi la faire passer sous le nouveau
seuil, sans qu'aucun mouvement n'ait eu lieu — ce cas est désormais couvert
par une vérification paresseuse, rejouée à l'ouverture de l'écran Stocks,
juste après la modification du seuil, et par le même balayage périodique
que les alertes dette/absence (toutes les 30 minutes par défaut,
`ALERTES_CRON`). L'alerte ne part qu'une fois par passage sous le seuil
(compare-and-set sur `alerteSeuilEnvoyeeLe`, remis à zéro dès que le stock
repasse au-dessus) — même logique que l'alerte dette non payée (3.4).

*Hors périmètre (Lot 7 pt 2)* : une « alerte de retard de tournée/livraison »
a été envisagée dans l'audit initial du Lot 7, mais rien dans le modèle
actuel ne porte de durée attendue pour une tournée (aucun champ, aucun
Paramètre) — l'introduire supposerait d'inventer un nouveau seuil métier
sans précédent existant à réutiliser, contrairement au seuil de stock ou à
la dette non payée qui existaient déjà. Ce point reste ouvert, à trancher
avec Augustin avant toute implémentation.

### 3.3 Production *(refonte — les fiches recettes sont retirées)*

Les **fiches recettes** (ingrédients + quantités par produit) et la décrémentation
dérivée « recette × quantité produite » sont **retirées du périmètre** : elles ne
correspondaient pas au fonctionnement réel de la boulangerie, qui raisonne en
**bacs** et en **ingrédients consommés globalement sur la journée**, pas en
nomenclature par produit. Les tables `Recette`/`IngredientRecette` sont laissées
**orphelines en base** (aucune route, aucune UI ne les expose) plutôt que
supprimées, pour ne pas risquer les données existantes.

Le module s'articule désormais en cinq volets, plus une vue d'écarts.

**a) Planning de production** — ce qui est prévu pour le **jour suivant** :

| # | Champ |
|---|---|
| 1 | Date (le jour suivant) |
| 2 | Nombre total de bacs commandés |
| 3 | Détail par produit : quantité prévue de Carré 1.500 Fc, Carré 1.000 Fc, Baguette 500 Fc, Baguette 1.000 Fc *(rattaché aux `Produit` existants — pas de catalogue parallèle)* |
| 4 | Prévision d'ingrédients : sacs de farine, paquets de levure, quantité d'huile, kg de sel |
| 5 | Observations |

**b) Productions enregistrées** — ce qui a réellement été produit (numéro
auto-incrémenté, date) :

| # | Champ |
|---|---|
| 1 | Bacs produits |
| 2 | Bacs livrés Dépositaires |
| 3 | Bacs livrés Mamans |
| 4 | Bacs vendus VC |
| 5 | Bacs donnés — **répartis par motif** (table `MotifDon`, liste fixe extensible, initialisée avec « Police » et « Baraka ») |
| 6 | Bacs restants |
| 7 | Bacs foutus |
| 8 | Kg de farine abîmés *(optionnel)* |
| 9 | Observations |

**Réconciliation (avertissement, jamais un blocage)** : si
`bacs produits ≠ livrés Dépositaires + livrés Mamans + vendus VC + donnés + restants + foutus`,
l'écart est affiché de façon visible, mais **l'enregistrement reste accepté** —
la réalité du terrain prime sur l'équilibre comptable.

*Décisions validées sur ce module* : les quantités d'ingrédients sont reliées aux
matières premières par un **code** porté par `MatierePremiere`
(`FARINE | LEVURE | SEL | HUILE`), et non par correspondance de nom, trop fragile ;
les anciennes lignes `Production`/`PlanningProduction`, non représentables dans le
nouveau modèle, ont été supprimées à la migration, le **journal de stock
append-only étant intégralement conservé**.

**c) Ingrédients utilisés** — saisis sur la production : sacs utilisés, paquets de
levure utilisés, kg de sel utilisés *(même unité kg que la prévision)*, quantité
d'huile utilisée. Ces quantités **décrémentent automatiquement le stock** via des
`MouvementStock` **SORTIE** (référence = la production), dans la **même
transaction** et avec le **même mécanisme d'alerte de seuil** que les mouvements
manuels (section 3.2) — c'est le mécanisme mis en place en Phase 5, seule sa
source de calcul change (quantités saisies au lieu de recette × quantité).

**d) Schéma de commande** *(digitalisation de la « Fiche de commande » papier,
remplie la veille au soir)* — pour une date donnée, une ligne par client
Dépositaire ou Maman, avec le détail par produit (les mêmes quatre `Produit`
que le Planning : Carré 1.500 Fc, Carré 1.000 Fc, Baguette 500 Fc,
Baguette 1.000 Fc, résolus **par nom** via une liste blanche partagée plutôt
que par ID codé en dur). Les Dépositaires sont affichés **groupés par zone de
dépôt** (voir ci-dessous), comme sur la fiche papier ; les Mamans forment une
liste à part, non zonée.

- **Alimentation automatique du Planning (a)** : enregistrer un Schéma pour
  une date **remplace** le nombre de bacs commandés et le détail par produit
  du Planning de cette même date (somme des lignes du Schéma). Les prévisions
  d'ingrédients et les observations du Planning, saisies à la main, **ne sont
  pas touchées**. Un Schéma sans aucune ligne saisie ne crée pas de Planning
  vide ; un Planning déjà créé manuellement pour cette date est mis à jour, pas
  remplacé dans son ensemble — c'est le même idiome « supprimer puis
  recréer les lignes, dans une transaction » que le Planning lui-même.
- **Enregistrement** : un Schéma est **remplacé intégralement** pour la date
  choisie à chaque sauvegarde (pas de diff ligne à ligne), avec une ligne
  `SchemaCommande` par client ayant au moins une quantité saisie, et ses
  `SchemaCommandeLigne` associées.
- **Zones de dépôt** *(nouveau, purement organisationnel)* : un Dépositaire
  peut être rattaché à une zone (`ZoneDepositaire` : nom, ordre d'affichage),
  gérées depuis l'écran du Schéma. La zone n'a **aucune permission propre** —
  sa **lecture** est ouverte à tout utilisateur authentifié (donnée de
  référence pour les listes déroulantes, au même titre que `Produit` ou
  `TypeClient`). Son **écriture** (créer/modifier/supprimer une zone, ou
  l'assigner à un client) exige l'écriture sur le module **Commandes** (3.4,
  puisqu'elle se règle aussi depuis la fiche Client) **OU** sur le module
  **Production** (seul écran d'où la carte de gestion des zones est
  atteignable) — l'un des deux suffit. *Correction apportée après coup* : le
  premier découpage (écriture réservée à Commandes seul) rendait la création
  de zone injoignable pour le Responsable de production (aucun accès
  Commandes) **et** pour le Chargé des commandes (aucun accès Production,
  donc aucun moyen d'atteindre l'écran) — seul l'Admin Principal, qui cumule
  les deux en écriture, pouvait alors créer une zone. Supprimer une zone ne
  bloque rien : les clients rattachés perdent simplement leur zone
  (`onDelete: SetNull`).
- **Création rapide depuis la fiche client** *(amélioration proactive)* : un
  bouton « + » à côté du sélecteur de zone, sur la fiche client (3.4), ouvre
  un dialogue de création minimal (`DialogNouvelleZone`, composant
  réutilisable) — la zone créée est immédiatement sélectionnée pour ce
  client. Le Chargé des commandes n'a ainsi plus besoin de passer par l'écran
  Production pour créer une zone ; la gestion complète (renommer, supprimer)
  reste sur la carte Zones de dépôt de Production.
- **Permissions** : identiques au Planning (a) — écriture Responsable de
  production, lecture Caissier(ère)/DG.

**e) Bon de livraison** *(digitalisation de la fiche papier remplie à la
livraison, écran dédié `/production/bons-livraison`, sous-module de
Production — comme `/commandes/clients` pour Commandes, pour ne pas
encombrer l'écran principal)* — pour une date donnée, une ligne par
Dépositaire **livré** (les Mamans n'apparaissent pas sur cette fiche, la
livraison par camion ne concerne que les Dépositaires), groupées par zone de
dépôt comme le Schéma. Par ligne : détail par produit **livré** (mêmes quatre
`Produit` que le Schéma), bacs vides repris, « Livré par » (texte libre) et
observations.

- **Indépendance volontaire du Schéma de commande** : décision explicite,
  aucun pré-remplissage à partir des quantités commandées — la quantité
  livrée peut différer (rupture, ajustement de dernière minute), et
  inversement le Bon de livraison n'alimente ni le Planning ni les Commandes.
  Même idiome de sauvegarde que le Schéma (remplacement intégral du jour dans
  une transaction) ; un Dépositaire sans aucune valeur saisie (produits à
  zéro, pas de bacs vides, pas de livreur, pas d'observation) n'est
  simplement pas enregistré ce jour-là.
- **PDF imprimable** (décision explicite) : bouton « Imprimer » générant une
  fiche par Dépositaire livré, reprenant la mise en page papier (logo,
  tableau produits/total/bacs vides/observations, et des lignes de signature
  Chauffeur / Dépositaire) — les signatures restent physiques, apposées sur
  le papier imprimé, **non capturées en base**. Export en lecture seule
  (comme les rapports, 3.13), aucune permission d'écriture requise pour
  imprimer des bons déjà enregistrés.
- **Permissions** : identiques au Schéma et au Planning — écriture
  Responsable de production, lecture Caissier(ère)/DG ; l'impression, elle,
  ne demande que la lecture.
- **Badge d'écart livré/commandé** *(amélioration proactive, purement
  visuelle)* : la colonne Total de chaque ligne affiche un badge
  (`+N`/`-N`, même style que le badge de Réconciliation des commandes en 3.3
  b+c) dès que le total livré diffère du total commandé pour ce client à
  cette date (`totalCommande`, calculé depuis le Schéma de commande, ajouté à
  `BonLivraisonClientDTO`). Aucun blocage, aucune alimentation automatique —
  toujours l'indépendance volontaire décrite ci-dessus, juste une visibilité
  immédiate en cas d'écart.

**f) Contrôle qualité, pertes motivées et clôture** *(Lot 4.5/4.6/4.8 du plan
d'attaque — bouton « Qualité » sur chaque ligne de la liste des productions
enregistrées)* — une Production naît **OUVERTE** ; elle se **CLOTURE**
explicitement une fois les deux conditions suivantes réunies, et devient alors
définitivement verrouillée (plus aucune modification possible, y compris sur
les champs déjà saisis à l'enregistrement) :

- **Pertes motivées** : si `bacsFoutus` > 0, la répartition par motif (« Cuisson
  ratée », « Casse / manutention », « Invendu périmé »… liste fixe mais
  extensible, même principe que les motifs de don) doit avoir une somme
  **exactement égale** à `bacsFoutus` — contrairement aux dons, purement
  informatifs, l'exhaustivité est ici exigée avant clôture. Si `bacsFoutus` =
  0, aucune ligne n'est requise.
- **Contrôle qualité enregistré** : un verdict Conforme / Non conforme, avec un
  motif de non-conformité obligatoire dans ce dernier cas (« Cuisson
  insuffisante », « Aspect non conforme », « Poids non conforme »… liste fixe
  extensible), des observations libres facultatives, et la personne/date du
  contrôle.

Tant que la Production est OUVERTE, les pertes et le contrôle qualité peuvent
être saisis ou corrigés librement (remplacement intégral de la répartition des
pertes à chaque enregistrement, un seul contrôle qualité par Production). La
tentative de clôture est refusée avec un message explicite si l'une des deux
conditions manque ; une fois clôturée, la date et l'auteur de la clôture sont
affichés en permanence sur la fiche.

**Écarts** — pour une date donnée, vue comparant prévisions (a) et réalisations
(b + c) sur : bacs, sacs de farine, levure, huile, sel. Chaque paire affiche
`écart = réalisé − prévu`.

**Permissions & notifications — inchangées** : Responsable de production en
écriture, Caissier(ère) et DG en lecture seule (exceptions déjà en place), même
circuit de notification temps réel à l'enregistrement d'une production.

### 3.4 Commandes clients

**Types de clients** ("Qualité" dans l'app), configurés dans les Paramètres :
- **Dépositaires** : prix par bac 4.100 Fc, pas de commission
- **Vente cash (VC)** : prix par bac 4.350 Fc, pas de commission (**confirmé — 0 Fc**)
- **Mamans** : prix par bac 6.000 Fc, commission de 1.650 Fc/bac (27,5 %)

Le prix par bac **et** la commission par bac sont tous deux **figés au moment
de l'enregistrement de la commande** (champ 6 ci-dessous, et 3.11) : modifier
ensuite le taux d'une Qualité dans les Paramètres n'affecte que les commandes
**futures** — jamais l'historique déjà enregistré, même si le client change
ensuite de Qualité (Lot 7 pt 6).

Un client de qualité **Dépositaire** peut en outre être rattaché à une **zone
de dépôt** (`zoneDepositaireId`, optionnel) — champ géré ici, mais consommé
côté Production pour grouper l'affichage du Schéma de commande (3.3 d).

**Fiche client — écran dédié `/commandes/clients`** *(sous-module de
Commandes, même permission COMMANDES, pas de module à part)* : liste
complète des clients (recherche par nom, modifier, supprimer — bloqué si le
client a déjà des commandes), volontairement **séparée** de l'écran principal
des commandes pour ne pas l'encombrer avec des informations de gestion. Une
création rapide de client reste possible directement depuis le formulaire de
nouvelle commande, pour ne pas interrompre la saisie ; la gestion complète
(recherche, modification, suppression) ne vit que sur cet écran dédié,
accessible via un bouton « Gérer les clients » sur l'écran Commandes.

**Champs d'une commande** (numérotation automatique, date) :

| # | Champ | Calcul |
|---|---|---|
| 1 | N° commande | Auto-incrémenté |
| 2 | Date | — |
| 3 | Nom du client | — |
| 4 | Qualité | Dépositaire / Maman / VC |
| 5 | Nombre de bacs reçus | Saisi *(pré-rempli si le client a une livraison du jour — voir ci-dessous)* |
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

**Pré-remplissage optionnel depuis le Bon de livraison** *(amélioration
proactive, aucun lien rigide entre les deux modules)* : à l'ouverture du
formulaire « Nouvelle commande », si le client choisi a un Bon de livraison
enregistré ce jour-là (3.3 e), le champ « Nombre de bacs reçus » se
pré-remplit avec le total livré — un indice visuel (`commandes.bacsPreRemplisHint`)
signale le pré-remplissage, et le champ reste librement modifiable. Route
dédiée `GET /api/commandes/livraisons-du-jour` (lecture module Commandes),
sans écriture ni blocage d'aucune sorte.

**Détection de doublon — une seule commande par client et par jour**

Un même client (même `clientId`) ne peut **jamais** avoir deux commandes à la même
date — la règle vaut pour les **trois Qualités** (Dépositaire, Maman, VC). Il n'y a
donc jamais deux enregistrements distincts pour le même client le même jour :
**une seule commande subsiste toujours**.

Quand une nouvelle saisie arrive pour un client qui a déjà une commande ce
jour-là, l'application ne l'enregistre pas d'office : elle **propose un choix à
l'utilisateur**, appliqué sur **LA MÊME commande** (même numéro, jamais une
nouvelle) :

| Choix | Effet | Exemple *(Dépositaire, 4.100 Fc/bac — commande n°12 à 50 bacs / 205.000 Fc reçus ; nouvelle saisie 10 bacs / 41.000 Fc)* |
|---|---|---|
| **a) Modifier** | La nouvelle saisie **s'additionne** à l'existante | n°12 devient **60 bacs / 246.000 Fc reçus** |
| **b) Remplacer** | La nouvelle saisie **écrase** l'ancienne, qui est oubliée — utile pour corriger une erreur de saisie | n°12 devient **10 bacs / 41.000 Fc** |

Dans les deux cas, Dette / Avance générée / Nouvelle avance sont **recalculés sur
les valeurs résultantes** avec la même formule qu'à la création.

**Cohérence du solde d'avance (point délicat commun aux deux cas)** : l'opération
est une **transaction unique**. Comme un seul enregistrement est modifié — aucune
seconde commande créée, aucune annulation — il s'agit d'un **UPDATE classique** de
la commande existante, suivi du même recalcul dette/avance qu'à la création. Ce
recalcul prend en compte l'avance du client **hors l'effet de cette commande
elle-même** (puisqu'elle est mise à jour et non dupliquée) : l'avance « d'avant »
se reconstitue par `avanceDisponible du client + Avance utilisée − Avance générée`
de la commande visée. Le solde du client est réécrit à partir de ce recalcul.

**Remplacer sur une commande déjà réglée** *(décision validée)* : si la commande
visée porte déjà un ou plusieurs **règlements**, « Remplacer » est **refusé** avec
un message explicite invitant à utiliser « Modifier ». Écraser le montant reçu
rendrait la somme des règlements supérieure à ce montant, et effacer des
paiements réellement encaissés serait pire que le refus.

**Filtres & affichage :**
- Filtre par Qualité (Dépositaire / Maman / VC)
- Filtre/tri par date
- Bouton "Tout afficher"

**Tableau de bord journalier (dans le module Commandes)** — résumé du jour,
visible par les rôles ayant accès à Commandes (Chargé des commandes en écriture,
Caissier(ère) et DG en lecture) :
- Nombre de commandes aujourd'hui
- Total des bacs commandés aujourd'hui
- Montant total à percevoir aujourd'hui
- Montant total reçu aujourd'hui
- Nombre de commandes soldées (dette = 0) vs avec dette en cours
- Total des dettes du jour

**Alerte dette non payée** (nouveau, ponctuelle) : pour toute commande avec dette > 0, une alerte se déclenche une seule fois, le jour suivant sa création (ou à la première ouverture après ce jour si personne ne s'est connecté entre-temps) — jamais répétée pour la même commande une fois envoyée. Reçue par le Chargé des commandes et le Caissier(ère) (règle standard : tous les rôles ayant lecture sur Commandes), à la fois dans la cloche de notifications temps réel et affichée dans le module Commandes. *En plus du déclenchement à l'ouverture d'écran, un balayage périodique (toutes les 30 minutes par défaut, `ALERTES_CRON`) rejoue cette vérification côté serveur — filet de sécurité pour qu'une dette en retard ne reste jamais silencieuse simplement parce que personne n'a rouvert Commandes (Lot 7 pt 2).*

**Règlement d'une dette (ajout suite retour d'expérience Phase 3)** : une commande avec Dette > 0 peut recevoir un ou plusieurs paiements ultérieurs. Chaque règlement :
- Écriture réservée au **Chargé des commandes** (seul rôle en écriture sur Commandes)
- S'ajoute au Montant reçu de la commande visée ; Dette, Avance disponible et Nouvelle avance sont recalculés avec la même formule qu'à la création (un trop-perçu lors du règlement génère de l'avance, comme pour une commande normale)
- Chaque règlement est journalisé (montant, date, auteur) pour la traçabilité
- Déclenche une notification temps réel (même circuit que `NOUVELLE_COMMANDE`)

**Commandes spéciales (gâteaux personnalisés, événements) : retirées du périmètre** (décision métier). Le module Commandes ne couvre que les commandes en bacs.

**Séparation Commandes / Caisse (clarification, aucun changement de logique)** : les deux modules sont et restent totalement indépendants, avec deux catalogues de prix qui ne se croisent jamais. **Commandes** raisonne en **nombre total de bacs**, sans détail produit — `montantBrut = bacs × prix unitaire de la Qualité` (ex. Mutombo, Dépositaire, 50 bacs × 4.100 Fc = 205.000 Fc), via `TypeClient.prixParBac`. **Caisse** raisonne **par produit à l'unité** (Carré, Baguette…), via `Produit.prixVente`. La logique Commandes reste inchangée.

### 3.5 Clients & fidélité
Fiche client, historique d'achats. **Programme de fidélité : conçu mais NON activé** (décision métier) — ni l'interface ni la logique de points/récompenses ne sont construites pour l'instant. Le champ `pointsFidélité` reste en base (placeholder), sans mécanisme associé.

### 3.6 Fournisseurs & achats
Fiches fournisseurs, bons de commande, réception de marchandises (met à jour le stock).

### 3.7 Équipe & droits d'accès
Comptes utilisateurs rattachés à un rôle, hiérarchie et matrice de permissions lecture/écriture par module (voir section 2). Le rôle Administrateur supporte jusqu'à 3 comptes (1 Principal + 2 secondaires) ; un seul compte est marqué "Principal" à la fois.

**Délégation temporaire de rôle** *(nouveau)* : un Admin peut accorder à un utilisateur les droits d'écriture d'un module précis pour une période donnée (ex. remplacement du Chargé des commandes absent 3 jours), sans changer son rôle permanent. À l'expiration, les droits reviennent automatiquement à la normale. La vérification de permission devient : *droits du rôle de base* **OU** *délégation active couvrant ce module à la date du jour*.

Session unique (nouveau) : un compte ne peut pas être connecté sur 2 appareils en même temps. Une nouvelle connexion invalide automatiquement la session précédente ; l'ancien appareil est déconnecté (en temps réel s'il est encore ouvert, sinon à sa prochaine requête) avec un message explicite — pas une simple expiration silencieuse.

Identifiant de connexion issu de Travailleurs (obligatoire pour TOUT compte, y compris DG et Admins, après réinitialisation) : créer un compte Utilisateur ne se fait plus en saisissant un email librement — il faut sélectionner une fiche Travailleur (3.18) dont l'email professionnel est actif (généré et vérifié via Cloudflare Email Routing). L'email du compte est automatiquement celui de cette fiche, non modifiable à la création.

Réaffectation d'équipe (nouveau) : changer le rôle/équipe d'un compte existant se fait directement dans Équipe (ex. un Chargé des commandes qui passe à la Caisse) — l'identifiant de connexion (email pro) ne change pas, seules les permissions changent. La personne concernée reçoit une notification temps réel (« Vous êtes maintenant affecté à [Équipe] ») au moment du changement. Déjà tracé au Journal d'audit comme toute autre modification.

Assistant de premier lancement (nouveau) : quand la base ne contient aucun compte Utilisateur (premier démarrage, ou après une réinitialisation), l'app remplace l'écran de connexion par un assistant guidé : création de la première fiche Travailleur (celle du futur Admin Principal), saisie de son email de destination, génération et vérification de l'email pro via Cloudflare, puis création automatique de son compte (rôle Administrateur, Principal). Aucune connexion possible avant que ce parcours soit terminé.

### 3.8 Tableau de bord & rapports — ultra moderne & sophistiqué
Registre de caisse du jour/semaine/mois, activité par module, export comptable (CSV). Contenu strictement filtré selon le rôle connecté et sa matrice de permissions (section 2) — aucune action de modification visible pour le DG.

Composition par rôle : chaque widget (Caisse, Commandes, Commissions, Stock, Production, Fournisseurs, Travailleurs/Présence) n'apparaît que si le rôle connecté a au moins la lecture sur le module correspondant. Le DG les voit tous — et **depuis la refonte des permissions Admin (section 2), les deux niveaux d'Admin aussi** : l'Admin Principal en écriture, l'Admin secondaire en lecture. L'ancien **état vide « aucune donnée métier »** réservé aux Admins est **supprimé** : ils voient désormais les widgets normalement, comme n'importe quel autre rôle, selon leurs permissions.

Masse salariale (nouveau) : somme des salaireMensuel de tous les Travailleurs enregistrés — coût salarial mensuel théorique (brut), visible par les mêmes rôles que le reste du module Travailleurs (Admins et DG).

Marge par produit (état actuel et décision) : non calculable proprement aujourd'hui (pas de coût systématique par matière première, et depuis la refonte de 3.3 il n'existe plus de nomenclature par produit — les ingrédients sont consommés globalement sur la journée) — le widget affiche volume + CA par produit en attendant, limitation explicite dans l'UI et l'export. Décision pour plus tard : le coût utilisé sera un Coût Moyen Pondéré (CUMP) dérivé des réceptions fournisseurs réelles (LigneCommandeFournisseur), pas un coût de référence saisi à la main. Une marge *par produit* supposerait de réintroduire une clé de répartition des ingrédients journaliers entre produits — à trancher le moment venu ; une marge globale journalière, elle, reste calculable.

**Résumé de clôture quotidien** *(nouveau)* : en fin de journée, un digest auto-généré — registre de caisse du jour (entrées, dettes payées, dépenses, solde), nombre de commandes, dettes en cours, alertes stock actives. Objectif : réduire la dépendance au fil temps réel pour une vue d'ensemble, sans avoir à rejouer toute la journée de notifications. **Portée étendue** : disponible pour le **DG et les deux niveaux d'Admin**, en lecture seule pour tous (cohérent avec leurs permissions depuis la refonte de la section 2 ; l'État système, 3.15, reste le pendant technique). **Rapport quotidien, pas seulement du jour courant** (Lot 7 pt 1) : un sélecteur de date permet de consulter le résumé d'un jour déjà passé (registre, dettes payées, dépenses, solde et nombre de commandes recalculés pour ce jour précis, borné à sa journée civile Africa/Kinshasa) — dettes en cours et alertes stock restent un instantané de l'état actuel, quel que soit le jour consulté, puisqu'il s'agit de soldes vivants et non d'un flux daté.

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
- **Multilingue** *(mis à jour — 4 langues)* : bascule Français/Lingala/Anglais/Swahili pour l'interface (labels uniquement — les données saisies restent telles quelles). Sélecteur affichant le nom natif de chaque langue (Français/Lingala/English/Kiswahili).
- Écran de démarrage (nouveau) : animation du logo à l'ouverture de l'app, 6 à 8 secondes, avant la page de connexion
- Page de connexion (refonte) : traitement visuel soigné, à la hauteur du reste de l'identité de marque
- Format des nombres (nouveau) : séparateur de milliers par un point partout (ex. « 4.100 Fc », pas « 4 100 Fc »)
- Ton des textes (nouveau) : messages d'erreur, confirmations et libellés en langage clair et humain — jamais de code d'erreur brut (403, 401, « Bad Request ») affiché à l'utilisateur, toujours une explication compréhensible à la place. Le vocabulaire métier légitime (Qualité, bac, avance, dette...) reste tel quel, ce n'est pas à simplifier — c'est le ton et la clarté qui doivent s'améliorer, pas le vocabulaire.

### 3.9 Paramètres
Catalogue produits, prix, taxes, informations boutique, gestion des rôles/hiérarchie, gestion des types de clients (prix et commission par bac). Écriture réservée à l'**Administrateur**.

**Ajouts** *(nouveau)* :
- Langue par défaut de l'application (Français / Lingala), modifiable aussi par chaque utilisateur individuellement

*Le seuil d'alerte transaction élevée a été retiré avec l'alerte correspondante (refonte 3.1).*

### 3.10 Notifications temps réel
Quand un événement clé est enregistré (nouvelle commande client, règlement de dette, alerte stock bas, production enregistrée, écriture au registre de caisse, réception fournisseur), une notification s'affiche **instantanément** chez le(s) supérieur(s) hiérarchique(s) concerné(s), sans rechargement de page. Portée : commandes, stock, production et caisse.

*L'**alerte transaction inhabituelle** (seuil configurable, notification dédiée au DG) est **retirée** avec la refonte de la Caisse (3.1) : plus de seuil en Paramètres, plus de notification de ce type.*

### 3.11 Commissions
Vue dédiée aux commandes dont la commission a été générée (les « Mamans », les seules à en générer une). Calcul **automatique** — aucune saisie manuelle. Visible en lecture seule par le Caissier(ère), le Chargé des commandes et le DG.

**Champs :**
| # | Champ | Calcul |
|---|---|---|
| 1 | N° | Auto-incrémenté |
| 2 | Date | — |
| 3 | Nom du client | — |
| 4 | Nombre de bacs reçus | — |
| 5 | Montant total payé | Si Dette de la commande = 0 → `bacs × prix unitaire` (brut, considéré payé à 100% même si une partie vient de l'avance) ; sinon → `Montant reçu` (le montant partiel effectivement remis) |
| 6 | Commission disponible | `bacs × taux de commission en vigueur à l'enregistrement de la commande` (1.650 Fc/bac aujourd'hui pour les Mamans) — **figée** sur la commande elle-même (Lot 7 pt 6) : un changement ultérieur du taux dans les Paramètres, ou un changement de Qualité du client, ne modifie jamais la commission déjà affichée ici |

**Filtres & affichage :** tri/filtre par date, bouton "Tout afficher".

### 3.12 À propos
Page accessible à **tous** les rôles : informations sur Boulangerie Lomoto, logo, tagline "Pain Lia o Tonda", version de l'application, contact. Crédit développeur (nouveau) : « Application créée par Augustin Kayembe » + téléphone +243 980 240 000, affiché **uniquement ici** — pas sur les rapports exportés (voir 3.13, 3.8).

Modifiable par l'Admin (nouveau) :
- Nom, contact, adresse : mêmes champs que « Informations boutique » en Paramètres (3.9) — même donnée éditable depuis les deux endroits, pas une copie séparée
- Nouveau contenu : texte de présentation libre de la boulangerie, horaires d'ouverture, réseaux sociaux (liste extensible : Facebook, Instagram, WhatsApp... pas limité à des champs fixes)

### 3.13 Rapports
Journal d'activité **personnel**, distinct du Tableau de bord/KPI (3.8) : chaque utilisateur y voit ses propres enregistrements (ce qu'il a créé/modifié dans les modules auxquels il a accès), par ordre chronologique. Portée élargie pour certains rôles :
- **DG et Admins** : voient les rapports de tout le monde
- **Caissier(ère)** : voit ses propres rapports + ceux du Chargé des commandes
- Les autres rôles ne voient que leurs propres rapports

Le DG peut ainsi suivre l'activité de chacun de deux façons : directement dans chaque module (lecture seule), ou de façon consolidée ici.

*Note d'implémentation* : la portée de ce module (par personne + exceptions nommées) ne se réduit pas à une entrée standard dans `RolePermission` — prévoir un mécanisme dédié (filtre par `créePar`/`enregistrePar` + liste d'exceptions), distinct de la matrice de permissions habituelle. Module technique séparé de 3.8 (Tableau de bord), qui lui reste piloté par la matrice standard.

Export & partage (nouveau, s'applique aussi à 3.8 Tableau de bord, 3.11 Commissions, et désormais 3.5 Stocks, 3.6 Fournisseurs et 3.1 Caisse — Lot 7 pt 4) : chaque utilisateur peut imprimer (impression navigateur, aussi utilisable pour enregistrer en PDF localement), télécharger un vrai PDF généré côté serveur, ou l'envoyer par email à quelqu'un (côté serveur, pièce jointe PDF, via Gmail/Google Workspace). Logo Boulangerie Lomoto en filigrane sur chaque PDF. *(Modifié — le crédit développeur, 3.12, n'apparaît plus en pied de page des rapports exportés : réservé à la page À propos.)* Reste hors périmètre pour l'instant (extensible plus tard, sans changement d'infrastructure — le composant d'export est générique) : Commandes, Production, Travailleurs, Journal d'audit, Approbations, Équipe.

### 3.14 Activation *(Admin uniquement)*
Active/désactive un compte utilisateur sans le supprimer (ex. employé en congé ou départ temporaire) — l'utilisateur désactivé ne peut plus se connecter, mais son historique reste intact.

### 3.15 État système (Admin uniquement — Principal en écriture pour les actions, secondaire en lecture)
- Nom de l'application, version actuelle
- Licence : « non configuré » pour l'instant (pas de système de licence — viendra avec la version White label future)
- Base de données : statut connecté/déconnecté (testé en direct), hôte + nom de la base uniquement — jamais les identifiants/mot de passe
- Nombre d'utilisateurs actifs

Sauvegardes (nouveau) :
- Automatique : sauvegarde quotidienne de la base, écrite en LOCAL sur le disque du serveur (rétention glissante des sauvegardes les plus récentes, les plus anciennes purgées). Historique visible : date, statut (succès/échec), taille.
- Bouton « Télécharger la dernière sauvegarde locale » (Admin Principal) : récupère directement le fichier déjà produit par la sauvegarde automatique, pour copie immédiate sur un support externe (clé USB/disque externe) — sans regénérer un export.
- Manuelle : bouton « Télécharger une sauvegarde maintenant » (Admin Principal), génère et télécharge un export frais de la base directement dans le navigateur, pour copie sur clé USB/disque externe.
- Tableau de bord de maintenance : dernière sauvegarde (date, statut), prochaine sauvegarde prévue, bouton de sauvegarde manuelle, historique récent.

Décision (remplace l'envoi vers Google Drive prévu initialement) : en usage réel sur l'hébergeur choisi (Render, offre gratuite), un compte de service Google Cloud s'est heurté à une limitation de Google — les comptes de service n'ont pas de quota de stockage propre sur Google Drive, seuls les Drive partagés (Workspace) en offrent un, ce qui alourdit la mise en place pour un gain incertain. Décision : abandon de Google Drive comme destination de sauvegarde. La sauvegarde automatique reste quotidienne mais écrit désormais localement sur le serveur, complétée par un téléchargement facile vers un support externe (clé USB/disque externe) — à la fois pour la sauvegarde automatique la plus récente et pour une sauvegarde manuelle à la demande. Le stockage local du serveur n'étant pas garanti de survivre à un redéploiement, l'écran État système avertit explicitement de cette limite et encourage un téléchargement régulier vers un support externe.

Réinitialisation de la base (nouveau, Admin Principal uniquement — irréversible) :
- Confirmation par saisie d'un mot précis avant activation du bouton (pas un simple clic)
- Champ « raison » optionnel
- Déclenche automatiquement une sauvegarde (pas juste vérifiée comme existante) avant d'effacer quoi que ce soit — la raison est stockée dans les métadonnées de cette sauvegarde spécifique, seule trace qui survit puisque le Journal d'audit lui-même est effacé par l'opération
- Efface toutes les données transactionnelles et tous les comptes (Commandes, Caisse, Stocks/mouvements, Production, Fournisseurs, Travailleurs, Utilisateurs, Assistant, notifications, journal d'audit) ; conserve la configuration structurelle (rôles/permissions, types de clients et leurs prix, catalogue produits, paramètres boutique)
- Après réinitialisation, l'app redémarre automatiquement sur l'Assistant de premier lancement (3.7)

### 3.16 Approbations *(Admin Principal uniquement)*
File d'attente des demandes soumises par les Admins secondaires pour les tâches critiques (voir section 2). Chaque demande : type d'action, demandeur, données de l'action, date, statut. Notification temps réel instantanée à l'Admin Principal dès qu'une demande arrive ; approbation ou rejet en un clic, avec effet immédiat sur l'action en attente.

### 3.17 Journal d'audit *(nouveau — DG et Admins uniquement, lecture seule)*
Historique **immuable** de toute modification ou suppression (pas seulement les créations, déjà tracées via créePar/enregistrePar) : qui, quoi, quand, valeur avant/après. Protège l'ensemble de l'équipe — y compris les Admins, dont les actions y sont également journalisées. Filtrable par utilisateur, module, période.

### 3.18 Travailleurs (Admin secondaire, écriture — scope résolu)
Roster du personnel, plus large que les seuls comptes Utilisateur : couvre aussi le personnel sans accès à l'application (ex. livreur, agent d'entretien).
- Fiche : nom, téléphone, poste, date d'embauche, lien optionnel vers un compte Utilisateur (si la personne a aussi un accès à l'app)
- Pointage : horodatage réel d'entrée et de sortie (date + heure, pas juste une date) — gère nativement les équipes de nuit qui commencent un jour et finissent le lendemain
- Absence : motif déclaré + décision distincte (justifiée / non justifiée / en attente), tranchée par l'Admin secondaire ou Principal — pas le chef de département (purement organisationnel)

Rappel absence en attente (nouveau) : même mécanisme que l'alerte dette non payée (3.4) — une alerte ponctuelle, le jour suivant la déclaration d'une absence encore en_attente, jamais répétée une fois envoyée. Cloche + affichage dans le module, reçue par l'Admin secondaire et Principal. Comme pour la dette (3.4), le même balayage périodique la rejoue en filet de sécurité (Lot 7 pt 2).

Filtres & affichage : par travailleur, par date, bouton "Tout afficher".
DG : lecture seule, comme tous les modules métier.

Adresse email professionnelle (nouveau) : sur une fiche Travailleur, l'Admin secondaire peut renseigner une adresse de destination (boîte mail personnelle existante de l'employé) et déclencher la création automatique d'une adresse pro (prenom.nom@boulangerie-lomoto.com) via Cloudflare Email Routing (gratuit, redirection — pas une boîte indépendante). Statut affiché sur la fiche : en attente de vérification / actif / échec. La vérification finale (clic sur le lien reçu par l'employé) reste hors du contrôle de l'app — Cloudflare l'exige côté destinataire, aucun moyen de l'automatiser davantage.

Départements & Groupes (nouveau — purement organisationnel, aucune permission associée) : chaque Travailleur est rattaché à un Département (ex. « Département de Production », « Département des finances »), qui a un chef désigné (un Travailleur, simple référence, pas de droits particuliers dans l'app). Un Département peut être subdivisé en Groupes (ex. « Groupe 1 », « Groupe 2 » au sein de la Production) — terme volontairement différent d'« Équipe » pour éviter la confusion avec le nom d'affichage des rôles (3.7).

Salaire & paie (nouveau) : chaque fiche Travailleur porte un salaire mensuel (Fc) et un nombre de jours travaillés par mois — pas une valeur fixe pour tous, certains agents à 26 jours, d'autres à 13 : saisi individuellement à la création de la fiche (obligatoire pour toute nouvelle fiche, comme le Département), il sert de diviseur pour calculer le taux journalier (salaireMensuel / joursTravaillesParMois).

Sanction (nouveau, distincte des déductions automatiques pour absence) : punition ou retenue disciplinaire déclarée sur une fiche — motif, date, et un montant uniquement pour une retenue (jamais pour une punition non financière).

Calcul de paie (nouveau), par Travailleur et par mois : salaire de base (salaireMensuel) − retenue pour absences non justifiées de ce mois (nombre de jours × taux journalier) − retenues disciplinaires (somme des Sanction de type retenue de ce mois) = salaire net. Aucun arrondi intermédiaire : le calcul reste en précision complète jusqu'au résultat final, arrondi au Fc le plus proche une seule fois. Seules les absences au statut « non justifiée » sont retenues — une absence en attente ou justifiée n'a aucun impact. Le calcul est bloqué, avec message explicite, pour un Travailleur dont le salaire ou les jours travaillés ne sont pas encore renseignés (fiches créées avant cette fonctionnalité). Écriture (salaire, jours travaillés, sanctions) réservée à l'Admin secondaire/Principal, comme le reste du module Travailleurs.

Bulletins de paie (nouveau) : document PDF par Travailleur et par mois, généré à partir du calcul de paie — réutilise le mécanisme d'export déjà en place (logo en filigrane, sans le crédit développeur, retiré des exports). Une fois émis, le bulletin est figé (photo des chiffres à cet instant) — un ajustement ultérieur (nouvelle sanction, décision d'absence changée) n'altère jamais rétroactivement un bulletin déjà généré, seul un nouveau calcul en tient compte. Si le Travailleur a un compte Utilisateur lié, il peut consulter et télécharger ses propres bulletins (lecture seule, les siens uniquement) ; les Admins voient et génèrent ceux de tout le monde.

Suppression d'une fiche Travailleur : bloquée (409) si des bulletins de paie ont déjà été générés pour cette personne — même principe que la suppression d'un Client bloquée par ses commandes (3.4), l'historique de paie officiel ne doit jamais disparaître silencieusement avec la fiche. Pointages, absences et sanctions, eux, restent purement opérationnels : ils sont supprimés en cascade avec la fiche, sans blocage. *(Correction apportée après coup : la suppression n'effectuait initialement aucune vérification.)*

### 3.19 Assistant (accessible à tous les rôles — mode humain, IA désactivée temporairement)
Chat en temps réel (Socket.io) accessible à tout utilisateur connecté, pour écrire directement à un Admin et envoyer des captures d'écran. (La couche IA Gemini est codée et prête, mais désactivée pour l'instant — bloquée par la facturation Google Cloud à finaliser. Reprise prévue lors d'une prochaine mise à jour, sans travail de reconstruction : juste la réactiver une fois la facturation réglée.)

Fonctionnement (mode actif) :
- L'utilisateur écrit directement à un Admin, sans étape IA
- Toute nouvelle conversation apparaît dans une file visible par les 3 comptes Admin (Principal + secondaires), n'importe lequel peut répondre — même logique que la file Approbations (3.16)
- Notification temps réel aux Admins à chaque nouveau message
- Captures d'écran : stockées directement en base
- auteurType reste en champ ouvert (utilisateur/admin/ia) — la valeur « ia » existe déjà dans le code, juste non utilisée tant que la couche est désactivée

Permissions : tous les rôles en écriture sur leurs propres conversations ; les Admins voient et répondent à toutes les conversations.

## 4. Hors périmètre (v1)

- Gestion multi-boutiques (plusieurs points de vente) — à revoir en v2
- Application mobile native (le web responsive couvre le besoin)
- Paiement en ligne / e-commerce
- Gestion de la paie des employés (RH complète)
- Mode hors-ligne complet de la caisse (à évaluer séparément — voir questions ouvertes)

## 5. User stories principales

**Caisse**
- ~~En tant que Caissier(ère), je veux encaisser une vente en moins de 30 secondes pour ne pas faire attendre le client.~~ *(caduc — la vente au comptoir est retirée ; voir 3.1)*
- ~~En tant que Caissier(ère), je veux que la TVA soit calculée automatiquement selon le type de vente (sur place/à emporter).~~ *(caduc — catalogue 100 % pain, aucune TVA ; voir 3.1)*
- ~~En tant que DG, je veux pouvoir annuler une vente frauduleuse.~~ *(caduc — plus de vente à annuler ; le DG est strictement en lecture seule ; voir 3.1)*
- En tant que Caissier(ère), je veux définir le taux du jour puis suivre en un écran les entrées, les dettes payées, mes dépenses et le solde restant, pour savoir à tout moment ce qu'il y a en caisse.
- En tant que Caissier(ère), je veux que la dépense d'achat de farine se calcule seule à partir du taux du jour et des sacs réellement consommés en production, pour ne pas refaire le calcul à la main.

**Stocks**
- En tant que Responsable Stock/Achats et Fournisseurs, je veux être alerté quand une matière première passe sous le seuil critique pour anticiper la commande fournisseur.

**Production**
- En tant que Responsable de production, je veux voir le planning de production du jour basé sur les commandes.

**Commandes clients**
- En tant que Chargé des commandes, je veux que le prix et la commission se calculent automatiquement selon le type de client (Dépositaire/Maman) pour ne jamais avoir à les saisir à la main.

**Paramètres**
- En tant qu'Administrateur, je veux configurer le prix et la commission par bac pour chaque type de client afin que le calcul automatique reste toujours à jour.

**Rapports**
- En tant que Directeur Général, je veux voir le chiffre d'affaires et les produits les plus vendus pour piloter l'activité, sans avoir à intervenir directement dans les modules.

**Hiérarchie & temps réel**
- En tant que Chargé des commandes, je veux voir apparaître instantanément une commande enregistrée par un Caissier(ère) pour la valider sans délai.
- En tant que Directeur Général, je veux voir en temps réel tous les événements clés (commandes, stock, production, caisse) sans avoir à rafraîchir la page.
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
Recette (id, produitId, instructions)                      # ORPHELINE — plus utilisée (refonte 3.3)
IngredientRecette (recetteId, matierePremiereId, quantité)  # ORPHELINE — plus utilisée (refonte 3.3)
PlanningProduction (id, datePrevue, nombreBacsCommandes, sacsFarinePrevus, paquetsLevurePrevus, quantiteHuilePrevue, kgSelPrevus, observations, créePar)
PlanningLigneProduit (planningId, produitId, quantitePrevue)   # détail par produit du catalogue Caisse
MotifDon (id, nom)                                             # liste fixe extensible : Police, Baraka…
ZoneDepositaire (id, nom, ordre)                               # organisationnel, aucune permission propre (3.3 d)
SchemaCommande (id, date, clientId, créePar)                   # une ligne par (date, client) — Dépositaire ou Maman
SchemaCommandeLigne (schemaCommandeId, produitId, quantite)    # détail par produit, alimente PlanningLigneProduit
BonLivraison (id, date, clientId, bacsVides, livrePar?, observations?, créePar)  # une ligne par (date, Dépositaire), indépendant du Schéma
BonLivraisonLigne (bonLivraisonId, produitId, quantite)        # détail par produit LIVRÉ
Production (id, numero, date, bacsProduits, bacsLivresDepositaires, bacsLivresMamans, bacsVendusVC, bacsRestants, bacsFoutus, kgFarineAbimes?, sacsUtilises, paquetsLevureUtilises, kgSelUtilises, quantiteHuileUtilisee, observations, enregistrePar, statut, clotureeLe?, clotureePar?)  # statut: ouverte | cloturee (3.3 f)
ProductionDon (productionId, motifDonId, nombreBacs)           # répartition des bacs donnés par motif
MotifPerte (id, nom)                                           # liste fixe extensible : Cuisson ratée, Casse/manutention, Invendu périmé… (3.3 f)
ProductionPerte (productionId, motifPerteId, nombreBacs)       # répartition des bacs foutus par motif — somme exigée = bacsFoutus avant clôture
MotifNonConformite (id, nom)                                   # liste fixe extensible : Cuisson insuffisante, Aspect non conforme, Poids non conforme… (3.3 f)
ControleQualite (productionId, verdict, motifId?, observations?, controlePar?, controleLe)  # verdict: conforme | non_conforme — un seul par Production (3.3 f)
MatierePremiere (id, nom, code?, unité, quantitéStock, seuilAlerte)   # code = FARINE|LEVURE|SEL|HUILE, relie les ingrédients saisis en production au stock
MouvementStock (id, matierePremiereId, type, quantité, date, référence)
Fournisseur (id, nom, contact)
CommandeFournisseur (id, fournisseurId, statut, date)
LigneCommandeFournisseur (commandeId, matierePremiereId, quantité, prixUnitaire)
Client (id, nom, téléphone, typeClientId, avanceDisponible, pointsFidélité)   # avanceDisponible = solde reporté d'une commande à l'autre
CommandeClient (id, numero, clientId, quantitéBacs, montantBrut, commission, avanceUtilisee, montantAPercevoir, montantRecu, dette, avanceGeneree, statut, dateRetrait, créePar)   # commission figée au taux TypeClient.commissionParBac en vigueur à l'enregistrement (3.11, Lot 7 pt 6) — jamais recalculée après coup
PaiementCommande (id, commandeClientId, montant, date, enregistrePar, statut, remiseCaisse?, confirmeLe?, confirmePar?)   # statut: declare | confirme (3.1 pt 4) — seule la confirmation réduit la dette
Vente (…)          # ORPHELINE — vente au comptoir retirée (refonte 3.1)
LigneVente (…)     # ORPHELINE — idem
ClotureCaisse (…)  # ORPHELINE — pas de clôture dans le registre journalier
TauxDuJour (id, date, valeur, definiPar)                                  # une valeur par date (3.1)
DepenseCaisse (id, date, motif, montant, origine, tauxApplique?, sacsUtilises?, enregistrePar)   # origine: MANUELLE | FARINE
SessionCaisse (id, date, statut, soldeOuverture, soldeTheoriqueFermeture?, soldeCompteFermeture?, ecartFermeture?, motifEcart?, ouvertePar?, fermeePar?, derniereCorrection*?)   # statut: ouverte | fermee — une par date (3.1 pt 5)
RemiseCaisse (id, sessionCaisseId, montant, remisParNom, recuPar?, enregistreParId?, reference?, observation?, dateRemise)   # remise contradictoire, confirme éventuellement des PaiementCommande (3.1 pt 5)
Travailleur (id, nom, téléphone, poste, dateEmbauche, utilisateurId, departementId, groupeId, salaireMensuel, joursTravaillesParMois)   # utilisateurId/departementId/groupeId/salaireMensuel/joursTravaillesParMois nullables en base (fiches existantes), obligatoires côté schéma applicatif pour toute NOUVELLE fiche
Departement (id, nom, chefTravailleurId)   # chefTravailleurId nullable — simple référence, aucune permission (3.18)
Groupe (id, departementId, nom)            # subdivision d'un Département
Pointage (id, travailleurId, horodatageEntree, horodatageSortie, enregistrePar)   # horodatageSortie nullable (encore en poste) — date+heure réels, pas juste une date (équipes de nuit)
Absence (id, travailleurId, date, motif, declareParId, decisionStatut, decidePar, dateDecision)   # declareParId = auteur de la déclaration, distinct de decidePar qui tranche ; decisionStatut: en_attente | justifiee | non_justifiee ; decidePar/dateDecision nullables tant qu'en attente
Sanction (id, travailleurId, type, motif, montant, date, enregistrePar)   # type: punition | retenue ; montant nullable (uniquement pour une retenue)
BulletinPaie (id, travailleurId, mois, salaireMensuel, joursTravaillesParMois, tauxJournalier, absencesNonJustifiees, retenueAbsences, sanctionsRetenues, totalRetenuesDisciplinaires, salaireNet, genereParId, dateGeneration)   # instantané figé du calcul de paie au moment de la génération (absencesNonJustifiees/sanctionsRetenues en JSON) — jamais recalculé depuis Absence/Sanction après coup
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
| Internationalisation | react-i18next | Bascule Français/Lingala/Anglais/Swahili sur les labels d'interface |
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
4. **Caisse** — registre journalier : taux du jour, entrées, dettes payées, dépenses (dont farine), solde *(la vente au comptoir et l'alerte transaction inhabituelle, initialement prévues ici, ont été retirées lors de la refonte de 3.1)*
5. **Stocks & production** — matières premières, alertes temps réel *(les recettes, initialement prévues ici, ont été retirées lors de la refonte de 3.3)*
6. **Fournisseurs & achats** — notification de réception
7. **Tableau de bord & rapports** — vue KPI globale (DG), vue filtrée (autres rôles), résumé de clôture quotidien
8. **Rapports personnels, À propos** — journal d'activité par utilisateur (3.13), page statique (3.12)
9. **Travailleurs & Utilisateurs** — module Travailleurs (Admin secondaire, écriture — scope résolu)
10. **Admin : Activation, État système, Approbations, Délégation temporaire** — gestion des comptes, statut système, workflow d'approbation multi-admin, délégation de droits
11. **Journal d'audit** — traçabilité des modifications/suppressions réussies ; couverture complète de l'application existante (toutes les phases sont désormais construites : les ~13 modules Commandes, Commissions, Caisse, Stocks, Production, Fournisseurs, Équipe, Travailleurs, Paramètres, Activation, Approbations, Délégation sont tous couverts)

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

**Caisse — registre journalier**
- Étant donné une commande créée aujourd'hui avec 60.000 Fc reçus, puis un règlement de 20.000 Fc le même jour, et une dépense saisie de 5.000 Fc
- Quand le Caissier(ère) consulte le registre du jour
- Alors Entrées = 60.000 Fc, Dettes payées = 20.000 Fc (le règlement n'est jamais compté deux fois), Dépenses = 5.000 Fc et Solde = 75.000 Fc

**Caisse — dépense farine**
- Étant donné un taux du jour défini et une production du jour ayant consommé 10 sacs
- Quand le Caissier(ère) coche la dépense farine
- Alors une ligne « Achat farine » est ajoutée pour `[(33,5 × taux) + 500] × 10`, comptée dans les dépenses et le solde ; sans taux ou sans production du jour, la case reste désactivée avec l'explication du blocage

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
- Étant donné un Responsable de production connecté
- Quand il consulte le menu
- Alors il voit tous les modules listés, mais seul "Production" (et À propos/Rapports) est cliquable — les autres apparaissent grisés

**Visibilité croisée — Caissier**
- Étant donné qu'un rapport de production est publié par le Responsable de production
- Quand le Caissier(ère) consulte son dashboard
- Alors il voit ce rapport en lecture seule, bien que la production ne soit pas dans sa chaîne hiérarchique directe

## 11. Questions ouvertes

- Faut-il un mode dégradé/hors-ligne pour la caisse en cas de coupure internet ? *(technique — à trancher avant la phase 2)*
- Quel prestataire pour l'encaissement (mobile money local, carte) ? **Résolu : sans objet — paiement en espèces uniquement** (mobile money/CB retirés de l'encaissement).
- Le programme de fidélité : points cumulés ou carte tampon simple ? **Résolu : fidélité conçue mais non activée** — ni interface ni logique construites pour l'instant.
- Le pain est exonéré de TVA (confirmé). Les autres produits éventuels (pâtisseries, gâteaux sur commande) sont-ils eux aussi exonérés, ou un taux s'applique-t-il ? **Résolu : sans objet — catalogue 100 % pain, aucune TVA** (question close). Le champ taux de taxe reste en base sans être utilisé.
- Si un rôle a plusieurs titulaires (ex. deux caissiers), la notification doit-elle aller à tous les titulaires du rôle supérieur, ou à une seule personne assignée ? *(métier)*
- Le DG doit-il disposer d'une action exceptionnelle malgré l'accès lecture seule (ex. annuler une vente frauduleuse) ? **Caduc depuis la refonte 3.1** : la vente au comptoir ayant disparu, il n'y a plus rien à annuler — le DG est **strictement en lecture seule, sans aucune exception**.
- La catégorie **Vente cash (VC)** génère-t-elle bien 0 Fc de commission, comme les Dépositaires ? **Résolu : oui — 0 Fc de commission** (confirmé).
- Au-delà de ces 3 types (Dépositaires, Vente cash, Mamans), d'autres catégories sont-elles prévues à terme ? *(métier — n'affecte pas l'architecture, juste la configuration)*
- Le module Travailleurs (3.18) : Résolu — fiches employés + présence/pointage quotidien, sans paie.
- La liste des "tâches critiques" nécessitant l'approbation de l'Admin Principal (section 2) : **Résolu — liste figée à 5 items** (suppression d'un utilisateur, création/suppression d'un compte Admin, modification prix/commissions par Qualité, modification du taux de taxe, modification des permissions d'un rôle). La réinitialisation de la base de données en est explicitement exclue (procédure d'infrastructure, hors application).
- "État système" (3.15) : quelles informations exactes afficher, au-delà du statut base de données ?
- Un Admin secondaire peut-il lui-même approuver/rejeter une demande d'un autre Admin secondaire, ou seul l'Admin Principal le peut ? **Résolu : seul l'Admin Principal approuve/rejette** — un Admin secondaire ne peut jamais approuver, même une demande émise par un autre Admin secondaire.
- Quel seuil (en Fc) déclenche l'alerte transaction inhabituelle (3.10) ? **Caduc depuis la refonte 3.1** : l'alerte et son seuil sont retirés.
- Une délégation temporaire de rôle (3.7) peut-elle chevaucher plusieurs modules à la fois, ou un seul module par délégation ?
- Le Journal d'audit (3.17) doit-il aussi inclure les tentatives d'accès refusées (403), utile pour la sécurité, ou seulement les actions réussies ? **Résolu : uniquement les actions réussies** (modifications et suppressions effectivement appliquées) — les tentatives refusées (403) ne sont pas journalisées.
- Les "commandes spéciales" (gâteaux personnalisés, événements — fin de la section 3.4) n'ont pas encore de statut/dateRetrait en base (omis volontairement en Phase 3, qui couvrait les commandes en bacs). À quel moment les construire ? **Résolu : retirées du périmètre** (décision métier) — le module Commandes ne couvre que les commandes en bacs.

## 12. Prochaines étapes

1. Valider ou ajuster ce document avec le gérant/l'équipe
2. Ouvrir Claude Code dans un dossier de projet et lui fournir ce fichier comme référence
3. Démarrer par la Phase 1 (fondations + catalogue produits)
