# Glossaire — Le Livre Boulangerie Lomoto

> Définition de chaque terme technique ou métier employé dans le livre, dans l'ordre alphabétique. Mis à jour à chaque nouveau chapitre — un terme est ajouté ici dès sa première apparition dans un volume.

## A

**Action critique** (ou tâche critique) — L'une des 5 actions sensibles listées par la spécification (section 2) : supprimer un utilisateur, créer/supprimer un compte Admin, modifier les prix/commissions par Qualité, modifier le taux de taxe, modifier les permissions d'un rôle. Exécutée immédiatement si l'auteur est l'Admin Principal, mise en attente d'approbation sinon — voir `traiterActionCritique`, Volume 11f.

**Admin Principal** — Le compte Administrateur unique (un seul à la fois) qui a l'écriture sur absolument tous les modules et exécute directement toutes les actions critiques (section 2 de la spécification). Se distingue d'un Admin secondaire par le seul champ booléen `Utilisateur.estAdminPrincipal` — les deux partagent le même rôle « Administrateur ».

**Admin secondaire** — Compte de rôle « Administrateur » dont `estAdminPrincipal` vaut `false`. Ses actions les plus sensibles (supprimer un compte, modifier les permissions d'un rôle) sont mises en attente d'approbation par l'Admin Principal plutôt qu'exécutées directement — voir `traiterActionCritique`.

**Approbation (workflow d'—)** — Mécanisme par lequel une action sensible demandée par un Admin secondaire est enregistrée comme `DemandeApprobation` en attente, plutôt qu'exécutée immédiatement, jusqu'à décision de l'Admin Principal.

**Audit (journal d'—)** — Historique immuable de toute modification ou suppression réussie sur une entité sensible (qui, quoi, quand, valeur avant/après), alimenté automatiquement par une extension Prisma plutôt que par un appel explicite dans chaque route. Voir Volume 11g.

**AsyncLocalStorage** — API native de Node.js permettant de faire circuler une valeur (ici, l'identité de l'auteur d'une requête) à travers une chaîne d'appels asynchrones sans avoir à la passer explicitement en paramètre à chaque fonction. Utilisée par `contexteRequete.ts` pour que `lib/audit.ts` sache qui a déclenché une écriture.

## B

**bcrypt** — Algorithme de hachage de mot de passe volontairement lent (résistant à la force brute), utilisé via la bibliothèque `bcryptjs`. Un mot de passe n'est jamais stocké en clair : seul son hachage (`Utilisateur.motDePasseHash`) l'est. Voir Volume 11c.

**Bacs** — Unité de comptage des livraisons de pain (un « bac » de pains). Les prix, avances et dettes sont calculés par bac.

**Bon de livraison** — Document (numérique dans l'application) constatant ce qui a été réellement livré à un Dépositaire, indépendamment de ce qui avait été commandé (Schéma de commande). Voir section 3.3 e de la spécification.

**BOM (Byte Order Mark)** — Caractère invisible placé en tête d'un fichier texte pour en signaler explicitement l'encodage UTF-8. Ajouté par `lib/csv.ts` (frontend) en tête de chaque export CSV, sans quoi Excel en configuration française affiche les caractères accentués incorrectement. Voir Volume 18b.

## C

**Compare-and-set** — Technique de concurrence où une écriture n'est effectuée que si une condition sur l'état actuel est encore vraie au moment précis de l'écriture (ex. `updateMany` gardé sur une valeur `null`) — garantit qu'une seule tentative parmi plusieurs concurrentes réussit, sans verrou explicite. Utilisé pour l'alerte de dette non payée, voir Volume 11h.

**CORS (Cross-Origin Resource Sharing)** — Mécanisme du navigateur qui bloque par défaut les requêtes entre deux origines différentes (domaines/ports). `lib/origines.ts` définit la liste des origines autorisées à appeler l'API.

**cuid()** — Identifiant textuel unique, résistant aux collisions, généré côté application et triable chronologiquement — utilisé comme clé primaire (`id`) sur tous les modèles du schéma, à la place d'un entier auto-incrémenté classique. Voir Volume 13.

**Commission** — Somme reversée à une cliente de qualité « Maman » pour chaque bac reçu (1 650 Fc/bac au moment de l'audit). Calculée automatiquement à l'enregistrement d'une commande.

**cva (class-variance-authority)** — Bibliothèque utilitaire générant des classes Tailwind CSS conditionnelles à partir d'un ensemble de « variantes » nommées (ex. `default`/`gold`/`destructive` pour `Badge` ou `Button`). Voir Volume 9.

## D

**Décision (Absence)** — Acte distinct de la déclaration d'une absence, tranché par un Admin (secondaire ou Principal) : justifiée, non justifiée, ou en attente. Voir Volume 11k-2.

**Délégation** — Attribution temporaire (bornée par une date de début et de fin) d'un droit d'écriture sur un module à un utilisateur qui ne l'a pas dans son rôle de base.

**Dépositaire** — Type de client qui reçoit des livraisons régulières de pain pour les revendre, sans commission (contrairement aux « Mamans »).

**DTO (Data Transfer Object)** — Forme des données telle qu'elle transite entre le serveur et le client (réponse d'API). Dans ce projet, chaque DTO est un `interface` TypeScript défini dans `packages/shared/src/index.ts`, distinct du modèle Prisma correspondant (qui peut contenir des champs internes non exposés).

## E

**ERD (Entity-Relationship Diagram)** — Diagramme montrant les modèles de données et leurs relations (cardinalités). Présenté en six vues par domaine au Volume 13, le schéma complet (42 modèles) étant trop dense pour un diagramme unique lisible.

**Énumération de comptes** — Faille de sécurité où un attaquant peut déduire quels e-mails correspondent à des comptes réels en observant des messages d'erreur différents selon que l'e-mail existe ou non. Ce projet s'en protège en renvoyant systématiquement le même message (« E-mail ou mot de passe incorrect ») pour les deux cas — voir Volume 11c.

**execFile** — Fonction Node.js qui lance un programme externe en lui passant des arguments sous forme de tableau, sans jamais passer par un interpréteur shell — contrairement à `exec` (chaîne de commande unique), aucune valeur ne peut donc être détournée pour injecter une commande shell supplémentaire. Utilisée pour appeler `pg_dump` (Volume 11z-4) et `pg_restore` (`scripts/restaurer-sauvegarde.ts`, Volume 18a).

**ESM (ECMAScript Modules)** — Système de modules JavaScript standard (`import`/`export`), utilisé dans tout ce projet (`"type": "module"` dans chaque `package.json`) par opposition à l'ancien système CommonJS (`require`).

**Extension Prisma** — Mécanisme natif de Prisma (`$extends`) permettant d'enrober le comportement des requêtes (ex. `update`, `delete`) sur tous les modèles à la fois, à un seul endroit, sans modifier le code de chaque route qui écrit en base. Utilisée par ce projet pour le journal d'audit, voir Volume 11g.

## F

**Fc** — Franc congolais, la devise dans laquelle tous les montants de l'application sont exprimés. Toujours stocké en nombre entier (jamais de centimes flottants) — voir Volume 11a sur les implications de ce choix.

**Fonction pure** — Une fonction dont le résultat ne dépend que de ses paramètres (deux appels avec les mêmes valeurs donnent toujours le même résultat) et qui ne modifie rien en dehors d'elle-même (pas d'écriture en base, pas d'appel réseau). Les fonctions de calcul de `packages/shared/src/index.ts` (`calculerCommande`, `calculerDepenseFarine`, `aAcces`...) sont toutes pures — voir Volume 11a.

## G

**Garde-fou de transparence (intervention Admin Principal)** — Mécanisme (`services/interventionsAdmin.ts`, Volume 18a) qui notifie en temps réel le rôle propriétaire d'un module et le DG chaque fois que l'Admin Principal écrit dans un module métier hors de son périmètre d'origine (Paramètres/Équipe/Travailleurs). Le pouvoir total de l'Admin Principal (section 2 de la spécification) reste possible, mais jamais discret.

## I

**Index unique partiel** — Contrainte d'unicité PostgreSQL conditionnelle (`CREATE UNIQUE INDEX ... WHERE ...`), sans équivalent direct dans la syntaxe de `schema.prisma`, ajoutée manuellement au SQL d'une migration. Utilisé pour garantir qu'un seul compte a `estAdminPrincipal = true` à la fois. Voir Volume 13.

**Instantané figé** — Copie complète et indépendante d'un calcul à un instant donné (ex. un `BulletinPaie`), qui ne change jamais rétroactivement même si les données sources qui l'ont nourri sont modifiées après coup. S'oppose à une « vue dérivée » (Commissions, Caisse), toujours recalculée à la lecture. Voir Volume 11k-3.

## J

**Journal append-only** — Table où les lignes ne sont jamais modifiées ni supprimées après coup, seulement ajoutées : le Journal d'audit (Volume 11g) et le journal des mouvements de stock (`MouvementStock`, Volume 11z-1) en sont les deux exemples du projet. L'état courant (quantité en stock, diff affiché) est alors dérivé de ce journal plutôt que stocké séparément et modifié directement.

**JWT (JSON Web Token)** — Jeton signé cryptographiquement contenant l'identité d'un utilisateur connecté (`sub`, `roleId`, `sid`), envoyé par le client à chaque requête dans l'en-tête `Authorization: Bearer <jeton>`. Signé par `lib/jwt.ts`.

## L

**Lazy loading (chargement paresseux)** — Technique consistant à ne charger le code d'un composant (ici, une page) qu'au moment où il est effectivement affiché, via `React.lazy`/`import()` dynamique, plutôt que dans le paquet JavaScript initial. Appliqué à 20 des 22 pages de l'application (`Login.tsx` et `PremierLancement.tsx` restent dans le paquet principal, nécessaires avant toute authentification). Voir Volume 10.

## M

**manualChunks** — Réglage du bundler Rollup (via Vite) qui isole certaines dépendances dans des fichiers JavaScript séparés, mis en cache long terme par le navigateur indépendamment du reste du code applicatif. Ce projet l'utilise pour React/TanStack Query/i18next, mais exclut volontairement `recharts` et `framer-motion` pour qu'ils restent liés au chargement paresseux de leurs consommateurs. Voir Volume 18d.

**Maman** — Type de cliente (vocabulaire du métier, pas un terme technique) dont les commandes génèrent une commission (contrairement aux Dépositaires et à la Vente cash).

**Mot de passe d'application** — Mot de passe secondaire généré par Google, révocable indépendamment du mot de passe principal du compte, utilisé pour l'envoi d'e-mail via Gmail/Google Workspace (`GMAIL_APP_PASSWORD`) sans jamais exposer les identifiants réels du compte. Voir Volume 5.

**Migration (Prisma)** — Fichier SQL généré automatiquement par `prisma migrate` décrivant un changement du schéma de base de données. Le dossier `prisma/migrations/` contient l'historique complet, dans l'ordre chronologique.

**MVCC (Multiversion Concurrency Control)** — Mécanisme standard de PostgreSQL permettant à une lecture de voir un instantané cohérent des données sans bloquer les écritures concurrentes. Mentionné au Volume 11g pour expliquer pourquoi une lecture « avant » dans le journal d'audit n'interfère pas avec une transaction en cours.

**Module** — Dans ce projet, un domaine fonctionnel de l'application sur lequel une permission peut être accordée (ex. `COMMANDES`, `CAISSE`, `TRAVAILLEURS`). Liste fixe définie par l'énumération `Module` dans `packages/shared/src/index.ts`.

**Monorepo** — Dépôt Git unique contenant plusieurs paquets npm distincts (`apps/api`, `apps/web`, `packages/shared`) gérés ensemble via les *workspaces* npm. `packages/shared` n'est jamais compilé séparément : ses champs `main`/`types`/`exports` (`package.json`, Volume 18d) pointent directement vers le fichier `.ts` source, retypé à la volée par le `tsconfig.json` de chaque consommateur (`apps/api`, `apps/web`) — voir Volume 18d.

## M

**Middleware** (Express) — Une fonction `(req, res, next)` insérée dans la chaîne de traitement d'une requête HTTP, exécutée avant le gestionnaire final de la route. Peut soit continuer la chaîne (`next()`), soit renvoyer directement une réponse (ex. un refus 401/403), interrompant la suite. `requireAuth` et `requirePermission` (`middleware/auth.ts`) en sont les exemples centraux de ce projet — voir Volume 11b.

**Middleware factory** (fabrique de middleware) — Une fonction qui ne prend pas `(req, res, next)` directement, mais des paramètres de configuration, et **renvoie** une fonction middleware construite à partir de ces paramètres. `requirePermission(module, niveau)` en est l'exemple : elle prend un module et un niveau, et renvoie le middleware qui vérifiera précisément ce couple. Voir Volume 11b.

## N

**NiveauAcces** — Le niveau d'une permission sur un module : `AUCUN`, `LECTURE` ou `ECRITURE`. `ECRITURE` implique toujours `LECTURE` (voir la fonction `aAcces`, Volume 11a).

## P

**ParametreBoutique** — Table Prisma générique clé/valeur (une colonne `cle`, une colonne `valeur`) qui stocke les réglages de la boutique n'ayant pas besoin d'une colonne dédiée (nom, adresse, langue par défaut...) — accédée via `lireParametre`/`ecrireParametre` (`lib/parametres.ts`, Volume 18a). Écriture par `create`/`update` explicites plutôt qu'`upsert`, pour rester visible au Journal d'audit.

**Permission** — Couple (`Module`, `NiveauAcces`) attribué à un rôle. L'ensemble des permissions d'un rôle forme sa « matrice de permissions ».

**Polling** — Technique consistant à réinterroger périodiquement le serveur à intervalle fixe (ex. toutes les 20 secondes) plutôt que d'attendre passivement une notification. Utilisé en complément — pas en remplacement — du temps réel Socket.io sur l'écran Approbations, voir Volume 11f.

## R

**Radix UI** — Bibliothèque de primitives d'interface accessibles et sans style imposé (`@radix-ui/react-*`), sur laquelle sont bâtis `Dialog` et `Sheet` de ce projet (les deux réutilisent le même primitif `@radix-ui/react-dialog`, seul le style diffère). Voir Volume 9.

**Rôle** — Ensemble nommé de permissions (ex. « Caissier(ère) », « Responsable de production »), attribué à un ou plusieurs comptes `Utilisateur`. Modèle `Role` en base.

## S

**Sanction** — Punition ou retenue disciplinaire déclarée sur une fiche Travailleur (type `PUNITION` ou `RETENUE`) — un montant n'a de sens que pour une retenue, jamais pour une punition non financière. Voir Volume 11k-2.

**Schéma de commande** — Document numérique récapitulant, pour une date donnée, ce que chaque Dépositaire/Maman a commandé. Alimente automatiquement le Planning de production. Voir section 3.3 d de la spécification.

**Session unique** — Règle selon laquelle un compte ne peut avoir qu'une seule session active à la fois : une nouvelle connexion invalide la précédente (`Utilisateur.sessionActuelleId`).

**shadcn/ui** — Non pas une bibliothèque installée comme dépendance classique, mais un générateur qui copie des composants Radix UI pré-stylés directement dans le code du projet (`apps/web/src/components/ui/`), piloté par `apps/web/components.json`. Explique pourquoi ce dossier fait partie du code source versionné plutôt que de `node_modules`. Voir Volumes 7 et 9.

**Socket.io** — Bibliothèque de communication temps réel bidirectionnelle (au-dessus des WebSockets, avec repli automatique) utilisée pour les notifications et le fil d'activité en direct.

**SPA (Single Page Application) — repli (fallback)** — Configuration serveur qui renvoie systématiquement `index.html` pour toute route non reconnue comme un fichier statique ou une route `/api/*`, afin que le routage côté client (`react-router-dom`) puisse prendre le relais après rechargement d'une URL profonde. Posé en dernier, après le montage des 26 routeurs, dans `apps/api/src/app.ts`. Voir Volume 8.

**Splash (écran de démarrage)** — Écran de chargement superposé non bloquant, affiché au tout premier lancement de l'application dans un onglet donné (mémorisé via `sessionStorage`) pendant une durée fixe (7000 ms), géré par `EcranDemarrage.tsx`. Voir Volume 8.

## T

**TanStack Query** — Bibliothèque de gestion de l'état serveur côté client (cache, invalidation, re-fetch) utilisée pour toutes les données venant de l'API. Convention du projet : clés de requête structurées (`["ressource", filtres]`), invalidation large de toutes les clés affectées après une mutation plutôt que du seul écran courant, option `enabled` pour suspendre une requête tant qu'une condition n'est pas remplie (permission manquante, paramètre non renseigné). Voir Volume 10.

**Trust proxy** — Réglage Express indiquant au serveur qu'il est placé derrière un proxy inverse (celui de Render) et qu'il doit donc faire confiance aux en-têtes `X-Forwarded-*` pour déterminer l'adresse IP réelle du client et le protocole d'origine (HTTP/HTTPS). Posé en tout premier dans `createApp()`. Voir Volume 8.

## V

**Vente cash (VC)** — Type de client sans commission, ni compte régulier — équivalent d'une vente ponctuelle au comptant.

**Vitest** — Framework de tests unitaires du projet, exécuté via `npm test`. Un seul fichier de test existe dans tout le dépôt à ce jour (`packages/shared/src/index.test.ts`, 11 tests sur les fonctions financières et de permissions les plus critiques). Voir Volume 19.

## Z

**Zod** — Bibliothèque de validation de schémas TypeScript. Chaque entrée d'API du projet est validée par un schéma Zod (53 au total) défini dans `packages/shared/src/index.ts`, invoqué via `safeParse` — 55 occurrences identiques à travers les routes (Volume 15). **Précision (Volume 15)** : les schémas eux-mêmes ne sont jamais invoqués côté client (vérifié par recherche exhaustive) — seuls les types dérivés (`z.infer`) et certaines fonctions de calcul pures qui les accompagnent (ex. `calculerCommande`) traversent vers le frontend, pour un confort de saisie, jamais pour la validation réelle, toujours assurée côté serveur.

**Zone de dépôt** — Regroupement purement organisationnel de Dépositaires (ex. « Centre-ville »), sans effet sur les prix, utilisé pour trier l'affichage du Schéma de commande et du Bon de livraison.

---

*Glossaire non exhaustif à ce stade — enrichi à chaque nouveau chapitre. Si un terme du livre ne s'y trouve pas encore, c'est qu'il sera ajouté au moment où le chapitre correspondant sera rédigé.*
