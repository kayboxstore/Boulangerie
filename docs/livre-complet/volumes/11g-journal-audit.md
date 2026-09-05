# Volume 11g — Journal d'audit

**Niveau de risque : 1 — Critique.** Traitement exhaustif. Ce chapitre couvre le mécanisme qui trace, de façon centralisée et automatique, toutes les écritures sensibles de l'application — y compris, comme on le verra au §5.9, une conséquence intéressante sur la façon dont les actions critiques du Volume 11f y apparaissent une fois approuvées.

## Fiche d'identité des fichiers couverts

| Fichier | Lignes | Rôle |
|---|---:|---|
| `apps/api/src/lib/audit.ts` | 188 | Extension Prisma qui intercepte `update`/`delete` sur tous les modèles et écrit un `AuditLog` |
| `apps/api/src/lib/contexteRequete.ts` | 16 | `AsyncLocalStorage` propageant l'identité de l'auteur de la requête en cours |
| `apps/api/src/lib/prisma.ts` | 21 | Point unique d'instanciation du client Prisma applicatif, avec l'extension d'audit branchée |
| `apps/api/src/routes/audit.ts` | 59 | Consultation en lecture seule, filtrable, du journal |
| `apps/web/src/pages/Audit.tsx` | 296 | Écran de consultation avec filtres et diff avant/après dépliable |
| `packages/shared/src/index.ts` (extrait) | — | `ACTIONS_AUDIT`, `AuditLogDTO`, libellés associés |

- **Qui les appelle** : `apps/api/src/lib/prisma.ts` est le fichier qui **branche** `extensionAudit` — tout le reste du code serveur importe `prisma` depuis ce fichier (jamais directement `@prisma/client`), donc toute écriture `update`/`delete` de l'application entière passe, sans exception ni configuration au cas par cas, par ce mécanisme. `auditRouter` est monté sur `/api/audit` dans `app.ts` ; `AuditPage` est affichée par la route `/audit` de `App.tsx`, réservée en lecture au DG et aux Admins.
- **Ce qu'ils appellent** : `contexteRequete` (pour savoir qui écrit), `logger` (Volume 16, en cas d'échec d'écriture du journal lui-même).
- **Données modifiées** : uniquement le modèle `AuditLog`, en création — jamais modifié ni supprimé après coup (immuabilité voulue par la spec, §5.1).

## 5.1 Vue d'ensemble intuitive

> ### 3.17 Journal d'audit *(nouveau — DG et Admins uniquement, lecture seule)*
> Historique **immuable** de toute modification ou suppression (pas seulement les créations, déjà tracées via créePar/enregistrePar) : qui, quoi, quand, valeur avant/après. Protège l'ensemble de l'équipe — y compris les Admins, dont les actions y sont également journalisées. Filtrable par utilisateur, module, période.
> — `docs/spec-boulangerie.md`, section 3.17

L'idée : chaque fois qu'une donnée sensible est modifiée ou supprimée dans l'application, une trace immuable doit exister — qui l'a fait, quoi exactement, quand, et quelle était la valeur avant. Deux façons possibles d'implémenter cela : soit ajouter, à la main, un appel de journalisation dans chacune des dizaines de routes qui modifient quelque chose (risque d'oubli garanti sur le long terme), soit intercepter les écritures à un point unique, en amont de toutes les routes. Le code choisit la seconde option, via une **extension Prisma** — un mécanisme natif de Prisma qui permet d'enrober `update` et `delete` sur *tous* les modèles à la fois, à un seul endroit (`lib/audit.ts`), sans toucher au code des ~30 routes qui écrivent en base. Le commentaire d'en-tête du fichier résume ce choix : *« Plutôt que de dupliquer un appel de journalisation dans chacun des ~13 modules, on branche une extension Prisma sur les opérations d'ÉCRITURE `update` et `delete`. »*

Deux exclusions volontaires, confirmées par la spec elle-même : les **créations** ne sont pas journalisées ici, car chaque entité porte déjà un champ `créePar`/`enregistrePar` qui identifie son auteur (une autre forme de traçabilité, déjà présente indépendamment du journal) ; et les **tentatives refusées** (une permission insuffisante, qui produit une réponse `403`) ne sont jamais journalisées non plus, puisqu'elles n'atteignent jamais Prisma — la question est explicitement tranchée dans les questions ouvertes de la spec : *« uniquement les actions réussies (modifications et suppressions effectivement appliquées) — les tentatives refusées (403) ne sont pas journalisées »* (section 12).

## 5.2 `contexteRequete.ts` — savoir qui écrit, sans le répéter partout

```ts
import { AsyncLocalStorage } from "node:async_hooks";

export interface ActeurRequete {
  id: string;
  nom: string;
}

export const contexteRequete = new AsyncLocalStorage<ActeurRequete>();
```

`AsyncLocalStorage` (Glossaire, Volume 2) est une API native de Node.js qui permet de faire circuler une valeur — ici, un simple `{ id, nom }` — à travers toute une chaîne d'appels asynchrones (fonctions `async`, `await`, callbacks de promesses) **sans avoir à la passer explicitement en paramètre à chaque fonction intermédiaire**. C'est ce qui permet à `lib/audit.ts`, plusieurs couches d'appels plus loin dans l'exécution d'une requête, de savoir qui est l'auteur sans que chaque route ni chaque fonction de service n'ait eu besoin de le transmettre explicitement.

Le contexte est ouvert à un seul endroit du code, déjà rencontré au Volume 11b sans être détaillé à l'époque :

```ts
// apps/api/src/middleware/auth.ts, dans requireAuth
req.utilisateur = utilisateur;
contexteRequete.run({ id: utilisateur.id, nom: utilisateur.nom }, () => next());
```

`contexteRequete.run(valeur, fonction)` exécute `fonction` (ici, `next()`, qui poursuit la chaîne de middlewares Express puis atteint la route) avec `valeur` accessible depuis n'importe quel point de code appelé, directement ou indirectement, à l'intérieur de cet appel — y compris après plusieurs `await`. Toute la suite du traitement de cette requête HTTP, jusqu'à sa réponse, se déroule donc « à l'intérieur » de ce contexte. `contexteRequete.getStore()`, appelé n'importe où pendant ce traitement (par exemple, depuis `lib/audit.ts`), renvoie `{ id, nom }` ; appelé en dehors de tout contexte ouvert (ex. un job planifié qui ne passe pas par `requireAuth`), il renvoie `undefined`.

**Conséquence directe pour ce chapitre** : une écriture Prisma déclenchée par n'importe quel chemin de code, du moment qu'il s'exécute dans le fil d'une requête déjà passée par `requireAuth`, est automatiquement attribuable au bon auteur — y compris, comme le signale le commentaire du fichier, *« l'exécution différée d'une tâche critique par le workflow d'approbation »*. Ce point précis a une implication concrète détaillée au §5.9.

## 5.3 `lib/prisma.ts` — où l'extension est réellement branchée

```ts
import { PrismaClient } from "@prisma/client";
import { extensionAudit } from "./audit.js";

const base = new PrismaClient();
export const prisma = base.$extends(extensionAudit(base));

export type TxClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
```

Un fichier court mais central : c'est l'unique endroit du projet où `new PrismaClient()` est appelé. Deux clients coexistent en mémoire : `base`, le client Prisma standard, non modifié ; et `prisma`, le même client **étendu** (`$extends`, une API native de Prisma pour ajouter du comportement autour des requêtes) avec `extensionAudit(base)` — c'est `prisma`, l'export nommé de ce fichier, que **tout le reste du code applicatif** importe (`import { prisma } from "../lib/prisma.js"`, vu dans chaque chapitre précédent). `base` reste privé à ce module, transmis uniquement à `extensionAudit` pour son usage interne (§5.6).

`TxClient` est un type utilitaire, pas une valeur : Prisma donne au client étendu par `$extends` un type légèrement différent de celui d'un client Prisma standard pour son objet `tx` (le client transactionnel fourni à l'intérieur d'un `prisma.$transaction(async (tx) => ...)`, déjà rencontré aux volumes 11d et 11f). `TxClient` sert de type de paramètre pour les fonctions qui reçoivent ce `tx` — un détail de plomberie TypeScript sans effet sur le comportement à l'exécution, mentionné ici pour complétude plutôt que pour son importance pédagogique.

## 5.4 `MODELE_MODULE` — quels modèles sont audités

```ts
const MODELE_MODULE: Record<string, string> = {
  Utilisateur: "EQUIPE", Role: "EQUIPE", RolePermission: "EQUIPE",
  DemandeApprobation: "EQUIPE", DelegationRole: "EQUIPE",
  Produit: "PARAMETRES", TypeClient: "PARAMETRES", ParametreBoutique: "PARAMETRES",
  Client: "COMMANDES", CommandeClient: "COMMANDES", PaiementCommande: "COMMANDES",
  ZoneDepositaire: "COMMANDES",
  TauxDuJour: "CAISSE", DepenseCaisse: "CAISSE",
  MatierePremiere: "STOCKS", MouvementStock: "STOCKS",
  PlanningProduction: "PRODUCTION", PlanningLigneProduit: "PRODUCTION", ProductionDon: "PRODUCTION",
  MotifDon: "PRODUCTION", Production: "PRODUCTION",
  SchemaCommande: "PRODUCTION", SchemaCommandeLigne: "PRODUCTION",
  BonLivraison: "PRODUCTION", BonLivraisonLigne: "PRODUCTION",
  Fournisseur: "FOURNISSEURS", CommandeFournisseur: "FOURNISSEURS", LigneCommandeFournisseur: "FOURNISSEURS",
  Travailleur: "TRAVAILLEURS", Presence: "TRAVAILLEURS", Pointage: "TRAVAILLEURS",
  Absence: "TRAVAILLEURS", Sanction: "TRAVAILLEURS", BulletinPaie: "TRAVAILLEURS",
  Departement: "TRAVAILLEURS", Groupe: "TRAVAILLEURS",
};
```

Une table de correspondance modèle Prisma → module applicatif (`Module`, Volume 11a), utilisée à deux fins à la fois : déterminer **si** un modèle doit être audité (une clé absente de cette table = jamais audité) et sous **quel module** l'entrée du journal doit être classée (pour le filtre par module, §5.7). Trois modèles sont explicitement absents, avec leur justification documentée en commentaire dans le fichier lui-même : `Notification` (volume trop élevé, système plutôt que métier), `AuditLog` (s'auditer lui-même n'aurait pas de sens et créerait une boucle), `SauvegardeBase` (journal en ajout seul, Volume 23 — jamais modifié ni supprimé, donc rien que `update`/`delete` puissent intercepter). Le commentaire ajoute une note d'entretien à l'intention d'un futur développeur : *« Ajouter ici tout nouveau modèle qui, lui, se modifie ou se supprime »* — un rappel explicite que cette table n'est pas générée automatiquement et doit être tenue à jour manuellement à chaque nouveau modèle métier.

On note que deux modules de la liste `MODULES` (Volume 11a) — `COMMISSIONS` et `RAPPORTS` — n'apparaissent comme valeur nulle part dans cette table : aucun modèle Prisma ne leur est directement associé, cohérent avec leur nature de vues/calculs plutôt que d'entités possédant leur propre table modifiable indépendamment.

## 5.5 Les fonctions utilitaires : anonymiser et comparer proprement

```ts
const CLE_SENSIBLE = /hash|motdepasse|password|secret|token/i;

function normaliser(valeur: unknown): Record<string, unknown> | null {
  if (valeur === null || valeur === undefined) return null;
  const json = JSON.stringify(valeur, (_cle, v) => (typeof v === "bigint" ? v.toString() : v));
  const obj = JSON.parse(json);
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return null;
  const propre: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (CLE_SENSIBLE.test(k)) continue;
    if (v !== null && typeof v === "object") continue;
    propre[k] = v;
  }
  return propre;
}
```

`normaliser` transforme un enregistrement Prisma brut (qui peut contenir des types non directement sérialisables en JSON, comme `Decimal` ou `BigInt`) en un objet simple ne contenant que des champs scalaires (chaînes, nombres, booléens, `null`) — deux filtres explicites lors de la reconstruction : (1) tout champ dont le **nom** correspond à l'expression régulière `CLE_SENSIBLE` (insensible à la casse — capture `motDePasseHash`, mais aussi n'importe quel futur champ contenant `token`, `secret`, `password` ou `hash`) est **exclu sans exception**, jamais copié dans l'instantané ; (2) tout champ dont la **valeur** est elle-même un objet (une relation chargée, par exemple `role: { ... }` si elle avait été incluse) est également écarté — l'instantané ne conserve que les champs propres à l'entité elle-même, jamais ses relations. C'est cette double protection qui garantit que le journal d'audit, même s'il stocke un « avant/après » complet de chaque entité modifiée, ne peut jamais exposer un mot de passe haché ni un jeton — cohérent avec l'exigence de ce livre lui-même de ne jamais révéler ce type de valeur.

```ts
function alignerCles(
  apres: Record<string, unknown> | null,
  avant: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!apres) return null;
  if (!avant) return apres;
  const aligne: Record<string, unknown> = {};
  for (const k of Object.keys(avant)) if (k in apres) aligne[k] = apres[k];
  return aligne;
}
```

`alignerCles` ne garde, dans l'instantané « après », que les clés déjà présentes dans l'instantané « avant » — une précaution de cohérence pour que le diff affiché à l'écran (§5.8, `champsPertinents`) compare toujours des ensembles de champs correspondants, même dans un cas limite où la lecture « avant » aurait échoué partiellement ou renvoyé un ensemble de champs différent.

## 5.6 `extensionAudit` — l'interception elle-même

```ts
export function extensionAudit(base: PrismaClient) {
  async function lireAvant(model: string, where: unknown): Promise<Record<string, unknown> | null> {
    try {
      const delegate = (base as any)[versDelegate(model)];
      const enregistrement = await delegate.findUnique({ where });
      return normaliser(enregistrement);
    } catch {
      return null;
    }
  }

  async function journaliser(model, action, avant, apres) {
    const acteur = contexteRequete.getStore();
    const moduleApp = MODELE_MODULE[model];
    if (!acteur || !moduleApp) return; // hors requête authentifiée ou modèle non audité
    const entiteId = String((avant?.id ?? apres?.id) ?? "?");
    try {
      await base.auditLog.create({
        data: { utilisateurId: acteur.id, utilisateurNom: acteur.nom, module: moduleApp, typeEntite: model, entiteId, action, avant, apres },
      });
    } catch (e) {
      logger.error("Échec d'écriture du journal d'audit", { erreur: e });
    }
  }

  return {
    name: "audit",
    query: {
      $allModels: {
        async update({ model, args, query }) {
          const doitAuditer = !!MODELE_MODULE[model] && !!contexteRequete.getStore();
          const avant = doitAuditer ? await lireAvant(model, args.where) : null;
          const result = await query(args); // échec → propagé, rien n'est journalisé
          if (doitAuditer) {
            const apres = alignerCles(normaliser(result), avant);
            await journaliser(model, "MODIFICATION", avant, apres);
          }
          return result;
        },
        async delete({ model, args, query }) {
          const doitAuditer = !!MODELE_MODULE[model] && !!contexteRequete.getStore();
          const avant = doitAuditer ? await lireAvant(model, args.where) : null;
          const result = await query(args);
          if (doitAuditer) await journaliser(model, "SUPPRESSION", avant, null);
          return result;
        },
      },
    },
  };
}
```

**`versDelegate`** (`model.charAt(0).toLowerCase() + model.slice(1)`) traduit un nom de modèle Prisma (`"Utilisateur"`, en PascalCase, tel que renvoyé par le paramètre `model` de l'extension) vers le nom de la propriété correspondante sur le client Prisma (`prisma.utilisateur`, en camelCase) — une simple mise en minuscule de la première lettre, la convention constante entre Prisma Schema et Prisma Client.

**Le déroulement d'un `update` intercepté**, étape par étape :

1. `doitAuditer` : vrai seulement si (a) le modèle concerné figure dans `MODELE_MODULE` **et** (b) un contexte de requête est ouvert (`contexteRequete.getStore()` non `undefined`). Une écriture Prisma déclenchée hors de toute requête authentifiée — un script de maintenance exécuté directement, une tâche planifiée sans lien avec `requireAuth` — n'est donc **jamais** journalisée, faute d'auteur identifiable. C'est un choix assumé : mieux vaut ne rien journaliser que journaliser sans savoir qui.
2. Si `doitAuditer`, l'état **avant** modification est lu **avant** que l'opération réelle ne s'exécute, via `lireAvant` — qui interroge, non pas le modèle visé par l'`update` directement, mais le **client `base` non étendu**, avec un simple `findUnique`. C'est un choix déclaré dans le commentaire du fichier : passer par `base` évite de retraverser l'extension elle-même (ce qui provoquerait une récursion infinie : chaque `update` déclenchant une lecture, qui elle-même passerait encore par les hooks de l'extension) et n'interfère pas avec une transaction Prisma potentiellement en cours (une simple lecture MVCC — *Multiversion Concurrency Control*, le mécanisme standard de PostgreSQL qui permet à une lecture de voir un instantané cohérent des données sans bloquer les écritures concurrentes — ne pose ici aucun problème de verrouillage).
3. `query(args)` — l'appel à la fonction interne fournie par Prisma qui exécute **réellement** l'opération `update` d'origine. C'est un point essentiel : si cet appel échoue (contrainte violée, enregistrement introuvable...), l'erreur remonte telle quelle (`await query(args)` sans `try/catch` autour) et **rien n'est journalisé** — cohérent avec le principe de la spec : seules les actions réussies sont tracées.
4. Si `doitAuditer`, l'état **après** est construit à partir du `result` renvoyé par `query()` (déjà le nouvel état, pas besoin d'une seconde lecture en base), passé à `alignerCles` (§5.5) pour ne garder que les champs déjà vus dans l'instantané « avant ».
5. `journaliser` crée l'entrée `AuditLog`, elle aussi via `base.auditLog.create` (même raison : `create` n'est de toute façon même pas intercepté par cette extension, qui ne définit que `update`/`delete`, mais l'usage de `base` reste cohérent avec le reste du fichier).

Le `delete` suit exactement la même logique en plus simple : pas d'état « après » (l'enregistrement n'existe plus), donc `apres` vaut toujours `null` dans une entrée de type `SUPPRESSION`.

**Le point le plus important de conception, à retenir** : `journaliser` enveloppe son propre `await base.auditLog.create(...)` dans un `try/catch` qui, en cas d'échec, se contente d'un `logger.error(...)` — **jamais** de `throw`. Le commentaire du code l'explique sans ambiguïté : *« Un échec de journalisation ne doit jamais faire échouer l'action métier. »* Concrètement : si la base de données du journal d'audit devenait, pour une raison quelconque, temporairement inaccessible en écriture (alors que le reste de la base fonctionne), une commande client continuerait de s'enregistrer normalement — seule la trace d'audit de cette écriture-là manquerait, silencieusement du point de vue de l'utilisateur (mais visible dans les logs serveur, Volume 16). C'est un compromis délibéré entre l'exhaustivité du journal et la disponibilité de l'application : la spec ne tranche pas explicitement ce cas, mais la formulation *« Historique immuable »* n'implique pas *« blocage garanti si le journal est indisponible »* — un choix cohérent avec le reste du projet, qui privilégie systématiquement la continuité de service (voir aussi, au Volume 11d, l'exécution qui n'est jamais bloquée par un échec de notification temps réel).

## 5.7 `auditRouter` — consultation filtrée, lecture seule

```ts
auditRouter.use(requireAuth, requirePermission("EQUIPE", "LECTURE"));
```

Réservé à la lecture sur `EQUIPE` — en pratique, le DG (lecture sur tout, Volume 2) et les deux profils Admin (Volume 11d), cohérent avec la spec (« DG et Admins uniquement »). **Aucune route d'écriture n'existe dans ce fichier** — ni création, ni modification, ni suppression d'une entrée du journal ; la seule façon de créer une entrée est l'extension elle-même (§5.6), jamais un appel direct à `prisma.auditLog.create` ailleurs dans le code (vérifié par recherche dans le reste de `apps/api/src` : aucune autre occurrence). C'est ce qui rend le journal réellement immuable en pratique, pas seulement par convention.

```ts
auditRouter.get("/", async (req, res, next) => {
  const { utilisateurId, module, dateDebut, dateFin } = req.query as Record<string, string | undefined>;
  const where: Prisma.AuditLogWhereInput = {};
  if (utilisateurId) where.utilisateurId = utilisateurId;
  if (module && (MODULES as readonly string[]).includes(module)) where.module = module as Module;
  if (dateDebut || dateFin) {
    where.createdAt = {};
    if (dateDebut) where.createdAt.gte = new Date(`${dateDebut}T00:00:00.000Z`);
    if (dateFin) where.createdAt.lte = new Date(`${dateFin}T23:59:59.999Z`);
  }
  const entrees = await prisma.auditLog.findMany({ where, include: { utilisateur: { select: { id: true, nom: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  res.json({ entrees: entrees.map(versDTO) });
});
```

Trois filtres optionnels et cumulables, tous appliqués côté base de données (pas de filtrage en mémoire après coup) : par auteur, par module (avec une vérification que la valeur reçue en `query string` fait bien partie de l'énumération `MODULES` avant de l'utiliser dans la clause `where` — une requête avec un `module` invalide dans l'URL est simplement ignorée comme filtre, plutôt que de provoquer une erreur), et par période. Contrairement à la comparaison de chaînes ISO vue au Volume 11e (délégations), ce filtre de date construit de vrais objets `Date`, avec des heures explicites en UTC : `T00:00:00.000Z` pour le début de journée, `T23:59:59.999Z` pour la fin — nécessaire ici, car `createdAt` est un vrai timestamp Prisma (`DateTime`), pas une simple chaîne `AAAA-MM-JJ` comme les dates de délégation ; comparer des `Date` complètes exige des bornes explicites incluant l'heure pour que la borne de fin (`dateFin`) couvre bien toute la journée demandée, jusqu'à sa dernière milliseconde, plutôt que de s'arrêter à minuit pile.

`take: 200` plafonne la réponse, comme pour les délégations et les approbations (Volumes 11e et 11f) — sans pagination au-delà.

```ts
const versDTO = (a: AuditAvecRelation): AuditLogDTO => ({
  id: a.id,
  utilisateur: { id: a.utilisateur?.id ?? null, nom: a.utilisateurNom },
  module: a.module as Module,
  typeEntite: a.typeEntite,
  entiteId: a.entiteId,
  action: a.action as ActionAudit,
  avant: (a.avant as Record<string, unknown> | null) ?? null,
  apres: (a.apres as Record<string, unknown> | null) ?? null,
  date: a.createdAt.toISOString(),
});
```

Un détail révélateur, déjà annoncé par un commentaire du schéma Prisma (`onDelete: SetNull`, Volume 11f pour un exemple similaire sur `DemandeApprobation.approuvePar`) : `utilisateur.id` peut valoir `null` alors que `utilisateur.nom` (en réalité `utilisateurNom`, un champ figé au moment de la création de l'entrée, pas une relation) ne l'est jamais. Si le compte auteur d'une action passée est supprimé plus tard (une action elle-même critique et journalisée, Volume 11f), la relation `AuditLog.utilisateur` devient `null` — mais **le nom reste lisible**, parce qu'il a été copié tel quel dans `utilisateurNom` au moment de l'écriture, indépendamment de l'existence continue du compte. Le journal reste ainsi utile et lisible même après suppression de son auteur — cohérent avec l'esprit d'un historique immuable : l'histoire ne doit pas devenir illisible simplement parce qu'un compte a depuis disparu.

## 5.8 `AuditPage` — filtres et diff dépliable

```tsx
const parametres = useMemo(() => {
  const p = new URLSearchParams();
  if (utilisateurId) p.set("utilisateurId", utilisateurId);
  if (module) p.set("module", module);
  if (dateDebut) p.set("dateDebut", dateDebut);
  if (dateFin) p.set("dateFin", dateFin);
  return p.toString();
}, [utilisateurId, module, dateDebut, dateFin]);

const { data, isLoading } = useQuery({
  queryKey: ["audit", parametres],
  queryFn: () => api<{ entrees: AuditLogDTO[] }>(`/api/audit${parametres ? `?${parametres}` : ""}`),
});
```

Les quatre filtres (utilisateur, module, dates) pilotent directement la clé de la requête TanStack Query (`["audit", parametres]`) — chaque changement de filtre déclenche une nouvelle requête réseau avec les nouveaux paramètres dans l'URL, plutôt qu'un filtrage côté client sur une liste déjà chargée. Le sélecteur d'utilisateur réutilise la liste des comptes obtenue via `GET /api/equipe` (Volume 11d), en s'appuyant sur le fait que l'utilisateur consultant cette page a nécessairement une lecture sur `EQUIPE` (§5.7) donc l'accès à cette même liste.

```tsx
function champsPertinents(entree: AuditLogDTO): string[] {
  const source = entree.avant ?? entree.apres ?? {};
  const cles = Object.keys(source).filter((k) => !CHAMPS_MASQUES.has(k));
  if (entree.action === "MODIFICATION" && entree.avant && entree.apres) {
    return cles.filter((k) => JSON.stringify(entree.avant![k]) !== JSON.stringify(entree.apres![k]));
  }
  return cles;
}
```

C'est ici, côté client, que le diff affiché est calculé — le serveur transmet les instantanés complets `avant`/`apres` (déjà expurgés des champs sensibles côté extension, §5.5), et c'est le composant qui détermine quels champs afficher : pour une `SUPPRESSION`, tous les champs de l'instantané supprimé (il n'y a rien à comparer) ; pour une `MODIFICATION`, seulement les champs dont la valeur a réellement changé (comparaison par `JSON.stringify`, une façon simple de comparer deux valeurs quelconques — nombres, chaînes, booléens, `null` — sans écrire une fonction de comparaison dédiée à chaque type). `CHAMPS_MASQUES` (`updatedAt`, `createdAt`, `id`) retire trois champs techniques qui changeraient presque toujours (`updatedAt`) ou n'apportent aucune valeur de lecture (`id`, déjà affiché séparément) — un filtrage cosmétique, distinct de `CLE_SENSIBLE` côté serveur (§5.5) qui, lui, retire des champs pour des raisons de sécurité et n'est jamais contournable depuis le client puisque ces champs ne sont tout simplement jamais envoyés.

Chaque ligne du tableau (ou chaque carte, en vue mobile) est cliquable et se déplie pour révéler ce diff, mémorisé dans un état local `depliees: Set<string>` (les identifiants d'entrées actuellement dépliées) — un simple bascule (`basculer`) ajoute ou retire l'identifiant de l'entrée de cet ensemble. Rien de cet état n'est persistant ni partagé : fermer la page referme tous les diffs ouverts.

## 5.9 Exemple chiffré bout en bout — et une interaction avec le workflow d'approbation

Reprenons exactement le scénario chiffré du Volume 11f, §5.8 : Jeanne (Admin secondaire) demande de faire passer la commission de la Qualité « Maman » de 1 650 à 1 800 Fc ; Paul (Admin Principal) approuve.

Au moment où Paul clique « Approuver » (`POST /api/approbations/<id>/approuver`), l'exécuteur `MODIFIER_TYPE_CLIENT` (Volume 11f, §5.3) appelle `prisma.typeClient.update(...)` — et cet appel passe par le **client étendu** (`actionsCritiques.ts` importe `prisma` depuis `lib/prisma.ts`, comme tout le reste du code serveur), donc **par l'extension d'audit**. Une entrée `AuditLog` est donc bien créée pour cette modification :

```
{
  utilisateurId: <id de Paul>,
  utilisateurNom: "Paul ...",
  module: "PARAMETRES",
  typeEntite: "TypeClient",
  entiteId: <id de la Qualité « Maman »>,
  action: "MODIFICATION",
  avant: { nom: "Maman", prixParBac: ..., commissionParBac: 1650 },
  apres: { nom: "Maman", prixParBac: ..., commissionParBac: 1800 },
  createdAt: <horodatage de l'approbation>,
}
```

**Le point à remarquer** : l'entrée du journal attribue cette modification à **Paul**, pas à Jeanne — parce que `contexteRequete.getStore()` (§5.2) reflète l'auteur de la requête HTTP en cours d'exécution au moment où `prisma.typeClient.update` s'exécute réellement, et cette requête-là (`POST /api/approbations/.../approuver`) est authentifiée en tant que Paul, quel que soit le compte à l'origine de la demande initiale. Ce n'est **pas une erreur ni un écart** — c'est la conséquence logique et cohérente du fonctionnement des deux mécanismes combinés (Volume 11f + ce chapitre) : le journal d'audit trace fidèlement *qui a réellement exécuté l'écriture en base*, ce qui, pour une action différée approuvée, est toujours l'Admin Principal qui a validé, jamais l'Admin secondaire qui l'a initialement proposée. L'identité de la personne à l'origine de la demande (Jeanne) reste néanmoins retrouvable, mais **ailleurs** : dans la `DemandeApprobation` correspondante (`demandeParId`, `resume`), toujours consultable depuis l'historique de l'écran Approbations (Volume 11f, §5.7) — pas depuis le Journal d'audit lui-même. Un lecteur qui voudrait reconstituer l'origine complète d'un changement de prix doit donc, dans ce cas précis, croiser les deux écrans plutôt que de se fier au seul Journal d'audit. **Non confirmé dans le code actuel** qu'un renvoi croisé entre les deux écrans existe dans l'interface (aucun lien direct trouvé entre une entrée du Journal d'audit et la `DemandeApprobation` qui l'a éventuellement déclenchée).

À l'inverse, si Paul avait directement modifié la Qualité lui-même (sans passer par une demande, puisqu'il n'a pas besoin d'approbation), l'entrée du journal l'aurait de toute façon attribuée à lui — le comportement du journal est donc **identique** dans les deux cas (action directe ou action différée puis approuvée) du point de vue de qui apparaît comme auteur : toujours celui dont la requête a réellement déclenché l'écriture Prisma.

## 5.10 Cas limites

| Situation | Comportement |
|---|---|
| Écriture Prisma hors de toute requête authentifiée (script, tâche planifiée) | Jamais journalisée — `contexteRequete.getStore()` renvoie `undefined`, `doitAuditer` est faux (§5.6). |
| Modèle absent de `MODELE_MODULE` (ex. `Notification`) | Jamais journalisé, quel que soit le contexte. |
| L'écriture `update`/`delete` d'origine échoue | Rien n'est journalisé — l'erreur remonte avant tout appel à `journaliser` (§5.6). |
| L'écriture du journal lui-même échoue (`base.auditLog.create` lève une erreur) | L'action métier réussit quand même ; l'échec est seulement journalisé via `logger.error`, jamais remonté à l'utilisateur (§5.6). |
| Action critique différée, approuvée plus tard | L'entrée d'audit attribue l'écriture à l'**approbateur**, pas au demandeur initial (§5.9). |
| Suppression du compte auteur d'une entrée passée | `utilisateur.id` devient `null` dans le DTO, mais `utilisateurNom` reste lisible (figé à la création, §5.7). |
| Filtre `module` avec une valeur hors de l'énumération `MODULES` | Silencieusement ignoré comme filtre (§5.7), pas d'erreur `400`. |
| Champ contenant `hash`, `password`, `secret` ou `token` dans son nom | Jamais copié dans `avant`/`apres`, quel que soit le modèle (§5.5). |
| Champ dont la valeur est un objet (relation chargée) | Jamais copié dans l'instantané — seuls les champs scalaires de l'entité elle-même sont conservés (§5.5). |

## 5.11 Croisement avec la spécification

Aucun écart trouvé. La spec (section 3.17, citée au §5.1) et ce mécanisme correspondent point par point : immuabilité (aucune route d'écriture directe sur `AuditLog`, §5.7), portée (modifications et suppressions, pas les créations — justifié par `créePar`/`enregistrePar`, exactement la formulation de la spec), contenu (qui/quoi/quand/avant/après), filtres (utilisateur, module, période), et le fait que les actions des Admins eux-mêmes sont également journalisées (aucune exemption dans le code pour `estAdminPrincipal`). La question ouverte de la spec sur l'inclusion ou non des tentatives refusées (403) est explicitement résolue en faveur de « non », et le code s'y conforme strictement (§5.6, la vérification de permission se fait avant tout appel Prisma, donc bien avant que l'extension puisse intervenir).

La note de la spec sur la Caisse (section 3.1, point 6 : *« les modifications et suppressions sur `DepenseCaisse` et `TauxDuJour` sont tracées automatiquement par l'extension Prisma déjà en place — rien de spécifique à ajouter »*) est également confirmée par la lecture du code : les deux modèles figurent bien dans `MODELE_MODULE` (§5.4), sans aucune logique spécifique nécessaire côté route Caisse (Volume 11j, à venir).

## 5.12 Résumé

Le journal d'audit repose sur une seule extension Prisma, branchée une fois pour toutes dans `lib/prisma.ts`, qui intercepte silencieusement chaque `update` et `delete` de l'application. L'identité de l'auteur voyage sans code de plomberie explicite grâce à `AsyncLocalStorage` (`contexteRequete`), posé par `requireAuth` (Volume 11b) au tout début de chaque requête authentifiée. Deux garanties de sécurité sont construites dans le mécanisme lui-même, pas laissées à la discipline de chaque route : les champs sensibles ne sont jamais capturés, et un échec du journal ne peut jamais faire échouer l'action métier qu'il est censé tracer. Une conséquence notable et bien vérifiée : pour une action critique différée (Volume 11f), c'est l'Admin Principal qui approuve — pas l'Admin secondaire qui l'a demandée — qui apparaît comme auteur dans le journal, l'origine réelle de la demande restant traçable séparément via l'écran Approbations. Aucun écart avec la spécification.

---

**Suite →** Volume 11h — Commandes (`apps/api/src/routes/commandes.ts`, `apps/web/src/pages/Commandes.tsx`), qui réutilisera directement `calculerCommande` et `avanceAvantCommande` déjà expliqués au Volume 11a.
