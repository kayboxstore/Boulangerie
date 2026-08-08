# Plan détaillé — Le Livre Boulangerie Lomoto

> Ce document précise, pour chaque volume, les sous-sections prévues. Il se lit comme un plan de rédaction — le contenu réel est dans `volumes/`. Les cases à cocher sont mises à jour au fil de la rédaction.

## Volume 1 — Présentation du produit et du problème résolu ✅
- Le contexte : une boulangerie, ses circuits de vente (Dépositaires, Mamans, Vente cash), sa paie
- Le problème avant l'application (suivi papier, section « Schéma de commande », « Bon de livraison »)
- Ce que l'application remplace et ce qu'elle ajoute
- Vue d'ensemble des modules (une phrase par module)
- Public visé par ce livre et prérequis de lecture

## Volume 2 — Guide de lecture et notions fondamentales ✅
- Comment ce livre est organisé et comment y naviguer
- Notions transversales utilisées partout : rôle, permission (`Module` × `NiveauAcces`), DTO, monorepo, workspace npm
- Conventions de nommage rencontrées dans le code (français assumé pour les identifiants métier)
- Comment lire un extrait de code annoté dans ce livre

## Volume 3 — Technologies, langages et dépendances ✅
- TypeScript : pourquoi, comment il est utilisé ici (mode strict, ESM)
- Back-end : Node.js, Express, Prisma, PostgreSQL, Socket.io, JWT, bcrypt, Zod, PDFKit, Nodemailer, node-cron
- Front-end : React 19, Vite, Tailwind CSS 4, Radix UI, TanStack Query, react-router-dom, i18next, Recharts, Framer Motion
- Outils : npm workspaces, Vitest, tsx
- Pourquoi ces choix (déductions du code, jamais des suppositions non fondées)

## Volume 4 — Installation de l'environnement ⬜
- Prérequis (Node, PostgreSQL, versions)
- Étapes depuis `README.md`, vérifiées contre le code
- Résolution des erreurs d'installation courantes

## Volume 5 — Configuration et variables d'environnement ⬜
- Rôle de chaque variable de `.env.example` (jamais sa valeur)
- Variables obligatoires vs optionnelles, avec repli documenté (ex. `JWT_SECRET`)
- Spécificités Render (`render.yaml`)

## Volume 6 — Architecture générale ⬜
- Schéma Mermaid de l'architecture globale (client/serveur/base/Socket.io/services externes)
- Le monorepo et la circulation d'un type depuis `packages/shared` jusqu'au rendu React
- Séparation des responsabilités (routes → services → Prisma)

## Volume 7 — Arborescence détaillée du projet ⬜
- Explication dossier par dossier, avec renvoi vers `INVENTAIRE_DU_PROJET.md` pour le détail fichier par fichier

## Volume 8 — Cycle de démarrage de l'application ⬜
- Démarrage du serveur API (`index.ts` → `app.ts` → routers → écoute HTTP)
- Démarrage du frontend (`main.tsx` → `App.tsx` → écran de démarrage → connexion)
- Diagramme de séquence Mermaid

## Volume 9 — Interface utilisateur et composants ⬜
- Système de design (Tailwind + Radix + composants `ui/`)
- Vue mobile (`CarteLigne`) vs vue desktop (`Table`)
- Inventaire commenté des composants réutilisables (Niveau 2/3)

## Volume 10 — Navigation et gestion de l'état ⬜
- `App.tsx` : arbre de routes, gardes `RequiertLecture`/`RequiertEcriture`
- TanStack Query : clés de requête, invalidation, cache
- État local vs état serveur

## Volume 11 — Back-end, services et règles métier 🟡
Voir découpage détaillé dans `TABLE_DES_MATIERES.md` (chapitres `11a` à `11z`). Chaque chapitre Niveau 1 suit le canevas pédagogique complet du mandat (intuitif → technique → code → exécution → exemple chiffré → erreurs fréquentes → résumé).

### 11a — Noyau financier et permissions ✅
- `calculerCommande` : formule, cas limites, exemple chiffré (repris de la spec section 3.4)
- `avanceAvantCommande`
- `calculerDepenseFarine` : formule, exemple chiffré (section 3.1)
- `aAcces` : table de vérité complète

### 11b — Authentification et permissions bout en bout ✅
- `lib/jwt.ts` : `signToken`, `verifyToken`, garde de démarrage sur `JWT_SECRET`
- `middleware/auth.ts` : `requireAuth`, `requirePermission`, `chargerUtilisateur` (fusion permissions + délégations + bump Admin Principal), garde-fou de transparence de l'Admin Principal
- `lib/auth.tsx` (frontend) : `AuthProvider`, cycle de vie du jeton, `deconnexionForcee`
- `lib/api.ts` (frontend) : intercepteur de requêtes, gestion du 401 `SESSION_REMPLACEE`
- Diagramme de séquence Mermaid : de la saisie du mot de passe à une requête protégée, y compris le cas de session remplacée

### 11c — Connexion ✅
- `routes/auth.ts` : `POST /login` (bcrypt, prévention de l'énumération de comptes, session unique, notification temps réel de l'appareil déconnecté), `POST /mot-de-passe`, routes publiques `/etat-initial` et `/langue-defaut`
- `pages/Login.tsx` : délégation à `useAuth().login`, affichage du message de session remplacée
- Diagramme de séquence Mermaid : connexion avec déconnexion d'un appareil concurrent

### 11d — Équipe, rôles et permissions ✅
- `verifierQuotaAdmins` (max 3 comptes Administrateur)
- `POST /equipe` : création liée à une fiche Travailleur (pas d'e-mail libre), aiguillage compte ordinaire vs Admin
- `PUT /equipe/:id/activation`, `PUT /equipe/:id` (réaffectation, notification temps réel)
- `POST /equipe/:id/principal` : mécanisme actuel **et** historique complet de la faille de sécurité corrigée (élévation de privilège)
- `DELETE /equipe/:id`
- `routes/roles.ts` : matrice de permissions, écart repéré (aucune UI pour `PUT /:id/permissions`)
- `pages/Equipe.tsx` : mutations, `messageApprobation`, gating du bouton « Rendre Principal »
- Diagramme d'état Mermaid du statut Admin Principal

### 11e — Délégations temporaires de rôle ✅
- `delegationsRouter` (`GET /`, `POST /`, `DELETE /:id`) : garde d'accès, pourquoi ce n'est pas une tâche critique
- `versDTO` : calcul de l'état `active` par comparaison lexicographique de chaînes ISO (même ruse qu'au 11b passe 3)
- `delegationCreateSchema` : validation des dates, `.refine()` fin ≥ début
- Cas limites : chevauchement non contrôlé, révocation sans vérification de propriété, plafond de 100 résultats
- Encart dédié dans `Equipe.tsx` (pas d'écran séparé)
- Écart repéré : aucun — mais clarification d'une question laissée ouverte par la spec elle-même (un seul module par délégation)

### 11f — Approbations et actions critiques ✅
- `EXECUTEURS` : une seule implémentation par tâche critique, rejouée à l'identique qu'elle soit immédiate ou différée (revérification systématique de l'état à l'exécution)
- Les 5 tâches en détail : `SUPPRIMER_UTILISATEUR`, `CREER_COMPTE_ADMIN`, `MODIFIER_TYPE_CLIENT`, `MODIFIER_TAUX_TAXE` (gating conditionnel côté route), `MODIFIER_PERMISSIONS_ROLE` (remplacement complet de la matrice, repli technique `["CAISSE"]` pour `notIn`)
- `traiterActionCritique` : aiguillage direct (Admin Principal) vs `DemandeApprobation` + notification temps réel (Admin secondaire)
- `approbationsRouter` : file scoping par rôle, approbation avec revérification et gestion d'échec sans rejet automatique, rejet
- `ApprobationsPage` : polling 20s en complément du temps réel, invalidation croisée des caches
- Exemple chiffré complet : commission Maman 1650 → 1800 Fc, du déclenchement à l'approbation
- Écart repéré : aucun — deux nuances de granularité expliquées (Qualité entière vs prix/commission ; regroupement de champs sur `MODIFIER_TAUX_TAXE`)

### 11g — Journal d'audit ✅
- `contexteRequete.ts` : `AsyncLocalStorage`, ouvert par `requireAuth` (11b), lu par l'extension d'audit
- `lib/prisma.ts` : client `base` vs client `prisma` étendu, seul point d'instanciation de `PrismaClient`
- `MODELE_MODULE` : quels modèles sont audités et pourquoi (Notification, AuditLog, SauvegardeBase exclus)
- `normaliser`/`alignerCles` : expurgation des champs sensibles (`CLE_SENSIBLE`), alignement du diff
- `extensionAudit` : interception `update`/`delete` sur `$allModels`, lecture « avant » via le client `base` (pas de récursion), échec de journalisation non bloquant
- `auditRouter` : lecture seule, filtres utilisateur/module/période, immuabilité garantie par l'absence de route d'écriture
- `AuditPage` : filtres, diff dépliable calculé côté client (`champsPertinents`)
- Exemple chiffré (suite du 11f) : qui apparaît comme auteur d'une action critique différée puis approuvée — l'approbateur, pas le demandeur initial
- Écart repéré : aucun

### 11h — Commandes ✅
- `bornesDuJour`, `GET /resume-jour` (tableau de bord journalier), `GET /livraisons-du-jour` (pré-remplissage optionnel)
- `verifierAlertesDette` : vérification paresseuse, compare-and-set via `updateMany` gardé (jamais deux notifications)
- `GET /` : liste filtrée, sans pagination (constat, pas un correctif)
- `POST /` : les 3 cas (création, conflit, mise à jour avec Modifier/Remplacer), transaction `Serializable`, refus de Remplacer sur commande réglée, `avanceAvantCommande` enfin appliquée en pratique
- `POST /:id/reglements` : reconstruction du prix unitaire d'origine, logique différentielle (`deltaAvance`) pour ne pas écraser l'avance déjà mouvementée par d'autres commandes
- Côté client : `calculerCommande` réutilisée telle quelle pour l'aperçu instantané (bénéfice concret du monorepo), dialogue de conflit piloté par le `409` structuré du serveur
- Exemple chiffré : reprise exacte de l'exemple « commande n°12 » de la spec (50→60 bacs Modifier vs 10 bacs Remplacer)
- Écart repéré : aucun
- Hors périmètre (renvoyé au Volume 18, Niveau 2) : fiche Client, Schéma de commande, Bon de livraison, Zones de dépôt

### 11i — Commissions ✅
- Aucune table dédiée : « vue dérivée » recalculée à chaque lecture depuis `CommandeClient` (filtre `commissionParBac > 0`, plus générale que le seul nom « Maman »)
- `montantTotalPaye` : nuance financière (commande soldée via avance = affichée payée à 100 %) avec exemple chiffré repris du 11a
- `CommissionsPage` : lecture seule, aucune mutation ; export via `BarreExport` (détaillé au Volume 18)
- Écart repéré : aucun

### 11j — Caisse ✅
- Deux techniques de bornage de date (`dateSQL` pour les colonnes `@db.Date`, `bornesLocales` pour les `DateTime`) et pourquoi elles coexistent
- `construireRegistre` : disjonction Entrées/Dettes payées par soustraction (`montantRecu − règlements`), exemple chiffré ; solde ; blocage farine à deux niveaux (taux puis production)
- `sacsUtilisesLe` : seul pont en lecture vers le module Production
- `PUT /taux` (upsert manuel sur date unique), dépenses manuelles, `PUT /depenses/farine` (cocher/décocher comme une seule opération, figeage du taux/sacs sur la ligne créée)
- Côté client : tuile `Poste` avec alerte rouge sur solde négatif, réutilisation de `calculerDepenseFarine` pour l'estimation
- Écart repéré : aucun

### 11k ⬜ *(prochain chapitre : 11k — Travailleurs et Paie)*
Voir `TABLE_DES_MATIERES.md`.

## Volume 12 — API et communications réseau ⬜
- Convention REST du projet (verbes, codes de statut, forme des erreurs `{ erreur: string }`)
- Socket.io : événements émis/écoutés, salles par utilisateur
- `lib/api.ts` détaillé (déjà en partie couvert au 11b, référencé ici)

## Volume 13 — Base de données et migrations ⬜
- ERD Mermaid complet (40 modèles)
- Modèle par modèle : rôle, champs clés, relations, règles `onDelete`
- Historique des 29 migrations (résumé, pas ligne à ligne)
- `prisma/seed.ts`

## Volume 14 — Authentification, autorisations et sécurité (synthèse) ⬜
- Récapitulatif transversal (renvoie au Volume 11b pour le détail)
- JWT : cycle de vie, secret, expiration, session unique
- CORS (`lib/origines.ts`)
- Constat de l'audit de sécurité réalisé dans ce dépôt (faille corrigée sur `equipe.ts`, XSS corrigé sur `APropos.tsx`) — présenté comme fait acquis, pas comme audit à refaire

## Volume 15 — Validation des données ⬜
- Zod : schémas de `packages/shared/src/index.ts`, réutilisation front/back
- Où la validation a lieu (toujours côté serveur, jamais fait confiance au client)

## Volume 16 — Gestion des erreurs et journalisation ⬜
- Middleware d'erreur central (`app.ts`)
- `lib/logger.ts`
- `lib/audit.ts` (renvoi au 11g)

## Volume 17 — Internationalisation ⬜
- Structure des clés de traduction (`i18n/*.json`)
- Portée labels (statique, dans le code) vs données (langue préférée utilisateur, `languePreferee`)
- Comment ajouter une langue, étape par étape

## Volume 18 — Explication exhaustive des fichiers sources restants ⬜
- Tous les fichiers Niveau 2/3 non couverts par un volume thématique dédié, organisés par dossier

## Volume 19 — Tests et stratégie de vérification ⬜
- `packages/shared/src/index.test.ts` (déjà référencé au 11a)
- Ce qui n'est PAS testé automatiquement (constat honnête, cohérent avec l'audit réalisé dans ce projet)
- Comment lancer les tests, comment en écrire un nouveau

## Volume 20 — Performances ⬜
- Lazy loading des pages (`App.tsx`)
- Requêtes Prisma (inclusions, `_count`)
- Constat honnête des limites connues (pas de pagination sur certaines listes, etc. — à vérifier dans le code, pas supposé)

## Volume 21 — Construction et déploiement ⬜
- `npm run build`, `render.yaml`, `DEPLOIEMENT.md`
- Spécificités de l'offre gratuite Render (déjà documentées dans `MISE-EN-PRODUCTION.md`, à croiser)

## Volume 22 — Guide complet d'utilisation ⬜
Voir découpage détaillé dans `TABLE_DES_MATIERES.md`.

## Volume 23 — Administration et maintenance ⬜
- Sauvegarde et restauration (`scripts/restaurer-sauvegarde.ts`, déjà écrit et testé dans ce dépôt)
- Réinitialisation de la base
- Gestion des comptes Admin

## Volume 24 — Débogage et résolution des problèmes ⬜
- Erreurs fréquentes par domaine (connexion, permissions, sauvegarde, e-mail)
- Comment lire les logs structurés (Volume 16)

## Volume 25 — Possibilités d'évolution ⬜
- Pistes identifiées dans le code (commentaires, TODO) et dans l'historique du projet
- Clairement distinguées : constat vs recommandation de l'auteur du livre

## Volume 26 — Glossaire, index et annexes 🟡
- `GLOSSAIRE.md`, `INDEX_DU_CODE.md` : mis à jour en continu
- `annexes/ecarts-spec-code.md` : registre unique des écarts spec/code
- Rapport final de couverture (rédigé à la toute fin)
