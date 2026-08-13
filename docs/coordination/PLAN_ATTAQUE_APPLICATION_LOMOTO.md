# Audit complet et plan d’attaque — application Boulangerie Lomoto

**Version :** 1.1  
**Date de l’audit :** 12 août 2026  
**Dernière actualisation fonctionnelle :** 13 août 2026  
**Dépôt audité :** `kayboxstore/Boulangerie`  
**Branche :** `main`  
**Commit figé pour l’audit :** `27724820e540ff53f1ee63369a6eb2984af19b6f`  
**Nature de l’audit :** audit statique complet du code, de la base, des permissions, des parcours et de l’utilisabilité  
**Décision :** conserver la base technique, corriger les risques immédiats, puis reconstruire progressivement le circuit métier autour de preuves et d’états explicites

---

## 1. Verdict exécutif

L’application actuelle n’est pas prête pour un pilote opérationnel réel de Lomoto.

Elle constitue une base propre et réutilisable pour :

- l’authentification ;
- les rôles et permissions élémentaires ;
- le catalogue de produits ;
- les notifications persistantes et en temps réel ;
- une caisse comptoir simple ;
- une première saisie de « commandes » et de paiements.

Mais elle ne modélise pas encore le circuit quotidien réel :

> Prospect → dépositaire validé → prévision → plan de production → lot de production → qualité → remise au magasin → chargement → tournée → livraison acceptée → montant facturable → paiement → argent transporté → remise contradictoire à la caisse → clôture.

L’écart principal n’est pas graphique. Il est métier et comptable : l’objet actuel `CommandeClient` transforme immédiatement un nombre de bacs en montant dû, alors qu’une prévision, un chargement ou une marchandise transportée ne doivent pas créer de créance. Seule une livraison effectivement acceptée doit devenir facturable.

Trois décisions sont donc impératives :

1. ne pas ajouter de nouveaux écrans sur le modèle actuel sans d’abord séparer les étapes métier ;
2. ne pas réécrire le projet : l’architecture TypeScript, React, Express, Prisma et plusieurs composants sont réutilisables ;
3. ne pas mettre l’application en production avant la correction des défauts P0 de sécurité, de clôture de caisse, d’historique et de non-duplication.

---

## 2. Périmètre et méthode

### 2.1 Éléments examinés

L’audit couvre l’ensemble des fichiers sources et de configuration écrits à la main présents dans le dépôt :

- spécification fonctionnelle existante ;
- configuration du monorepo et des environnements ;
- schéma Prisma, migrations et données d’initialisation ;
- package partagé, types et validations Zod ;
- API Express, middleware, routes et services ;
- application React, routes, pages, composants et styles ;
- authentification, permissions, transactions, notifications et WebSocket ;
- ergonomie mobile déductible des composants et mises en page ;
- état du dépôt GitHub, de la branche et de l’automatisation.

Le dépôt contient 66 fichiers suivis pour environ 2,4 Mo. Le fichier de verrouillage généré a été contrôlé comme artefact de dépendances, mais n’a pas fait l’objet d’une revue ligne par ligne. Le logo binaire de 1,99 Mo a été contrôlé pour son poids.

### 2.2 Limites de la preuve

Cet audit est complet sur le plan statique, mais ce n’est pas un test d’exploitation :

- aucune base PostgreSQL de production n’a été consultée ;
- aucune donnée réelle Lomoto n’a été modifiée ;
- le projet n’a pas été exécuté avec des comptes réels dans un téléphone ;
- aucun test de charge, de sauvegarde/restauration ou de coupure réseau n’a pu être exécuté ;
- le dépôt ne contient ni suite de tests automatisés ni pipeline CI permettant de reproduire les vérifications mentionnées dans certains messages de commit.

Les constats marqués « critique » proviennent néanmoins directement du code et ne dépendent pas d’un test visuel pour être valides.

---

## 3. Inventaire de l’existant

### 3.1 Architecture

| Couche | Technologie | État |
|---|---|---|
| Monorepo | npm workspaces | Simple et réutilisable |
| Frontend | React 19, TypeScript, Vite 6 | Base moderne |
| Interface | Tailwind CSS 4, Radix UI, composants locaux | Cohérente, mais encore orientée ordinateur |
| Données client | TanStack React Query | Bonne base pour cache et invalidation |
| Temps réel | Socket.io | Fonctionnel comme fondation |
| API | Express 4, TypeScript | Lisible, peu structurée pour un domaine plus large |
| Validation | Zod partagé front/back | Bonne décision |
| ORM | Prisma 6 | Adapté au projet |
| Base | PostgreSQL | Adaptée aux transactions métier |
| Authentification | JWT 12 h | Fonctionnelle, à durcir |
| Tests | Aucun fichier de test | Bloquant pour le pilote |
| CI/CD | Aucun workflow GitHub Actions | Bloquant pour la fiabilité |

### 3.2 Écrans réellement disponibles

| Route | Écran | Fonction actuelle | Décision |
|---|---|---|---|
| `/connexion` | Connexion | Authentification email/mot de passe | Conserver et durcir |
| `/` | Tableau de bord | Matrice de permissions et activité | Transformer en accueil par rôle |
| `/produits` | Produits | Liste, création, modification, suppression | Conserver, remplacer la suppression par archivage |
| `/commandes` | Commandes clients | Bacs reçus, montant, dette, règlement | Reconcevoir autour des étapes réelles |
| `/commissions` | Commissions | Calcul à partir des commandes | Geler puis reprendre en P2 |
| `/caisse` | Caisse | Vente comptoir, historique et clôture | Conserver le POS, refaire remise/clôture |

Les modules Stocks, Production, Fournisseurs, Paramètres, Équipe, Rapports et Travailleurs apparaissent dans les permissions ou le menu, mais ne possèdent pas encore de parcours fonctionnel complet dans le frontend.

### 3.3 Routes API disponibles

| Domaine | Routes principales |
|---|---|
| Authentification | `POST /api/auth/login`, `GET /api/auth/me` |
| Produits | lecture, création, modification et suppression |
| Rôles | lecture de la matrice des rôles |
| Notifications | liste, marquer une notification lue, tout marquer lu |
| Types de clients | lecture |
| Clients | lecture et création |
| Commandes | lecture, création et règlement |
| Commissions | lecture |
| Caisse | ventes, création d’une vente, clôture et historique des clôtures |

Il n’existe aucune route pour les prospects, visites, validations, prévisions, plans de production, lots de production, recettes, matières, contrôles qualité, remises au magasin, chargements, tournées, livraisons acceptées, retours, écarts, argent transporté, remises de caisse, inventaires ou audit.

### 3.4 Modèle de données disponible

Les modèles présents sont :

- `Role`, `RolePermission`, `Utilisateur` ;
- `Notification` ;
- `TypeClient`, `Client` ;
- `CommandeClient`, `PaiementCommande` ;
- `Produit` ;
- `Vente`, `LigneVente`, `ClotureCaisse` ;
- `ParametreBoutique`.

Les modèles opérationnels centraux manquent donc presque entièrement.

### 3.5 Rôles initialisés

- Directeur Général ;
- Administrateur ;
- Caissier(ère) ;
- Chargé des commandes ;
- Responsable de production ;
- Responsable Stock/Achats et Fournisseurs ;
- Chargé du personnel.

Le seed crée huit utilisateurs, dont deux personnes rattachées au rôle Stock/Achats. La documentation mentionne parfois « sept rôles » comme s’il s’agissait de sept utilisateurs ; il faut corriger cette ambiguïté.

### 3.6 Modules de permission actuels

`CAISSE`, `COMMANDES`, `STOCKS`, `PRODUCTION`, `FOURNISSEURS`, `COMMISSIONS`, `PARAMETRES`, `EQUIPE`, `RAPPORTS`, `TRAVAILLEURS`.

Il faut étendre ou réorganiser cette taxonomie pour couvrir au minimum : Commercial, Clients, Magasin, Livraisons/Tournées, Qualité, Validations, Anomalies, Audit et État système.

---

## 4. Ce qui est déjà bon et doit être conservé

### F-01 — Permissions vérifiées côté serveur

Le middleware recharge l’utilisateur actif et ses permissions depuis la base à chaque requête protégée. Un compte désactivé perd donc effectivement l’accès, et la sécurité ne repose pas uniquement sur les boutons du frontend.

**Décision :** conserver ce principe et l’étendre à chaque nouvelle action métier.

### F-02 — Calculs financiers exécutés côté serveur

Le prix, la taxe et les montants de commande sont recalculés côté serveur. Le navigateur n’impose pas directement le montant comptable.

**Décision :** conserver, mais appliquer cette règle à la livraison acceptée et non à la prévision.

### F-03 — Transactions pour les opérations couplées

La création d’une commande et l’éventuel paiement initial utilisent une transaction sérialisable.

**Décision :** conserver l’atomicité, ajouter une stratégie de retry sur conflit et des clés d’idempotence.

### F-04 — Historisation des lignes de vente comptoir

Les lignes de vente mémorisent le prix et le taux de taxe utilisés au moment de la vente.

**Décision :** répliquer le principe de snapshot sur les tarifs client, commissions, livraison, devise et conditions commerciales.

### F-05 — Notifications persistantes et temps réel

Les notifications sont conservées en base et complétées par Socket.io. La reconnexion recharge l’historique.

**Décision :** conserver l’infrastructure, ajouter la gestion d’erreur/rollback et fiabiliser la publication avec un outbox.

### F-06 — Unicité de l’administrateur principal

Une contrainte partielle protège l’unicité du compte administrateur principal.

**Décision :** conserver et ajouter des règles d’approbation explicites pour les administrateurs secondaires.

### F-07 — Validation Zod partagée

Les types et validations communs réduisent la divergence entre frontend et API.

**Décision :** étendre le package partagé avec des contrats versionnés par opération.

---

## 5. Écarts critiques à corriger avant tout pilote

### P0-01 — La commande actuelle crée la dette trop tôt

**Preuve :** `CommandeClient` calcule le montant à partir de `quantiteBacs` dès la saisie et enregistre directement le montant reçu et le solde.

**Risque :** une prévision, un chargement ou une livraison non acceptée peut devenir une créance officielle. Les chiffres de dette et de commission sont alors faux.

**Correction :** créer des objets séparés : `PrevisionClient`, `ChargementTournee`, `Livraison`, `AcceptationLivraison` et `FacturationLivraison`. La créance naît uniquement de la quantité acceptée.

### P0-02 — La clôture de caisse mélange les caissiers et les jours

**Preuve :** `POST /api/caisse/cloture` sélectionne toutes les ventes non clôturées, sans filtrer par caissier ni par journée, puis les rattache à la clôture du demandeur.

**Risque :** un caissier peut clôturer les ventes d’un autre caissier ou d’un jour antérieur. Le montant de clôture peut être faux sans qu’un écart soit visible.

**Correction immédiate :** ajouter session de caisse, propriétaire, date locale, devise, fond initial, montants théoriques, montants comptés, écarts, motif et validation. Interdire toute inclusion implicite d’une autre session.

### P0-03 — Les erreurs de notifications sont masquées par l’interface

**Preuve :** le frontend marque immédiatement les notifications comme lues, puis ignore toute erreur de l’appel API avec un `catch` vide. Le chargement de l’historique ignore également ses erreurs.

**Risque :** l’écran peut afficher un état différent de la base et ne donne aucune action de reprise quand la connexion échoue.

**Correction immédiate :** afficher l’échec, restaurer l’état précédent ou recharger la vérité serveur, proposer « Réessayer » et tester le comportement après rechargement.

### P0-04 — Absence de journal d’audit métier

**Risque :** une correction, une suppression, un changement de montant ou de statut ne possède pas systématiquement auteur, date, ancienne valeur, nouvelle valeur et motif.

**Correction :** créer un `AuditEvent` append-only et un historique visible par opération. Les données validées ne doivent plus être écrasées silencieusement.

### P0-05 — Suppression physique des produits

**Preuve :** le produit expose une route `DELETE` et un bouton de suppression.

**Risque :** perte de lisibilité historique ou erreur de clé étrangère générique si le produit est déjà utilisé.

**Correction :** remplacer par `actif=false`, avec motif, auteur et date. Réserver la suppression physique aux données de test jamais référencées.

### P0-06 — Aucun mécanisme anti-doublon

**Risque :** double pression, reconnexion mobile ou retry du navigateur peuvent créer deux commandes, ventes ou paiements.

**Correction :** imposer une `idempotencyKey` unique par écriture critique, mémoriser la réponse et réutiliser la même clé lors d’un retry client.

### P0-07 — Argent transporté confondu avec règlement officiel

**Preuve :** le chargé des commandes peut enregistrer directement un règlement qui réduit le solde.

**Risque :** l’argent déclaré comme remis au livreur ou au chargé des commandes réduit la dette avant comptage par la caisse.

**Correction :** distinguer `PaiementDeclare`, `FondsTransportes`, `RemiseCaisse`, `ComptageCaisse` et `PaiementConfirme`. Seul le comptage officiel réduit la dette selon la règle métier validée.

### P0-08 — Aucun circuit de remise contradictoire

**Risque :** production, magasin, livraison et caisse peuvent déclarer des quantités ou montants différents sans conserver les deux versions.

**Correction :** chaque transfert sensible possède un émetteur, un receveur, deux déclarations, une confirmation et éventuellement un écart motivé.

### P0-09 — Les tarifs et commissions client ne sont pas figés

**Preuve :** les commandes relisent le type client et ses paramètres actuels.

**Risque :** changer ultérieurement un prix ou un taux de commission peut modifier la signification historique d’une commande.

**Correction :** snapshot obligatoire du type, prix unitaire, règle de commission, devise et conditions au moment de la livraison facturable.

### P0-10 — Aucun test automatisé ni CI

**Risque :** les corrections de permission, de dette, de clôture ou de notification peuvent régresser sans signal.

**Correction :** installer une base de tests API et domaine, puis un workflow GitHub Actions bloquant sur typecheck, tests, migrations et build.

### P0-11 — Branche principale non protégée

**Risque :** une modification peut être poussée directement sans revue ni vérification.

**Correction :** protéger `main`, exiger pull request, au moins une revue, checks CI et branche à jour.

### P0-12 — Secrets de développement trop permissifs

**Preuve :** secret JWT de repli dans le code, valeur d’exemple faible et mot de passe de démonstration documenté/seedé.

**Risque :** un environnement mal configuré peut démarrer avec des secrets connus.

**Correction :** échec au démarrage si le secret réel manque, suppression des comptes de démonstration du mode production et rotation des identifiants avant pilote.

### P0-13 — Surface web insuffisamment durcie

**Preuve :** CORS global, Socket.io ouvert, JWT dans `localStorage`, absence visible de CSP, rate limiting et en-têtes Helmet.

**Risque :** exposition excessive, vol de jeton en cas de XSS et attaques répétées sur la connexion.

**Correction :** origines autorisées par environnement, cookies `HttpOnly`/`Secure` si l’architecture le permet, CSP, Helmet, limite de débit, rotation/expiration courte et journal de connexion.

### P0-14 — Publications d’événements non garanties

**Preuve :** l’opération métier est validée, puis la notification est tentée séparément ; un échec est seulement journalisé.

**Risque :** une alerte ou tâche critique peut disparaître.

**Correction :** pattern outbox transactionnel avec worker et retry.

### P0-15 — Modèle incomplet pour les devises et les preuves

**Preuve :** les montants sont des entiers sans devise et l’interface affiche essentiellement `Fc`.

**Risque :** impossibilité de rapprocher correctement CDF, USD, espèces et paiements électroniques si plusieurs moyens sont utilisés.

**Correction :** devise explicite, montants entiers dans l’unité minimale, taux de conversion figé si nécessaire, référence externe et pièce justificative.

---

## 6. Écarts majeurs d’utilisabilité

### UX-01 — Accueil non orienté vers le travail

Le tableau de bord affiche surtout les permissions et une activité générale. Il ne répond pas aux questions « que dois-je faire ? », « qu’est-ce qui est bloqué ? » et « qu’est-ce qui attend ma validation ? ».

**À faire :** accueil par rôle avec tâches du jour, opérations bloquées, validations et raccourci vers l’action principale.

### UX-02 — Navigation mobile trop dense

Le menu horizontal contient jusqu’à dix modules et repose sur le défilement horizontal.

**À faire :** maximum cinq entrées principales par rôle sur téléphone : Accueil, À faire, action principale, Notifications, Plus.

### UX-03 — Écrans sous forme de grands tableaux

Le composant de tableau permet le défilement horizontal, mais l’écran Commandes comporte de nombreuses colonnes. Le contenu reste techniquement accessible, sans être réellement utilisable au pouce.

**À faire :** cartes compactes sur mobile, détail progressif, recherche et filtres persistants ; tableaux uniquement à partir du format tablette/ordinateur.

### UX-04 — Cibles tactiles trop petites

Les boutons communs font généralement 32 à 40 px de haut et certains contrôles de quantité de Caisse font environ 28 px.

**À faire :** minimum pratique de 44 × 44 px pour les actions tactiles fréquentes.

### UX-05 — Formulaires en deux colonnes sur petit écran

Certaines fenêtres utilisent deux colonnes sans retour mobile clair.

**À faire :** une colonne sur téléphone, regroupements courts, clavier adapté au type de donnée et barre d’action visible.

### UX-06 — Fenêtres imbriquées

La création d’un client peut être ouverte depuis la fenêtre de création d’une commande.

**Risque :** empilement de modales, retour arrière ambigu et gestion du focus difficile.

**À faire :** panneau ou étape intégrée, avec retour explicite à l’opération en cours.

### UX-07 — États d’erreur incomplets

Certaines mutations n’affichent pas l’erreur. Les actions de notification mettent l’état local à jour puis avalent l’échec réseau, sans rollback. Les états vide, chargement, hors ligne et retry ne sont pas uniformes.

**À faire :** composant commun pour succès, erreur actionnable, vide, chargement et connexion perdue ; rollback des mises à jour optimistes.

### UX-08 — Vocabulaire métier obsolète

« Nombre de bacs reçus » et « commande » mélangent prévision, réception, chargement et livraison.

**À faire :** employer partout Prévision, Quantité chargée, Quantité livrée, Quantité acceptée, Montant facturable, Montant transporté et Montant compté.

### UX-09 — Absence de brouillon durable

Un formulaire non soumis n’est pas conservé après rechargement ou fermeture.

**À faire :** brouillon local chiffré ou persistant pour les parcours terrain, reprise visible et expiration contrôlée.

### UX-10 — Pas de gestion globale des 401

Le client API n’oriente pas systématiquement l’utilisateur vers une reconnexion lorsque le jeton expire.

**À faire :** intercepteur commun, conservation sûre du brouillon, message clair puis reconnexion.

### UX-11 — Logo trop lourd

Le même PNG de 1,99 Mo est utilisé à la connexion et au chargement.

**À faire :** SVG si disponible, sinon WebP/AVIF et tailles adaptées ; réserver l’original à l’impression.

### UX-12 — Actions comptables trop immédiates

La vente caisse peut être validée sans écran récapitulatif, montant reçu ni calcul de monnaie à rendre.

**À faire :** récapitulatif, méthode, devise, montant reçu, monnaie rendue, référence et protection anti-double soumission.

### UX-13 — Clôture libellée « journée » sans vraie journée

Le frontend parle de journée en cours, tandis que l’API prend toutes les ventes non clôturées.

**À faire :** afficher la session réelle, son heure d’ouverture, son caissier et les éléments inclus avant confirmation.

### UX-14 — Affichage des modules non utiles au rôle

Plusieurs modules futurs sont visibles mais grisés.

**À faire :** navigation concentrée sur le rôle ; conserver une page « Plus » seulement pour les fonctions réellement consultables.

### UX-15 — Connexion sans identité visuelle ni récupération de compte

La connexion actuelle est fonctionnelle, mais ne possède ni la scène interactive validée ni un parcours de récupération du mot de passe.

**À faire :** créer une page de connexion Premium propre à Lomoto. La lampe démarre éteinte ; l’utilisateur tire la ficelle au clic, au glissement tactile ou au clavier pour allumer la scène et révéler le formulaire. Le logo apparaît en filigrane derrière la scène, avec une opacité limitée et sans intercepter les interactions. Ajouter l’affichage/masquage du mot de passe et un véritable parcours « Mot de passe oublié ? ».

### UX-16 — Réinitialisation sécurisée du mot de passe absente

**À faire :** prévoir deux parcours : lien ou code temporaire envoyé à l’adresse vérifiée lorsque l’agent possède une boîte accessible ; mot de passe temporaire généré par un administrateur dans le cas contraire. Les jetons doivent être hachés, à durée limitée, à usage unique et soumis à une limitation de fréquence. Après succès, invalider les anciennes sessions, imposer éventuellement un changement à la prochaine connexion et écrire l’événement dans l’audit. La réponse de demande ne doit jamais révéler si une adresse existe.

### UX-17 — Système de notifications visuelles non unifié

**À faire :** introduire un toast Premium commun avec variante succès, erreur, avertissement et information ; icône, titre, message, fermeture, barre de durée et pause accessible. Maximum trois toasts. Les erreurs bloquantes persistent. Le toast confirme l’action immédiate, tandis que le centre de notifications conserve l’historique métier.

### UX-18 — Composants de listes, tableaux et pagination insuffisamment industrialisés

**À faire :** créer une liste Premium en cartes pour téléphone et un tableau Premium pour ordinateur, avec recherche, filtres, tri, badges, actions et sélection contrôlée. Ajouter une pagination serveur avec taille de page, précédent/suivant et conservation des filtres. Ne jamais charger toute une table par défaut.

### UX-19 — Recherche globale absente

**À faire :** recherche Premium accessible depuis l’en-tête et par `Ctrl + K`, avec suggestions, résultats regroupés par module, recherches récentes et navigation clavier. Le serveur ne retourne que les données autorisées au rôle connecté.

### UX-20 — Formulaires et actions sans langage Premium commun

**À faire :** uniformiser le champ de mot de passe, la zone de texte auto-ajustable avec compteur, les boutons d’action, le sélecteur date/heure en français et les états chargement/réussite/erreur/désactivation. Les critères de robustesse du mot de passe s’affichent lors de la création, de la modification et de la réinitialisation, mais pas inutilement sur la connexion.

### UX-21 — Collaboration et historique peu lisibles

**À faire :** ajouter des commentaires Premium rattachés à l’objet métier et un fil d’activité synthétique. Ils ne remplacent pas le journal d’audit : les commentaires permettent la collaboration ; le fil explique l’évolution ; l’audit conserve la preuve complète et non altérable.

### UX-22 — Heure opérationnelle non visible dans l’enveloppe

**À faire :** intégrer une horloge numérique « flip » Premium à l’en-tête global, sans superposition. Sur ordinateur : `HH:MM:SS` et date ; sur téléphone : `HH:MM`, détail au toucher. Utiliser le fuseau `Africa/Kinshasa`, des chiffres à largeur fixe, un composant isolé et une variante sans retournement avec `prefers-reduced-motion`.

### UX-23 — Célébration d’anniversaire non prise en charge

**À faire :** ajouter la date de naissance au profil agent et implémenter la direction visuelle validée « Constellation Lomoto ». Après authentification, chaque utilisateur voit au plus une fois dans la journée la célébration des agents concernés, sans affichage de leur âge. Le serveur mémorise l’affichage par utilisateur et par date Lomoto. Plusieurs anniversaires sont regroupés. Prévoir fermeture immédiate, accessibilité, version légère et absence de blocage du travail.

### 6.1 Règle de direction visuelle validée

Tous les composants structurants utilisent une version Premium cohérente avec l’identité Lomoto : bleu marine, or, crème, terracotta et couleurs d’état. Le niveau Premium signifie meilleure hiérarchie, clarté, retour d’état et accessibilité ; il ne justifie jamais une animation lente ou décorative qui gêne la saisie. Les animations sont courtes, tactiles, compatibles clavier et désactivables.

---

## 7. Écarts techniques et de maintenabilité

| ID | Constat | Priorité | Action |
|---|---|---:|---|
| T-01 | Aucun script `test` ou `lint` | P0 | Ajouter tests, lint et CI |
| T-02 | API démarrée avec `tsx` sans build serveur explicite | P1 | Produire un artefact compilé et reproductible |
| T-03 | Listes non paginées | P1 | Pagination curseur, filtres et limites serveur |
| T-04 | Paramètres de date peu validés | P0 | Schémas Zod et erreurs 400 explicites |
| T-05 | Transaction sérialisable sans retry | P0 | Retry borné sur conflits Prisma/PostgreSQL |
| T-06 | Pas de contraintes DB sur quantités/montants négatifs | P0 | Ajouter `CHECK` dans migrations SQL |
| T-07 | Pas de request ID ni logs structurés | P1 | Corrélation requête/opération/utilisateur |
| T-08 | Pas de monitoring ni alerte d’erreur | P1 | Collecte serveur/frontend et alertes |
| T-09 | Pas de stratégie de sauvegarde/restauration testée | P0 | Procédure + test de restauration avant pilote |
| T-10 | Pas d’Error Boundary frontend | P1 | Écran de récupération sans perte du brouillon |
| T-11 | Événements envoyés à tous les utilisateurs d’un rôle | P1 | Affectation nominative ou groupe explicitement configuré |
| T-12 | `roomRole` joint mais peu exploité | P2 | Supprimer ou intégrer dans une politique d’événements claire |
| T-13 | `estAdminPrincipal` absent du DTO utilisateur | P1 | Exposer seulement si nécessaire aux validations admin |
| T-14 | Lien README vers `docs/spec.md` inexistant | P1 | Corriger vers `docs/spec-boulangerie.md` |
| T-15 | Spécification du dépôt en conflit avec le circuit validé | P0 | Ajouter une spec v2 faisant autorité |
| T-16 | Aucun jeton ni parcours de réinitialisation du mot de passe | P0 | Jetons hachés, expiration, usage unique, rate limiting et révocation de sessions |
| T-17 | Date de naissance et historique d’affichage anniversaire absents | P1 | Ajouter les données minimales et les protéger par permissions |
| T-18 | Pas de bibliothèque de composants Premium commune | P1 | Créer des composants réutilisables, documentés et testés visuellement |
| T-19 | Dates et fuseau non centralisés | P0 | Fournir une source serveur cohérente pour `Africa/Kinshasa` et tester les frontières de jour |

---

## 8. Table de correspondance métier

| Besoin Lomoto | Existant | Écart | Décision |
|---|---|---|---|
| Prospect | Aucun | Impossible de préparer et suivre la prospection | Créer fiche prospect et historique |
| Programme de visites | Aucun | Pas de travail quotidien commercial | Créer programme du jour |
| Validation dépositaire | Création directe de client | Aucun contrôle ni conditions | Ajouter dossier et validation |
| Conditions acceptées | Aucun | Première livraison non protégée | Signature/confirmation obligatoire |
| Prévision client | `CommandeClient` | Devient immédiatement financière | Créer `PrevisionClient` non comptable |
| Consolidation des prévisions | Aucun | Production sans source unique | Créer plan de production dérivé |
| Lot de production | Aucun | Pas de rendement ni traçabilité | Créer lot avec référence |
| Matières demandées/sorties/retournées | Aucun | Stock non rapprochable | Créer mouvements liés au lot |
| Pertes réelles | Aucun | Clôture de lot invérifiable | Saisie obligatoire et motif |
| Contrôle qualité | Aucun | Produit non libérable formellement | Créer contrôle et décision |
| Remise Production–Magasin | Aucun | Pas de double confirmation | Créer transfert contradictoire |
| Préparation tournée | Aucun | Quantité chargée non prouvée | Créer tournée et lignes de chargement |
| Livraison acceptée | Confondue avec commande | Facturation trop tôt | Confirmation client/livreur |
| Retour/invendu | Aucun | Écarts de tournée invisibles | Créer typologie et décision |
| Montant facturable | Montant de commande | Mauvais événement déclencheur | Calculer depuis accepté |
| Paiement déclaré | Règlement commande | Réduit directement la dette | Créer état déclaré/transporté |
| Remise Commandes–Caisse | Aucun | Pas de comptage contradictoire | Créer remise le jour même |
| Vente comptoir | `Vente`/`LigneVente` | Bonne base, clôture insuffisante | Conserver et renforcer |
| Clôture de caisse | `ClotureCaisse` | Pas de session ni comptage | Reconcevoir |
| Commission | Calcul actuel | Paramètres non figés, flux non stabilisé | Geler en P2 |
| Validations | Notifications seulement | Pas de décision formelle | Créer tâches d’approbation |
| Anomalies et écarts | Aucun | Différences perdues dans les commentaires | Créer registre central |
| Journal d’audit | Activité/notifications | Ce n’est pas un audit immuable | Créer audit append-only |

---

## 9. Modèle cible minimum

Le nom exact des tables pourra évoluer, mais les concepts suivants doivent rester séparés.

### 9.1 Référentiels

- `User`, `Role`, `Permission`, `Delegation` ;
- `Product`, `RecipeVersion`, `Material`, `Unit`, `WarehouseLocation` ;
- `Client`, `Prospect`, `ClientTypeVersion`, `CommercialConditionVersion` ;
- `VehicleOrRouteResource`, `PaymentMethod`, `Currency`.

### 9.2 Commercial et Commandes

- `CommercialVisit` ;
- `ClientValidationRequest` ;
- `ConditionAcceptance` ;
- `ClientForecast` et ses versions ;
- `ForecastConsolidation`.

### 9.3 Production, Stock et Qualité

- `ProductionPlan` ;
- `ProductionBatch` ;
- `MaterialRequest` ;
- `StockMovement` lié au lot et au mouvement d’origine ;
- `ProductionActual` ;
- `ProductionLoss` ;
- `QualityControl` ;
- `ProductionStoreHandoff`.

### 9.4 Magasin et Livraison

- `DeliveryTour` ;
- `TourLoadingLine` ;
- `DeliveryAttempt` ;
- `DeliveryAcceptance` ;
- `DeliveryReturn` ;
- `TourReconciliation`.

### 9.5 Finance et Caisse

- `Receivable` créé depuis l’acceptation ;
- `PaymentDeclaration` ;
- `CashInTransit` ;
- `CashHandoff` ;
- `CashCount` ;
- `CashSession` ;
- `CashClosure` ;
- `Expense` et justificatif.

### 9.6 Contrôle transversal

- `ApprovalTask` ;
- `Anomaly` ;
- `AuditEvent` ;
- `OperationReference` ;
- `IdempotencyRecord` ;
- `OutboxEvent` ;
- `Attachment`.

Chaque objet opérationnel doit porter au minimum : référence lisible, statut, auteur, dates, responsable courant, version, établissement éventuel et lien vers son historique.

---

## 10. Architecture d’état recommandée

Ne pas utiliser un unique champ libre pour couvrir tous les parcours. Définir des transitions serveur explicites.

Exemple pour une livraison :

`PLANIFIEE → CHARGEE → EN_TOURNEE → PRESENTEE → ACCEPTEE_PARTIELLEMENT ou ACCEPTEE → RAPPROCHEE → CLOTUREE`

Branches d’exception :

`ABSENT`, `REFUSEE`, `QUALITE_CONTESTEE`, `BON_MANQUANT`, `ECART_A_TRAITER`.

Règles :

- aucune transition ne se fait uniquement dans le frontend ;
- le serveur vérifie le rôle, l’état précédent et les prérequis ;
- une correction n’efface pas l’état précédent ;
- une transition sensible possède motif et éventuellement double confirmation ;
- la référence de l’opération est visible à l’utilisateur.

---

## 11. Plan d’attaque recommandé

### Lot 0 — Sécuriser l’existant avant extension

Objectif : empêcher que la base actuelle produise des erreurs silencieuses pendant la refonte.

1. rendre les actions de notification cohérentes en cas d’échec réseau ;
2. empêcher la clôture globale de toutes les ventes ;
3. remplacer la suppression produit par désactivation ;
4. valider toutes les dates et entrées API ;
5. ajouter idempotence sur ventes, commandes et règlements ;
6. supprimer le secret JWT de repli et les identifiants démo en production ;
7. configurer CORS, Helmet, rate limiting et gestion d’erreur structurée ;
8. ajouter tests automatisés et CI ;
9. protéger la branche `main` ;
10. documenter sauvegarde et restauration.

**Critère de sortie :** tous les défauts P0 existants ont un test de non-régression.

### Lot 1 — Fonder le nouveau domaine sans casser les données actuelles

Objectif : créer les primitives transversales utilisées par tous les modules.

1. publier `docs/spec-lomoto-v2.md` comme source fonctionnelle faisant autorité ;
2. ajouter références d’opération, audit, anomalies, validations, pièces jointes ;
3. ajouter idempotency et outbox ;
4. ajouter devise et snapshots de prix/conditions ;
5. définir les machines d’état et les permissions d’action ;
6. marquer les commandes historiques comme données héritées sans les convertir automatiquement ;
7. créer un écran d’historique commun.
8. centraliser le fuseau opérationnel `Africa/Kinshasa` et les formats de date ;
9. ajouter la date de naissance facultative au profil agent avec permissions de consultation limitées ;
10. créer le mécanisme de jeton de réinitialisation, révocation de sessions et changement obligatoire du mot de passe ;
11. créer la trace serveur des célébrations déjà affichées à chaque utilisateur.

**Critère de sortie :** toute nouvelle opération possède référence, état, historique et protection anti-doublon.

### Lot 2 — Refaire l’enveloppe d’utilisation

Objectif : rendre l’application compréhensible avant d’ajouter les parcours complets.

1. navigation par rôle ;
2. accueil avec tâches du jour ;
3. pages `À faire`, `Mes validations`, `Anomalies et écarts` ;
4. composants communs d’états et de messages ;
5. cartes mobiles à la place des tableaux trop larges ;
6. champs et boutons tactiles d’au moins 44 px ;
7. gestion hors ligne, brouillon et reprise ;
8. optimisation du logo ;
9. vocabulaire Lomoto officiel.
10. nouvelle connexion à lampe, logo en filigrane et variante sans animation ;
11. parcours Mot de passe oublié, définition du nouveau mot de passe et mot de passe temporaire administrateur ;
12. bibliothèque Premium commune : toast, boutons, champs, zone de texte, date/heure, listes, tableaux et pagination ;
13. recherche globale Premium filtrée par permissions ;
14. commentaires, fil d’activité et distinction claire avec l’audit ;
15. horloge « flip » compacte dans l’en-tête global ;
16. célébration « Constellation Lomoto » à la première connexion du jour concerné.

**Critère de sortie :** chaque rôle atteint son action principale en cinq actions ou moins sur téléphone ; la connexion et la récupération de compte sont complètes ; les composants Premium sont communs plutôt que recopiés ; aucune animation ne recouvre le contenu, ne bloque le clavier ou ne dégrade le parcours sans mouvement.

### Lot 3 — Commercial et validation du client

Objectif : empêcher la transformation automatique d’un prospect en client actif.

1. fiche prospect ;
2. programme et compte rendu de visites ;
3. demande de validation du dépositaire ;
4. conditions commerciales versionnées ;
5. acceptation avant première livraison ;
6. réclamations liées au client, à la livraison et au lot ;
7. statut actif/inactif/perdu/récupéré avec historique.

**Critère de sortie :** un prospect non validé ne peut pas recevoir de livraison facturable.

### Lot 4 — Prévisions, Production, Stock et Qualité

Objectif : obtenir une chaîne traçable entre demande et produit remis au magasin.

1. prévision client non financière ;
2. consolidation et plan de production ;
3. lot de production avec version de recette ;
4. demandes, sorties et retours de matières ;
5. quantités réelles, pertes et motifs ;
6. contrôle qualité ;
7. remise contradictoire Production–Magasin ;
8. blocage de clôture tant que les preuves manquent.

**Critère de sortie :** aucun lot ne se clôture sans production réelle, pertes, qualité et remise confirmée.

### Lot 5 — Magasin, Tournées et Livraison acceptée

Objectif : créer le véritable événement facturable.

1. préparation et chargement de tournée ;
2. double confirmation du chargement ;
3. tentative de livraison ;
4. quantité acceptée, refusée ou retournée ;
5. preuve/signature ou motif ;
6. rapprochement de tournée ;
7. création de la créance uniquement depuis l’acceptation ;
8. traitement des écarts avant clôture.

**Critère de sortie :** une livraison partielle ne facture que la quantité acceptée.

### Lot 6 — Paiements, fonds transportés et Caisse

Objectif : séparer déclaration, transport et comptage officiel.

1. déclaration de paiement ;
2. fonds transportés sans effet immédiat sur la dette ;
3. remise Commandes–Caisse le jour même ;
4. comptage contradictoire ;
5. rapprochement par devise et moyen ;
6. sessions de caisse nominatives ;
7. dépenses et justificatifs ;
8. clôture avec théorique, compté, écart et motif ;
9. correction après clôture avec droit spécial.

**Critère de sortie :** aucune dette ne diminue sur la seule déclaration d’un transporteur.

### Lot 7 — Pilotage après stabilisation

Objectif : exploiter des données fiables, sans inventer de précision.

1. rapports quotidiens par rôle ;
2. alertes de retard et seuil ;
3. inventaires et achats occasionnels ;
4. exports et impressions ;
5. suivi commercial J+1 à J+30 ;
6. commissions versionnées seulement après validation de la règle ;
7. indicateurs avancés en dernier.

---

## 12. Premier lot concret à confier à Claude Code

Le premier lot d’implémentation doit rester petit et vérifiable. Il ne doit pas encore créer tout le circuit métier.

### PR 1 — Filet de sécurité

- ajouter Vitest ou Jest/Supertest pour l’API ;
- ajouter les tests de permissions existantes ;
- tester `/notifications/lu`, les erreurs réseau et le rollback de l’état local ;
- reproduire et tester la clôture multi-caissiers ;
- ajouter le pipeline CI ;
- ne modifier aucun montant historique.

### PR 2 — Correctifs critiques de l’existant

- corriger Notifications ;
- scoper la clôture à une vraie session de caisse ;
- archiver les produits ;
- ajouter validation des dates et réponses 400 ;
- ajouter idempotence sur les trois créations financières actuelles ;
- ajouter messages d’erreur frontend avec rollback.

### PR 3 — Fondations transversales

- migration `OperationReference`, `AuditEvent`, `Anomaly`, `ApprovalTask`, `IdempotencyRecord`, `OutboxEvent` ;
- service serveur de transition et d’audit ;
- composants frontend Historique, État, Blocage et Réessayer ;
- tests de concurrence et de permission.

### PR 4 — Navigation utilisable

- menu par rôle ;
- navigation téléphone sans défilement horizontal ;
- accueil par rôle ;
- page À faire ;
- cibles tactiles de 44 px ;
- cartes mobiles pour Commandes et Caisse ;
- optimisation du logo.

### PR 5 — Authentification Premium et récupération de compte

- ajouter le stockage sécurisé des jetons de réinitialisation et la révocation des sessions ;
- implémenter demande, validation et consommation du lien ou code temporaire ;
- implémenter le mot de passe temporaire administrateur avec changement obligatoire ;
- créer la page de connexion à lampe et son filigrane Lomoto ;
- ajouter affichage/masquage et indicateur de robustesse aux parcours concernés ;
- tester clavier, tactile, expiration, réutilisation du jeton, enumeration d’adresses et limitation de fréquence.

### PR 6 — Système de composants Premium

- créer les composants Toast, Button, PasswordField, AutoTextarea, DateTimePicker, PremiumList, PremiumTable et Pagination ;
- intégrer les quatre variantes d’état Lomoto ;
- rendre listes et pagination compatibles avec les paramètres serveur ;
- ajouter les états vide, chargement, hors ligne et retry ;
- vérifier les cibles tactiles, contrastes, focus et `prefers-reduced-motion`.

### PR 7 — Enveloppe Premium et célébration

- intégrer la recherche globale avec contrôle des permissions ;
- intégrer l’horloge compacte sans rafraîchir l’arbre applicatif entier ;
- ajouter la date de naissance au profil agent avec accès restreint ;
- implémenter « Constellation Lomoto » et la trace d’affichage côté serveur ;
- regrouper plusieurs anniversaires et ne jamais afficher l’âge ;
- tester fuseau de Kinshasa, première connexion, multi-appareils et version allégée.

Après ces sept PR, le développement du nouveau circuit peut commencer dans l’ordre Commercial → Prévision → Production/Stock → Magasin/Livraison → Caisse.

---

## 13. Fichiers existants principalement concernés

| Zone | Fichiers actuels | Décision |
|---|---|---|
| Contrats | `packages/shared/src/index.ts` | Découper par domaine et versionner les schémas |
| Schéma | `prisma/schema.prisma` | Étendre par migrations additives |
| Initialisation | `prisma/seed.ts` | Séparer démo et production |
| Permissions | `apps/api/src/middleware/auth.ts` | Conserver et ajouter permissions d’action |
| Événements | `apps/api/src/lib/events.ts`, `services/notifications.ts` | Passer à outbox fiable |
| Commandes | `apps/api/src/routes/commandes.ts` | Maintenir en legacy puis remplacer progressivement |
| Caisse | `apps/api/src/routes/caisse.ts` | Corriger immédiatement puis introduire sessions/remises |
| Notifications | `apps/api/src/routes/notifications.ts`, `apps/web/src/lib/socket.tsx` | Retourner un résultat vérifiable et gérer erreur/rollback |
| Produits | `apps/api/src/routes/produits.ts` | Supprimer le hard delete |
| Auth frontend | `apps/web/src/lib/auth.tsx`, `api.ts` | Reconnexion, gestion 401 et stockage sûr |
| Routage | `apps/web/src/App.tsx` | Ajouter routes rôle/tâches/validations |
| Navigation | `apps/web/src/components/Layout.tsx` | Refaire desktop/mobile par rôle |
| Dashboard | `apps/web/src/pages/Dashboard.tsx` | Transformer en accueil de travail |
| Commandes | `apps/web/src/pages/Commandes.tsx` | Cartes mobiles et nouveau vocabulaire |
| Caisse | `apps/web/src/pages/Caisse.tsx` | Session, remise, comptage et récapitulatif |
| UI partagée | `apps/web/src/components/ui/*` | Tailles tactiles, états et accessibilité |
| Styles | `apps/web/src/index.css` | Tokens d’état, responsive, contraste |
| Documentation | `docs/spec-boulangerie.md`, `README.md` | Publier la v2 et corriger le lien cassé |

---

## 14. Stratégie de migration des données

Ne jamais faire une migration qui transforme silencieusement toutes les anciennes commandes en livraisons acceptées.

1. sauvegarder la base et tester la restauration ;
2. ajouter les nouvelles tables sans supprimer les anciennes ;
3. ajouter un indicateur `legacy` et une référence aux anciennes commandes ;
4. figer dans les enregistrements historiques le prix, type client et commission connus ;
5. produire un rapport des lignes ambiguës ;
6. faire valider les règles de conversion par Lomoto ;
7. convertir uniquement les cas prouvés ;
8. conserver les autres comme écritures historiques consultables ;
9. basculer les nouvelles opérations vers le modèle v2 ;
10. supprimer les anciennes écritures seulement après une période de double lecture et une validation formelle.

---

## 15. Tests obligatoires

### 15.1 Tests unitaires métier

- une prévision ne crée aucune créance ;
- une quantité acceptée partiellement facture uniquement cette quantité ;
- le montant transporté ne réduit pas la dette ;
- le comptage confirmé réduit la dette une seule fois ;
- une modification tarifaire ne change pas l’historique ;
- un produit archivé reste visible dans les écritures historiques ;
- les transitions impossibles sont refusées.

### 15.2 Tests API et permissions

- chaque écriture réussit pour le rôle autorisé ;
- la même écriture échoue en appel direct pour les rôles interdits ;
- un compte désactivé est refusé ;
- une clé d’idempotence répétée ne crée pas de doublon ;
- deux requêtes concurrentes n’encaissent pas deux fois ;
- un caissier ne clôture pas la session d’un autre ;
- une date invalide retourne 400 ;
- `/notifications/lu` modifie bien toutes les notifications du demandeur.

### 15.3 Tests frontend

- états chargement, vide, succès, erreur, hors ligne et retry ;
- conservation du brouillon après coupure ;
- restauration correcte après reconnexion ;
- navigation clavier et focus des fenêtres ;
- aucune action critique sous 44 × 44 px sur mobile ;
- aucune tâche critique n’exige un tableau horizontal ;
- expiration de session avec reprise du brouillon.

### 15.4 Tests bout en bout

- prospect jusqu’à première livraison ;
- prévision jusqu’à lot clôturé ;
- remise Production–Magasin avec différence ;
- tournée avec livraison partielle et retour ;
- paiement remis et compté le jour même ;
- écart de caisse empêchant la clôture normale ;
- correction après clôture avec motif et audit ;
- restauration d’une sauvegarde et contrôle des références.

---

## 16. Critères de mise en pilote

Le pilote est autorisé seulement si :

- les données de démonstration sont supprimées ou clairement isolées ;
- tous les P0 ont un responsable et un test ;
- `main` est protégée ;
- CI, sauvegarde et restauration réussissent ;
- les permissions sont testées côté API ;
- le circuit prévision → livraison acceptée → caisse ne confond plus ses états ;
- aucune clôture ne mélange caissiers, sessions ou devises ;
- chaque transfert critique possède deux confirmations ou un écart ;
- le téléphone permet d’effectuer les tâches sans zoom ;
- au moins un utilisateur réel de chaque rôle pilote réussit son parcours principal ;
- une procédure papier de secours et de resynchronisation est définie.

---

## 17. Ce qu’il ne faut pas faire maintenant

- ne pas réécrire l’application entière ;
- ne pas ajouter des tableaux de bord complexes sur des données non fiables ;
- ne pas automatiser les commissions avant de stabiliser livraison et paiement ;
- ne pas convertir automatiquement les commandes existantes en livraisons acceptées ;
- ne pas cacher les modules manquants derrière des boutons décoratifs ;
- ne pas confondre notification et validation formelle ;
- ne pas corriger un écart en écrasant l’ancienne valeur ;
- ne pas utiliser uniquement les contrôles frontend pour les permissions ;
- ne pas démarrer tous les modules en parallèle ;
- ne pas annoncer une fonctionnalité « terminée » sans test mobile, permission et historique.

---

## 18. Prompt prêt à coller dans Claude Code

```text
Tu travailles sur le dépôt kayboxstore/Boulangerie.

Lis intégralement, sans modifier le code :
1. PLAN_ATTAQUE_APPLICATION_LOMOTO.md ;
2. Plan_amelioration_utilisabilite_application_Lomoto.md ;
3. README.md et docs/spec-boulangerie.md ;
4. package.json et les package.json des workspaces ;
5. packages/shared/src/index.ts ;
6. prisma/schema.prisma, toutes les migrations et prisma/seed.ts ;
7. tout apps/api/src ;
8. tout apps/web/src et apps/web/index.html.

La spécification Lomoto v2 et le plan d’attaque font autorité lorsqu’ils contredisent l’ancienne spec. Ne réécris pas le projet et ne développe encore aucune fonction P1 ou P2.

Commence par confirmer l’état exact du dépôt, la branche et le commit. Lance ensuite les commandes existantes de typecheck/build, mais ne prétends pas que des tests existent s’il n’y en a pas.

Produis un plan d’implémentation du Lot 0 uniquement, découpé en petites pull requests. Pour chaque PR, donne :
- objectif métier ;
- fichiers à modifier ou créer ;
- migration éventuelle ;
- changement d’API ;
- risques de données ;
- tests à ajouter ;
- critères d’acceptation ;
- stratégie de retour arrière.

Le plan doit au minimum traiter :
- la gestion d’erreur et le rollback des actions de notification ;
- la clôture de caisse qui prend toutes les ventes non clôturées ;
- la suppression physique des produits ;
- la validation des dates et les erreurs API ;
- l’idempotence des écritures financières ;
- les secrets et comptes de démonstration ;
- CORS, Helmet et rate limiting ;
- les tests automatisés, la CI et la protection de main ;
- la sauvegarde/restauration.

Les exigences Premium validées dans la version 1.1 appartiennent aux PR 5 à 7. Ne les mélanges pas au Lot 0 avant validation des PR 1 à 3, sauf lorsqu’un composant minimal est nécessaire pour rendre un correctif P0 compréhensible.

Ne modifie aucun montant historique. Ne transforme aucune CommandeClient existante en livraison acceptée. Arrête-toi après le plan et attends ma validation avant de coder.
```

---

## 19. Conclusion

La base actuelle peut être conservée. Les choix Premium validés font désormais partie du produit, mais ils doivent reposer sur une sécurité, des données et des composants communs solides. Le premier enjeu est d’empêcher les faux soldes, les clôtures mélangées et les opérations dupliquées. Le deuxième est de livrer une authentification complète et une enveloppe Premium utilisable. Le troisième est de relier toutes les étapes métier par des références, confirmations et historiques.

L’ordre recommandé est donc :

> Sécuriser l’existant → créer audit/états/idempotence → construire l’authentification et l’enveloppe Premium → Commercial → Prévisions → Production/Stock/Qualité → Magasin/Livraisons → Paiements/Caisse → Pilotage.

Le prochain geste concret n’est pas de coder l’ensemble du produit. C’est de faire traiter par Claude Code le **Lot 0**, PR par PR, avec tests et critères d’acceptation, puis de valider les résultats avant de poursuivre.
