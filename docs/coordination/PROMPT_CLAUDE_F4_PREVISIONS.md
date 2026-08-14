# Prompt Claude — F4 round 1 : prévisions J/J+1 et cycle de livraison

Travaille dans le dépôt `kayboxstore/Boulangerie`.

## Base et branche

- Base obligatoire : `agent/integration-wave-2@b8f583b4d9563fbfa526f7ff9189ad85a2580ed0`
- Crée : `claude/previsions-ui-f4`
- Ouvre une PR **en brouillon** vers `agent/integration-wave-2`
- Ne fusionne rien.

## Mission de ce round

Démarre le frontend de la vague 2 sans inventer le backend.

1. Audite les écrans et composants existants liés à :
   - Commandes ;
   - Production ;
   - Schéma de commande ;
   - Bons de livraison ;
   - navigation, permissions, i18n et composants Premium.
2. Réutilise l’existant au maximum.
3. Prépare le parcours visuel de prévision saisie en J pour livraison J+1.
4. Prépare l’affichage explicite des étapes :
   - prévision ;
   - retenue production ;
   - préparé ;
   - chargé ;
   - déposé ;
   - en attente de confirmation ;
   - accepté ;
   - retourné ;
   - manquant ;
   - facturable.
5. Enrichis d’abord les composants purs, les libellés, les états de chargement/erreur/vide et les tests frontend.
6. Sur le Bon de livraison, rends les écarts lisibles par client et produit ; ne confonds jamais chargement, dépôt et acceptation.
7. Optimise mobile et ordinateur, clavier, focus, contraste et annonces accessibles.

## Règles métier non négociables

- Une prévision ne crée ni vente, ni dette, ni mouvement d’avance.
- La commande réelle correspond à la quantité livrée **et acceptée**.
- Exemple obligatoire dans les tests/UX : prévision 50, acceptation 40 → 40 facturables.
- Une livraison partielle ne facture que la quantité acceptée.
- Un bon absent ou non retourné reste en attente ; l’anomalie demeure visible.
- Les retours et manquants restent distincts et non facturés.
- La remise au chauffeur ne prouve pas la réception client.
- Le chauffeur transporte ; il ne valide pas officiellement la réception ni l’encaissement.
- Le cash transporté ne diminue pas la dette avant réception officielle.
- La Caisse rapproche et clôture sans changer la commande.

## Limite de ce round

Le contrat C4 n’est pas encore publié dans `docs/api-contracts`. Donc :

- n’invente aucune route ni aucun DTO ;
- n’ajoute aucun faux succès réseau ;
- ne copie pas de types backend « provisoires » présentés comme définitifs ;
- ne crée aucune commande financière côté navigateur ;
- si une intégration nécessite le futur contrat, laisse une frontière explicite et testable, puis documente le point d’attente.

Tu peux utiliser les DTO existants seulement pour auditer et afficher les écrans actuels. La connexion au nouveau cycle attendra le contrat C4.

## Zones autorisées

- `apps/web/src/**`
- tests frontend associés
- `docs/ui/**` si utile

## Zones interdites

- `apps/api/**`
- `prisma/**`
- `packages/shared/**`
- `docs/api-contracts/**`
- `.github/workflows/**`
- `package.json`, fichiers de verrouillage et configuration monorepo

## Validation

Exécute au minimum :

- installation reproductible sans modifier les manifestes ;
- tests frontend ciblés puis suite complète ;
- build ;
- audit des dépendances si disponible sans mutation.

## Rapport attendu

Arrête-toi après ce round et fournis :

- SHA de base exact ;
- SHA HEAD ;
- URL de la PR brouillon ;
- audit de réemploi ;
- liste des fichiers modifiés ;
- tests/build ;
- points qui attendent le contrat C4 ;
- confirmation que toutes les zones interdites sont intactes.

Aucune fusion et aucun travail adjacent.
