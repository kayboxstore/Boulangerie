# Volume 19 — Tests et stratégie de vérification

> Chapitre de synthèse transversale, à l'instar des Volumes 6, 14, 15 et 16. Il ne présente aucun nouveau fichier de code au sens strict — `packages/shared/src/index.test.ts` a déjà été détaillé ligne à ligne au Volume 11a, et `vitest.config.ts` au Volume 18d — mais prend du recul sur **la stratégie de test du projet dans son ensemble** : ce qui est automatisé, ce qui est vérifié manuellement, et ce qui ne l'est ni l'un ni l'autre. Conformément au mandat, ce chapitre distingue explicitement le vérifié du non vérifié plutôt que de présenter une image plus flatteuse que la réalité du dépôt.

## 1. Vérification pratique effectuée pour ce chapitre

Avant de décrire la stratégie de test, elle a été exécutée réellement dans l'environnement de rédaction de ce livre :

```
$ npm test
> vitest run
 ✓ packages/shared/src/index.test.ts (11 tests) 13ms
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

Les 11 tests passent. C'est la seule suite de tests automatisée qui existe dans l'ensemble du dépôt à ce jour — confirmé par une recherche exhaustive de fichiers `*.test.ts`/`*.spec.ts` sur tout le projet (hors `node_modules`), qui n'en retourne qu'un seul.

## 2. Ce qui EST automatisé : `packages/shared/src/index.test.ts`

Déjà expliqué en détail au Volume 11a (chaque assertion, chaque cas limite) — ce chapitre en résume seulement la portée stratégique. 11 tests Vitest, répartis en 3 groupes, tous portant sur des **fonctions pures** de `packages/shared/src/index.ts` :

| Groupe | Nombre de tests | Ce qu'il couvre |
|---|---:|---|
| `calculerCommande` (section 3.4) | 5 | Sans avance ni dette, avance existante déduite, avance plafonnée au montant brut (jamais négative), dette générée si reçu insuffisant, trop-perçu devenant avance |
| `calculerDepenseFarine` | 2 | Calcul et arrondi au franc, cas zéro sac → zéro dépense quel que soit le taux |
| `aAcces` (matrice de permissions) | 4 | ÉCRITURE implique LECTURE, LECTURE seule n'accorde pas ÉCRITURE, AUCUN refuse les deux, module absent de la liste équivaut à AUCUN |

Le choix de ce périmètre — trois fonctions précises sur les dizaines que compte `packages/shared/src/index.ts` — n'est pas arbitraire : ce sont exactement les fonctions **financières et de sécurité les plus critiques** du projet (Niveau 1 au sens de la grille de classification de ce livre, `INVENTAIRE_DU_PROJET.md` §2), celles où une erreur de calcul aurait un impact direct sur l'argent réel de l'entreprise (avance/dette client) ou sur le contrôle d'accès (permissions). C'est cohérent avec la nature des fonctions elles-mêmes, déjà établie au Volume 11a : ce sont des **fonctions pures** (mêmes entrées → même sortie, aucun effet de bord, pas d'appel réseau ni d'écriture en base) — le profil de code le plus simple et le moins coûteux à tester unitairement, sans base de données ni serveur à faire tourner.

## 3. `vitest.config.ts` : dimensionné pour une croissance qui n'a pas encore eu lieu

Déjà montré au Volume 18d :

```ts
export default defineConfig({
  test: { include: ["packages/**/*.test.ts", "apps/**/*.test.ts"] },
});
```

Le motif `include` balaie l'ensemble du monorepo (`packages/` **et** `apps/`), alors qu'à ce jour aucun fichier `apps/api/**/*.test.ts` ni `apps/web/**/*.test.ts` n'existe — seul `packages/shared/src/index.test.ts` est actuellement découvert par cette configuration. Ce n'est pas une incohérence : c'est une configuration volontairement large, prête à accueillir des tests futurs dans `apps/api` (par exemple des tests de routes avec une base de test) ou `apps/web` (tests de composants) sans modification nécessaire du fichier de configuration lui-même le jour où de tels tests seraient ajoutés.

## 4. Ce qui N'EST PAS automatisé : routes API, frontend, et bout en bout

Aucun des éléments suivants ne dispose d'un test automatisé, à la date de cet audit :

- **Aucune route API** — ni `apps/api/src/routes/*.ts` (29 routeurs), ni les services qu'elles appellent (`services/*.ts`), ne sont couverts par un test d'intégration ou unitaire. Chaque route a été **vérifiée manuellement** par lecture de code au fil des chapitres de ce livre (croisement systématique avec `docs/spec-boulangerie.md`), mais aucune de ces vérifications n'est rejouable automatiquement.
- **Aucun composant frontend** — les 22 pages et 13 composants de `apps/web/src` (hors `ui/`) ne disposent d'aucun test de rendu ni d'interaction (pas de React Testing Library, pas de tests de composants isolés).
- **Aucun parcours de bout en bout automatisé** — malgré la mention explicite de Playwright dans la spec (§5 ci-dessous), aucun fichier de test Playwright, aucune configuration (`playwright.config.ts`), et aucune dépendance `@playwright/test` n'existent dans le dépôt à ce jour (vérifié par recherche exhaustive dans les trois `package.json` et sur l'ensemble de l'arborescence).

### 4.1 Ce que le `README.md` reconnaît déjà lui-même

Le `README.md` du projet (déjà lu au Volume 4) est transparent sur ce point précis, dans sa section « Tests » :

> « Tests unitaires (Vitest) sur les chemins critiques du package partagé... Ne couvre pas les routes API ni le frontend — les parcours complets restent vérifiés manuellement (voir historique des commits pour les vérifications E2E Playwright réalisées à chaque fonctionnalité). »

Ce passage révèle une pratique de développement réelle mais **non conservée dans le dépôt** : Playwright a bien été utilisé, à en croire ce commentaire, pour vérifier manuellement chaque fonctionnalité au moment de son développement (probablement via une exécution ponctuelle, hors du contrôle de version) — mais aucune trace de cette pratique ne subsiste sous forme de fichiers de test rejouables. Autrement dit : la vérification a eu lieu, mais elle n'est pas **répétable** — un futur changement de code pourrait casser silencieusement un parcours déjà validé une fois, sans qu'aucune commande automatisée ne le détecte.

## 5. Écart entre la spec et le code : Playwright recommandé, jamais installé

La spec (section 7, « Stack technique recommandée ») liste explicitement :

| Couche | Choix | Pourquoi |
|---|---|---|
| Tests | Vitest (unitaires) + **Playwright (E2E)** | Standard, bien supporté par Claude Code |

Le code ne contient **aucune trace installée** de Playwright : ni dans `apps/web/package.json` (dépendances vérifiées au Volume 18d — aucune mention de `@playwright/test` ni de `playwright`), ni dans `apps/api/package.json`, ni à la racine, ni aucun fichier `playwright.config.ts` ou `*.spec.ts` nulle part dans le dépôt. Le `README.md` confirme cette absence en creux (§4.1 ci-dessus) : les vérifications Playwright évoquées appartiennent à « l'historique des commits », pas au dépôt tel qu'il se présente aujourd'hui.

Il s'agit d'un candidat légitime à un écart spec/code au sens du mandat de ce livre — la colonne « Choix » de la spec liste Playwright au même titre que Vitest, sans distinguer les deux par un degré de priorité différent, alors que seul Vitest a été effectivement conservé dans le dépôt comme outil installé et exécutable. Consigné dans `annexes/ecarts-spec-code.md` conformément à la règle du mandat — ni la spec ni le code ne sont présumés avoir raison, la question reste ouverte pour l'équipe.

## 6. Ce qui a été vérifié « manuellement » au fil de ce livre — et les limites de cette vérification

Ce livre a lui-même appliqué, chapitre après chapitre, une forme de vérification qu'il convient de distinguer clairement d'un test automatisé :

- **Lecture exhaustive du code source** de chaque fichier Niveau 1/2, croisée systématiquement avec `docs/spec-boulangerie.md`.
- **Recherche des appelants/appelés** par `grep` pour confirmer qu'une fonction, une route, ou un composant est bien utilisé comme décrit (par exemple, la confirmation que `notifierInterventionAdmin` n'a qu'un seul point d'appel, Volume 18a).
- **Exécution ponctuelle de scripts de vérification** quand cela était possible sans risque : le script Python de parité des clés i18n (Volume 17), et l'exécution réelle de `npm test` pour ce chapitre (§1 ci-dessus).
- **Limite reconnue à plusieurs reprises dans ce livre** : aucun serveur PostgreSQL ni démon Docker n'étaient accessibles dans l'environnement de rédaction (constaté dès le Volume 4) — toute vérification nécessitant une base de données active (démarrage complet des deux serveurs, un parcours utilisateur réel dans un navigateur, une migration appliquée en direct) n'a **jamais pu être exécutée** au cours de la rédaction de ce livre, et a été signalée comme telle à chaque occurrence plutôt que présentée comme vérifiée.

Cette distinction est importante : la lecture de code rigoureuse pratiquée par ce livre donne une **haute confiance** sur la cohérence interne du code et sa correspondance avec la spec, mais elle n'équivaut pas à une preuve d'exécution réelle — un test automatisé (unitaire, d'intégration, ou E2E) vérifie que le code **s'exécute** correctement dans des conditions réelles, ce qu'une lecture, aussi attentive soit-elle, ne peut jamais garantir à elle seule (erreurs de configuration d'environnement, comportement runtime inattendu, régressions futures non détectées).

## 7. Résumé du chapitre

| Catégorie | État réel | Référence |
|---|---|---|
| Tests unitaires sur fonctions pures critiques (Niveau 1) | 11 tests Vitest, tous passants (vérifié dans ce chapitre) | Volume 11a (détail), `packages/shared/src/index.test.ts` |
| Configuration de test | Dimensionnée pour tout le monorepo, un seul paquet effectivement couvert à ce jour | Volume 18d, `vitest.config.ts` |
| Tests de routes API / intégration | Aucun | — |
| Tests de composants frontend | Aucun | — |
| Tests E2E automatisés (Playwright) | Aucun installé, malgré la recommandation de la spec section 7 et une pratique ponctuelle non conservée (mentionnée par `README.md`) | Écart consigné dans `annexes/ecarts-spec-code.md` |
| Vérification manuelle par lecture de code | Systématique tout au long de ce livre, croisée avec la spec à chaque chapitre | Tous les volumes 11a-18d |
| Vérification en environnement réel (base de données, navigateur) | Non exécutable dans l'environnement de rédaction de ce livre (pas de PostgreSQL/Docker accessible) | Signalé depuis le Volume 4 |

La stratégie de test de ce projet peut se résumer ainsi : une petite suite de tests unitaires automatisés, concentrée avec discernement sur les calculs financiers et de sécurité les plus critiques, complétée par une vérification manuelle non reproductible pour tout le reste. C'est une stratégie proportionnée à la taille de l'équipe et du projet (spec, section 1 : « une petite équipe de 2 à 5 personnes »), mais elle laisse un vide réel entre ce que la spec recommandait (Playwright E2E) et ce qui a été effectivement conservé dans le dépôt.
