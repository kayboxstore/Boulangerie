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

## Volume 4 — Installation de l'environnement ✅
- Prérequis vérifiés dans l'environnement de rédaction (Node 22, npm) ; Docker/PostgreSQL non disponibles ici — signalé explicitement, pas supposé
- Les 5 étapes du `README.md` : ce qui a pu être vérifié (`npm install` déjà fait, `prisma validate` OK, les 11 tests Vitest passent) vs ce qui ne l'a pas pu (migration/seed/démarrage complet, faute de base accessible)
- **Découverte** : la section « Phase actuelle » et une partie des Conventions du `README.md` décrivent l'ancienne Caisse (vente au comptoir, clôture, alerte transaction inhabituelle) — retirée depuis la refonte 3.1 (Volume 11j) ; incohérence documentaire, pas un écart spec/code
- Comptes de démonstration croisés avec `seed.ts` (Volume 13) — aucune divergence

## Volume 5 — Configuration et variables d'environnement ✅
- Trois variables obligatoires (`DATABASE_URL`, `JWT_SECRET`, `PORT`) vs toutes les autres, optionnelles avec repli documenté
- Groupes de variables optionnelles croisés avec leur section de spec : e-mail des rapports (3.13), e-mail professionnel Cloudflare (3.18, portée Compte vs Zone), Assistant IA (3.19), sauvegarde (3.15)
- `render.yaml` : un seul service Node sert API + frontend compilé, chaîne de build (`--include=dev`, génération Prisma, migrations, seed, build web), `healthCheckPath`
- Écart repéré : aucun

## Volume 6 — Architecture générale ✅
- Chapitre de synthèse (aucun nouveau fichier lu — assemble les Volumes 7, 8, 11b, 12, 13 déjà rédigés)
- Schéma Mermaid de l'architecture globale : un seul processus Node.js sert API REST + frontend compilé + Socket.io (pas de microservices)
- Le monorepo et la circulation d'un type depuis `packages/shared` jusqu'au rendu React (exemple `mouvementCreateSchema`/`MatierePremiereDTO`)
- Séparation des responsabilités (routes → services → Prisma), triangle répété à l'identique dans ~26 routeurs
- Diagramme de séquence condensé du cycle d'une requête authentifiée (permission revérifiée serveur, DTO partagé, notification synchronisée)
- Écart repéré : aucun (section 7 de la spec)

## Volume 7 — Arborescence détaillée du projet ✅
- Explication dossier par dossier, avec renvoi vers `INVENTAIRE_DU_PROJET.md` pour le détail fichier par fichier
- Trois paquets npm (`apps/api`, `apps/web`, `packages/shared`), `apps/web/components.json` (shadcn/ui, générateur et non dépendance)

## Volume 8 — Cycle de démarrage de l'application ✅
- Démarrage du serveur API (`index.ts` → `createApp()` → 26 routeurs → repli SPA → écoute HTTP)
- Démarrage du frontend (`main.tsx` → empilement des providers → `App.tsx` → `EcranDemarrage` → connexion)
- Diagramme de séquence Mermaid complet
- Écart repéré : aucun

## Volume 9 — Interface utilisateur et composants ✅
- Système de design (Tailwind + Radix + shadcn/ui, générateur copiant les composants dans `components/ui/`)
- Les 11 primitives `ui/` : `badge`, `button`, `card`, `carte-ligne`, `dialog`, `input`, `label`, `select`/`NativeSelect`, `sheet`, `table`, `textarea`
- Vue mobile (`CarteLigne`) vs vue desktop (`Table`) : deux arbres JSX partageant les mêmes données
- `Sheet` : réutilise le même primitif Radix que `Dialog`, stylé en tiroir plutôt que centré
- `Layout.tsx` : règle « tous les modules visibles, grisés si hors permission », `ListeNavigation` (rendu unique partagé)
- **Observation signalée (pas un écart spec/code)** : `calculerLiens` dans `Layout.tsx` définie mais jamais appelée, dupliquée en ligne dans `Layout()`

## Volume 10 — Navigation et gestion de l'état ✅
- `App.tsx` : arbre de routes complet, `React.lazy` (20/22 pages), gardes `RequiertLecture`/`RequiertEcriture` (confort d'affichage — sécurité réelle côté serveur)
- TanStack Query : clés de requête structurées, invalidation large après mutation, `enabled`
- Écart repéré : aucun
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

### 11k-1 — Travailleurs : fiches et pointage ✅
- `versTravailleurDTO`/`validerDepartementGroupe`/`verifierCompteLie` : garde-fous de cohérence (compte déjà lié, groupe hors département)
- CRUD fiches ; suppression asymétrique (bloquée par les bulletins, cascade silencieuse sur pointages/absences/sanctions) — correctif documenté (spec elle-même le mentionne)
- E-mail professionnel : délégation pure vers `services/emailPro.ts` (Niveau 2, Volume 18)
- Pointage : horodatage complet gérant nativement les équipes de nuit ; trois états de `horodatageSortie` (absent/null/valeur) à la modification

### 11k-2 — Travailleurs : absences et sanctions ✅
- Absence : déclaration et décision comme deux actes distincts, `EN_ATTENTE` par défaut
- Alerte « absence en attente » : même compare-and-set que `verifierAlertesDette` (11h), restreinte aux Admins malgré la lecture du DG
- Sanction : validation croisée type/montant portée par le schéma Zod partagé, pas par la route
- Précision : l'UI des sanctions vit dans `PaieCard.tsx`, pas `TravailleursPage`

### 11k-3 — Calcul de paie et bulletins ✅
- `calculerPaieBrute` : aucun arrondi intermédiaire, un seul arrondi final sur `salaireNet` ; bornage du mois via `setUTCMonth`
- Vue dynamique (`GET .../paie`) vs bulletin figé (`POST .../bulletins-paie`) — même fonction, deux usages, JSON copié (pas référencé)
- `peutConsulterBulletinsDe` : accès personnel aux bulletins hors permission de module
- Export PDF reconstruit uniquement depuis les chiffres figés, jamais recalculé
- Exemple chiffré complet (350 000 Fc, 26 jours, 2 absences NJ, 1 retenue 10 000 Fc → 313 077 Fc net)
- 25/26 fichiers Niveau 1 couverts à l'issue de ce volume (`schema.prisma`, également Niveau 1, restait à traiter — voir Volume 13, qui referme réellement le Niveau 1 à 26/26 ; correction d'une annonce prématurée faite ici initialement)

### 11z-1 — Stocks, Fournisseurs et Catalogue produits ✅
- `services/stocks.ts` : `appliquerMouvement` (point de passage unique de toute variation de stock, dans une transaction fournie par l'appelant), `franchitSeuil` (détection de transition, pas d'état), `emettreAlerteSeuil`
- `routes/stocks.ts` : CRUD matières premières (stock initial via mouvement `ENTREE`, suppression bloquée par l'historique), journal des mouvements (`GET` plafonné à 100, `POST` manuel)
- `routes/fournisseurs.ts` : CRUD fournisseurs, bons de commande (`CommandeFournisseur`, total en vue dérivée), réception (`updateMany` conditionnel + transaction `Serializable`, notification `RECEPTION_FOURNISSEUR`)
- `routes/produits.ts` : catalogue sous permission `PARAMETRES` (conforme à la spec 3.9 et à la matrice de `seed.ts`), `MODIFIER_TAUX_TAXE` via `traiterActionCritique` (deuxième occurrence concrète du mécanisme du 11f)
- Observation : `ProduitsPage` n'envoie jamais de changement de `tauxTaxe` — le chemin serveur existe mais n'est atteint par aucune UI actuelle
- Écart repéré : aucun

### 11z-2 — Production ✅
- `routes/production.ts` : Planning (unicité par date, mise à jour plutôt qu'échec), Schéma de commande (`chargerSchemaCommandeJour` source unique GET/PUT, alimentation automatique du Planning), Bon de livraison (`chargerBonLivraisonJour`, indépendance volontaire du Schéma, Dépositaires uniquement), Productions enregistrées (décrémentation via code d'ingrédient + `appliquerMouvement` réutilisé du 11z-1, réconciliation non bloquante via `totalDestinationsBacs`), vue Écarts prévu/réalisé
- `services/pdf.ts` (partiel) : `construirePdfBonsLivraison`, `nomFichierPdf` — la fonction générique `construirePdf` (rapports) reste à couvrir
- `pages/Production.tsx`, `pages/BonsLivraison.tsx` : édition en grille par cellule, réutilisation client de `totalDestinationsBacs`, téléchargement PDF via `fetch` direct (pas le wrapper `api()`, incompatible avec un flux binaire)
- Écart repéré : aucun

### 11z-3 — Départements/Groupes, Zones de dépôt, Clients ✅
- `routes/departements.ts` : règle de désignation du chef différente création (auto-rattachement) vs modification (membre existant obligatoire), cascade/SetNull à la suppression
- `routes/zones-depositaires.ts` : `ecritureZones`, deuxième middleware Express personnalisé du projet (combine `COMMANDES` OU `PRODUCTION` via `aAcces`), correction de conception documentée dans la spec elle-même
- `routes/clients.ts` : `clientsRouter`/`typeClientsRouter`, `MODIFIER_TYPE_CLIENT` via action critique (3ᵉ occurrence du mécanisme du 11f)
- Frontend : `DepartementsCard`/`ZonesDepositaireCard` reçoivent leurs données/permissions en props depuis la page parente (pas de requête redondante), `DialogNouvelleZone` (création rapide depuis la fiche client)
- Écart repéré : aucun

### 11z-4 — Notifications, État système, Paramètres, Premier lancement ✅
- `services/notifications.ts` : `rolesDestinataires` (matrice de permissions réutilisée pour le ciblage + supérieur hiérarchique en filet de sécurité), `rolesAvecLecture` (événements système), `publierEvenement` (persistance + temps réel dans le même passage)
- `routes/etat-systeme.ts` + 4 services (`sauvegarde.ts` : pg_dump en sous-processus, mot de passe jamais en argument ; `sauvegardeLocale.ts` : rétention glissante ; `planificateurSauvegarde.ts` : node-cron, `noOverlap` ; `reinitialisation.ts` : séquencement strict sauvegarde-puis-effacement, catalogue matières premières conservé)
- `routes/parametres.ts` : boutique + langue par défaut, partagé avec À propos
- `routes/premierLancement.ts` : 4 étapes, `exigerBaseVide` en garde manuelle (pas de `requireAuth` possible)
- Frontend : `EtatSystemePage`, `ParametresPage` (**observation** : modification de Qualité sans distinction visuelle exécuté/en attente, contrairement à `Equipe.tsx`), `PremierLancementPage`, `NotificationBell`
- Écart repéré : aucun

### 11z-5 — À propos, Email professionnel, Assistant, Rapports, Export ✅
- `routes/apropos.ts` : page publique, champs partagés avec Paramètres, crédit développeur réservé à cet écran
- `services/emailPro.ts` + `lib/cloudflareEmail.ts` : mécanisme complet (déjà entrevu aux 11k-1/11z-4), deux portées Cloudflare distinctes (Compte vs Zone)
- `routes/assistant.ts` + `lib/ia.ts` : chat support avec premier niveau IA optionnel (`ASSISTANT_IA_ACTIF`), repli automatique vers l'escalade humaine, jamais d'exception qui romprait l'envoi du message
- `routes/rapports.ts` : 7 widgets Tableau de bord — **observation** : commentaire de `/cloture-quotidienne` obsolète (n'a pas suivi l'extension de portée aux Admins documentée dans la spec 3.8)
- `routes/rapports-personnels.ts` : portée dédiée (`resoudrePortee`), hors matrice de permissions standard, 8 sources agrégées
- `routes/export.ts` + `services/email.ts` + `construirePdf` générique (`services/pdf.ts`, désormais couvert intégralement) : vérification de permission a posteriori, un seul générateur PDF partagé par 3 écrans
- Écart repéré : aucun

**Clôture du Volume 11z** (5 sous-chapitres, 12 routeurs API, 12 services, ~20 composants/pages frontend).

## Volume 12 — API et communications réseau ✅
- `lib/events.ts` : bus d'événements interne (`EventEmitter` natif Node), découplé de Socket.io — les modules métier publient sans connaître le transport
- `lib/realtime.ts` : `initRealtime` (CORS Socket.io séparé d'Express, authentification au handshake avec la même vérification de session unique que `requireAuth`), deux rooms par connexion (`user:{id}`, `role:{id}`), `getIo`/`invaliderSessionUtilisateur`
- `lib/socket.tsx` : `SocketProvider`/`useSocket`, chargement paresseux de `socket.io-client`, rattrapage d'historique à chaque (re)connexion, trois filets pour la session unique
- **Observation** : clés d'invalidation `["ventes"]`/`["clotures"]` (module CAISSE) — code mort, aucun écran actuel ne les utilise (tables supprimées à la refonte 3.1, Volume 13)
- `ActivityFeed`/`IndicateurConnexion` : rendu du flux, séparation délibérée pour le découpage de bundle (Framer Motion)
- Écart repéré : aucun

**Ce volume referme le transport du système de notification temps réel expliqué à travers les Volumes 11 et 11z.**

## Volume 13 — Base de données et migrations ✅
- Recomptage exact : 42 modèles, 16 enums (l'inventaire initial datait d'avant plusieurs migrations)
- Conventions transversales centralisées : `cuid()`, `createdAt`/`updatedAt`, les 3 stratégies `onDelete`, `Int` vs `Decimal`, `DateTime` vs `@db.Date`, instantanés JSON, index unique partiel sur `estAdminPrincipal`
- ERD Mermaid en 6 vues par domaine (identité/gouvernance, commandes/clients, catalogue/stocks/fournisseurs, production, travailleurs/paie, caisse/système)
- Table de référence des 42 modèles avec renvoi vers leur chapitre applicatif (déjà couverts) ou le Volume 18 (Niveau 2, à venir)
- **Découverte et correction** : commentaire obsolète dans `schema.prisma` (`Vente`/`LigneVente`/`ClotureCaisse` présentées comme « conservées en base » alors que la migration `absence_alerte_et_nettoyage_orphelines` les a réellement supprimées) — correction appliquée rétroactivement au Volume 11j
- Historique résumé des 29 migrations (chronologie par étapes, pas ligne à ligne)
- `prisma/seed.ts` : `upsertRole` autoritatif sur la matrice de permissions, fonctions de retrofit idempotentes

## Volume 14 — Authentification, autorisations et sécurité (synthèse) ✅
- Récapitulatif transversal en 4 couches (origine → identité → session unique → permission), diagramme Mermaid
- `lib/origines.ts` (nouveau) : CORS Express + Socket.io partagé, domaine canonique `www` dicté par une contrainte Render (boucle de redirection évitée)
- JWT : cycle de vie, secret obligatoire en production, expiration 12h, `roleId` jamais utilisé pour les permissions (vérifié aussi côté Socket.io)
- Session unique : 3 points d'entrée (HTTP, handshake Socket.io, déconnexion forcée d'un socket déjà ouvert)
- Constat de l'audit de sécurité réalisé dans ce dépôt (faille corrigée sur `equipe.ts`/11d, XSS corrigé sur `APropos.tsx`/11z-5) — présenté comme fait acquis, pas comme audit à refaire
- Écart repéré : aucun

## Volume 15 — Validation des données ✅
- Synthèse transversale (aucun nouveau fichier) : 53 schémas Zod, motif `safeParse` identique à 55 emplacements
- `setErrorMap` global (filet) + message dédié par champ (principal) — réalise le ton clair exigé par la spec 3.8
- `.partial()`/`.omit()` pour dériver les schémas de mise à jour sans dupliquer les règles ; `.refine()` pour les règles inter-champs (11 usages)
- **Précision** : les schémas Zod ne sont jamais invoqués côté client (vérifié) — seuls les types et fonctions pures traversent, jamais la validation elle-même
- Écart repéré : aucun

## Volume 16 — Gestion des erreurs et journalisation ✅
- `lib/logger.ts` (nouveau) : logging JSON structuré minimal, sans dépendance externe, `remplacantErreur` (sérialisation des `Error`, non énumérables par défaut)
- Middleware d'erreur central de `app.ts` (détaillé) : signature à 4 paramètres, toujours journalisé avec contexte, toujours un message générique renvoyé au client
- Motif `catch (e) { next(e); }` : hiérarchie à deux niveaux (erreurs métier nommées avec statut/message dédié vs filet générique)
- `lib/audit.ts` (renvoi au 11g)
- Écart repéré : aucun

## Volume 17 — Internationalisation ✅
- `i18n/index.ts` : initialisation react-i18next, `fallbackLng: "FR"`, `appliquerLangue` idempotente
- Parité vérifiée par script : 1013 clés fonctionnelles strictement identiques dans les 4 langues (seul écart : `_note`, présente uniquement dans `ln.json`/`sw.json`)
- Lingala et Kiswahili explicitement documentés comme « premier jet, non définitif » dans le fichier lui-même — français et anglais sans réserve
- 39 namespaces de premier niveau, correspondant terme à terme aux écrans déjà couverts chapitre par chapitre
- `langueDefaut` (boutique, 11z-4) vs `Utilisateur.languePreferee` (individuelle, nullable, prime sur la boutique)
- Écart repéré : aucun (section 3.8)

## Volume 18 — Explication exhaustive des fichiers sources restants ✅
- Tous les fichiers Niveau 2/3 non couverts par un volume thématique dédié, organisés par dossier — clos en 4 sous-chapitres (18a-18d), matrice à 155/155

## Volume 19 — Tests et stratégie de vérification ✅
- `packages/shared/src/index.test.ts` (déjà référencé au 11a) — 11 tests, exécutés réellement et vérifiés passants
- Ce qui n'est PAS testé automatiquement (constat honnête) — aucune route API, composant frontend, ni parcours E2E
- Deuxième écart spec/code trouvé : Playwright recommandé par la spec, jamais installé

## Volume 20 — Performances ✅
- Lazy loading des pages (`App.tsx`), `manualChunks` sélectif de Vite
- Indexation Prisma (29 `@@index` recomptés), état du stock stocké et incrémenté (pas dérivé par agrégation)
- Constat honnête : aucune vraie pagination (`skip`), seulement des plafonds fixes (`take: N`)

## Volume 21 — Construction et déploiement ✅
- `npm run build`, `render.yaml`, `DEPLOIEMENT.md` — lus intégralement
- Spécificités de l'offre gratuite Render (`docs/MISE-EN-PRODUCTION.md` croisé) — risque majeur d'expiration de la base gratuite documenté

## Volume 22 — Guide complet d'utilisation 🟡
Voir découpage détaillé dans `TABLE_DES_MATIERES.md`. 6 sous-chapitres rédigés à ce jour (22a Premiers pas, 22b Rôles et permissions, 22c Commandes et Clients, 22d Production, 22e Stocks et Fournisseurs, 22f Caisse) sur 12 prévus (22a-22l).

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
