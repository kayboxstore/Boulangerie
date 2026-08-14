# Dette technique — Vague 2 : prévisions et commandes réelles

Date : 14 août 2026
Base : `agent/integration-wave-2` après fusion de C4 (PR #12) et F4/I4 (PR #13)

Ce document consigne les points **P2 non bloquants** identifiés lors de la double revue indépendante d'I4, volontairement non corrigés dans l'immédiat pour ne pas rouvrir une boucle de correction sur une intégration déjà validée (CI verte, 466/466 tests, 0 P0/P1). Ils sont réservés à une tranche ultérieure de la vague 2 ou à la vague suivante.

## 1. Valeurs de secours `?? 0` sur retourné/manquant

**Fichier concerné :** `apps/web/src/pages/BonsLivraison.tsx`, composant `ResumeCycle`.

**Constat :** une fois `cycle.totaux.accepte !== null` (c'est-à-dire après l'acceptation confirmée par le serveur), l'affichage utilise `cycle.totaux.retourne ?? 0` et `cycle.totaux.manquant ?? 0`. Le contrat C4 garantit qu'après acceptation ces deux champs sont toujours des nombres (jamais `null`) pour un cycle correctement transitionné — le repli `?? 0` ne devrait donc jamais s'activer en pratique. Mais il masque silencieusement une incohérence serveur si elle survenait un jour (ex. donnée partiellement migrée, cycle dans un état inattendu), en affichant un zéro qui se confond avec une vraie valeur nulle légitime.

**Correction prévue :** distinguer explicitement « valeur nulle légitime avant transition » de « valeur manquante alors qu'elle est attendue » — par exemple en affichant un indicateur visuel distinct (« — ») si `retourne`/`manquant` est `null` alors que `accepte` ne l'est pas, plutôt qu'un `0` indiscernable d'un vrai zéro.

## 2. Assertions sémantiques exactes des traductions lingala et swahili

**Fichiers concernés :** `apps/web/src/i18n/previsions.i18n.test.ts`, traductions `ln.json`/`sw.json` du module Prévisions.

**Constat :** `previsions.i18n.test.ts` vérifie la présence des onze statuts, l'absence des anciennes formulations erronées et la cohérence structurelle des quatre langues, mais ne vérifie pas la **justesse sémantique exacte** des traductions lingala et swahili (contrairement au français et à l'anglais, où le test compare des sous-chaînes précises comme « supérieur à zéro » / « greater than zero »). Le `_note` historique de `ln.json`/`sw.json` signale déjà que ce sont des premiers jets à faire relire par un locuteur natif.

**Correction prévue :** une fois une relecture native disponible, étendre `previsions.i18n.test.ts` avec des assertions de sous-chaînes spécifiques au lingala et au swahili (sur le modèle des assertions FR/EN déjà en place pour `PARTIELLEMENT_ACCEPTEE`), pour verrouiller la formulation validée et détecter toute régression future.

---

Ces deux points ne remettent pas en cause la validation de la vague 2 : ils sont documentés ici pour être repris consciemment, pas oubliés.
