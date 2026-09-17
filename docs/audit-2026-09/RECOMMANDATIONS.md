# Recommandations — Audit du 4 septembre 2026

> Reprend et met à jour les pistes du Volume 25 du livre technique (deux d'entre elles sont désormais
> réglées et retirées ; une s'est révélée fausse et est retirée). Chaque entrée sépare strictement le
> **constat** (fait vérifié, avec sa preuve) de la **recommandation** (avis, jamais une décision prise) —
> aucune des deux n'est mélangée à l'autre. Le niveau de risque décrit ce qui se passe si le point n'est
> **pas** traité ; l'effort est une estimation grossière, pas un chiffrage.

---

## Priorité 1 — à trancher en premier

### 1. Vérifier le risque de branche Neon signalé

- **Constat** : un risque a été signalé (branche Neon « production » vide, données réelles sur une branche
  à nom temporaire) mais aucune trace de ce risque précis n'existe dans `docs/`, `DEPLOIEMENT.md` ou
  `render.yaml` — recherche exhaustive faite cette session. Impossible à confirmer ou infirmer depuis le
  dépôt ; nécessite un accès direct à la console Neon, hors périmètre de cette session.
- **Recommandation** : vérifier directement dans la console Neon quelle branche porte `DATABASE_URL` de
  production, et si une branche nommée « production » distincte existe et est effectivement vide. Si
  confirmé, documenter dans `DEPLOIEMENT.md` au même titre que la fenêtre PITR déjà tranchée.
- **Risque si non traité** : élevé **si le risque s'avère réel** (mauvaise branche utilisée en cas
  d'incident, confusion lors d'une restauration) — mais actuellement de probabilité inconnue, faute de
  vérification.
- **Effort** : très faible — un contrôle dans un tableau de bord, pas de code.

### 2. Documenter le nouveau comportement de la réinitialisation (section 3.15)

- **Constat** : depuis le Lot P0 (30/08/2026), une réinitialisation coupe le service pour **tous** les
  utilisateurs connectés le temps de sa préparation, peut être désactivée par défaut en production, et
  valide désormais le dump avec un délai perceptible — rien de tout cela n'est dans
  `docs/spec-boulangerie.md` §3.15 (détail et preuves dans `ECARTS_SPEC_CODE.md`).
- **Recommandation** : mettre à jour la section 3.15 de la spec pour refléter ces trois points. Aucun
  changement de code nécessaire — le comportement lui-même est délibéré et déjà bien tracé dans
  `DEPLOIEMENT.md`.
- **Risque si non traité** : moyen — un utilisateur ou un futur développeur pourrait interpréter la coupure
  de service comme un bug plutôt qu'un comportement voulu, générant un signalement ou une intervention
  inutile.
- **Effort** : faible — documentation uniquement.

---

## Priorité 2 — à planifier

### 3. Étendre Playwright aux 3 flux financiers critiques, et le brancher à la CI

- **Constat** : Playwright est installé et un premier test existe (connexion, menu grisé), mais aucun des
  trois flux critiques (règlement, clôture de caisse, cycle de livraison) n'a de couverture navigateur
  réelle, et la suite ne s'exécute jamais automatiquement (aucun script npm dédié, absente de
  `.github/workflows/ci.yml`) — voir `ZONES_OMBRE.md` §3-4.
- **Recommandation** : ajouter un scénario Playwright par flux critique (au minimum : confirmer un
  règlement, clôturer une session de caisse avec écart, faire progresser un cycle de livraison jusqu'à
  l'acceptation), ajouter un script `test:e2e` et l'intégrer à la CI. Les scripts `verifier-*-ci.ts`
  existants couvrent déjà la robustesse transactionnelle de ces flux — Playwright comblerait la couche
  encore absente : le câblage frontend réel.
- **Risque si non traité** : moyen — une régression purement frontend sur l'un de ces trois écrans (mauvais
  câblage, état de chargement cassé) ne serait détectée par rien d'automatisé.
- **Effort** : moyen — 3 à 5 scénarios, réutilisables du script de vérification manuelle déjà écrit pour
  l'éditeur de permissions de rôle (méthode déjà rodée cette session, non conservée dans le dépôt).

### 4. Champ `tauxTaxe` inatteignable depuis `ProduitsPage`

- **Constat** : la route serveur (`MODIFIER_TAUX_TAXE`, action critique fonctionnelle) existe, mais
  `apps/web/src/pages/Produits.tsx` n'a aucun champ pour le modifier (confirmé cette session, formulaire
  d'édition lu intégralement) — connu depuis le Volume 11z-1 du livre, toujours vrai.
- **Recommandation** : ajouter le champ éditable si la boutique envisage un jour de faire varier ce taux par
  produit ; sinon, laisser tel quel (le catalogue actuel est 100 % pain, sans TVA, donc sans besoin réel
  identifié à ce jour) — reprise de la recommandation déjà formulée par le livre technique, toujours valable.
- **Risque si non traité** : faible — aucun besoin métier actuel identifié.
- **Effort** : faible si un jour nécessaire (le mécanisme serveur est déjà prêt et testé).

### 5. Marge par produit / marge globale journalière (widget 3.8)

- **Constat** : la spec promet un fallback (« volume + CA par produit ») et affirme qu'une marge globale
  journalière « reste calculable » — ni l'un ni l'autre n'est implémenté (`ECARTS_SPEC_CODE.md`).
- **Recommandation** : soit construire le fallback promis (probablement peu coûteux : agrégation de données
  déjà présentes dans `CommandeClient`), soit ajuster la spec pour ne plus le présenter comme un engagement
  à part entière si ce n'est plus prioritaire.
- **Risque si non traité** : faible — pas de fonctionnalité métier bloquée, juste un widget de tableau de
  bord manquant par rapport à ce que le texte de référence promet.
- **Effort** : faible à moyen selon l'ambition retenue.

---

## Priorité 3 — hygiène documentaire et code, sans impact utilisateur

### 6. Mettre à jour le livre technique (retard de ~2 semaines de commits)

- **Constat** : `docs/livre-complet/` se déclare complet et daté du 20/08/2026, mais n'a pas été mis à jour
  pour les Lots P0/P1 (sauvegarde/restauration, durcissement Production/Fournisseurs/Distribution/
  Travailleurs) ni pour la permissions UI/Playwright livrées le 04/09. Deux affirmations concrètes du livre
  sont aujourd'hui fausses (`calculerLiens` désormais appelée ; les 2 écarts d'origine désormais résolus) —
  `ZONES_OMBRE.md` §5.
- **Recommandation** : programmer une session d'entretien du livre (sur le modèle de celles déjà faites les
  19 et 20/08/2026) pour intégrer les commits manqués et corriger les deux inexactitudes trouvées.
- **Risque si non traité** : faible mais cumulatif — chaque semaine sans mise à jour rend le livre un peu
  moins fiable comme référence, avec le risque qu'un futur audit s'y fie sans revérifier (ce qui a
  précisément causé l'épisode « Prospect » qui a motivé cet audit).
- **Effort** : moyen (plusieurs chapitres à retoucher), mais bien balisé par ce document.

### 7. Corriger le texte obsolète de la spec, section 9 point 2ter

- **Constat** : `docs/spec-boulangerie.md:897` affirme encore que le grisage des modules « reste à faire »,
  alors que c'est construit et vérifié (code + test Playwright) — `ECARTS_SPEC_CODE.md`.
- **Recommandation** : supprimer ou reformuler cette ligne pour refléter l'état livré.
- **Risque si non traité** : très faible — confusion possible pour un futur lecteur de la spec, rien de plus.
- **Effort** : trivial.

### 8. Vérification récente des services externes (Cloudflare, Gmail)

- **Constat** : les seules preuves de fonctionnement réel de l'email professionnel (Cloudflare) et de
  l'envoi d'export par email (Gmail) datent du 06/08/2026, jamais rejouées depuis dans la documentation
  consultée. Gemini n'a pas ce besoin, désactivé par construction (`ZONES_OMBRE.md` §2).
- **Recommandation** : refaire une vérification manuelle ponctuelle (créer un email pro de test, envoyer un
  export par email) à l'occasion d'un prochain déploiement, et noter la date dans `DEPLOIEMENT.md` ou
  `MISE-EN-PRODUCTION.md` comme déjà fait le 06/08.
- **Risque si non traité** : faible à modéré — une rupture silencieuse ne serait détectée qu'à l'usage
  (employé qui ne reçoit jamais son email pro), pas par la CI.
- **Effort** : faible — vérification manuelle, pas de code.

### 9. Nettoyage de code mort mineur

- **Constat** : `apps/web/src/lib/socket.tsx:192-195` invalide encore les clés de cache `["ventes"]`/
  `["clotures"]`, des modules supprimés depuis la refonte 3.1 — confirmé toujours vrai cette session, sans
  aucun effet observable (aucun composant ne lit ces clés).
- **Recommandation** : supprimer ces deux lignes à l'occasion d'un prochain passage dans ce fichier — pas
  urgent en soi.
- **Risque si non traité** : nul — code mort sans effet.
- **Effort** : trivial.

---

## Reprises du Volume 25 du livre technique, toujours valables sans changement

Ces points, déjà bien posés par le livre technique et non retouchés par cet audit (aucune preuve nouvelle
ne les change), restent à la discrétion de l'équipe — le lecteur intéressé les retrouvera en détail dans
`docs/livre-complet/volumes/25-evolutions.md` :

- Aucune réinitialisation de mot de passe (self-service ou admin) — recommandation déjà formulée : un
  Admin pourrait définir un mot de passe temporaire depuis Équipe, sans passer par un envoi d'email.
- Aucun mode hors-ligne — non recommandé comme prochaine étape, disproportionné par rapport au besoin
  actuel.
- Aucune pagination réelle — à surveiller, pas à anticiper tant que le volume reste celui d'une petite
  boutique.
- Traductions lingala/swahili non relues par un locuteur natif — à faire avant tout déploiement auprès de
  personnel utilisant réellement ces langues.
- Absence de contrôle de chevauchement/propriété sur les délégations temporaires de rôle.
- Protection de suppression d'un Travailleur reposant uniquement sur la route applicative, malgré
  `onDelete: Cascade` en base sur `BulletinPaie`.
- Incohérence d'affichage `ParametresPage` vs `Equipe.tsx` sur l'exécution immédiate vs mise en attente
  d'approbation.
- Passage à un plan Render payant — arbitrage budgétaire, hors code, déjà statu quo assumé par Augustin le
  03/09/2026 pour la fenêtre PITR Neon et le disque local.

## Points retirés de cet audit (rappel, pour éviter de les reproposer par erreur)

- ~~Ajouter une interface pour modifier les permissions d'un rôle~~ — **fait** (PR #50, 04/09/2026).
- ~~Installer Playwright~~ — **fait** au sens outillage (voir Priorité 2, point 3, pour ce qui reste).
- ~~Corriger `calculerLiens` non appelée~~ — **jamais un vrai problème actuellement** : vérifié cette
  session, la fonction est bien appelée (`Layout.tsx:196`). Le Volume 9 du livre technique décrivait un état
  antérieur du code — voir recommandation n°6 pour la mise à jour du livre.
