# Zones d'ombre — Audit du 4 septembre 2026

> Ce document liste ce qui est ambigu, sous-testé ou risqué architecturalement — même quand ça « marche »
> aujourd'hui. Il ne remet en cause aucune fonctionnalité listée « Complet » dans `ETAT_PAR_MODULE.md` :
> une chose peut être entièrement construite et rester une zone d'ombre (couverture de test insuffisante,
> dépendance externe non vérifiée récemment, documentation qui a pris du retard sur le code).

## 1. Branche Neon nommée « production » — risque signalé, non vérifiable depuis le dépôt

**Constat** : recherche exhaustive dans tout `docs/`, `DEPLOIEMENT.md` et `render.yaml` (grep `neon`,
`branche`) — **aucune trace** du risque précis signalé (une branche Neon nommée « production » vide, les
données réelles vivant sur une branche à nom temporaire). Ce que le dépôt documente réellement sur Neon est
un risque **différent** : la fenêtre PITR de l'offre gratuite (6h, `DEPLOIEMENT.md:94-99`) et un risque de
**nom de base** (`neondb`, ambigu entre projets) déjà corrigé côté script de restauration
(`DEPLOIEMENT.md:225-234`, exige désormais hôte+port+base). `render.yaml` ne référence aucun nom de branche
Neon — la sélection de branche se fait entièrement côté tableau de bord Neon, hors du dépôt.

**Conséquence** : ce point ne peut être ni confirmé ni infirmé par une lecture du code ou de la
documentation existante. Cette session n'a — et ne doit pas avoir — d'accès aux services Render/Neon/
Cloudflare (interdiction permanente rappelée dans les instructions de ce projet).

**À faire** : vérifier directement dans la console Neon quelle branche porte réellement `DATABASE_URL` de
production, et si une branche nommée « production » existe séparément et est effectivement vide. Si le
risque est réel, il devrait être documenté dans `DEPLOIEMENT.md` au même titre que la fenêtre PITR — et
c'est un point sur lequel une réponse rapide (dashboard Neon, pas de code) suffit à trancher.

## 2. Dépendances à des services externes — jamais exercées en conditions réelles par la CI

Pour les trois intégrations externes du projet, la CI ne teste jamais l'appel réel — systématiquement mocké
au niveau service :

| Service | Fichier | Testé réellement en CI ? | Dernière preuve en conditions réelles |
|---|---|---|---|
| Cloudflare Email Routing | `apps/api/src/lib/cloudflareEmail.ts` | Non — `emailPro.js` mocké en bloc (`apps/api/src/routes/premierLancement.test.ts:36`) | Déduite (email pro réellement actif en production), `docs/MISE-EN-PRODUCTION.md:46`, datée du **2026-08-06** |
| Gmail/Nodemailer | `apps/api/src/services/email.ts` | Non — mocké (`apps/api/src/routes/auth.recuperation.test.ts:38-39`) | Vérifiée en direct (`GET /api/export/capacites` → `{"email":true}`), `docs/MISE-EN-PRODUCTION.md:45`, datée du **2026-08-06** |
| Gemini / IA | `apps/api/src/lib/ia.ts` | Non — jamais appelé, aucun test ne référence `lib/ia` | Sans objet : la couche est **désactivée par construction** (`ASSISTANT_IA_ACTIF=false` en production, `render.yaml:70-74`, cohérent avec `docs/spec-boulangerie.md:756`) |

**Pour Gemini, ce n'est pas un risque actuel** : la couche est éteinte par décision documentée et cohérente
(spec + code + configuration de déploiement) — rien à vérifier tant qu'elle reste désactivée. **Pour
Cloudflare et Gmail**, en revanche, les deux seules preuves de fonctionnement réel remontent à environ un
mois (2026-08-06) et n'ont pas été rejouées depuis dans la documentation consultée — ni régression détectée,
ni confirmation récente. Risque faible à modéré (rupture d'envoi d'un email pro ou d'un export par email,
détectable à l'usage mais pas par la CI).

## 3. Flux financiers critiques — bien couverts en base réelle, jamais en navigateur réel

Nuance importante à ne pas mal lire : les trois flux critiques identifiés (confirmation d'un règlement,
clôture de session de caisse, cycle de livraison C4) **sont** testés en conditions réelles au niveau
HTTP+PostgreSQL — ce n'est **pas** une couverture « unitaire seulement ». Chacun dispose d'un script
`scripts/verifier-*-ci.ts` qui monte une vraie base PostgreSQL éphémère et un vrai serveur Express
(`supertest`, `new PrismaClient()`), sans aucun mock de Prisma ni du service :

- Règlement : `scripts/verifier-http-confirmer-reglements-ci.ts`.
- Clôture caisse (verrou de ligne réel `SELECT ... FOR UPDATE`, PID PostgreSQL capturé via `pg_blocking_pids`,
  rollback réel sur échec d'audit) : `scripts/verifier-concurrence-caisse-ci.ts`.
- Cycle de livraison C4 (rollback réel, conflit de sérialisation P2034 réel) : `scripts/verifier-integrite-c4-ci.ts`
  et `scripts/verifier-distribution-ci.ts` (6 scénarios, dont un reliant explicitement C4 à la remise
  contradictoire de Caisse).

Un fichier au nom trompeur mérite d'être signalé : `apps/api/src/routes/cyclesLivraison.parcoursComplet.test.ts`
se présente en commentaire comme un test « bout en bout », mais tourne en réalité sur un état simulé en
mémoire (pas de Prisma réel) — c'est un test unitaire/mocké malgré son nom, à ne pas confondre avec les
scripts `verifier-*-ci.ts` ci-dessus qui, eux, sont authentiquement réels.

**Ce qui manque réellement** : aucun de ces trois flux n'a de couverture **Playwright** (navigateur réel,
parcours utilisateur complet écran par écran). Le seul scénario Playwright existant dans le dépôt
(`apps/web/e2e/connexion.spec.ts`, 3 tests) couvre l'authentification et l'affichage grisé du menu selon le
rôle — rien sur la caisse, le règlement ou la livraison. Le risque concret : un bug d'intégration purement
frontend (mauvais câblage d'un formulaire, mauvaise gestion d'un état de chargement) sur l'un de ces trois
écrans ne serait détecté ni par les tests unitaires, ni par les scripts `verifier-*-ci.ts` (qui appellent
l'API directement, pas l'interface), ni par la CI actuelle.

**Point d'attention complémentaire** : la vérification bout-en-bout de l'éditeur de permissions de rôle
livré cette session (`feat/ui-permissions-role`, PR #50) a bien été faite avec un vrai navigateur Playwright
et de vrais comptes de démo — mais ce script vivait dans un répertoire de travail temporaire, jamais commité
au dépôt sous forme de `*.spec.ts` rejouable. C'est exactement le même schéma que celui déjà signalé par
`README.md` et le livre technique pour une pratique Playwright antérieure (« vérifications ponctuelles non
conservées dans le dépôt ») — un patron récurrent, pas un cas isolé.

## 4. Playwright installé, mais pas branché à la CI

Confirmé cette session : `@playwright/test` figure bien dans `apps/web/package.json:31`, un
`playwright.config.ts` existe, un premier test réel est commité. Mais :

- `apps/web/package.json` ne définit **aucun script** `test:e2e` ni équivalent (seuls `dev`/`build`/`preview`
  existent).
- `.github/workflows/ci.yml` ne contient aucune référence à Playwright ou `e2e` (recherche exhaustive).

**Conséquence concrète** : la suite Playwright existe mais ne s'exécute **jamais automatiquement**. Une
régression sur le seul parcours actuellement couvert (connexion, menu grisé par rôle) ne serait détectée que
si quelqu'un pense à lancer `npx playwright test` manuellement. L'écart historique « Playwright absent » du
livre technique est donc résolu au sens outillage/premier test, mais pas au sens filet de sécurité continu.

## 5. Le livre technique a pris du retard sur le code

`docs/livre-complet/ETAT_DE_PROGRESSION.md` se déclare « complet » et daté du 20/08/2026 (§2 ter). Depuis,
`main-a7fm5x` a reçu environ deux semaines de commits substantiels que le livre ne reflète pas : le Lot P0
sauvegarde/réinitialisation/restauration (30/08), les quatre lots P1 de durcissement transactionnel
(Production, Fournisseurs, Distribution/bons, Travailleurs — 31/08-01/09), le réalignement de
`docs/spec-boulangerie.md`, la correction npm audit, la décision d'infrastructure sauvegarde, et l'éditeur
de permissions de rôle + Playwright (04/09). Deux conséquences concrètes trouvées cette session :

- **Deux affirmations du livre sont aujourd'hui fausses.** `docs/livre-complet/volumes/09-ui-composants.md`
  affirme que `calculerLiens` (`Layout.tsx`) est définie mais jamais appelée — **c'est faux dans le code
  actuel**, confirmé cette session : `Layout.tsx:196` l'appelle bien. Et `docs/livre-complet/annexes/ecarts-spec-code.md`
  liste encore les deux écarts « permissions de rôle » et « Playwright absent » comme ouverts — les deux sont
  résolus (voir `ECARTS_SPEC_CODE.md` de ce dossier).
- Le livre n'a donc **pas** ré-audité les modules durcis par les Lots P1 (Production, Fournisseurs,
  Distribution, Travailleurs) — les nouveaux messages d'erreur de concurrence qu'ils introduisent (voir
  `ECARTS_SPEC_CODE.md`) n'y figurent nulle part.

Ce n'est pas un problème pour la fiabilité du **code** (confirmée indépendamment par cet audit), seulement
pour la fiabilité du **livre** comme référence à jour — à traiter comme une dette documentaire, pas comme un
risque applicatif.

## 6. Décisions d'infrastructure déjà actées (rappel, pas une zone d'ombre nouvelle)

Pour mémoire, deux limites d'infrastructure restent en statu quo **assumé** (décision d'Augustin du
03/09/2026, `DEPLOIEMENT.md:90-106`) : la fenêtre PITR Neon de 6h, et le disque local Render non garanti
persistant. Ce ne sont plus des zones d'ombre au sens de ce document — ce sont des risques connus et
tranchés, listés ici uniquement pour qu'ils restent visibles dans le même document que les points encore
ouverts.
