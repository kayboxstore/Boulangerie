# Volume 22j — État système et Sauvegardes

> Dixième sous-chapitre du Guide complet d'utilisation. L'écran État système est l'endroit où l'application protège ses propres données — ce chapitre explique comment l'utiliser correctement, avec un rappel important déjà posé au Volume 21 sur les limites réelles de l'hébergement gratuit. Comportement déjà vérifié techniquement au Volume 11z-4.

## 1. Qui voit quoi sur cet écran

Les deux niveaux d'Admin peuvent consulter l'écran État système (statut, historique des sauvegardes) — mais seul l'**Admin Principal** peut réellement déclencher une action (sauvegarde manuelle, réinitialisation). Un Admin secondaire qui consulte l'écran voit exactement les mêmes informations, sans les boutons d'action — et même en forçant leur apparition, le serveur refuserait de toute façon la demande : le confort d'affichage ne remplace jamais la vérification réelle, toujours faite côté serveur.

## 2. La sauvegarde automatique quotidienne

Chaque jour, à heure fixe (02h30 par défaut), une sauvegarde complète de la base de données est produite automatiquement et écrite sur le disque du serveur — aucune action n'est requise pour qu'elle ait lieu. Chaque tentative, réussie ou non, est journalisée dans l'historique visible sur l'écran, avec son statut.

### 2.1 Le point le plus important de ce chapitre : le disque n'est pas garanti persistant

Un rappel essentiel, déjà détaillé au Volume 21 sous l'angle infrastructure : sur l'offre gratuite de l'hébergeur utilisé pour ce projet, le disque sur lequel la sauvegarde automatique est écrite **peut être réinitialisé à chaque redéploiement** de l'application. Autrement dit, la sauvegarde automatique protège contre une erreur de manipulation *entre* deux redéploiements, mais **ne remplace jamais** une copie régulière vers un support externe (clé USB, disque externe, autre service). L'écran affiche d'ailleurs cet avertissement de façon explicite, pour ne jamais laisser croire à une protection plus large qu'elle ne l'est réellement.

### 2.2 Deux façons de récupérer une sauvegarde

- **Télécharger la dernière sauvegarde locale** — récupère directement le fichier déjà produit par la sauvegarde automatique de la nuit, sans rien recalculer.
- **Télécharger une sauvegarde maintenant** — génère un export frais à la demande, à l'instant présent, indépendamment du cycle automatique quotidien.

Dans les deux cas, il est recommandé de copier régulièrement le fichier obtenu vers un support externe, précisément à cause de la limite du §2.1.

## 3. La réinitialisation de la base : irréversible, mais jamais sans filet

Réinitialiser la base **efface toutes les données métier** de l'application — une opération dont la portée est intentionnellement extrême, et qui n'est donc entourée d'aucune approximation.

### 3.1 Une confirmation qui ne se contourne pas d'un clic

Contrairement à la plupart des actions destructrices de l'application (qui demandent une simple confirmation), la réinitialisation exige de **saisir un mot précis**, exactement tel qu'il est affiché — le bouton de confirmation reste désactivé tant que le texte saisi ne correspond pas au mot exact attendu, au caractère près.

### 3.2 Une sauvegarde de sûreté produite automatiquement avant l'effacement

Un point de sécurité déterminant à connaître : avant que la moindre donnée ne soit effacée, l'application produit **elle-même** une sauvegarde complète et l'écrit sur le disque. Si cette étape échouait pour une raison quelconque, la réinitialisation s'arrête immédiatement et **rien n'est effacé** — il n'existe aucun chemin qui mène à un effacement de données sans qu'une sauvegarde de sûreté n'ait été produite avec succès juste avant.

### 3.3 Ce qui est conservé malgré tout

Le catalogue des matières premières n'est pas supprimé lors d'une réinitialisation — seule la quantité en stock de chacune est remise à zéro. Conserver le catalogue lui-même évite qu'un futur enregistrement de production échoue faute de matières premières connues en base.

### 3.4 Une action qui se produit hors du circuit d'approbation habituel

Un point à ne pas confondre avec le mécanisme déjà vu au Volume 22i : la réinitialisation de la base **ne fait pas partie** des 5 tâches critiques soumises à l'approbation de l'Admin Principal — ce n'est d'ailleurs même pas nécessaire, puisque seul l'Admin Principal a de toute façon le droit de la déclencher. C'est une décision volontaire de la spec : cette opération est considérée comme une procédure d'infrastructure exceptionnelle, jamais un bouton applicatif ordinaire, même gardé par un circuit d'approbation.

### 3.5 Toutes les sessions ouvertes sont immédiatement déconnectées

Une fois la base vidée, tous les comptes précédemment connectés — qui viennent de disparaître de la base — sont déconnectés **immédiatement**, sans attendre leur prochaine action. C'est le même mécanisme déjà rencontré au Volume 22a pour la déconnexion forcée en cas de session remplacée.

## 4. Résumé du sous-chapitre

| Question | Réponse |
|---|---|
| Un Admin secondaire peut-il déclencher une sauvegarde ou une réinitialisation ? | Non — lecture seule, même si l'écran est consultable |
| La sauvegarde automatique protège-t-elle contre un redéploiement ? | Non, pas garantie sur l'offre gratuite — un téléchargement régulier vers un support externe reste indispensable |
| Peut-on réinitialiser la base d'un simple clic ? | Non — un mot de confirmation exact doit être saisi |
| Que se passe-t-il si la sauvegarde de sûreté échoue avant une réinitialisation ? | Rien n'est effacé — la réinitialisation s'arrête immédiatement |
| Le catalogue de matières premières survit-il à une réinitialisation ? | Oui, seul le stock est remis à zéro |
| La réinitialisation passe-t-elle par le circuit d'approbation ? | Non — elle est hors de ce mécanisme, réservée d'emblée au seul Admin Principal |

**Prochain sous-chapitre** : Volume 22k — Paramètres, À propos et Assistant.
