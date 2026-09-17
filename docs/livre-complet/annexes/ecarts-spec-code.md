# Registre des écarts entre le code et la spécification

> Ce fichier est le **point de collecte unique** de tous les écarts repérés entre `docs/spec-boulangerie.md` (comportement voulu) et le code réel du dépôt (comportement effectif), toutes chapitres confondus. Chaque écart signalé dans un volume doit être répété ici avec un renvoi vers le chapitre source.
>
> Rappel de la règle : ce livre **ne tranche jamais** lequel de la spec ou du code a raison. Chaque entrée porte la mention « Écart entre spec et code — à confirmer avec l'équipe ».

## Format d'une entrée

```
### [Domaine] Titre court de l'écart

- **Section de la spec concernée** : x.y
- **Fichier(s) de code concerné(s)** : chemin(s)
- **Ce que dit la spec** : ...
- **Ce que fait le code** : ...
- **Chapitre du livre où cet écart est détaillé** : volumes/xx.md
- **Statut** : Écart entre spec et code — à confirmer avec l'équipe
```

---

## Écarts recensés à ce jour

### [Équipe & permissions] Aucune interface trouvée pour « Modifier les permissions d'un rôle »

- **Section de la spec concernée** : 2 (« Matrice des permissions » — liste des 5 tâches critiques, qui inclut explicitement *« Modifier les permissions d'un rôle »*)
- **Fichier(s) de code concerné(s)** : `apps/api/src/routes/roles.ts` (route `PUT /:id/permissions`, fonctionnelle et sécurisée côté serveur, avec aiguillage vers l'approbation comme les autres tâches critiques), `apps/web/src/pages/Equipe.tsx` et le reste de `apps/web/src` (aucun composant trouvé)
- **Ce que dit la spec** : la modification des permissions d'un rôle est listée comme l'une des 5 tâches critiques réellement disponibles dans l'application, soumise au workflow d'approbation pour un Admin secondaire — ce qui implique qu'un moyen de la déclencher existe quelque part dans l'interface.
- **Ce que fait le code** : la route API existe et fonctionne (vérifié en lisant son implémentation et son exécuteur `MODIFIER_PERMISSIONS_ROLE`), mais une recherche exhaustive dans `apps/web/src` (tous les usages de `niveauAcces`/`NiveauAcces`, tous les appels à `/api/roles`) ne montre aucun appel à `PUT /api/roles/:id/permissions`, ni aucun affichage de la matrice de permissions d'un rôle sous une forme éditable. Le `GET /api/roles` utilisé par `Equipe.tsx` n'extrait que `{ id, nom, roleParentNom }` de la réponse, jamais le champ `permissions`.
- **Chapitre du livre où cet écart est détaillé** : `volumes/11d-equipe-roles-permissions.md`, §5.8
- **Statut** : Écart entre spec et code — à confirmer avec l'équipe (soit une interface existe et n'a pas été repérée, soit cette action n'est aujourd'hui déclenchable que par un appel direct à l'API, hors interface graphique)

### [Tests] Playwright recommandé par la spec, absent du dépôt

- **Section de la spec concernée** : 7 (« Stack technique recommandée » — ligne « Tests : Vitest (unitaires) + Playwright (E2E) »)
- **Fichier(s) de code concerné(s)** : les trois `package.json` du monorepo (racine, `apps/api`, `apps/web`) — aucune dépendance `@playwright/test` ni `playwright` ; aucun fichier `playwright.config.ts` ni `*.spec.ts` trouvé sur l'ensemble du dépôt
- **Ce que dit la spec** : la stack technique recommandée liste Playwright comme outil de test E2E, au même titre que Vitest pour les tests unitaires, sans distinction de priorité entre les deux lignes du tableau.
- **Ce que fait le code** : seul Vitest est installé et exécutable (`npm test`, 11 tests sur `packages/shared/src/index.test.ts`, vérifiés passants). `README.md` mentionne des « vérifications E2E Playwright réalisées à chaque fonctionnalité » et renvoie à l'« historique des commits » — une pratique de développement ponctuelle semble avoir existé, mais aucune trace n'en subsiste dans le dépôt sous forme de fichiers de test rejouables, de configuration, ou de dépendance installée.
- **Chapitre du livre où cet écart est détaillé** : `volumes/19-tests.md`, §5
- **Statut** : Écart entre spec et code — à confirmer avec l'équipe (soit Playwright a été retiré intentionnellement après usage ponctuel, soit son installation reste à faire pour se conformer pleinement à la stack recommandée)

### [Production/Commandes] Cycle de livraison (C4) absent de la spécification — RÉSOLU le jour de sa découverte

- **Section de la spec concernée** : aucune, jusqu'au 19/08/2026 (recherche exhaustive sur une version antérieure de `docs/spec-boulangerie.md` : zéro occurrence de « cycle », « C4 », ou de tout terme lié)
- **Fichier(s) de code concerné(s)** : `apps/api/src/routes/cycles-livraison.ts` (676 lignes), `apps/api/src/services/cyclesLivraison.ts` (316 lignes), `packages/shared/src/cyclesLivraison.ts` (200 lignes), `apps/web/src/pages/AcceptationsLivraison.tsx`, `apps/web/src/pages/BonsLivraison.tsx` (partiel), `apps/web/src/components/previsions/*`
- **Ce que dit la spec** : rien — aucune section ne décrivait ce module avant le 19/08/2026, alors qu'il était déjà en production depuis mi-août (code daté antérieurement).
- **Ce que fait le code** : une machine à états complète à 11 statuts, gérant l'argent transporté (anomalie `CASH_TRANSPORTE_NON_RECU`) et la conversion automatique d'une acceptation en `CommandeClient` réelle — une fonctionnalité substantielle, financièrement significative, restée sans texte de référence.
- **Chapitre du livre où cet écart est détaillé** : `volumes/11z-6-cycle-livraison.md` (chapitre lui-même ajouté le 19/08/2026, en même temps que la découverte de cet écart)
- **Statut** : **Résolu** — une section dédiée (3.3 f) a été ajoutée à `docs/spec-boulangerie.md` le 19/08/2026, dans le cadre du même travail qui a produit ce chapitre. Comparée au texte ajouté, l'implémentation ne présente aucun écart résiduel. Conservé ici pour la trace : c'est un exemple concret de ce que ce livre appelle une absence de spécification plutôt qu'une divergence entre deux textes existants — distinction déjà posée dans `README.md` du livre.

---

*Dernière mise à jour : session du 19/08/2026 (Volume 11z-6 et révision générale du livre — voir `ETAT_DE_PROGRESSION.md`). Mise à jour précédente : session du 2026-08-12 (chapitre 19).*
