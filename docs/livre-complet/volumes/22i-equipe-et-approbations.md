# Volume 22i — Équipe et Approbations

> Neuvième sous-chapitre du Guide complet d'utilisation. Le Volume 22b a déjà expliqué *qui* peut faire *quoi* dans l'application ; ce chapitre explique *comment* gérer l'équipe au quotidien depuis l'écran Équipe — créer et désactiver des comptes, transférer le statut d'Administrateur Principal, déléguer temporairement un droit, et suivre une demande d'approbation des deux côtés du processus. Comportement déjà vérifié techniquement aux Volumes 11d, 11e et 11f.

## 1. Créer un compte : toujours depuis une fiche existante

Rappel déjà posé au Volume 22h : un compte de connexion ne se crée jamais en saisissant une adresse e-mail au clavier. Il faut d'abord une fiche Travailleur dont l'adresse professionnelle est active — l'e-mail du compte est automatiquement celui de cette fiche, non modifiable ensuite. Trois vérifications protègent cette création : la fiche doit exister, ne pas déjà avoir de compte lié, et son e-mail professionnel doit être actif.

**Créer un compte Administrateur** obéit en plus à une limite stricte : au plus 3 comptes Administrateur en même temps (1 Principal + 2 secondaires) — au-delà, la création est refusée avec un message explicite. Cette limite ne s'applique à aucun autre rôle.

## 2. Activer et désactiver un compte

Désactiver un compte est une action **directe**, jamais soumise à approbation — n'importe quel Admin peut la déclencher immédiatement. Un compte désactivé ne peut plus se connecter, mais **rien de son historique n'est supprimé** : ses commandes, ses pointages, ses actions passées restent intacts et consultables, exactement comme s'il était toujours actif. C'est la méthode recommandée pour un départ ou une absence prolongée, plutôt que la suppression.

**Une seule limite** : il est impossible de désactiver son propre compte — cela laisserait potentiellement l'application sans personne capable de le réactiver.

## 3. Réaffecter un compte à un autre rôle

Changer le rôle d'un compte existant est possible à tout moment, avec une exception : **le compte qui porte actuellement le statut d'Administrateur Principal ne peut pas être réaffecté** à un autre rôle tant que ce statut n'a pas d'abord été transféré à quelqu'un d'autre (§4). Si la réaffectation change effectivement le rôle, la personne concernée reçoit une notification temps réel l'informant de son changement d'affectation.

## 4. Transférer le statut d'Administrateur Principal

Un point de sécurité important à connaître : **seul l'Administrateur Principal en exercice peut transférer ce statut** à un autre compte Administrateur — et à personne d'autre. Le bouton correspondant n'apparaît d'ailleurs même pas à l'écran pour un Admin secondaire.

Le transfert lui-même est immédiat, sans passer par le circuit d'approbation habituel (§5) : contrairement aux 5 tâches critiques de la spec, cette action n'a de sens que si elle est décidée par le Principal lui-même — la faire approuver par quelqu'un d'autre n'aurait aucune logique, puisque c'est justement le Principal qui décide de qui lui succède. Le transfert est instantané : l'ancien titulaire perd le statut au moment exact où le nouveau le reçoit, sans jamais d'instant où personne — ou plusieurs comptes à la fois — ne le porterait.

## 5. Le workflow d'approbation, vu des deux côtés

Le Volume 22b a déjà présenté ce mécanisme du point de vue « qui peut faire quoi » ; voici comment il se vit concrètement à l'écran.

### 5.1 Côté demandeur (Admin secondaire)

Quand une des 5 actions critiques (Volume 22b) est déclenchée par un Admin secondaire, l'écran ne renvoie ni une erreur ni une confirmation ordinaire — un message distinct indique explicitement que l'action a été **soumise à l'approbation de l'Administrateur Principal**, pour ne jamais laisser croire à une exécution immédiate qui n'a pas eu lieu. La demande apparaît ensuite dans l'écran Approbations, visible **uniquement par son auteur** (un Admin secondaire ne voit jamais les demandes soumises par un autre Admin secondaire) — avec son statut à jour, et si l'exécution venait à échouer au moment de l'approbation, le message d'erreur correspondant.

### 5.2 Côté approbateur (Admin Principal)

L'Admin Principal, lui, voit **toutes** les demandes de tous les Admins secondaires dans son écran Approbations, avec une notification temps réel instantanée dès qu'une nouvelle demande arrive. Approuver ou rejeter se fait en un clic :

- **Approuver** rejoue l'action exactement comme si le Principal l'avait déclenchée lui-même, avec toutes ses vérifications d'origine revérifiées à cet instant précis (par exemple, la ressource visée existe-t-elle encore ?). Si tout se passe bien, l'action prend effet immédiatement.
- **Rejeter** ne déclenche jamais l'action — seul le statut de la demande change, rien d'autre.

**Si une approbation échoue** (par exemple, la ressource visée a été supprimée entre-temps par un autre biais), la demande **n'est pas automatiquement rejetée** : elle reste en attente, avec le message d'erreur affiché, et peut être retentée plus tard ou rejetée explicitement — le choix final reste entre les mains de l'Admin Principal, jamais décidé automatiquement à sa place.

**Une fois qu'une demande a été traitée** (approuvée ou rejetée), elle ne peut plus être retraitée une seconde fois.

### 5.3 Exemple concret

Une Admin secondaire modifie la commission de la Qualité « Maman » de 1 650 à 1 800 Fc. L'écran lui indique que la modification est soumise à approbation. L'Admin Principal reçoit une notification, ouvre l'écran Approbations, et clique Approuver — la commission passe alors réellement à 1 800 Fc. Cette nouvelle valeur ne s'applique qu'aux commandes futures : toute commande déjà enregistrée avant l'approbation garde la commission calculée à son propre moment, jamais recalculée rétroactivement (rappel du Volume 22c).

## 6. Les délégations temporaires

Une délégation permet à un Admin d'accorder, pour une période donnée, le droit d'écriture sur **un seul module précis** à un utilisateur qui ne l'a pas dans son rôle habituel — par exemple, pour couvrir l'absence de 3 jours du Chargé des commandes. Le rôle permanent de la personne n'est jamais modifié : la délégation s'ajoute temporairement, puis disparaît d'elle-même à l'échéance, sans qu'aucune action manuelle ne soit nécessaire pour la « désactiver ».

**Un point pratique à connaître** : une délégation n'est jamais supprimée automatiquement de l'historique une fois expirée — elle reste visible dans la liste, simplement marquée comme inactive. Un Admin peut la révoquer manuellement à tout moment avant son échéance naturelle si elle n'est plus nécessaire ; n'importe quel Admin peut révoquer une délégation, y compris une délégation créée par un autre Admin.

**Gérer les délégations** ne fait pas partie des 5 tâches critiques — un Admin secondaire peut donc créer ou révoquer une délégation directement, sans passer par l'approbation du Principal.

## 7. Résumé du sous-chapitre

| Question | Réponse |
|---|---|
| Puis-je créer un compte en saisissant directement une adresse e-mail ? | Non — toujours depuis une fiche Travailleur avec e-mail professionnel actif |
| Combien de comptes Administrateur au maximum ? | 3 (1 Principal + 2 secondaires) |
| Désactiver un compte efface-t-il son historique ? | Non, jamais — seule la connexion est bloquée |
| Qui peut transférer le statut d'Administrateur Principal ? | Uniquement le Principal en exercice, à personne d'autre |
| Une demande d'approbation qui échoue est-elle automatiquement rejetée ? | Non — elle reste en attente, avec l'erreur affichée, retentable ou rejetable manuellement |
| Une délégation expirée doit-elle être supprimée manuellement ? | Non, elle devient simplement inactive d'elle-même |

**Prochain sous-chapitre** : Volume 22j — État système et Sauvegardes.
