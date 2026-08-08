# Volume 15 — Validation des données (Zod)

**Niveau de risque : 2 — Fonctionnel standard (synthèse).** Comme les Volumes 6 et 14, ce chapitre ne lit aucun fichier inédit — il consolide un motif rencontré et cité, sans jamais être détaillé pour lui-même, dans la quasi-totalité des chapitres applicatifs depuis le Volume 11a. `packages/shared/src/index.ts` exporte **53 schémas Zod** ; les routes API les invoquent via `safeParse` à **55 emplacements** distincts. C'est ce motif, répété avec une régularité quasi mécanique, que ce chapitre isole et explique une seule fois pour toutes ses occurrences.

## 1. Le motif, à l'identique dans 55 endroits

Chaque route d'écriture du projet (`POST`/`PUT`), sans exception observée, ouvre par la même séquence — déjà vue littéralement dans chaque chapitre depuis le Volume 11e sans jamais être commentée pour elle-même :

```ts
const parsed = xCreateSchema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
}
// parsed.data est désormais typé ET garanti conforme au schéma
```

Trois choix, constants sur les 55 occurrences :

- **`safeParse`, jamais `parse`** : une entrée invalide renvoie un résultat `{ success: false, error }` plutôt que de lever une exception — la route reste maîtresse de la réponse HTTP (toujours un `400` avec un message clair), jamais un `500` accidentel provoqué par une erreur de validation non attrapée.
- **Seul le premier message d'erreur est renvoyé** (`parsed.error.issues[0]?.message`) — un choix d'ergonomie délibéré : l'utilisateur corrige un problème à la fois plutôt que de recevoir une liste technique de toutes les violations simultanées.
- **`parsed.data`, jamais `req.body` directement, après validation** — le corps de la requête n'est utilisé pour construire l'écriture en base qu'après être passé par ce filtre, qui a aussi normalisé les types (ex. une chaîne numérique côté HTTP devient un `number` réel côté TypeScript).

## 2. Pourquoi les messages sont en français clair, jamais un code technique

En tête de `packages/shared/src/index.ts`, avant même la définition du premier schéma, un `z.setErrorMap(...)` global redéfinit les messages par défaut de Zod (habituellement en anglais et orientés développeur, du type « Expected string, received number ») :

```ts
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" ? "Ce champ est requis." : "Valeur invalide." };
    case z.ZodIssueCode.too_small: return { message: "Cette valeur est trop courte ou trop petite." };
    // ...
    default: return { message: ctx.defaultError };
  }
});
```

C'est un **filet de sécurité global**, pas le mécanisme principal : la grande majorité des 53 schémas définissent leur **propre** message dédié à chaque champ (ex. `z.string().trim().min(1, "Le nom est requis")`, motif rencontré identiquement dans chaque chapitre de ce livre) — le filet global ne s'active que pour les rares champs sans message personnalisé (des identifiants de ligne internes, par exemple). Ce double niveau réalise directement l'exigence de ton déjà citée à la spec 3.8 (« messages d'erreur... en langage clair et humain — jamais de code d'erreur brut affiché à l'utilisateur »), vérifiée ici comme le mécanisme concret qui la rend systématique plutôt que dépendante de la discipline de chaque développeur route par route.

## 3. Schémas de création vs mise à jour — `.partial()`, pas une duplication

8 schémas de mise à jour du projet sont dérivés de leur schéma de création correspondant par `.partial()` — motif déjà vu explicitement aux Volumes 11z-1 (`matiereUpdateSchema = matiereCreateSchema.omit({ quantiteInitiale: true }).partial()`) et 11z-3 (`zoneDepositaireUpdateSchema`, `groupeUpdateSchema`) : tous les champs deviennent optionnels, permettant une mise à jour partielle (seuls les champs envoyés sont modifiés), **sans redéfinir chaque règle de validation une seconde fois**. `.omit(...)` retire, avant de rendre partiel, les champs qui n'ont de sens qu'à la création (ex. `quantiteInitiale`, qui ne peut pas être « mise à jour » — un stock se modifie par mouvement, Volume 11z-1). Cette dérivation garantit qu'une règle resserrée sur le schéma de création (ex. une longueur maximale de nom) s'applique automatiquement à la mise à jour, sans risque de divergence entre les deux au fil des évolutions du code.

## 4. `.refine()` — quand une règle dépasse un seul champ

11 usages du projet, chacun déjà rencontré dans son chapitre d'origine, dont deux exemples marquants :

- **Date de fin ≥ date de début** (`delegationCreateSchema`, Volume 11e) : une règle qui compare deux champs entre eux, impossible à exprimer par une contrainte sur un seul champ isolé.
- **Précision décimale des quantités physiques** (`quantiteMatiere`, Volume 11z-1) : `Math.round(q * 1000) === q * 1000` vérifie qu'une quantité n'a pas plus de 3 décimales — cohérence directe avec le type `Decimal(12,3)` de la base (Volume 13), la validation applicative reflétant exactement la précision réellement stockée.

## 5. Un contrat partagé, mais une frontière claire : les schémas ne traversent pas vers le client

Point de nuance jamais explicité jusqu'ici, vérifié pour ce chapitre par une recherche exhaustive dans `apps/web/src` : **aucun schéma Zod n'est directement invoqué (`safeParse`/`parse`) côté client.** Ce qui traverse la frontière du monorepo vers le frontend, ce sont les **types dérivés** (`z.infer<typeof xSchema>`, utilisés pour typer les états de formulaire) et les **fonctions de calcul pures** qui accompagnent certains schémas (`calculerCommande`, `totalDestinationsBacs`, déjà réutilisées côté client dans plusieurs chapitres pour un aperçu instantané) — jamais la validation elle-même. Le frontend s'appuie sur des contraintes HTML natives (`required`, `min`, `type="number"`) pour un confort de saisie immédiat, mais **la validation qui compte, la seule qui protège réellement les données, est toujours celle rejouée côté serveur** à l'arrivée de la requête — cohérent avec le principe déjà établi au Volume 14 (« jamais fait confiance au contenu envoyé par le client pour une décision de sécurité ou d'intégrité »).

## 6. Croisement avec `docs/spec-boulangerie.md`

- Section 3.8 (ton des messages d'erreur, « jamais de code d'erreur brut... toujours une explication compréhensible ») : confirmé par le double niveau de messages (`setErrorMap` global + message dédié par champ). Aucun écart.
- Aucune section de la spec ne prescrit Zod spécifiquement (choix d'implémentation, déjà justifié au Volume 3) — rien à confronter au-delà du ton des messages.

Aucun écart spec/code trouvé dans ce chapitre.

## 7. Résumé

La validation de ce projet n'est ni éparpillée ni réinventée route par route : un seul point de définition (`packages/shared`), un seul motif d'invocation (`safeParse` + premier message), une dérivation systématique entre création et mise à jour (`.partial()`) plutôt qu'une duplication, et une frontière claire jamais franchie entre confort de saisie côté client et validation réelle côté serveur. La régularité de ce motif à travers 55 emplacements différents, écrits dans des contextes fonctionnels aussi divers que les Volumes 11 à 11z, est elle-même la meilleure preuve qu'il s'agit d'une convention du projet plutôt que d'un choix ponctuel — la même conclusion déjà tirée au Volume 6 pour l'architecture dans son ensemble.

---

**Suite →** Volume 16 — Gestion des erreurs et journalisation, qui referme le chemin inverse : que devient une erreur qui *n'est pas* une simple validation Zod, depuis le moment où elle est levée jusqu'à ce qu'elle atteigne les journaux du serveur ou l'écran de l'utilisateur.
