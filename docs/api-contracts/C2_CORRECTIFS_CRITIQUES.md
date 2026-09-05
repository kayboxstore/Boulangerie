# Contrats API C2 — correctifs critiques

**Branche :** `codex/backend-critical-c2`  
**Base :** `agent/integration-wave-1@04b87de1fb3ada819d0a0806117d523d5d327b17`  
**Fuseau opérationnel :** `Africa/Kinshasa`

## 1. Archivage des produits

### `GET /api/produits`

Par défaut, la réponse ne contient que les produits actifs.

Pour une vue administrative incluant l'historique :

```http
GET /api/produits?inclureArchives=true
```

### `DELETE /api/produits/:id`

La route ne supprime plus aucune ligne. Elle positionne :

- `actif = false` ;
- `archiveLe` à l'instant serveur ;
- `archiveParId` à l'utilisateur connecté.

Réponse : `204 No Content`. Répéter l'appel sur un produit déjà archivé reste sans effet et renvoie `204`.

### Réactivation

```http
PUT /api/produits/:id
Content-Type: application/json

{ "actif": true }
```

La réactivation efface `archiveLe` et `archiveParId`. Créer un nouveau produit portant le nom d'un produit archivé renvoie `409` afin de préserver l'historique.

## 2. Validation stricte

Les champs de date `AAAA-MM-JJ` valident désormais le calendrier réel. Par exemple, `2026-02-29` et `2026-04-31` sont refusés avec `400`.

Les nombres non finis (`Infinity`, `-Infinity`, `NaN`) sont refusés par les schémas partagés. Les contraintes PostgreSQL protègent aussi les montants, quantités, taux et soldes contre les valeurs négatives ou incohérentes.

Les filtres `du` / `au` vérifient également que `du <= au`.

## 3. Idempotence des écritures sensibles

Routes couvertes :

- `POST /api/commandes` ;
- `POST /api/commandes/:id/reglements` ;
- `POST /api/caisse/depenses`.

Le client peut fournir :

```http
Idempotency-Key: 0d8b4e5a-aaaa-bbbb-cccc-123456789012
```

La clé est optionnelle pour préserver les clients existants. Elle doit contenir entre 8 et 128 caractères parmi lettres, chiffres, `.`, `_`, `:` et `-`.

Garanties :

1. l'effet métier et la mémorisation de la réponse sont dans la même transaction sérialisable ;
2. une répétition identique renvoie exactement le premier statut et le premier corps ;
3. un rejeu porte l'en-tête `Idempotency-Replayed: true` ;
4. aucune notification métier n'est réémise lors d'un rejeu ;
5. réutiliser une clé avec des données différentes renvoie :

```json
{
  "erreur": "Cette Idempotency-Key a déjà été utilisée avec des données différentes",
  "code": "CLE_IDEMPOTENCE_REUTILISEE"
}
```

Statut : `409 Conflict`.

Une clé mal formée renvoie `400` avec le code `CLE_IDEMPOTENCE_INVALIDE`.

## 4. Jour opérationnel Lomoto

Les résumés, commandes du jour, règlements, dépenses, délégations et filtres concernés utilisent le jour civil de Kinshasa. Une journée va de `23:00:00.000Z` la veille à `22:59:59.999Z` le jour indiqué.

Les colonnes PostgreSQL `DATE` restent stockées comme dates civiles stables, sans conversion dépendante du fuseau du serveur.

## 5. Sessions et remises de caisse

C2 prépare les modèles et contrats partagés, sans exposer encore de nouvel endpoint ni modifier le calcul du registre actuel :

- `SessionCaisse` : une session unique par date, ouverture, fermeture, soldes théorique/compté et écart ;
- `RemiseCaisse` : montant, remettant figé, réceptionnaire, référence facultative et observation ;
- statuts : `OUVERTE` et `FERMEE`.

Les futures routes devront utiliser `sessionCaisseOuvertureSchema`, `sessionCaisseFermetureSchema` et `remiseCaisseCreateSchema` publiés dans `@lomoto/shared`.

## 6. Contraintes de base

La migration C2 ajoute notamment :

- une seule commande par client et jour de Kinshasa ;
- une seule dépense farine par date ;
- montants et quantités positifs ou non négatifs selon leur nature ;
- cohérence entre l'état actif et les métadonnées d'archivage ;
- cohérence obligatoire d'une session de caisse fermée ;
- montant strictement positif pour chaque remise.

## 7. Compatibilité et retour arrière

Aucun fichier frontend n'est modifié. Sans `Idempotency-Key`, les appels existants restent acceptés.

Le retour arrière applicatif se fait par revert des commits C2. Après application de la migration en production, supprimer les nouvelles tables ou colonnes ferait perdre l'historique d'idempotence, d'archivage et de caisse : une sauvegarde doit précéder tout rollback SQL.
