# Volume 11z-2 — Production (planning, productions, schéma de commande, bon de livraison)

**Niveau de risque : 2 — Fonctionnel standard.** Module le plus riche du reste du back-end Niveau 2 — presque aussi dense qu'un chapitre Niveau 1 en volume de logique, mais classé Niveau 2 dans `INVENTAIRE_DU_PROJET.md` car il ne manipule pas directement l'argent d'une commande ou d'une paie. Traitement complet par fichier et par symbole.

## 1. Ce que couvre ce chapitre

- `apps/api/src/routes/production.ts` (717 lignes — le plus long routeur Niveau 2 du projet)
- `apps/web/src/pages/Production.tsx`, `apps/web/src/pages/BonsLivraison.tsx`
- Portions de `apps/api/src/services/pdf.ts` : `construirePdfBonsLivraison`, `nomFichierPdf` (la fonction générique `construirePdf`, utilisée par les exports de rapports, est renvoyée au futur chapitre Export/Rapports — le fichier `pdf.ts` dans son ensemble reste « En cours » dans la matrice jusque-là)
- Portions de `packages/shared/src/index.ts` liées à la section 3.3 (schémas Zod, DTO, `totalDestinationsBacs`, `CODES_INGREDIENT`, `controleQualiteSchema`, `productionPertesSchema`, `pertesJustifiees`, `VERDICTS_QUALITE`)

Ce module correspond intégralement à la section **3.3 « Production »** de la spécification — une refonte explicite documentée dans la spec elle-même : les anciennes « fiches recettes » sont retirées, remplacées par cinq volets indépendants + une vue d'écarts.

## 2. Intuition : cinq volets, une seule idée directrice

La spécification (section 3.3) est explicite sur le changement de paradigme : l'ancien système raisonnait « recette × quantité produite » (nomenclature par produit) ; le nouveau raisonne en **bacs** et en **ingrédients consommés globalement sur la journée** — plus proche du fonctionnement réel observé en boulangerie. Cinq volets, chacun avec son propre écran ou sa propre section :

- **a) Planning** — ce qui est prévu pour le jour suivant (bacs, détail par produit, prévisions d'ingrédients).
- **b) Productions enregistrées** — ce qui a réellement été produit, avec ses destinations (livré, vendu, donné, restant, foutu).
- **c) Ingrédients utilisés** — saisis avec la production, décrémentent automatiquement le stock.
- **d) Schéma de commande** — digitalisation de la fiche papier remplie la veille, alimente automatiquement le Planning.
- **e) Bon de livraison** — digitalisation de la fiche remplie à la livraison, volontairement indépendante du Schéma.
- **f) Contrôle qualité, pertes motivées et clôture** — verrou définitif posé sur une Production une fois son contenu vérifié (§7 bis).

Une vue transversale (**Écarts**) compare enfin le prévu (Planning) au réalisé (somme des Productions du jour).

## 3. a) Planning de production

`GET /api/production/planning` (filtrable par plage de dates, plafonné à 60 résultats) et `POST /api/production/planning`. Le point notable est la gestion de l'unicité : `PlanningProduction.datePrevue` est une contrainte unique en base, donc un envoi sur une date déjà planifiée **met à jour** l'enregistrement existant plutôt que d'échouer — dans une transaction qui supprime puis recrée les lignes de détail (`planningLigneProduit.deleteMany` puis `create`), le même idiome « remplacement intégral » que l'on retrouvera au Schéma de commande et au Bon de livraison. `DELETE /planning/:id` est une suppression simple, sans garde-fou d'historique (contrairement aux matières premières ou fournisseurs) — un planning n'est qu'une prévision, pas un fait constaté.

## 4. d) Schéma de commande — et son alimentation automatique du Planning

C'est la partie la plus délicate techniquement du fichier. `chargerSchemaCommandeJour(date)` est une fonction interne, **seul chemin de lecture partagé** par `GET /schema-commande` et par la réponse renvoyée après `PUT /schema-commande` — évite toute divergence entre ce que l'écran affiche juste après l'enregistrement et ce qu'un rechargement de page afficherait. Elle croise trois sources en parallèle (`Promise.all`) : le catalogue des 4 produits suivis (résolus **par nom**, via la liste blanche `NOMS_PRODUITS_SCHEMA_COMMANDE` — pas par ID codé en dur, cohérent avec la spec qui exige cette résolution par nom pour rester portable entre environnements), les clients Dépositaire/Maman, et les lignes déjà saisies pour cette date.

`PUT /schema-commande` remplace intégralement le Schéma de la date choisie (pas de diff ligne à ligne — `deleteMany` puis recréation, uniquement pour les clients ayant au moins une ligne non nulle), puis **alimente automatiquement le Planning de la même date** :

```ts
// Alimentation automatique du Planning de production : le nombre de
// bacs et le détail par produit deviennent ceux du Schéma. Un Planning
// déjà existant pour cette date garde ses prévisions d'ingrédients et
// ses observations, saisies à part.
const totauxParProduitId = new Map<string, number>();
for (const c of clients) for (const l of c.lignes) if (l.quantite > 0)
  totauxParProduitId.set(l.produitId, (totauxParProduitId.get(l.produitId) ?? 0) + l.quantite);
...
if (planningExistant) {
  await tx.planningLigneProduit.deleteMany({ where: { planningId: planningExistant.id } });
  await tx.planningProduction.update({ where: { id: planningExistant.id }, data: { nombreBacsCommandes, lignes: { create: lignesPlanning } } });
} else if (lignesPlanning.length > 0) {
  await tx.planningProduction.create({ data: { datePrevue: dateObj, nombreBacsCommandes, creeParId: ..., lignes: { create: lignesPlanning } } });
}
```

Deux nuances méritent d'être soulignées, toutes deux confirmées par la spec (section 3.3 d, puce « Alimentation automatique du Planning ») :

1. **Seuls le nombre de bacs et le détail par produit sont écrasés** — les prévisions d'ingrédients (sacs de farine, paquets de levure...) et les observations du Planning, saisies séparément dans le volet a), ne sont **jamais** touchées par un enregistrement du Schéma.
2. **Un Schéma vide ne crée pas de Planning vide** : la condition `else if (lignesPlanning.length > 0)` évite de créer un enregistrement `PlanningProduction` inutile si aucune ligne n'a de quantité positive.

Le tout est exécuté dans **une seule transaction Prisma** englobant le remplacement du Schéma et la mise à jour dérivée du Planning — cohérence garantie entre les deux tables, jamais l'une sans l'autre.

**Renvoi croisé — Cycle de livraison** : dans le code actuel, enregistrer un Schéma de commande (`PUT /schema-commande`) ne se limite plus à alimenter le Planning — la même transaction appelle aussi `synchroniserPrevisionsCycles` (`apps/api/src/services/cyclesLivraison.ts`), qui crée ou met à jour, pour chaque client du Schéma, un `CycleLivraison` dont le statut initial est `PREVISION`. Ce mécanisme (transitions de statut, verrouillage, acceptation) est **entièrement** documenté dans un chapitre séparé, le Volume 11z-6 — Cycle de livraison ; il n'est pas détaillé ici pour ne pas dupliquer ce contenu.

## 5. e) Bon de livraison — volontairement indépendant

`chargerBonLivraisonJour(date)` suit exactement le même schéma que le Schéma de commande (fonction interne partagée `GET`/réponse de `PUT`), mais avec une différence de fond, explicite dans le commentaire du code et dans la spec (section 3.3 e) : **aucune alimentation automatique dans un sens ni dans l'autre** avec le Schéma. La quantité livrée peut différer de la quantité commandée (rupture de stock, ajustement de dernière minute) — le Bon de livraison se contente de **lire** le total commandé du Schéma (`totalCommandeParClientId`) pour l'exposer comme simple indice visuel côté client (`totalCommande` dans le DTO), jamais pour contraindre la saisie.

Contrairement au Schéma (tous les Dépositaires et Mamans), le Bon de livraison ne liste que les clients de type **Dépositaire** — la spec précise que « les Mamans n'apparaissent pas sur cette fiche, la livraison par camion ne concerne que les Dépositaires ». `PUT /bons-livraison` vérifie d'ailleurs explicitement `typeClient: { nom: "Dépositaire" }` lors de la validation des IDs clients reçus.

### 5.1 Export PDF

`GET /bons-livraison/pdf` est une route de lecture pure (aucune écriture), qui réutilise les mêmes données que `GET /bons-livraison` puis les transforme en document imprimable via `construirePdfBonsLivraison` (`services/pdf.ts`). Ce générateur (bibliothèque PDFKit, déjà rencontrée pour les bulletins de paie au Volume 11k-3) produit une fiche par Dépositaire livré — logo, tableau produit/total/bacs vides/observations, et deux lignes de signature physique (Chauffeur / Dépositaire, non capturées en base, à signer sur le document imprimé) — empilées plusieurs par page à la manière du document papier d'origine. `nomFichierPdf` normalise le titre en un nom de fichier sûr (suppression des accents, caractères non alphanumériques remplacés par des tirets).

## 6. b + c) Productions enregistrées — le cœur du module

`POST /api/production/productions` est la route la plus dense du fichier. Trois responsabilités s'y enchaînent :

1. **Validation des dons** : chaque `motifDonId` doit exister en base (table `MotifDon`, liste fixe extensible — initialisée par la spec avec « Police » et « Baraka », mais pas codée en dur ailleurs), sans doublon.
2. **Décrémentation automatique du stock**, réutilisant exactement `appliquerMouvement` du Volume 11z-1 :

```ts
const quantitesParCode: [CodeIngredient, number][] = [
  ["FARINE", d.sacsUtilises], ["LEVURE", d.paquetsLevureUtilises],
  ["SEL", d.kgSelUtilises], ["HUILE", d.quantiteHuileUtilisee],
];
const aConsommer = quantitesParCode.filter(([, q]) => q > 0);
const matieres = await prisma.matierePremiere.findMany({ where: { code: { in: aConsommer.map(([c]) => c) } } });
```

La correspondance entre une quantité saisie et la matière première à décrémenter passe par un **code** (`CodeIngredient` = `FARINE | LEVURE | SEL | HUILE`, porté par un champ dédié sur `MatierePremiere`), **pas par le nom** — choix explicitement validé dans la spec (« trop fragile » par nom). Si aucune matière première n'est configurée avec ce code, l'enregistrement de la production **n'est pas bloqué** : un avertissement est simplement ajouté à la réponse (`avertissements`), pour ne pas empêcher le travail du Responsable de production à cause d'une matière première mal paramétrée. À l'intérieur d'une transaction `Serializable`, la `Production` est créée puis chaque ingrédient consommé génère un `appliquerMouvement(tx, { type: "SORTIE", ..., productionId: production.id })` — même mécanisme, mêmes garde-fous (stock insuffisant → `ErreurStock`, `franchitSeuil` → alerte) que le mouvement manuel ou la réception fournisseur du chapitre précédent. C'est la confirmation explicite de la spec (« c'est le mécanisme mis en place en Phase 5, seule sa source de calcul change ») : la production ne réintroduit aucune logique de stock nouvelle, elle réutilise le point de passage unique déjà en place.

3. **Réconciliation, avertissement jamais bloquant** :

```ts
const totalDestinations = totalDestinationsBacs({ bacsLivresDepositaires, bacsLivresMamans, bacsVendusVC, bacsRestants, bacsFoutus, dons });
...
ecartReconciliation: totalDestinations - p.bacsProduits,
```

`totalDestinationsBacs` (fonction pure de `packages/shared/src/index.ts`) additionne toutes les destinations possibles d'un bac produit — livré Dépositaire, livré Maman, vendu VC, donné (tous motifs confondus), restant, foutu. Si la somme diffère de `bacsProduits`, l'écart est **signalé** (`ecartReconciliation` non nul, badge visuel côté client) mais **jamais bloquant** — cohérent avec la spec (« la réalité du terrain prime sur l'équilibre comptable »). Cette même fonction est appelée à l'identique côté client (`Production.tsx`, `reconciliation` en `useMemo`) pour afficher l'avertissement **avant** l'envoi, avec exactement le même calcul que le serveur — évite toute divergence entre ce que l'utilisateur voit en saisissant et ce que le serveur validera après coup.

## 7. Vue Écarts (prévu vs réalisé)

`GET /api/production/ecarts?date=...` compare le Planning de la date (le prévu) à la somme de toutes les Productions enregistrées ce jour-là (le réalisé), sur 5 métriques (bacs, sacs de farine, paquets de levure, quantité d'huile, kg de sel). Une fonction interne `ligne()` construit chaque ligne du DTO avec un arrondi à 3 décimales sur l'écart (`Math.round((realise - prevu) * 1000) / 1000`), cohérent avec la précision `Decimal(12,3)` des quantités physiques en base (Volume 13).

## 7 bis. f) Contrôle qualité, pertes motivées et clôture (section 3.3 f)

Une `Production` naît avec `statut: "OUVERTE"` (`STATUTS_PRODUCTION` = `OUVERTE | CLOTUREE`, `packages/shared/src/index.ts`) : ses pertes et son contrôle qualité peuvent être saisis ou corrigés librement tant qu'elle n'est pas clôturée. `chargerProductionOuverte` (`apps/api/src/routes/production.ts`, ligne 763) est le garde-fou partagé par les trois routes de ce volet : il renvoie `404` si la Production n'existe pas, `409` (« Cette production est clôturée : plus aucune modification possible ») si `statut === "CLOTUREE"` — la clôture verrouille tout, y compris des champs qui n'ont de toute façon jamais leur propre route de modification après création (`bacsProduits` et les autres champs saisis à `POST /productions`, section §6, n'ont aucun endpoint `PUT` général).

- **`PUT /productions/:id/pertes`** — remplace intégralement la répartition des pertes par motif (`ProductionPerte`), même idiome « remplacement, pas diff » que les dons (§6) et le Schéma de commande (§4) : `deleteMany` puis `createMany`. Chaque `motifPerteId` doit exister dans la table `MotifPerte` (liste fixe extensible) et ne peut apparaître qu'une fois (`400` sinon).
- **`PUT /productions/:id/controle-qualite`** — un seul `ControleQualite` par Production (`upsert` sur `productionId`, contrainte d'unicité en base). `controleQualiteSchema` (`packages/shared/src/index.ts`) impose un `verdict` (`CONFORME` ou `NON_CONFORME`, `VERDICTS_QUALITE`) et **exige un `motifId`** dès que le verdict est `NON_CONFORME` (`.refine`, message « Un motif est requis quand le contrôle qualité est non conforme ») — facultatif si `CONFORME`. Le motif, quand fourni, doit exister dans `MotifNonConformite` (liste fixe extensible, ex. « Cuisson insuffisante », « Aspect non conforme », « Poids non conforme »).
- **`POST /productions/:id/cloturer`** — le verrou définitif. Deux conditions bloquantes, vérifiées dans cet ordre :
  1. Un contrôle qualité doit déjà être enregistré (`400`, `code: "CONTROLE_QUALITE_MANQUANT"`) — impossible de clôturer une Production jamais vérifiée.
  2. Les pertes doivent être **exhaustivement** motivées : `pertesJustifiees({ bacsFoutus, pertes })` (`packages/shared/src/index.ts`) exige que la somme des `nombreBacs` des lignes `ProductionPerte` soit **exactement égale** à `bacsFoutus` — ni moins (des bacs foutus non expliqués), ni plus (`400`, `code: "PERTES_NON_JUSTIFIEES"`, message chiffré : *« Les pertes ne sont pas entièrement motivées : N bac(s) motivé(s) pour M bac(s) foutu(s) »*). Contrairement à la réconciliation des destinations (§6, `ecartReconciliation`), purement informative, cette vérification est **strictement bloquante** — nuance explicite du commentaire du code (« contrairement aux dons, purement informatifs »).

  Une fois ces deux conditions réunies, la Production passe `statut: "CLOTUREE"`, `clotureeLe`/`clotureeParId` sont renseignés, et un événement `PRODUCTION_CLOTUREE` est publié sur le bus d'événements (`lib/events.ts`, Volume 12).

**Exemple chiffré** — une production de 8 bacs foutus (`bacsFoutus: 8`) déjà passée en contrôle qualité `NON_CONFORME` (motif « Cuisson insuffisante ») :

1. Le Responsable Production saisit deux lignes de perte : « Casse/manutention » 5 bacs, « Invendu périmé » 2 bacs. Total motivé = 7. `POST /productions/:id/cloturer` échoue avec `PERTES_NON_JUSTIFIEES` : *« 7 bac(s) motivé(s) pour 8 bac(s) foutu(s) »* — 1 bac reste sans motif, la clôture est refusée.
2. Il corrige la ligne « Invendu périmé » à 3 bacs (total motivé = 8 = `bacsFoutus`). Un nouvel appel à `POST /productions/:id/cloturer` réussit : `statut` passe à `CLOTUREE`, toute tentative ultérieure de modifier les pertes ou le contrôle qualité de cette Production échoue désormais avec `409`.

Fonction partagée `pertesJustifiees` : le frontend (`ProductionPage`, §8) l'appelle avec exactement les mêmes données pour désactiver le bouton « Clôturer » tant que la condition n'est pas remplie (`peutCloturer`), plutôt que de laisser l'utilisateur découvrir le blocage seulement après l'envoi — même philosophie que `totalDestinationsBacs` déjà rencontrée au §6.

## 8. Frontend

`ProductionPage` (1003 lignes, la page la plus longue du module) regroupe cinq sections dans un seul écran : la carte `ZonesDepositaireCard` (gestion des zones de dépôt, éditable si écriture Commandes **ou** Production — exactement la règle « l'un des deux suffit » de la spec 3.3 d, vérifiée dans le JSX : `editable={peutEcrire("COMMANDES") || peutEcrire("PRODUCTION")}`), le tableau du Schéma de commande (Dépositaires groupés par zone via `groupesDepositaires`, Mamans en liste à part — reproduisant fidèlement la fiche papier), la vue Écarts, la liste des Plannings, et l'historique des Productions enregistrées. `BonsLivraisonPage` est un **écran séparé** (`/production/bons-livraison`), pour ne pas surcharger l'écran principal — exactement le même choix d'organisation que `/commandes/clients` pour le module Commandes (Volume 11h).

Les deux pages partagent le même motif d'édition en grille : une valeur de cellule affichée est soit une édition locale non encore enregistrée (`editions`/`editionsSchema`, un dictionnaire clé composite `clientId:produitId`), soit la valeur serveur si aucune édition locale n'existe — permettant de saisir plusieurs cellules avant un unique clic « Enregistrer » qui envoie tout le tableau en un seul `PUT`.

Le téléchargement du PDF (`BonsLivraisonPage`) n'utilise pas le client `api()` habituel de `lib/api.ts` mais un `fetch` direct avec l'en-tête `Authorization` reconstruit manuellement — nécessaire car la réponse est un flux binaire (`Blob`), pas du JSON, ce que le wrapper `api()` ne gère pas (confirmé par lecture de `lib/api.ts`, Volume 11b : il attend systématiquement une réponse JSON ou vide). Le blob est ensuite transformé en URL objet temporaire pour déclencher le téléchargement, puis révoquée immédiatement après (`URL.revokeObjectURL`).

## 9. Exemple chiffré (réconciliation)

Une production de 200 bacs est enregistrée avec : 120 livrés Dépositaires, 50 livrés Mamans, 20 vendus VC, 5 donnés (motif « Police »), 3 restants, 1 foutu.

`totalDestinationsBacs` = 120 + 50 + 20 + 3 + 1 + 5 (dons) = **199**. `ecartReconciliation` = 199 − 200 = **−1**. La production est enregistrée normalement (aucun blocage), mais l'écran affiche un badge `−1` sur la ligne de cette production — un bac produit n'a été retrouvé dans aucune destination déclarée (probablement une erreur de saisie ou un bac non comptabilisé), signalé pour investigation, sans jamais empêcher la clôture de la journée.

## 10. Croisement avec `docs/spec-boulangerie.md`

Correspondance vérifiée exhaustivement contre la section 3.3 (a à f) : Planning, Productions (réconciliation non bloquante, dons par motif via `MotifDon`), décrémentation via code d'ingrédient (pas par nom), Schéma de commande (alimentation automatique du Planning, zones de dépôt en lecture ouverte/écriture Commandes-ou-Production), Bon de livraison (Dépositaires uniquement, indépendance volontaire du Schéma), Contrôle qualité/pertes/clôture (§7 bis — verdict avec motif obligatoire si non conforme, pertes exactement égales à `bacsFoutus`, verrouillage total après clôture). **Aucun écart trouvé** — y compris sur la nuance historique de la permission des zones de dépôt, où la spec documente elle-même une correction de conception (`écriture réservée à Commandes seul` → `Commandes OU Production`) déjà reflétée dans le code actuel (vérifié : `ZonesDepositaireCard editable={peutEcrire("COMMANDES") || peutEcrire("PRODUCTION")}`).

## 11. Erreurs fréquentes et cas limites

- **Deux envois de Planning sur la même date** : le second met à jour, ne crée pas de doublon (contrainte unique + transaction supprimer/recréer).
- **Ingrédient utilisé sans matière première correspondante** (code non configuré) : avertissement non bloquant, la production est tout de même enregistrée.
- **Écart de réconciliation, quel que soit son signe** : jamais bloquant, uniquement signalé.
- **Bon de livraison sur un client non-Dépositaire** : rejeté en amont (`400`) par la vérification `typeClient: { nom: "Dépositaire" }`.
- **Stock insuffisant lors de la décrémentation automatique** : la production entière échoue (transaction `Serializable`), pas de production « à moitié » enregistrée avec un stock incohérent.
- **Clôture tentée sans contrôle qualité enregistré** : rejetée (`400`, `CONTROLE_QUALITE_MANQUANT`) avant même de vérifier les pertes.
- **Somme des pertes différente de `bacsFoutus`, dans un sens ou dans l'autre** : clôture rejetée (`400`, `PERTES_NON_JUSTIFIEES`) — contrairement à l'écart de réconciliation (jamais bloquant), cette vérification l'est strictement.
- **Modification des pertes ou du contrôle qualité d'une Production déjà clôturée** : `409` explicite (« plus aucune modification possible »), quel que soit le champ visé.

## 12. Résumé

Le module Production est le plus étendu du reste du Niveau 2, mais sa complexité apparente se résout en un petit nombre d'idées répétées : remplacement intégral plutôt que diff ligne à ligne (Schéma, Bon de livraison, lignes de Planning), réutilisation systématique de `appliquerMouvement` pour toute décrémentation de stock (aucune logique de stock dupliquée), et réconciliation systématiquement signalée mais jamais bloquante — cohérent avec la philosophie générale du projet où la saisie du terrain prime sur l'équilibre théorique.

---

**Suite →** Volume 11z-3 — Départements/Groupes, Zones dépositaires (gestion complète) et Clients, qui referme le reste des données de référence utilisées par Commandes et Production.
