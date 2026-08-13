# Plan de coordination — Codex + Claude Code

**Projet :** Application Boulangerie Lomoto  
**Date :** 13 août 2026  
**Document de référence :** `PLAN_ATTAQUE_APPLICATION_LOMOTO.md` version 1.1  
**Dépôt :** `kayboxstore/Boulangerie`  
**Base commune vérifiée :** branche `main`, commit `27724820e540ff53f1ee63369a6eb2984af19b6f`

## 1. Décision de partage

Le travail est séparé par couches techniques, et non simplement par fonctionnalités.

| Responsable | Propriété exclusive | Résultat attendu |
|---|---|---|
| **Codex** | Base de données, migrations, API, sécurité, règles métier serveur, contrats partagés, tests API, CI | Une fondation sûre et des API testées |
| **Claude Code** | Application React, composants Premium, pages, navigation, responsive, accessibilité, tests frontend | Une interface Premium complète et utilisable |

Cette séparation permet aux deux intervenants de travailler en parallèle sans modifier les mêmes fichiers.

## 2. Vérification obligatoire avant de commencer

La branche distante `main` est toujours au commit `27724820…`. La copie de travail examinée contient toutefois des fichiers Premium qui ne sont pas présents sur cette branche distante, notamment :

- `LoginLamp.tsx` ;
- `AuthShell.tsx` ;
- `BirthdayCelebration.tsx` ;
- `DigitalClock.tsx` ;
- `ForgotPassword.tsx` ;
- `ResetPassword.tsx` ;
- `anniversaires.ts` ;
- une migration `20260813000100_premium_auth_anniversaires`.

Ces fichiers peuvent être des travaux locaux non publiés. Avant tout nouveau développement, Claude doit donc :

1. afficher la racine réelle du dépôt ;
2. afficher la branche et le commit courant ;
3. exécuter `git status --short` ;
4. indiquer si les fichiers ci-dessus existent dans son véritable dépôt ;
5. sécuriser tout travail local existant sur une branche dédiée ;
6. ne rien fusionner dans `main` avant revue.

Aucun intervenant ne doit supposer que ces fichiers sont déjà sauvegardés sur GitHub.

## 3. Zones de fichiers verrouillées

### 3.1 Fichiers réservés à Codex

Claude ne doit pas modifier :

- `prisma/schema.prisma` ;
- `prisma/migrations/**` ;
- `prisma/seed.ts` ;
- `apps/api/**` ;
- `packages/shared/**` ;
- `.github/workflows/**` ;
- le `package.json` racine ;
- le `package-lock.json` ;
- les fichiers de configuration de sécurité ou de déploiement ;
- `docs/api-contracts/**`.

Codex est seul responsable des migrations et de leur ordre.

### 3.2 Fichiers réservés à Claude Code

Codex ne doit pas modifier :

- `apps/web/src/components/**` ;
- `apps/web/src/pages/**` ;
- `apps/web/src/index.css` ;
- `apps/web/src/App.tsx` ;
- `apps/web/src/main.tsx` ;
- `apps/web/src/lib/api.ts` ;
- `apps/web/src/lib/auth.tsx` ;
- `apps/web/public/**` ;
- `docs/ui/**`.

Claude est seul responsable de l’intégration des API dans le frontend.

### 3.3 Fichiers gelés pendant le travail parallèle

Les fichiers suivants ne sont modifiés par personne avant la phase d’intégration :

- `README.md` ;
- `docs/spec-boulangerie.md` ;
- `PLAN_ATTAQUE_APPLICATION_LOMOTO.md` ;
- tout fichier racine non attribué explicitement.

Leur mise à jour finale sera réalisée dans une PR de documentation séparée.

## 4. Règles de dépendances

- Claude ne doit installer aucune dépendance ni modifier le verrou de dépendances.
- Si une bibliothèque frontend paraît nécessaire, Claude doit d’abord démontrer que les dépendances présentes ne suffisent pas et transmettre la demande.
- Codex installe ou refuse la dépendance dans une PR isolée, après vérification de son poids, de sa licence et de sa nécessité.
- Les types et schémas partagés sont publiés par Codex dans `packages/shared`.
- Claude consomme ces contrats ; il ne crée pas une deuxième définition concurrente dans le frontend.
- Toute API nouvelle doit être documentée avant son intégration visuelle.

## 5. Vague 0 — sécuriser l’état actuel

### Claude — tâche F0

**Objectif :** identifier et sauvegarder les travaux Premium éventuellement déjà réalisés.

Livrables :

- branche proposée : `claude/premium-existing-work` ;
- état Git complet ;
- liste des fichiers modifiés ou nouveaux ;
- commandes de vérification exécutées ;
- commit de sauvegarde si des changements locaux existent ;
- aucune nouvelle fonctionnalité dans ce commit de sauvegarde.

### Codex — tâche C0

**Objectif :** vérifier la base distante et préparer les contrats de collaboration.

Livrables :

- confirmation du commit de départ ;
- inventaire des endpoints existants ;
- premier document de contrats API ;
- matrice des permissions concernées ;
- aucune modification métier avant la sauvegarde du travail existant de Claude.

**Barrière :** les vagues suivantes ne commencent qu’après identification des éventuels travaux locaux de Claude.

## 6. Vague 1 — filet de sécurité et système UI

Les deux tâches peuvent commencer à partir du même commit propre.

### Codex — C1 : backend, tests et CI

Branche : `codex/backend-safety-c1`

Tâches :

1. installer et configurer les tests API ;
2. tester les permissions existantes ;
3. reproduire par test la clôture qui mélange les caissiers et les jours ;
4. tester les routes de notifications ;
5. ajouter une CI exécutant typecheck, tests et build ;
6. ajouter des réponses d’erreur API structurées ;
7. ajouter les protections serveur de base : CORS explicite, en-têtes de sécurité et limitation de fréquence ;
8. retirer les secrets de repli dangereux en production ;
9. ne modifier aucun écran React.

Critère de sortie : la CI échoue correctement sur une régression prouvée et les défauts critiques existants sont couverts par des tests.

### Claude — F1 : bibliothèque de composants Premium

Branche : `claude/premium-ui-f1`

Tâches :

1. toast Premium avec variantes succès, erreur, avertissement et information ;
2. bouton Premium et tous ses états ;
3. champ de mot de passe Premium ;
4. zone de texte Premium auto-ajustable ;
5. sélecteur date et heure Premium en français ;
6. liste mobile Premium ;
7. tableau ordinateur Premium ;
8. pagination Premium générique ;
9. états vide, chargement, hors ligne et réessayer ;
10. accessibilité clavier, focus, contraste, tactile 44 px et `prefers-reduced-motion` ;
11. tests frontend des composants ;
12. ne modifier aucune route API ni migration.

Critère de sortie : les composants sont réutilisables, ne contiennent aucune règle métier et fonctionnent en mobile comme sur ordinateur.

## 7. Vague 2 — correctifs serveur et scènes Premium

Cette vague commence après fusion de C1 et rebasage des deux nouvelles branches.

### Codex — C2 : correctifs critiques de l’existant

Branche : `codex/backend-critical-c2`

Tâches :

1. créer de vraies sessions de caisse nominatives ;
2. limiter chaque clôture à la bonne session et à la bonne journée Lomoto ;
3. remplacer la suppression physique des produits par archivage ;
4. valider strictement les dates et nombres reçus par l’API ;
5. ajouter l’idempotence des ventes, commandes et règlements ;
6. corriger la fiabilité serveur des notifications ;
7. ajouter les contraintes de base nécessaires ;
8. documenter les contrats modifiés ;
9. ne modifier aucun fichier frontend.

### Claude — F2 : connexion et enveloppe Premium

Branche : `claude/premium-shell-f2`

Tâches :

1. scène de connexion avec lampe et ficelle ;
2. clic, glissement tactile et commande clavier ;
3. logo Lomoto en filigrane non interactif ;
4. révélation progressive du formulaire ;
5. variante sans mouvement ;
6. `AuthShell` commun aux pages d’authentification ;
7. pages visuelles Mot de passe oublié et Nouveau mot de passe ;
8. navigation par rôle et mobile simplifiée ;
9. horloge « flip » compacte dans l’en-tête ;
10. ne pas simuler un succès de réinitialisation : l’intégration attend les vrais endpoints Codex.

La PR F2 peut rester en brouillon tant que les API d’authentification nécessaires ne sont pas fusionnées.

## 8. Vague 3 — services Premium et intégration frontend

### Codex — C3 : API d’authentification, profils et anniversaires

Branche : `codex/premium-services-c3`

Tâches :

1. jetons de réinitialisation hachés, expirables et à usage unique ;
2. réponse anti-énumération des adresses ;
3. limitation des demandes répétées ;
4. révocation des anciennes sessions après réinitialisation ;
5. mot de passe temporaire administrateur et changement obligatoire ;
6. date de naissance facultative et protégée par permissions ;
7. endpoint renvoyant uniquement les noms des agents fêtés ;
8. mémorisation serveur de l’affichage par utilisateur et par date ;
9. regroupement de plusieurs anniversaires ;
10. fuseau opérationnel `Africa/Kinshasa` ;
11. tests de sécurité et tests de frontière de journée ;
12. contrats API complets pour Claude.

### Claude — F3 : intégration Premium finale

Branche : `claude/premium-integration-f3`

Cette tâche commence après fusion de C3.

Tâches :

1. connecter les pages de récupération aux vrais endpoints ;
2. gérer attente, succès, expiration, erreur et nouvelle demande ;
3. intégrer le changement obligatoire du mot de passe ;
4. intégrer « Constellation Lomoto » après authentification ;
5. ne jamais afficher l’âge ni la date de naissance ;
6. afficher la célébration une fois selon la réponse serveur ;
7. gérer plusieurs anniversaires ;
8. intégrer le toast Premium aux actions existantes ;
9. corriger le rollback visuel des notifications ;
10. réaliser les tests mobile, clavier, mouvement réduit et mauvaise connexion.

## 9. Éléments reportés après cette première vague Premium

Les tâches suivantes ne doivent pas être mélangées aux branches précédentes :

- recherche globale avec résultats réels ;
- commentaires métier ;
- fil d’activité complet ;
- pagination serveur de tous les modules ;
- Commercial ;
- Prévisions ;
- Production et Stock ;
- Qualité et Magasin ;
- Tournées et Livraisons ;
- remises de fonds et refonte complète de la Caisse.

Elles seront traitées une fois la sécurité, l’authentification et l’enveloppe Premium stabilisées.

## 10. Ordre de fusion obligatoire

1. branche de sauvegarde des éventuels travaux locaux Claude ;
2. `codex/backend-safety-c1` ;
3. `claude/premium-ui-f1` ;
4. `codex/backend-critical-c2` ;
5. `codex/premium-services-c3` ;
6. `claude/premium-shell-f2`, après rebasage et intégration réelle ;
7. `claude/premium-integration-f3` ;
8. documentation finale.

Chaque branche est rebasée sur la dernière version validée avant sa revue. Aucune fusion automatique n’est autorisée.

## 11. Contrôle de chaque PR

Avant validation, chaque PR doit fournir :

- objectif et périmètre ;
- liste des fichiers modifiés ;
- migrations éventuelles ;
- contrats API affectés ;
- tests exécutés et résultats ;
- captures mobile et ordinateur pour les PR frontend ;
- risques et stratégie de retour arrière ;
- confirmation des zones interdites non modifiées.

Une PR est refusée si elle :

- mélange backend et frontend sans accord préalable ;
- modifie une zone réservée à l’autre intervenant ;
- contient plusieurs migrations concurrentes ;
- introduit un lien ou bouton décoratif sans comportement réel ;
- désactive un test pour réussir la CI ;
- écrase des données ou supprime un historique ;
- modifie directement `main`.

## 12. Gestion d’un conflit ou d’un besoin transversal

Lorsqu’une tâche frontend a besoin d’un changement serveur :

1. Claude décrit le besoin, la donnée, le format et le scénario ;
2. Claude ne modifie pas l’API ;
3. Codex valide le risque métier et publie le contrat ;
4. Codex implémente et teste le serveur ;
5. Claude intègre le contrat fusionné.

Lorsqu’une tâche backend nécessite un changement d’écran, Codex documente le nouvel état ou le nouveau message d’erreur et laisse Claude l’intégrer.

## 13. Prompt initial à envoyer à Claude Code

```text
Tu vas travailler en parallèle avec Codex sur l’application Boulangerie Lomoto.

Commence uniquement par la tâche F0 du fichier PLAN_COORDINATION_CODEX_CLAUDE_LOMOTO.md.

Avant toute modification :
1. indique la racine réelle du dépôt ;
2. affiche la branche courante et le commit HEAD ;
3. exécute git status --short ;
4. vérifie si des fichiers Premium non publiés existent déjà, notamment LoginLamp.tsx, AuthShell.tsx, BirthdayCelebration.tsx, DigitalClock.tsx, ForgotPassword.tsx, ResetPassword.tsx, anniversaires.ts et la migration premium_auth_anniversaires ;
5. compare ton état avec main au commit 27724820e540ff53f1ee63369a6eb2984af19b6f.

S’il existe des changements locaux, crée une branche claude/premium-existing-work et fais uniquement un commit de sauvegarde fidèle. N’ajoute encore aucune fonctionnalité et ne refactorise rien.

Ne touche jamais à prisma/**, apps/api/**, packages/shared/**, .github/workflows/**, au package.json racine ni au package-lock.json. Codex possède exclusivement ces zones.

Retourne-moi :
- la branche ;
- le commit de base ;
- git status ;
- la liste des changements existants ;
- le SHA du commit de sauvegarde éventuel ;
- les vérifications exécutées ;
- tout blocage.

Arrête-toi ensuite et attends la validation avant F1.
```

## 14. Première action de Codex après le retour de Claude

Dès que Claude transmet son état Git et son éventuel commit de sauvegarde, Codex :

1. vérifie la branche sur GitHub ;
2. compare ses fichiers à `main` ;
3. retire du backlog tout ce qui est déjà correctement réalisé ;
4. signale ce qui doit être corrigé ou conservé ;
5. lance C1 sur une branche séparée ;
6. autorise Claude à lancer F1 depuis une base propre.

Cette synchronisation initiale est obligatoire : elle évite de refaire le travail Premium déjà présent ou de l’écraser.
