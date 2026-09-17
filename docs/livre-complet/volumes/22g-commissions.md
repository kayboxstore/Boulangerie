# Volume 22g — Commissions

> Septième sous-chapitre du Guide complet d'utilisation, volontairement court — le module Commissions est le plus petit écran de l'application, et son fonctionnement se résume en quelques règles simples. Comportement déjà vérifié techniquement au Volume 11i.

## 1. Un écran de consultation, jamais de saisie

L'écran Commissions ne comporte aucun bouton de création ni de modification — c'est une simple liste, filtrable par période, des commandes qui génèrent une commission (les commandes de clientes « Maman »). Rien ne se saisit ici : chaque commission provient automatiquement d'une commande déjà enregistrée depuis l'écran Commandes (Volume 22c) — il n'existe même aucune donnée stockée séparément pour les commissions, tout est recalculé à chaque consultation de l'écran à partir des commandes existantes.

**Conséquence pratique** : si une nouvelle catégorie de client venait un jour à générer elle aussi une commission, ses commandes apparaîtraient automatiquement dans cet écran, sans qu'aucune configuration supplémentaire ne soit nécessaire — le système suit la règle « toute Qualité avec une commission par bac » plutôt que de reconnaître spécifiquement le nom « Maman ».

## 2. « Montant total payé » : une colonne qui demande une explication

La colonne « Montant total payé » de cet écran ne correspond pas toujours exactement à ce qui a été physiquement remis en espèces au moment précis de la commande — et c'est volontaire. La règle :

- **Commande entièrement soldée** (aucune dette restante) → la colonne affiche le montant brut complet, **même si une partie de ce montant provenait d'une avance** générée par une commande précédente. Du point de vue de cet écran, une commande soldée est considérée comme payée à 100 %, peu importe que l'argent soit arrivé ce jour-là ou lors d'une commande antérieure — l'argent a bel et bien été remis à l'entreprise à un moment donné.
- **Commande avec une dette encore ouverte** → la colonne affiche uniquement ce qui a réellement été versé jusqu'à présent, sans rien ajouter.

**Un point important à retenir** : cette règle ne concerne que l'affichage de la colonne « Montant total payé » — elle n'a **aucun effet** sur le montant de la commission elle-même. Une cliente qui a reçu ses bacs mais n'a pas encore terminé de payer génère malgré tout, immédiatement, la commission correspondante, calculée uniquement sur le nombre de bacs commandés.

## 3. Filtrer et exporter

Deux champs de date permettent de restreindre la liste à une période précise ; sans filtre, toutes les commandes concernées s'affichent, avec le total de commission de la période mis en évidence. Le même mécanisme d'export (impression, PDF, envoi par e-mail) que sur les autres écrans de rapport (Volume 22l) est disponible ici — le document exporté rappelle explicitement la période sélectionnée, pour qu'un document imprimé reste compréhensible même une fois détaché de l'écran qui l'a produit.

## 4. Résumé du sous-chapitre

| Question | Réponse |
|---|---|
| Puis-je créer ou modifier une commission depuis cet écran ? | Non — tout provient automatiquement des commandes déjà enregistrées |
| Une commande soldée grâce à une avance s'affiche-t-elle comme payée ? | Oui, intégralement, dans la colonne « Montant total payé » |
| Une dette encore ouverte réduit-elle la commission ? | Non — la commission ne dépend que du nombre de bacs, jamais de la dette |

**Prochain sous-chapitre** : Volume 22h — Travailleurs et Paie.
