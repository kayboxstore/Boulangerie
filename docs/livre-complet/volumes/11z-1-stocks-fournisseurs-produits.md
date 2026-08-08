# Volume 11z-1 — Stocks, Fournisseurs et Catalogue produits

**Niveau de risque : 2 — Fonctionnel standard.** Premier chapitre du reste du back-end Niveau 2. Traitement complet par fichier et par symbole, sans exemple chiffré bout en bout aussi poussé qu'au Niveau 1 (aucun de ces trois modules ne touche à l'argent d'une commande ou d'une paie), mais sans rien laisser de côté sur la logique métier réelle.

## 1. Ce que couvre ce chapitre

Trois modules étroitement liés, dans l'ordre où ils s'enchaînent réellement dans le métier : on **achète** une matière première à un **fournisseur** (module Fournisseurs), ce qui **augmente le stock** (module Stocks), et on **vend** des produits finis dont le **catalogue** (Produits) est géré depuis Paramètres. Fichiers couverts :

- `apps/api/src/routes/stocks.ts`, `apps/api/src/services/stocks.ts`
- `apps/api/src/routes/fournisseurs.ts`
- `apps/api/src/routes/produits.ts`
- `apps/web/src/pages/Stocks.tsx`, `apps/web/src/pages/Fournisseurs.tsx`, `apps/web/src/pages/Produits.tsx`
- Portions de `packages/shared/src/index.ts` : schémas et DTO liés (`matiereCreateSchema`, `mouvementCreateSchema`, `fournisseurCreateSchema`, `commandeFournisseurCreateSchema`, `produitCreateSchema`, `formatQuantite`, `TYPE_MOUVEMENT_LABELS`)

## 2. Intuition

**Stocks** répond à une question simple : *combien reste-t-il de farine, de beurre, de sucre ?* Chaque mouvement (entrée ou sortie) est écrit une fois pour toutes dans un journal — jamais modifié ni supprimé après coup — et la quantité en stock affichée est la somme cumulée de ce journal. Un seuil d'alerte par matière permet de prévenir avant la rupture.

**Fournisseurs** gère les fiches fournisseurs et les bons de commande passés auprès d'eux. Un bon de commande reste `EN_ATTENTE` jusqu'à ce que la marchandise soit physiquement reçue ; la réception est l'instant précis où le stock augmente réellement — passer une commande n'augmente rien tant qu'elle n'est pas reçue.

**Produits** est le catalogue des articles vendus (Carré 1.500 Fc, Baguette 500 Fc…), utilisé par la Caisse (Volume 11j) et par la Production (chapitre suivant). Sa gestion vit dans l'écran Paramètres, réservée à l'Administrateur — cohérent avec la section 3.9 de la spécification.

## 3. `apps/api/src/services/stocks.ts` — le cœur technique partagé

Ce petit fichier (96 lignes) est le point de passage obligé de **toute** variation de stock dans l'application — appelé par `routes/stocks.ts` (mouvement manuel), par `routes/fournisseurs.ts` (réception, sens ENTREE) et, on le verra au chapitre suivant, par `routes/production.ts` (sens SORTIE). Centraliser cette logique en un seul endroit garantit qu'une matière première ne peut jamais avoir un stock négatif ni un mouvement enregistré sans mise à jour cohérente de la quantité.

```ts
export async function appliquerMouvement(
  tx: TxClient,
  params: { matierePremiereId: string; type: TypeMouvementStock; quantite: number; ... auteurId: string },
): Promise<ResultatMouvement> {
  const matiere = await tx.matierePremiere.findUnique({ where: { id: params.matierePremiereId } });
  if (!matiere) throw new ErreurStock(404, "Matière première introuvable");

  const avant = matiere.quantiteStock.toNumber();
  const seuil = matiere.seuilAlerte.toNumber();

  if (params.type === "SORTIE" && params.quantite > avant) {
    throw new ErreurStock(400, `Stock insuffisant de ${matiere.nom} : ...`);
  }

  await tx.mouvementStock.create({ data: { ...params } });
  const maj = await tx.matierePremiere.update({
    where: { id: matiere.id },
    data: { quantiteStock: params.type === "ENTREE" ? { increment: params.quantite } : { decrement: params.quantite } },
  });

  const apres = maj.quantiteStock.toNumber();
  return { matiere: maj, franchitSeuil: avant >= seuil && apres < seuil };
}
```

Trois points techniques méritent d'être détaillés :

1. **`tx: TxClient`, pas `prisma`** : la fonction ne fait jamais elle-même `prisma.$transaction` — elle reçoit un client de transaction déjà ouvert par son appelant. Cela permet à `routes/fournisseurs.ts` d'appeler `appliquerMouvement` **plusieurs fois de suite** (une fois par ligne de commande) **dans la même transaction sérialisable**, garantissant que la réception d'un bon à 3 lignes est tout-ou-rien : si la 3ᵉ ligne échoue, les 2 premières sont annulées aussi.
2. **Garde-fou sur les sorties** : une `SORTIE` dont la quantité dépasse le stock actuel lève `ErreurStock(400, ...)` — le stock ne peut jamais devenir négatif, quelle que soit la route appelante.
3. **`franchitSeuil` détecte une transition, pas un état** : `avant >= seuil && apres < seuil`. Une matière déjà sous son seuil qui reçoit une nouvelle sortie ne redéclenche pas d'alerte à chaque mouvement — seul le franchissement initial du seuil notifie. `emettreAlerteSeuil` (appelée séparément par l'appelant, pas depuis `appliquerMouvement` lui-même — car une réception fournisseur n'a jamais besoin d'alerter, elle ne peut que faire remonter le stock) publie un événement `ALERTE_STOCK` de priorité `HAUTE` sur le bus d'événements (`lib/events.ts`, détaillé au Volume 12).

## 4. `apps/api/src/routes/stocks.ts` — matières premières et journal de mouvements

### 4.1 CRUD des matières premières

`GET /api/stocks/matieres` (lecture) et `POST`/`PUT`/`DELETE /api/stocks/matieres/:id` (écriture), tous gardés par `requirePermission("STOCKS", "LECTURE"|"ECRITURE")`. Deux points notables :

- **La création passe elle aussi par `appliquerMouvement`** : un stock de départ non nul (`quantiteInitiale`) n'est pas écrit directement dans `MatierePremiere.quantiteStock` — il est enregistré comme un mouvement `ENTREE` avec la référence `"Stock initial"`, à l'intérieur d'une transaction Prisma. Choix délibéré (commenté dans le code) : le journal de mouvements doit toujours expliquer intégralement la quantité en stock, y compris son origine initiale — pas de nombre « sorti de nulle part ».
- **Suppression bloquée par l'historique** : `DELETE /matieres/:id` vérifie `_count.mouvements > 0` et refuse avec un `409` si la matière a déjà un historique — même logique de protection du journal que la suppression d'un `Travailleur` avec des bulletins de paie (Volume 11k-1).

### 4.2 Journal des mouvements

`GET /api/stocks/mouvements` (filtrable par `matiereId`, plafonné à 100 résultats — pas de pagination, constat cohérent avec `GET /commandes`, Volume 11h) et `POST /api/stocks/mouvements`, qui est la route utilisée pour un mouvement **manuel** (correction d'inventaire, casse, etc. — par opposition à une réception fournisseur ou une décrémentation de production, toutes deux automatiques). Elle ouvre elle-même la transaction `Serializable` autour de `appliquerMouvement`, publie un événement `MOUVEMENT_STOCK` détaillé (matière, sens, quantité, reste), et déclenche `emettreAlerteSeuil` si `franchitSeuil` est vrai.

## 5. `apps/api/src/routes/fournisseurs.ts` — fiches et bons de commande

### 5.1 CRUD fournisseurs

Classique, avec le même garde-fou de suppression que les matières premières : un fournisseur ayant des commandes enregistrées (`_count.commandes > 0`) ne peut pas être supprimé — l'historique d'achat prime sur le nettoyage de la fiche.

### 5.2 Bons de commande (`CommandeFournisseur`)

`POST /api/fournisseurs/commandes` valide (via `commandeFournisseurCreateSchema`) qu'il y a au moins une ligne, que chaque matière première apparaît **au plus une fois** dans la commande (contrôle applicatif, `new Set(matiereIds).size !== matiereIds.length`), et que toutes les matières référencées existent bien en base. Le total n'est jamais stocké : il est recalculé à chaque lecture par `versCommandeDTO` (`lignes.reduce((s, l) => s + l.sousTotal, 0)`) — une « vue dérivée » au même sens qu'au Volume 11i (Commissions), pas un champ figé.

`DELETE /commandes/:id` n'autorise l'annulation que si le statut est encore `EN_ATTENTE` — une commande `RECUE` fait partie de l'historique définitif et ne peut plus être effacée (les lignes sont supprimées en cascade Prisma si l'annulation a lieu à temps).

### 5.3 Réception — le point de jonction avec Stocks

```ts
fournisseursRouter.post("/commandes/:id/reception", requirePermission("FOURNISSEURS", "ECRITURE"), async (req, res, next) => {
  const recue = await prisma.$transaction(async (tx) => {
    const passage = await tx.commandeFournisseur.updateMany({
      where: { id: commande.id, statut: "EN_ATTENTE" },
      data: { statut: "RECUE", dateReception: new Date(), recueParId: req.utilisateur!.id },
    });
    if (passage.count === 0) throw new ErreurStock(409, "Cette commande a déjà été reçue");

    for (const ligne of commande.lignes) {
      await appliquerMouvement(tx, { matierePremiereId: ligne.matierePremiereId, type: "ENTREE",
        quantite: ligne.quantite.toNumber(), reference: `Commande fournisseur n°${commande.numero}`,
        commandeFournisseurId: commande.id, auteurId: req.utilisateur!.id });
    }
    return tx.commandeFournisseur.findUniqueOrThrow({ where: { id: commande.id }, include: INCLUDE_COMMANDE });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  ...
});
```

Deux techniques déjà rencontrées ailleurs dans le livre, réutilisées ici à l'identique :

- **`updateMany` conditionnel comme verrou logique** (compare-and-set) : la clause `where: { id: commande.id, statut: "EN_ATTENTE" }` garantit qu'une seule requête concurrente peut faire passer le statut à `RECUE` — si deux utilisateurs cliquent sur « Marquer reçue » en même temps, la seconde tentative trouve `passage.count === 0` et échoue proprement avec un `409`, plutôt que de dupliquer les mouvements de stock. Même idée que `verifierAlertesDette` (Volume 11h) et `verifierAlertesAbsenceEnAttente` (Volume 11k-2), appliquée ici à une transition d'état plutôt qu'à une alerte.
- **Transaction `Serializable`** : chaque ligne de la commande génère son propre `appliquerMouvement` ; le tout doit réussir ou échouer en bloc, avec le niveau d'isolation le plus strict de PostgreSQL — même rigueur que la création de commande client (Volume 11h) et la décrémentation de production (chapitre suivant), en sens inverse (ici une ENTREE en masse plutôt qu'une SORTIE).

La réception publie un événement `RECEPTION_FOURNISSEUR` avec le détail des matières livrées et le montant total — c'est la « notification de réception » citée explicitement par la spécification (section 3.6 et son résumé des priorités, ligne « Fournisseurs & achats — notification de réception »).

## 6. `apps/api/src/routes/produits.ts` — le catalogue, sous Paramètres

Point notable : ce routeur est monté sur `/api/produits`, mais son écriture est gardée par `requirePermission("PARAMETRES", "ECRITURE")`, pas par un module `PRODUITS` dédié — cohérent avec la spécification 3.9 (« Catalogue produits, prix, taxes... Écriture réservée à l'Administrateur »). Vérification faite dans `prisma/seed.ts` (Volume 13) : seul le rôle « Administrateur » reçoit `ecriture(Module.PARAMETRES)` dans la matrice — y compris le Directeur Général en est explicitement exclu (`TOUS_LES_MODULES.filter((m) => m !== Module.PARAMETRES)`). La lecture (`GET /`, `GET /:id`), en revanche, n'a **aucune garde de permission** au-delà de `requireAuth` — tout utilisateur connecté peut lire le catalogue, cohérent avec son usage transversal (Caisse, Production, aperçu de commande...).

Le point le plus intéressant de ce fichier est la réutilisation de la tâche critique déjà expliquée au Volume 11f :

```ts
const changeTaux = parsed.data.tauxTaxe !== undefined && parsed.data.tauxTaxe !== existant.tauxTaxe;
if (changeTaux) {
  const r = await traiterActionCritique(req, "MODIFIER_TAUX_TAXE", { produitId: existant.id, data: parsed.data },
    `modifier le taux de taxe de « ${existant.nom} » (${existant.tauxTaxe} % → ${parsed.data.tauxTaxe} %)`);
  return res.status(r.http).json(r.body);
}
```

Une modification de `PUT /:id` qui **touche le taux de taxe** est déviée vers `traiterActionCritique` (immédiate si Admin Principal, mise en attente sinon) — exactement le mécanisme du Volume 11f, appliqué ici à sa deuxième occurrence concrète dans le code (la première étant `roles.ts`, Volume 11d). Une modification qui ne touche **pas** le taux (nom, prix, catégorie) reste une écriture directe, sans passer par les approbations — la même nuance de granularité déjà documentée au Volume 11f pour `MODIFIER_TAUX_TAXE`.

## 7. Frontend — les trois pages

Les trois pages (`StocksPage`, `FournisseursPage`, `ProduitsPage`) suivent toutes le motif désormais familier depuis le Volume 9 : `useQuery`/`useMutation` de TanStack Query, deux arbres JSX (`Table` desktop / `CarteLigne` mobile) pour chaque liste, formulaires dans des `Dialog`, invalidation croisée des clés de requête affectées après chaque mutation.

Deux détails spécifiques à signaler :

- **`FournisseursPage` invalide aussi `["matieres"]` et `["mouvements"]`** après une réception (`rafraichir()` invalide 4 clés à la fois) — parce qu'une réception fournisseur, bien qu'exécutée depuis l'écran Fournisseurs, modifie des données qui appartiennent à l'écran Stocks. Illustration directe de la convention « invalidation large, pas seulement l'écran courant » posée au Volume 10.
- **`StocksPage` affiche un bandeau d'alerte permanent** (pas une notification éphémère) listant toutes les matières `sousSeuil` en haut de l'écran — complémentaire, pas redondant, avec la notification temps réel `ALERTE_STOCK` : la notification prévient au moment du franchissement, le bandeau reste visible tant que la situation n'est pas résolue, même après un rechargement de page où l'événement temps réel a été manqué.
- **`ProduitsPage` restreint l'édition à `peutEcrire("PARAMETRES")`**, cohérent avec la route serveur, et **verrouille l'entrée `tauxTaxe`** au formulaire (le champ n'apparaît même pas dans le dialogue d'édition — seuls nom/prix/catégorie sont modifiables depuis cet écran). Observation : la route serveur gère bien le cas d'un changement de taux via `traiterActionCritique`, mais aucune UI actuelle (`ProduitsPage`) n'envoie jamais `tauxTaxe` dans le corps de sa requête `PUT` — elle envoie systématiquement `tauxTaxe: produitEnEdition?.tauxTaxe ?? 0` (valeur inchangée). **Non confirmé dans le code actuel** qu'une autre interface permette de déclencher ce chemin ; le mécanisme serveur reste correct et testé par construction (comme `MODIFIER_PERMISSIONS_ROLE`, Volume 11d), simplement non atteignable depuis `ProduitsPage` telle qu'elle existe aujourd'hui.

## 8. Exemple chiffré

Un sac de farine ordinaire : seuil d'alerte à 20 kg, stock actuel à 25 kg.

1. Le Responsable Production enregistre une sortie manuelle de 8 kg (`POST /api/stocks/mouvements`, `type: "SORTIE"`) : `avant = 25`, `apres = 17`. Comme `avant (25) >= seuil (20)` et `apres (17) < seuil (20)`, `franchitSeuil` vaut `true` → un `ALERTE_STOCK` de priorité `HAUTE` est publié, visible en temps réel par le DG.
2. Une heure plus tard, une nouvelle sortie de 2 kg porte le stock à 15 kg. `avant (17) >= seuil (20)` est **faux** (17 < 20) → `franchitSeuil` vaut `false` : aucune deuxième alerte, alors que le stock est toujours sous le seuil. Le bandeau permanent de `StocksPage`, lui, continue d'afficher la matière comme critique — c'est la seule trace visible en continu de cette situation, la notification ponctuelle n'ayant eu lieu qu'à la première transition.
3. Le lendemain, une commande fournisseur de 50 kg est réceptionnée : `appliquerMouvement` est appelé avec `type: "ENTREE"`, `quantite: 50` → stock à 65 kg. Un `RECEPTION_FOURNISSEUR` est publié ; aucun `ALERTE_STOCK` n'est déclenché ici (une entrée ne peut jamais faire franchir un seuil vers le bas).

## 9. Croisement avec `docs/spec-boulangerie.md`

- Section 3.2 (« Suivi des quantités... mouvements de stock (entrée/sortie), seuils d'alerte, historique ») : correspond exactement à `MatierePremiere` + `MouvementStock` append-only + `seuilAlerte`. Aucun écart.
- Section 3.6 (« Fiches fournisseurs, bons de commande, réception de marchandises (met à jour le stock) ») : correspond exactement au CRUD `Fournisseur` + `CommandeFournisseur` + la réception qui appelle `appliquerMouvement`. Aucun écart.
- Section 3.9 (« Catalogue produits, prix, taxes... Écriture réservée à l'Administrateur ») : confirmé par `requirePermission("PARAMETRES", "ECRITURE")` et la matrice de `seed.ts`. Aucun écart.
- Ligne de synthèse « Fournisseurs & achats — notification de réception » (section des priorités de développement) : confirmée par l'événement `RECEPTION_FOURNISSEUR`. Aucun écart.

Aucun écart spec/code trouvé dans ce chapitre.

## 10. Erreurs fréquentes et cas limites

- **Sortie de stock supérieure au disponible** : rejetée avec un message explicite (`ErreurStock(400, ...)`), jamais un stock négatif silencieux.
- **Double réception concurrente d'un même bon de commande** : la seconde requête échoue proprement (`409`) grâce au compare-and-set sur le statut — aucun risque de compter deux fois la même livraison.
- **Suppression d'une matière première ou d'un fournisseur avec historique** : bloquée par un `409`, le journal de mouvements et l'historique d'achat ne sont jamais altérés rétroactivement.
- **Matière première dupliquée dans une même commande fournisseur** : rejetée en amont par une vérification `Set` avant même d'atteindre la base.

## 11. Résumé

Stocks, Fournisseurs et Produits forment une chaîne cohérente autour d'un seul point de vérité technique, `appliquerMouvement` (`services/stocks.ts`), qui garantit qu'aucune variation de stock — manuelle, par réception fournisseur, ou (au chapitre suivant) par décrémentation de production — ne peut laisser le journal et la quantité affichée en désaccord. Les mêmes techniques de concurrence déjà vues au Niveau 1 (compare-and-set, transaction `Serializable`) réapparaissent ici sans variation, confirmant qu'il s'agit bien de conventions transversales du projet plutôt que de choix ponctuels.

---

**Suite →** Volume 11z-2 — Production (planning, productions enregistrées, bons de livraison), qui referme la boucle de `appliquerMouvement` côté sortie.
