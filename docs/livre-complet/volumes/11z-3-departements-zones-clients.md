# Volume 11z-3 — Départements/Groupes, Zones de dépôt et Clients

**Niveau de risque : 2 — Fonctionnel standard.** Trois modules courts, tous **purement organisationnels** (aucune permission propre, gouvernés par le module métier auquel ils sont rattachés) — regroupés dans un même chapitre car ils partagent la même nature et sont référencés depuis les chapitres déjà couverts (Travailleurs, 11k ; Production, 11z-2 ; Commandes, 11h).

## 1. Ce que couvre ce chapitre

- `apps/api/src/routes/departements.ts` (`departementsRouter`, `groupesRouter`)
- `apps/api/src/routes/zones-depositaires.ts` (gestion complète — la lecture avait déjà été entrevue côté consommation au Volume 11z-2)
- `apps/api/src/routes/clients.ts` (`clientsRouter`, `typeClientsRouter`)
- `apps/web/src/components/DepartementsCard.tsx`, `apps/web/src/components/ZonesDepositaireCard.tsx`, `apps/web/src/components/DialogNouvelleZone.tsx`
- `apps/web/src/pages/Clients.tsx`

## 2. Un principe transversal : « purement organisationnel »

Les trois modules partagent une caractéristique explicitement énoncée par la spécification à chaque fois : ils n'ont **aucune permission propre**. Leur écriture est gouvernée par le module métier qui les héberge :

| Module | Gouverné par | Justification (spec) |
|---|---|---|
| Départements/Groupes (3.18) | `TRAVAILLEURS` (écriture) | Rattaché au roster du personnel — pas de droits particuliers pour un chef de département |
| Zones de dépôt (3.3 d) | `COMMANDES` **OU** `PRODUCTION` (écriture) | Gérables depuis deux écrans distincts (fiche Client, carte Production) |
| Clients (3.4) | `COMMANDES` (écriture), Qualités (`TypeClient`) sous `PARAMETRES` (écriture) | La fiche Client est un sous-module de Commandes ; la Qualité (prix/commission) est une donnée de Paramètres |

## 3. Départements & Groupes (`departements.ts`)

Deux routeurs exportés depuis le même fichier — `departementsRouter` (monté sur `/api/departements`) et `groupesRouter` (monté séparément sur `/api/groupes`, car un groupe se modifie/supprime par son propre ID, sans besoin de connaître son département parent dans l'URL).

Le point technique le plus intéressant est la règle de désignation du chef, qui **diffère entre création et modification** :

- **À la création** (`POST /`) : le département naissant n'a encore aucun membre. Si un `chefTravailleurId` est fourni, ce travailleur est automatiquement **rattaché** au département en même temps qu'il en devient le chef — sinon la contrainte « le chef doit être membre du département » serait impossible à satisfaire au tout premier enregistrement.
- **En modification** (`PUT /:id`) : le département a déjà des membres potentiels ; le chef ne peut alors être choisi **que parmi les Travailleurs déjà membres** de ce département précis (`chef.departementId !== existant.id` → `400`). Pas d'auto-rattachement ici, contrairement à la création.

La suppression d'un département fait tomber en cascade ses Groupes (`onDelete: Cascade` en base, Volume 13) ; les Travailleurs qui y étaient rattachés voient leur `departementId`/`groupeId` remis à `null` (`onDelete: SetNull`) — la fiche du travailleur subsiste intégralement, seul le lien organisationnel tombe. Un groupe est un simple sous-ensemble nommé d'un département, avec une contrainte d'unicité de nom **par département** (deux départements différents peuvent chacun avoir un groupe « Groupe 1 »).

Confirmé par la spec (3.18) : « chaque Travailleur est rattaché à un Département... qui a un chef désigné (un Travailleur, simple référence, **pas de droits particuliers dans l'app**) » — aucune route ne donne au chef de département une capacité d'action distincte (ex. décider d'une absence, section 3.18 également, reste réservé à l'Admin secondaire/Principal, jamais au chef). Aucun écart.

## 4. Zones de dépôt (`zones-depositaires.ts`) — le middleware `ecritureZones`

Fichier court (101 lignes) mais porteur d'un choix technique déjà **entrevu côté client** au Volume 11z-2 (`ZonesDepositaireCard editable={peutEcrire("COMMANDES") || peutEcrire("PRODUCTION")}`) et maintenant vérifié côté serveur :

```ts
function ecritureZones(req: Request, res: Response, next: NextFunction) {
  const permissions = req.utilisateur?.role.permissions ?? [];
  if (aAcces(permissions, "COMMANDES", "ECRITURE") || aAcces(permissions, "PRODUCTION", "ECRITURE")) {
    return next();
  }
  return res.status(403).json({ erreur: "Accès refusé : écriture requise sur le module Commandes ou Production" });
}
```

C'est un **deuxième middleware Express personnalisé** du projet, en plus de `requireAuth`/`requirePermission` (`middleware/auth.ts`, Volume 11b) — celui-ci défini directement dans le fichier de routes plutôt que dans le dossier `middleware/`, ce qui explique pourquoi il n'avait pas été signalé au Volume 7 (qui décrivait le contenu du dossier `middleware/`, pas l'ensemble des fonctions middleware du projet). Il réutilise directement `aAcces` (`packages/shared/src/index.ts`, Volume 11a) plutôt que `requirePermission`, car ce dernier ne sait vérifier qu'**un seul** module à la fois — ici il en faut un **des deux**. Le commentaire du code explique la raison métier de ce choix, corrigée après un premier découpage plus restrictif (« écriture réservée à Commandes seul » rendait la création de zone injoignable pour le Responsable de production, qui n'a aucun accès Commandes) — cohérent avec la spec (3.3 d), qui documente elle-même cette correction de conception.

Le reste du fichier est un CRUD classique : lecture ouverte à tout utilisateur authentifié (donnée de référence, comme `Produit` ou `TypeClient`), nom unique, suppression qui ne bloque jamais (`onDelete: SetNull` sur `Client.zoneDepositaireId` — un client rattaché à la zone supprimée retombe simplement sans zone), avec toutefois un filet de sécurité applicatif (`catch` sur le code d'erreur Prisma `P2003`, contrainte de clé étrangère) au cas où la base refuserait malgré tout la suppression.

## 5. Clients et Qualités (`clients.ts`)

Deux routeurs distincts pour deux natures de données différentes :

- **`typeClientsRouter`** (Qualités — Dépositaire, Maman, Vente cash...) : lecture ouverte à tout utilisateur authentifié, écriture réservée à `PARAMETRES` (Admin uniquement, cohérent avec 3.9 et déjà vérifié au Volume 11z-1). Modifier le prix ou la commission d'une Qualité passe par `traiterActionCritique("MODIFIER_TYPE_CLIENT", ...)` — troisième occurrence concrète du mécanisme du Volume 11f (après `roles.ts` et `produits.ts`), avec la même nuance déjà documentée : cela n'affecte **que les commandes futures**, les commandes déjà enregistrées ayant figé leur `montantBrut` à la création (rappel direct du Volume 11h). Suppression bloquée si des clients utilisent encore cette Qualité.
- **`clientsRouter`** : CRUD classique sous permission `COMMANDES`, avec deux vérifications d'existence référentielle à la création/modification (`typeClientId` et `zoneDepositaireId` doivent exister, sinon `400`), et suppression bloquée si le client a des commandes enregistrées (l'historique de commandes ne doit jamais devenir orphelin — même garde-fou que matières premières, fournisseurs et travailleurs vus aux chapitres précédents).

Note de cohérence transversale : ce fichier confirme, en le retrouvant tel quel, le DTO `ClientDTO` déjà utilisé (sans être expliqué en détail) dans le chapitre Commandes (11h) — `avanceDisponible`, `typeClient` imbriqué, `zoneDepositaireNom`. Rien de nouveau à ce niveau, la boucle se referme simplement.

### 5.1 Signalement des clients inactifs (suivi commercial, section 3.5, Lot 7 pt 5)

`GET /` calcule, pour chaque client, `derniereCommandeLe` (date de la commande la plus récente, `prisma.commandeClient.groupBy({ by: ["clientId"], _max: { dateCreation: true } })`, agrégée en parallèle de la liste des clients) puis en dérive `joursDepuisDerniereCommande` via une fonction interne du même nom (`apps/api/src/routes/clients.ts`, lignes 24-33) : `null` si le client n'a jamais commandé, sinon le nombre de **jours Lomoto** entiers écoulés depuis (`bornesJourLomoto`/`jourLomoto`, `apps/api/src/lib/temps.ts` — même notion de « jour civil » que l'alerte dette de commandes.ts, pas un simple écart de millisecondes). Ces deux champs rejoignent `ClientDTO` (`packages/shared/src/index.ts`).

La fonction pure `estClientInactif(joursDepuisDerniereCommande, seuilJours)` (`packages/shared/src/index.ts`) — `joursDepuisDerniereCommande === null || joursDepuisDerniereCommande >= seuilJours` — encode la règle métier : un client est inactif s'il n'a **jamais** commandé, ou si sa dernière commande date d'au moins `seuilJours` jours. Le seuil lui-même (`SEUIL_INACTIF_JOURS = 30`) est défini côté client uniquement, dans `apps/web/src/pages/Clients.tsx` — pas transmis par le serveur, pas de champ Paramètres dédié : `estClientInactif` reste une fonction pure paramétrable, `ClientsPage` lui fournit simplement `30`. `ClientsPage` en fait deux usages : une case à cocher « n'afficher que les clients inactifs » (filtre en mémoire sur la liste déjà chargée, `seulementInactifs`) et un badge visuel sur chaque ligne de client inactif (affichant soit « jamais commandé », soit le nombre de jours écoulés). La spec (3.5) écarte explicitement la création d'un nouveau modèle « prospect » pour ce besoin — c'est une simple lecture des commandes déjà existantes, aucune donnée nouvelle stockée en base.

## 6. Frontend

- **`DepartementsCard`** : montée sur la page Travailleurs (Volume 11k), reçoit la liste des travailleurs déjà chargée par la page parente en `props` plutôt que de la requêter elle-même — évite une requête HTTP redondante puisque `TravailleursPage` a déjà cette donnée. Le sélecteur de chef, en édition, est filtré côté client sur `travailleurs.filter((tr) => tr.departement?.id === departementEditee.id)` — reflet direct de la règle serveur « chef choisi parmi les membres déjà rattachés ».
- **`ZonesDepositaireCard`** : montée sur la page Production (Volume 11z-2), reçoit sa permission déjà résolue en `props` (`editable`) plutôt que de recalculer elle-même `peutEcrire("COMMANDES") || peutEcrire("PRODUCTION")` — cette logique vit dans le composant parent.
- **`DialogNouvelleZone`** : composant réutilisable de création rapide (pas de renommage ni suppression, ces opérations restent sur `ZonesDepositaireCard`), monté depuis `ClientsPage` — c'est le point d'entrée concret de l'amélioration proactive documentée dans la spec (3.3 d) : le Chargé des commandes peut créer une zone sans quitter la fiche client, sans avoir besoin d'un accès au module Production.
- **`ClientsPage`** : recherche par nom filtrée côté client (`useMemo`), champ Zone de dépôt affiché **conditionnellement** dans le formulaire (`qualiteClientEstDepositaire`, dérivé du nom de la Qualité sélectionnée — pas d'un champ dédié en base, donc recalculé à chaque changement de sélection), avec une nuance de nettoyage de données bien commentée dans le code : en édition, changer la Qualité vers une valeur non-Dépositaire doit **explicitement** effacer la zone (`null`), alors qu'à la création, l'omettre suffit (`undefined`, le champ est simplement absent du corps de la requête). La case à cocher « clients inactifs » (§5.1) combine son filtre avec la recherche par nom dans le même `useMemo` — les deux filtres sont cumulatifs, pas exclusifs.

## 7. Croisement avec `docs/spec-boulangerie.md`

- Section 3.18 (Départements & Groupes, « purement organisationnel, aucune permission associée ») : confirmé — gouverné par `TRAVAILLEURS`, chef sans droits particuliers. Aucun écart.
- Section 3.3 d (Zones de dépôt, écriture Commandes OU Production, « l'un des deux suffit », correction de conception documentée) : confirmé par le middleware `ecritureZones`. Aucun écart.
- Section 3.4 (Clients, Qualités avec prix/commission par bac, effet uniquement sur les commandes futures) : confirmé, avec `MODIFIER_TYPE_CLIENT` comme tâche critique. Aucun écart.
- Section 3.5 (Clients inactifs, Lot 7 pt 5 — date de dernière commande ou « Jamais commandé », case à cocher pour ne lister que les clients sans commande depuis 30 jours ou plus, aucun nouveau modèle ni concept de « prospect ») : confirmé exactement par `joursDepuisDerniereCommande`/`estClientInactif`/`SEUIL_INACTIF_JOURS` (§5.1). Aucun écart.

Aucun écart spec/code trouvé dans ce chapitre.

## 8. Erreurs fréquentes et cas limites

- **Désigner un chef non-membre à la modification d'un département** : rejeté (`400`), contrairement à la création où le rattachement est automatique.
- **Deux groupes de même nom dans le même département** : rejetés (`409`) ; le même nom dans deux départements différents est parfaitement valide.
- **Tentative de gérer une zone sans écriture Commandes ni Production** : `403` explicite, distinct du `403` générique de `requirePermission` (message dédié précisant les deux modules alternatifs).
- **Suppression d'une Qualité ou d'un client encore référencé** : bloquée par `409`, jamais par une erreur de contrainte de base brute renvoyée telle quelle à l'utilisateur.
- **Client n'ayant jamais passé de commande** : `derniereCommandeLe` et `joursDepuisDerniereCommande` valent `null` ; `estClientInactif` le considère malgré tout inactif (`=== null` fait partie de la condition), il apparaît donc dans le filtre « clients inactifs » avec l'étiquette « jamais commandé ».

## 9. Résumé

Trois modules de données de référence, tous soumis à la même discipline : aucun n'invente sa propre logique de permission ad hoc — ils empruntent celle d'un module métier existant (`TRAVAILLEURS`, `COMMANDES`/`PRODUCTION`, `PARAMETRES`), avec un seul middleware personnalisé nécessaire (`ecritureZones`) pour le cas où deux modules alternatifs peuvent suffire. La règle de désignation du chef de département, dépendante du contexte création/modification, est la seule pièce de logique métier non triviale du lot — le reste est du CRUD protégé par des garde-fous d'intégrité référentielle déjà rencontrés à plusieurs reprises dans les chapitres précédents.

---

**Suite →** Volume 11z-4 — Notifications, État système, Paramètres (informations boutique) et Premier lancement.
