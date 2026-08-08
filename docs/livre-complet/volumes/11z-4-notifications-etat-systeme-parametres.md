# Volume 11z-4 — Notifications, État système, Paramètres et Premier lancement

**Niveau de risque : 2 — Fonctionnel standard.** Quatre modules qui touchent à l'infrastructure applicative plutôt qu'au métier de la boulangerie — mais avec une pièce centrale (`services/notifications.ts`) qui mérite un traitement aussi soigné qu'un chapitre Niveau 1, car elle détermine **qui voit quoi** dans toute l'application.

## 1. Ce que couvre ce chapitre

- `apps/api/src/routes/notifications.ts`, `apps/api/src/services/notifications.ts` (l'orchestration métier — le **transport** temps réel, `lib/realtime.ts`/`lib/events.ts`, est renvoyé au Volume 12)
- `apps/api/src/routes/etat-systeme.ts` et ses quatre services de sauvegarde : `services/sauvegarde.ts`, `services/sauvegardeLocale.ts`, `services/planificateurSauvegarde.ts`, `services/reinitialisation.ts`
- `apps/api/src/routes/parametres.ts`
- `apps/api/src/routes/premierLancement.ts`
- `apps/web/src/pages/EtatSysteme.tsx`, `apps/web/src/pages/Parametres.tsx`, `apps/web/src/pages/PremierLancement.tsx`, `apps/web/src/components/NotificationBell.tsx`

## 2. `services/notifications.ts` — qui reçoit quoi, et pourquoi

C'est la pièce la plus dense de ce chapitre : la fonction `rolesDestinataires` détermine, pour un événement donné, quels **rôles** doivent le recevoir — implémentation directe de la section 3.10 de la spécification (« notification instantanée chez le(s) supérieur(s) hiérarchique(s) concerné(s) »).

```ts
async function rolesDestinataires(module: Module, emetteurRoleId: string): Promise<Set<string>> {
  const roleIds = new Set<string>();
  const permissions = await prisma.rolePermission.findMany({
    where: { module, niveauAcces: { in: ["LECTURE", "ECRITURE"] } },
    select: { roleId: true },
  });
  for (const p of permissions) roleIds.add(p.roleId);

  const roleEmetteur = await prisma.role.findUnique({ where: { id: emetteurRoleId }, select: { roleParentId: true } });
  if (roleEmetteur?.roleParentId) roleIds.add(roleEmetteur.roleParentId);

  return roleIds;
}
```

Deux idées combinées, toutes deux commentées explicitement dans le code :

1. **Tous les rôles ayant au moins la lecture** sur le module de l'événement reçoivent la notification — la matrice de permissions (Volume 11d) encode déjà « qui a le droit de voir ce module », donc la réutiliser pour le ciblage évite de dupliquer une règle de hiérarchie séparée.
2. **Union avec le supérieur hiérarchique direct de l'émetteur** (`Role.roleParentId`) — un filet de sécurité pour le cas où la matrice d'un rôle futur serait incomplète, garantissant qu'un supérieur direct est toujours notifié même s'il n'a techniquement pas la lecture explicite sur ce module précis.

Une seconde fonction, `rolesAvecLecture`, sert le cas des **événements système** (sans émetteur humain — ex. l'alerte de dette non payée du Volume 11h, déclenchée par une vérification automatique, pas par une action utilisateur) : pas de hiérarchie à remonter, faute d'émetteur dont dériver un supérieur.

`publierEvenement`, le point d'entrée appelé pour chaque événement métier, orchestre l'ensemble :

- Résout l'émetteur (s'il existe) et son rôle.
- Calcule les rôles cibles (`rolesDestinataires` ou `rolesAvecLecture`), **sauf** si l'événement porte des `destinataireIdsDirects` explicites (ciblage direct court-circuitant la matrice — ex. une demande d'approbation adressée nommément à l'Admin Principal, Volume 11f).
- Filtre aux comptes `actif: true`, exclut systématiquement l'émetteur lui-même, applique un filtre optionnel `restreindreAuxRoles` (utilisé par l'alerte d'absence en attente, Volume 11k-2, pour restreindre aux seuls Admins malgré la lecture du DG).
- Pour chaque destinataire final : crée une ligne `Notification` en base **et** la pousse en temps réel dans sa room Socket.io personnelle (`roomUtilisateur(d.id)`, mécanisme détaillé au Volume 12) — persistance et temps réel dans le même passage, jamais l'un sans l'autre.

`initNotificationService()` connecte ce service au bus d'événements interne (`lib/events.ts`) au démarrage du serveur (déjà entrevu au Volume 8, étape `initNotificationService()` de `index.ts`) — chaque route métier qui appelle `busEvenements.emettreEvenement(...)` (Stocks, Fournisseurs, Production, Commandes...) déclenche ainsi `publierEvenement` de façon découplée, sans jamais importer directement ce service.

## 3. `routes/notifications.ts` — consultation côté client

Routeur court (71 lignes) : `GET /` renvoie l'historique de l'utilisateur connecté (plafonné, `limit` entre 1 et 200) accompagné du compteur de non-lues — c'est le mécanisme de **rattrapage** après une déconnexion, complémentaire du flux temps réel (qui, par nature, ne livre rien à un client hors ligne). `POST /:id/lu` marque une notification comme lue, avec un filtre `destinataireId: req.utilisateur!.id` qui garantit implicitement qu'un utilisateur ne peut marquer comme lues que **ses propres** notifications (`count === 0` → `404` si l'ID appartient à quelqu'un d'autre, sans jamais confirmer son existence à un tiers). `POST /lu` marque tout comme lu en un appel.

## 4. État système et sauvegardes — quatre services, une orchestration claire

`etat-systeme.ts` est gardé par `requirePermission("EQUIPE", "ECRITURE")` **pour la route entière** — cohérent avec la spec (3.15, « Admin uniquement »), les deux niveaux d'Admin ayant l'écriture sur `EQUIPE` (Volume 11d). Les **actions** de sauvegarde/réinitialisation, en revanche, vérifient en plus `req.utilisateur!.estAdminPrincipal` route par route — l'Admin secondaire peut lire l'écran (statut, historique) mais pas déclencher d'action, exactement la nuance de la spec (« Principal en écriture pour les actions, secondaire en lecture »).

### 4.1 `services/sauvegarde.ts` — le dump

`construireDump()` lance `pg_dump` en sous-processus (`spawn`, pas `exec` — évite d'interpoler la commande dans un shell) et **stream** le résultat en mémoire (`Buffer.concat` des morceaux `stdout`), sans jamais écrire de fichier temporaire sur disque. Un point de sécurité explicitement commenté et vérifié dans le code : **le mot de passe ne transite jamais en argument de ligne de commande** (visible via `ps aux` sur un serveur partagé) — il part uniquement par la variable d'environnement `PGPASSWORD` du sous-processus. `coordonneesBase()` extrait hôte/port/nom de `DATABASE_URL` **sans jamais renvoyer les identifiants** — c'est ce que l'écran État système affiche (spec 3.15 : « jamais les identifiants/mot de passe »).

### 4.2 `services/sauvegardeLocale.ts` — stockage disque avec rétention glissante

Écrit le dump sur le disque du serveur (répertoire résolu depuis l'emplacement du fichier source, pas `process.cwd()` — même convention que la résolution du logo des PDF, Volume 11z-2), puis purge automatiquement les fichiers au-delà de `RETENTION` (14 par défaut, triés par nom horodaté — pas de `stat()` individuel nécessaire). Le commentaire du fichier documente explicitement la **décision** relatée par la spec (3.15) : l'envoi vers Google Drive a été abandonné (limitation de quota des comptes de service Google Cloud), remplacé par ce stockage local — avec un avertissement explicite que ce disque n'est pas garanti persistant sur certains hébergeurs (Render, offre gratuite). `lireSauvegardeLocale` se protège d'une traversée de chemin (`../`) même si le nom de fichier vient toujours de la base, jamais directement de l'utilisateur — défense en profondeur plutôt que confiance aveugle en l'appelant.

### 4.3 `services/planificateurSauvegarde.ts` — node-cron dans le process API

`initPlanificateurSauvegarde()` programme `executerSauvegardeAutomatique` quotidiennement (02h30 Kinshasa par défaut, configurable via `BACKUP_CRON`/`BACKUP_TIMEZONE`), avec `noOverlap: true` — si un dump prend anormalement longtemps, l'échéance suivante ne se superpose pas. Chaque tentative, réussie ou non, est journalisée dans `SauvegardeBase` (`journaliserEchec` capture même le cas où la journalisation elle-même échouerait, sans jamais faire tomber le process). `prochaineSauvegarde()` est **calculée depuis l'expression cron à la demande** (`tache.getNextRun()`), jamais stockée — évite toute dérive entre la planification réelle et ce qui est affiché.

### 4.4 `services/reinitialisation.ts` — irréversible, avec filet de sûreté obligatoire

`reinitialiserBase(raison)` suit trois étapes strictement séquentielles : (1) `construireDump()` — si elle échoue, tout s'arrête immédiatement, **rien n'est effacé** ; (2) `ecrireSauvegardeLocale` — même règle, un échec d'écriture annule la réinitialisation ; (3) seulement alors, une longue liste de `deleteMany`/`updateMany` dans une **unique transaction Prisma**, dans l'ordre dicté par les contraintes de clé étrangère (enfants avant parents — Assistant, puis comptes-dépendant, Travailleurs, Commandes clients, Fournisseurs, Stocks, Production, Caisse, et enfin les comptes `Utilisateur` eux-mêmes, référencés par presque tout ce qui précède). Le catalogue `MatierePremiere` n'est pas supprimé, seul son `quantiteStock` est remis à 0 (`updateMany`) — conserver le catalogue évite de casser la décrémentation automatique de Production au prochain démarrage. Note technique : `deleteMany`/`updateMany` ne passent **pas** par l'extension d'audit (Volume 11g), qui n'intercepte que les opérations unitaires `update`/`delete` — sans conséquence ici puisque `AuditLog` lui-même fait partie des tables vidées dans la même transaction.

Côté route (`POST /reinitialiser`), une fois la base vidée, le serveur émet directement `sessionInvalidee` sur **tous** les sockets connectés et les déconnecte (`io.disconnectSockets(true)`) — les comptes venant de disparaître, chaque session ouverte doit l'apprendre immédiatement plutôt qu'à sa prochaine requête, réutilisant le même événement que la déconnexion de session unique (Volume 11c).

## 5. `routes/parametres.ts` — informations boutique et langue par défaut

Fichier court (63 lignes), gardé en lecture **et** en écriture par `PARAMETRES` — contrairement au catalogue Produits ou à Équipe, le commentaire du code souligne explicitement que le DG n'a **aucun** accès à ce module précis, l'exception habituelle de lecture pour le DG ne s'étend pas ici. `chargerParametres()` lit quatre clés génériques (`lireParametre`/`ecrireParametre`, `lib/parametres.ts`) — le nom, l'adresse et le contact de la boutique, plus la langue par défaut (avec repli sur `LANGUE_DEFAUT_PAR_DEFAUT` si la valeur stockée n'est pas dans la liste `LANGUES` valide, protection contre une valeur orpheline en base). Ces trois premiers champs sont **partagés avec l'écran À propos** (section 3.12, futur chapitre 11z-5) — pas une copie séparée, confirmé par le commentaire du frontend qui invalide les deux clés de requête ensemble après enregistrement.

## 6. `routes/premierLancement.ts` — l'assistant en 4 étapes

Ce routeur n'est **jamais protégé par `requireAuth`** — impossible, puisqu'aucun compte n'existe encore au moment où il est utilisé (section 3.7 : « quand la base ne contient aucun compte Utilisateur »). À la place, chaque route revérifie elle-même `exigerBaseVide()` (`prisma.utilisateur.count() === 0`, sinon `409`) — le routeur « se referme de lui-même » dès qu'un premier compte existe, sans middleware dédié.

Les 4 étapes, dans l'ordre imposé par l'UI :

1. `POST /travailleur` — crée la fiche Travailleur du futur Admin Principal (mêmes champs qu'une fiche normale, Volume 11k-1).
2. `POST /travailleur/:id/email-pro` — délègue à `declencherEmailPro` (`services/emailPro.ts`, futur chapitre) exactement le même mécanisme que sur une fiche Travailleur ordinaire.
3. `POST /travailleur/:id/email-pro/verifier` — revérifie l'état côté Cloudflare (la vérification finale reste hors du contrôle de l'app, comme documenté au Volume 5).
4. `POST /finaliser` — une fois l'email pro `ACTIF`, crée le compte `Utilisateur` (rôle Administrateur, `estAdminPrincipal: true`) dans une transaction qui lie aussi la fiche Travailleur au compte créé. **Aucun jeton n'est renvoyé** ici (contrairement à `POST /login`) — le frontend enchaîne volontairement avec un login normal, pour ne jamais dupliquer la logique de connexion à deux endroits.

## 7. Frontend

- **`EtatSystemePage`** (577 lignes) : `refetchInterval: 15000` pour garder l'état à jour sans action utilisateur, boutons de sauvegarde/réinitialisation visibles **uniquement** si `estAdminPrincipal` côté client — rappel explicite dans le code que « le serveur revérifie : masquer les boutons ne protège rien » (cohérent avec la distinction confort d'affichage/sécurité réelle du Volume 10). Le téléchargement de sauvegarde (manuelle ou locale) réutilise le même motif `fetch` direct + `Authorization` manuel déjà rencontré pour le PDF du Bon de livraison (Volume 11z-2), pour la même raison (réponse binaire). Le dialogue de réinitialisation désactive le bouton de confirmation tant que le texte saisi ne correspond pas **exactement** à `MOT_CONFIRMATION_REINITIALISATION` — implémentation directe de la spec (« saisie d'un mot précis... pas un simple clic »).
- **`ParametresPage`** : deux sections indépendantes (Qualités/`TypeClient`, réglages boutique) partageant le même écran. **Observation de qualité de code signalée (pas un écart spec/code)** : `sauverQualite` (modification de prix/commission d'une Qualité) passe côté serveur par `traiterActionCritique("MODIFIER_TYPE_CLIENT", ...)` — exactement le même mécanisme qu'`Equipe.tsx` (Volume 11d), qui distingue explicitement, via une fonction dédiée `messageApprobation`, une exécution immédiate (Admin Principal) d'une mise en attente d'approbation (Admin secondaire). `ParametresPage` n'a **pas** cette distinction : la mutation `onSuccess` ferme simplement le dialogue dans les deux cas, sans jamais afficher à l'Admin secondaire que sa modification de Qualité est en réalité en attente de validation par le Principal. Signalé comme incohérence d'expérience entre deux écrans qui utilisent le même mécanisme serveur, sans effet sur la sécurité (l'action est correctement mise en attente côté serveur, seul le retour visuel diffère).
- **`PremierLancementPage`** : écran plein cadre (pas dans la coquille `Layout`, cohérent avec `App.tsx`, Volume 8), réutilise `PanneauEmailPro` (composant partagé avec la fiche Travailleur normale) via un `basePath` paramétrable (`/api/premier-lancement/travailleur` au lieu de `/api/travailleurs`) — un seul composant, deux routeurs API différents selon le contexte.
- **`NotificationBell`** : chargé en lazy depuis `Layout` (le composant embarque `framer-motion`, tenu hors du chunk initial — cohérent avec le Volume 9). Consomme `useSocket()` (`lib/socket.tsx`, Volume 12) pour l'état temps réel, délègue l'affichage de la liste à `ActivityFeed` (composant partagé, également renvoyé au Volume 12 car étroitement lié au flux temps réel).

## 8. Croisement avec `docs/spec-boulangerie.md`

- Section 3.10 (notifications temps réel, ciblage hiérarchique) : confirmé par `rolesDestinataires`/`rolesAvecLecture`. Aucun écart.
- Section 3.15 (État système, sauvegardes locales avec rétention, réinitialisation avec confirmation par mot exact et sauvegarde de sûreté préalable obligatoire) : confirmé intégralement, y compris la décision documentée d'abandon de Google Drive. Aucun écart.
- Section 3.9 (Paramètres, écriture Administrateur, langue par défaut) : confirmé. Aucun écart.
- Section 3.7 (Assistant de premier lancement, 4 étapes, aucune connexion possible avant la fin) : confirmé. Aucun écart.

Aucun écart spec/code trouvé dans ce chapitre — une seule observation de cohérence d'expérience utilisateur (`ParametresPage`, §7).

## 9. Erreurs fréquentes et cas limites

- **Sauvegarde de sûreté impossible avant réinitialisation** (pg_dump absent, base injoignable) : la réinitialisation entière est annulée, aucune donnée n'est effacée.
- **Fichier de sauvegarde locale disparu entre-temps** (redéploiement, purge de rétention) : `404` explicite distinguant ce cas d'une absence totale de sauvegarde.
- **Marquer comme lue une notification d'un autre utilisateur** : `404` silencieux (ne confirme ni l'existence ni l'appartenance à un tiers).
- **Tentative d'action de sauvegarde par un Admin secondaire** : `403` explicite côté serveur, même si l'UI masque déjà les boutons.
- **Modification de Qualité (prix/commission) par un Admin secondaire** : correctement mise en attente d'approbation côté serveur, mais sans retour visuel distinct côté `ParametresPage` (voir §7).

## 10. Résumé

Ce chapitre referme la boucle du système de notifications amorcée dès le Volume 11f (Approbations) : `rolesDestinataires` est la pièce qui transforme la matrice de permissions déjà expliquée en règle de routage temps réel, réutilisée sans variation par tous les modules émetteurs d'événements rencontrés jusqu'ici. Le sous-système de sauvegarde illustre une discipline stricte de séquencement (jamais d'effacement sans confirmation qu'une copie de sûreté existe déjà), et l'Assistant de premier lancement montre comment un parcours public par nécessité peut rester sûr sans middleware d'authentification, par revérification systématique de son unique précondition.

---

**Suite →** Volume 11z-5 — À propos, Assistant (IA), Export et Rapports, dernier sous-chapitre du reste du Niveau 2 avant le Volume 12 (Socket.io et communications réseau).
