# Volume 12 — API et communications réseau

**Niveau de risque : 2 — Fonctionnel standard.** Ce volume referme le **transport** sur lequel repose tout le système de notification déjà expliqué en détail à travers les Volumes 11 et 11z : `getIo`, `roomUtilisateur`, `busEvenements` ont été cités et utilisés dans une dizaine de chapitres précédents (Volumes 11c, 11f, 11h, 11j, 11z-1 à 11z-5) sans jamais être eux-mêmes expliqués. C'est chose faite ici.

## 1. Ce que couvre ce chapitre

- `apps/api/src/lib/realtime.ts` (serveur Socket.io)
- `apps/api/src/lib/events.ts` (bus d'événements interne)
- `apps/web/src/lib/socket.tsx` (client Socket.io, contexte React)
- `apps/web/src/components/ActivityFeed.tsx`, `apps/web/src/components/IndicateurConnexion.tsx`

Avec ce chapitre, l'intégralité du mécanisme de notification temps réel — de l'émission d'un événement métier jusqu'à son affichage animé dans l'interface — est désormais couverte de bout en bout.

## 2. Intuition : trois couches, une seule responsabilité chacune

La spécification (section 7, note technique) décrit l'architecture en une phrase : « côté serveur, un émetteur d'événements interne (EventEmitter Node) déclenche l'envoi Socket.io vers la ou les room correspondant au(x) supérieur(s) hiérarchique(s) concerné(s) ». Trois couches distinctes, jamais mélangées :

1. **`lib/events.ts`** — le bus d'événements interne, découplé de tout : une route métier (Stocks, Commandes, Production...) y publie un événement sans savoir qui va le recevoir ni comment.
2. **`services/notifications.ts`** (Volume 11z-4) — la couche métier : détermine **qui** doit recevoir l'événement (ciblage par rôle/hiérarchie), persiste une `Notification` par destinataire.
3. **`lib/realtime.ts`** — le transport : pousse l'événement en temps réel vers les sockets connectés des destinataires calculés à l'étape précédente.

Le module métier qui émet un événement (ex. `routes/stocks.ts`, Volume 11z-1) ne connaît **que** l'étape 1 — il ignore complètement Socket.io. C'est cette séparation qui permet de tester ou de faire évoluer chaque couche indépendamment.

## 3. `lib/events.ts` — le bus, minimal par conception

Fichier de 45 lignes : `BusEvenements` étend directement `EventEmitter` de Node (le même choix que documenté dans la spec, « EventEmitter Node ») avec deux méthodes, `emettreEvenement` et `surEvenement`, qui ne sont que des enrobages typés de `emit`/`on` sur un canal unique (`"evenement"`). L'interface `EvenementMetier` est le contrat que respecte toute route métier qui publie un événement — déjà rencontrée dans chaque chapitre du Volume 11z sans être nommée : `module`, `emetteurId` (`null` pour un événement système, comme l'alerte de dette non payée du Volume 11h), `priorite`, et deux mécanismes de ciblage optionnels déjà expliqués au Volume 11z-4 (`restreindreAuxRoles`, `destinataireIdsDirects`). Un seul singleton exporté (`busEvenements`), instancié une fois pour toute la durée de vie du process — c'est cette même instance que `initNotificationService()` (Volume 11z-4) écoute au démarrage du serveur (Volume 8, étape 3 de `index.ts`).

## 4. `lib/realtime.ts` — Socket.io côté serveur

### 4.1 Authentification au handshake, pas après coup

`initRealtime(httpServer)` attache Socket.io au même serveur HTTP que l'API Express (Volume 8), mais avec sa **propre** configuration CORS — le commentaire du code souligne un piège classique : `app.use(cors())` côté Express ne couvre pas Socket.io, qui a son propre mécanisme. Les deux réutilisent toutefois la même liste d'origines autorisées (`verifierOrigine`, `lib/origines.ts`, futur chapitre), pour ne jamais diverger.

Le middleware `io.use(...)` est l'équivalent Socket.io de `requireAuth` (Volume 11b), mais appliqué **une seule fois, au handshake** plutôt qu'à chaque message :

```ts
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (typeof token !== "string" || !token) return next(new Error("Authentification requise"));
  const payload = verifyToken(token);

  // Session unique (section 3.7) : même contrôle que requireAuth côté HTTP.
  const session = await prisma.utilisateur.findUnique({ where: { id: payload.sub }, select: { sessionActuelleId: true } });
  if (!session) return next(new Error("Compte introuvable ou désactivé"));
  if (!payload.sid || payload.sid !== session.sessionActuelleId) return next(new Error(MESSAGE_SESSION_REMPLACEE));

  const utilisateur = await chargerUtilisateur(payload.sub);
  socket.data.utilisateur = utilisateur;
  next();
});
```

Point notable, déjà annoncé mais jamais détaillé jusqu'ici (Volume 11c, §sur la déconnexion d'un appareil concurrent) : **la vérification de session unique existe aussi côté Socket.io**, avec exactement la même logique que `requireAuth` côté HTTP (comparaison du `sid` du jeton avec `sessionActuelleId` en base). Un socket ouvert avec un jeton devenu périmé (session remplacée par une connexion ailleurs) est rejeté au handshake avec le message `MESSAGE_SESSION_REMPLACEE`, repris tel quel côté client (§6).

### 4.2 Deux rooms par connexion

```ts
io.on("connection", (socket) => {
  const u = socket.data.utilisateur;
  socket.join(roomUtilisateur(u.id));
  socket.join(roomRole(u.role.id));
});
```

Chaque socket rejoint automatiquement **deux** rooms : la sienne (`user:{id}`, utilisée pour les notifications personnelles et les messages du chat Assistant, Volume 11z-5) et celle de son rôle (`role:{id}`, utilisée par exemple pour diffuser un message à tous les Admins connectés via `roomRole(idRoleAdmin)`, Volume 11z-5 §4.2). Ce double rattachement explique pourquoi `notifierAdmins` (Volume 11z-5) peut cibler « tous les comptes Admin actifs » sans connaître à l'avance quels sockets sont ouverts — il suffit d'émettre vers la room du rôle.

### 4.3 `getIo()` et `invaliderSessionUtilisateur` — les deux points d'entrée déjà rencontrés

`getIo()` (utilisée dans une dizaine de routes des chapitres précédents pour émettre un événement direct — réinitialisation de base au Volume 11z-4, escalade du chat au Volume 11z-5) lève une exception explicite si `initRealtime` n'a pas encore été appelé — jamais un `null` silencieux qui produirait une erreur cryptique ailleurs. `invaliderSessionUtilisateur(utilisateurId)`, déjà mentionnée sans être expliquée au Volume 11c, est la fonction appelée juste après qu'une nouvelle connexion a remplacé le `sid` d'un utilisateur : elle émet `sessionInvalidee` vers la room de cet utilisateur **puis** déconnecte de force tous ses sockets (`disconnectSockets(true)`) — prévenir avant de couper, pas l'inverse, pour que le client ait une chance d'afficher le message avant la coupure réelle. Un appel avec `io` encore `null` (tests, ou un contexte où `initRealtime` n'a pas tourné) est un no-op silencieux — la vérification côté `requireAuth` HTTP reste de toute façon le filet de sécurité réel, cohérent avec le principe déjà établi au Volume 10 (confort d'affichage/temps réel vs sécurité effective toujours assurée par ailleurs).

## 5. Le contrat d'événements typé (`packages/shared`)

`ServerToClientEvents`/`ClientToServerEvents` (importés depuis `@lomoto/shared` par les deux extrémités, serveur et client) typent statiquement chaque événement Socket.io — `notification`, `sessionInvalidee`, `messageSupport`, `conversationSupportEscaladee`, `conversationSupportFermee` côté serveur→client. Ce typage partagé, bénéfice concret du monorepo déjà souligné à plusieurs reprises (Volumes 11h, 11j), garantit qu'un événement émis côté serveur avec une forme de payload donnée est reçu avec exactement cette même forme côté client — aucune désynchronisation possible entre les deux sans une erreur de compilation TypeScript.

## 6. `lib/socket.tsx` — le contexte client

### 6.1 Chargement paresseux de la bibliothèque

```ts
void import("socket.io-client").then(({ io }) => {
  socket = io({ auth: { token: getToken() } });
  ...
});
```

`socket.io-client` est chargé via un `import()` dynamique plutôt qu'un import statique en tête de fichier — la bibliothèque, non négligeable en taille, n'entre donc jamais dans le chunk initial du bundle et n'est récupérée qu'une fois un utilisateur réellement connecté (`SocketProvider` ne s'active que si `utilisateur` est défini) — jamais sur l'écran de connexion. Même logique de découpage de bundle que `NotificationBell`/`framer-motion` au Volume 11z-4, appliquée ici à une dépendance réseau plutôt qu'à une bibliothèque d'animation.

### 6.2 Rattrapage après (re)connexion

`chargerHistorique()` (appel à `GET /api/notifications`, Volume 11z-4) est invoquée **à chaque connexion et reconnexion** — pas seulement au montage initial. C'est le mécanisme de rattrapage déjà annoncé au Volume 11z-4 : un événement manqué pendant une coupure réseau n'est jamais perdu, il est simplement absent du flux temps réel et retrouvé au prochain chargement de l'historique. `socket.io-client` gère lui-même la reconnexion automatique ; le code se contente d'observer ses transitions d'état (`reconnect_attempt`, `disconnect`) pour piloter `StatutConnexion` (`"connecte" | "reconnexion" | "deconnecte"`), affiché par `IndicateurConnexion` (§7).

### 6.3 Trois filets pour la session unique

Le mécanisme de déconnexion forcée (session remplacée, Volume 11c) est couvert par **trois filets superposés**, chacun pour un cas temporel différent :

1. `socket.on("connect_error", ...)` : la tentative de connexion elle-même est rejetée au handshake (§4.1) — cas d'un onglet resté ouvert avec un jeton déjà périmé **avant même** la première connexion réussie.
2. `socket.on("sessionInvalidee", ...)` : un socket **déjà connecté** reçoit l'événement explicite envoyé par `invaliderSessionUtilisateur` au moment précis où une autre connexion vient de le remplacer.
3. La vérification côté `requireAuth` HTTP (Volume 11b) reste le filet ultime pour toute requête REST qui ne passerait par aucun des deux chemins ci-dessus (ex. un onglet qui n'a jamais ouvert de socket).

Les trois convergent vers le même point : `deconnexionForcee(message)` de `useAuth()` (Volume 11b).

### 6.4 Invalidation ciblée à la réception d'une notification

À la réception d'une `notification`, le contexte fait deux choses : mettre à jour l'état local (`notifications`/`nonLues`, consommé par `NotificationBell` et `IndicateurConnexion`) et invalider des clés TanStack Query **spécifiques au module concerné** — ex. `["commandes"]`/`["commissions"]`/`["clients"]` pour une notification `COMMANDES`. C'est l'implémentation concrète, au niveau transport, de la convention « invalidation large après un événement » déjà posée au Volume 10 et observée dans chaque chapitre du Volume 11z (ex. la réception fournisseur qui invalide aussi `["matieres"]`/`["mouvements"]`, Volume 11z-1).

**Observation (pas un écart spec/code)** : les clés invalidées pour le module `CAISSE` sont `["ventes"]` et `["clotures"]` — des noms qui ne correspondent à **aucune** clé de requête utilisée par `CaissePage` (Volume 11j, qui utilise la clé `["registre"]`) ni par aucun écran actuel du module Caisse (vérifié par recherche dans le code : `["ventes"]` et `["clotures"]` n'apparaissent nulle part ailleurs dans `apps/web/src`). Ces noms correspondent aux tables `Vente`/`ClotureCaisse`, supprimées par la migration `absence_alerte_et_nettoyage_orphelines` documentée au Volume 13 — un reliquat de code mort de l'ancienne Caisse (vente au comptoir, refonte 3.1), jamais nettoyé lors du retrait de ces tables. Sans conséquence fonctionnelle (une invalidation sur une clé de requête inexistante ne fait simplement rien), mais une observation de code mort à signaler, comparable aux autres incohérences documentaires déjà relevées (Volumes 4, 13, 11z-5).

## 7. `ActivityFeed` et `IndicateurConnexion` — les deux vues du flux temps réel

`ActivityFeed` est le composant de rendu, réutilisé par `NotificationBell` (Volume 11z-4, mode `compact`) — liste animée (Framer Motion, `AnimatePresence`/`motion.li`) de `NotificationDTO`, avec mise en forme différenciée par priorité (`HAUTE` = bordure et icône d'alerte distinctes) et par état lu/non lu. `tempsRelatif` formate chaque horodatage en relatif (« il y a 3 min », « hier »...) via `Intl.RelativeTimeFormat`, une API native du navigateur plutôt qu'une bibliothèque de plus.

`IndicateurConnexion` est une simple pastille de statut (`connecte`/`reconnexion`/`deconnecte`), délibérément **séparée** de `NotificationBell` — commentaire explicite dans le code : elle n'utilise pas Framer Motion et reste donc dans le bundle principal, alors que la cloche (animée) est chargée en lazy (Volume 11z-4). Un exemple concret et mesuré de la discipline de découpage de bundle observée à plusieurs reprises dans ce livre : ne pas payer le coût d'une dépendance d'animation pour un composant qui n'en a pas besoin.

## 8. Croisement avec `docs/spec-boulangerie.md`

- Section 7, note technique (« émetteur d'événements interne EventEmitter Node... déclenche l'envoi Socket.io vers la room correspondant au(x) supérieur(s) hiérarchique(s) ») : confirmé exactement — `EventEmitter` natif de Node, ciblage par room. Aucun écart.
- Section 3.7 (session unique, déconnexion en temps réel si le socket est encore ouvert) : confirmé, avec les trois filets détaillés au §6.3. Aucun écart.
- Section 3.19 (notification temps réel des Admins pour le chat Assistant) : confirmé (`roomRole`, événements `messageSupport`/`conversationSupportEscaladee`/`conversationSupportFermee`). Aucun écart.

Aucun écart spec/code trouvé dans ce chapitre — une observation de code mort signalée (§6.4, clés d'invalidation `["ventes"]`/`["clotures"]` sans écran correspondant).

## 9. Exemple de séquence complète

Reprise de l'exemple du Volume 11z-1 (mouvement de stock franchissant un seuil), maintenant tracé à travers toutes les couches :

1. `routes/stocks.ts` appelle `busEvenements.emettreEvenement({ type: "ALERTE_STOCK", module: "STOCKS", ... })` — **couche 1**, aucune connaissance de Socket.io.
2. `initNotificationService()` (branché au démarrage, Volume 8) reçoit l'événement via `busEvenements.surEvenement(...)`, appelle `publierEvenement` (Volume 11z-4) — **couche 2** : résout les destinataires (`rolesDestinataires`), crée une ligne `Notification` par destinataire, puis appelle `getIo().to(roomUtilisateur(d.id)).emit("notification", dto)` pour chacun.
3. Le socket du DG, connecté et abonné à `user:{idDG}`, reçoit l'événement `notification` côté client — **couche 3**, `lib/socket.tsx` met à jour l'état local et invalide `["matieres"]`.
4. `ActivityFeed` (via `NotificationBell`) affiche la nouvelle entrée avec une animation d'apparition, bordure distincte (priorité `HAUTE`), et le libellé relatif « à l'instant ».

## 10. Erreurs fréquentes et cas limites

- **Socket ouvert avec un jeton dont la session vient d'être remplacée ailleurs** : rejeté au handshake (`connect_error`) ou déconnecté explicitement (`sessionInvalidee`) selon le moment exact de la course.
- **`getIo()` appelée avant `initRealtime()`** : exception explicite, jamais un plantage silencieux plus loin dans la pile d'appels.
- **Notification reçue pour un module sans écran ouvert correspondant** : l'invalidation de clé de requête ne fait rien de visible, sans erreur (cas du code mort `CAISSE`/`["ventes"]`/`["clotures"]`, §6.4).
- **Coupure réseau prolongée puis reconnexion** : aucun événement manqué n'est définitivement perdu — l'historique est rechargé intégralement à la reconnexion.

## 11. Résumé

Ce chapitre ferme la boucle ouverte dès le Volume 11c : le mécanisme de notification temps réel, utilisé sans être expliqué dans une dizaine de chapitres, repose sur trois couches strictement séparées — un bus d'événements interne minimal (`EventEmitter` natif), une couche métier de ciblage déjà documentée (Volume 11z-4), et un transport Socket.io avec sa propre authentification au handshake, calquée sur `requireAuth` mais appliquée une seule fois par connexion plutôt qu'à chaque message. Le contrat d'événements typé partagé entre client et serveur (bénéfice du monorepo) garantit qu'aucune des deux extrémités ne peut diverger silencieusement de l'autre.

---

**Suite →** Volume 14 — Authentification, autorisations et sécurité (synthèse transversale), qui consolide en un seul chapitre les mécanismes de sécurité déjà rencontrés dispersés dans les Volumes 11b, 11c et 12.
