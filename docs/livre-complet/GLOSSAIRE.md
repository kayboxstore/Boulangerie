# Glossaire — Le Livre Boulangerie Lomoto

> Définition de chaque terme technique ou métier employé dans le livre, dans l'ordre alphabétique. Mis à jour à chaque nouveau chapitre — un terme est ajouté ici dès sa première apparition dans un volume.

## A

**Admin Principal** — Le compte Administrateur unique (un seul à la fois) qui a l'écriture sur absolument tous les modules et exécute directement toutes les actions critiques (section 2 de la spécification). Se distingue d'un Admin secondaire par le seul champ booléen `Utilisateur.estAdminPrincipal` — les deux partagent le même rôle « Administrateur ».

**Admin secondaire** — Compte de rôle « Administrateur » dont `estAdminPrincipal` vaut `false`. Ses actions les plus sensibles (supprimer un compte, modifier les permissions d'un rôle) sont mises en attente d'approbation par l'Admin Principal plutôt qu'exécutées directement — voir `traiterActionCritique`.

**Approbation (workflow d'—)** — Mécanisme par lequel une action sensible demandée par un Admin secondaire est enregistrée comme `DemandeApprobation` en attente, plutôt qu'exécutée immédiatement, jusqu'à décision de l'Admin Principal.

**AsyncLocalStorage** — API native de Node.js permettant de faire circuler une valeur (ici, l'identité de l'auteur d'une requête) à travers une chaîne d'appels asynchrones sans avoir à la passer explicitement en paramètre à chaque fonction. Utilisée par `contexteRequete.ts` pour que `lib/audit.ts` sache qui a déclenché une écriture.

## B

**bcrypt** — Algorithme de hachage de mot de passe volontairement lent (résistant à la force brute), utilisé via la bibliothèque `bcryptjs`. Un mot de passe n'est jamais stocké en clair : seul son hachage (`Utilisateur.motDePasseHash`) l'est. Voir Volume 11c.

**Bacs** — Unité de comptage des livraisons de pain (un « bac » de pains). Les prix, avances et dettes sont calculés par bac.

**Bon de livraison** — Document (numérique dans l'application) constatant ce qui a été réellement livré à un Dépositaire, indépendamment de ce qui avait été commandé (Schéma de commande). Voir section 3.3 e de la spécification.

## C

**CORS (Cross-Origin Resource Sharing)** — Mécanisme du navigateur qui bloque par défaut les requêtes entre deux origines différentes (domaines/ports). `lib/origines.ts` définit la liste des origines autorisées à appeler l'API.

**Commission** — Somme reversée à une cliente de qualité « Maman » pour chaque bac reçu (1 650 Fc/bac au moment de l'audit). Calculée automatiquement à l'enregistrement d'une commande.

## D

**Délégation** — Attribution temporaire (bornée par une date de début et de fin) d'un droit d'écriture sur un module à un utilisateur qui ne l'a pas dans son rôle de base.

**Dépositaire** — Type de client qui reçoit des livraisons régulières de pain pour les revendre, sans commission (contrairement aux « Mamans »).

**DTO (Data Transfer Object)** — Forme des données telle qu'elle transite entre le serveur et le client (réponse d'API). Dans ce projet, chaque DTO est un `interface` TypeScript défini dans `packages/shared/src/index.ts`, distinct du modèle Prisma correspondant (qui peut contenir des champs internes non exposés).

## E

**Énumération de comptes** — Faille de sécurité où un attaquant peut déduire quels e-mails correspondent à des comptes réels en observant des messages d'erreur différents selon que l'e-mail existe ou non. Ce projet s'en protège en renvoyant systématiquement le même message (« E-mail ou mot de passe incorrect ») pour les deux cas — voir Volume 11c.

**ESM (ECMAScript Modules)** — Système de modules JavaScript standard (`import`/`export`), utilisé dans tout ce projet (`"type": "module"` dans chaque `package.json`) par opposition à l'ancien système CommonJS (`require`).

## F

**Fc** — Franc congolais, la devise dans laquelle tous les montants de l'application sont exprimés. Toujours stocké en nombre entier (jamais de centimes flottants) — voir Volume 11a sur les implications de ce choix.

**Fonction pure** — Une fonction dont le résultat ne dépend que de ses paramètres (deux appels avec les mêmes valeurs donnent toujours le même résultat) et qui ne modifie rien en dehors d'elle-même (pas d'écriture en base, pas d'appel réseau). Les fonctions de calcul de `packages/shared/src/index.ts` (`calculerCommande`, `calculerDepenseFarine`, `aAcces`...) sont toutes pures — voir Volume 11a.

## J

**JWT (JSON Web Token)** — Jeton signé cryptographiquement contenant l'identité d'un utilisateur connecté (`sub`, `roleId`, `sid`), envoyé par le client à chaque requête dans l'en-tête `Authorization: Bearer <jeton>`. Signé par `lib/jwt.ts`.

## M

**Maman** — Type de cliente (vocabulaire du métier, pas un terme technique) dont les commandes génèrent une commission (contrairement aux Dépositaires et à la Vente cash).

**Migration (Prisma)** — Fichier SQL généré automatiquement par `prisma migrate` décrivant un changement du schéma de base de données. Le dossier `prisma/migrations/` contient l'historique complet, dans l'ordre chronologique.

**Module** — Dans ce projet, un domaine fonctionnel de l'application sur lequel une permission peut être accordée (ex. `COMMANDES`, `CAISSE`, `TRAVAILLEURS`). Liste fixe définie par l'énumération `Module` dans `packages/shared/src/index.ts`.

**Monorepo** — Dépôt Git unique contenant plusieurs paquets npm distincts (`apps/api`, `apps/web`, `packages/shared`) gérés ensemble via les *workspaces* npm.

## M

**Middleware** (Express) — Une fonction `(req, res, next)` insérée dans la chaîne de traitement d'une requête HTTP, exécutée avant le gestionnaire final de la route. Peut soit continuer la chaîne (`next()`), soit renvoyer directement une réponse (ex. un refus 401/403), interrompant la suite. `requireAuth` et `requirePermission` (`middleware/auth.ts`) en sont les exemples centraux de ce projet — voir Volume 11b.

**Middleware factory** (fabrique de middleware) — Une fonction qui ne prend pas `(req, res, next)` directement, mais des paramètres de configuration, et **renvoie** une fonction middleware construite à partir de ces paramètres. `requirePermission(module, niveau)` en est l'exemple : elle prend un module et un niveau, et renvoie le middleware qui vérifiera précisément ce couple. Voir Volume 11b.

## N

**NiveauAcces** — Le niveau d'une permission sur un module : `AUCUN`, `LECTURE` ou `ECRITURE`. `ECRITURE` implique toujours `LECTURE` (voir la fonction `aAcces`, Volume 11a).

## P

**Permission** — Couple (`Module`, `NiveauAcces`) attribué à un rôle. L'ensemble des permissions d'un rôle forme sa « matrice de permissions ».

## R

**Rôle** — Ensemble nommé de permissions (ex. « Caissier(ère) », « Responsable de production »), attribué à un ou plusieurs comptes `Utilisateur`. Modèle `Role` en base.

## S

**Schéma de commande** — Document numérique récapitulant, pour une date donnée, ce que chaque Dépositaire/Maman a commandé. Alimente automatiquement le Planning de production. Voir section 3.3 d de la spécification.

**Session unique** — Règle selon laquelle un compte ne peut avoir qu'une seule session active à la fois : une nouvelle connexion invalide la précédente (`Utilisateur.sessionActuelleId`).

**Socket.io** — Bibliothèque de communication temps réel bidirectionnelle (au-dessus des WebSockets, avec repli automatique) utilisée pour les notifications et le fil d'activité en direct.

## V

**Vente cash (VC)** — Type de client sans commission, ni compte régulier — équivalent d'une vente ponctuelle au comptant.

## Z

**Zod** — Bibliothèque de validation de schémas TypeScript. Chaque formulaire/entrée d'API du projet est validé par un schéma Zod défini dans `packages/shared/src/index.ts`, partagé entre le serveur (validation réelle) et le client (retour immédiat).

**Zone de dépôt** — Regroupement purement organisationnel de Dépositaires (ex. « Centre-ville »), sans effet sur les prix, utilisé pour trier l'affichage du Schéma de commande et du Bon de livraison.

---

*Glossaire non exhaustif à ce stade — enrichi à chaque nouveau chapitre. Si un terme du livre ne s'y trouve pas encore, c'est qu'il sera ajouté au moment où le chapitre correspondant sera rédigé.*
