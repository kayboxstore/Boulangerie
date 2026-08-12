# Volume 22c — Commandes et Clients

> Troisième sous-chapitre du Guide complet d'utilisation. L'écran Commandes est le cœur quotidien de l'application pour le Chargé des commandes et le Caissier(ère) — ce chapitre explique comment l'utiliser, avec le même exemple chiffré que celui donné par `docs/spec-boulangerie.md`, déjà vérifié techniquement au Volume 11h.

## 1. Enregistrer une commande

Depuis l'écran Commandes, saisir une nouvelle commande demande trois informations : le client, le nombre de bacs, et le montant reçu. Un aperçu du résultat (montant à percevoir, dette éventuelle, avance générée) s'affiche **instantanément** pendant la saisie, avant même d'enregistrer quoi que ce soit — ce n'est pas une estimation approximative : c'est exactement le même calcul qui sera exécuté par le serveur au moment de la validation (Volume 11h, §5.11), donc ce qui s'affiche à l'écran est fiable.

**Un pré-remplissage pratique** : si un Bon de livraison a déjà été rempli pour ce client aujourd'hui (module Production, Volume 22d), le champ « bacs reçus » se remplit automatiquement avec le total livré, à titre indicatif seulement — le champ reste librement modifiable, ce pré-remplissage n'empêche jamais de le corriger.

## 2. Comprendre avance, dette et trop-perçu

La règle centrale de l'application (spec, section 3.4) : l'avance déjà disponible d'un client est **automatiquement déduite** avant même d'afficher ce qu'il reste à percevoir — personne n'a besoin de calculer ou de suivre ce solde manuellement, il se reconstitue tout seul à chaque commande.

**Trois cas possibles**, illustrés avec l'exemple exact donné par la spécification, repris et vérifié au Volume 11h : un client Dépositaire (4 100 Fc/bac), sans avance préalable, commande 2 bacs (soit 8 200 Fc dus) :

| Montant reçu | Ce qui se passe | Résultat affiché |
|---|---|---|
| 8 200 Fc (montant exact) | Rien à percevoir, rien en trop | Montant à percevoir : 0 Fc, dette : 0 Fc |
| 3 000 Fc (moins que dû) | Il manque de l'argent | **Dette** de 5 200 Fc, à régler plus tard (§4) |
| 5 000 Fc pour 1 bac (4 350 Fc dû) | Trop payé | **Avance** de 650 Fc, automatiquement disponible pour la prochaine commande de ce client |

Une dette ou une avance générée aujourd'hui **ne disparaît jamais toute seule** : la dette attend un règlement (§4), l'avance sera automatiquement proposée en déduction dès la prochaine commande du même client — sans qu'il soit nécessaire d'y penser au moment de la saisie suivante.

## 3. Une commande par client et par jour — que faire en cas de doublon

Un même client ne peut jamais avoir deux commandes enregistrées le même jour — la règle vaut pour les trois types de clients. Si une saisie arrive pour un client qui a déjà une commande aujourd'hui, l'application ne l'enregistre **jamais automatiquement** comme une commande séparée : elle interrompt la saisie avec une fenêtre de choix qui affiche la commande déjà existante, avec deux options chiffrées à l'avance :

- **Modifier** — additionne la nouvelle saisie à la commande déjà enregistrée (bacs et montant reçu s'additionnent).
- **Remplacer** — la nouvelle saisie remplace entièrement l'ancienne, comme si la première n'avait jamais eu lieu.

**Exemple concret** (repris tel quel de la spec) : le client a déjà la commande n°12 aujourd'hui — 50 bacs, 205 000 Fc reçus. Une deuxième saisie arrive pour lui : 10 bacs, 41 000 Fc reçus. La fenêtre de choix affiche alors :
- **Modifier** → 60 bacs, 246 000 Fc reçus (50+10, 205 000+41 000)
- **Remplacer** → 10 bacs, 41 000 Fc reçus (la première saisie est oubliée)

Dans les deux cas, c'est **toujours la même commande n°12** qui est mise à jour — jamais une nouvelle commande créée à côté.

**Un garde-fou à connaître** : si la commande n°12 a déjà reçu un règlement de dette (§4), l'option **Remplacer** est refusée (avec un message explicite invitant à utiliser Modifier à la place) — remplacer effacerait le montant reçu d'origine, ce qui rendrait incohérent l'argent déjà réellement encaissé. **Modifier** reste toujours possible, puisqu'il additionne plutôt qu'il n'efface.

## 4. Régler une dette

Une commande avec une dette encore ouverte peut recevoir un ou plusieurs règlements ultérieurs (le client revient payer ce qu'il devait). Chaque règlement réduit la dette affichée d'autant, jusqu'à zéro. Un point important pour la confiance dans les chiffres affichés : régler une ancienne commande **ne change jamais rétroactivement le prix** auquel elle a été facturée, même si le tarif de la Qualité du client a changé entre-temps — le prix reste celui du jour où la commande a été passée.

**Sur le registre de Caisse** (Volume 22f), un principe déjà établi mérite d'être rappelé ici pour éviter toute confusion : l'argent reçu à la création d'une commande et un règlement encaissé plus tard sur la même dette apparaissent dans deux colonnes différentes du registre (« Entrées » vs « Dettes payées ») — jamais dans la même, et jamais comptés deux fois.

## 5. Gérer les clients

### 5.1 Création rapide depuis le formulaire de commande

Pour ne pas interrompre la saisie d'une commande quand le client n'existe pas encore, un dialogue de création rapide est accessible directement depuis le formulaire — une fois le client créé, il est automatiquement sélectionné, sans avoir à ressaisir sa recherche.

### 5.2 La fiche client complète

Un écran dédié (accessible depuis Commandes) liste tous les clients, avec recherche par nom. Chaque fiche comporte le nom, la Qualité (Dépositaire, Maman, ou Vente cash), et — uniquement pour les Dépositaires — une **Zone de dépôt** facultative (un regroupement purement organisationnel, par exemple « Centre-ville », sans effet sur les prix, qui sert seulement à trier l'affichage du Schéma de commande et du Bon de livraison, Volume 22d). Le champ Zone n'apparaît que si la Qualité choisie est Dépositaire — changer la Qualité vers un autre type efface automatiquement la zone associée.

**Créer une zone à la volée** : si la zone recherchée n'existe pas encore, elle peut être créée directement depuis la fiche client, sans avoir besoin d'un accès au module Production — un Chargé des commandes peut donc gérer les zones sans jamais quitter son propre écran.

### 5.3 Les Qualités (Dépositaire / Maman / Vente cash)

Le prix par bac et la commission éventuelle sont attachés à la **Qualité** du client, pas au client individuellement — modifier le prix d'une Qualité (réservé aux Admins, depuis l'écran Paramètres, et soumis à l'approbation de l'Admin Principal si c'est un Admin secondaire qui le fait, Volume 22b) affecte **uniquement les commandes futures** : toute commande déjà enregistrée garde le prix auquel elle a été facturée, pour toujours.

## 6. Résumé du sous-chapitre

| Question | Réponse |
|---|---|
| Comment savoir ce que je vais devoir facturer avant de valider ? | L'aperçu à l'écran est calculé en temps réel avec exactement la même formule que le serveur |
| Un client peut-il avoir deux commandes le même jour ? | Non — une fenêtre propose Modifier (additionner) ou Remplacer (écraser) sur la commande existante |
| Puis-je remplacer une commande déjà réglée ? | Non, l'option est bloquée — seul Modifier reste disponible |
| Une avance ou une dette générée aujourd'hui s'efface-t-elle toute seule ? | Non — l'avance sera automatiquement déduite à la prochaine commande, la dette attend un règlement explicite |
| Puis-je créer un client sans quitter la commande en cours ? | Oui, via le dialogue de création rapide |
| Une modification de prix affecte-t-elle les commandes déjà passées ? | Non, jamais — seules les commandes futures sont concernées |

**Prochain sous-chapitre** : Volume 22d — Production (Planning, Schéma de commande, Bon de livraison).
