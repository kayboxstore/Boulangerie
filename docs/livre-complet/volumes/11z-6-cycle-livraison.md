# Volume 11z-6 — Cycle de livraison (C4)

**Niveau de risque : 1 — Critique.** Chapitre entièrement nouveau, ajouté le 19/08/2026. Ce module n'existait pas encore au moment où le reste de ce livre a été rédigé (juillet-août 2026) : il a été codé après coup (vague C4, mi-août), et le cahier des charges lui-même ne le documentait dans aucune section jusqu'à ce qu'une section dédiée (3.3 f) y soit ajoutée le même jour que ce chapitre. Il justifie un Niveau 1 malgré son statut de « module ajouté après coup » : il enveloppe le Schéma de commande (Volume 11z-2) d'un suivi du trajet réel du camion jusqu'à la confirmation de ce qui a été accepté chez le client, **convertit automatiquement cette acceptation en une vraie `CommandeClient`** (donc en argent réel, dette et commission), et trace explicitement une catégorie d'anomalie financière — le cash transporté non reçu.

## Fiche d'identité des fichiers couverts

| Fichier | Lignes | Rôle |
|---|---:|---|
| `apps/api/src/routes/cycles-livraison.ts` | 676 | Les 4 routes du module : liste/détail, transitions, retour du bon physique, anomalies |
| `apps/api/src/services/cyclesLivraison.ts` | 316 | Logique pure : machine à états, calculs de résultat d'acceptation, permission par action |
| `packages/shared/src/cyclesLivraison.ts` | 200 | Vocabulaire partagé (statuts, actions, types d'anomalie), schémas Zod des transitions, DTO |
| `apps/web/src/pages/BonsLivraison.tsx` | 660 | Écran Production : intègre les 6 étapes de production/transport du cycle (`EtapesCycleLivraison`, `DialogActionCycle`), en plus de son rôle propre (Volume 11z-2) |
| `apps/web/src/pages/AcceptationsLivraison.tsx` | 168 | Écran Commandes dédié à la 7ᵉ et dernière action (`CONFIRMER_ACCEPTATION`) — sous-module de Commandes, comme `/production/bons-livraison` est un sous-module de Production |
| `apps/web/src/components/previsions/cycleLivraisonLogique.ts` | 145 | Libellés/descriptions/couleurs de badge par statut (fonctions pures, testées) |
| `apps/web/src/components/previsions/EtapesCycleLivraison.tsx` | 185 | Composant « stepper » visuel des 7 étapes nominales |
| `apps/web/src/components/previsions/DialogActionCycle.tsx` | 221 | Dialogue de saisie des 6 transitions de production/transport (toutes sauf l'acceptation) |
| `apps/web/src/components/previsions/DialogAcceptationCycle.tsx` | ~140 | Dialogue de la 7ᵉ transition, `CONFIRMER_ACCEPTATION` — premier usage historique de l'idempotence côté client (`apps/web/src/lib/idempotence.ts`), généralisée depuis à 5 autres mutations financières (Volume 11j §5.2) |

- **Qui les appelle** : `cyclesLivraisonRouter` est monté sur `/api/production` dans `app.ts` (ses routes vivent donc sous `/api/production/cycles-livraison/...`, pas `/api/cycles-livraison`) ; consommé par deux écrans distincts, chacun réservé à une portion du cycle de vie.
- **Ce qu'ils appellent** : `calculerCommande`/`calculerCommission` (Volume 11a) au moment de la conversion en commande ; `executerEcritureIdempotente` (`lib/idempotence.ts`, pas encore couvert par un chapitre dédié — Volume 11j §5.2) pour `CONFIRMER_ACCEPTATION` uniquement ; `bornesJourLomoto` (`lib/temps.ts`, même remarque).
- **Données modifiées** : `CycleLivraison` (créé automatiquement à l'enregistrement d'un Schéma de commande, Volume 11z-2 ; mis à jour à chaque transition), `CycleLivraisonLigne` (une par produit du cycle), `TransitionCycleLivraison` (journal append-only, jamais modifié ni supprimé), `AnomalieCycleLivraison`, et — seulement à `CONFIRMER_ACCEPTATION` en cas d'acceptation au moins partielle — `CommandeClient` et `Client.avanceDisponible`.

## 1. Pourquoi ce module existe — le problème qu'il résout

Avant C4, le Schéma de commande (3.3 d) capturait une **prévision** — ce qu'un Dépositaire ou une Maman a commandé pour le lendemain — sans aucun suivi de ce qui se passe **ensuite** : est-ce que la production a effectivement retenu ces quantités ? Le camion est-il parti ? Le client a-t-il réellement accepté tout ce qui lui a été déposé, ou une partie est-elle revenue invendue ? Et surtout — l'argent collecté sur la tournée est-il bien revenu à la Caisse ? Le Bon de livraison (3.3 e) capture, lui, ce qui a été livré, mais **volontairement indépendant** du Schéma (aucune alimentation automatique dans un sens ni dans l'autre, Volume 11z-2) — il ne referme donc pas ce suivi non plus.

Le Cycle de livraison comble cet espace : il **enveloppe** le Schéma de commande d'un identifiant stable et d'un journal append-only des transitions, sans jamais dupliquer la prévision elle-même (le commentaire du code le dit explicitement : *« C4 enveloppe le SchemaCommande existant : le cycle ne duplique jamais la prévision, il lui apporte seulement l'identifiant stable, les quantités aval et le journal des transitions »*).

## 2. Les 11 statuts et les 7 actions

```ts
export const STATUTS_CYCLE_LIVRAISON = [
  "PREVISION", "RETENUE_PRODUCTION", "PREPAREE", "REMISE_MAGASIN", "CHARGEE",
  "EN_TOURNEE", "EN_ATTENTE_CONFIRMATION", "PARTIELLEMENT_ACCEPTEE", "ACCEPTEE",
  "RETOUR_TOTAL", "ANNULEE",
] as const;

export const ACTIONS_CYCLE_LIVRAISON = [
  "RETENIR_PRODUCTION", "CONFIRMER_PREPARATION", "CONFIRMER_REMISE_MAGASIN",
  "CONFIRMER_CHARGEMENT", "CONFIRMER_DEPART", "SIGNALER_DEPOT", "CONFIRMER_ACCEPTATION",
] as const;
```

Le chemin nominal, un statut par action, dans l'ordre exact où `apps/api/src/services/cyclesLivraison.ts` les enchaîne (`TRANSITIONS_ATTENDUES`/`TRANSITIONS_SUIVANTES`) :

```
PREVISION
  → RETENIR_PRODUCTION        → RETENUE_PRODUCTION
  → CONFIRMER_PREPARATION     → PREPAREE
  → CONFIRMER_REMISE_MAGASIN  → REMISE_MAGASIN
  → CONFIRMER_CHARGEMENT      → CHARGEE
  → CONFIRMER_DEPART          → EN_TOURNEE
  → SIGNALER_DEPOT            → EN_ATTENTE_CONFIRMATION
  → CONFIRMER_ACCEPTATION     → ACCEPTEE | PARTIELLEMENT_ACCEPTEE | RETOUR_TOTAL
```

La 7ᵉ action est différente des 6 précédentes : elle ne mène pas vers un unique statut suivant fixe, mais vers l'un de trois statuts terminaux, déterminés par le résultat réellement saisi (§4). Un `CycleLivraison` naît toujours en `PREVISION` — créé automatiquement, jamais explicitement, au moment où un Schéma de commande est enregistré pour ce client et cette date (Volume 11z-2, service `sauvegarderSchemaJour`) — et y reste tant qu'aucune action de production ne l'a fait avancer.

**Le onzième statut, `ANNULEE`, n'est relié à aucune action.** Recherche exhaustive dans `apps/api/src/routes/cycles-livraison.ts` et `services/cyclesLivraison.ts` : aucune route, aucune fonction ne produit ce statut. Il existe dans l'énumération Prisma et dans le vocabulaire partagé, mais rien dans le code actuel ne permet de l'atteindre — une possibilité réservée pour une décision métier future (annuler un cycle en cours de trajet, par exemple), pas un statut mort par erreur : le reste du code (tables de transition, `determinerStatutAcceptation`) est cohérent et complet sans lui.

## 3. Verrou optimiste — le même idiome que la clôture de caisse (Volume 11j)

```ts
async function reclamerVersion(tx, cycle, input, statut, donnees = {}) {
  const resultat = await tx.cycleLivraison.updateMany({
    where: { id: cycle.id, version: input.version, statut: cycle.statut },
    data: { ...donnees, statut, version: { increment: 1 } },
  });
  if (resultat.count === 1) return;
  // ... sinon, relit la version courante et lève VERSION_OBSOLETE (409)
}
```

Chaque transition — sans exception, y compris `CONFIRMER_ACCEPTATION` — exige la **version courante** du cycle dans son corps de requête, et l'écriture elle-même est un `updateMany` filtré sur `{ id, version, statut }`, jamais un `update` inconditionnel par identifiant. Si `resultat.count !== 1`, c'est qu'une autre transition a gagné la course entre la lecture et l'écriture : le client reçoit `VERSION_OBSOLETE` (409) avec la version réellement en base, plutôt qu'une écrasement silencieux. **C'est cet idiome précis** — filtrer l'écriture elle-même sur l'état attendu, pas seulement le vérifier après une lecture séparée — qui a servi de modèle à la correction du 19/08/2026 sur la clôture de session de caisse (Volume 11j §5.14) : ce module l'appliquait déjà systématiquement, il manquait simplement à `caisse.ts` avant cette date.

Deux autres routes du fichier (`bon-retourne`, `anomalies`) reprennent le même filtre `{ id, version }` sur leurs propres `updateMany`, pour la même raison : un cycle peut recevoir plusieurs écritures concurrentes (une transition, un signalement d'anomalie) et chacune doit se protéger indépendamment.

## 4. `CONFIRMER_ACCEPTATION` — l'action qui convertit une livraison en argent réel

C'est la seule des 7 actions qui (a) exige l'écriture sur **Commandes** plutôt que sur Production, (b) exige l'en-tête `Idempotency-Key` (`lib/idempotence.ts`, seul autre usage documenté dans ce livre au Volume 12), et (c) peut créer une `CommandeClient`.

```ts
export function determinerStatutAcceptation(totalAccepte: number, totalDepose: number): StatutCycleLivraison {
  if (totalAccepte === 0) return "RETOUR_TOTAL";
  return totalAccepte === totalDepose ? "ACCEPTEE" : "PARTIELLEMENT_ACCEPTEE";
}
```

Le Chargé des commandes saisit, produit par produit, ce qui a été **accepté** et ce qui est **retourné** — la somme des deux ne pouvant jamais dépasser ce qui a été **déposé** (`validerResultatAcceptation`, 400 sinon). Le statut final dérive uniquement du total accepté comparé au total déposé : rien accepté → `RETOUR_TOTAL` (aucune commande créée) ; tout accepté → `ACCEPTEE` ; un résultat intermédiaire → `PARTIELLEMENT_ACCEPTEE`. Dans les deux derniers cas (`totalAccepte > 0`), la route :

1. Vérifie qu'aucune `CommandeClient` n'existe déjà pour ce client à cette date opérationnelle (`COMMANDE_JOUR_EXISTANTE`, 409) — la même contrainte « une commande par client par jour » que pour une commande saisie manuellement (Volume 11h), le cycle ne créant pas d'exception.
2. Appelle `calculerCommande` avec `quantiteBacs = totalAccepte`, `prixParBac` et `avanceExistante` du client — **exactement** la même fonction pure qu'à la création manuelle d'une commande (Volume 11a), et `calculerCommission` pour la commission — figée à la création, comme depuis le Lot 7 pt 6 (Volume 11i).
3. Crée la `CommandeClient` avec `montantRecu: 0` (rien n'a encore été reçu à cet instant — un règlement viendra plus tard par les canaux habituels, Volume 11h/11j) et `dateOperationnelle` = la date du Schéma de commande d'origine (pas la date de la confirmation, potentiellement différente si la confirmation traîne).
4. Relie le cycle à la commande créée (`cycle.commandeId`), ce qui rend `estFacturable: cycle.commande !== null` vrai dans le DTO — un champ que l'écran peut utiliser pour distinguer, dans l'historique, les cycles qui ont réellement généré une commande de ceux restés en simple prévision ou totalement retournés.

**Anomalie automatique** : si `input.bonRetourne` n'est pas vrai au moment de cette transition, le serveur crée **lui-même** une `AnomalieCycleLivraison` de type `BON_NON_RETOURNE` (description fixe : *« Le bon physique n'a pas encore été retourné après la confirmation client »*), sans action explicite de l'utilisateur — le seul cas de ce module où une anomalie naît d'un comportement du serveur plutôt que d'une saisie humaine.

## 5. Anomalies — dont une catégorie explicitement financière

```ts
export const TYPES_ANOMALIE_CYCLE = [
  "BON_NON_RETOURNE", "ECART_QUANTITE", "PRODUIT_ENDOMMAGE",
  "RETOUR_QUALITE", "CASH_TRANSPORTE_NON_RECU", "AUTRE",
] as const;
```

`POST /cycles-livraison/:id/anomalies` accepte n'importe lequel de ces 6 types, à **tout moment** du cycle (pas seulement à l'acceptation), avec une description libre — accessible à quiconque a l'écriture Production **ou** Commandes. `CASH_TRANSPORTE_NON_RECU` est la seule catégorie explicitement financière : elle documente le cas où le camion revient d'une tournée sans que l'argent normalement collecté chez un client (paiement en espèces à la livraison, hors du périmètre de ce livre par ailleurs) n'ait été remis. Une notification temps réel priorité **HAUTE** part vers Production à chaque anomalie créée (`ANOMALIE_LIVRAISON`, ou `BON_NON_RETOURNE` pour ce type précis) — la même priorité que les autres alertes financières du projet (transaction inhabituelle, correction post-clôture de caisse). `POST /cycles-livraison/:id/anomalies/:anomalieId/resoudre` referme une anomalie avec un commentaire de résolution obligatoire ; `POST /cycles-livraison/:id/bon-retourne` résout spécifiquement — et automatiquement — toute anomalie `BON_NON_RETOURNE` encore ouverte sur ce cycle au moment où le bon physique est enfin rapporté.

## 6. Permissions — partagées entre deux modules, pas cantonnées à un seul rôle

```ts
function autoriserLecture(req, res, next) {
  if (aPermission(req, "PRODUCTION", "LECTURE") || aPermission(req, "COMMANDES", "LECTURE")) return next();
  return res.status(403)...;
}
export function peutExecuterActionCycle(permissions, action): boolean {
  return action === "CONFIRMER_ACCEPTATION"
    ? aAcces(permissions, "COMMANDES", "ECRITURE")
    : aAcces(permissions, "PRODUCTION", "ECRITURE");
}
```

Contrairement à la quasi-totalité des autres modules de ce livre, gardés par un seul couple module/niveau, ce module est **délibérément partagé** : la lecture s'ouvre à quiconque a au moins la lecture sur Production **ou** sur Commandes (l'un des deux suffit) ; l'écriture, elle, dépend de l'action précise — les 6 premières exigent l'écriture Production (le Responsable de production fait avancer le cycle physiquement), la 7ᵉ exige l'écriture Commandes (le Chargé des commandes est seul habilité à convertir une acceptation en argent réel). C'est le même principe de garde « au cas par cas selon l'action » déjà rencontré pour les Zones de dépôt (Volume 11z-2, § d) — deux rôles interviennent chacun à leur étape du même objet métier, sans qu'aucun des deux ne le possède entièrement.

## 7. Cas limites

| Situation | Comportement |
|---|---|
| Transition tentée avec une version obsolète (cycle modifié entre-temps) | `409 VERSION_OBSOLETE`, avec la version réellement en base (§3). |
| Transition tentée depuis un statut qui ne l'attend pas (ex. `CONFIRMER_DEPART` sur un cycle encore `PREPAREE`) | `409 TRANSITION_INTERDITE`. |
| `CONFIRMER_ACCEPTATION` sur un cycle déjà relié à une commande | `409 ACCEPTATION_DEJA_CONVERTIE` (distingué de `TRANSITION_INTERDITE` pour un message plus précis). |
| Somme acceptée + retournée dépassant la quantité déposée, pour un produit | `400 DONNEES_INVALIDES` — refusé avant toute écriture (§4). |
| Rien accepté du tout | `RETOUR_TOTAL`, aucune `CommandeClient` créée. |
| Tout accepté, rien retourné | `ACCEPTEE`. |
| Une partie acceptée, une partie retournée | `PARTIELLEMENT_ACCEPTEE` — la commande créée ne porte que la quantité **acceptée**. |
| `CONFIRMER_ACCEPTATION` avec `bonRetourne` resté faux | Transition acceptée quand même ; anomalie `BON_NON_RETOURNE` créée automatiquement par le serveur (§4). |
| Confirmation d'acceptation alors qu'une commande existe déjà pour ce client ce jour-là (saisie manuelle en parallèle, par exemple) | `409 COMMANDE_JOUR_EXISTANTE` — la transition elle-même échoue, le cycle reste `EN_ATTENTE_CONFIRMATION`. |
| Cash transporté non reçu au retour de tournée | Signalé comme une `AnomalieCycleLivraison` de type `CASH_TRANSPORTE_NON_RECU` — purement documentaire au niveau du cycle, ne déclenche aucune écriture financière automatique (aucune dette, aucun ajustement de caisse). |
| Statut `ANNULEE` | Inatteignable par le code actuel (§2) — pas un bug, une possibilité réservée. |

## 8. Croisement avec la spécification

Une section dédiée (3.3 f) a été ajoutée à `docs/spec-boulangerie.md` le 19/08/2026, en même temps que ce chapitre — avant cette date, aucune section de la spec ne mentionnait ce module (recherche exhaustive, zéro résultat, malgré ~1 200 lignes de code applicatif touchant à l'argent transporté). Une fois cette section écrite, la comparaison ne révèle aucun écart entre le texte de la spec et le comportement réel du code : les 11 statuts, le verrou optimiste, la conversion en commande à l'acceptation, les 6 types d'anomalie et les permissions partagées y sont tous décrits fidèlement à ce que fait effectivement `cycles-livraison.ts`. **L'écart n'était donc pas un écart entre la spec et le code, mais une absence pure et simple de la spec sur un module déjà en production** — une distinction volontairement maintenue dans ce livre (voir `README.md` du livre : « le code du dépôt est la vérité sur ce que l'application fait réellement »).

## 9. Résumé

Le Cycle de livraison est le point de jonction le plus dense du projet entre trois modules jusqu'ici traités séparément dans ce livre : Production (qui exécute les 6 premières étapes), Commandes (qui hérite de la commande générée à la 7ᵉ), et implicitement Caisse (par l'anomalie `CASH_TRANSPORTE_NON_RECU`, même si aucune écriture financière automatique n'en découle). Sa rigueur technique — verrou optimiste systématique, validation stricte avant toute écriture, réutilisation exacte de `calculerCommande`/`calculerCommission` plutôt qu'une formule dupliquée — est cohérente avec le reste du code Niveau 1 de ce projet. Son seul vrai défaut, documenté ici plutôt que découvert par un futur lecteur : il a grandi plus vite que la documentation qui devait l'accompagner, aussi bien la spécification métier que ce livre lui-même.

---

**Suite →** Retour à la Table des matières (`TABLE_DES_MATIERES.md`) — ce chapitre referme la mise à jour du livre du 19/08/2026. Les fichiers `apps/api/src/lib/temps.ts` et `apps/api/src/lib/idempotence.ts`, mentionnés à plusieurs reprises dans ce chapitre et au Volume 11j sans y avoir encore leur propre traitement, restent le manque le plus net identifié lors de cette révision (voir `ETAT_DE_PROGRESSION.md`).
