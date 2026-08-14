# État réel après la vague 2 — Prévisions et commandes réelles

**Date :** 14 août 2026
**Base auditée :** `main-a7fm5x` @ `312e50542ee36205efd7aec1ac3b9f4b9e4456cb` (worktree propre, vérifié)
**Documents consultés et confrontés au code réel** (pas pris pour acquis) :

- `docs/coordination/PLAN_ATTAQUE_APPLICATION_LOMOTO.md` (v1.1, audit figé au 12/08, base `main` ancienne — sert de référence du circuit métier visé, pas de l'état actuel)
- `docs/coordination/ETAT_REEL_MAIN_A7FM5X.md` (addendum post-F0, toujours globalement exact pour ce qu'il couvre)
- `docs/coordination/PLAN_COORDINATION_CODEX_CLAUDE_LOMOTO.md` v2.0
- `docs/coordination/PLAN_COORDINATION_VAGUE_2_PREVISIONS_COMMANDES.md`, `AUDIT_COURT_VAGUE_2_PREVISIONS_COMMANDES.md`, `PROMPT_CLAUDE_F4_PREVISIONS.md` (branche `agent/coordination-wave-2-previsions-commandes`)
- `docs/api-contracts/C4_PREVISIONS_COMMANDES_REELLES.md`
- `docs/coordination/DETTE_TECHNIQUE_VAGUE_2.md`
- code réel : `prisma/schema.prisma` (49 modèles listés), `apps/api/src/routes/cycles-livraison.ts`, `apps/api/src/services/cyclesLivraison.ts`, `apps/web/src/pages/BonsLivraison.tsx`, `apps/web/src/components/previsions/**`

## 1. Ce qui est réellement terminé (vérifié dans le code, testé, en production de `main-a7fm5x`)

- **Socle applicatif pré-vague 2** (vagues 0-1, C1-C3/F1-F3) : authentification, session unique, rôles/permissions, sécurité HTTP, CI, composants Premium, récupération de mot de passe, anniversaires, notifications temps réel — inchangé par la vague 2, toujours en place.
- **Contrat C4 côté serveur** (`apps/api/src/routes/cycles-livraison.ts`, `apps/api/src/services/cyclesLivraison.ts`) : les onze statuts C4 exacts, les sept transitions (`RETENIR_PRODUCTION` → `CONFIRMER_ACCEPTATION`), verrouillage optimiste par `version`+`statut`, transactions PostgreSQL `Serializable`, idempotence de l'acceptation (`Idempotency-Key` obligatoire, empreinte SHA-256, unicité en base), conversion transactionnelle unique en `CommandeClient`, contrainte unique `clientId`+`dateOperationnelle`, immutabilité financière (`commandes.ts` refuse toute modification manuelle d'une commande issue de C4), audit et événements métier. **Vérifié directement dans le code de ce HEAD, pas seulement dans la documentation.**
- **Lecture frontend connectée** (`GET /api/production/cycles-livraison`) : `BonsLivraison.tsx` affiche pour chaque client le statut C4 réel, et — uniquement quand le serveur les fournit — les résultats accepté/retourné/manquant et le facturable. Aucune donnée simulée.
- **Migration Prisma additive** appliquée et testée (`prisma validate` vert), reprise des `SchemaCommande` existants dans une enveloppe C4 stable sans duplication.
- **Tests** : 466/466 sur ce HEAD (`npm test` réexécuté pendant cet audit).

## 2. Ce qui est seulement préparé (backend prêt, sans interface utilisateur)

Vérifié par recherche exhaustive dans `apps/web/src` : **aucune** des sept actions de transition (`RETENIR_PRODUCTION`, `CONFIRMER_PREPARATION`, `CONFIRMER_REMISE_MAGASIN`, `CONFIRMER_CHARGEMENT`, `CONFIRMER_DEPART`, `SIGNALER_DEPOT`, `CONFIRMER_ACCEPTATION`) n'est appelée depuis le frontend — les seules occurrences sont des noms cités dans des commentaires. Le backend les expose et les teste toutes ; **rien ne permet à un utilisateur de les déclencher depuis l'écran.**

Ceci confirme la priorité proposée pour la vague 3 : le cycle est lisible mais pas exécutable.

## 3. Ce qui est connecté mais uniquement en lecture

- `GET /api/production/cycles-livraison` (statut, quantités, facturable) — lecture seule dans `BonsLivraison.tsx`.
- Aucune commande financière ne peut être créée ni modifiée depuis le navigateur — conforme à l'invariant C4.

## 4. Ce qui reste inutilisable depuis l'interface

- Toute la chaîne de transitions Production → Magasin → Chauffeur → Dépôt → Acceptation : le rôle Production ne peut pas retenir/préparer/remettre/charger/faire partir/signaler un dépôt depuis l'écran ; le rôle Commandes ne peut pas confirmer une acceptation. **C'est l'objet de la vague 3 (F5A/F5B/I5).**
- Concepts explicitement hors du périmètre C4 et non repris ailleurs dans le code : prospects, visites, validation de dépositaire formalisée, contrôle qualité (pertes, recettes liées à la qualité).

## 5. Constats P0/P1/P2/P3 connus à ce stade

| Sévérité | Constat | Statut |
|---|---|---|
| P0/P1 | Aucun connu sur le code fusionné dans `main-a7fm5x` | Zéro — double revue indépendante effectuée à chaque étape de la vague 2 (C4, F4, I4) |
| P2 | Repli `?? 0` sur retourné/manquant dans `BonsLivraison.tsx` (`ResumeCycle`) | Consigné, non corrigé — voir `DETTE_TECHNIQUE_VAGUE_2.md`. **Correctible dans F5A/F5B si ce fichier est retouché.** |
| P2 | Absence d'assertions sémantiques exactes lingala/swahili dans `previsions.i18n.test.ts` | Consigné, non corrigé — nécessite une relecture native, pas encore disponible |
| P3 | Chunk `index-*.js` du build web dépasse 500 kB (avertissement Vite, non bloquant) | Pré-existant, jamais traité, hors périmètre vague 2 |

## 6. Dépendances entre les prochaines tâches

```
F5A (actions Production, PREVISION → EN_ATTENTE_CONFIRMATION)
   │  aucune dépendance non satisfaite : contrat C4, permissions PRODUCTION:ECRITURE,
   │  DTO partagés — tout existe déjà côté serveur.
   ▼
F5B (CONFIRMER_ACCEPTATION, module Commandes)
   │  dépend de F5A pour arriver au statut EN_ATTENTE_CONFIRMATION en conditions réelles,
   │  mais peut être développée en parallèle sur des données de test/mock — pas un blocage dur.
   ▼
I5 (intégration, rebase, tests bout en bout du parcours complet)
   │  dépend de F5A ET F5B fusionnées dans agent/integration-wave-3.
   ▼
PR d'intégration vers main-a7fm5x (brouillon, autorisation Augustin requise pour fusion)
```

Aucune dépendance vers un changement de contrat backend n'est identifiée : le contrat C4 existant couvre exactement les besoins de F5A/F5B (transitions, permissions, idempotence, DTO). Le backend ne sera retouché que si l'implémentation démontre un manque contractuel réel.

## 7. Estimation d'avancement — estimation de coordination, méthode explicite

**Méthode :** notation de chacune des 15 étapes du circuit métier cible décrit dans `PLAN_ATTAQUE_APPLICATION_LOMOTO.md` §1 (« Prospect → … → clôture »), 0 = absent, 0,5 = partiellement construit (backend seul, ou modèle sans flux complet), 1 = utilisable de bout en bout par un rôle réel sans intervention technique.

| Étape | Score | Justification vérifiée |
|---|---|---|
| Prospect | 0 | Aucun modèle Prisma correspondant |
| Dépositaire validé | 0,5 | Gestion Client/Zone existe ; pas de workflow de validation formalisé |
| Prévision | 1 | Schéma de commande + cycle C4, lecture/écriture utilisables |
| Plan de production | 1 | `PlanningProduction` existant, utilisable |
| Lot de production réel | 0,5 | Backend C4 prêt (`RETENIR_PRODUCTION`/`CONFIRMER_PREPARATION`) ; aucune UI |
| Qualité | 0 | Aucun modèle de contrôle qualité |
| Remise au magasin | 0,5 | Backend prêt (`CONFIRMER_REMISE_MAGASIN`) ; aucune UI |
| Chargement | 0,5 | Backend prêt (`CONFIRMER_CHARGEMENT`) ; aucune UI |
| Tournée | 0,5 | Backend prêt (`CONFIRMER_DEPART`) ; aucune UI |
| Livraison acceptée | 0,5 | Backend prêt (`SIGNALER_DEPOT`/`CONFIRMER_ACCEPTATION`), lecture seule côté UI |
| Montant facturable | 1 | Calculé et affiché correctement dès que le serveur le fournit |
| Paiement officiel | 1 | `PaiementCommande` pré-existant, réutilisé sans modification pour les commandes C4 |
| Argent transporté | 0,5 | Type d'anomalie `CASH_TRANSPORTE_NON_RECU` existe pour signalement ; pas de suivi dédié |
| Remise contradictoire à la caisse | 0,5 | `SessionCaisse`/`RemiseCaisse` existent au schéma (pré-vague 2) ; complétude UI non revérifiée dans cet audit |
| Clôture de caisse | 0,5 | Idem — modèle présent, non revérifié en profondeur ici |

**Somme : 8,5 / 15 ≈ 57 %** de ce circuit-cœur est *construit* (backend et/ou frontend, au moins partiellement).

**Lecture alternative, plus stricte** — seules les étapes utilisables de bout en bout sans intervention technique (score = 1) : Prévision, Plan de production, Montant facturable, Paiement = **4/15 ≈ 27 %** réellement opérationnel pour un utilisateur final aujourd'hui.

**Écart avec l'estimation de coordination (~49-50 %) :** cette estimation-ci ne porte que sur le circuit métier cœur (15 étapes de `PLAN_ATTAQUE`) et ignore volontairement tout le reste de l'application déjà livré et opérationnel (caisse comptoir, stocks, fournisseurs, travailleurs/paie, équipe/permissions, rapports/exports, état système/sauvegardes, assistant, support, i18n 4 langues) — un périmètre substantiel non compté ici. Le chiffre de 49-50 % semble intégrer cette base applicative plus large ; **57 % (construit) / 27 % (opérationnel) ne remplace pas cette estimation, ils éclairent un sous-ensemble précis (le circuit prévision→paiement) avec une méthode reproductible.** Je recommande de traiter les deux lectures comme complémentaires plutôt que contradictoires, et de laisser Augustin trancher le chiffre de référence à communiquer.

---

## 8. Mise à jour après F5A + F5B + I5 (14 août 2026)

**Les sections 1 à 7 ci-dessus décrivent l'état constaté juste après la vague 2, avant la vague 3 — elles sont conservées telles quelles comme référence historique de l'audit initial.** Cette section documente ce qui a changé depuis.

**Base auditée pour cette mise à jour :** `agent/integration-wave-3` @ `9204adf10fface43f082310bd6be09a5d4c2e49a` (F5A fusionnée via PR #15, F5B fusionnée via PR #16, ancestralité et absence d'écart de contenu vérifiées à chaque fusion).

### 8.1 Ce qui est passé de « préparé » à « réellement utilisable »

Les sept transitions du cycle C4, listées en section 2 comme inaccessibles depuis l'écran, le sont désormais toutes :

- **F5A** (`BonsLivraison.tsx`, permission `PRODUCTION:ECRITURE`) : `RETENIR_PRODUCTION`, `CONFIRMER_PREPARATION`, `CONFIRMER_REMISE_MAGASIN`, `CONFIRMER_CHARGEMENT`, `CONFIRMER_DEPART`, `SIGNALER_DEPOT` — un bouton d'action apparaît sur chaque ligne cliente dont le statut a une action Production suivante, masqué si l'utilisateur n'a pas la permission.
- **F5B** (`/commandes/acceptations`, permission `COMMANDES:ECRITURE`) : `CONFIRMER_ACCEPTATION` — seule action pouvant créer une commande facturable, avec idempotence obligatoire côté client et serveur, saisie accepté/retourné séparée par produit, jamais de manquant saisi côté client.
- **I5** : un test d'intégration bout en bout (`apps/api/src/routes/cyclesLivraison.parcoursComplet.test.ts`) enchaîne réellement les sept transitions sur un état simulé persistant entre les appels (pas un état refabriqué à chaque étape comme dans les tests unitaires existants) — vérifie que chaque étape lit correctement ce que la précédente a laissé, que la version s'incrémente à chaque transition, et que la commande facturable finale porte le bon montant. Couvre aussi le rejet d'une transition hors ordre et d'une version obsolète sans écrasement silencieux.

### 8.2 Ce qui reste inchangé

- Le backend C4 n'a été modifié ni par F5A, ni par F5B, ni par I5 — aucun manque contractuel n'a été démontré.
- Les concepts hors périmètre C4 (prospects, visites, validation de dépositaire formalisée, contrôle qualité) restent absents, comme en section 4.
- Le repli `?? 0` (P2, section 5) a été corrigé en F5A (tiret distinct) — voir `DETTE_TECHNIQUE_VAGUE_2.md`, item 1 marqué résolu.
- Les assertions sémantiques lingala/swahili (P2, section 5) restent en attente d'une relecture native — non traitées, comme annoncé.

### 8.3 Constats P0/P1/P2/P3 après F5A + F5B + I5

| Sévérité | Constat | Statut |
|---|---|---|
| P0/P1 | Aucun connu sur `agent/integration-wave-3` | Zéro — double revue indépendante à chaque tranche (F5A, F5B), CI verte à chaque fusion |
| P2 | Repli `?? 0` sur retourné/manquant | **Résolu en F5A** |
| P2 | Assertions sémantiques lingala/swahili | Toujours en attente d'une relecture native |
| P3 | Chunk `index-*.js` du build web > 500 kB | Pré-existant, toujours non traité, hors périmètre |

### 8.4 Estimation d'avancement réactualisée — même méthode, même circuit-cœur de 15 étapes

Seules les étapes directement concernées par F5A/F5B changent de score ; les dix autres restent identiques à la section 7 (méthode inchangée : 0 = absent, 0,5 = partiellement construit, 1 = utilisable de bout en bout par un rôle réel).

| Étape | Score avant vague 3 | Score après F5A+F5B+I5 | Justification du changement |
|---|---|---|---|
| Lot de production réel | 0,5 | **1** | `RETENIR_PRODUCTION`/`CONFIRMER_PREPARATION` exécutables depuis l'écran (F5A) |
| Remise au magasin | 0,5 | **1** | `CONFIRMER_REMISE_MAGASIN` exécutable depuis l'écran (F5A) |
| Chargement | 0,5 | **1** | `CONFIRMER_CHARGEMENT` exécutable depuis l'écran, chauffeur saisi (F5A) |
| Tournée | 0,5 | **1** | `CONFIRMER_DEPART` exécutable depuis l'écran (F5A) |
| Livraison acceptée | 0,5 | **1** | `SIGNALER_DEPOT` (F5A) et `CONFIRMER_ACCEPTATION` (F5B) tous deux exécutables depuis l'écran, parcours bout en bout vérifié par test d'intégration (I5) |

**Nouvelle somme : 11 / 15 ≈ 73 %** de ce circuit-cœur est construit (contre 57 % avant la vague 3).

**Lecture stricte réactualisée** (score = 1 uniquement, utilisable de bout en bout sans intervention technique) : Prévision, Plan de production, Lot de production réel, Remise au magasin, Chargement, Tournée, Livraison acceptée, Montant facturable, Paiement = **9/15 ≈ 60 %** réellement opérationnel pour un utilisateur final (contre 27 % avant la vague 3).

Ce qui reste à 0 ou 0,5 sur ce circuit-cœur (Prospect, Dépositaire validé, Qualité, Argent transporté, Remise contradictoire à la caisse, Clôture de caisse) est **hors du périmètre F5A/F5B/I5** — aucune de ces étapes n'a été touchée par la vague 3, et cette estimation ne prétend pas le contraire. Comme en section 7, ce chiffre porte uniquement sur le circuit prévision→paiement et ignore volontairement le reste de l'application déjà livré ; il reste complémentaire, pas substitutif, à l'estimation de coordination globale.

### 8.5 Prochaine étape

I5 est fonctionnellement terminée (test d'intégration bout en bout vert, aucune régression, 0 P0/P1). Une PR brouillon vers `agent/integration-wave-3` sera ouverte pour cette dernière tranche. **Aucune fusion vers `main-a7fm5x` n'a été faite ni n'est prévue sans nouvelle autorisation explicite d'Augustin** — la vague 3 reste entièrement contenue dans `agent/integration-wave-3` en attendant cette décision.
