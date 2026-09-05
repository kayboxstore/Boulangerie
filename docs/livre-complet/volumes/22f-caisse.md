# Volume 22f — Caisse

> Sixième sous-chapitre du Guide complet d'utilisation. Le registre de Caisse est l'écran quotidien du Caissier(ère) — ce chapitre explique comment il fonctionne et pourquoi certains chiffres se comportent comme ils le font, en s'appuyant sur le comportement déjà vérifié techniquement au Volume 11j.

## 1. Un registre recalculé, jamais un objet figé

Point important à comprendre avant tout le reste : il n'existe **aucune action de clôture** dans cet écran. Le registre d'une journée n'est pas un document que l'on remplit puis que l'on verrouille définitivement — c'est un **calcul refait à chaque consultation**, à partir des commandes, des règlements et des dépenses réellement enregistrés ce jour-là. Consulter le registre d'une date passée affiche donc toujours l'état le plus à jour possible, même si des données ont été corrigées après coup ailleurs dans l'application.

## 2. Le taux du jour, première tâche de la journée

Avant que la dépense farine automatique (§4) ne puisse fonctionner, un taux de change doit être saisi pour la date du jour. Le reste du registre (entrées, dettes payées, dépenses manuelles, solde) fonctionne normalement même sans taux défini — seule la ligne farine en dépend.

**Redéfinir le taux d'un jour déjà renseigné** n'est pas une erreur : la nouvelle valeur remplace simplement l'ancienne pour cette même date, et ce changement reste tracé dans le Journal d'audit (Volume 11g) comme toute autre modification.

## 3. Les quatre colonnes du registre

| Colonne | Origine | Calcul |
|---|---|---|
| **Entrées** | Automatique | Argent reçu à la création des commandes du jour |
| **Dettes payées** | Automatique | Somme des règlements encaissés ce jour, avec le détail client par client |
| **Dépenses** | Saisies manuellement (+ la ligne farine automatique, §4) | Somme des motifs saisis |
| **Solde** | Automatique | Entrées + Dettes payées − Dépenses |

### 3.1 Pourquoi un même paiement n'est jamais compté deux fois

Un point qui peut sembler contre-intuitif au premier abord, mais qui obéit à une règle stricte : le montant reçu par une commande **inclut** tous les règlements ultérieurs versés sur cette même commande, même s'ils arrivent le jour même de sa création. Sans précaution, un règlement encaissé le jour même de la commande apparaîtrait donc deux fois — une fois dans « Entrées », une fois dans « Dettes payées ».

**Exemple concret** : une commande de 50 000 Fc est créée aujourd'hui avec 30 000 Fc reçus immédiatement. Plus tard dans la journée, le client revient régler les 20 000 Fc restants. Le registre affiche alors **30 000 Fc dans « Entrées »** (uniquement ce qui a été versé au moment précis de la création) et **20 000 Fc dans « Dettes payées »** (le règlement, même s'il a eu lieu le même jour). Total : 50 000 Fc, exactement ce qui a réellement été encaissé — jamais 70 000 Fc, jamais 30 000 Fc.

## 4. Le solde négatif : impossible à manquer

Si le solde du jour passe sous zéro, il s'affiche **en gras et en rouge vif** — une couleur volontairement différente du reste de l'identité visuelle de l'application, pour que ce signal saute aux yeux immédiatement, aussi bien sur le registre lui-même que sur le Tableau de bord (Volume 22c aborde le Tableau de bord en tant qu'écran d'accueil ; ce même solde y est repris à l'identique).

## 5. La dépense farine automatique

Une case à cocher permet d'ajouter automatiquement, en un clic, la dépense de farine du jour — calculée à partir du taux du jour et du nombre de sacs réellement utilisés en production (Volume 22d).

### 5.1 Cocher la case : trois conditions

Activer cette dépense automatique nécessite que trois conditions soient réunies :

1. **Aucune ligne farine ne doit déjà exister pour cette date** — impossible de l'ajouter deux fois.
2. **Un taux du jour doit avoir été défini** (§2) — sans lui, le montant ne peut pas être calculé.
3. **Au moins une production doit avoir été enregistrée ce jour-là** (Volume 22d) — sans elle, le nombre de sacs utilisés est inconnu.

Si l'une de ces conditions manque, l'application refuse d'ajouter la ligne, avec un message qui indique précisément laquelle des trois poser en premier plutôt que de laisser deviner.

### 5.2 Décocher la case : toujours possible

Retirer une ligne farine déjà posée reste **toujours** possible, même si les conditions qui avaient permis de la créer ont changé depuis (par exemple, si la production du jour a été supprimée après coup). Aucune des trois vérifications ci-dessus ne s'applique pour décocher — seulement pour cocher.

### 5.3 Une valeur figée au moment du calcul

Un détail important si le taux du jour est modifié après coup (§2) : la ligne de dépense farine déjà enregistrée **garde le taux qui était en vigueur au moment où elle a été calculée**, elle n'est jamais recalculée rétroactivement si le taux change ensuite. Pour appliquer un nouveau taux à la dépense farine, il faut décocher puis recocher la case.

## 6. Résumé du sous-chapitre

| Question | Réponse |
|---|---|
| Faut-il « clôturer » la journée à un moment donné ? | Non — le registre est recalculé à chaque consultation, jamais figé |
| Un règlement encaissé le jour même de la commande compte-t-il deux fois ? | Non — il est automatiquement réparti entre Entrées et Dettes payées sans doublon |
| Que se passe-t-il si le solde devient négatif ? | Affichage en gras et rouge vif, sur le registre et le Tableau de bord |
| Puis-je cocher la case farine sans taux ni production du jour ? | Non, les deux sont obligatoires — message explicite indiquant lequel manque |
| Puis-je toujours décocher la case farine ? | Oui, sans aucune condition |
| Un changement de taux modifie-t-il une ligne farine déjà posée ? | Non, elle garde le taux du moment où elle a été calculée |

**Prochain sous-chapitre** : Volume 22g — Commissions.
