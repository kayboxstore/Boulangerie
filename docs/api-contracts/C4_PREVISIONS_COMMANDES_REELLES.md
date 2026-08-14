# C4 — Prévisions, livraison acceptée et commande réelle

État : contrat de référence C4  
Base : `agent/integration-wave-2@b8f583b4d9563fbfa526f7ff9189ad85a2580ed0`  
Branche d’implémentation : `codex/previsions-commandes-c4`

Tous les chemins sont relatifs à l’origine de l’application. Les dates civiles sont au format `AAAA-MM-JJ` et utilisent `Africa/Kinshasa`.

## 1. Invariants

1. Une prévision n’est jamais une vente.
2. Une quantité retenue, préparée, remise au magasin, chargée ou déposée n’est jamais facturable.
3. Seule la quantité acceptée devient une `CommandeClient`.
4. Une acceptation ne produit qu’une commande, même en cas de rejeu ou de concurrence.
5. La conversion financière utilise les calculs serveur existants.
6. Le cash éventuellement transporté par un chauffeur n’est pas un encaissement officiel.
7. Les retours et manquants ne sont pas facturés.
8. Une pièce manquante ou une anomalie garde le cycle visible et ouvert.
9. L’historique des transitions est append-only, horodaté et attribué.
10. Le serveur contrôle les permissions et les transitions ; l’interface ne déduit jamais un état.

Exemple de référence : prévision 50, chargement 45, dépôt 43, acceptation 40, retour 3, manquant 2 → commande réelle de 40 bacs.

## 2. Réemploi et compatibilité

- `SchemaCommande` reste la source de la prévision par date, client et produit.
- `PlanningProduction` continue à recevoir les totaux prévisionnels.
- `BonLivraison` reste le support de préparation/livraison et du PDF.
- `CommandeClient` reste l’unique écriture financière.
- Les routes existantes `/api/production/schema-commande` et `/api/production/bons-livraison` sont maintenues pendant la migration.
- Les anciennes écritures journalières par remplacement ne peuvent plus supprimer ou réécrire un cycle ayant dépassé l’état `PREVISION`.
- Aucune seconde table de prévision concurrente n’est créée.

Le serveur expose une vue unifiée « cycle » à partir de ces briques et d’un journal de transitions.

## 3. États

```ts
export const STATUTS_CYCLE_LIVRAISON = [
  "PREVISION",
  "RETENUE_PRODUCTION",
  "PREPAREE",
  "REMISE_MAGASIN",
  "CHARGEE",
  "EN_TOURNEE",
  "EN_ATTENTE_CONFIRMATION",
  "PARTIELLEMENT_ACCEPTEE",
  "ACCEPTEE",
  "RETOUR_TOTAL",
  "ANNULEE",
] as const;
```

Une anomalie n’écrase pas le statut : `anomalieOuverte` et `typesAnomalie` sont exposés séparément. « Facturable » n’est pas un raccourci d’état : `estFacturable` devient vrai uniquement lorsque la conversion serveur a créé la commande.

## 4. Quantités

Chaque ligne produit expose des valeurs distinctes :

```ts
export interface CycleLivraisonLigneDTO {
  produitId: string;
  produitNom: string;
  quantitePrevue: number;
  quantiteRetenueProduction: number | null;
  quantitePreparee: number | null;
  quantiteRemiseMagasin: number | null;
  quantiteChargee: number | null;
  quantiteDeposee: number | null;
  quantiteAcceptee: number | null;
  quantiteRetournee: number | null;
  quantiteManquante: number | null;
}
```

Règles finales :

- toutes les quantités sont des entiers positifs ou nuls ;
- `quantiteDeposee <= quantiteChargee` ;
- `quantiteAcceptee + quantiteRetournee <= quantiteDeposee` ;
- à la confirmation finale, `quantiteManquante = quantiteChargee - quantiteDeposee` ;
- une différence avec la prévision reste visible et requiert une observation lorsque le serveur la demande ;
- après conversion financière, les quantités acceptées sont immuables dans C4.

## 5. Vue unifiée

### `GET /api/production/cycles-livraison?date=AAAA-MM-JJ`

Authentification Bearer. Autorisé avec `PRODUCTION:LECTURE` ou `COMMANDES:LECTURE`.

Réponse `200` :

```ts
export interface CycleLivraisonDTO {
  id: string;                  // identifiant stable, jamais recréé par une transition
  dateLivraison: string;
  client: {
    id: string;
    nom: string;
    typeClientNom: string;
    zoneDepositaireId: string | null;
    zoneDepositaireNom: string | null;
  };
  statut: StatutCycleLivraison;
  version: number;
  lignes: CycleLivraisonLigneDTO[];
  totaux: {
    prevu: number;
    retenuProduction: number | null;
    prepare: number | null;
    remisMagasin: number | null;
    charge: number | null;
    depose: number | null;
    accepte: number | null;
    retourne: number | null;
    manquant: number | null;
  };
  livrePar: string | null;
  bonRetourne: boolean;
  anomalieOuverte: boolean;
  typesAnomalie: TypeAnomalieCycle[];
  estFacturable: boolean;
  commande: {
    id: string;
    numero: number;
    quantiteBacs: number;
  } | null;
  derniereTransitionLe: string | null;
}
```

Réponse :

```json
{
  "date": "2026-08-15",
  "cycles": [],
  "totaux": {
    "prevu": 0,
    "charge": 0,
    "accepte": 0,
    "facturable": 0
  }
}
```

Une liste vide est un succès, jamais une erreur.

### `GET /api/production/cycles-livraison/:id`

Même permission. Renvoie `{ "cycle": CycleLivraisonDTO, "historique": TransitionCycleLivraisonDTO[] }`.

## 6. Saisie de la prévision

La route existante reste canonique pendant C4 :

### `PUT /api/production/schema-commande`

Permission `COMMANDES:ECRITURE` ou permission transitoire `PRODUCTION:ECRITURE` déjà accordée à l’ancien écran.

Le corps reste compatible avec `schemaCommandeJourSchema` :

```json
{
  "date": "2026-08-15",
  "clients": [
    {
      "clientId": "client_1",
      "lignes": [
        { "produitId": "produit_1", "quantite": 50 }
      ]
    }
  ]
}
```

Nouvelles garanties :

- aucune `CommandeClient`, dette, avance ou écriture de caisse n’est créée ;
- les cycles encore en `PREVISION` sont mis à jour sans changer leur identifiant ;
- supprimer du corps un cycle ayant une transition aval renvoie `409 CYCLE_DEJA_DEMARRE` ;
- modifier un cycle aval renvoie `409 PREVISION_VERROUILLEE` ;
- la mise à jour du planning et des prévisions se fait dans une seule transaction.

## 7. Transitions

### `POST /api/production/cycles-livraison/:id/transitions`

Authentification Bearer. En-tête `Idempotency-Key` recommandé et obligatoire pour `CONFIRMER_ACCEPTATION`. Le format et le comportement de rejeu sont ceux de C2. Un rejeu identique ajoute `Idempotency-Replayed: true`.

Le corps est une union discriminée par `action`. `version` est obligatoire et doit correspondre à la version courante du cycle.

### Retenue production

Permission `PRODUCTION:ECRITURE`.

```json
{
  "action": "RETENIR_PRODUCTION",
  "version": 1,
  "lignes": [
    { "produitId": "produit_1", "quantite": 48 }
  ],
  "observations": "Ajustement selon disponibilité"
}
```

### Préparation

Permission `PRODUCTION:ECRITURE`.

```json
{
  "action": "CONFIRMER_PREPARATION",
  "version": 2,
  "lignes": [
    { "produitId": "produit_1", "quantite": 46 }
  ]
}
```

### Remise Production → Magasin

Permission `PRODUCTION:ECRITURE`.

```json
{
  "action": "CONFIRMER_REMISE_MAGASIN",
  "version": 3,
  "lignes": [
    { "produitId": "produit_1", "quantite": 45 }
  ]
}
```

Cette transition prouve la remise interne au Magasin, pas la réception client.

### Chargement Magasin → Chauffeur

Permission `PRODUCTION:ECRITURE`.

```json
{
  "action": "CONFIRMER_CHARGEMENT",
  "version": 4,
  "livrePar": "Nom du chauffeur",
  "lignes": [
    { "produitId": "produit_1", "quantite": 45 }
  ]
}
```

Cette transition prouve seulement le chargement.

### Départ

Permission `PRODUCTION:ECRITURE`.

```json
{
  "action": "CONFIRMER_DEPART",
  "version": 5
}
```

### Dépôt chez le client

Permission `PRODUCTION:ECRITURE` ou délégation serveur explicite.

```json
{
  "action": "SIGNALER_DEPOT",
  "version": 6,
  "lignes": [
    { "produitId": "produit_1", "quantite": 43 }
  ],
  "observations": "Client absent, confirmation attendue"
}
```

Le statut devient `EN_ATTENTE_CONFIRMATION`. Aucun effet financier.

### Acceptation client

Permission `COMMANDES:ECRITURE`. Cette action ne peut pas être validée par le chauffeur seul.

En-tête obligatoire :

```http
Idempotency-Key: acceptation_cycle_123_20260815
```

Corps :

```json
{
  "action": "CONFIRMER_ACCEPTATION",
  "version": 7,
  "lignes": [
    {
      "produitId": "produit_1",
      "quantiteAcceptee": 40,
      "quantiteRetournee": 3
    }
  ],
  "bonRetourne": false,
  "observations": "Confirmation téléphonique ; bon physique attendu"
}
```

Effet transactionnel :

1. validation de la version, de l’état et des quantités ;
2. verrouillage logique du cycle ;
3. calcul de `quantiteManquante` ;
4. création d’une `CommandeClient` à partir du total accepté ;
5. `montantRecu = 0` : aucun cash transporté n’est comptabilisé ;
6. application éventuelle de l’avance déjà officiellement disponible selon `calculerCommande` ;
7. liaison unique et immuable entre cycle et commande ;
8. écriture de l’événement d’audit ;
9. incrément de version.

La date opérationnelle de la commande est `dateLivraison`. `dateCreation` reste l’horodatage réel de la conversion. Les anciennes commandes sans date opérationnelle conservent le comportement historique.

Si le total accepté vaut zéro, aucune commande n’est créée et le statut devient `RETOUR_TOTAL`.

Réponse `201` lors de la première conversion ou `200` lors d’un rejeu :

```json
{
  "cycle": {},
  "commande": {
    "id": "commande_1",
    "numero": 123,
    "quantiteBacs": 40,
    "montantRecu": 0
  }
}
```

## 8. Bons et anomalies

### Retour du bon

`POST /api/production/cycles-livraison/:id/bon-retourne`

Permission `COMMANDES:ECRITURE` ou `PRODUCTION:ECRITURE`.

```json
{ "version": 8 }
```

Le serveur horodate et attribue le retour. Cette action ne modifie ni l’acceptation ni la commande.

### Signaler une anomalie

`POST /api/production/cycles-livraison/:id/anomalies`

```ts
export const TYPES_ANOMALIE_CYCLE = [
  "BON_NON_RETOURNE",
  "ECART_QUANTITE",
  "PRODUIT_ENDOMMAGE",
  "RETOUR_QUALITE",
  "CASH_TRANSPORTE_NON_RECU",
  "AUTRE",
] as const;
```

Corps :

```json
{
  "version": 8,
  "type": "BON_NON_RETOURNE",
  "description": "Bon toujours chez le client"
}
```

Résoudre une anomalie requiert une action dédiée, un commentaire et la permission d’écriture du module propriétaire. L’historique n’est jamais supprimé.

## 9. Erreurs

| HTTP | Code | Sens |
|---|---|---|
| 400 | `DONNEES_INVALIDES` | Corps ou quantités invalides |
| 400 | `CLE_IDEMPOTENCE_INVALIDE` | Format de clé invalide |
| 403 | `ACTION_NON_AUTORISEE` | Permission ou responsabilité insuffisante |
| 404 | `CYCLE_INTROUVABLE` | Cycle absent |
| 409 | `VERSION_OBSOLETE` | Le cycle a changé ; recharger avant de recommencer |
| 409 | `TRANSITION_INTERDITE` | Action impossible depuis l’état courant |
| 409 | `PREVISION_VERROUILLEE` | Une étape aval existe |
| 409 | `CYCLE_DEJA_DEMARRE` | Suppression incompatible avec l’historique |
| 409 | `COMMANDE_JOUR_EXISTANTE` | Une commande manuelle exige un rapprochement |
| 409 | `CLE_IDEMPOTENCE_REUTILISEE` | Même clé, corps différent |
| 409 | `ACCEPTATION_DEJA_CONVERTIE` | La source est déjà liée à une commande |

Format :

```json
{
  "code": "VERSION_OBSOLETE",
  "erreur": "Le cycle a été modifié. Rechargez les données avant de réessayer.",
  "versionCourante": 9
}
```

## 10. Historique

```ts
export interface TransitionCycleLivraisonDTO {
  id: string;
  action: ActionCycleLivraison;
  versionAvant: number;
  versionApres: number;
  utilisateur: { id: string; nom: string } | null;
  date: string;
  observations: string | null;
  donnees: unknown;
}
```

Le journal conserve les données métier nécessaires, mais aucun JWT, mot de passe, jeton de récupération ou secret.

## 11. Notifications

C4 ajoute des événements métier partagés pour :

- prévision transmise ;
- livraison en attente de confirmation ;
- anomalie de livraison ;
- acceptation convertie en commande ;
- bon non retourné.

Les notifications ne contiennent ni détail de mot de passe, ni jeton, ni donnée bancaire. Elles renvoient à l’identifiant stable du cycle.

## 12. Encaissement

La conversion crée la commande avec `montantRecu = 0`. Les paiements officiels continuent d’utiliser le journal `PaiementCommande` et les routes Commandes existantes.

Le rôle autorisé enregistre le paiement seulement après réception et comptage officiels. Un montant déclaré « transporté » reste une anomalie ou une information logistique ; il ne réduit jamais la dette.

## 13. Tests contractuels obligatoires

- prévision 50 : aucune commande et aucun effet financier ;
- transitions jusqu’au dépôt : aucune commande ;
- acceptation 40 sur dépôt 43 : commande de 40 ;
- retour 3 : non facturé ;
- manquant 2 sur chargement 45/dépôt 43 : visible ;
- acceptation totale zéro : aucune commande ;
- rejeu identique : même commande et en-tête de rejeu ;
- deux acceptations concurrentes : une seule commande ;
- même clé avec un autre corps : `409` ;
- version obsolète : `409` sans mutation ;
- tentative chauffeur d’accepter : `403` ;
- bon non retourné : cycle/anomalie visibles ;
- commande manuelle déjà présente : `409` sans double facturation ;
- échec financier intermédiaire : transaction intégralement annulée ;
- date de livraison J+1 conservée même si confirmation ultérieure ;
- non-régression des routes et tests existants.
