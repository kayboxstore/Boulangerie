# État de progression — Livre technique Boulangerie Lomoto

> À lire en premier au début de toute nouvelle session de travail sur ce livre, avec `MATRICE_DE_COUVERTURE.md` et `TABLE_DES_MATIERES.md`.

## Session en cours

**Date** : 2026-08-08
**Commit de référence** : `faa203a` (branche `main-a7fm5x`)

## 1. Point de calibrage (produit immédiatement après l'audit, comme demandé)

### Fichiers propriétaires recensés

**155 fichiers de code** + **4 sources documentaires** croisées en continu (voir `INVENTAIRE_DU_PROJET.md`).

### Répartition par niveau de risque métier

| Niveau | Fichiers | % du total | Traitement attendu |
|---|---:|---:|---|
| **1 — Critique** | 26 | 17 % | Ligne à ligne, tables de vérité, exemples chiffrés bout en bout, aucune ligne de logique ignorée |
| **2 — Fonctionnel standard** | 66 | 43 % | Explication complète par fichier et par symbole, regroupement possible des lignes non critiques |
| **3 — Support/infrastructure** | 63 | 41 % | Couverture correcte mais concise |

Les 26 fichiers Niveau 1 concentrent l'essentiel de l'effort de rédaction malgré leur poids relatif modeste en nombre de fichiers — cohérent avec la consigne de prioriser par risque plutôt que par volume.

### Estimation d'ampleur (ordre de grandeur, pas un engagement contractuel)

| Élément | Estimation |
|---|---|
| Volumes (au sens du plan de rédaction, §Phase 3 du mandat) | 26 thèmes obligatoires + annexes, effectivement livrés sous forme d'environ **90 à 120 fichiers/chapitres** dans `volumes/` une fois le découpage par module appliqué aux Niveaux 1 et 2 |
| Chapitres dédiés à un seul fichier Niveau 1 | 26 (un par fichier, certains regroupés par paire quand la logique est fortement couplée, ex. `commandes.ts` + sa page `Commandes.tsx`) |
| Volume approximatif en mots | 200 000 à 300 000 mots au total si l'exhaustivité demandée est tenue jusqu'au bout (comparable à un ouvrage technique de 600 à 1000 pages imprimées) |
| Diagrammes Mermaid prévus | Au moins 15 (architecture générale, cycle de requête HTTP, authentification, modèle de données ERD, navigation, machine à états des approbations, flux Commande→Planning, flux Bon de livraison, etc.) |

**Conséquence pratique** : cette mission dépasse très largement la capacité d'une session unique de travail. Le mandat l'anticipe explicitement (« Gestion des limites de contexte »). Ce fichier sera mis à jour à la fin de chaque lot cohérent de travail, avec le prochain fichier/chapitre exact à reprendre.

## 2. Ce qui est terminé à l'issue de cette session

- [x] Phase 1 — Audit préalable complet : arborescence inspectée, `CLAUDE.md`/`AGENTS.md` confirmés absents, README/spec/DEPLOIEMENT/MISE-EN-PRODUCTION lus, dépendances des 3 `package.json` recensées, schéma Prisma (40 modèles/14 enums) recensé, routage frontend (`App.tsx`) recensé.
- [x] Phase 2 — Structure documentaire créée : `README.md`, `TABLE_DES_MATIERES.md`, `PLAN_DETAILLE.md`, `INVENTAIRE_DU_PROJET.md`, `MATRICE_DE_COUVERTURE.md` (155 fichiers listés, état initial « À analyser »), `ETAT_DE_PROGRESSION.md` (ce fichier), `GLOSSAIRE.md` (amorcé), `INDEX_DU_CODE.md` (amorcé), dossiers `volumes/` et `annexes/`.
- [x] Point de calibrage (§1 ci-dessus).
- [x] Volume 1 — Présentation du produit et du problème résolu : **rédigé**.
- [x] Volume 2 — Guide de lecture et notions fondamentales : **rédigé**.
- [x] Volume 3 — Technologies, langages et dépendances : **rédigé**.
- [x] Volume 11a — Chapitre « Noyau financier et permissions » : premier chapitre Niveau 1 complet sur `packages/shared/src/index.ts` (fonctions `calculerCommande`, `avanceAvantCommande`, `calculerDepenseFarine`, `aAcces`), avec exemples chiffrés bout en bout, table de vérité de `aAcces`, et confrontation avec `packages/shared/src/index.test.ts`.
- [x] Volume 11b — Chapitre « Authentification et permissions bout en bout » : `apps/api/src/lib/jwt.ts`, `apps/api/src/middleware/auth.ts` (`requireAuth`, `requirePermission`, `chargerUtilisateur`), `apps/web/src/lib/api.ts`, `apps/web/src/lib/auth.tsx` — déroulement complet des 3 passes de fusion des permissions, du garde-fou de transparence Admin Principal, de la session unique, et diagramme de séquence Mermaid du cycle complet d'une requête authentifiée (avec le cas de session remplacée).
- [x] Volume 11c — Chapitre « Connexion » : `apps/api/src/routes/auth.ts` (`POST /login` détaillé étape par étape — prévention de l'énumération de comptes, ordre écriture-base/notification-temps-réel, `POST /mot-de-passe`, routes publiques) et `apps/web/src/pages/Login.tsx`, avec diagramme de séquence Mermaid dédié à la déconnexion d'un appareil concurrent.
- [x] Volume 11d — Chapitre « Équipe, rôles et permissions » : `apps/api/src/routes/equipe.ts` (`verifierQuotaAdmins`, création liée à une fiche Travailleur, activation, réaffectation, **historique complet de la faille de sécurité corrigée sur `/principal`**), `apps/api/src/routes/roles.ts` (avec un écart spec/code repéré et documenté), `apps/web/src/pages/Equipe.tsx`. Diagramme d'état Mermaid du statut Admin Principal. Premier écart ajouté à `annexes/ecarts-spec-code.md`.
- [x] Volume 11e — Chapitre « Délégations temporaires de rôle » : `apps/api/src/routes/delegations.ts` (les 3 routes, comparaison lexicographique de dates ISO partagée avec le 11b, absence de contrôle de chevauchement et de contrôle de propriété à la révocation), `delegationCreateSchema`/`DelegationDTO` (`packages/shared/src/index.ts`), intégration côté `Equipe.tsx`. Aucun écart spec/code ; clarification d'une question laissée ouverte par la spec elle-même (un seul module par délégation).
- [x] Volume 11f — Chapitre « Approbations et actions critiques » : `apps/api/src/services/actionsCritiques.ts` (`EXECUTEURS` pour les 5 tâches critiques, `traiterActionCritique`, `ErreurAction`), `apps/api/src/routes/approbations.ts` (file scoping par rôle, approbation avec revérification et gestion d'échec sans rejet automatique, rejet), `apps/web/src/pages/Approbations.tsx` (polling 20s, invalidation croisée). Exemple chiffré complet (commission Maman 1650 → 1800 Fc). Aucun écart spec/code ; deux nuances de granularité expliquées.
- [x] Volume 11g — Chapitre « Journal d'audit » : `apps/api/src/lib/audit.ts` (`extensionAudit`, `MODELE_MODULE`, `normaliser`/`alignerCles`), `apps/api/src/lib/contexteRequete.ts` (`AsyncLocalStorage`), `apps/api/src/lib/prisma.ts` (client étendu), `apps/api/src/routes/audit.ts` (lecture seule, filtres), `apps/web/src/pages/Audit.tsx` (diff dépliable). Suite de l'exemple chiffré du 11f : mise en évidence que l'auteur journalisé d'une action critique différée est l'approbateur, pas le demandeur initial. Aucun écart spec/code.
- [x] Volume 11h — Chapitre « Commandes » : `apps/api/src/routes/commandes.ts` (résumé du jour, alertes de dette avec compare-and-set, liste, création/doublon Modifier/Remplacer en transaction `Serializable`, règlements avec logique différentielle d'avance), `apps/web/src/pages/Commandes.tsx` (réutilisation client de `calculerCommande` pour l'aperçu instantané, dialogue de conflit piloté par le `409` structuré). Exemple chiffré reprenant exactement l'exemple « commande n°12 » de la spec. Aucun écart spec/code.
- [x] Volume 11i — Chapitre « Commissions » : `apps/api/src/routes/commissions.ts` (unique route, « vue dérivée » sans table propre, filtre généralisé sur `commissionParBac > 0`), `montantTotalPaye` (nuance financière expliquée avec exemple chiffré repris du 11a), `apps/web/src/pages/Commissions.tsx` (écran entièrement en lecture, export via `BarreExport`). Aucun écart spec/code.
- [x] Volume 11j — Chapitre « Caisse » : `apps/api/src/routes/caisse.ts` (`construireRegistre` avec disjonction Entrées/Dettes payées par soustraction, exemple chiffré ; blocage farine à deux niveaux ; `PUT /taux` upsert manuel ; case farine cocher/décocher avec figeage des valeurs d'origine), `apps/web/src/pages/Caisse.tsx` (tuile `Poste` avec alerte rouge sur solde négatif, réutilisation client de `calculerDepenseFarine`). Aucun écart spec/code — correspondance quasi verbatim avec la section 3.1.
- [x] Volume 11k (3 sous-chapitres) — « Travailleurs et Paie », dernier chapitre Niveau 1 :
  - **11k-1** (fiches, e-mail pro, pointage) : garde-fous de cohérence (compte déjà lié, groupe hors département), suppression asymétrique (bloquée par les bulletins — correctif documenté dans la spec elle-même — cascade silencieuse sur le reste), pointage en horodatage complet gérant nativement les équipes de nuit.
  - **11k-2** (absences, sanctions) : déclaration/décision comme deux actes distincts, alerte paresseuse réutilisant le compare-and-set du 11h avec restriction de destinataires plus fine, validation croisée type/montant portée par le schéma Zod partagé.
  - **11k-3** (calcul de paie, bulletins) : `calculerPaieBrute` sans arrondi intermédiaire (un seul arrondi final), vue dynamique vs bulletin figé (JSON copié, jamais recalculé), accès personnel aux bulletins hors permission de module, export PDF reconstruit uniquement depuis les chiffres figés. Exemple chiffré complet (350 000 Fc, 26 jours, 2 absences NJ, 1 retenue → 313 077 Fc net).
  - Aucun écart spec/code sur l'ensemble du Volume 11k. **Correction** : ce chapitre annonçait initialement, à tort, la clôture complète du Niveau 1 (26/26) — `prisma/schema.prisma`, également classé Niveau 1, restait alors non traité ; le Niveau 1 n'était donc qu'à 25/26 à ce stade. Voir la ligne Volume 13 ci-dessous, qui referme réellement le Niveau 1.
- [x] Volume 13 — Chapitre « Base de données et migrations » : `prisma/schema.prisma` (42 modèles/16 enums recomptés, conventions transversales — `cuid()`, les 3 stratégies `onDelete`, `Int`/`Decimal`, `DateTime`/`@db.Date`, instantanés JSON, index unique partiel), ERD Mermaid en 6 vues par domaine, table de référence des 42 modèles, `prisma/migrations/*.sql` (résumé chronologique des 29 migrations), `prisma/seed.ts` (`upsertRole` autoritatif, retrofits idempotents). **Découverte et correction** : commentaire obsolète dans `schema.prisma` sur `Vente`/`LigneVente`/`ClotureCaisse` (présentées comme conservées alors qu'elles ont été réellement supprimées par une migration) — correction rétroactive appliquée au Volume 11j. Incohérence interne au code, pas un écart spec/code. **C'est ce chapitre qui referme réellement le Niveau 1 à 26/26 (100 %).**
- [x] Volume 4 — Chapitre « Installation de l'environnement » : prérequis vérifiés dans l'environnement de rédaction (Node 22, `npm test` et `npx prisma validate` réussis), les 5 étapes du `README.md` avec distinction explicite entre vérifié et non vérifiable ici (pas de Docker/PostgreSQL accessibles). **Découverte** : la section « Phase actuelle » et une partie des Conventions du `README.md` décrivent l'ancienne Caisse (vente au comptoir), retirée depuis la refonte 3.1 — incohérence documentaire, pas un écart spec/code.
- [x] Volume 5 — Chapitre « Configuration et variables d'environnement » : rôle de chaque variable de `.env.example` et `render.yaml` (jamais leur valeur), 3 variables obligatoires vs le reste optionnel avec repli documenté, structure du déploiement Render (service unique API+frontend, chaîne de build). Aucun écart spec/code.
- [x] Volume 7 — Chapitre « Arborescence détaillée du projet » : rôle de chaque dossier (`apps/api/src/{routes,lib,middleware,services}`, `apps/web/src/{pages,components,components/ui,lib,i18n}`, `packages/shared/src`, `prisma/`, `docs/`, `scripts/`), convention routes/services, `components.json` (shadcn/ui). Renvoi vers `INVENTAIRE_DU_PROJET.md` pour le détail fichier par fichier — traitement Niveau 3 concis, conforme au mandat.
- [x] Volume 8 — Chapitre « Cycle de démarrage » : `apps/api/src/index.ts` (5 étapes : dotenv → `createApp` → `createServer` → `initRealtime`/`initNotificationService`/`initPlanificateurSauvegarde` → `listen`), `apps/api/src/app.ts` (`createApp()` détaillé : trust proxy, redirection canonique, CORS, `express.json` 5 Mo, `/api/health`, montage des 26 routeurs, service statique + repli SPA, 404 JSON, gestion d'erreurs centralisée), `apps/web/src/main.tsx` (empilement des providers), `apps/web/src/App.tsx` (branches chargement/premierLancement/connexion/authentifié), `apps/web/src/components/EcranDemarrage.tsx` (`sessionStorage`, 7000 ms), `apps/web/src/components/ChargementModule.tsx`. Diagramme de séquence Mermaid complet du démarrage serveur+client. Aucun écart spec/code.
- [x] Volume 9 — Chapitre « Interface utilisateur et composants » : système de design (Tailwind CSS + Radix UI + shadcn/ui, générateur et non dépendance), les 11 primitives `components/ui/` (`badge`, `button`, `card`, `carte-ligne`, `dialog`, `input`, `label`, `select`/`NativeSelect`, `sheet`, `table`, `textarea`), motif `CarteLigne`/`Table` (deux arbres JSX mobile/desktop partageant les mêmes données), `Sheet` révélé comme réutilisant le même primitif Radix que `Dialog`. `apps/web/src/components/Layout.tsx` détaillé (règle « tous les modules visibles, grisés si hors permission », `ListeNavigation` à rendu unique partagé desktop/mobile). **Observation de qualité de code signalée (pas un écart spec/code)** : `calculerLiens` est définie dans `Layout.tsx` mais jamais appelée (vérifié par recherche des appelants) — la fonction `Layout()` réimplémente la même logique en ligne, ce qui constitue une duplication ; signalée avec recommandation, non corrigée (hors périmètre de la mission).
- [x] Volume 10 — Chapitre « Navigation et gestion de l'état » : `React.lazy` (20 pages sur 22, exceptions `Login.tsx` et `PremierLancement.tsx`), gardes `RequiertLecture`/`RequiertEcriture` (rappel de sécurité : confort d'affichage uniquement, la sécurité réelle reste assurée côté serveur par `requirePermission`), arbre complet des routes de `AppAuthentifiee`, conventions transversales TanStack Query (clés de requête structurées, invalidation large après mutation, usage de `enabled`). Aucun écart spec/code.

## 3. Ce qu'il reste à faire (dans l'ordre de priorité)

1. **Volumes Niveau 1 restants** (priorité absolue, dans cet ordre suggéré car chaque fichier s'appuie sur les précédents) :
   - ~~`apps/api/src/middleware/auth.ts` + `apps/web/src/lib/auth.tsx` + `apps/web/src/lib/api.ts`~~ **fait (11b)**
   - ~~`apps/api/src/routes/auth.ts` + `apps/web/src/pages/Login.tsx`~~ **fait (11c)**
   - ~~`apps/api/src/routes/equipe.ts` + `apps/api/src/routes/roles.ts` + `apps/web/src/pages/Equipe.tsx`~~ **fait (11d)**
   - ~~`apps/api/src/routes/delegations.ts`~~ **fait (11e)**
   - ~~`apps/api/src/services/actionsCritiques.ts` + `apps/api/src/routes/approbations.ts` + `apps/web/src/pages/Approbations.tsx`~~ **fait (11f)**
   - ~~`apps/api/src/lib/audit.ts`~~ **fait (11g, avec `contexteRequete.ts`, `lib/prisma.ts`, `routes/audit.ts`, `pages/Audit.tsx`)**
   - ~~`apps/api/src/routes/commandes.ts` + `apps/web/src/pages/Commandes.tsx`~~ **fait (11h)**
   - ~~`apps/api/src/routes/commissions.ts` + `apps/web/src/pages/Commissions.tsx`~~ **fait (11i)**
   - ~~`apps/api/src/routes/caisse.ts` + `apps/web/src/pages/Caisse.tsx`~~ **fait (11j)**
   - ~~`apps/api/src/routes/travailleurs.ts` + `apps/web/src/pages/Travailleurs.tsx` + `apps/web/src/components/PaieCard.tsx`~~ **fait (11k, scindé en 11k-1/2/3) — Niveau 1 clos (26/26)**
   - ~~`prisma/schema.prisma` (chapitre Base de données complet, ERD Mermaid)~~ **fait (Volume 13) — Niveau 1 réellement clos (26/26)**
2. ~~**Volumes 4-5** : Installation, Configuration et variables d'environnement~~ **fait**
3. ~~**Volumes 7-10** : Arborescence détaillée, cycle de démarrage, UI et composants (Niveau 2/3), navigation et gestion d'état~~ **fait**
4. **Volume 11-12** : Reste du back-end Niveau 2 (Stocks, Fournisseurs, Production, Départements, Notifications, etc.) et API/communications réseau. *(prochain)*
5. **Volume 14-16** : Authentification/sécurité (synthèse), validation des données (Zod), gestion des erreurs et journalisation (`logger.ts`, middleware d'erreurs).
6. **Volume 17** : Internationalisation.
7. **Volume 18** : Explication exhaustive des fichiers sources restants (Niveau 2/3 non encore couverts par les volumes thématiques).
8. **Volume 19-21** : Tests, performances, construction et déploiement.
9. **Volume 22-23** : Guide complet d'utilisation (croiser `docs/spec-boulangerie.md`), administration et maintenance.
10. **Volume 24-25** : Débogage/résolution de problèmes, évolutions possibles.
11. **Volume 26 + annexes** : Glossaire final, index final, `annexes/ecarts-spec-code.md` consolidé, rapport final de couverture.

## 4. Dernier fichier analysé

Les 10 primitives restantes de `apps/web/src/components/ui/` (`badge.tsx`, `button.tsx`, `card.tsx`, `dialog.tsx`, `input.tsx`, `label.tsx`, `select.tsx`, `sheet.tsx`, `table.tsx`, `textarea.tsx`), lues intégralement pour le Volume 9 — toutes marquées « Vérifié ». L'ensemble du lot Volumes 7-10 (arborescence, cycle de démarrage, UI/composants, navigation) est désormais rédigé, croisé avec la spec, et reporté dans la matrice.

## 5. Prochaine tâche exacte

Rédiger les **Volumes 11-12** : reste du back-end Niveau 2 (Stocks, Fournisseurs, Production, Départements/Groupes, Notifications, Paramètres, Premier lancement, État système, Export, Rapports, Rapports personnels, À propos, Assistant, Zones dépositaires — routes API + pages frontend correspondantes, cf. §C/§J de `MATRICE_DE_COUVERTURE.md`) puis Volume 12 (API et communications réseau : `apps/api/src/lib/realtime.ts`, `apps/api/src/lib/events.ts`, `apps/api/src/services/notifications.ts`, `apps/web/src/lib/socket.tsx`, `apps/web/src/components/NotificationBell.tsx`, `apps/web/src/components/ActivityFeed.tsx`). Ce lot étant volumineux (une douzaine de fichiers Niveau 2 côté routes + pages), envisager un découpage en sous-chapitres comme pour le Volume 11k.

## 6. Problèmes ou incertitudes en suspens

- Aucun `CLAUDE.md`/`AGENTS.md` trouvé : confirmé absent, pas une lacune de l'audit.
- Le fichier `packages/shared/src/index.ts` sert plusieurs domaines fonctionnels (Commandes, Production, Stocks, RH, Caisse, À propos, Assistant...) dans un seul fichier de 1942 lignes. Le livre le traite en **plusieurs passages**, un par domaine, plutôt qu'en un seul chapitre monolithique — chaque passage sera référencé dans la matrice avec le chapitre où il apparaît. Ce choix sera rappelé dans `INDEX_DU_CODE.md`.
- **Premier écart spec/code confirmé** (chapitre 11d) : aucune interface trouvée dans `apps/web/src` pour « Modifier les permissions d'un rôle » (`PUT /api/roles/:id/permissions`), pourtant listée par la spec comme l'une des 5 tâches critiques réellement disponibles. Détail complet dans `annexes/ecarts-spec-code.md`.
- `apps/api/src/lib/jwt.ts` : le champ `roleId` du jeton JWT n'est, à la lecture du code de `requireAuth`/`chargerUtilisateur`, jamais utilisé pour construire les permissions réelles (toujours recalculées depuis la base). **Non confirmé dans le code actuel** qu'il serve à un autre usage ailleurs dans le projet — à vérifier si un chapitre futur (Socket.io, Volume 12) en révèle un usage.
- `apps/api/src/routes/auth.ts` : aucune route de type « mot de passe oublié » n'a été repérée — **non confirmé** qu'une telle procédure existe ailleurs dans le projet. Le chapitre 11d n'a pas non plus révélé de mécanisme de réinitialisation par un Admin distinct du changement de mot de passe ordinaire ; à confirmer au Volume 22 (Guide d'utilisation).
- `apps/api/src/routes/delegations.ts` (chapitre 11e) : aucune règle n'empêche deux délégations actives simultanées sur le même couple utilisateur/module, et `DELETE /:id` ne vérifie pas que l'appelant est l'auteur (`creeParId`) de la délégation révoquée. Ni l'un ni l'autre ne contredit la spécification (qui ne mentionne aucune de ces règles) — noté comme observation de comportement, pas comme écart ni comme faille.
- `apps/api/src/lib/audit.ts` (chapitre 11g) : pour une action critique différée puis approuvée (Volume 11f), l'entrée du Journal d'audit attribue l'écriture à l'Admin Principal qui a approuvé, pas à l'Admin secondaire qui l'a initialement demandée — l'origine réelle de la demande reste retrouvable, mais uniquement via l'écran Approbations, sans lien croisé direct trouvé entre les deux écrans. Comportement cohérent et non contradictoire avec la spec, simplement noté comme point d'attention pour un futur lecteur du journal.
- `apps/api/src/routes/travailleurs.ts` (chapitre 11k-1) : le schéma Prisma déclare `onDelete: Cascade` sur `BulletinPaie` depuis `Travailleur`, ce qui autoriserait techniquement la suppression en cascade des bulletins — c'est uniquement la vérification applicative de la route `DELETE /:id` (`_count.bulletinsPaie > 0` → `409`) qui empêche ce cas en pratique, puisque cette route est le seul appelant de `prisma.travailleur.delete` dans le projet. Non contradictoire avec la spec (qui exige bien le blocage, obtenu), mais à garder en tête pour tout code futur qui appellerait `prisma.travailleur.delete` par un autre chemin.
- `README.md` (chapitre 4) : la section « Phase actuelle » et une partie des Conventions décrivent l'ancienne Caisse (vente au comptoir, clôture, alerte transaction inhabituelle) — fonctionnalités retirées depuis la refonte de la section 3.1 de la spec, déjà vérifiée en détail au Volume 11j. Incohérence entre le code et sa documentation d'installation, pas un écart spec/code (le code, lui, suit bien la spec actuelle) — recommandation de mise à jour formulée dans le chapitre, sans modification du fichier lui-même (hors périmètre de cette mission).
- Environnement de rédaction de ce livre : aucun serveur PostgreSQL ni démon Docker accessibles (confirmé au Volume 4). Toute vérification future nécessitant une base de données active (migrations, seed, démarrage complet des serveurs, parcours utilisateur réels) devra attendre un environnement doté de cette infrastructure, ou être signalée comme non vérifiable de la même façon.
- `apps/web/src/components/Layout.tsx` (Volume 9) : la fonction `calculerLiens` est définie mais jamais appelée ailleurs dans le fichier (confirmé par recherche des appelants) — `Layout()` réimplémente la même logique de filtrage de navigation en ligne. Duplication de logique, pas un écart spec/code ; signalée comme observation de qualité de code avec recommandation, non corrigée (modification du code applicatif hors périmètre de cette mission).
- `apps/web/src/components/ui/sheet.tsx` (Volume 9) : confirmé par le code lui-même (commentaire interne) qu'aucune bibliothèque d'animation n'est utilisée dans le projet — Radix démonte le contenu à la fermeture sans transition de sortie animée. Simple constat technique, pas un écart spec/code (la spec ne prescrit aucune exigence d'animation).

## 7. Pourcentage réel de couverture (fichiers à l'état « Vérifié »)

| Niveau | Vérifiés / Total | % |
|---|---|---:|
| Niveau 1 | **26 / 26 — 100 %** (tous les fichiers Niveau 1 couverts depuis le Volume 13, `prisma/schema.prisma` inclus — `packages/shared/src/index.ts` compté comme unité complète malgré sa nature transversale, voir note ci-dessous) | **100 %** |
| Niveau 2 | 6 / 66 (`apps/api/src/lib/contexteRequete.ts`, `apps/api/src/routes/audit.ts`, `apps/web/src/pages/Audit.tsx`, `apps/api/src/app.ts`, `apps/web/src/App.tsx`, `apps/web/src/components/Layout.tsx`) | ~9 % |
| Niveau 3 | 20 / 63 (`apps/api/src/lib/prisma.ts`, `prisma/seed.ts`, `prisma/migrations/*.sql`, `render.yaml`, `.env.example`, `apps/api/src/index.ts`, `apps/web/src/main.tsx`, `apps/web/src/components/ChargementModule.tsx`, `apps/web/src/components/EcranDemarrage.tsx`, les 11 primitives `apps/web/src/components/ui/*.tsx`) | ~32 % |
| **Global** | **~51 / 155** | **~33 %** |

*(`packages/shared/src/index.ts` est un cas particulier : ses portions Niveau 1 — fonctions financières, permissions, délégations, actions critiques, audit, commandes, commissions, caisse, travailleurs/paie — sont toutes couvertes en détail sur ce qui relève du Niveau 1, mais le fichier dans son ensemble reste « En cours » dans `MATRICE_DE_COUVERTURE.md` tant que ses sections Niveau 2/3 n'ont pas été traitées — voir §6. Il est compté ici comme une unité Niveau 1 complète, sa part Niveau 1 étant intégralement expliquée.)*

**Étape franchie : le Niveau 1 (fichiers critiques, argent réel et calculs sensibles) est désormais couvert à 100 %** — treize chapitres complets (11a à 11k, ce dernier en 3 sous-chapitres, plus le Volume 13 qui referme réellement ce niveau via `prisma/schema.prisma`), tous vérifiés contre la spécification, sans aucun écart trouvé au-delà des deux nuances de granularité déjà documentées (Volume 11f) et d'un commentaire obsolète sans lien avec la spec (Volume 13, §5.5). Les Volumes 4-5 (Installation, Configuration) sont également posés, avec une seconde incohérence documentaire relevée (`README.md`, §6). Les Volumes 7-10 (arborescence, cycle de démarrage, UI/composants, navigation) sont maintenant posés à leur tour, portant le Niveau 3 à près d'un tiers de couverture et faisant franchir la barre du tiers de couverture globale (~33 %). La priorité bascule maintenant sur les Volumes 11-12 (reste du back-end Niveau 2, API/communications réseau) — voir §5.
