# Le Livre Boulangerie Lomoto

Bienvenue dans le livre technique et pédagogique consacré à l'application **Boulangerie Lomoto** — le logiciel de gestion commerciale utilisé par la boulangerie du même nom (République Démocratique du Congo).

Ce livre a un objectif simple à énoncer et ambitieux à réaliser : permettre à quelqu'un qui ne connaît **ni l'application, ni les technologies utilisées** de comprendre le produit en profondeur, de l'installer, de l'utiliser correctement dans tous ses rôles, puis — à terme — de le maintenir et de le faire évoluer sans dépendre de son créateur d'origine.

## Comment lire ce livre

Vous n'êtes **pas obligé de tout lire dans l'ordre**. Trois façons d'entrer dans le livre :

1. **Vous voulez comprendre le produit et vous en servir** → commencez par le Volume 1 (Présentation), puis allez directement au Volume 22 (Guide complet d'utilisation).
2. **Vous voulez apprendre à développer sur ce projet** → lisez dans l'ordre les Volumes 1 à 8, puis explorez les volumes thématiques (Back-end, Front-end, Base de données...) selon le module qui vous intéresse.
3. **Vous cherchez une réponse précise sur un fichier ou une fonction** → utilisez `INDEX_DU_CODE.md`, qui relie chaque fichier et chaque symbole important au chapitre qui l'explique.

## Où trouver quoi

| Fichier | Contenu |
|---|---|
| `TABLE_DES_MATIERES.md` | Sommaire complet, volume par volume |
| `PLAN_DETAILLE.md` | Plan détaillé de chaque volume (sous-sections prévues) |
| `INVENTAIRE_DU_PROJET.md` | Résultat de l'audit : tous les fichiers du projet, classés par niveau de risque métier |
| `MATRICE_DE_COUVERTURE.md` | Suivi de l'avancement de la rédaction, fichier par fichier |
| `ETAT_DE_PROGRESSION.md` | Où en est la rédaction, quelle est la prochaine tâche (à lire en premier si vous reprenez ce travail) |
| `GLOSSAIRE.md` | Définition de tous les termes techniques employés |
| `INDEX_DU_CODE.md` | Table de correspondance fichier/symbole → chapitre |
| `volumes/` | Le contenu du livre lui-même, volume par volume |
| `annexes/` | Compléments : registre des écarts entre le code et la spécification, schémas complémentaires |

## Principes qui gouvernent ce livre

- **Le code du dépôt est la vérité sur ce que l'application fait réellement.** `docs/spec-boulangerie.md` (la spécification fonctionnelle du projet, tenue à jour par l'équipe) est la référence sur ce que l'application **devrait** faire. Quand les deux divergent, ce livre le signale explicitement au lieu de trancher à la place de l'équipe.
- **Rien n'est inventé.** Quand une information ne peut pas être confirmée dans le code actuel, le livre l'écrit noir sur blanc plutôt que de deviner.
- **Aucun secret n'est révélé.** Les variables d'environnement sont expliquées par leur rôle, jamais par leur valeur.
- **La priorité va aux modules où l'argent réel et les décisions sensibles sont en jeu** (commandes, caisse, commissions, paie, permissions, approbations) — voir la grille de risque dans `INVENTAIRE_DU_PROJET.md`.

## État d'avancement

Ce livre est un chantier en cours, rédigé par lots successifs. Consultez `ETAT_DE_PROGRESSION.md` pour savoir précisément ce qui est déjà écrit et ce qui reste à faire. Un fichier n'est jamais réécrit une fois marqué « Vérifié » dans `MATRICE_DE_COUVERTURE.md` — chaque nouvelle session reprend exactement là où la précédente s'est arrêtée.
