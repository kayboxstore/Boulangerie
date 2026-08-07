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

*Aucun écart confirmé pour l'instant.* Seul le noyau financier et de permissions (`packages/shared/src/index.ts`, chapitre `volumes/11a-noyau-financier-permissions.md`) a été croisé avec la spécification jusqu'ici, et son comportement correspond à la section 3.4 (calcul de commande) et 3.1 (dépense farine) de `docs/spec-boulangerie.md`. Ce registre se remplira au fil de la rédaction des chapitres suivants.

---

*Dernière mise à jour : session du 2026-08-07 (création du registre).*
