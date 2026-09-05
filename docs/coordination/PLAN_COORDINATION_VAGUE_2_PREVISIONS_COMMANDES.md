# Plan de coordination — Vague 2 : prévisions et commandes réelles

Base commune : `agent/integration-wave-2@b8f583b4d9563fbfa526f7ff9189ad85a2580ed0`  
Branche d’intégration : `agent/integration-wave-2`  
Politique : branches courtes, PR en brouillon par défaut, revue avant fusion.

## Objectif de la vague

Livrer un premier flux vertical complet et auditable :

1. le Chargé des commandes saisit en J la prévision du client pour J+1 ;
2. la production consulte les besoins retenus et enregistre le réel produit ;
3. le Magasin confirme ce qu’il remet au chauffeur ;
4. le chauffeur transporte et signale dépôt, retour ou anomalie ;
5. le client ou le rôle autorisé confirme la quantité acceptée ;
6. le serveur convertit une seule fois la quantité acceptée en commande financière ;
7. la Caisse reçoit ensuite les paiements officiels et rapproche la journée.

## Modèle de responsabilité

| Action | Responsable métier | Effet financier |
|---|---|---|
| Saisir/modifier la prévision | Chargé des commandes | Aucun |
| Retenir les besoins de production | Production / responsable autorisé | Aucun |
| Enregistrer production, pertes et qualité | Production | Aucun |
| Confirmer remise au magasin | Production + Magasin | Aucun |
| Confirmer chargement chauffeur | Magasin | Aucun |
| Signaler dépôt, retour ou manquant | Chauffeur / rôle autorisé | Aucun |
| Confirmer quantité acceptée | Client ou rôle explicitement autorisé | Création de la base facturable |
| Enregistrer réception officielle d’argent | Chargé des commandes / Caisse selon permissions | Réduction de dette |
| Rapprocher et clôturer | Caisse | Aucun changement de commande |

## Découpage

### C4 — Socle serveur et contrats (Codex)

Zone propriétaire :

- `prisma/**`
- `apps/api/**`
- `packages/shared/**`
- `docs/api-contracts/**`
- tests backend et partagés
- workflow CI uniquement si indispensable

Livrables :

1. cartographier les données existantes et choisir une évolution additive du Schéma de commande ;
2. publier le contrat API versionné avant l’intégration frontend ;
3. représenter explicitement les états du cycle, sans réduire le cycle à un seul statut ambigu ;
4. tracer les quantités pertinentes par client et produit : prévue, retenue, préparée, chargée, déposée, acceptée, retournée et manquante ;
5. tracer la remise Production → Magasin et la remise Magasin → Chauffeur ;
6. ajouter la confirmation d’acceptation ;
7. convertir l’acceptation en `CommandeClient` dans une transaction idempotente ;
8. garantir qu’une source de facturation ne produit qu’une commande ;
9. préserver les calculs financiers actuels et les règles d’avance/dette ;
10. couvrir permissions, concurrence, rejouabilité, dates Kinshasa, transitions interdites et audit.

Décisions obligatoires avant migration :

- privilégier l’extension du Schéma existant ou une migration progressive, jamais une seconde source de vérité invisible ;
- conserver une référence immuable entre acceptation et commande financière ;
- éviter les routes journalières de remplacement pour les transitions historiques ;
- documenter les compatibilités et la stratégie de reprise des données existantes ;
- ne pas déduire automatiquement un paiement d’un montant simplement transporté.

Tests C4 minimaux :

- prévision créée/modifiée : aucune commande, dette ou avance modifiée ;
- chargement et dépôt : aucun effet financier ;
- acceptation partielle : seule la somme acceptée devient facturable ;
- retour/manquant : visible et non facturé ;
- confirmation rejouée : même résultat, aucune double commande ;
- deux confirmations concurrentes : une seule conversion ;
- échec pendant conversion : transaction intégralement annulée ;
- transition obsolète ou interdite : refus explicite ;
- permissions par module/rôle ;
- date J/J+1 calculée avec les utilitaires existants ;
- non-régression de la suite actuelle.

### F4 — Parcours frontend (Claude)

Branche : `claude/previsions-ui-f4`  
Point de départ : `agent/integration-wave-2@b8f583b4d9563fbfa526f7ff9189ad85a2580ed0`

Zone propriétaire :

- `apps/web/src/**`
- tests frontend
- `docs/ui/**` si nécessaire

Zones interdites :

- `apps/api/**`
- `prisma/**`
- `packages/shared/**`
- `docs/api-contracts/**`
- `.github/workflows/**`
- `package.json` et fichiers de verrouillage

Démarrage autorisé immédiatement, avant contrat :

1. auditer et réutiliser `Commandes`, `Production`, `BonsLivraison`, la navigation et les composants Premium ;
2. proposer le parcours mobile/desktop avec les états séparés ;
3. préparer les composants d’affichage purs, les libellés i18n et les tests de rendu ;
4. réutiliser le Schéma de commande comme point d’entrée de la prévision, en remplaçant seulement le vocabulaire visible là où il est trompeur ;
5. préparer l’enrichissement de `BonsLivraison` autour de la chronologie et des écarts.

Interdit avant publication du contrat C4 :

- inventer une route, un DTO ou un statut backend ;
- appeler un endpoint fictif ;
- simuler un succès serveur ;
- recopier localement les types partagés définitifs ;
- créer une commande financière depuis le navigateur.

Attentes UX :

- montrer séparément prévu, retenu, préparé, chargé, déposé, accepté, retourné, manquant et facturable ;
- mettre en évidence J et J+1 ;
- afficher les écarts sans les masquer par un total ;
- permettre la livraison partielle et expliquer ce qui sera facturé ;
- conserver un état d’attente si le bon n’est pas revenu ;
- ne jamais présenter « remis au chauffeur » comme « livré au client » ;
- ne jamais présenter le cash transporté comme encaissé ;
- garder les actions critiques confirmables, accessibles au clavier et lisibles sur mobile.

### I4 — Intégration

Responsable : Codex après revue de C4 et F4.

Ordre :

1. fusionner C4 dans `agent/integration-wave-2` après CI et revue ;
2. rebaser F4 sur la nouvelle tête ;
3. terminer l’intégration réseau de F4 uniquement contre `docs/api-contracts` ;
4. fusionner F4 dans `agent/integration-wave-2` après CI et revue ;
5. exécuter la validation complète et les scénarios métier ;
6. ouvrir la PR d’intégration vers `main-a7fm5x`, en brouillon ;
7. attendre l’autorisation explicite avant la fusion finale.

## Contrat de coordination

- Chaque rapport donne le SHA de base et le SHA HEAD.
- Chaque tranche liste précisément les fichiers modifiés.
- Toute extension de périmètre est arrêtée et signalée.
- Aucun agent ne modifie la zone propriétaire de l’autre.
- Les contrats partagés sont publiés par C4 ; F4 les consomme.
- Une divergence fonctionnelle est résolue dans le contrat, pas par un contournement frontend.
- Les PR restent en brouillon jusqu’à validation de leur propriétaire de revue.
- Les anciennes PR déjà absorbées dans la base ne sont pas fusionnées à nouveau.

## Critères d’acceptation de la vague

- Aucune prévision ne crée d’argent ou de dette.
- La quantité facturée égale exactement la quantité acceptée.
- Une acceptation ne peut être facturée qu’une fois.
- Les écarts et pièces manquantes restent visibles.
- Les remises entre responsabilités sont horodatées et attribuées.
- Les permissions sont appliquées côté serveur.
- Les calculs financiers restent côté serveur.
- Le parcours fonctionne sur mobile et ordinateur.
- Les tests existants et nouveaux passent.
- Migration, build et audit de dépendances réussissent.
- Aucun secret, JWT ou donnée financière sensible n’est exposé dans les clés de cache, logs ou notifications.
