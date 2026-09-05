# Audit court — Vague 2 : prévisions et commandes réelles

Date : 14 août 2026  
Base auditée : `main-a7fm5x@b8f583b4d9563fbfa526f7ff9189ad85a2580ed0`

## Conclusion

Le dépôt contient déjà trois briques utiles, mais elles ne forment pas encore un cycle métier sûr :

1. le **Schéma de commande** peut porter la prévision communiquée en J pour J+1 ;
2. le **Planning de production** porte les besoins prévus et les quantités prévues par produit ;
3. le **Bon de livraison** porte des quantités livrées saisies par client et produit.

La **Commande client**, elle, est financière dès sa création : elle calcule immédiatement montant brut, avance, montant à percevoir, montant reçu et dette. Elle ne doit donc pas recevoir une prévision, une quantité chargée ou une quantité déposée non confirmée.

L’écart à corriger est l’absence d’un lien serveur explicite, auditable et idempotent entre :

`prévision → retenue production → préparé → chargé → déposé → accepté/retourné/manquant → facturable`

## Réemploi identifié

| Brique existante | Emplacement | Réemploi recommandé | Limite actuelle |
|---|---|---|---|
| Schéma de commande | `SchemaCommande`, `SchemaCommandeLigne`, routes Production | Prévision client par date et produit | Le vocabulaire parle de « commande » et aucun statut de cycle n’est enregistré |
| Planning de production | `PlanningProduction`, `PlanningLigneProduit` | Besoin retenu pour production | Aucune provenance client ni transition formelle depuis la prévision |
| Production | `Production` | Réel produit, pertes, dons et ingrédients utilisés | Pas de remise Production → Magasin explicitement tracée |
| Bon de livraison | `BonLivraison`, `BonLivraisonLigne` | Support de préparation, chargement et tournée | Une seule quantité par produit ; pas d’acceptation client ni d’état de livraison |
| Commande client | `CommandeClient`, `PaiementCommande`, `POST /api/commandes` | Écriture financière finale | Créée directement à partir d’une quantité saisie, sans source de livraison acceptée |

## Constats de code

### Prévision et planning

Dans `packages/shared/src/index.ts` :

- `schemaCommandeJourSchema` remplace, pour une date, les quantités par client et produit ;
- `SchemaCommandeJourDTO` fournit les totaux par produit ;
- `planningCreateSchema` enregistre `datePrevue`, `nombreBacsCommandes`, les lignes par produit et les ingrédients prévus.

Dans `apps/api/src/routes/production.ts`, les routes de planning et du Schéma existent déjà. Cette base doit être étendue sans créer une seconde saisie de prévision concurrente.

### Livraison

Le contrat `bonLivraisonJourSchema` enregistre par client :

- les quantités par produit ;
- les bacs vides ;
- la personne ayant livré ;
- des observations.

`BonLivraisonClientDTO.totalCommande` n’est qu’un indice visuel comparant le bon au Schéma. Le commentaire partagé précise volontairement qu’il n’existe aucun lien rigide entre les deux.

Dans `apps/web/src/pages/BonsLivraison.tsx`, l’écran permet déjà la saisie, la comparaison et l’impression. Il doit être réutilisé et enrichi, pas remplacé.

### Commande et dette

Dans `apps/api/src/routes/commandes.ts`, `POST /api/commandes` appelle immédiatement le calcul financier puis crée ou modifie `CommandeClient`. Le contrat `commandeCreateSchema` exige `quantiteBacs` et `montantRecu`.

Le point d’entrée `GET /api/commandes/livraisons-du-jour` est lui aussi décrit comme un simple indice, sans lien métier rigide.

Conséquence : aujourd’hui, rien n’empêche qu’une quantité prévisionnelle ou seulement livrée soit saisie comme commande financière. Le serveur ne possède pas de preuve unique d’acceptation client.

## Invariants de la vague 2

1. Une prévision ne crée ni vente, ni dette, ni consommation d’avance.
2. La quantité retenue pour production reste distincte de la quantité initialement annoncée.
3. La remise Production → Magasin est tracée.
4. La remise Magasin → Chauffeur prouve le chargement, pas la réception client.
5. Le dépôt chez le client reste `EN_ATTENTE_CONFIRMATION` tant qu’il n’est pas confirmé.
6. La quantité acceptée par le client est la seule base facturable.
7. En livraison partielle, seule la quantité acceptée devient une commande réelle.
8. Les retours, manquants et écarts restent visibles ; ils ne sont pas absorbés dans la dette.
9. Un bon manquant ou non retourné maintient la tournée ouverte et l’anomalie visible.
10. Le cash transporté par le chauffeur ne diminue pas la dette avant réception et comptage officiels.
11. Une livraison acceptée ne peut être convertie qu’une fois, même si la requête est rejouée.
12. Calculs financiers, permissions, validation partagée, transactions, notifications et fuseau de Kinshasa restent contrôlés côté serveur.

## Risques principaux

- **Double vocabulaire** : ajouter une nouvelle table de prévision sans traiter le Schéma existant créerait deux sources de vérité.
- **Double facturation** : une conversion non idempotente pourrait créer plusieurs commandes pour la même acceptation.
- **Écrasement d’historique** : les routes journalières actuelles « remplacent l’ensemble » ; elles ne conviennent pas telles quelles à un journal de transitions.
- **Responsabilités confondues** : le chauffeur ne doit ni accepter pour le client, ni enregistrer officiellement le paiement.
- **Migration destructive** : renommer ou supprimer immédiatement les briques existantes augmenterait inutilement le risque.

## Décision de coordination

La vague 2 sera additive et livrée par tranches :

- le backend définit d’abord le contrat de cycle et la conversion financière ;
- le frontend peut démarrer immédiatement l’inventaire UI et les états visuels sur la base commune ;
- toute intégration réseau du nouvel écran attend la publication du contrat API ;
- les anciennes fonctions restent disponibles jusqu’à migration vérifiée ;
- aucune fusion de tranche n’est automatique.
