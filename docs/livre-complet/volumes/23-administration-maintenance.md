# Volume 23 — Administration et maintenance

> Ce chapitre s'adresse à l'Admin Principal dans son rôle d'exploitant à long terme de l'application, plutôt que dans son usage quotidien déjà couvert au Volume 22. Il ne présente aucun nouveau fichier de code — c'est une synthèse organisée autour d'une question différente : *qu'est-ce qu'il faut surveiller et faire, dans la durée, pour que l'application continue de fonctionner correctement des mois après sa mise en service ?* S'appuie sur les Volumes 18a, 21, 22i et 22j déjà écrits, et recroise `docs/MISE-EN-PRODUCTION.md`.

## 1. La checklist périodique

Aucun de ces points n'est vérifiable ou déclenchable automatiquement par l'application elle-même — ce sont des vérifications à faire manuellement, à intervalles réguliers, en dehors de l'écran État système.

### 1.1 Le point le plus critique de toute l'exploitation : l'expiration de la base gratuite

Rappel du Volume 21, répété ici une dernière fois car c'est le risque le plus grave documenté dans tout ce livre : si la base de données tourne sur une offre gratuite chez l'hébergeur, elle **expire automatiquement 30 jours après sa création**, avec 14 jours de grâce ensuite — passé ce délai, **la base et toutes ses données sont supprimées définitivement**, sans aucun avertissement émis par l'application elle-même (elle n'a pas accès à cette information). C'est un point à vérifier directement dans le tableau de bord de l'hébergeur, pas dans l'application — et à faire basculer vers une offre payante suffisamment tôt si l'exploitation doit durer.

### 1.2 L'historique des sauvegardes

Un coup d'œil régulier à l'historique de l'écran État système (Volume 22j) permet de repérer une éventuelle série d'échecs de la sauvegarde automatique (par exemple si l'outil `pg_dump` venait à disparaître de l'environnement du serveur) avant que ce problème ne devienne critique — c'est-à-dire avant qu'une vraie perte de données ne survienne sans copie de secours récente.

### 1.3 Le téléchargement vers un support externe

Rappel du Volume 22j : la sauvegarde automatique n'est pas garantie de survivre à un redéploiement sur l'offre gratuite. Un administrateur qui exploite l'application dans la durée devrait prendre l'habitude de télécharger régulièrement la dernière sauvegarde vers un support externe (clé USB, disque, autre service de stockage) — ce n'est pas une action que l'application peut effectuer elle-même à la place d'un humain.

### 1.4 Les comptes obsolètes

Les comptes de démonstration créés à l'installation (un par rôle principal) doivent être désactivés — jamais laissés actifs indéfiniment — une fois que les comptes réels de l'équipe ont été créés selon la procédure déjà détaillée au Volume 22a/22i (fiche Travailleur → e-mail professionnel actif → compte). La désactivation (plutôt que la suppression) préserve leur historique, cohérent avec le principe déjà établi au Volume 22i.

## 2. Restaurer une sauvegarde : la procédure complète

La restauration n'est **jamais un bouton dans l'application** — c'est une opération volontairement tenue hors de l'interface graphique (Volume 18a), parce qu'elle remplace intégralement le contenu de la base ciblée : un clic malheureux sur une page web serait bien trop facile sur les données réelles de l'entreprise.

### 2.1 Prérequis

Restaurer une sauvegarde nécessite un accès technique à l'environnement où l'application est installée (les mêmes prérequis que pour appliquer une migration de base de données) — ce n'est pas une opération qu'un Admin peut déclencher depuis son navigateur, contrairement à tout le reste de ce que couvre ce livre jusqu'ici.

### 2.2 Les étapes

1. Récupérer un fichier de sauvegarde (`.dump`) — via le bouton de téléchargement de l'écran État système, ou un fichier déjà copié sur un support externe (§1.3).
2. Pointer explicitement vers la base **à restaurer** — jamais la base de production, sauf sinistre confirmé.
3. Un premier lancement du script en mode **vérification à blanc** affiche ce qu'il ferait (base ciblée, fichier) sans toucher à quoi que ce soit — une confirmation explicite est ensuite nécessaire pour que la restauration réelle ait lieu.
4. La restauration réelle supprime les tables existantes de la base ciblée avant d'y recharger le contenu du fichier — tout ce qui n'est pas dans le fichier de sauvegarde est perdu.
5. **Une vérification après coup n'est jamais optionnelle** : se connecter à l'application ou interroger la base pour confirmer que les données attendues sont bien là (par exemple, compter les lignes de quelques tables clés).

### 2.3 Un piège réellement rencontré, à connaître avant d'en avoir besoin

Si plusieurs versions du client PostgreSQL sont installées côte à côte sur la machine qui exécute la restauration, l'outil peut résoudre vers une version différente de celle utilisée pour produire la sauvegarde ou de celle du serveur cible. Deux symptômes possibles ont été observés en testant réellement cette procédure :

- Un message d'erreur sur un paramètre de session inconnu — la restauration réussit malgré tout en pratique, ce qui justifie que l'étape 5 (vérification après coup) ne soit jamais sautée.
- Un message d'erreur sur une version de fichier non supportée — bloquant, résolu en indiquant explicitement à l'outil le bon binaire à utiliser.

## 3. Gérer l'équipe dans la durée

Trois situations d'administration, distinctes de la gestion quotidienne déjà couverte au Volume 22i, se présentent typiquement au fil du temps plutôt qu'au jour le jour :

### 3.1 Un Admin Principal qui part

Avant que le titulaire actuel du statut d'Administrateur Principal ne quitte l'organisation ou change de rôle, ce statut doit être **explicitement transféré** à un autre compte Administrateur — rappel du Volume 22i : ce transfert n'est possible que par le Principal en exercice lui-même, ce qui signifie concrètement qu'il doit être anticipé **avant** le départ, jamais après.

> **Mise à jour (correctif P0-01, 19-20/08/2026)** : avant ce correctif, ce transfert normal (`/api/equipe/:id/principal`) n'était pas la seule façon dont le statut de Principal pouvait changer — un redéploiement de production rejouait `prisma/seed.ts`, qui réattribuait de force `estAdminPrincipal` au compte générique `admin@boulangerie-lomoto.com`, **sans passer par ce transfert explicite**. Ce risque est corrigé : le chemin de production (`prisma/bootstrap-production.ts`) ne touche plus jamais ce champ. Le transfert normal décrit dans cette section reste la seule façon légitime de changer le Principal aujourd'hui. Voir `DEPLOIEMENT.md` § « Correctif P0-01 » et, pour un déploiement antérieur potentiellement affecté, la procédure manuelle post-incident (document séparé).

### 3.2 Un roulement d'équipe

Chaque arrivée ou départ dans l'équipe suit le même chemin déjà détaillé (fiche Travailleur → e-mail professionnel → compte pour une arrivée ; désactivation, jamais suppression tant qu'il existe un historique à préserver, pour un départ). Dans la durée, c'est surtout la discipline de désactiver rapidement les comptes qui ne doivent plus se connecter qui distingue une administration saine d'une accumulation de comptes actifs oubliés.

### 3.3 Les langues non finalisées

Rappel du Volume 17 et du Volume 21 : les dictionnaires lingala et kiswahili sont explicitement signalés, dans le code lui-même, comme un premier jet non définitif. Avant de les proposer à du personnel qui en dépendrait réellement pour comprendre l'interface, une relecture par un locuteur natif reste nécessaire — une tâche d'administration à ne pas oublier si l'équipe s'élargit à du personnel non francophone.

## 4. Ce qui n'est pas nécessaire pour administrer l'application

Point rassurant à connaître : administrer l'application au quotidien ne nécessite **aucune installation technique locale** — ni base de données PostgreSQL, ni Docker, ni aucun outil de développement. Ces outils ne servent qu'à qui développe l'application elle-même. Un navigateur web suffit pour tout, à l'exception de la restauration d'une sauvegarde (§2), qui reste la seule opération d'administration nécessitant un accès technique direct à l'environnement.

## 5. Résumé du chapitre

| Fréquence | Action |
|---|---|
| Une fois, dès le déploiement | Vérifier la date d'expiration réelle de la base gratuite dans le tableau de bord de l'hébergeur |
| Régulièrement | Télécharger la dernière sauvegarde vers un support externe |
| Régulièrement | Vérifier l'historique des sauvegardes automatiques (échecs répétés ?) |
| Dès que l'équipe réelle est en place | Désactiver les comptes de démonstration |
| Avant le départ d'un Admin Principal | Transférer explicitement son statut à un successeur |
| Avant d'ouvrir l'application à du personnel non francophone | Faire relire les dictionnaires lingala/kiswahili par un locuteur natif |
| En cas de restauration | Toujours vérifier après coup, jamais supposer un succès silencieux |

Aucun écart spec/code trouvé dans ce chapitre — la spec ne consacre pas de section dédiée à l'administration dans la durée, ce chapitre organise donc en checklist pratique des points déjà vérifiés techniquement ailleurs dans ce livre plutôt que de croiser un nouveau texte de référence.

**Prochain volume** : Volume 24 — Débogage et résolution des problèmes.
