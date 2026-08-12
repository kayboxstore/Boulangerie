# Volume 22b — Rôles et permissions

> Deuxième sous-chapitre du Guide complet d'utilisation. Il répond à une question très concrète : *« qu'ai-je le droit de faire, avec le rôle qui m'a été attribué ? »* Le mécanisme technique sous-jacent (la fonction `aAcces`, la matrice `RolePermission`) a déjà été expliqué en détail au Volume 11a ; ce chapitre en présente le résultat pratique, écran par écran, sans revenir sur le code.

## 1. Le principe général : tout est visible, tout n'est pas modifiable

Règle transversale déjà rencontrée au Volume 9 : **tous les modules apparaissent dans le menu pour tout le monde**. Un Caissier voit bien l'entrée « Travailleurs » dans le menu, même s'il n'a aucun droit dessus — elle apparaît simplement grisée, non cliquable. C'est un choix d'interface délibéré (spec, section 2) : chacun garde une vue d'ensemble du système, sans jamais pouvoir y agir en dehors de son périmètre.

Deux niveaux d'accès possibles sur chaque module : **lecture seule** (consulter, jamais modifier) et **écriture** (consulter et modifier). L'écriture inclut toujours la lecture — il n'existe aucun rôle qui puisse modifier un module sans pouvoir le consulter.

## 2. Tableau récapitulatif par rôle

| Rôle | Peut modifier (écriture) | Peut seulement consulter (lecture) |
|---|---|---|
| **Directeur Général (DG)** | *(rien — strictement lecture seule sur toute l'application)* | Tous les modules métier (Commandes, Caisse, Stocks, Production, Fournisseurs, Commissions, Travailleurs...) — **sauf Paramètres**, invisible même en lecture |
| **Admin Principal** | **Absolument tous les modules**, y compris les modules métier, plus Paramètres/Équipe/Activation/État système/Approbations | *(déjà tout en écriture)* |
| **Admin secondaire** | Paramètres, Équipe, Activation, État système, Travailleurs *(certaines actions mises en attente, voir §4)* | **Tous les autres modules**, y compris État système et Approbations |
| **Caissier(ère)** | Caisse | Commandes, Commissions, Production |
| **Chargé des commandes** | Commandes | Commissions |
| **Responsable de production** | Production | — |
| **Responsable Stock/Achats et Fournisseurs** | Stocks, Fournisseurs & achats | — |

Trois écrans échappent entièrement à cette logique de module : **À propos**, **Rapports personnels** et **Assistant** sont accessibles à tout le monde, quel que soit le rôle — leur contenu s'adapte à la personne connectée plutôt que d'être bloqué par une permission (Volume 11z-5, Volume 18c pour la portée des rapports personnels).

## 3. Cas particulier : le Directeur Général

Le DG occupe une position unique dans l'organigramme : il voit la quasi-totalité de l'application, mais **ne modifie jamais rien lui-même** — aucune exception. Vérifié précisément au Volume 11j (Caisse), Volume 11z-1 (Produits) et Volume 11d (Équipe) : le DG peut consulter le catalogue de produits et la liste de l'équipe (qui, quel rôle, actif ou non), mais ne peut ni créer un produit, ni changer un prix, ni créer un compte — cette édition reste réservée aux Admins, via l'écran Paramètres, invisible pour le DG.

## 4. Le rôle Administrateur : deux niveaux distincts sous le même nom

L'organigramme de la spec place l'Administrateur hors de la hiérarchie métier habituelle — jusqu'à 3 comptes Administrateur peuvent exister en même temps, mais un seul à la fois porte le statut particulier d'**Admin Principal** (Volume 11d) ; les autres sont des **Admins secondaires**.

### 4.1 L'Admin Principal : un pouvoir total, mais jamais discret

L'Admin Principal peut écrire sur absolument tous les modules de l'application, y compris ceux qui appartiennent normalement à un autre rôle (par exemple modifier directement une commande client, d'ordinaire réservé au Chargé des commandes). Ce pouvoir n'est cependant jamais silencieux : chaque fois que l'Admin Principal écrit dans un module métier qui n'est pas Paramètres, Équipe ou Travailleurs, une notification temps réel part automatiquement vers le titulaire habituel de ce module et vers le DG (mécanisme détaillé au Volume 18a) — visible dans la cloche de notifications (Volume 11z-4) de ces deux destinataires, avec le module concerné et le fait que l'auteur est l'Admin Principal. La trace complète de l'action reste également consultable dans le Journal d'audit (Volume 11g, accessible aux deux niveaux d'Admin ainsi qu'au DG).

### 4.2 L'Admin secondaire : une écriture cantonnée, et un filet d'approbation

L'Admin secondaire lit absolument tout, comme le DG — y compris des écrans que le DG lui-même ne voit pas (État système, Approbations). Son écriture reste en revanche limitée à Paramètres, Équipe, Activation, État système et Travailleurs. Cinq actions particulièrement sensibles, même dans ce périmètre restreint, ne s'exécutent **jamais directement** quand elles sont déclenchées par un Admin secondaire — elles sont mises en attente jusqu'à validation de l'Admin Principal (mécanisme détaillé au Volume 11f) :

1. Supprimer un utilisateur
2. Créer ou supprimer un compte Admin
3. Modifier les prix ou commissions par type de client (Qualité)
4. Modifier le taux de taxe
5. Modifier les permissions d'un rôle

**Ce qui se passe concrètement à l'écran** : un Admin secondaire qui déclenche l'une de ces cinq actions ne voit **pas** d'erreur ni de blocage — l'action semble s'exécuter, mais elle apparaît en réalité comme une demande « en attente » dans l'écran Approbations, visible par l'Admin Principal, qui reçoit lui-même une notification temps réel instantanée. L'Admin Principal approuve ou rejette la demande en un clic, ce qui déclenche alors réellement l'action (ou l'annule, si elle est rejetée). **Seul l'Admin Principal** peut approuver ou rejeter — un Admin secondaire, même s'il a lui-même le droit théorique sur le module concerné, ne peut jamais valider la demande d'un autre Admin secondaire.

**Une nuance d'affichage à connaître, signalée au Volume 11z-4** : sur l'écran Équipe, la mise en attente d'une action est visuellement distincte d'une exécution immédiate (un message explicite l'indique) — mais sur l'écran Paramètres, la modification du prix ou de la commission d'une Qualité de client utilise le même mécanisme de mise en attente sans que l'écran ne le signale visuellement de la même façon. Un Admin secondaire qui modifie un prix de Qualité depuis Paramètres peut donc avoir l'impression que le changement est immédiat, alors qu'il attend en réalité la validation de l'Admin Principal — à vérifier dans l'écran Approbations en cas de doute.

**Quand l'Admin Principal déclenche lui-même l'une de ces cinq actions**, en revanche, elle s'exécute directement, sans jamais passer par une demande — il n'a pas à s'auto-approuver.

### 4.3 Une action volontairement absente de cette liste

La réinitialisation complète de la base de données (Volume 11z-4, Volume 18a) — qui supprime toutes les données métier — **n'est pas** l'une des cinq tâches critiques ci-dessus, et n'est donc jamais soumise à approbation. C'est un choix assumé de la spec : cette action est considérée comme une procédure d'infrastructure, jamais un simple bouton applicatif gardé par un workflow interne — elle nécessite déjà, par construction, une sauvegarde de sûreté préalable obligatoire (Volume 11z-4) avant que quoi que ce soit ne soit effacé.

## 5. Modifier les permissions d'un rôle : une limite réelle de l'interface actuelle

Un point à connaître si vous cherchez, en tant qu'Admin, un écran pour modifier finement la matrice de permissions d'un rôle (par exemple donner l'écriture sur Commissions au Responsable de production) : **aucune interface de ce type n'a été trouvée** dans l'application (recherche exhaustive menée au Volume 11d). La route serveur qui permettrait ce changement existe et fonctionne (elle fait d'ailleurs partie des 5 tâches critiques ci-dessus), mais aucun bouton ni formulaire ne semble y donner accès depuis l'écran Équipe ou ailleurs. C'est un écart consigné entre la spec (qui liste cette action comme une tâche critique réellement disponible) et le code observé, documenté dans `annexes/ecarts-spec-code.md` — à confirmer avec l'équipe plutôt que tranché unilatéralement par ce livre. En pratique, si un rôle doit changer de permissions aujourd'hui, cela nécessite une intervention technique en dehors de l'interface graphique.

## 6. Résumé du sous-chapitre

| Question | Réponse |
|---|---|
| Un module que je ne peux pas modifier apparaît-il dans le menu ? | Oui, grisé, non cliquable — jamais masqué |
| Le DG peut-il modifier quoi que ce soit ? | Non, strictement lecture seule sur toute l'application, sauf Paramètres qui lui reste invisible |
| Quelle différence entre les deux Admins ? | Le Principal a un pouvoir total mais jamais discret (notifié à chaque intervention hors de son périmètre) ; le secondaire est cantonné à un périmètre réduit, avec 5 actions sensibles soumises à l'approbation du Principal |
| Que se passe-t-il si un Admin secondaire supprime un compte ? | La demande part en attente, visible dans Approbations — rien ne se passe tant que le Principal n'a pas validé |
| Puis-je modifier les permissions d'un rôle depuis l'interface ? | Non — aucune interface trouvée à ce jour, limite réelle signalée dans `annexes/ecarts-spec-code.md` |

**Prochain sous-chapitre** : Volume 22c — Commandes et Clients.
