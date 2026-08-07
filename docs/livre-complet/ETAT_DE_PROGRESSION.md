# État de progression — Livre technique Boulangerie Lomoto

> À lire en premier au début de toute nouvelle session de travail sur ce livre, avec `MATRICE_DE_COUVERTURE.md` et `TABLE_DES_MATIERES.md`.

## Session en cours

**Date** : 2026-08-07
**Commit de référence** : `ffe2e749ee1b6b5fcb39b69303f6518df5a65370` (branche `main-a7fm5x`)

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
- [x] Volume 6 (partiel) — Chapitre « Noyau financier et permissions » : premier chapitre Niveau 1 complet sur `packages/shared/src/index.ts` (fonctions `calculerCommande`, `avanceAvantCommande`, `calculerDepenseFarine`, `aAcces`), avec exemples chiffrés bout en bout, table de vérité de `aAcces`, et confrontation avec `packages/shared/src/index.test.ts`.

## 3. Ce qu'il reste à faire (dans l'ordre de priorité)

1. **Volumes Niveau 1 restants** (priorité absolue, dans cet ordre suggéré car chaque fichier s'appuie sur les précédents) :
   - `apps/api/src/middleware/auth.ts` + `apps/web/src/lib/auth.tsx` + `apps/web/src/lib/api.ts` (authentification/permissions bout en bout, front + back)
   - `apps/api/src/routes/auth.ts` + `apps/web/src/pages/Login.tsx`
   - `apps/api/src/routes/equipe.ts` + `apps/api/src/routes/roles.ts` + `apps/web/src/pages/Equipe.tsx`
   - `apps/api/src/routes/delegations.ts`
   - `apps/api/src/services/actionsCritiques.ts` + `apps/api/src/routes/approbations.ts` + `apps/web/src/pages/Approbations.tsx`
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

`packages/shared/src/index.ts` (fonctions financières et `aAcces` uniquement — le reste du fichier, DTO/Zod des autres modules, reste « À analyser » et sera couvert au fil des chapitres correspondants, car ce fichier sert plusieurs domaines à la fois).

## 5. Prochaine tâche exacte

Rédiger le chapitre **Authentification et permissions bout en bout** couvrant ensemble `apps/api/src/middleware/auth.ts`, `apps/web/src/lib/auth.tsx` et `apps/web/src/lib/api.ts` — ces trois fichiers forment un seul mécanisme cohérent (jeton → vérification → contexte React → gardes de route) et gagnent à être expliqués comme un tout, avec un diagramme de séquence Mermaid du cycle complet d'une requête authentifiée.

## 6. Problèmes ou incertitudes en suspens

- Aucun `CLAUDE.md`/`AGENTS.md` trouvé : confirmé absent, pas une lacune de l'audit.
- Le fichier `packages/shared/src/index.ts` sert plusieurs domaines fonctionnels (Commandes, Production, Stocks, RH, Caisse, À propos, Assistant...) dans un seul fichier de 1942 lignes. Le livre le traite en **plusieurs passages**, un par domaine, plutôt qu'en un seul chapitre monolithique — chaque passage sera référencé dans la matrice avec le chapitre où il apparaît. Ce choix sera rappelé dans `INDEX_DU_CODE.md`.
- Aucun écart entre code et spec n'a encore été confirmé à ce stade (seuls les fichiers Niveau 1 du noyau financier ont été croisés avec la spec jusqu'ici, et ils correspondent). Le registre `annexes/ecarts-spec-code.md` est créé mais vide pour l'instant — il se remplira au fil des chapitres.

## 7. Pourcentage réel de couverture (fichiers à l'état « Vérifié »)

| Niveau | Vérifiés / Total | % |
|---|---|---:|
| Niveau 1 | 2 / 26 (`packages/shared/src/index.ts` partiellement, `packages/shared/src/index.test.ts`) | ~8 % (partiel) |
| Niveau 2 | 0 / 66 | 0 % |
| Niveau 3 | 0 / 63 | 0 % |
| **Global** | **~2 / 155** | **~1 %** |

*(`packages/shared/src/index.ts` est compté comme « partiellement vérifié » : ses fonctions financières et de permission sont couvertes en détail, mais le fichier dans son ensemble reste « En cours » tant que ses autres sections n'ont pas été traitées au fil des chapitres correspondants — voir §6.)*

Ce pourcentage est délibérément bas à ce stade : la priorité de cette première session a été de poser une fondation solide (scaffold complet + le fichier le plus transverse de tout le projet) plutôt que de viser une couverture large et superficielle.
