# Volume 11b — Authentification et permissions bout en bout

**Niveau de risque : 1 — Critique.** Traitement exhaustif.

## Fiche d'identité des fichiers couverts

| Fichier | Lignes | Rôle |
|---|---:|---|
| `apps/api/src/lib/jwt.ts` | 25 | Signature et vérification des jetons JWT |
| `apps/api/src/middleware/auth.ts` | 154 | `requireAuth`, `requirePermission`, `chargerUtilisateur` — le cœur de l'authentification et des permissions côté serveur |
| `apps/web/src/lib/api.ts` | 76 | Client HTTP frontend : ajoute le jeton à chaque requête, traduit les erreurs, détecte la session remplacée |
| `apps/web/src/lib/auth.tsx` | 173 | Contexte React d'authentification : `AuthProvider`, `useAuth`, `peutLire`/`peutEcrire` |

Ces quatre fichiers forment un seul mécanisme cohérent, du clic sur « Se connecter » jusqu'à l'affichage ou le masquage d'un bouton dans l'interface. Ce chapitre les traite ensemble plutôt qu'un par un, car aucun n'a de sens isolé des trois autres.

- **Qui les appelle** : `requireAuth`/`requirePermission` sont posés sur quasiment toutes les routes de `apps/api/src/routes/*.ts` (voir Volume 11c et suivants) ; `useAuth` est utilisé dans la quasi-totalité des composants de `apps/web/src/pages/` et `apps/web/src/components/` ; `api()` est le seul point de passage de toute communication HTTP du frontend vers le serveur.
- **Ce qu'ils appellent** : `lib/jwt.ts` (signature/vérification), Prisma (`prisma.utilisateur`, `prisma.delegationRole`), `lib/contexteRequete.ts` (pour l'audit), `services/interventionsAdmin.ts` (garde-fou de transparence de l'Admin Principal), et côté frontend, `fetch` (API native du navigateur) et `localStorage`.
- **Données modifiées** : `localStorage` (clé `lomoto_token`, côté navigateur) ; aucune écriture en base directe dans ces fichiers — ils lisent et décident, ils n'écrivent pas de données métier.

## 3.1 Vue d'ensemble intuitive

Avant le détail technique, voici l'histoire complète en une phrase : un utilisateur saisit son mot de passe une fois, reçoit en échange un « badge » signé numériquement (le jeton JWT) qu'il présente à chaque requête suivante ; le serveur vérifie ce badge, reconstruit à chaque fois la liste exacte de ce que cet utilisateur a le droit de faire (son rôle, plus d'éventuels droits temporaires), et le frontend adapte l'interface en conséquence — sans jamais faire confiance à ce que le navigateur affiche, puisque c'est toujours le serveur qui refuse réellement une action non autorisée.

## 3.2 `lib/jwt.ts` — signer et vérifier le badge

### Code complet

```ts
// apps/api/src/lib/jwt.ts
import jwt from "jsonwebtoken";

if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET manquant en production : arrêt du serveur (voir apps/api/src/lib/jwt.ts).");
}
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-lomoto-change-me-in-production";
const EXPIRATION = "12h";

export interface JwtPayload {
  sub: string; // id utilisateur
  roleId: string;
  sid: string; // identifiant de session (section 3.7)
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: EXPIRATION });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}
```

### Explication technique

Un **JWT (JSON Web Token)** est une chaîne de caractères composée de trois parties séparées par des points, encodant un en-tête, un contenu (le « payload », ici `JwtPayload`) et une signature cryptographique. La signature garantit que si un seul caractère du contenu est modifié après émission, la vérification échoue — un jeton ne peut donc pas être falsifié sans connaître le secret utilisé pour le signer (`JWT_SECRET`).

- **`sub`** (*subject*, convention standard JWT) — l'identifiant de l'utilisateur.
- **`roleId`** — l'identifiant de son rôle au moment de la connexion (voir §3.9, cas limite : que se passe-t-il si le rôle change après coup).
- **`sid`** — l'identifiant de la session courante, mécanisme de **session unique** détaillé au §3.4.

**Ligne critique déjà corrigée dans ce dépôt** (voir la ligne 6-8) : si `JWT_SECRET` est absent et que `NODE_ENV` vaut `"production"`, le serveur **refuse de démarrer** plutôt que de signer silencieusement avec la valeur de secours codée en dur (visible dans ce fichier, donc publique). En développement, la valeur de secours reste utilisée sans blocage — c'est un compromis assumé entre commodité de développement et sécurité de production. Ce correctif fait partie de l'historique de ce dépôt (voir Volume 24 pour le contexte de l'audit de sécurité qui l'a motivé).

`EXPIRATION = "12h"` — chaque jeton cesse d'être valide 12 heures après son émission, quelle que soit l'activité de l'utilisateur entre-temps (ce n'est pas une expiration glissante).

**Cas limite** : que se passe-t-il si `roleId` a changé depuis l'émission du jeton (l'Admin a changé le rôle de l'utilisateur pendant qu'il était connecté) ? Le jeton contient l'ancien `roleId`, mais **`requireAuth` ne l'utilise jamais directement** pour construire les permissions — il ne sert qu'à identifier `sub` (l'utilisateur) et `sid` (la session). Les permissions réelles sont toujours recalculées à chaque requête par `chargerUtilisateur` à partir de la base de données actuelle (§3.3), donc un changement de rôle est pris en compte **immédiatement**, dès la requête suivante, sans que l'utilisateur ait besoin de se reconnecter. `roleId` dans le jeton est donc, à la lecture du code de `requireAuth`, une information **non utilisée** pour l'autorisation elle-même — **non confirmé dans le code actuel** qu'elle serve à autre chose qu'un usage de diagnostic éventuel ailleurs dans le projet.

## 3.3 `middleware/auth.ts` — `chargerUtilisateur` : reconstruire les droits à chaque requête

C'est la fonction la plus dense du fichier, et la seule qui touche à la base de données dans ce chapitre.

### Signature

```ts
export async function chargerUtilisateur(id: string): Promise<UtilisateurDTO | null>
```

Un seul paramètre (`id`, l'identifiant de l'utilisateur), une promesse de `UtilisateurDTO` ou `null` si le compte n'existe pas ou plus.

### Déroulement étape par étape

1. **Chargement de l'utilisateur et de son rôle** (`prisma.utilisateur.findUnique` avec `include: { role: { include: { permissions: true } } }`) — une seule requête SQL (grâce à l'`include` de Prisma) ramène l'utilisateur, son rôle, et toutes les permissions de ce rôle.
2. **`if (!u || !u.actif) return null;`** — deux conditions fusionnées : le compte n'existe pas (`!u`), ou il existe mais a été désactivé (`!u.actif`). Dans les deux cas, le résultat est identique : refus. C'est un choix de conception délibéré — un compte désactivé n'a **aucun accès**, immédiatement (pas seulement à sa prochaine tentative de connexion), même s'il possède encore un jeton valide non expiré.
3. **Résolution de la langue préférée** — vérifie que `u.languePreferee` (une chaîne libre en base) correspond bien à une des langues supportées (`LANGUES`) avant de la typer comme `Langue` ; sinon, `null` (l'application se repliera sur la langue par défaut de la boutique — voir Volume 17).
4. **Construction de la carte des niveaux** (`const niveaux = new Map<Module, NiveauAcces>()`) — la structure de données choisie ici, une `Map` indexée par `Module`, permet de fusionner plusieurs sources de droits (rôle de base, statut Admin Principal, délégations) en ne gardant, pour chaque module, que le niveau le plus élevé rencontré. Trois passes successives alimentent cette carte :
   - **Passe 1 — le rôle de base** : chaque permission du rôle (`u.role.permissions`) est copiée telle quelle dans la carte.
   - **Passe 2 — le statut Admin Principal** (`if (u.estAdminPrincipal) { for (const module of MODULES) niveaux.set(module, "ECRITURE"); }`) : si l'utilisateur est l'Admin Principal, **chaque module de l'application**, sans exception, est mis à `"ECRITURE"` — écrasant ce que la passe 1 avait pu poser. C'est le mécanisme concret qui réalise la règle de la spécification (section 2) : *« L'Admin Principal est un super utilisateur : il a l'écriture sur absolument tous les modules »*. Notez que ceci **écrase** systématiquement, sans jamais dégrader un niveau existant par erreur (il n'y a qu'un seul niveau possible après cette passe : `ECRITURE`, le plus élevé).
   - **Passe 3 — les délégations temporaires actives** : recherche en base (`prisma.delegationRole.findMany`) des délégations dont la période (`dateDebut`/`dateFin`) couvre la date du jour, puis pour chaque module délégué, ne relève le niveau à `"ECRITURE"` que **s'il est actuellement inférieur** (`RANG_NIVEAU["ECRITURE"] > RANG_NIVEAU[actuel]`) — une délégation ne peut jamais *retirer* un droit déjà acquis autrement, elle ne peut qu'en ajouter.
5. **Construction du DTO final** — assemble `id`, `nom`, `email`, `estAdminPrincipal`, l'objet `role` (avec la carte `niveaux` reconvertie en tableau de `PermissionDTO`), et `languePreferee`.

### Pourquoi l'ordre des trois passes compte

L'ordre (rôle → Admin Principal → délégations) n'est pas arbitraire, mais son importance réelle vient de la **logique de la passe 3**, pas de l'ordre des passes 1 et 2 entre elles (celles-ci pourraient être inversées sans changer le résultat, puisque la passe 2 écrase systématiquement à `ECRITURE`, la valeur maximale). La passe 3, elle, doit impérativement s'exécuter **après** les deux autres : elle compare le niveau *actuel* dans la carte pour décider si elle doit le relever, et cette comparaison n'a de sens que si la carte reflète déjà l'état complet issu du rôle et du statut Admin Principal.

### Ce qui se passerait avec une erreur ici

- **Si la passe 2 était placée avant la passe 1** (rôle après Admin Principal) : le résultat serait strictement identique, car la passe 1 ne fait que poser des valeurs pour les modules listés dans `u.role.permissions`, sans jamais comparer à une valeur existante — elle écraserait silencieusement le `"ECRITURE"` de la passe 2 pour tout module présent dans son propre rôle. **C'est un piège réel** : dans l'ordre actuel du code (2 après 1), ce risque n'existe pas ; il apparaîtrait si quelqu'un réorganisait le fichier sans comprendre cette dépendance.
- **Si la comparaison `RANG_NIVEAU["ECRITURE"] > RANG_NIVEAU[actuel]` de la passe 3 était retirée** : une délégation pourrait, dans le pire cas, ne rien changer (elle écrase toujours à `ECRITURE`, qui est de toute façon la seule valeur qu'une délégation confère) — dans ce cas précis, retirer la comparaison n'aurait donc **aucun effet visible**, car il n'existe qu'un seul niveau possible pour une délégation. La comparaison est une garde défensive plus qu'une nécessité stricte de ce cas d'usage actuel — mais elle protège contre toute évolution future qui introduirait des délégations à plusieurs niveaux.

## 3.4 `middleware/auth.ts` — `requireAuth` : la porte d'entrée de toute requête protégée

### Déroulement étape par étape

1. **Présence de l'en-tête** (`if (!header?.startsWith("Bearer "))`) — sans en-tête `Authorization` au format `Bearer <jeton>`, refus immédiat (401), avant même de tenter de décoder quoi que ce soit.
2. **Décodage et vérification de la signature** (`verifyToken`, dans un bloc `try`) — si le jeton est malformé, expiré, ou signé avec un secret différent, `jsonwebtoken` lève une exception, capturée par le `catch` final de la fonction (401 « Jeton invalide ou expiré »).
3. **Vérification de session unique** — **avant tout autre traitement**, une requête Prisma légère et dédiée (`select: { sessionActuelleId: true }`, pas de jointure, pas de chargement complet du rôle) compare `payload.sid` (l'identifiant de session inscrit dans le jeton au moment de la connexion) à `session.sessionActuelleId` (la session *actuellement* enregistrée sur le compte, en base). S'ils diffèrent, le compte s'est reconnecté ailleurs depuis, et le jeton présenté — bien que cryptographiquement valide et non expiré — est traité comme **révoqué** (401, avec un code spécial `SESSION_REMPLACEE` détaillé au §3.6). Le commentaire du code explique pourquoi cette vérification utilise une requête séparée plutôt que de la fusionner dans `chargerUtilisateur` : `chargerUtilisateur` est aussi appelé « hors HTTP » (probablement lors de l'émission d'événements Socket.io — voir Volume 12), un contexte où cette vérification de session n'aurait pas de sens.
4. **Chargement complet** (`chargerUtilisateur(payload.sub)`) — voir §3.3. Si `null` (compte supprimé ou désactivé entre l'émission du jeton et maintenant), 401.
5. **Attachement à la requête** (`req.utilisateur = utilisateur`) — Express permet d'attacher des propriétés arbitraires à l'objet `Request` ; ce projet étend son typage via une déclaration TypeScript globale (lignes 11-18) pour que `req.utilisateur` soit correctement typé (`UtilisateurDTO | undefined`) partout dans le reste du code, sans avoir à re-caster le type à chaque usage.
6. **Ouverture du contexte de requête** (`contexteRequete.run(...)`) — la suite du traitement (tous les middlewares et le gestionnaire de route qui suivent) s'exécute à l'intérieur d'un contexte `AsyncLocalStorage` portant l'identité de l'auteur, pour que `lib/audit.ts` (Volume 11g) sache qui a déclenché une écriture, sans avoir à faire circuler cette information en paramètre à travers toute la chaîne d'appels.

### Table des réponses possibles

| Situation | Code HTTP | Corps de la réponse |
|---|:---:|---|
| Pas d'en-tête `Authorization` | 401 | `{ erreur: "Authentification requise" }` |
| Jeton malformé, signature invalide, ou expiré | 401 | `{ erreur: "Jeton invalide ou expiré" }` |
| Compte introuvable (supprimé) | 401 | `{ erreur: "Compte introuvable ou désactivé" }` |
| `sid` du jeton ≠ session actuelle en base | 401 | `{ code: "SESSION_REMPLACEE", erreur: "Vous avez été déconnecté(e)..." }` |
| Compte désactivé (`actif = false`) | 401 | `{ erreur: "Compte introuvable ou désactivé" }` (même message que « introuvable », volontairement indistinguable) |
| Tout est valide | *(pas de réponse ici)* | `next()` appelé, la requête continue vers la route demandée |

## 3.5 `middleware/auth.ts` — `requirePermission` : la garde posée sur chaque route

### Signature — une fabrique de middleware

```ts
export function requirePermission(module: Module, niveau: Exclude<NiveauAcces, "AUCUN">) {
  return (req: Request, res: Response, next: NextFunction) => { /* ... */ };
}
```

`requirePermission` ne prend **pas** directement `(req, res, next)` — elle prend `(module, niveau)` et **renvoie** une fonction qui, elle, a la forme attendue par Express. C'est un patron courant appelé *middleware factory* (fabrique de middleware) : il permet d'écrire, dans chaque fichier de route, une ligne aussi concise que `requirePermission("CAISSE", "ECRITURE")` directement dans la déclaration de la route, plutôt que d'écrire une fonction dédiée pour chaque combinaison module/niveau possible.

### Déroulement

1. **Vérification via `aAcces`** (Volume 11a) — si l'utilisateur n'a pas au moins `niveau` sur `module`, réponse 403 (« Accès refusé »).
2. **Garde-fou de transparence** — condition à quatre critères combinés par `&&` :
   - `auteur?.estAdminPrincipal` — l'auteur est bien l'Admin Principal (un Admin secondaire ou tout autre rôle n'active jamais ce garde-fou) ;
   - `niveau === "ECRITURE"` — seule une action d'écriture déclenche l'alerte, jamais une simple consultation ;
   - `req.method !== "GET"` — filtre défensif supplémentaire, redondant en pratique avec le critère précédent pour les routes bien conçues (une route `GET` ne devrait jamais exiger `"ECRITURE"`), mais présent explicitement ;
   - `estHorsPerimetreAdmin(module)` — fonction de `services/interventionsAdmin.ts` (non détaillée dans ce chapitre, voir Volume 11z) qui détermine si `module` sort du périmètre habituel d'un Admin (Paramètres, Équipe, Activation, État système, Approbations).

   Si les quatre conditions sont réunies, un écouteur est posé sur l'événement `finish` de la réponse (`res.once("finish", ...)`) plutôt que d'émettre la notification immédiatement. **Pourquoi attendre la fin de la réponse plutôt que de notifier tout de suite ?** Parce qu'à ce stade du middleware, on ne sait pas encore si la route va réellement réussir — un formulaire invalide plus loin dans le traitement produirait une réponse 400 ou 409, et le commentaire du code est explicite : *« on n'alerte que sur une action RÉELLEMENT aboutie »*. La vérification `if (res.statusCode >= 400) return;` à l'intérieur de l'écouteur confirme ce choix : si la réponse finale est une erreur, aucune notification n'est envoyée, même si les quatre conditions initiales étaient réunies.
3. **`next()`** — si l'accès est autorisé, la requête continue.

### Exemple concret

L'Admin Principal enregistre directement une commande client (module `COMMANDES`, hors de son périmètre habituel). `requirePermission("COMMANDES", "ECRITURE")` autorise l'action (l'Admin Principal a `ECRITURE` sur tout, voir §3.3 passe 2). Les quatre conditions du garde-fou sont réunies : `estAdminPrincipal` vrai, `niveau` = `"ECRITURE"`, méthode `POST` (≠ `GET`), et `COMMANDES` est hors périmètre Admin. Si la commande s'enregistre avec succès (code 2xx), le Chargé des commandes (propriétaire du module) et le DG reçoivent une notification temps réel signalant l'intervention — conformément à la spec section 2 : *« un pouvoir total reste possible, mais jamais discret »*.

## 3.6 `apps/web/src/lib/api.ts` — le seul point de passage vers le serveur

### La fonction `api<T>`

```ts
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, MESSAGE_SERVEUR_INJOIGNABLE);
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = typeof body?.erreur === "string" ? body.erreur : MESSAGE_ERREUR_GENERIQUE;
    if (res.status === 401 && body?.code === CODE_SESSION_REMPLACEE) {
      ecouteurSessionRemplacee?.(message);
    }
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}
```

`api` est **générique** (`<T>`) : l'appelant précise le type de la réponse attendue (ex. `api<{ commandes: CommandeDTO[] }>("/api/commandes")`), et TypeScript type automatiquement la valeur retournée en conséquence — sans validation à l'exécution côté client (la validation réelle a déjà eu lieu côté serveur avant l'enregistrement ; ce que le client reçoit est réputé conforme).

### Déroulement étape par étape

1. **Lecture du jeton** (`getToken()`, qui lit `localStorage`) et **ajout automatique de l'en-tête `Authorization`** si un jeton existe — c'est ce mécanisme qui rend le passage du jeton totalement invisible dans le reste du code frontend : aucun composant n'a besoin de se soucier d'ajouter ce jeton, `api()` s'en charge systématiquement.
2. **Appel réseau protégé** (`try`/`catch` autour de `fetch`) — si le réseau est coupé ou le serveur totalement injoignable, `fetch` lève une exception technique en anglais (`"Failed to fetch"`) ; ce cas est intercepté et transformé en `ApiError(0, MESSAGE_SERVEUR_INJOIGNABLE)`, un message en français compréhensible par un utilisateur non technique. Notez le code de statut `0`, une convention de ce fichier pour distinguer « le serveur n'a jamais répondu » d'une vraie réponse HTTP d'erreur.
3. **Cas particulier du 204** (`No Content`) — certaines routes de suppression renvoient un 204 sans corps ; tenter de parser un corps JSON vide lèverait une erreur inutile, donc ce cas est traité à part, avant la tentative de lecture du corps.
4. **Lecture du corps** (`res.json().catch(() => null)`) — si le corps n'est pas du JSON valide (réponse HTML d'une erreur de proxy, par exemple), `body` devient `null` plutôt que de faire échouer toute la fonction.
5. **Cas d'échec** (`!res.ok`, c'est-à-dire un code de statut hors 200-299) :
   - le message affiché à l'utilisateur est celui renvoyé par le serveur (`body.erreur`) s'il existe et est une chaîne, sinon un message générique de repli ;
   - **cas spécial de la session remplacée** : si le code est 401 **et** que le corps porte `code: "SESSION_REMPLACEE"`, l'écouteur enregistré par `AuthProvider` (§3.7) est appelé **avant** de lancer l'exception — c'est ce qui déclenche la déconnexion immédiate de l'interface, pas seulement l'affichage d'un message d'erreur sur le formulaire en cours ;
   - dans tous les cas d'échec, une `ApiError` est levée (jamais une valeur de retour spéciale) — chaque appelant doit gérer cette exception, typiquement via le mécanisme `onError` de TanStack Query (Volume 10).
6. **Cas de succès** — le corps JSON est retourné tel quel, typé `T`.

### Le mécanisme de découplage `surSessionRemplacee`

```ts
type EcouteurSessionRemplacee = (message: string) => void;
let ecouteurSessionRemplacee: EcouteurSessionRemplacee | null = null;

export function surSessionRemplacee(fn: EcouteurSessionRemplacee | null) {
  ecouteurSessionRemplacee = fn;
}
```

Ce module (`lib/api.ts`) ne connaît pas `lib/auth.tsx` — s'il l'importait directement pour appeler une fonction de déconnexion, cela créerait une **dépendance circulaire** (`auth.tsx` importe déjà `api.ts` pour effectuer ses propres appels). La solution retenue est une variable de module tenant une référence de fonction, modifiable de l'extérieur via `surSessionRemplacee` : `AuthProvider` enregistre son propre gestionnaire au montage (§3.7), et `api()` l'appelle sans jamais connaître son origine. C'est un patron d'inversion de dépendance minimaliste, sans bibliothèque dédiée.

## 3.7 `apps/web/src/lib/auth.tsx` — le contexte React d'authentification

### Vue d'ensemble du composant

`AuthProvider` est un **fournisseur de contexte React** : il englobe toute l'application (voir Volume 8) et rend disponible, à tout composant descendant, l'état d'authentification courant via le hook `useAuth()`. Sa valeur exposée (interface `AuthContextValue`) contient l'utilisateur courant, l'état de chargement, les fonctions `login`/`logout`, les fonctions de vérification de permission `peutLire`/`peutEcrire`, et la gestion de la langue.

### Chargement initial (l'effet monté une seule fois)

```ts
useEffect(() => {
  if (!getToken()) {
    // Pré-connexion : récupère la langue par défaut boutique + l'état de premier lancement
    // ...
    return;
  }
  api<{ utilisateur: UtilisateurDTO; langueDefautBoutique: Langue }>("/api/auth/me")
    .then((r) => { /* installe l'utilisateur */ })
    .catch(() => setToken(null))
    .finally(() => setChargement(false));
}, [appliquer]);
```

Au montage de l'application, deux chemins possibles :
- **Aucun jeton en `localStorage`** — l'utilisateur n'a jamais été connecté, ou son jeton a été effacé (déconnexion, ou expiration détectée précédemment). L'application interroge alors deux routes non protégées (`/api/auth/langue-defaut`, `/api/auth/etat-initial`) pour savoir quelle langue afficher sur l'écran de connexion et si l'application n'a **aucun** compte du tout (déclenchant l'Assistant de premier lancement — voir Volume 8).
- **Un jeton existe** — l'application tente `/api/auth/me`, qui revalide le jeton côté serveur (exactement le même `requireAuth` que toute autre route protégée) et renvoie l'utilisateur à jour. Si cet appel échoue (jeton expiré, session remplacée, compte désactivé...), le `catch` efface le jeton (`setToken(null)`) — l'utilisateur se retrouve déconnecté silencieusement, sans message d'erreur intrusif à ce stade précis (le message de session remplacée, lui, passe par un autre canal, voir ci-dessous).

Dans les deux chemins, `setChargement(false)` est appelé en dernier (`finally`) — c'est ce booléen que `App.tsx` (Volume 10) utilise pour afficher un écran de chargement plutôt que de basculer prématurément vers l'écran de connexion pendant que cette vérification est en cours.

### `login` — la fonction de connexion

```ts
const login = useCallback(async (email: string, motDePasse: string) => {
  const r = await api<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, motDePasse }),
  });
  setToken(r.token);
  setUtilisateur(r.utilisateur);
  setLangueDefautBoutique(r.langueDefautBoutique);
  setMessageSessionRemplacee(null);
  appliquer(r.utilisateur, r.langueDefautBoutique);
}, [appliquer]);
```

Envoie les identifiants à `/api/auth/login` (route détaillée au Volume 11c), reçoit en retour un jeton et l'utilisateur, les stocke (`setToken` écrit en `localStorage`, `setUtilisateur` déclenche un re-rendu React de toute l'application authentifiée), et efface tout message de « session remplacée » qui aurait pu persister d'une déconnexion précédente.

### `deconnexionForcee` — la réaction à une session invalidée

```ts
const deconnexionForcee = useCallback((message: string) => {
  setToken(null);
  setUtilisateur(null);
  setMessageSessionRemplacee(message);
  appliquer(null, langueDefautBoutique);
  rafraichirEtatInitial();
}, [appliquer, langueDefautBoutique, rafraichirEtatInitial]);
```

Cette fonction est le point de convergence de **deux déclencheurs distincts** :
1. **Le canal HTTP** — enregistré auprès de `lib/api.ts` via `surSessionRemplacee(deconnexionForcee)` dans un `useEffect` dédié ; appelé quand une requête ordinaire reçoit un 401 `SESSION_REMPLACEE` (§3.6).
2. **Le canal temps réel** — `apps/web/src/lib/socket.tsx` appelle directement `deconnexionForcee` en réaction à l'événement Socket.io `sessionInvalidee`, pour le cas où l'utilisateur n'effectue aucune requête HTTP au moment où sa session est remplacée ailleurs (sans ce canal, il resterait connecté dans l'interface jusqu'à sa prochaine action).

Le dernier appel, `rafraichirEtatInitial()`, mérite une explication : il revérifie si l'application est en état de « premier lancement » (aucun compte). Le commentaire du code précise pourquoi c'est nécessaire précisément ici : après une **réinitialisation complète de la base** (Volume 23), tous les comptes disparaissent d'un coup, et l'utilisateur alors connecté doit être redirigé non pas vers l'écran de connexion ordinaire, mais vers l'Assistant de premier lancement.

### `peutLire` et `peutEcrire` — l'interface publique du système de permissions côté client

```ts
const peutLire = useCallback(
  (module: Module) => !!utilisateur && aAcces(utilisateur.role.permissions, module, "LECTURE"),
  [utilisateur],
);
const peutEcrire = useCallback(
  (module: Module) => !!utilisateur && aAcces(utilisateur.role.permissions, module, "ECRITURE"),
  [utilisateur],
);
```

Ces deux fonctions sont de simples enveloppes autour de `aAcces` (Volume 11a), avec une garde supplémentaire : `!!utilisateur` — si aucun utilisateur n'est chargé (état initial, ou après déconnexion), les deux renvoient systématiquement `false`, sans même appeler `aAcces`. C'est **exactement la même fonction** `aAcces` que celle utilisée côté serveur dans `requirePermission` — la cohérence entre ce que l'interface affiche et ce que le serveur autorise réellement vient de ce partage, pas d'une simple coïncidence d'implémentation parallèle.

**Point de sécurité fondamental à ne jamais perdre de vue** : `peutLire`/`peutEcrire` **ne protègent rien par elles-mêmes**. Elles ne servent qu'à décider quoi *afficher*. Un utilisateur techniquement capable de modifier le code JavaScript exécuté dans son propre navigateur pourrait forcer `peutEcrire` à toujours renvoyer `true` et faire apparaître n'importe quel bouton — cela ne lui donnerait strictement aucun accès réel, car chaque requête qui en résulterait serait de toute façon revérifiée par `requirePermission` côté serveur (§3.5), qui, lui, ne peut pas être contourné depuis le navigateur. C'est un principe de sécurité général, pas spécifique à ce projet : **le client décide de l'affichage, le serveur décide de l'autorisation**.

## 3.8 Diagramme de séquence — cycle complet d'une requête authentifiée

```mermaid
sequenceDiagram
    participant U as Utilisateur (navigateur)
    participant AC as AuthProvider (auth.tsx)
    participant API as api() (lib/api.ts)
    participant EX as Express (app.ts)
    participant MW as requireAuth + requirePermission
    participant DB as PostgreSQL (Prisma)

    U->>AC: Saisit email + mot de passe, clique "Se connecter"
    AC->>API: api("/api/auth/login", { email, motDePasse })
    API->>EX: POST /api/auth/login
    EX->>DB: Vérifie le mot de passe (bcrypt), génère sid, écrit sessionActuelleId
    DB-->>EX: OK
    EX-->>API: { token, utilisateur, langueDefautBoutique }
    API-->>AC: réponse typée
    AC->>AC: setToken(token) → localStorage ; setUtilisateur(...)

    Note over U,DB: Plus tard : l'utilisateur clique sur "Enregistrer une commande"

    U->>API: api("/api/commandes", { method: "POST", ... })
    API->>API: Ajoute l'en-tête Authorization: Bearer <token>
    API->>EX: POST /api/commandes
    EX->>MW: requireAuth
    MW->>DB: Vérifie sid == sessionActuelleId (session unique)
    DB-->>MW: sid valide
    MW->>DB: chargerUtilisateur(id) — rôle + permissions + délégations
    DB-->>MW: UtilisateurDTO
    MW->>MW: requirePermission("COMMANDES", "ECRITURE") → aAcces(...)
    alt Permission accordée
        MW->>EX: next() — la route s'exécute
        EX-->>API: 201 { commande }
        API-->>U: Commande affichée
    else Permission refusée
        MW-->>API: 403 { erreur }
        API-->>U: ApiError levée, message affiché
    else Session remplacée ailleurs
        MW-->>API: 401 { code: "SESSION_REMPLACEE", erreur }
        API->>AC: ecouteurSessionRemplacee(message)
        AC->>AC: deconnexionForcee() — déconnexion immédiate
        AC-->>U: Écran de connexion avec message dédié
    end
```

## 3.9 Exemple concret bout en bout

Un Chargé des commandes se connecte sur son téléphone (session A, `sid = "abc"`). Une heure plus tard, il se connecte aussi depuis l'ordinateur du bureau (session B, `sid = "xyz"`) — la route de connexion (Volume 11c) écrase `sessionActuelleId` en base avec `"xyz"`. Sans qu'il s'en aperçoive, son téléphone reste ouvert sur l'écran des commandes. Vingt minutes après, il touche l'écran de son téléphone pour enregistrer une nouvelle commande : la requête part avec le jeton de la session A (`sid = "abc"`), mais `requireAuth` compare ce `sid` à `sessionActuelleId` en base, qui vaut maintenant `"xyz"` — la comparaison échoue, la réponse est un 401 `SESSION_REMPLACEE`, et le téléphone affiche immédiatement l'écran de connexion avec le message *« Vous avez été déconnecté(e) car votre compte a été utilisé sur un autre appareil »*. C'est le mécanisme de **session unique** de la section 3.7 de la spécification, illustré de bout en bout à travers les quatre fichiers de ce chapitre.

## 3.10 Erreurs fréquentes pour qui modifie ce mécanisme

- **Ajouter une vérification de permission uniquement côté frontend** (dans `auth.tsx` ou un composant) sans la répliquer côté serveur (`requirePermission` sur la route) : cela crée une fausse impression de sécurité — voir l'avertissement du §3.7.
- **Oublier `res.once("finish", ...)` et notifier immédiatement** dans `requirePermission` : notifierait même en cas d'échec de la requête plus loin dans le traitement, contrairement à l'intention explicite du code.
- **Faire confiance à `roleId` du jeton JWT pour les permissions** plutôt qu'à `chargerUtilisateur` : ignorerait tout changement de rôle survenu après l'émission du jeton, jusqu'à sa prochaine reconnexion (12h plus tard au maximum).
- **Appeler `fetch` directement** depuis un composant plutôt que de passer par `api()` : perdrait automatiquement l'ajout du jeton, la traduction des erreurs, et la détection de session remplacée.

## Croisement avec la spécification

| Mécanisme | Section de la spec | Correspondance |
|---|---|---|
| Fusion rôle + Admin Principal + délégations | 2 (« Matrice des permissions »), 3.7 (délégations) | **Conforme** |
| Garde-fou de notification (Admin Principal hors périmètre) | 2 (« Garde-fou — intervention de l'Admin Principal ») | **Conforme** — y compris le détail « le rôle propriétaire du module et le DG » |
| Session unique | 3.7 | **Conforme** |
| `peutLire`/`peutEcrire` ne protègent que l'affichage | Principe implicite de toute la section 2 | **Conforme** — le serveur revérifie systématiquement |

Aucun écart repéré pour ce chapitre.

## Résumé du chapitre

L'authentification de ce projet repose sur un jeton JWT signé (`lib/jwt.ts`), revalidé à chaque requête protégée par `requireAuth` — qui vérifie en plus, avant tout le reste, qu'aucune connexion plus récente n'a remplacé la session courante. Les permissions ne sont **jamais** lues depuis le jeton lui-même : elles sont reconstruites à chaque requête par `chargerUtilisateur`, qui fusionne le rôle de base, le statut éventuel d'Admin Principal (accès total) et les délégations temporaires actives. Côté client, `api()` centralise l'ajout du jeton et la détection d'une session invalidée, et `auth.tsx` expose `peutLire`/`peutEcrire` — des fonctions qui ne protègent que l'affichage, jamais l'exécution réelle, toujours revérifiée côté serveur par la fonction `aAcces` partagée (Volume 11a).

**Fichiers marqués « Vérifié » à l'issue de ce chapitre** : `apps/api/src/lib/jwt.ts`, `apps/api/src/middleware/auth.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/auth.tsx`.

**Suite** → Volume 11c : Connexion (`routes/auth.ts` + `pages/Login.tsx`).
