# Plan de coordination — Codex + Claude Code

**Projet :** Application Boulangerie Lomoto  
**Date :** 13 août 2026  
**Version :** 2.0 — après rapport F0  
**Documents de référence :** `PLAN_ATTAQUE_APPLICATION_LOMOTO.md` version 1.1 et `ETAT_REEL_MAIN_A7FM5X.md`  
**Dépôt :** `kayboxstore/Boulangerie`  
**Base commune de développement :** branche `main-a7fm5x`, commit `f7880b90ed1e2b735189b5c06ad9c2d88ed7fe35`

> Règle de préséance : l’audit version 1.1 reste la photographie de l’ancien `main` au commit `27724820…`. Pour toute décision de développement actuelle, `ETAT_REEL_MAIN_A7FM5X.md` et le présent plan version 2.0 font autorité.

## 1. Décision de partage

Le travail est séparé par couches techniques, et non simplement par fonctionnalités.

| Responsable | Propriété exclusive | Résultat attendu |
|---|---|---|
| **Codex** | Base de données, migrations, API, sécurité, règles métier serveur, contrats partagés, tests API, CI | Une fondation sûre et des API testées |
| **Claude Code** | Application React, composants Premium, pages, navigation, responsive, accessibilité, tests frontend | Une interface Premium complète et utilisable |

Cette séparation permet aux deux intervenants de travailler en parallèle sans modifier les mêmes fichiers.

## 2. Résultat F0 et nouvelle base

Le rapport F0 de Claude a été vérifié sur GitHub :

- racine de sa session : `/home/user/Boulangerie` ;
- branche : `main-a7fm5x` ;
- HEAD : `f7880b90ed1e2b735189b5c06ad9c2d88ed7fe35` ;
- arbre de travail propre ;
- aucun fichier Premium annoncé n’existe ;
- aucun commit de sauvegarde n’était nécessaire ;
- `main-a7fm5x` est 152 commits en avance sur `main` et 0 commit en retard ;
- la branche contient 239 fichiers suivis, 53 fichiers API, 67 fichiers web et 29 migrations applicatives plus le verrou Prisma.

La branche `main-a7fm5x` contient les développements applicatifs légitimes les plus récents. Elle devient donc la base commune provisoire de Codex et Claude. Aucun nouveau travail ne doit partir de l’ancien `main`.

Les documents publiés sur `agent/publish-coordination-docs` seront proposés vers `main-a7fm5x`, et non vers `main`.

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

## 5. Vague 0 — terminée

### Claude — tâche F0 — terminée

**Objectif :** identifier et sauvegarder les travaux Premium éventuellement déjà réalisés.

Résultat : aucun travail Premium local, arbre propre, aucun commit de sauvegarde requis.

### Codex — tâche C0 — terminée

**Objectif :** vérifier la base distante et préparer les contrats de collaboration.

Résultats vérifiés :

- Vitest existe, mais un seul fichier de tests partagés est présent ;
- aucun test API ni test frontend n’est présent ;
- aucun workflow CI n’existe ;
- CORS explicite existe déjà ;
- Helmet et la limitation de fréquence ne sont pas installés ;
- l’API possède une gestion d’erreur centralisée simple ;
- la connexion et la session unique existent, mais pas la récupération de mot de passe ;
- le rollback des notifications échouées manque toujours dans `socket.tsx` ;
- la suppression physique des produits existe toujours ;
- l’idempotence générique des écritures sensibles manque ;
- le modèle `CommandeClient` crée toujours dette et avance dès la saisie ;
- l’ancienne clôture de caisse auditée sur `main` n’existe plus sous cette forme et ne doit pas servir de cible C1.

**Barrière levée :** C1 et F1 peuvent commencer à partir du commit `f7880b90…`.

## 6. Vague 1 — filet de sécurité et système UI

Les deux tâches commencent à partir du même commit propre : `f7880b90ed1e2b735189b5c06ad9c2d88ed7fe35` sur `main-a7fm5x`.

### Codex — C1 : backend, tests et CI

Branche : `codex/backend-safety-c1`, créée depuis `main-a7fm5x`

Tâches :

1. installer et configurer des tests API sans base de production ;
2. tester l’authentification, la session unique et les permissions existantes ;
3. tester les routes de notifications et l’isolation par destinataire ;
4. ajouter une CI exécutant test, typecheck API et build web ;
5. ajouter des identifiants de requête et un format d’erreur cohérent sans casser les messages actuels ;
6. conserver le CORS existant et ajouter les en-têtes de sécurité ;
7. ajouter une limitation de fréquence ciblée sur la connexion et les routes publiques sensibles ;
8. vérifier l’absence de secret de repli dangereux en production ;
9. documenter ce qui reste reporté : archivage produit, idempotence, commande financière et caisse ;
10. ne modifier aucun écran React ni aucune règle métier financière dans C1.

Critère de sortie : la CI échoue correctement sur une régression prouvée et les défauts critiques existants sont couverts par des tests.

### Claude — F1 : bibliothèque de composants Premium

Branche : `claude/premium-ui-f1`, créée depuis `main-a7fm5x`

Tâches :

1. faire évoluer `FeedbackProvider` en toast Premium avec variantes succès, erreur, avertissement et information ;
2. bouton Premium et tous ses états ;
3. champ de mot de passe Premium ;
4. zone de texte Premium auto-ajustable ;
5. sélecteur date et heure Premium en français ;
6. liste mobile Premium ;
7. tableau ordinateur Premium ;
8. pagination Premium générique ;
9. états vide, chargement, hors ligne et réessayer ;
10. corriger dans `socket.tsx` le rollback de lecture des notifications et signaler l’échec via le toast ;
11. conserver les quatre langues FR, LN, SW et EN pour tout nouveau texte visible ;
12. accessibilité clavier, focus, contraste, tactile 44 px et `prefers-reduced-motion` ;
13. tests frontend des composants ;
14. ne modifier aucune route API, migration, contrat partagé ou dépendance.

Critère de sortie : les composants sont réutilisables, ne contiennent aucune règle métier et fonctionnent en mobile comme sur ordinateur.

## 7. Vague 2 — correctifs serveur et scènes Premium

Cette vague commence après revue de C1 et F1 puis rebasage sur leur branche d’intégration commune.

### Codex — C2 : correctifs critiques de l’existant

Branche : `codex/backend-critical-c2`

Tâches :

1. remplacer la suppression physique des produits par archivage ;
2. valider strictement les dates et nombres reçus par l’API ;
3. ajouter l’idempotence des commandes, règlements et dépenses ;
4. centraliser `Africa/Kinshasa` au lieu des mélanges UTC/heure locale actuels ;
5. préparer le modèle de session et de remise de caisse compatible avec le registre actuel ;
6. ajouter les contraintes de base nécessaires ;
7. documenter les contrats modifiés ;
8. ne modifier aucun fichier frontend.

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

1. documentation de coordination version 2.0 vers `main-a7fm5x` ;
2. `codex/backend-safety-c1` ;
3. `claude/premium-ui-f1` ;
4. branche d’intégration commune issue de `main-a7fm5x` ;
5. `codex/backend-critical-c2` ;
6. `codex/premium-services-c3` ;
7. `claude/premium-shell-f2`, après rebasage et intégration réelle ;
8. `claude/premium-integration-f3` ;
9. documentation finale.

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

## 13. Prompt F1 à envoyer à Claude Code

```text
Le rapport F0 est validé. Lis la version 2.0 de PLAN_COORDINATION_CODEX_CLAUDE_LOMOTO.md et ETAT_REEL_MAIN_A7FM5X.md sur la branche agent/publish-coordination-docs.

Exécute uniquement F1.

Base obligatoire : main-a7fm5x au commit f7880b90ed1e2b735189b5c06ad9c2d88ed7fe35.
Crée depuis cette base la branche claude/premium-ui-f1. N’utilise pas l’ancien main.

Respecte strictement la propriété frontend :
- autorisé : apps/web/src/components/**, apps/web/src/index.css, docs/ui/** et tests frontend dédiés ;
- apps/web/src/lib/socket.tsx est autorisé uniquement pour le rollback des notifications ;
- interdit : prisma/**, apps/api/**, packages/shared/**, .github/workflows/**, package.json racine et package-lock.json.

Fais évoluer l’existant au lieu de le dupliquer : FeedbackProvider, composants ui, traductions FR/LN/SW/EN et framer-motion déjà installée.

N’implémente pas encore la lampe, la réinitialisation du mot de passe, l’horloge ni l’anniversaire : ils appartiennent à F2/F3.

À la fin : lance les vérifications frontend disponibles, fournis la liste exacte des fichiers, les captures mobile/ordinateur, les limites restantes et le SHA du commit. Ne fusionne rien et attends la revue.
```

## 14. Action parallèle de Codex

Codex lance `codex/backend-safety-c1` depuis le même commit `f7880b90…`, sans modifier les fichiers frontend. Claude lance F1 en parallèle. Les deux PR restent indépendantes et ne sont rapprochées qu’après leurs tests et leur revue croisée.
