# Volume 25 — Possibilités d'évolution

> Ce chapitre ne décrit aucun fichier de code nouveau. Il rassemble, en un seul endroit, les pistes d'évolution déjà signalées au fil de ce livre — commentaires obsolètes, limites réelles observées, fonctionnalités correctement construites côté serveur mais jamais atteintes par une interface. Chaque piste est présentée en deux temps, rigoureusement séparés :
>
> - **Constat** : un fait vérifié dans le code ou dans la spécification, déjà établi dans un chapitre précédent, avec son renvoi exact.
> - **Recommandation** : l'avis de l'auteur de ce livre sur ce qu'il serait raisonnable d'envisager. Une recommandation n'est **jamais** une décision prise, ni une promesse de fonctionnalité future — seulement une suggestion soumise à l'équipe, qui reste seule décisionnaire.
>
> Conformément au mandat de ce livre, aucun code applicatif n'a été modifié pour produire ce chapitre.

## 1. Fonctionnalités construites côté serveur mais non exposées côté écran

Ces deux cas ont déjà été signalés en détail plus tôt dans le livre : dans les deux cas, le chemin serveur existe, fonctionne, et est même déjà relié au mécanisme d'approbation des tâches critiques — mais aucune interface ne permet de l'atteindre.

### 1.1 Modifier les permissions d'un rôle

- **Constat** : la route `PUT /api/roles/:id/permissions` existe, est fonctionnelle, sécurisée côté serveur, et aiguillée vers le workflow d'approbation comme les 4 autres tâches critiques (exécuteur `MODIFIER_PERMISSIONS_ROLE`). Une recherche exhaustive dans `apps/web/src` ne montre aucun appel à cette route ni aucun composant permettant de modifier la matrice de permissions d'un rôle. C'est le premier écart entre la spec et le code trouvé dans ce livre (Volume 11d, `annexes/ecarts-spec-code.md`).
- **Recommandation** : puisque le travail côté serveur est déjà fait et testé indirectement (le mécanisme d'approbation partagé avec les 4 autres tâches critiques est lui-même bien couvert), ajouter l'écran manquant représente vraisemblablement moins d'effort que construire une nouvelle fonctionnalité de zéro. Avant toute implémentation, il serait utile de confirmer avec l'équipe si cette absence est un oubli ou un choix délibéré (peut-être une modification jugée trop sensible pour une interface graphique, réservée à un accès direct à l'API par une personne de confiance).

### 1.2 Modifier le taux de taxe d'un produit

- **Constat** : `routes/produits.ts` expose la modification du taux de taxe (`MODIFIER_TAUX_TAXE`) comme une tâche critique fonctionnelle, deuxième occurrence concrète du même mécanisme d'approbation. `ProduitsPage` (frontend) n'envoie cependant jamais de changement de `tauxTaxe` — aucun champ éditable trouvé pour ce champ dans l'écran Produits (Volume 11z-1). Ce n'est pas un écart spec/code (la spec ne décrit pas explicitement d'écran dédié), mais une observation de fonctionnalité serveur inatteignable.
- **Recommandation** : si la boutique a un jour besoin de faire varier ce taux par produit (plutôt qu'une valeur globale gérée ailleurs), le même travail d'ajout d'un champ éditable relié à la route existante suffirait — aucune nouvelle logique métier ne serait nécessaire.

## 2. Limites connues, réelles, déjà documentées pour l'utilisateur

Ces points ne sont pas des écarts entre la spec et le code — la spec elle-même ne prévoit pas ces fonctionnalités — mais ce sont des absences qui ont une incidence pratique réelle, déjà signalées aux chapitres correspondants.

### 2.1 Aucune réinitialisation de mot de passe

- **Constat** : ni une procédure self-service, ni une procédure déclenchée par un Admin, n'existent nulle part dans le projet — recherche exhaustive confirmée dans `routes/auth.ts` et `routes/equipe.ts` (Volume 11c, confirmé au Volume 22a). La seule route qui définit un mot de passe est celle de la création initiale du compte.
- **Recommandation** : dans une petite équipe où le compte est toujours lié à une fiche Travailleur et administré par un rôle de confiance, une solution minimale (un Admin peut définir un nouveau mot de passe temporaire depuis l'écran Équipe, sans passer par un e-mail) couvrirait déjà l'essentiel du besoin sans la complexité d'un envoi d'e-mail de réinitialisation self-service.

### 2.2 Aucun mode hors-ligne

- **Constat** : aucune trace de service worker ni de mécanisme de mise en cache hors-ligne dans `apps/web`, vérifié par recherche exhaustive (Volume 21). Toute coupure réseau interrompt l'usage de l'application.
- **Recommandation** : un mode hors-ligne complet représente un chantier d'ampleur (mise en cache des données, synchronisation différée, résolution de conflits) largement disproportionné par rapport au constat actuel — non recommandé comme prochaine étape, sauf besoin métier explicite à confirmer avec l'équipe (par exemple si des postes doivent réellement fonctionner en zone mal couverte).

### 2.3 Playwright recommandé par la spec, absent du dépôt

- **Constat** : la spec (section 7) liste Playwright pour les tests E2E, aux côtés de Vitest ; aucune dépendance ni fichier de configuration Playwright n'existe dans le dépôt actuel, seul `README.md` évoque une pratique ponctuelle non conservée. C'est le deuxième écart spec/code trouvé dans ce livre (Volume 19, `annexes/ecarts-spec-code.md`).
- **Recommandation** : à ce jour, aucune route API ni aucun composant frontend n'est couvert par un test automatisé rejouable (Volume 19) — l'ajout d'une suite Playwright, même limitée aux parcours les plus critiques (connexion, création de commande, approbation), réduirait le risque de régression silencieuse signalé au Volume 24 (§4) comme le principal filet de sécurité manquant aujourd'hui.

### 2.4 Aucune pagination réelle sur les listes longues

- **Constat** : aucune utilisation de `skip` (pagination Prisma) n'a été trouvée nulle part dans le projet — seulement des plafonds fixes (`take: 60/100/200`) sur les listes longues (Volume 20). La spec ne fixe aucune exigence de performance chiffrée, cohérent avec une petite équipe.
- **Recommandation** : sans besoin actuel (les plafonds actuels couvrent largement le volume d'une petite boutique), une vraie pagination ne serait à envisager que si le volume de données dépassait significativement ces plafonds dans le futur — à surveiller plutôt qu'à anticiper immédiatement.

### 2.5 Traductions ln/sw non finalisées

- **Constat** : les dictionnaires `ln.json`/`sw.json` portent une clé `_note` absente des deux autres langues, documentant explicitement ces traductions comme un premier jet non relu par un locuteur natif (Volume 17).
- **Recommandation** : une relecture par un locuteur natif avant tout déploiement auprès de personnel utilisant réellement ces langues, déjà recommandée au Volume 23 comme élément de la checklist d'administration.

## 3. Observations de qualité de code signalées en cours de route

Ces points n'affectent le comportement observable d'aucun écran — ils ont été relevés comme des pistes de nettoyage interne, sans urgence.

| Constat | Chapitre | Recommandation |
|---|---|---|
| `calculerLiens` (`Layout.tsx`) est définie mais jamais appelée — `Layout()` réimplémente la même logique en ligne | Volume 9 | Supprimer la fonction inutilisée ou factoriser `Layout()` pour l'utiliser, au choix de l'équipe |
| Le champ `roleId` du jeton JWT n'est lu par aucun point d'entrée d'authentification (HTTP ou Socket.io) pour construire les permissions réelles, toujours recalculées depuis la base | Volumes 11b, 12 | Vérifier s'il sert un usage non trouvé dans ce livre avant d'envisager sa suppression ; sinon, simplifier la charge utile du jeton |
| `README.md` (section « Phase actuelle » et une partie des Conventions) décrit encore l'ancienne Caisse (vente au comptoir), retirée depuis la refonte 3.1 | Volume 4 | Mettre à jour la documentation d'installation pour refléter l'état actuel du code |
| Commentaire de `routes/rapports.ts` sur `/cloture-quotidienne` resté obsolète après l'extension de la portée aux Admins (spec 3.8) | Volume 11z-5 | Mettre à jour le commentaire pour éviter une confusion future |
| `schema.prisma` contenait un commentaire présentant `Vente`/`LigneVente`/`ClotureCaisse` comme conservées, alors que ces tables ont été réellement supprimées par migration | Volume 13 | Corriger le commentaire pour qu'il reflète l'état réel du schéma |

## 4. Pistes d'ergonomie relevées en cours de route

- **Constat** : `ParametresPage` (modification de Qualité) ne distingue pas visuellement, au moment de l'action, une exécution immédiate d'une mise en attente d'approbation — contrairement à `Equipe.tsx`, qui utilise le même mécanisme serveur (`traiterActionCritique`) avec un retour explicite à l'écran (Volume 11z-4, rappelé au Volume 22b).
  **Recommandation** : aligner le comportement visuel de `ParametresPage` sur celui déjà en place dans `Equipe.tsx`, puisque le mécanisme serveur sous-jacent est strictement identique.
- **Constat** : pour une action critique différée puis approuvée, le Journal d'audit attribue l'écriture à l'Admin Principal qui a approuvé, pas à l'Admin secondaire qui l'a initialement demandée — l'origine réelle reste retrouvable, mais uniquement via l'écran Approbations, sans lien croisé direct entre les deux écrans (Volume 11g).
  **Recommandation** : un lien croisé (par exemple un identifiant de demande visible depuis l'entrée du Journal d'audit) faciliterait l'investigation a posteriori, sans remettre en cause le choix actuel d'attribution.
- **Constat** : `routes/delegations.ts` n'empêche pas deux délégations actives simultanées sur le même couple utilisateur/module, et `DELETE /:id` ne vérifie pas que l'appelant est l'auteur (`creeParId`) de la délégation révoquée (Volume 11e). Ni l'un ni l'autre ne contredit la spécification, qui ne mentionne aucune de ces règles.
  **Recommandation** : à évaluer selon l'usage réel constaté par l'équipe — si les délégations se chevauchent rarement en pratique, ce point reste théorique ; sinon, une validation supplémentaire pourrait être ajoutée.
- **Constat** : la protection contre la suppression d'un Travailleur ayant des bulletins de paie repose uniquement sur une vérification applicative (`_count.bulletinsPaie > 0` → `409`) dans la route `DELETE /:id`, alors que le schéma Prisma déclare `onDelete: Cascade` sur `BulletinPaie` — un futur appel à `prisma.travailleur.delete` par un autre chemin ne serait pas protégé (Volume 11k-1).
  **Recommandation** : envisager de renforcer cette protection au niveau du schéma lui-même (par exemple `onDelete: Restrict`) pour qu'elle ne dépende plus d'une seule route applicative — changement structurel à ne pas prendre à la légère, hors périmètre de ce livre.

## 5. Pistes hors code (infrastructure et exploitation)

Ces points ne concernent aucun fichier du dépôt — ils relèvent de choix d'hébergement déjà documentés aux Volumes 21 et 23.

- **Constat** : l'offre gratuite Render fait expirer définitivement la base de données PostgreSQL 30+14 jours après sa création (perte totale des données), et met le service web en veille après 15 minutes d'inactivité.
  **Recommandation** : un passage à un plan payant Render (ou équivalent) supprimerait ces deux contraintes — déjà signalé comme le risque le plus grave documenté dans ce livre (Volume 21), à arbitrer par l'équipe selon le budget disponible.

## 6. Résumé du chapitre

| Catégorie | Nombre de pistes | Aucune ne nécessite de décision immédiate |
|---|---|---|
| Fonctionnalité serveur non exposée | 2 | Oui — travail d'interface seul, logique déjà en place |
| Limite connue et documentée pour l'utilisateur | 5 | Oui — à confirmer avec l'équipe selon le besoin réel |
| Qualité de code (nettoyage interne) | 5 | Oui — aucun impact utilisateur observable |
| Ergonomie | 4 | Oui — améliorations de confort, pas de correctif de sécurité |
| Infrastructure | 1 | Oui — arbitrage budgétaire |

Aucun écart spec/code nouveau n'a été trouvé pour ce chapitre : les deux seuls écarts de tout ce livre (Volumes 11d et 19) sont ceux déjà repris en §1.1 et §2.3.

**Prochain volume** : Volume 26 — Glossaire, index et annexes finaux.
