# État réel de la branche de travail `main-a7fm5x`

**Projet :** Boulangerie Lomoto  
**Date de vérification :** 13 août 2026  
**Branche :** `main-a7fm5x`  
**Commit :** `f7880b90ed1e2b735189b5c06ad9c2d88ed7fe35`  
**Objet :** addendum de réconciliation après le rapport F0 de Claude Code

## 1. Pourquoi cet addendum existe

L’audit `PLAN_ATTAQUE_APPLICATION_LOMOTO.md` version 1.1 a été figé sur l’ancien `main`, au commit `27724820e540ff53f1ee63369a6eb2984af19b6f`. Le rapport F0 a révélé qu’une branche de travail légitime, `main-a7fm5x`, contient 152 commits supplémentaires et l’essentiel des développements récents.

L’audit 1.1 reste valide pour la photographie qu’il décrit, mais il ne doit plus être utilisé seul pour déterminer ce qui manque aujourd’hui.

## 2. Faits Git vérifiés

| Élément | Constat |
|---|---|
| Relation avec l’ancien `main` | 152 commits en avance, 0 en retard |
| Fichiers suivis | 239 |
| Fichiers API | 53 |
| Fichiers frontend | 67 |
| Migrations | 29 migrations applicatives, plus `migration_lock.toml` |
| Tests | un seul fichier : `packages/shared/src/index.test.ts` |
| CI GitHub Actions | aucun workflow |
| Fichiers Premium annoncés | aucun |
| État local signalé par Claude | propre |

## 3. Fonctionnalités déjà ajoutées depuis l’ancien audit

La branche contient notamment :

- Stocks, Production et Fournisseurs ;
- Travailleurs, pointages, absences, sanctions et paie ;
- Départements et groupes ;
- Approbations, délégations et audit ;
- rapports, exports et rapports personnels ;
- état système, sauvegardes et premier lancement ;
- assistant et support ;
- zones de dépositaires et bons de livraison ;
- langues FR, LN, SW et EN ;
- session utilisateur unique ;
- registre journalier de caisse ;
- une documentation technique complète distincte du code.

Ces éléments doivent être conservés et audités sur leur mérite. Ils ne sont pas considérés comme absents simplement parce qu’ils n’existaient pas sur l’ancien `main`.

## 4. Constats C1 encore prouvés dans le code actuel

| Domaine | État actuel | Décision |
|---|---|---|
| Tests partagés | Vitest, 11 tests dans un seul fichier | Conserver |
| Tests API | Absents | Construire en C1 |
| Tests frontend | Absents | Construire en F1 |
| CI | Absente | Construire en C1 |
| CORS | Liste d’origines explicite existante | Conserver |
| En-têtes de sécurité | Helmet absent | Ajouter en C1 |
| Limitation de fréquence | Absente | Ajouter aux routes publiques sensibles en C1 |
| Erreurs API | Gestionnaire 500 central simple | Étendre sans casser les messages actuels |
| Notifications | Erreurs avalées et aucun rollback dans `socket.tsx` | Corriger en F1 et tester côté API en C1 |
| Réinitialisation du mot de passe | Absente | C3/F2-F3 |
| Fichiers Premium | Absents | F1 puis F2/F3 |

## 5. Risques P0/P1 toujours présents mais reportés après C1

- `CommandeClient` calcule toujours montant, dette et avance dès la saisie, avant livraison acceptée.
- La création et le règlement de commandes ne possèdent pas de clé d’idempotence générique.
- `DELETE /api/produits/:id` supprime encore physiquement le produit.
- Plusieurs calculs de journée mélangent UTC, heure locale du serveur et date SQL ; `Africa/Kinshasa` n’est pas centralisé.
- Le registre de caisse actuel ne constitue pas encore le circuit de sessions nominatives, remises contradictoires et comptage officiel prévu par le nouveau plan.
- Les nombreux modules ajoutés disposent de peu de tests automatisés par rapport à leur surface.

Ces constats ne doivent pas être mélangés à C1. Ils seront traités par petites PR après création du filet de sécurité.

## 6. Correction du plan initial

La cible « reproduire la clôture multi-caissiers de l’ancien code » est retirée de C1 : la route de clôture auditée au commit `27724820…` n’existe plus sous cette forme sur `main-a7fm5x`.

La première vague correcte est :

- **Codex C1 :** tests API, CI, sécurité HTTP, limitation de fréquence, structure d’erreur et documentation des risques reportés ;
- **Claude F1 :** bibliothèque UI Premium, tests frontend et rollback des notifications ;
- base commune : `main-a7fm5x` au commit `f7880b90…` ;
- aucune modification croisée des zones de fichiers.

## 7. Statut de `main`

La branche GitHub `main` n’est pas la source de vérité actuelle. La décision de fusionner les 152 commits de `main-a7fm5x` vers `main` doit être prise séparément, après vérification de déploiement et sauvegarde. En attendant, toutes les branches de développement prévues dans la coordination partent de `main-a7fm5x`.
