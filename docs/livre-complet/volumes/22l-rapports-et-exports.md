# Volume 22l — Rapports et Exports

> Douzième et dernier sous-chapitre du Guide complet d'utilisation — il clôt le Volume 22 dans son intégralité. Ce chapitre couvre les deux façons de consulter une vue d'ensemble de l'activité (le Tableau de bord et les Rapports personnels) et le mécanisme d'export partagé par plusieurs écrans. Comportement déjà vérifié techniquement au Volume 11z-5 (widgets et rapports personnels) et au Volume 18c (Tableau de bord).

## 1. Les widgets du Tableau de bord

Le Tableau de bord (déjà présenté au Volume 22a comme écran d'accueil) affiche un widget par grand domaine — Caisse, Commandes, Commissions, Stocks, Production, Fournisseurs, Travailleurs. La règle qui gouverne leur apparition est simple et déjà énoncée au Volume 22b : **chaque widget n'apparaît que si le rôle connecté a au moins la lecture sur le module correspondant** — un Responsable de production, par exemple, ne verra jamais le widget Caisse. Rien à configurer : la composition de l'écran s'ajuste automatiquement selon qui est connecté.

Un widget supplémentaire, le **résumé de clôture quotidien**, est disponible pour le DG et les deux niveaux d'Admin — un condensé de la journée (solde de caisse, nombre de commandes, dettes en cours, alertes de stock actives) pensé pour donner une vue d'ensemble rapide sans avoir à rejouer toute l'activité de la journée en temps réel.

## 2. Les Rapports personnels : une portée qui dépend de qui regarde

Contrairement au Tableau de bord (qui compose des widgets par module), l'écran Rapports personnels adopte une logique différente, propre à lui seul : il affiche **l'activité des personnes**, avec une portée qui varie explicitement selon le rôle connecté, indépendamment de la matrice de permissions habituelle.

| Qui consulte | Ce qu'il voit |
|---|---|
| DG et Administrateur (les deux niveaux) | L'activité de **toute l'équipe** |
| Caissier(ère) | Sa propre activité **et** celle du Chargé des commandes (une exception nommée, propre à ce couple de rôles) |
| Tous les autres rôles | Uniquement **leur propre** activité |

Ce que cet écran agrège concrètement : les commandes créées, les règlements encaissés, les dépenses de caisse, les productions enregistrées, les mouvements de stock, les commandes fournisseurs et leurs réceptions, les pointages, ainsi que les absences — chaque absence pouvant apparaître **deux fois** dans la liste si sa déclaration et sa décision ont été faites par deux personnes différentes.

## 3. Exporter : impression, PDF ou e-mail

Trois écrans de ce livre (Rapports personnels, Tableau de bord, Commissions — Volume 22g) partagent le même mécanisme d'export, avec trois options systématiquement proposées :

- **Imprimer** — ouvre directement la boîte d'impression du navigateur, réutilisable aussi pour « Enregistrer en PDF » localement, sans aucun appel au serveur.
- **Télécharger en PDF** — génère un document de marque complet (logo, mise en forme cohérente avec le reste de l'application) produit côté serveur.
- **Envoyer par e-mail** — n'apparaît que si l'envoi d'e-mail a été configuré sur le déploiement (Volume 21) ; sinon, seules les deux premières options restent disponibles.

**Un principe de sécurité à connaître** : l'export ne donne jamais accès à plus de données que ce que l'écran affiche déjà à l'écran — une tentative de forcer l'export d'un module sans y avoir droit est rejetée, même en contournant l'écran habituel. Sur l'écran Rapports personnels en particulier, l'export ne concerne jamais que ce que la portée résolue (§2) donne à voir : personne ne peut exporter, par ce biais, l'activité d'une personne qu'il ne pourrait pas consulter à l'écran.

## 4. Résumé du sous-chapitre

| Question | Réponse |
|---|---|
| Comment savoir quels widgets j'aurai sur le Tableau de bord ? | Automatique — un widget par module où j'ai au moins la lecture |
| Qui voit l'activité de toute l'équipe sur Rapports personnels ? | Le DG et les deux niveaux d'Admin uniquement |
| Le Caissier(ère) voit-il l'activité d'un autre rôle ? | Oui, celle du Chargé des commandes, en plus de la sienne |
| L'export par e-mail est-il toujours disponible ? | Non, seulement si le déploiement l'a configuré |
| Puis-je exporter des données que je ne peux pas voir à l'écran ? | Non, jamais — la même restriction s'applique à l'export |

**Le Volume 22 (Guide complet d'utilisation) est désormais clos**, avec ses 12 sous-chapitres (22a à 22l) couvrant chaque grande zone fonctionnelle de l'application, chacun bâti en pure synthèse pédagogique à partir des chapitres techniques déjà écrits et vérifiés (Volumes 1-21). La priorité du livre bascule maintenant vers le Volume 23 (Administration et maintenance).
