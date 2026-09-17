# Volume 16 — Gestion des erreurs et journalisation

**Niveau de risque : 3 — Support/infrastructure.** Dernier des chapitres de synthèse de cette série (après les Volumes 6, 14, 15) : un seul nouveau fichier (`lib/logger.ts`, 35 lignes), et le détail du middleware d'erreur central de `app.ts`, déjà entrevu sans être expliqué depuis le Volume 8.

## 1. Ce que couvre ce chapitre

- `apps/api/src/lib/logger.ts` (nouveau)
- Le middleware d'erreur centralisé de `apps/api/src/app.ts` (détaillé pour la première fois)
- Le motif `catch (e) { next(e); }`, déjà vu des dizaines de fois sans être commenté

## 2. `lib/logger.ts` — logging structuré, volontairement minimal

Le commentaire de tête du fichier explique le choix : « logging structuré minimal... remplace les `console.log`/`console.error` épars, sans niveau ni format exploitable, qui existaient jusqu'ici. Volontairement sans dépendance externe (winston/pino) : le volume de ce projet ne le justifie pas ». Trois niveaux (`info`, `warn`, `error`), une seule fonction interne (`ecrire`) qui sérialise chaque entrée en **une ligne JSON** :

```ts
function ecrire(niveau: Niveau, message: string, contexte?: Record<string, unknown>) {
  const entree = { horodatage: new Date().toISOString(), niveau, message, ...(contexte ? { contexte } : {}) };
  const ligne = JSON.stringify(entree, remplacantErreur);
  if (niveau === "error") console.error(ligne);
  else console.log(ligne);
}
```

Un détail technique facile à manquer : `remplacantErreur`, le second argument de `JSON.stringify`, existe uniquement parce que **`JSON.stringify` d'un objet `Error` natif renvoie `{}`** — les propriétés `message`/`stack`/`name` d'une `Error` ne sont pas énumérables par défaut en JavaScript, donc invisibles à une sérialisation JSON standard. Le remplaçant les extrait explicitement :

```ts
function remplacantErreur(_cle: string, valeur: unknown) {
  if (valeur instanceof Error) return { nom: valeur.name, message: valeur.message, pile: valeur.stack };
  return valeur;
}
```

Sans cette fonction, chaque appel `logger.error("...", { erreur: someError })` — motif omniprésent dans les chapitres précédents (Volumes 11z-1, 11z-4, 11z-5) — produirait une ligne de log où l'erreur elle-même serait invisible (`"contexte":{"erreur":{}}`), rendant le journal inutile précisément au moment où il compte le plus.

## 3. Le middleware d'erreur central de `app.ts` — le filet final

Posé en tout dernier dans `createApp()` (après le 404 JSON des routes `/api` inconnues, Volume 8), reconnu automatiquement par Express comme gestionnaire d'erreur grâce à sa signature à **quatre** paramètres (`err, req, res, next`) :

```ts
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Erreur non gérée", { erreur: err, methode: req.method, chemin: req.path });
  res.status(500).json({ erreur: "Erreur interne du serveur" });
});
```

Deux décisions à noter :

- **Toujours journalisé avec le contexte de la requête** (méthode HTTP, chemin) — une erreur atteignant ce point n'est jamais simplement perdue, elle laisse une trace exploitable dans les logs Render.
- **Toujours un message générique renvoyé au client** (« Erreur interne du serveur »), jamais le détail de l'exception d'origine — cohérent avec le principe de sécurité déjà établi au Volume 14 (ne jamais exposer de détail technique susceptible d'aider un attaquant) et avec le ton clair exigé par la spec 3.8 (jamais un message brut de développeur affiché à l'utilisateur).

## 4. Le chemin qui y mène : `catch (e) { next(e); }`

Ce motif, déjà rencontré dans **chaque** route de **chaque** chapitre applicatif de ce livre sans être commenté pour lui-même, est la façon dont Express achemine une exception inattendue jusqu'au middleware du §3 : appeler `next(e)` (plutôt que de laisser l'exception se propager sans être attrapée, ou de répondre directement) délègue explicitement la décision finale au gestionnaire centralisé. La quasi-totalité des routes suivent une hiérarchie à deux niveaux, déjà observée route par route sans jamais être nommée comme telle :

```ts
} catch (e) {
  if (e instanceof ErreurMetierSpecifique) return res.status(e.status).json({ erreur: e.message });
  next(e);
}
```

1. **Erreurs métier nommées** (`ErreurStock`, Volume 11z-1 ; `ErreurCloudflare`, Volume 11z-5 ; `ErreurEmail`, Volume 11z-5 ; `ErreurAction`, Volume 11f ; `ErreurSauvegarde`/`ErreurReinitialisation`, Volume 11z-4) — chacune porte son propre code de statut HTTP et un message déjà clair pour l'utilisateur, gérées explicitement avec un `return` avant d'atteindre `next(e)`.
2. **Tout le reste** — erreurs Prisma inattendues, bugs, pannes réseau vers un service externe — tombe dans `next(e)`, remonte jusqu'au middleware centralisé, journalisé avec contexte, jamais exposé en détail.

Cette hiérarchie explique une régularité déjà notée sans être expliquée dans plusieurs chapitres : les erreurs « attendues » du projet (stock insuffisant, jeton Cloudflare absent, SMTP en échec...) ont toutes leur propre classe d'erreur avec un message métier précis, tandis qu'aucune route ne tente jamais de deviner ou d'anticiper une erreur système inattendue — ce rôle est laissé entièrement au filet final.

## 5. Croisement avec `docs/spec-boulangerie.md`

Section 3.8 (ton des messages, « jamais de code d'erreur brut... toujours une explication compréhensible ») : confirmée par le message générique et volontairement non technique du middleware final, complémentaire aux messages métier précis des erreurs nommées (§4). Aucune section de la spec ne prescrit de mécanisme de journalisation particulier — choix d'implémentation, déjà justifié dans le commentaire du fichier lui-même. Aucun écart.

## 6. Erreurs fréquentes et cas limites

- **Une erreur `Error` passée telle quelle à `logger.error`** : correctement sérialisée grâce à `remplacantErreur`, jamais un objet vide dans les logs.
- **Une route qui oublierait `next(e)` dans son `catch`** : non observée dans ce projet (vérifié à travers tous les chapitres applicatifs) — mais serait le seul cas où une erreur resterait silencieuse côté client (requête qui ne répond jamais) plutôt que de tomber sur le `500` générique.
- **Une erreur métier nommée non reconnue par son `instanceof`** (ex. une nouvelle classe d'erreur oubliée dans une route) : tombe simplement dans le filet générique — dégradation propre, jamais un plantage.

## 7. Résumé

Ce chapitre referme la dernière pièce transversale restée implicite : un logger volontairement minimal (une fonction, pas une dépendance), et un unique point de convergence pour toute erreur non explicitement gérée, alimenté par un motif (`catch (e) { next(e); }`) répété à l'identique dans chaque route du projet sans jamais faillir à distinguer erreur métier nommée et erreur système inattendue. Avec les Volumes 6, 14 et 15, ce chapitre clôt la série des synthèses transversales — la suite du plan revient à des territoires de code encore inexplorés (Volume 17, Internationalisation).

---

**Suite →** Volume 17 — Internationalisation, qui détaille la structure des 4 fichiers de traduction et le mécanisme de bascule de langue déjà cité sans être expliqué depuis le Volume 3.
