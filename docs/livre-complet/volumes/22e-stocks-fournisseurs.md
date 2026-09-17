# Volume 22e — Matières premières, Fournisseurs et Catalogue produits

> Cinquième sous-chapitre du Guide complet d'utilisation. Trois modules qui s'enchaînent dans l'ordre réel du métier : on achète une matière première à un fournisseur, ce qui augmente le stock ; on vend des produits finis dont le catalogue est géré séparément. Comportement déjà vérifié techniquement au Volume 11z-1.

## 1. Le stock de matières premières

L'écran Stocks répond à une question simple : combien reste-t-il de farine, de beurre, de sucre ? Chaque matière première affiche sa quantité actuelle, avec un seuil d'alerte configurable.

### 1.1 Enregistrer un mouvement manuel

Au-delà des mouvements automatiques (réception fournisseur, décrémentation par la production, Volume 22d), un mouvement peut aussi être saisi **manuellement** — pour corriger un inventaire, enregistrer une casse, ou tout ajustement qui ne provient ni d'un achat ni d'une production. Un point de sécurité à connaître : une sortie manuelle qui dépasserait le stock actuellement disponible est **refusée** avec un message explicite — le stock ne peut jamais devenir négatif, quelle que soit la façon dont le mouvement est saisi.

### 1.2 L'alerte de seuil : au moment du franchissement, pas en continu

Une notification part **au moment précis** où le stock d'une matière passe au-dessus puis en dessous de son seuil d'alerte — pas à chaque mouvement tant qu'elle reste sous ce seuil. Concrètement : si le stock de farine passe de 25 kg à 17 kg (sous le seuil de 20 kg), une notification part. Une heure plus tard, un nouveau retrait le fait passer de 17 kg à 15 kg — toujours sous le seuil, mais **aucune deuxième notification** ne part, puisque le stock était déjà en dessous.

**Ce qui reste visible en continu, en revanche** : un bandeau d'alerte permanent en haut de l'écran Stocks liste toutes les matières actuellement sous leur seuil — même si la notification ponctuelle a été manquée (par exemple parce que personne n'était connecté au moment du franchissement), ce bandeau reste visible tant que la situation n'est pas résolue par un réapprovisionnement.

### 1.3 Supprimer une matière première

Une matière première ayant déjà un historique de mouvements ne peut pas être supprimée — l'application refuse explicitement, pour ne jamais perdre la trace d'un historique déjà enregistré. Si une matière n'est vraiment plus utilisée, la solution consiste à ne plus l'utiliser dans les mouvements futurs plutôt qu'à la supprimer.

## 2. Les fournisseurs et les bons de commande

### 2.1 Passer une commande

Un bon de commande fournisseur liste une ou plusieurs matières premières avec les quantités souhaitées — chaque matière ne peut apparaître qu'une seule fois par bon (une quantité groupée plutôt que deux lignes séparées pour la même matière). Tant que la commande n'a pas été marquée comme reçue, elle reste au statut **En attente**, et **n'affecte le stock d'aucune manière** — passer une commande n'augmente rien tant que la marchandise n'a pas été physiquement réceptionnée.

### 2.2 Réceptionner une commande

Marquer une commande comme reçue déclenche, en une seule opération, l'augmentation du stock de **chacune** des matières premières de la commande — c'est le seul moment où une commande fournisseur influence réellement les quantités en stock. Une notification part également, résumant les matières livrées et le montant total.

**Un point de sécurité à connaître** : si deux personnes tentent de marquer la même commande comme reçue au même moment (par exemple sur deux appareils différents), une seule des deux tentatives réussit — la seconde reçoit un message d'erreur explicite indiquant que la commande a déjà été reçue, plutôt que de risquer de compter la même livraison deux fois dans le stock.

### 2.3 Annuler ou supprimer

Une commande encore **En attente** peut être annulée librement. Une commande déjà marquée **Reçue**, en revanche, fait partie de l'historique définitif et ne peut plus être supprimée — de la même façon qu'une matière première avec un historique ne peut pas être effacée (§1.3), un fournisseur ayant déjà des commandes enregistrées ne peut pas non plus être supprimé de la liste.

## 3. Le catalogue produits

Le catalogue des produits vendus (types de pain, prix par article) est géré depuis l'écran **Paramètres**, pas depuis un écran dédié — et son édition est réservée aux Administrateurs uniquement (ni le Directeur Général, ni aucun autre rôle métier ne peut modifier le catalogue, même s'ils peuvent tous le consulter librement, puisque la lecture du catalogue n'est soumise à aucune restriction particulière).

### 3.1 Le taux de taxe : une action à part

Modifier le **taux de taxe** d'un produit est l'une des cinq actions les plus sensibles de l'application (Volume 22b) : si c'est un Admin secondaire qui la déclenche, elle part en attente de validation de l'Admin Principal, exactement comme les autres tâches critiques. Modifier le **nom ou le prix** d'un produit, en revanche, reste une écriture directe, sans passer par cette approbation.

**Une limite réelle de l'interface actuelle, à connaître** : à ce jour, aucun écran de l'application n'envoie de changement de taux de taxe — le formulaire d'édition d'un produit ne propose même pas ce champ. Le mécanisme serveur qui gérerait cette approbation existe et fonctionne, mais rien dans l'interface graphique ne permet aujourd'hui de le déclencher. Ce n'est pas un écart entre la spec et le code (rien n'exige que ce champ soit éditable depuis cet écran précis), simplement une fonctionnalité correctement construite côté serveur mais non exposée côté écran.

## 4. Résumé du sous-chapitre

| Question | Réponse |
|---|---|
| Passer une commande fournisseur augmente-t-il le stock immédiatement ? | Non — seule la réception effective augmente le stock |
| Une alerte de seuil se répète-t-elle tant que le stock reste bas ? | Non, une seule fois au moment du franchissement — le bandeau permanent prend le relais pour le suivi continu |
| Puis-je supprimer une matière première ou un fournisseur déjà utilisé ? | Non, l'historique est protégé — refus explicite |
| Qui peut modifier le catalogue produits ? | Les Administrateurs uniquement, tout le monde peut le consulter |
| Puis-je changer le taux de taxe d'un produit depuis l'écran Produits ? | Pas actuellement — le champ n'apparaît pas dans le formulaire d'édition |

**Prochain sous-chapitre** : Volume 22f — Caisse (registre journalier).
