# Volume 24 — Débogage et résolution des problèmes

> Ce chapitre s'adresse à quiconque doit comprendre pourquoi quelque chose ne s'est pas passé comme attendu — un message d'erreur incompris, un écran qui semble bloqué, un comportement surprenant. Plutôt que de reparcourir chaque module un par un, il est organisé **par symptôme**, en renvoyant systématiquement au chapitre qui explique le comportement en détail. Aucun nouveau fichier de code : ce chapitre rassemble les cas limites déjà documentés dans chaque chapitre technique (Volumes 11a-11z, 18a-23) et s'appuie sur le mécanisme de journalisation déjà expliqué au Volume 16.

## 1. Deux choses différentes portent le nom de « journal » dans cette application

Avant tout dépannage, il faut distinguer deux mécanismes que ce livre a déjà couverts séparément, faciles à confondre :

- **Le Journal d'audit** (Volume 11g, écran accessible depuis l'application) trace les **modifications de données métier** — qui a changé quoi, quand, avec la valeur avant/après. C'est l'outil à consulter pour comprendre *qui a fait telle modification*, jamais pour diagnostiquer une panne technique.
- **Les logs techniques structurés** (Volume 16, `lib/logger.ts`) sont des lignes JSON écrites par le serveur — horodatage, niveau (`info`/`warn`/`error`), message, contexte. **Ils ne sont accessibles depuis aucun écran de l'application** : ils vivent uniquement dans la console de l'hébergeur (le tableau de bord Render, par exemple, déjà évoqué au Volume 21), consultables par quelqu'un ayant un accès technique au déploiement. C'est l'outil à consulter pour une erreur `500` ou un comportement qui ressemble à un bug plutôt qu'à un refus attendu.

## 2. Comprendre un message d'erreur par son code

L'application distingue systématiquement, dans chaque réponse d'erreur, un code numérique (déjà rencontré des dizaines de fois au fil de ce livre) qui indique la **nature** du problème avant même de lire le message.

| Code | Signification générale dans cette application | Où regarder |
|---|---|---|
| **400** | La donnée envoyée est mal formée ou incomplète (un champ obligatoire manquant, une valeur hors format) | Le message précis indique le champ en cause |
| **401** | Non authentifié — jeton absent, expiré, ou identifiants incorrects | Volume 22a (connexion) |
| **403** | Authentifié, mais sans le droit d'effectuer cette action précise | Volume 22b (rôles et permissions) |
| **404** | La ressource visée n'existe pas (ou plus) | Vérifier qu'elle n'a pas été supprimée entre-temps par quelqu'un d'autre |
| **409** | La demande est valide en soi, mais entre en conflit avec l'état actuel des données (doublon, action déjà traitée, quota atteint...) | Le message précis explique le conflit — presque toujours une situation *prévue*, pas un bug |
| **500** | Erreur interne inattendue — le message renvoyé au client est volontairement générique (« Erreur interne du serveur »), jamais le détail technique | Volume 16 — nécessite un accès aux logs techniques (§1) pour en savoir plus |

**Un point rassurant à retenir** : dans cette application, un `409` n'est presque jamais le signe d'un problème — c'est un refus **volontaire et prévu**, avec un message qui explique exactement pourquoi (déjà rencontré à de nombreuses reprises : doublon de commande, quota d'Admins atteint, demande d'approbation déjà traitée, dépense farine déjà enregistrée...). Un `500`, en revanche, indique toujours quelque chose de réellement imprévu.

## 3. Symptômes fréquents et leur cause probable

| Symptôme | Cause probable | Chapitre |
|---|---|---|
| « E-mail ou mot de passe incorrect » alors que l'adresse semble correcte | Message volontairement identique pour une adresse inexistante et un mot de passe erroné (protection contre l'énumération de comptes) — impossible de distinguer les deux cas depuis ce seul message | Volume 22a |
| Déconnexion soudaine avec un message expliquant qu'une nouvelle connexion a eu lieu | Comportement normal — une connexion sur un autre appareil déconnecte immédiatement la précédente (session unique) | Volume 22a |
| Impossible de retrouver le mot de passe oublié | Limite réelle et confirmée de l'application — aucune procédure de réinitialisation n'existe, ni self-service ni par un Admin | Volume 22a |
| Une action semble avoir été acceptée mais rien ne se passe visiblement | Vérifier s'il s'agit d'une des 5 tâches critiques mise en attente d'approbation plutôt qu'exécutée immédiatement (un message dédié devrait normalement l'indiquer) | Volume 22b, 22i |
| Impossible de créer une deuxième commande le même jour pour un client | Comportement normal — une fenêtre de choix Modifier/Remplacer doit apparaître à la place | Volume 22c |
| Impossible de « Remplacer » une commande | La commande a déjà reçu un règlement — seul « Modifier » reste disponible dans ce cas | Volume 22c |
| Une sortie de stock est refusée | Le stock disponible est insuffisant pour la quantité demandée — jamais de stock négatif silencieux | Volume 22e |
| Impossible de cocher la case dépense farine | Une des trois conditions manque : taux du jour non défini, aucune production enregistrée ce jour-là, ou ligne déjà existante | Volume 22f |
| Impossible de calculer ou générer un bulletin de paie | Le salaire mensuel ou le nombre de jours travaillés n'est pas renseigné sur la fiche | Volume 22h |
| Un bulletin de paie déjà généré ne reflète pas une correction récente | Comportement normal — un bulletin est une archive figée, jamais recalculée rétroactivement ; seul un nouveau bulletin refléterait le changement | Volume 22h |
| Impossible de transférer le statut Administrateur Principal | Seul le Principal actuellement en exercice peut déclencher ce transfert, à personne d'autre | Volume 22i |
| Une demande d'approbation reste bloquée avec un message d'erreur visible | L'exécution a échoué au moment de l'approbation (la ressource visée a changé entre-temps) — elle n'est pas rejetée automatiquement, une nouvelle tentative ou un rejet explicite reste possible | Volume 22i |
| L'application met environ 30 secondes à répondre à la première ouverture de la journée | Comportement normal sur l'offre gratuite de l'hébergeur — le service se met en veille après 15 minutes sans trafic | Volume 21 |
| Plus aucune action n'est possible après une coupure réseau | Comportement attendu — l'application n'a aucun mode hors-ligne, vérifié dans le code lui-même | Volume 21 |
| Les données semblent avoir disparu après une longue période sans utilisation | Vérifier en priorité la date d'expiration de la base de données gratuite dans le tableau de bord de l'hébergeur — le risque le plus grave documenté dans ce livre | Volume 21, 23 |
| Le mot de passe des comptes de démonstration ne fonctionne plus après un moment | Comportement attendu si ces comptes ont été désactivés ou leur mot de passe changé, une recommandation explicite une fois l'équipe réelle en place | Volume 21, 23 |

## 4. Quand rien de tout cela ne correspond

Si le symptôme observé ne figure pas dans ce tableau et qu'un message générique « Erreur interne du serveur » (`500`) s'affiche, la marche à suivre est la suivante :

1. Noter précisément l'heure de l'incident et l'action qui l'a déclenché.
2. Consulter les logs techniques (§1) pour cet horodatage précis — chaque erreur non gérée y est systématiquement journalisée avec le contexte de la requête (méthode HTTP, chemin), jamais silencieusement perdue.
3. Se rappeler qu'aucune suite de tests automatisés ne couvre les routes API ou le frontend de cette application (Volume 19, constat honnête déjà établi) — une régression après une modification du code n'est donc pas nécessairement détectée avant d'atteindre un utilisateur réel ; une vérification manuelle reste, à ce jour, le principal filet de sécurité.

L'Assistant intégré à l'application (Volume 22k) reste par ailleurs le canal prévu par la spec elle-même pour signaler un problème à l'équipe, capture d'écran à l'appui.

## 5. Résumé du chapitre

| Question | Réponse |
|---|---|
| Où voir qui a modifié une donnée ? | Journal d'audit, dans l'application |
| Où voir le détail technique d'une erreur `500` ? | Logs techniques, uniquement dans la console de l'hébergeur |
| Un `409` est-il un bug ? | Presque jamais — un refus prévu, expliqué par son message |
| Que faire si l'application est lente au premier accès de la journée ? | Rien d'anormal sur l'offre gratuite — c'est la mise en veille |
| Que faire si des données semblent avoir disparu ? | Vérifier en priorité l'expiration de la base gratuite chez l'hébergeur |

**Prochain volume** : Volume 25 — Possibilités d'évolution.
