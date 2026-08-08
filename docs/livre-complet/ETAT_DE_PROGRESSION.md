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

## 3. Ce qu'il reste à faire (dans l'ordre de priorité)

1. **Volumes Niveau 1 restants** (priorité absolue, dans cet ordre suggéré car chaque fichier s'appuie sur les précédents) :
   - ~~`apps/api/src/middleware/auth.ts` + `apps/web/src/lib/auth.tsx` + `apps/web/src/lib/api.ts`~~ **fait (11b)**
   - ~~`apps/api/src/routes/auth.ts` + `apps/web/src/pages/Login.tsx`~~ **fait (11c)**
   - ~~`apps/api/src/routes/equipe.ts` + `apps/api/src/routes/roles.ts` + `apps/web/src/pages/Equipe.tsx`~~ **fait (11d)**
   - ~~`apps/api/src/routes/delegations.ts`~~ **fait (11e)**
   - `apps/api/src/services/actionsCritiques.ts` + `apps/api/src/routes/approbations.ts` + `apps/web/src/pages/Approbations.tsx` *(prochain)*
   - `apps/api/src/lib/audit.ts`
   - `apps/api/src/routes/commandes.ts` + `apps/web/src/pages/Commandes.tsx`
   - `apps/api/src/routes/commissions.ts` + `apps/web/src/pages/Commissions.tsx`
   - `apps/api/src/routes/caisse.ts` + `apps/web/src/pages/Caisse.tsx`
   - `apps/api/src/routes/travailleurs.ts` (985 lignes — probablement scindé en plusieurs chapitres : fiche/pointage, absences/sanctions, salaire/bulletins) + `apps/web/src/pages/Travailleurs.tsx` + `apps/web/src/components/PaieCard.tsx`
   - `prisma/schema.prisma` (chapitre Base de données complet, ERD Mermaid)
2. **Volumes 4-5** : Installation, Configuration et variables d'environnement (peut réutiliser largement `README.md`/`DEPLOIEMENT.md`, à confirmer avec le code).
3. **Volumes 7-10** : Arborescence détaillée, cycle de démarrage, UI et composants (Niveau 2/3), navigation et gestion d'état.
4. **Volume 11-12** : Reste du back-end Niveau 2 (Stocks, Fournisseurs, Production, Départements, Notifications, etc.) et API/communications réseau.
5. **Volume 13** : Base de données et migrations (au-delà du chapitre schéma déjà commencé dans le noyau Niveau 1).
6. **Volume 14-16** : Authentification/sécurité (synthèse), validation des données (Zod), gestion des erreurs et journalisation (`logger.ts`, middleware d'erreurs).
7. **Volume 17** : Internationalisation.
8. **Volume 18** : Explication exhaustive des fichiers sources restants (Niveau 2/3 non encore couverts par les volumes thématiques).
9. **Volume 19-21** : Tests, performances, construction et déploiement.
10. **Volume 22-23** : Guide complet d'utilisation (croiser `docs/spec-boulangerie.md`), administration et maintenance.
11. **Volume 24-25** : Débogage/résolution de problèmes, évolutions possibles.
12. **Volume 26 + annexes** : Glossaire final, index final, `annexes/ecarts-spec-code.md` consolidé, rapport final de couverture.

## 4. Dernier fichier analysé

`apps/api/src/routes/delegations.ts` (chapitre 11e), avec `delegationCreateSchema`/`DelegationDTO` (`packages/shared/src/index.ts`) et l'encart délégations de `apps/web/src/pages/Equipe.tsx` — tous marqués « Vérifié » (le fichier partagé reste « En cours » dans son ensemble, voir §6).

## 5. Prochaine tâche exacte

Rédiger le chapitre **11f — Approbations et actions critiques**, couvrant `apps/api/src/services/actionsCritiques.ts`, `apps/api/src/routes/approbations.ts` et `apps/web/src/pages/Approbations.tsx`. Ce chapitre est central : `traiterActionCritique` a déjà été mentionné sans être détaillé aux volumes 11d (création/suppression de compte Admin) et 11e (justification du choix de ne pas y recourir pour les délégations) — il faut maintenant l'expliquer complètement (déclenchement immédiat pour l'Admin Principal vs création d'une `DemandeApprobation` en attente pour un Admin secondaire, notification de l'Admin Principal, cycle de vie d'une demande : approuver/rejeter, exécution différée de l'action une fois approuvée). Vérifier aussi comment chacune des 5 tâches critiques de la spec (section 2) est effectivement acheminée à travers ce mécanisme, en s'appuyant sur les exemples déjà rencontrés (`CREER_COMPTE_ADMIN` au 11d).

## 6. Problèmes ou incertitudes en suspens

- Aucun `CLAUDE.md`/`AGENTS.md` trouvé : confirmé absent, pas une lacune de l'audit.
- Le fichier `packages/shared/src/index.ts` sert plusieurs domaines fonctionnels (Commandes, Production, Stocks, RH, Caisse, À propos, Assistant...) dans un seul fichier de 1942 lignes. Le livre le traite en **plusieurs passages**, un par domaine, plutôt qu'en un seul chapitre monolithique — chaque passage sera référencé dans la matrice avec le chapitre où il apparaît. Ce choix sera rappelé dans `INDEX_DU_CODE.md`.
- **Premier écart spec/code confirmé** (chapitre 11d) : aucune interface trouvée dans `apps/web/src` pour « Modifier les permissions d'un rôle » (`PUT /api/roles/:id/permissions`), pourtant listée par la spec comme l'une des 5 tâches critiques réellement disponibles. Détail complet dans `annexes/ecarts-spec-code.md`.
- `apps/api/src/lib/jwt.ts` : le champ `roleId` du jeton JWT n'est, à la lecture du code de `requireAuth`/`chargerUtilisateur`, jamais utilisé pour construire les permissions réelles (toujours recalculées depuis la base). **Non confirmé dans le code actuel** qu'il serve à un autre usage ailleurs dans le projet — à vérifier si un chapitre futur (Socket.io, Volume 12) en révèle un usage.
- `apps/api/src/routes/auth.ts` : aucune route de type « mot de passe oublié » n'a été repérée — **non confirmé** qu'une telle procédure existe ailleurs dans le projet. Le chapitre 11d n'a pas non plus révélé de mécanisme de réinitialisation par un Admin distinct du changement de mot de passe ordinaire ; à confirmer au Volume 22 (Guide d'utilisation).
- `apps/api/src/routes/delegations.ts` (chapitre 11e) : aucune règle n'empêche deux délégations actives simultanées sur le même couple utilisateur/module, et `DELETE /:id` ne vérifie pas que l'appelant est l'auteur (`creeParId`) de la délégation révoquée. Ni l'un ni l'autre ne contredit la spécification (qui ne mentionne aucune de ces règles) — noté comme observation de comportement, pas comme écart ni comme faille.

## 7. Pourcentage réel de couverture (fichiers à l'état « Vérifié »)

| Niveau | Vérifiés / Total | % |
|---|---|---:|
| Niveau 1 | 11 / 26 (`packages/shared/src/index.ts` partiellement, `packages/shared/src/index.test.ts`, `apps/api/src/lib/jwt.ts`, `apps/api/src/middleware/auth.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/auth.tsx`, `apps/api/src/routes/auth.ts`, `apps/web/src/pages/Login.tsx`, `apps/api/src/routes/equipe.ts`, `apps/api/src/routes/roles.ts`, `apps/web/src/pages/Equipe.tsx`, `apps/api/src/routes/delegations.ts`) | ~42 % (partiel) |
| Niveau 2 | 0 / 66 | 0 % |
| Niveau 3 | 0 / 63 | 0 % |
| **Global** | **~12 / 155** | **~8 %** |

*(`packages/shared/src/index.ts` est compté comme « partiellement vérifié » : ses fonctions financières, de permission et de délégation sont couvertes en détail, mais le fichier dans son ensemble reste « En cours » tant que ses autres sections n'ont pas été traitées au fil des chapitres correspondants — voir §6. Les 10 autres fichiers Niveau 1 des chapitres 11b à 11e sont, eux, intégralement couverts et comptés comme pleinement « Vérifié ».)*

Ce pourcentage progresse régulièrement : cinq chapitres Niveau 1 complets (11a, 11b, 11c, 11d, 11e) sont maintenant posés, formant le socle sur lequel les chapitres suivants (approbations, commandes...) vont directement s'appuyer sans avoir à répéter les mécanismes déjà expliqués. Le compte réel « 11 / 26 » ci-dessus arrondit `packages/shared/src/index.ts` à une unité complète malgré sa couverture partielle, par simplicité d'affichage — la nuance reste documentée dans cette note.
