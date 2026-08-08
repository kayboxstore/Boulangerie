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

---

*Dernière mise à jour : session du 2026-08-07 (chapitre 11d).*
