# Volume 18a — Fichiers back-end restants : `parametres.ts`, `interventionsAdmin.ts`, `restaurer-sauvegarde.ts`

> Premier sous-chapitre du Volume 18 (« Explication exhaustive des fichiers sources restants »). Il couvre trois petits fichiers Niveau 2 déjà **croisés en passant** dans des chapitres précédents (Volumes 11z-4, 11z-5, 11c) sans jamais avoir été eux-mêmes ouverts et expliqués comme fichiers à part entière. C'est chose faite ici, conformément à la règle de couverture à 100 % du mandat.

## 1. Pourquoi ces trois fichiers étaient encore « À analyser »

Aucun des trois n'est le sujet principal d'un module fonctionnel : ce sont des utilitaires transversaux ou des scripts d'exploitation, appelés depuis des routes déjà expliquées ailleurs. La matrice de couverture les avait donc laissés de côté le temps que les chapitres fonctionnels avancent. L'audit du 2026-08-08 (voir `ETAT_DE_PROGRESSION.md` §4) a confirmé qu'ils restaient bien réellement non couverts — ce sous-chapitre les referme.

## 2. `apps/api/src/lib/parametres.ts` (23 lignes) — le magasin clé/valeur de la boutique

### 2.1 Intuition

Beaucoup de réglages de l'application n'ont pas besoin d'une table Prisma dédiée : le nom de la boutique, son adresse, sa langue par défaut, ses réseaux sociaux... Plutôt que de créer un modèle avec une colonne par réglage (et une migration à chaque nouveau réglage), le projet utilise un **magasin générique clé/valeur** : une seule table `ParametreBoutique` avec deux colonnes, `cle` et `valeur`, où chaque ligne représente un réglage. `lib/parametres.ts` est la petite couche d'accès à ce magasin — deux fonctions, `lireParametre` et `ecrireParametre`.

### 2.2 Le code

```ts
export async function lireParametre(cle: string, defaut = ""): Promise<string> {
  const parametre = await prisma.parametreBoutique.findUnique({ where: { cle } });
  return parametre?.valeur ?? defaut;
}

export async function ecrireParametre(cle: string, valeur: string): Promise<void> {
  const existant = await prisma.parametreBoutique.findUnique({ where: { cle } });
  if (existant) {
    await prisma.parametreBoutique.update({ where: { cle }, data: { valeur } });
  } else {
    await prisma.parametreBoutique.create({ data: { cle, valeur } });
  }
}
```

`lireParametre` est une simple lecture avec valeur de repli : si la clé n'existe pas encore en base (par exemple juste après le premier lancement, avant toute écriture), on renvoie `defaut` plutôt que `null` ou une exception — chaque appelant garde la responsabilité de choisir une valeur de repli pertinente pour son propre réglage.

### 2.3 Le détail qui compte : pourquoi pas un `upsert` ?

Prisma propose une méthode `upsert` qui ferait exactement ce que fait `ecrireParametre` en une seule requête, au lieu de deux (`findUnique` puis `update`/`create`). Le choix délibéré d'écrire les deux branches à la main est documenté dans le commentaire du fichier :

> L'extension d'audit centrale (`lib/audit.ts`, Volume 11g) n'intercepte que les opérations `update` et `delete` — pas `upsert`. Un `upsert` silencieux ferait disparaître toute trace de modification au Journal d'audit dès la deuxième écriture sur une même clé (la première serait une création, invisible aussi, mais la deuxième — la vraie modification d'un réglage existant — passerait complètement sous le radar de la traçabilité).

C'est une conséquence directe et concrète de ce qui avait été expliqué en abstrait au Volume 11g : `extensionAudit` ne journalise que certains verbes Prisma précis, et tout code qui contourne ces verbes (ou en utilise un non couvert) échappe silencieusement à l'audit. `parametres.ts` est le premier endroit du projet où ce piège est explicitement documenté et évité en connaissance de cause.

### 2.4 Qui appelle ces deux fonctions

Trois appelants, tous déjà vus dans des chapitres antérieurs sans que `parametres.ts` lui-même n'ait été nommé :

| Appelant | Chapitre d'origine | Usage |
|---|---|---|
| `routes/apropos.ts` | Volume 11z-5 | Lecture/écriture des 6 champs de la page « À propos » publique (`boutique_nom`, `boutique_adresse`, `boutique_contact`, `boutique_presentation`, `boutique_horaires`, `boutique_reseaux_sociaux`) |
| `routes/parametres.ts` | Volume 11z-4 | Lecture/écriture d'un sous-ensemble qui recoupe partiellement À propos (`boutique_nom`, `boutique_adresse`, `boutique_contact`) + `langue_defaut` |
| `routes/auth.ts` | Volume 11c | Lecture seule de `langue_defaut`, exposée par la route publique `GET /langue-defaut` (utilisée par l'écran de connexion avant authentification) |

Les clés elles-mêmes (`CLE_BOUTIQUE_NOM`, `CLE_LANGUE_DEFAUT`, etc.) sont des constantes exportées par `packages/shared/src/index.ts` (lignes 461-470 et 1527 pour `LANGUE_DEFAUT_PAR_DEFAUT = "FR"`) — un seul endroit définit le nom exact de chaque clé, ce qui évite qu'une route écrive sous `"boutique_nom"` et qu'une autre lise sous `"boutiqueNom"` par erreur de frappe.

**Observation, pas un écart** : `boutique_nom`, `boutique_adresse` et `boutique_contact` sont lus et écrits à la fois par `apropos.ts` et par `parametres.ts` — les deux écrans (« À propos » et « Paramètres ») partagent donc les trois mêmes réglages, modifiables depuis l'un ou l'autre. C'est cohérent avec ce qui avait déjà été signalé au Volume 11z-5 (les deux pages exposent partiellement les mêmes champs), simplement confirmé ici au niveau de la couche de stockage.

## 3. `apps/api/src/services/interventionsAdmin.ts` (63 lignes) — le garde-fou de transparence de l'Admin Principal

### 3.1 Intuition

La spec (section 2) accorde à l'Admin Principal un pouvoir total : écriture sur absolument tous les modules, y compris les modules métier qui ne sont normalement pas les siens (Commandes, Caisse, Stocks, Production, Fournisseurs, Travailleurs). Un tel pouvoir, laissé complètement silencieux, serait dangereux — n'importe qui d'autre pourrait ignorer qu'une donnée métier a été modifiée par quelqu'un en dehors de la chaîne hiérarchique habituelle. La règle retenue : **le pouvoir reste total, mais jamais discret**. Chaque fois que l'Admin Principal écrit hors de son périmètre d'origine, le rôle propriétaire du module concerné et le DG en sont avertis en temps réel.

### 3.2 Le périmètre d'origine

```ts
const PERIMETRE_ADMIN: Module[] = ["PARAMETRES", "EQUIPE", "TRAVAILLEURS"];

export const estHorsPerimetreAdmin = (module: Module) => !PERIMETRE_ADMIN.includes(module);
```

Le commentaire du fichier précise pourquoi ce tableau contient exactement ces trois modules et pas d'autres :

- **PARAMETRES** et **ÉQUIPE** : les deux modules d'origine de l'Administrateur, avant même l'extension de ses pouvoirs.
- **TRAVAILLEURS** : rejoint le périmètre avec le retrait du rôle « Chargé du personnel » (documenté à la spec 3.18) — écrire sur les fiches Travailleurs est désormais l'écriture *normale* d'un Admin secondaire, pas une intervention hors de son rôle.

Écrire sur n'importe quel autre module (Commandes, Caisse, Stocks, Production, Commissions, Fournisseurs...) est donc considéré « hors périmètre » et déclenche potentiellement une notification.

**Activation et État système**, mentionnés par le commentaire comme faisant également partie du périmètre d'origine, ne figurent pourtant pas littéralement dans le tableau `PERIMETRE_ADMIN` : ils sont couverts indirectement, car ils passent par le module `EQUIPE` (Activation, gérée via les routes équipe) et par des routes qui n'appellent jamais `requirePermission` avec un module distinct pour l'État système lui-même. **Non confirmé dans le code actuel** que cette couverture indirecte soit intentionnellement documentée ailleurs qu'ici — elle découle simplement de l'absence d'un module `Module` dédié à l'État système dans la matrice de permissions (le module `EQUIPE` ou l'absence de garde couvre ces routes). Ce n'est pas un écart spec/code : le comportement observable (aucune notification parasite sur ces routes) correspond à ce que la spec attend.

### 3.3 La notification elle-même

```ts
export async function notifierInterventionAdmin(params: {
  module: Module; auteurId: string; auteurNom: string; methode: string; chemin: string;
}): Promise<void> {
  const rolesProprietaires = await prisma.rolePermission.findMany({
    where: { module, niveauAcces: "ECRITURE", role: { nom: { not: ROLE_ADMINISTRATEUR } } },
    select: { roleId: true },
  });

  const destinataires = await prisma.utilisateur.findMany({
    where: {
      actif: true,
      id: { not: auteurId },
      OR: [
        { roleId: { in: rolesProprietaires.map((r) => r.roleId) } },
        { role: { nom: ROLE_DIRECTEUR_GENERAL } },
      ],
    },
    select: { id: true },
  });
  if (destinataires.length === 0) return;

  busEvenements.emettreEvenement({
    type: "INTERVENTION_ADMIN",
    module,
    emetteurId: auteurId,
    priorite: "HAUTE",
    destinataireIdsDirects: destinataires.map((d) => d.id),
    message: `⚠ Intervention de l'Administrateur principal ${auteurNom} sur ${MODULE_LABELS[module]} — écriture hors de son périmètre habituel (détail au Journal d'audit)`,
    donnees: { module, methode, chemin, auteurId },
  });
}
```

Le point le plus intéressant : **le rôle propriétaire du module n'est jamais codé en dur**. La fonction interroge `RolePermission` pour trouver, dynamiquement, quel(s) rôle(s) détiennent l'écriture sur le module concerné (en excluant explicitement le rôle `Administrateur` lui-même, pour ne pas se notifier soi-même). Le commentaire du fichier précise l'intention : « ajouter un rôle reste sans effet sur ce code ». C'est cohérent avec la promesse générale de la spec (section 2, dernier paragraphe) : « La liste des rôles est conçue pour être extensible (ajout d'un rôle et de ses permissions sans changement de code). » Si demain un nouveau rôle obtient l'écriture sur Stocks, il recevra automatiquement ces notifications sans qu'une seule ligne de `interventionsAdmin.ts` n'ait besoin d'être modifiée.

Le DG est ajouté systématiquement au groupe de destinataires (`OR` avec `role.nom === ROLE_DIRECTEUR_GENERAL`), conformément à la spec : « le rôle propriétaire de ce module... **et le DG** reçoivent une notification ». `destinataireIdsDirects` (et non un ciblage par rôle via `rolesDestinataires`, Volume 11z-4) est utilisé ici car la liste des destinataires est calculée dynamiquement à cet appel précis, pas dérivée d'une règle statique de la matrice de permissions comme le sont les autres notifications du projet.

### 3.4 Le point d'appel unique : `requirePermission`

`interventionsAdmin.ts` n'est appelé que depuis un seul endroit du projet, `middleware/auth.ts` (déjà lu en détail au Volume 11b, mais ce passage précis n'y avait pas été creusé) :

```ts
if (
  auteur?.estAdminPrincipal &&
  niveau === "ECRITURE" &&
  req.method !== "GET" &&
  estHorsPerimetreAdmin(module)
) {
  res.once("finish", () => {
    if (res.statusCode >= 400) return;
    notifierInterventionAdmin({ module, auteurId: auteur.id, auteurNom: auteur.nom,
      methode: req.method, chemin: req.originalUrl })
      .catch((e) => logger.error("Échec de notification d'intervention Admin", { erreur: e }));
  });
}
```

Quatre conditions doivent toutes être vraies pour qu'une notification parte :

1. **`estAdminPrincipal`** — seul l'Admin Principal peut déclencher cette notification ; l'Admin secondaire, dont l'écriture est de toute façon cantonnée à son propre périmètre (Paramètres/Équipe/Activation/État système/Travailleurs), ne peut jamais être « hors périmètre » au sens de ce garde-fou.
2. **`niveau === "ECRITURE"`** — une simple lecture n'est jamais une intervention.
3. **`req.method !== "GET"`** — filet de sécurité redondant avec le point précédent (une route protégée en `ECRITURE` ne devrait de toute façon jamais répondre à un `GET`), mais gardé par prudence défensive.
4. **`estHorsPerimetreAdmin(module)`** — le module écrit n'est pas Paramètres/Équipe/Travailleurs.

Le déclenchement se fait via **`res.once("finish", ...)`**, exactement le même motif que celui vu pour les alertes de dette au Volume 11h (`bornesDuJour`/`verifierAlertesDette`) : on attend que la réponse soit effectivement envoyée, et on vérifie `res.statusCode < 400`, pour ne notifier que sur une action **réellement aboutie** — une requête qui échoue en cours de route (erreur de validation, erreur métier) ne déclenche aucune fausse alerte. L'appel est `.catch()`-é avec `logger.error` (Volume 16) plutôt qu'attendu : un échec de cette notification (par exemple une panne temporaire de Socket.io) ne doit jamais faire échouer la requête HTTP elle-même, dont le traitement métier est déjà terminé et validé à ce stade.

### 3.5 Confrontation avec la spec

Correspondance verbatim avec la spec (section 2, paragraphe « Garde-fou ») :

> « quand l'Admin Principal **écrit** dans un module métier qui n'est pas Paramètres/Équipe/Activation/État système/Approbations, le **rôle propriétaire de ce module**... et le **DG** reçoivent une **notification temps réel** signalant l'intervention. Ce signal s'ajoute à la trace automatique au Journal d'audit (3.17)... Objectif : un pouvoir total reste possible, mais jamais discret. »

Chaque élément de cette phrase se retrouve dans le code : le périmètre exclu, le double destinataire (rôle propriétaire + DG), le canal temps réel (`busEvenements`), et la coexistence avec le Journal d'audit (qui journalise indépendamment, via `extensionAudit`, toute écriture Prisma quel qu'en soit l'auteur — les deux mécanismes sont redondants par construction, comme le veut la spec). **Aucun écart spec/code.**

## 4. `scripts/restaurer-sauvegarde.ts` (106 lignes) — la restauration, volontairement hors de l'application

### 4.1 Intuition

Le Volume 11z-4 avait détaillé les services de **sauvegarde** (`services/sauvegarde.ts`, `sauvegardeLocale.ts`, `planificateurSauvegarde.ts`) — comment un dump `pg_dump` est produit et stocké. Ce script est leur contrepartie exacte : il **restaure** un dump, c'est-à-dire qu'il remplace le contenu de la base cible par celui du fichier. C'est délibérément un script en ligne de commande, jamais une route HTTP ni un bouton de l'interface — le commentaire d'en-tête du fichier est explicite : « une restauration REMPLACE le contenu de la base cible, un clic malheureux sur un bouton web serait bien trop facile sur les données réelles de l'entreprise ».

### 4.2 Usage et garde-fou de confirmation

```
npx tsx scripts/restaurer-sauvegarde.ts <fichier.dump> --confirmer
```

Sans l'option `--confirmer`, le script affiche ce qu'il *ferait* (fichier, hôte, base cible) et s'arrête, sans toucher à rien :

```ts
if (!confirme) {
  console.log("\nAucune action effectuée (relancer avec --confirmer pour restaurer réellement).");
  return;
}
```

C'est un deuxième filet de sécurité, en plus du fait même que ce soit un script manuel : même quelqu'un qui lance la commande sans lire la documentation reçoit d'abord un aperçu inoffensif de ce qui va se passer, et doit répéter son intention explicitement avec `--confirmer` pour que quoi que ce soit d'irréversible se produise.

### 4.3 Le déroulement

1. Lecture de `DATABASE_URL` depuis l'environnement, parsée comme une URL standard (`new URL(url)`) pour en extraire l'hôte, le port, le nom de base, l'utilisateur et le mot de passe — la même variable d'environnement que celle utilisée par Prisma lui-même et par `services/sauvegarde.ts`, garantissant que la restauration cible exactement la même base que celle sur laquelle l'application tourne.
2. Vérification que le fichier passé en argument existe (`existsSync`).
3. Construction des arguments `pg_restore` : `--host`, `--port`, `--dbname`, puis surtout `--clean --if-exists --no-owner --no-privileges` avant le chemin du fichier.
4. Exécution via `execFile` (jamais `exec` avec une chaîne de commande interpolée — voir §4.4 ci-dessous sur ce choix), avec le mot de passe transmis par la variable d'environnement `PGPASSWORD` du sous-processus, jamais en argument de ligne de commande.

### 4.4 Deux détails de sécurité qui font écho aux chapitres précédents

**`execFile` plutôt qu'`exec`** : `execFile` prend le nom du programme et un tableau d'arguments séparés, sans jamais passer par un interpréteur shell — aucune valeur (nom de fichier, nom d'hôte tiré de `DATABASE_URL`) ne peut donc être interprétée comme une commande shell supplémentaire. C'est la même précaution de fond que celle qui motive, ailleurs dans le projet, de ne jamais construire de requête SQL par concaténation de chaînes (Prisma s'en charge nativement).

**Le mot de passe jamais en argument de commande** : exactement le même choix que celui déjà documenté au Volume 11z-4 pour `services/sauvegarde.ts` (production du dump) — les arguments d'un process sont visibles par n'importe qui ayant accès à la liste des processus du serveur (`ps aux` par exemple), alors que les variables d'environnement d'un sous-processus ne le sont pas de la même façon. `PGPASSWORD` est donc injecté via l'objet `env` passé à `execFileAsync`, jamais concaténé dans `restoreArgs`.

### 4.5 Gestion des erreurs de fin de script

```ts
catch (e) {
  const err = e as NodeJS.ErrnoException & { stderr?: string };
  if (err.code === "ENOENT") {
    console.error(`L'outil pg_restore est introuvable (${PG_RESTORE})...`);
  } else {
    console.error("pg_restore a signalé des erreurs/avertissements :");
    console.error(err.stderr ?? err.message);
  }
  process.exitCode = 1;
}
```

Un commentaire du code documente une subtilité opérationnelle réelle de `pg_restore` : l'outil renvoie souvent un code de sortie non nul même pour de simples avertissements bénins (par exemple un objet déjà absent, précisément le cas que `--if-exists` est censé neutraliser silencieusement). Le script choisit donc d'afficher la sortie complète plutôt que de la masquer derrière un message générique, pour que l'opérateur humain puisse juger lui-même si l'avertissement est anodin ou signale un vrai problème — cohérent avec le fait que ce script s'adresse à un administrateur système, pas à un utilisateur final de l'application.

### 4.6 Confrontation avec la spec

La spec (section 3.15, État système) mentionne les sauvegardes automatiques et le téléchargement local, mais **ne détaille pas** la procédure de restauration elle-même — cohérent avec le choix du projet de la garder entièrement hors de l'application (« procédure d'infrastructure », selon la même logique que la réinitialisation de base, spec section 2, qui est explicitement exclue de la liste des tâches critiques gérées par l'application). **Aucun écart spec/code** : l'absence de détail dans la spec sur ce point correspond exactement à l'absence de toute route ou UI dans le code pour cette opération — les deux s'accordent sur le fait que la restauration est volontairement laissée hors du périmètre applicatif.

## 5. Résumé du sous-chapitre

| Fichier | Rôle en une phrase | Écart spec/code |
|---|---|---|
| `lib/parametres.ts` | Magasin clé/valeur générique pour les réglages boutique, avec `create`/`update` explicites plutôt qu'`upsert` pour rester visible au Journal d'audit | Aucun |
| `services/interventionsAdmin.ts` | Garde-fou de transparence : notifie le rôle propriétaire d'un module + le DG chaque fois que l'Admin Principal écrit hors de son périmètre d'origine, déclenché depuis `requirePermission` | Aucun |
| `scripts/restaurer-sauvegarde.ts` | Restauration manuelle d'un dump `pg_dump`, volontairement un script CLI (jamais une route web), avec confirmation explicite requise | Aucun |

Les trois fichiers de ce sous-chapitre confirment un motif déjà observé à plusieurs reprises dans ce livre : plusieurs mécanismes de sécurité et de traçabilité du projet (audit, notification d'intervention, confirmation explicite avant une action destructrice) reposent sur de petits fichiers utilitaires découverts et documentés une seule fois, puis réutilisés silencieusement partout ailleurs sans jamais être renommés dans les chapitres qui les emploient.

**Prochain sous-chapitre** : Volume 18b — fichiers `lib/` restants du frontend (`theme.tsx`, `csv.ts`, `utils.ts`, `components/FeedbackProvider.tsx`).
