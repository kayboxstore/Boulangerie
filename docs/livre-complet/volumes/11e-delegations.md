# Volume 11e — Délégations temporaires de rôle

**Niveau de risque : 1 — Critique.** Traitement exhaustif. Chapitre volontairement court : le mécanisme de fusion des délégations dans le calcul des permissions a déjà été expliqué en détail au Volume 11b (§ « `chargerUtilisateur`, passe 3 ») et n'est pas redérivé ici. Ce chapitre se concentre sur ce que `delegations.ts` fait spécifiquement : validation, création, consultation, révocation.

## Fiche d'identité des fichiers couverts

| Fichier | Lignes | Rôle |
|---|---:|---|
| `apps/api/src/routes/delegations.ts` | 93 | CRUD (sans modification) des délégations temporaires de rôle : lister, créer, révoquer |
| `packages/shared/src/index.ts` (extrait) | — | `delegationCreateSchema` (validation Zod), `DelegationDTO` (forme réseau) |

- **Qui les appelle** : `delegationsRouter` est monté sur `/api/delegations` dans `app.ts`. Côté client, `apps/web/src/pages/Equipe.tsx` est le seul appelant (§5.4 de ce chapitre) — il n'existe pas d'écran dédié aux délégations, la fonctionnalité vit dans un encart de la page Équipe.
- **Ce qu'ils appellent** : `prisma.delegationRole` (modèle Prisma), et indirectement, la passe 3 de `chargerUtilisateur` (Volume 11b) qui lit ce même modèle à chaque requête authentifiée pour calculer les permissions effectives d'un utilisateur.
- **Données modifiées** : le modèle `DelegationRole` (création, suppression). Aucune écriture sur `Utilisateur` ou `Role` — une délégation ne change jamais le rôle permanent d'un compte, elle est lue à la volée.

## 5.1 Vue d'ensemble intuitive

Le rôle d'un utilisateur définit ses droits « par défaut ». La délégation temporaire est une exception bornée dans le temps : *« pendant ces quelques jours, cette personne a aussi le droit d'écrire dans ce module précis, même si son rôle habituel ne le prévoit pas »*. La spécification donne l'exemple canonique :

> **Délégation temporaire de rôle** *(nouveau)* : un Admin peut accorder à un utilisateur les droits d'écriture d'un module précis pour une période donnée (ex. remplacement du Chargé des commandes absent 3 jours), sans changer son rôle permanent. À l'expiration, les droits reviennent automatiquement à la normale. La vérification de permission devient : *droits du rôle de base* **OU** *délégation active couvrant ce module à la date du jour*.
> — `docs/spec-boulangerie.md`, section 3.7

Le mot « automatiquement » est important : il n'y a **aucune tâche planifiée** qui « désactive » une délégation expirée. Une délégation ne devient jamais fausse en base — elle devient simplement hors de sa plage de dates, et c'est la fonction `active: debut <= auj && auj <= fin` (calculée à la volée à chaque lecture, voir §5.3) ainsi que la passe 3 de `chargerUtilisateur` (qui refait le même test à chaque requête authentifiée) qui la rendent inopérante le jour d'après. Ce chapitre ne traite donc que la moitié « gestion » du mécanisme ; l'autre moitié, « application », est au Volume 11b.

## 5.2 Le module `delegationsRouter` et sa garde d'accès

```ts
// apps/api/src/routes/delegations.ts
delegationsRouter.use(requireAuth, requirePermission("EQUIPE", "ECRITURE"));
```

Toute la sous-application est protégée par un seul appel `.use()`, monté avant les trois routes : il faut être authentifié (`requireAuth`, Volume 11b) et avoir l'écriture sur le module `EQUIPE` (`requirePermission`, même volume). Concrètement, dans les rôles standards de ce projet, cela correspond à un Admin (Principal ou secondaire).

Un point à remarquer, par comparaison avec le Volume 11d : **gérer une délégation n'est pas l'une des 5 « tâches critiques »** de la spécification (section 2 : supprimer un utilisateur, créer/supprimer un compte Admin, modifier prix/commissions, modifier le taux de taxe, modifier les permissions d'un rôle). Créer ou révoquer une délégation ne passe donc jamais par `traiterActionCritique` (Volume 11f) — un Admin secondaire peut le faire directement, sans attendre l'approbation de l'Admin Principal. C'est cohérent avec la nature de l'action : une délégation est bornée dans le temps et dans son périmètre (un seul module), donc jugée moins sensible qu'une modification structurelle du système de permissions.

## 5.3 `GET /api/delegations` — lister, avec calcul de l'état « actif »

```ts
const jour = (d: Date) => d.toISOString().slice(0, 10);
const aujourdhui = () => new Date().toISOString().slice(0, 10);

const versDTO = (d: DelegationAvecRelations): DelegationDTO => {
  const debut = jour(d.dateDebut);
  const fin = jour(d.dateFin);
  const auj = aujourdhui();
  return {
    id: d.id,
    utilisateur: { id: d.utilisateur.id, nom: d.utilisateur.nom, roleNom: d.utilisateur.role.nom },
    module: d.module as Module,
    dateDebut: debut,
    dateFin: fin,
    active: debut <= auj && auj <= fin,
    creePar: d.creePar,
  };
};

delegationsRouter.get("/", async (_req, res, next) => {
  try {
    const delegations = await prisma.delegationRole.findMany({
      include: INCLUDE,
      orderBy: { dateFin: "desc" },
      take: 100,
    });
    res.json({ delegations: delegations.map(versDTO) });
  } catch (e) { next(e); }
});
```

**`jour()` et `aujourdhui()`** ramènent une `Date` (objet JavaScript, avec heure et fuseau) à une simple chaîne `"AAAA-MM-JJ"`, en coupant le résultat ISO (`toISOString()`) à ses 10 premiers caractères. C'est le même procédé que celui déjà rencontré dans `calculerCommande` et ailleurs dans le projet (Volume 11a) : dès qu'on ne veut comparer que des *jours civils* et non des instants précis, on travaille en chaînes plutôt qu'en objets `Date`.

**Le calcul `active: debut <= auj && auj <= fin`** compare trois chaînes de caractères au format `AAAA-MM-JJ`. C'est ici que la « ruse » de l'ordre lexicographique intervient : parce que l'année vient en premier, puis le mois, puis le jour, l'ordre alphabétique des chaînes coïncide exactement avec l'ordre chronologique des dates qu'elles représentent (`"2026-08-08" < "2026-08-09" < "2026-09-01"`). Comparer deux dates ISO revient donc à comparer deux chaînes avec `<=`, sans avoir besoin de les reconvertir en objets `Date` ni d'utiliser une bibliothèque de dates. **C'est exactement le même test** qui sera refait, sur les mêmes trois valeurs, dans la passe 3 de `chargerUtilisateur` (Volume 11b) — le code ne le factorise pas dans une fonction partagée entre `apps/api/src/routes/delegations.ts` et `apps/api/src/middleware/auth.ts`, il est dupliqué à l'identique aux deux endroits. Une petite duplication, sans risque tant que la logique ne change pas, mais qui vaut d'être connue si l'une des deux copies devait être corrigée un jour.

**`orderBy: { dateFin: "desc" }` et `take: 100`** : les délégations les plus récentes (celles qui finissent le plus tard) apparaissent en premier, et la liste est plafonnée à 100 résultats. Il n'y a pas de pagination — au-delà de 100 délégations enregistrées dans l'historique complet du système (actives et expirées confondues), les plus anciennes deviendraient invisibles depuis cet écran. Une limite raisonnable au vu du volume attendu (une poignée de délégations créées de façon ponctuelle), mais une limite dure tout de même.

**`INCLUDE`** ramène, pour chaque délégation, le nom et le rôle actuel de l'utilisateur bénéficiaire, ainsi que l'identité de l'Admin qui l'a créée (`creePar`). Ces informations sont jointes en une seule requête Prisma (`include`), plutôt que d'être recherchées séparément après coup.

## 5.4 `POST /api/delegations` — créer

```ts
delegationsRouter.post("/", async (req, res, next) => {
  try {
    const parsed = delegationCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
    }
    const { utilisateurId, module, dateDebut, dateFin } = parsed.data;
    const utilisateur = await prisma.utilisateur.findUnique({ where: { id: utilisateurId } });
    if (!utilisateur) return res.status(404).json({ erreur: "Utilisateur introuvable" });
    const delegation = await prisma.delegationRole.create({
      data: { utilisateurId, module, dateDebut: new Date(dateDebut), dateFin: new Date(dateFin), creeParId: req.utilisateur!.id },
      include: INCLUDE,
    });
    res.status(201).json({ delegation: versDTO(delegation) });
  } catch (e) { next(e); }
});
```

Trois étapes séquentielles :

1. **Validation du corps de la requête** par `delegationCreateSchema` (schéma Zod, détaillé au §5.5) — cette validation ne connaît pas encore la base de données, elle vérifie seulement la *forme* des données envoyées (types, présence des champs, cohérence des deux dates entre elles).
2. **Vérification que l'utilisateur bénéficiaire existe réellement** — une requête Prisma séparée. Si `utilisateurId` correspond à un identifiant qui n'existe plus (compte supprimé entre-temps, faute de frappe côté client), la route répond `404` plutôt que de créer une délégation orpheline.
3. **Création**, avec `creeParId: req.utilisateur!.id` — l'identité de l'auteur de la délégation vient de `req.utilisateur`, posé par `requireAuth` (Volume 11b), jamais du corps de la requête. Un client ne peut donc pas se faire passer pour un autre Admin comme auteur d'une délégation.

**Ce que cette route ne vérifie pas** : il n'existe **aucune règle empêchant deux délégations actives simultanées** pour le même couple utilisateur/module (par exemple deux Admins qui, indépendamment, accordent chacun une délégation `STOCKS` chevauchante au même utilisateur). Rien dans le code n'empêche cette redondance. Est-ce un problème ? Non, et c'est vérifiable directement dans la logique de la passe 3 de `chargerUtilisateur` (Volume 11b) : elle cherche seulement s'il *existe au moins une* délégation active couvrant le module demandé, et si oui, accorde `ECRITURE` — un booléen, pas un compteur. Avoir zéro, une ou trois délégations actives simultanées sur le même module produit exactement le même résultat pour l'utilisateur concerné. L'absence de contrôle d'unicité est donc un choix cohérent avec la façon dont le résultat est consommé, pas un oubli qui casse quelque chose.

## 5.5 `delegationCreateSchema` — la validation des dates

```ts
// packages/shared/src/index.ts
export const delegationCreateSchema = z
  .object({
    utilisateurId: z.string().min(1, "L'utilisateur est requis"),
    module: z.enum(MODULES),
    dateDebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date de début invalide (AAAA-MM-JJ)"),
    dateFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date de fin invalide (AAAA-MM-JJ)"),
  })
  .refine((d) => d.dateFin >= d.dateDebut, {
    message: "La date de fin doit être postérieure ou égale à la date de début",
    path: ["dateFin"],
  });
```

Un schéma Zod (Volume 15 pour la présentation générale de Zod ; ici, son usage concret). Quatre champs obligatoires, puis une règle transversale ajoutée par `.refine()` :

- `utilisateurId` : une chaîne non vide — pas de vérification d'existence à ce stade (elle a lieu séparément dans la route, §5.4, car elle nécessite un accès à la base que Zod seul n'a pas).
- `module` : doit être l'une des valeurs de l'énumération `MODULES` (Volume 11a) — impossible de déléguer un « module » qui n'existe pas.
- `dateDebut` / `dateFin` : chacune vérifiée par une expression régulière `^\d{4}-\d{2}-\d{2}$`, qui impose le format `AAAA-MM-JJ` (quatre chiffres, tiret, deux chiffres, tiret, deux chiffres) — mais **ne vérifie pas que la date est calendaire valide** (`"2026-02-30"` passe cette regex sans problème, bien que le 30 février n'existe pas). En pratique, le champ HTML `<input type="date">` utilisé côté client (§5.7) empêche l'utilisateur de saisir une date invalide de cette façon — mais un appel direct à l'API (hors interface, par exemple via un outil comme `curl`) pourrait transmettre une date calendaire impossible sans être bloqué par ce schéma. `new Date("2026-02-30")` sera alors interprété par JavaScript comme le 2 mars 2026 (report automatique), un comportement qui ne provoque pas d'erreur mais peut surprendre.
- `.refine((d) => d.dateFin >= d.dateDebut, ...)` : la règle qui interdit une délégation dont la fin précède le début. Elle réutilise **exactement la même ruse de comparaison lexicographique de chaînes** que celle vue au §5.3 (`>=` entre deux chaînes `AAAA-MM-JJ`) — aucune conversion en `Date` n'est nécessaire ici non plus. `path: ["dateFin"]` indique à Zod que si cette règle échoue, l'erreur doit être rattachée au champ `dateFin` (utile pour un formulaire qui afficherait l'erreur sous le bon champ ; en pratique ici, seul `parsed.error.issues[0]?.message` est utilisé côté serveur, §5.4).

Une délégation avec `dateDebut === dateFin` est valide (le `>=` est inclusif) : une délégation d'un seul jour est donc possible et couverte par le test `active` du §5.3 (`debut <= auj && auj <= fin`, qui devient `auj <= auj && auj <= auj` ce jour-là).

## 5.6 `DELETE /api/delegations/:id` — révoquer

```ts
delegationsRouter.delete("/:id", async (req, res, next) => {
  try {
    const delegation = await prisma.delegationRole.findUnique({ where: { id: req.params.id } });
    if (!delegation) return res.status(404).json({ erreur: "Délégation introuvable" });
    await prisma.delegationRole.delete({ where: { id: delegation.id } });
    res.status(204).end();
  } catch (e) { next(e); }
});
```

Recherche puis suppression, avec un `404` explicite si l'identifiant ne correspond à rien (plutôt que de laisser Prisma renvoyer une erreur générique de contrainte). Réponse `204 No Content` en cas de succès — convention REST du projet pour une suppression réussie sans corps de réponse à renvoyer (déjà rencontrée dans `DELETE /api/equipe/:id`, Volume 11d).

**Point à noter** : cette route **ne vérifie pas que l'auteur de la requête est celui qui a créé la délégation** (`creeParId`). N'importe quel compte satisfaisant la garde du §5.2 (authentifié, `EQUIPE` en écriture — en pratique, n'importe quel Admin) peut révoquer une délégation créée par un autre Admin, y compris l'Admin Principal. Ce n'est pas une faille au sens strict — la garde d'accès au niveau module est respectée, et la spécification ne mentionne aucune notion de « propriété » d'une délégation — mais c'est une absence de contrôle qui mérite d'être connue : un Admin secondaire peut annuler une délégation que l'Admin Principal vient d'accorder à quelqu'un d'autre, sans que cela déclenche de demande d'approbation ni de notification particulière (au-delà de la mise à jour de la liste, §5.7).

## 5.7 Côté client — l'encart « Délégations » de `Equipe.tsx`

Il n'existe pas de page dédiée aux délégations : la fonctionnalité vit dans un encart de `apps/web/src/pages/Equipe.tsx`, la même page que le Volume 11d a déjà largement couverte.

```tsx
// apps/web/src/pages/Equipe.tsx
const { data: delegationsData } = useQuery({
  queryKey: ["delegations"],
  queryFn: () => api<{ delegations: DelegationDTO[] }>("/api/delegations"),
  enabled: editable,
});
const delegations = delegationsData?.delegations ?? [];
const rafraichirDelegations = () => queryClient.invalidateQueries({ queryKey: ["delegations"] });
```

`enabled: editable` : la requête TanStack Query n'est même pas lancée si l'utilisateur courant n'a pas l'écriture sur `EQUIPE` — cohérent avec la garde serveur du §5.2, qui de toute façon renverrait un `403` à un utilisateur sans ce droit. Éviter l'appel réseau inutile plutôt que de le laisser échouer silencieusement.

```tsx
const creerDelegation = useMutation({
  mutationFn: () =>
    api("/api/delegations", {
      method: "POST",
      body: JSON.stringify({ utilisateurId: delUtilisateurId, module: delModule, dateDebut: delDebut, dateFin: delFin }),
    }),
  onSuccess: () => { setDialogDelegation(false); rafraichirDelegations(); },
  onError: (e) => setDelErreur(e instanceof Error ? e.message : t("parametres.saveError")),
});

const revoquerDelegation = useMutation({
  mutationFn: (id: string) => api(`/api/delegations/${id}`, { method: "DELETE" }),
  onSuccess: rafraichirDelegations,
  onError: (e) => toastErreur(e instanceof Error ? e.message : t("parametres.deleteError")),
});
```

Deux mutations TanStack Query classiques (le patron général est déjà expliqué au Volume 10, à paraître ; ici on n'en donne que l'usage concret) : `creerDelegation` ferme la boîte de dialogue et rafraîchit la liste en cas de succès, ou affiche l'erreur du serveur (par exemple le message du `.refine()` Zod, §5.5) dans le formulaire lui-même. `revoquerDelegation` déclenche un rafraîchissement de la liste après suppression, ou un message d'erreur global (`toastErreur`) en cas d'échec.

Le formulaire de création (boîte de dialogue) propose trois champs : un sélecteur d'utilisateur limité aux comptes **actifs** (`comptes.filter((c) => c.actif)` — impossible de déléguer un droit à un compte désactivé), un sélecteur de module parcourant toute l'énumération `MODULES`, et deux champs `<input type="date">` pour les bornes de la période — c'est ce composant HTML natif qui empêche, en pratique, la saisie d'une date calendaire invalide évoquée au §5.5. La liste elle-même affiche, pour chaque délégation, l'utilisateur bénéficiaire, le module, la période, et un badge « active » ou « inactive » calculé côté serveur (§5.3) — le client ne refait pas ce calcul, il affiche simplement le booléen `active` reçu dans le DTO. Un bouton de révocation, protégé par une boîte de confirmation destructive (`confirmer({ ..., destructive: true })`), appelle `revoquerDelegation`.

## 5.8 Cas limites

| Situation | Comportement |
|---|---|
| `dateDebut === dateFin` | Valide (délégation d'un seul jour) — voir §5.5. |
| `dateFin < dateDebut` | Rejeté par le `.refine()` Zod, `400`. |
| Date au format `AAAA-MM-JJ` mais calendairement invalide (ex. `"2026-02-30"`) | Passe la regex Zod ; interprétée par `new Date(...)` avec report automatique (report vers le 2 mars). Non bloqué par le schéma. Protégé en pratique côté client par `<input type="date">`. |
| `utilisateurId` inexistant | `404 Utilisateur introuvable` (vérifié après la validation Zod). |
| Deux délégations actives simultanées, même utilisateur, même module | Autorisé, sans effet différent d'une seule (voir §5.4 et Volume 11b passe 3 — seule la présence d'au moins une délégation active compte). |
| Révocation par un Admin autre que le créateur (`creeParId`) | Autorisée sans restriction — voir §5.6. |
| Délégation expirée (date de fin dans le passé) | Reste en base indéfiniment (jamais supprimée automatiquement), simplement `active: false` dès le lendemain de `dateFin`. Un Admin peut la révoquer manuellement, mais rien ne l'y oblige. |
| Plus de 100 délégations enregistrées au total | Les plus anciennes (par `dateFin` croissante) deviennent invisibles dans `GET /` — voir §5.3. |

## 5.9 Croisement avec la spécification

La spécification (section 3.7, citée au §5.1) décrit fidèlement ce que fait le code : délégation bornée dans le temps, sur un module précis, n'altérant pas le rôle permanent, avec expiration automatique par simple comparaison de dates (pas de tâche de nettoyage). Aucun écart constaté sur le comportement décrit.

Un point mérite cependant d'être signalé, non comme un écart, mais comme une clarification : la spécification elle-même, dans sa liste de questions ouvertes (section 12), pose la question suivante :

> *« Une délégation temporaire de rôle (3.7) peut-elle chevaucher plusieurs modules à la fois, ou un seul module par délégation ? »*
> — `docs/spec-boulangerie.md`, section 12

Le code, lui, tranche cette question sans ambiguïté : le champ `module` du modèle `DelegationRole` (et du DTO, §5.4) est un `Module` **singulier**, pas une liste. Une délégation ne couvre jamais qu'un seul module à la fois ; pour déléguer deux modules à la même personne pour la même période, il faut créer deux délégations distinctes (rien n'empêche de le faire, voir §5.4). Ce n'est pas une divergence entre la spécification et le code — la spécification ne décrit rien de contraire à ce que fait le code, elle pose simplement une question qu'elle laisse elle-même en suspens. Le code, en pratique, y répond. Cette observation ne va donc **pas** dans le registre des écarts (`annexes/ecarts-spec-code.md`), qui est réservé aux cas où le code contredit une affirmation de la spécification.

## 5.10 Résumé

`delegations.ts` est un CRUD minimal (lister/créer/révoquer, pas de modification) posé sur un seul modèle Prisma, protégé par un unique contrôle de permission au niveau du routeur. Sa seule vraie subtilité est partagée avec le Volume 11b : la comparaison de dates ISO comme chaînes de caractères, utilisée à la fois pour calculer l'état `active` d'une délégation existante et pour valider qu'une nouvelle délégation a une plage de dates cohérente. Le reste du fichier consiste en vérifications d'existence directes (utilisateur, délégation) et en une intégration frontend réduite à un encart de la page Équipe, sans écran dédié. Aucun écart de comportement avec la spécification n'a été trouvé ; en revanche, le code répond concrètement à une question que la spécification laisse elle-même ouverte (un seul module par délégation).

---

**Suite →** Volume 11f — Approbations et actions critiques (`apps/api/src/services/actionsCritiques.ts`, `apps/api/src/routes/approbations.ts`, `apps/web/src/pages/Approbations.tsx`), le mécanisme déjà mentionné à plusieurs reprises depuis le Volume 11d et jamais encore détaillé.
