# Volume 11f — Approbations et actions critiques

**Niveau de risque : 1 — Critique.** Traitement exhaustif. Ce chapitre couvre le mécanisme central déjà mentionné sans être détaillé aux volumes 11d (`CREER_COMPTE_ADMIN`, `SUPPRIMER_UTILISATEUR`) et 11e (justification du fait que les délégations n'y passent pas) : le garde-fou qui distingue ce qu'un Admin Principal peut faire seul de ce qu'un Admin secondaire doit soumettre à validation.

## Fiche d'identité des fichiers couverts

| Fichier | Lignes | Rôle |
|---|---:|---|
| `apps/api/src/services/actionsCritiques.ts` | 176 | Définit les 5 tâches critiques, leur logique d'exécution réelle, et l'aiguillage exécution immédiate / mise en attente |
| `apps/api/src/routes/approbations.ts` | 109 | Consultation de la file d'attente, approbation, rejet |
| `apps/web/src/pages/Approbations.tsx` | 159 | Écran de gestion des demandes (file en attente + historique) |
| `packages/shared/src/index.ts` (extrait) | — | `TYPES_ACTION_CRITIQUE`, `STATUTS_DEMANDE`, `DemandeApprobationDTO`, `ResultatActionCritique`, libellés associés |

- **Qui les appelle** : `traiterActionCritique` (exporté par `actionsCritiques.ts`) est appelé par quatre routes différentes, chacune pour l'une des 5 tâches critiques — `apps/api/src/routes/equipe.ts` (Volume 11d, deux tâches : créer/supprimer un compte), `apps/api/src/routes/clients.ts`, `apps/api/src/routes/produits.ts`, `apps/api/src/routes/roles.ts` (Volume 11d). `approbationsRouter` est monté sur `/api/approbations` dans `app.ts` ; `ApprobationsPage` est affichée par la route `/approbations` de `App.tsx`.
- **Ce qu'ils appellent** : `prisma.demandeApprobation`, `prisma.utilisateur` (recherche de l'Admin Principal), `busEvenements.emettreEvenement` (notification temps réel — détail complet au Volume 12, ce chapitre n'en donne que l'usage), et selon la tâche, `prisma.typeClient`, `prisma.produit`, `prisma.role`, `prisma.rolePermission`.
- **Données modifiées** : le modèle `DemandeApprobation` (création, mise à jour de `statut`/`approuveParId`/`dateDecision`/`erreur`), et selon la tâche approuvée : `Utilisateur`, `TypeClient`, `Produit`, `RolePermission`.

## 5.1 Vue d'ensemble intuitive

La spécification distingue deux catégories de décisions dans l'application : celles qu'un Admin secondaire peut prendre seul, et une liste fermée de cinq décisions jugées assez sensibles pour exiger l'aval de l'Admin Principal avant de prendre effet.

> **Workflow d'approbation (Admin Principal)** : certaines actions d'un Admin secondaire ne s'exécutent qu'après validation de l'Admin Principal. Tâches critiques (liste figée — 5 items) :
> - Supprimer un utilisateur
> - Créer ou supprimer un compte Admin
> - Modifier les prix ou commissions par Qualité de client
> - Modifier le taux de taxe
> - Modifier les permissions d'un rôle
>
> Quand un Admin secondaire déclenche une de ces actions, une demande est créée (statut « en attente ») et l'Admin Principal reçoit une notification temps réel instantanée [...]. **Seul l'Admin Principal peut approuver ou rejeter une demande** [...]. Quand l'Admin Principal déclenche lui-même une de ces actions, elle s'exécute directement, sans passer par une demande (il n'a pas à s'auto-approuver).
> — `docs/spec-boulangerie.md`, section 2

Ce paragraphe décrit exactement ce que fait le code, avec une seule subtilité de comptage à éclaircir tout de suite : la spec énumère 5 *items*, mais le second (« créer ou supprimer un compte Admin ») regroupe deux opérations distinctes. Le code, lui, définit `TYPES_ACTION_CRITIQUE` avec exactement 5 valeurs — `SUPPRIMER_UTILISATEUR`, `CREER_COMPTE_ADMIN`, `MODIFIER_TYPE_CLIENT`, `MODIFIER_TAUX_TAXE`, `MODIFIER_PERMISSIONS_ROLE` — sans type dédié `SUPPRIMER_COMPTE_ADMIN`. La raison, vérifiable dans `apps/api/src/routes/equipe.ts` (Volume 11d, §5.7) : supprimer un compte Admin **passe par le même type `SUPPRIMER_UTILISATEUR`** que supprimer n'importe quel autre compte — la route `DELETE /api/equipe/:id` ne fait aucune distinction de type selon que la cible est ou non un Admin, seulement une vérification préalable (`compte.estAdminPrincipal` → refus direct, l'Admin Principal ne peut être supprimé qu'après avoir transféré son statut). Les deux formulations (5 items en 6 opérations dans la spec, 5 types en 6 opérations dans le code) décrivent donc bien la même réalité.

## 5.2 `ErreurAction` — distinguer un refus métier d'un bug

```ts
export class ErreurAction extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
```

Une classe d'erreur minimale, qui étend `Error` (une classe native de JavaScript) en lui ajoutant un champ `status`. Chaque fois qu'une des fonctions d'exécution (§5.3) rencontre un problème *attendu* — une ressource introuvable, un doublon, un état incompatible — elle lève (`throw`) une `ErreurAction` avec le code HTTP approprié (`404`, `409`...) et un message destiné directement à l'utilisateur. Ce n'est **pas** la même chose qu'une erreur de programmation imprévue (ex. une panne de connexion à la base) : celles-ci ne sont jamais enveloppées dans une `ErreurAction`, elles remontent telles quelles et finissent par le middleware d'erreur générique de `app.ts` (Volume 16), qui répond `500`. La distinction est ce qui permet au code appelant (§5.3 `traiterActionCritique`, §5.4 `POST /:id/approuver`) de savoir, avec un simple `instanceof ErreurAction`, s'il doit renvoyer le message tel quel au client ou le laisser remonter comme une erreur serveur générique.

## 5.3 `EXECUTEURS` — une seule implémentation par tâche, rejouée telle quelle

C'est le cœur du fichier, introduit par un commentaire qui en résume la logique en une phrase :

> *Source unique de vérité pour chaque tâche critique. Rejoués tels quels à l'approbation (donc revérifient l'état, qui a pu changer entre-temps).*

**L'idée centrale à comprendre avant le détail** : une tâche critique n'a **qu'une seule implémentation**, quel que soit le compte qui la déclenche. Que ce soit l'Admin Principal (exécution immédiate) ou, plus tard, l'Admin Principal qui approuve la demande d'un Admin secondaire (exécution différée), c'est **exactement la même fonction** de `EXECUTEURS` qui s'exécute, avec les mêmes vérifications. Aucune duplication de logique entre le chemin « immédiat » et le chemin « différé ». La conséquence pratique la plus importante : **les vérifications sont refaites au moment de l'exécution réelle, jamais seulement au moment de la demande**. Si l'état de la base a changé entre le moment où un Admin secondaire a soumis une demande et le moment où l'Admin Principal l'approuve (par exemple, la personne visée a déjà été supprimée entre-temps par un autre biais), l'exécuteur le détecte à ce moment précis, pas avant.

`EXECUTEURS` est un objet dont chaque clé est une valeur de `TypeActionCritique`, et chaque valeur une fonction asynchrone qui reçoit un objet `donnees: Record<string, unknown>` en entrée (les paramètres de l'action, dont la forme dépend du type) et renvoie `{ message: string }` en sortie (le message de succès, réutilisé aussi bien dans la réponse immédiate que dans l'historique des approbations).

### `SUPPRIMER_UTILISATEUR`

```ts
SUPPRIMER_UTILISATEUR: async ({ utilisateurId }) => {
  const compte = await prisma.utilisateur.findUnique({ where: { id: utilisateurId as string } });
  if (!compte) throw new ErreurAction(404, "Compte introuvable");
  if (compte.estAdminPrincipal) {
    throw new ErreurAction(409, "Transférez d'abord le statut d'Administrateur principal");
  }
  try {
    await prisma.utilisateur.delete({ where: { id: compte.id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      throw new ErreurAction(
        409,
        "Suppression impossible : ce compte a de l'activité enregistrée (ventes, commandes…).",
      );
    }
    throw e;
  }
  return { message: `Compte « ${compte.nom} » supprimé` };
},
```

Trois protections successives : (1) le compte existe toujours (`404` sinon — le cas typique d'une demande devenue obsolète entre-temps) ; (2) ce n'est pas l'Admin Principal (`409` — cette vérification, déjà présente dans la route appelante `equipe.ts`, §5.7, est **délibérément répétée ici** conformément au principe énoncé plus haut : l'état a pu changer entre la demande et l'approbation, y compris le statut d'Admin Principal lui-même, transférable via `POST /equipe/:id/principal`) ; (3) la suppression elle-même, avec un `try/catch` qui traduit spécifiquement le code d'erreur Prisma `P2003` (violation de contrainte de clé étrangère — le compte est référencé ailleurs, par exemple des ventes ou des commandes qu'il a enregistrées) en un message compréhensible plutôt que de laisser remonter une erreur technique brute. Toute autre erreur Prisma est relancée telle quelle (`throw e`), non transformée en `ErreurAction`.

### `CREER_COMPTE_ADMIN`

```ts
CREER_COMPTE_ADMIN: async ({ nom, email, roleId, motDePasseHash, travailleurId }) => {
  const existant = await prisma.utilisateur.findUnique({ where: { email: email as string } });
  if (existant) throw new ErreurAction(409, "Un compte utilise déjà cette adresse e-mail");
  const nbAdmins = await prisma.utilisateur.count({ where: { role: { nom: ROLE_ADMINISTRATEUR } } });
  if (nbAdmins >= MAX_COMPTES_ADMIN) {
    throw new ErreurAction(409, `Limite atteinte : au plus ${MAX_COMPTES_ADMIN} comptes Administrateur`);
  }
  const compte = await prisma.$transaction(async (tx) => {
    const c = await tx.utilisateur.create({ data: { nom: nom as string, email: email as string, roleId: roleId as string, motDePasseHash: motDePasseHash as string } });
    if (travailleurId) await tx.travailleur.update({ where: { id: travailleurId as string }, data: { utilisateurId: c.id } });
    return c;
  });
  return { message: `Compte Administrateur « ${compte.nom} » créé` };
},
```

Même logique de revérification : l'unicité de l'e-mail et le quota des 3 comptes Administrateur (Volume 11d, `verifierQuotaAdmins`) sont **revérifiés ici**, alors qu'ils l'ont déjà été une première fois dans la route `equipe.ts` avant même la création de la demande. Si un autre Admin a, entre-temps, créé un troisième compte Admin par un autre chemin, cette seconde vérification bloque la création en évitant de dépasser la limite. Notez que `motDePasseHash` (le mot de passe déjà haché par bcrypt, Volume 11d) transite tel quel dans `donnees` — jamais le mot de passe en clair, qui n'existe déjà plus à ce stade de la chaîne.

### `MODIFIER_TYPE_CLIENT`

```ts
MODIFIER_TYPE_CLIENT: async ({ typeClientId, data }) => {
  const d = data as { nom?: string; prixParBac?: number; commissionParBac?: number };
  const existant = await prisma.typeClient.findUnique({ where: { id: typeClientId as string } });
  if (!existant) throw new ErreurAction(404, "Qualité introuvable");
  if (d.nom && d.nom !== existant.nom) {
    const doublon = await prisma.typeClient.findUnique({ where: { nom: d.nom } });
    if (doublon) throw new ErreurAction(409, "Une qualité porte déjà ce nom");
  }
  const tc = await prisma.typeClient.update({ where: { id: existant.id }, data: d });
  return { message: `Qualité « ${tc.nom} » mise à jour` };
},
```

`data` peut contenir n'importe quelle combinaison de `nom`, `prixParBac`, `commissionParBac` — la route appelante (§5.7, `clients.ts`) transmet tel quel le corps déjà validé par son schéma Zod. Le point notable, vérifiable dans `apps/api/src/routes/clients.ts` : **toute** modification d'une Qualité (`PUT /api/typeclients/:id`) est traitée comme critique, y compris un simple renommage sans toucher au prix ni à la commission. La spécification ne parle que de « prix ou commissions » — le code est donc un peu plus large que la formulation littérale de la spec dans ce cas précis, mais sans la contredire : renommer une Qualité n'est pas explicitement classé « non critique » par la spécification non plus. C'est une différence de granularité (le code protège tout l'enregistrement, la spec ne motive explicitement que deux de ses champs), pas un écart de comportement contraire à la spec.

### `MODIFIER_TAUX_TAXE`

```ts
MODIFIER_TAUX_TAXE: async ({ produitId, data }) => {
  const existant = await prisma.produit.findUnique({ where: { id: produitId as string } });
  if (!existant) throw new ErreurAction(404, "Produit introuvable");
  const produit = await prisma.produit.update({
    where: { id: existant.id },
    data: data as Prisma.ProduitUpdateInput,
  });
  return { message: `Produit « ${produit.nom} » — taux de taxe fixé à ${produit.tauxTaxe} %` };
},
```

Ici, `data` est typé `Prisma.ProduitUpdateInput` — c'est-à-dire n'importe quel champ modifiable d'un `Produit`, pas seulement `tauxTaxe`. Ce n'est un problème que si la route appelante déclenchait ce type d'action pour une modification qui ne toucherait pas réellement le taux — ce qu'elle ne fait justement pas, comme le montre `apps/api/src/routes/produits.ts` :

```ts
// apps/api/src/routes/produits.ts
const changeTaux = parsed.data.tauxTaxe !== undefined && parsed.data.tauxTaxe !== existant.tauxTaxe;
if (changeTaux) {
  const r = await traiterActionCritique(req, "MODIFIER_TAUX_TAXE", { produitId: existant.id, data: parsed.data }, ...);
  return res.status(r.http).json(r.body);
}
const produit = await prisma.produit.update({ where: { id: req.params.id }, data: parsed.data });
```

La route ne route vers le chemin critique **que si `tauxTaxe` fait réellement partie des champs modifiés et que sa valeur change**. Une modification de `nom`, de prix ou de catégorie qui ne touche pas au taux de taxe reste une action directe, immédiatement exécutée quel que soit le rôle — cohérent avec la spec, qui ne cite que le taux de taxe comme critique. **Point à noter** : si une requête modifie *à la fois* le taux de taxe et d'autres champs (ex. le nom) en un seul appel, c'est l'ensemble de `parsed.data` — donc aussi le nom — qui transite dans `donnees` et se retrouve soumis à approbation en bloc. Un Admin secondaire ne peut donc pas contourner l'approbation en associant un changement de taux à un autre changement dans le même appel ; à l'inverse, il ne peut pas non plus faire approuver son changement de nom « tout seul » s'il l'accompagne d'un changement de taux — les deux sont liés dans la même demande.

### `MODIFIER_PERMISSIONS_ROLE`

```ts
MODIFIER_PERMISSIONS_ROLE: async ({ roleId, permissions }) => {
  const role = await prisma.role.findUnique({ where: { id: roleId as string } });
  if (!role) throw new ErreurAction(404, "Rôle introuvable");
  const perms = permissions as { module: Module; niveauAcces: NiveauAcces }[];
  await prisma.$transaction(async (tx) => {
    for (const p of perms) {
      await tx.rolePermission.upsert({
        where: { roleId_module: { roleId: role.id, module: p.module } },
        update: { niveauAcces: p.niveauAcces },
        create: { roleId: role.id, module: p.module, niveauAcces: p.niveauAcces },
      });
    }
    const gardes = perms.filter((p) => p.niveauAcces !== "AUCUN").map((p) => p.module);
    await tx.rolePermission.deleteMany({
      where: { roleId: role.id, module: { notIn: gardes.length ? gardes : ["CAISSE"] } },
    });
    if (!gardes.length) await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
  });
  return { message: `Permissions du rôle « ${role.nom} » mises à jour` };
},
```

La liste `permissions` reçue **remplace entièrement** la matrice de permissions du rôle visé (rappel du Volume 11d : l'absence de `RolePermission` pour un module équivaut à `AUCUN` — Volume 11a, `aAcces`). Le déroulement, dans une transaction Prisma (tout réussit ou rien n'est appliqué) :

1. Pour chaque entrée reçue, `upsert` (crée si absente, met à jour sinon) la permission correspondante avec son `niveauAcces`.
2. `gardes` : la liste des modules qui doivent **rester** en base après l'opération — ceux dont le niveau reçu n'est pas `AUCUN` (rappel : un module à `AUCUN` n'a pas besoin d'exister comme ligne, son absence a le même effet).
3. `deleteMany` supprime toute permission existante du rôle dont le module n'est **pas** dans `gardes` — c'est ce qui traite le cas d'un module qui *était* accordé et que la nouvelle liste retire ou met à `AUCUN`.

**Le détail le plus subtil de cette fonction** : `notIn: gardes.length ? gardes : ["CAISSE"]`. Le tableau `notIn` de Prisma ne peut pas être vide — une requête `NOT IN ()` est soit invalide, soit se comporterait de façon inattendue selon le moteur. Si `gardes` est vide (cas où toutes les permissions envoyées valent `AUCUN`, donc aucun module à préserver), le code utilise `["CAISSE"]` comme valeur de repli **arbitraire et sans rapport avec le module Caisse lui-même** — n'importe quelle valeur de `Module` aurait fonctionné ici, puisque le but est seulement d'obtenir un tableau non vide pour que `notIn` reste une requête valide, tout en sachant qu'aucun module réel ne doit survivre dans ce cas. C'est pour cette raison que la ligne suivante (`if (!gardes.length) await tx.rolePermission.deleteMany({ where: { roleId: role.id } })`) existe : elle balaie ensuite **toutes** les permissions du rôle sans condition de module, rendant inoffensive l'utilisation de `"CAISSE"` comme simple bouche-trou technique au step précédent.

## 5.4 `executerAction` et `traiterActionCritique`

```ts
export function executerAction(type: TypeActionCritique, donnees: Donnees): Promise<{ message: string }> {
  return EXECUTEURS[type](donnees);
}
```

Un simple aiguillage par table (`EXECUTEURS[type]`) — pas de `switch`. Exportée séparément car réutilisée telle quelle par `approbations.ts` (§5.5) au moment de l'approbation.

```ts
export async function traiterActionCritique(
  req: Request,
  type: TypeActionCritique,
  donnees: Donnees,
  resume: string,
): Promise<{ http: number; body: ResultatActionCritique | { erreur: string } }> {
  const auteur = req.utilisateur!;

  if (auteur.estAdminPrincipal) {
    try {
      const { message } = await executerAction(type, donnees);
      return { http: 200, body: { statut: "execute", message } };
    } catch (e) {
      if (e instanceof ErreurAction) return { http: e.status, body: { erreur: e.message } };
      throw e;
    }
  }

  const demande = await prisma.demandeApprobation.create({
    data: { type, donnees: donnees as Prisma.InputJsonValue, resume, demandeParId: auteur.id },
  });
  const principal = await prisma.utilisateur.findFirst({ where: { estAdminPrincipal: true }, select: { id: true } });
  busEvenements.emettreEvenement({
    type: "DEMANDE_APPROBATION",
    module: "EQUIPE",
    emetteurId: auteur.id,
    evenementRef: demande.id,
    priorite: "HAUTE",
    destinataireIdsDirects: principal ? [principal.id] : [],
    message: `Demande d'approbation — ${auteur.nom} souhaite : ${resume}`,
    donnees: { demandeId: demande.id, type },
  });

  return {
    http: 202,
    body: { statut: "en_attente_approbation", message: `Action soumise à l'approbation de l'Administrateur principal — ${resume}` },
  };
}
```

C'est la fonction que les quatre routes appelantes (§5.5) invoquent, jamais `EXECUTEURS` ou `executerAction` directement. Elle prend quatre paramètres : la requête (pour connaître l'auteur via `req.utilisateur`, posé par `requireAuth`, Volume 11b), le type de tâche, les données nécessaires à son exécution, et un `resume` — une phrase lisible, déjà écrite par l'appelant (ex. `"modifier la qualité « Maman » (prix/commission)"`), destinée à être affichée telle quelle à l'écran (§5.6) sans que le lecteur ait besoin de reconstituer le contexte depuis les données brutes.

**Branche Admin Principal** (`auteur.estAdminPrincipal`) : exécution immédiate via `executerAction`, avec `200` et `{ statut: "execute", message }` en cas de succès, ou le code/message de l'`ErreurAction` en cas d'échec métier (toute autre erreur remonte non capturée, vers le middleware d'erreur générique).

**Branche Admin secondaire** : aucune exécution n'a lieu ici. Trois étapes : (1) créer la `DemandeApprobation` avec le statut par défaut `EN_ATTENTE` (défini dans le schéma Prisma, non répété ici) et les `donnees` sérialisées en JSON ; (2) retrouver l'Admin Principal en base (`findFirst({ estAdminPrincipal: true })` — rappel du Volume 11d : un seul compte peut avoir ce booléen à `true` à un instant donné, garanti par un index unique partiel) ; (3) émettre un événement temps réel de type `DEMANDE_APPROBATION`, ciblé directement sur l'Admin Principal (`destinataireIdsDirects: principal ? [principal.id] : []`) — le mécanisme complet de `busEvenements` (salles Socket.io, structure de l'événement, ce qui se passe côté client à la réception) est détaillé au Volume 12 ; ce chapitre n'en retient que l'usage : une notification est déclenchée, ciblée sur le bon destinataire, avec un message préformaté reprenant le `resume`. La réponse HTTP est `202 Accepted` — un code qui signifie explicitement *« requête acceptée, mais pas encore traitée »*, plus précis ici que `200 OK` puisque l'action demandée n'a, par définition, pas encore eu lieu.

**Cas non prévu, mais qui ne peut pas se produire en pratique** : que se passe-t-il si aucun Admin Principal n'existe en base au moment où `principal` est recherché ? Le code ne lève pas d'erreur — `destinataireIdsDirects` devient simplement un tableau vide, et la demande est créée sans notification envoyée à personne. **Non confirmé dans le code actuel** qu'un tel état (zéro Admin Principal) soit atteignable en pratique — la contrainte d'unicité vue au Volume 11d empêche d'en avoir *plusieurs*, mais rien dans le schéma n'empêche structurellement d'en avoir *zéro*. La demande resterait alors visible dans la file (§5.6, un Admin secondaire voit ses propres demandes), mais personne ne serait notifié et personne n'aurait le droit de l'approuver (§5.5, réservé à `estAdminPrincipal`) — elle resterait bloquée indéfiniment. Un scénario en pratique très improbable (voir Volume 11d sur le mécanisme de transfert du statut), à traiter comme une hypothèse plutôt qu'un défaut confirmé.

## 5.5 `approbationsRouter` — consulter, approuver, rejeter

```ts
// apps/api/src/routes/approbations.ts
approbationsRouter.use(requireAuth, requirePermission("EQUIPE", "ECRITURE"));
```

Même garde que `delegationsRouter` (Volume 11e) : authentifié, `EQUIPE` en écriture — en pratique, tout Admin (Principal ou secondaire).

### `GET /api/approbations` — une file, deux points de vue

```ts
approbationsRouter.get("/", async (req, res, next) => {
  const demandes = await prisma.demandeApprobation.findMany({
    where: req.utilisateur!.estAdminPrincipal ? {} : { demandeParId: req.utilisateur!.id },
    include: INCLUDE,
    orderBy: [{ statut: "asc" }, { dateDemande: "desc" }],
    take: 100,
  });
  res.json({ demandes: demandes.map(versDTO) });
});
```

Le filtre `where` dépend de qui interroge : l'Admin Principal voit **toutes** les demandes de tous les Admins secondaires (c'est lui qui doit les traiter) ; un Admin secondaire ne voit que **les siennes** (`demandeParId: req.utilisateur!.id`) — de quoi suivre où en est chacune de ses propres demandes, sans visibilité sur celles soumises par d'autres Admins secondaires. Ce filtrage est fait côté serveur, pas simplement caché côté client — un Admin secondaire ne reçoit jamais les données des demandes d'un autre dans la réponse JSON.

`orderBy: [{ statut: "asc" }, { dateDemande: "desc" }]` : trié d'abord par statut, puis par date décroissante à l'intérieur de chaque statut. Un point qui peut surprendre à la lecture : `STATUTS_DEMANDE` est défini comme `["EN_ATTENTE", "APPROUVEE", "REJETEE"]`, dans cet ordre — ni alphabétique, ni chronologique du cycle de vie évident au premier regard. Comme `StatutDemande` est un *enum* natif PostgreSQL (déclaré dans `prisma/schema.prisma` avec ces trois valeurs dans cet ordre précis), et que Postgres trie un enum selon son **ordre de déclaration** et non l'ordre alphabétique de ses valeurs, `orderBy: "asc"` place `EN_ATTENTE` avant `APPROUVEE` et `REJETEE` — exactement l'ordre voulu pour l'écran (§5.6) : les demandes en attente remontent naturellement en tête de liste, sans logique de tri supplémentaire à écrire côté application.

### `POST /api/approbations/:id/approuver`

```ts
if (!req.utilisateur!.estAdminPrincipal) {
  return res.status(403).json({ erreur: "Seul l'Administrateur principal peut approuver une demande" });
}
const demande = await prisma.demandeApprobation.findUnique({ where: { id: req.params.id } });
if (!demande) return res.status(404).json({ erreur: "Demande introuvable" });
if (demande.statut !== "EN_ATTENTE") {
  return res.status(409).json({ erreur: "Cette demande a déjà été traitée" });
}
try {
  const { message } = await executerAction(demande.type as TypeActionCritique, demande.donnees as Record<string, unknown>);
  const maj = await prisma.demandeApprobation.update({
    where: { id: demande.id },
    data: { statut: "APPROUVEE", approuveParId: req.utilisateur!.id, dateDecision: new Date(), erreur: null },
    include: INCLUDE,
  });
  res.json({ demande: versDTO(maj), message });
} catch (e) {
  if (e instanceof ErreurAction) {
    await prisma.demandeApprobation.update({ where: { id: demande.id }, data: { erreur: e.message } });
    return res.status(e.status).json({ erreur: `Exécution impossible : ${e.message}` });
  }
  throw e;
}
```

Trois gardes avant toute exécution : (1) l'appelant est bien l'Admin Principal — **contrôle applicatif explicite**, distinct de la permission `EQUIPE ECRITURE` vérifiée par le middleware (qu'un Admin secondaire possède aussi), donc bien la garde qui applique la règle *« seul l'Admin Principal peut approuver »* de la spec ; (2) la demande existe ; (3) elle est encore `EN_ATTENTE` — refuse de retraiter une demande déjà décidée (`409`).

Vient alors le rejeu de l'action, via `executerAction` (§5.4), exactement comme si l'Admin Principal l'avait déclenchée lui-même directement — **c'est le même appel** que celui fait dans la branche « Admin Principal » de `traiterActionCritique`. En cas de succès : la demande passe à `APPROUVEE`, avec l'identité et la date de la décision enregistrées, et `erreur` explicitement remise à `null` (utile si une tentative précédente avait échoué, voir plus bas).

**Le cas d'échec mérite une lecture attentive** : si `executerAction` lève une `ErreurAction` (par exemple, la Qualité visée a été supprimée entre-temps), la route **ne marque pas la demande comme rejetée ni comme échouée** — elle enregistre seulement le message dans le champ `erreur` de la `DemandeApprobation`, **sans toucher à `statut`**, qui reste `EN_ATTENTE`. Concrètement : la demande demeure dans la file « en attente » (§5.6), avec un message d'erreur visible sous son résumé, et reste **cliquable à nouveau** — l'Admin Principal peut retenter l'approbation plus tard (si la situation qui bloquait l'exécution est corrigée), ou choisir de la rejeter explicitement via l'autre route. Ce choix de conception — ne pas transformer un échec d'exécution en rejet automatique — laisse la décision finale (retenter ou abandonner) entre les mains de l'Admin Principal plutôt que de la prendre à sa place.

### `POST /api/approbations/:id/rejeter`

```ts
if (!req.utilisateur!.estAdminPrincipal) {
  return res.status(403).json({ erreur: "Seul l'Administrateur principal peut rejeter une demande" });
}
const demande = await prisma.demandeApprobation.findUnique({ where: { id: req.params.id } });
if (!demande) return res.status(404).json({ erreur: "Demande introuvable" });
if (demande.statut !== "EN_ATTENTE") {
  return res.status(409).json({ erreur: "Cette demande a déjà été traitée" });
}
const maj = await prisma.demandeApprobation.update({
  where: { id: demande.id },
  data: { statut: "REJETEE", approuveParId: req.utilisateur!.id, dateDecision: new Date() },
  include: INCLUDE,
});
res.json({ demande: versDTO(maj) });
```

Symétrique de l'approbation, mais **sans jamais appeler `executerAction`** — rejeter une demande ne déclenche par définition aucune exécution, seulement un changement de statut. Notez que `approuveParId` est renseigné même en cas de rejet (le nom du champ, hérité du modèle Prisma, désigne plus précisément « qui a décidé » que « qui a approuvé » — la DTO correspondante l'expose d'ailleurs sous ce même nom `approuvePar`, utilisé aussi bien pour afficher qui a approuvé que qui a rejeté, §5.6).

## 5.6 Où les 5 tâches critiques sont réellement déclenchées

| Type | Déclenché par | Condition | Détaillé au |
|---|---|---|---|
| `CREER_COMPTE_ADMIN` | `POST /api/equipe` | Le rôle choisi est « Administrateur » | Volume 11d, §5.3 |
| `SUPPRIMER_UTILISATEUR` | `DELETE /api/equipe/:id` | Toujours (tout compte, Admin ou non) | Volume 11d, §5.7 |
| `MODIFIER_TYPE_CLIENT` | `PUT /api/typeclients/:id` | Toujours (tout champ modifié) | ce chapitre, §5.3 |
| `MODIFIER_TAUX_TAXE` | `PUT /api/produits/:id` | Seulement si `tauxTaxe` fait partie des champs modifiés et change réellement | ce chapitre, §5.3 |
| `MODIFIER_PERMISSIONS_ROLE` | `PUT /api/roles/:id/permissions` | Toujours | Volume 11d, §5.8 (écart : aucune UI pour cette route) |

Un point de vigilance à propos de la dernière ligne, déjà noté au Volume 11d : bien que la route serveur existe et passe correctement par `traiterActionCritique`, aucune interface n'a été trouvée dans `apps/web/src` pour l'appeler — un Admin secondaire ne peut donc, en l'état de l'interface, jamais réellement déclencher une demande de type `MODIFIER_PERMISSIONS_ROLE`, faute d'écran pour le faire. L'écart déjà consigné dans `annexes/ecarts-spec-code.md` reste valable sans modification ; ce chapitre ne fait que confirmer qu'il touche aussi le mécanisme d'approbation, pas seulement le module Équipe.

## 5.7 Côté client — `ApprobationsPage`

```tsx
// apps/web/src/pages/Approbations.tsx
const { data, isLoading } = useQuery({
  queryKey: ["approbations"],
  queryFn: () => api<{ demandes: DemandeApprobationDTO[] }>("/api/approbations"),
  refetchInterval: 20000,
});
```

`refetchInterval: 20000` : contrairement aux autres écrans de ce livre jusqu'ici (qui se contentent d'invalider leur cache après une mutation), cette page se rafraîchit **automatiquement toutes les 20 secondes**, même sans action de l'utilisateur. Une redondance volontaire avec la notification temps réel (§5.4) plutôt qu'un remplacement : la notification Socket.io informe qu'une nouvelle demande existe, mais rien dans le code ne relie directement la réception de cet événement à un rafraîchissement immédiat de *cette* page précise (ce lien, s'il existe ailleurs — par exemple un simple indicateur de notification qui pousse l'utilisateur à visiter la page — n'a pas été retrouvé dans ce fichier). Le polling toutes les 20 secondes garantit donc que la liste reste à jour même si la notification temps réel a été manquée (déconnexion Socket.io momentanée, onglet resté ouvert avant la connexion), au prix d'un léger délai.

```tsx
const rafraichir = () => {
  queryClient.invalidateQueries({ queryKey: ["approbations"] });
  queryClient.invalidateQueries({ queryKey: ["equipe"] });
  queryClient.invalidateQueries({ queryKey: ["roles"] });
};
```

Après une décision (approbation ou rejet), trois caches TanStack Query sont invalidés, pas seulement celui des approbations : une demande approuvée peut avoir modifié l'équipe (compte créé/supprimé) ou les rôles (permissions) — le commentaire du code le dit explicitement : *« Une décision peut modifier comptes/rôles/qualités/produits : on invalide large. »* Notez que les caches `["clients"]` (qualités) et `["produits"]` ne sont, eux, **pas** listés ici alors que `MODIFIER_TYPE_CLIENT` et `MODIFIER_TAUX_TAXE` peuvent tout autant être approuvés depuis cet écran — si un Admin Principal approuve une modification de prix de Qualité depuis la page Approbations, l'écran Clients, s'il est ouvert dans un autre onglet ou revisité sans rechargement complet, pourrait afficher une donnée obsolète jusqu'à sa prochaine invalidation naturelle. **Non confirmé dans le code actuel** que cela cause un problème visible en pratique (un changement de route recharge généralement les données), mais c'est une invalidation moins complète que le commentaire du code ne le laisse penser.

`estPrincipal = !!utilisateur?.estAdminPrincipal` conditionne l'affichage des boutons Approuver/Rejeter (`estPrincipal && d.statut === "EN_ATTENTE"`) — un Admin secondaire voit sa propre demande dans la liste (avec son statut, y compris un éventuel message d'erreur du champ `erreur`), mais sans aucun bouton d'action, cohérent avec la garde serveur du §5.5. Les demandes sont réparties en deux groupes affichés séparément : `enAttente` (statut `EN_ATTENTE`) dans une carte toujours visible, et `traitees` (`APPROUVEE` ou `REJETEE`) dans une carte « historique » qui n'apparaît que si elle contient au moins un élément.

## 5.8 Exemple chiffré bout en bout

Un scénario complet, avec des valeurs concrètes, pour illustrer le cycle entier.

**Situation** : Jeanne, Admin secondaire, doit augmenter la commission par bac de la Qualité « Maman » de 1 650 Fc à 1 800 Fc (la spec cite 1 650 Fc comme valeur en vigueur au moment de l'audit — Volume 11a, Glossaire).

1. Jeanne modifie le champ commission dans l'écran Clients et valide. Le client envoie `PUT /api/typeclients/<id>` avec `{ commissionParBac: 1800 }`.
2. La route (`clients.ts`) valide via Zod, vérifie l'absence de doublon de nom (non pertinent ici, `nom` n'est pas dans la requête), puis appelle `traiterActionCritique(req, "MODIFIER_TYPE_CLIENT", { typeClientId, data: { commissionParBac: 1800 } }, "modifier la qualité « Maman » (prix/commission)")`.
3. Jeanne n'est pas Admin Principal → une `DemandeApprobation` est créée : `{ type: "MODIFIER_TYPE_CLIENT", statut: "EN_ATTENTE", donnees: { typeClientId, data: { commissionParBac: 1800 } }, resume: "modifier la qualité « Maman » (prix/commission)", demandeParId: <id de Jeanne> }`. Réponse au navigateur de Jeanne : `202`, `{ statut: "en_attente_approbation", message: "Action soumise à l'approbation de l'Administrateur principal — modifier la qualité « Maman » (prix/commission)" }`.
4. Paul, l'Admin Principal, reçoit une notification temps réel (« Demande d'approbation — Jeanne souhaite : modifier la qualité « Maman » (prix/commission) ») et voit la demande apparaître dans sa file (rafraîchie au plus tard 20 secondes après, ou immédiatement via la notification).
5. Paul clique « Approuver ». `POST /api/approbations/<id>/approuver`. La route vérifie que Paul est bien l'Admin Principal, que la demande existe et est encore `EN_ATTENTE`, puis appelle `executerAction("MODIFIER_TYPE_CLIENT", { typeClientId, data: { commissionParBac: 1800 } })` — **exactement les mêmes données que celles soumises par Jeanne**, ni plus ni moins.
6. L'exécuteur relit la Qualité en base (revérification, §5.3) : elle existe toujours, la mise à jour s'applique — `commissionParBac` passe de 1650 à 1800. Réponse : `{ message: "Qualité « Maman » mise à jour" }`.
7. La `DemandeApprobation` passe à `APPROUVEE`, avec `approuveParId = <id de Paul>` et `dateDecision = maintenant`.
8. **Effet financier concret** : toute commande passée par une cliente de Qualité « Maman » à partir de ce moment utilisera 1 800 Fc/bac dans `calculerCommande` (Volume 11a) pour le calcul de sa commission — les commandes déjà enregistrées avant l'approbation gardent leur commission déjà figée au moment de leur propre calcul (rappel du Volume 11a : chaque commande fige son propre résultat à l'enregistrement, aucun recalcul rétroactif).

**Variante avec échec** : si, avant que Paul ne clique « Approuver », un autre Admin avait entre-temps supprimé la Qualité « Maman » (peu probable en pratique, mais possible techniquement), l'étape 6 lèverait `ErreurAction(404, "Qualité introuvable")`. La route capturerait cette erreur, enregistrerait `erreur: "Qualité introuvable"` sur la `DemandeApprobation` **sans changer son statut** (toujours `EN_ATTENTE`), et répondrait `404` à Paul avec `"Exécution impossible : Qualité introuvable"`. La demande resterait visible dans sa file « en attente », avec ce message affiché — Paul pourrait alors la rejeter explicitement pour la clore.

## 5.9 Cas limites

| Situation | Comportement |
|---|---|
| L'Admin Principal déclenche lui-même une tâche critique | Exécution immédiate, aucune `DemandeApprobation` créée (§5.4). |
| Un Admin secondaire tente d'approuver/rejeter (même sa propre demande) | `403`, quelle que soit l'origine de la demande (§5.5). |
| Approuver/rejeter une demande déjà traitée | `409 Cette demande a déjà été traitée`. |
| Approuver une demande dont l'exécution échoue | La demande reste `EN_ATTENTE`, avec `erreur` renseigné ; ré-approbation possible plus tard (§5.5). |
| Rejeter une demande | Aucun appel à `executerAction` — changement de statut seul, jamais d'échec d'exécution possible sur un rejet. |
| `MODIFIER_PERMISSIONS_ROLE` retirant toutes les permissions d'un rôle | `gardes` vide → repli technique sur `["CAISSE"]` pour `notIn`, puis suppression totale explicite (§5.3). |
| Aucun Admin Principal en base au moment d'une demande | Demande créée sans destinataire de notification ; **non confirmé** que ce cas soit atteignable en pratique (§5.4). |
| Modification combinée nom + taux de taxe sur un produit | L'ensemble part en demande unique — pas de contournement possible en séparant les champs sensibles des champs neutres dans un seul appel (§5.3). |

## 5.10 Croisement avec la spécification

Aucun écart de comportement trouvé. La spec (section 2, citée au §5.1, et section 3.16, citée plus bas) décrit fidèlement : la liste figée de 5 tâches critiques, l'exécution immédiate pour l'Admin Principal, la mise en attente avec notification temps réel pour un Admin secondaire, la restriction de la décision au seul Admin Principal, et l'exclusion explicite de la réinitialisation de base de données de ce mécanisme (vérifiée au Volume 23, à venir — la route de réinitialisation n'a jamais été vue passer par `traiterActionCritique` dans ce qui a été audité jusqu'ici).

> ### 3.16 Approbations *(Admin Principal uniquement)*
> File d'attente des demandes soumises par les Admins secondaires pour les tâches critiques (voir section 2). Chaque demande : type d'action, demandeur, données de l'action, date, statut. Notification temps réel instantanée à l'Admin Principal dès qu'une demande arrive ; approbation ou rejet en un clic, avec effet immédiat sur l'action en attente.
> — `docs/spec-boulangerie.md`, section 3.16

Deux nuances de granularité relevées (§5.3), aucune ne contredit la spec : `MODIFIER_TYPE_CLIENT` couvre tout changement sur une Qualité (pas seulement prix/commission), et `MODIFIER_TAUX_TAXE` peut, s'il est combiné à d'autres champs dans la même requête, faire passer ces autres champs sous approbation par association. Ni l'une ni l'autre n'est ajoutée à `annexes/ecarts-spec-code.md`, faute de contradiction réelle avec un énoncé de la spec — elles restent documentées ici comme des précisions utiles à connaître.

## 5.11 Résumé

`actionsCritiques.ts` centralise, dans un unique objet `EXECUTEURS`, l'implémentation réelle des 5 tâches critiques de la spécification — une implémentation unique, rejouée à l'identique qu'elle soit déclenchée directement par l'Admin Principal ou différée puis approuvée. `traiterActionCritique` est le seul point d'entrée que les routes métier doivent utiliser : il aiguille entre exécution immédiate et création d'une `DemandeApprobation` notifiée en temps réel, selon le statut de l'auteur. `approbations.ts` expose la file (filtrée selon qui regarde) et les deux décisions possibles, avec un choix de conception notable : un échec d'exécution à l'approbation ne rejette pas silencieusement la demande, il la laisse en attente avec l'erreur visible, réparable. Aucun écart avec la spécification ; deux nuances de granularité sans contradiction ont été relevées et expliquées.

---

**Suite →** Volume 11g — Journal d'audit (`apps/api/src/lib/audit.ts`), le mécanisme qui trace automatiquement les écritures réussies dans toute l'application — y compris, une fois ce chapitre posé, les actions critiques elles-mêmes une fois exécutées.
