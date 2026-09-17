# Registre des écarts spec/code — mise à jour du 4 septembre 2026

> Reprend la méthode et le format de `docs/livre-complet/annexes/ecarts-spec-code.md` (arrêté au 20/08/2026) :
> chaque écart porte la section de spec concernée, le(s) fichier(s) de code, ce que dit la spec, ce que fait
> le code, et le statut « Écart entre spec et code — à confirmer avec l'équipe ». Ce livre ne tranche jamais
> lequel des deux textes a raison — cette règle reste appliquée ici.

## Les deux écarts d'origine

### [Équipe & permissions] Aucune interface pour « Modifier les permissions d'un rôle » — RÉSOLU

- **Section de la spec concernée** : 2 (liste des 5 tâches critiques).
- **Fichier(s) de code concerné(s)** : `apps/api/src/routes/roles.ts` (inchangé, déjà fonctionnel),
  `apps/web/src/pages/Equipe.tsx` (nouveau).
- **Ce que dit la spec** : la modification des permissions d'un rôle est l'une des 5 tâches critiques
  réellement disponibles dans l'application.
- **Ce que fait le code aujourd'hui** : `apps/web/src/pages/Equipe.tsx:162-165` porte le commentaire
  explicite *« PUT /api/roles/:id/permissions REMPLACE la matrice complète du rôle — on envoie donc toujours
  les 10 modules »*, `ouvrirPermissions()` (lignes 171-179) pré-remplit depuis `role.permissions` en
  complétant les modules absents à `AUCUN`, et `sauverPermissions` (lignes 181-186) envoie systématiquement
  `MODULES.map(...)`, jamais un sous-ensemble. Un bouton « Modifier les permissions » ouvre un `Dialog`
  (lignes 810-861) avec un sélecteur par module.
- **Statut** : **Résolu** (PR #50, fusionnée le 04/09/2026). Vérifié indépendamment par un agent de cette
  session sans connaissance préalable de l'implémentation, et vérifié bout en bout avec de vrais comptes de
  démo (Admin Principal → exécution immédiate, Admin secondaire → demande en attente, rôle sans écriture
  Équipe → aucun bouton visible).

### [Tests] Playwright recommandé par la spec, absent du dépôt — RÉSOLU, couverture encore minimale

- **Section de la spec concernée** : 7 (« Stack technique recommandée »).
- **Fichier(s) de code concerné(s)** : `apps/web/package.json`, `apps/web/playwright.config.ts`,
  `apps/web/e2e/connexion.spec.ts`.
- **Ce que dit la spec** : Playwright pour les tests E2E, au même titre que Vitest pour les unitaires.
- **Ce que fait le code aujourd'hui** : `@playwright/test": "^1.62.1"` est présent
  (`apps/web/package.json:31`), la configuration existe, et **un** fichier de test réel est commité —
  `apps/web/e2e/connexion.spec.ts`, 3 scénarios (connexion valide, mot de passe incorrect, menu grisé par
  rôle).
- **Nuance à ne pas perdre** : `apps/web/package.json` ne définit aucun script `test:e2e`, et
  `.github/workflows/ci.yml` ne référence Playwright nulle part — la suite existe mais ne s'exécute jamais
  automatiquement. Voir `ZONES_OMBRE.md` §3-4 pour le détail.
- **Statut** : **Résolu au sens outillage/premier test** (l'écart littéral — « absent du dépôt » — n'est
  plus vrai). **Toujours partiel au sens couverture** : 1 fichier, 3 scénarios, aucun des trois flux
  financiers critiques couvert, pas branché en CI. À reformuler plutôt qu'à clore silencieusement.

### [Production/Commandes] Cycle de livraison (C4) — pour mémoire, déjà résolu le 19/08/2026

Repris tel quel du registre d'origine, aucun changement : la spec section 3.3 f couvre le module depuis le
19/08/2026, sans écart résiduel constaté.

---

## Nouveaux écarts trouvés cette session (apparus après le 20/08/2026)

### [État système] Réinitialisation — comportements non documentés par la spec 3.15

- **Section de la spec concernée** : 3.15 (« État système »).
- **Fichier(s) de code concerné(s)** : `apps/api/src/lib/barriereEcriture.ts`,
  `apps/api/src/services/reinitialisation.ts`, `apps/api/src/routes/etat-systeme.ts`,
  `apps/api/src/services/sauvegarde.ts`.
- **Ce que dit la spec** : décrit la confirmation par mot exact, la sauvegarde de sûreté préalable et
  l'effacement — rien de plus sur le déroulement observable par les autres utilisateurs pendant l'opération,
  ni sur une éventuelle indisponibilité du bouton lui-même.
- **Ce que fait le code aujourd'hui** (Lot P0, fusionné le 30/08/2026) :
  1. **Coupure de service globale, pas seulement pour l'Admin Principal.** `barriereEcriture.ts:154-166`
     (`gardeBarriereEcriture`) renvoie `503` (`code: "REINITIALISATION_EN_COURS"`, message *« Une
     réinitialisation de la base de données est en cours de préparation. Réessayez dans quelques
     instants. »*) à **toute** requête HTTP mutante dès que la barrière est active, pour **tous les
     utilisateurs connectés** — le commentaire en tête du fichier (lignes 24-30) l'assume explicitement
     comme *« une coupure de service brève et totale »*.
  2. **Réinitialisation désactivée par défaut en production.** `reinitialisation.ts:14-25` introduit
     `REINITIALISATION_PRODUCTION_AUTORISEE` (absente par défaut) ; `GET /api/etat-systeme` expose désormais
     `reinitialisation: { autorisee, motifIndisponibilite }` (`etat-systeme.ts:127-130`), et
     `POST /api/etat-systeme/reinitialiser` peut renvoyer `403` (`code: "REINITIALISATION_DESACTIVEE_PRODUCTION"`).
     Le bouton, censé être disponible pour l'Admin Principal selon la spec, peut désormais être
     **indisponible par construction** en production.
  3. **Validation renforcée du dump, avec délai et nouveaux messages d'échec.** `sauvegarde.ts:426-439`
     (`validerDump`) ajoute une double vérification avant qu'une sauvegarde manuelle soit journalisée en
     succès ou téléchargée, avec des messages d'erreur possibles (« archive vide », « aucune entrée
     exploitable ») et un délai perceptible non mentionné dans la spec.
- **Statut** : **Écart entre spec et code — à confirmer avec l'équipe.** Le plus significatif des écarts
  trouvés cette session : il affecte potentiellement **tous** les utilisateurs connectés (point 1), pas
  seulement l'Admin Principal qui déclenche l'action — le genre de comportement qu'un utilisateur pourrait
  légitimement signaler comme un bug s'il n'est prévenu nulle part. Probablement un simple oubli de mise à
  jour documentaire (le durcissement est délibéré et bien tracé dans `DEPLOIEMENT.md`), mais la spec elle-même
  n'en dit rien.

### [Fournisseurs, Production, Travailleurs] Nouveaux messages de conflit de concurrence non documentés

- **Section de la spec concernée** : 3.3, 3.6, 3.18 — aucune des trois ne mentionne de comportement de
  concurrence.
- **Fichier(s) de code concerné(s)** : `apps/api/src/routes/fournisseurs.ts:58-61,102-104`,
  `apps/api/src/routes/production.ts:662-666,1006-1010`, `apps/api/src/routes/travailleurs.ts:81,84`.
- **Ce que dit la spec** : rien sur des erreurs de concurrence dans ces trois modules.
- **Ce que fait le code aujourd'hui** (Lots P1, fusionnés les 31/08-01/09/2026) : chacun peut désormais
  renvoyer un `503` (« Conflit de concurrence persistant — réessayez. Rien n'a été enregistré. » ou
  variante propre au module) en cas de modifications concurrentes réelles sur la même ressource. Ce pattern
  existait déjà ailleurs dans l'application avant ce lot (`caisse.ts`, `commandes.ts`, `approbations.ts`) —
  ce n'est donc pas un nouveau type de comportement pour l'utilisateur qui l'aurait déjà rencontré sur ces
  autres écrans, seulement une extension à trois modules qui ne l'avaient pas encore.
- **Statut** : **Écart entre spec et code — à confirmer avec l'équipe**, mais de portée mineure : ne se
  déclenche qu'en cas de véritable écriture concurrente sur la même ressource (rare pour une équipe de 2 à 5
  personnes), et le message reste cohérent avec un pattern déjà connu ailleurs dans l'application.

### [Tableau de bord] Marge par produit / marge globale journalière — fallback promis par la spec, absent

- **Section de la spec concernée** : 3.8.
- **Fichier(s) de code concerné(s)** : `apps/api/src/routes/rapports.ts`, `apps/web/src/pages/Dashboard.tsx`.
- **Ce que dit la spec** : *« le widget affiche volume + CA par produit en attendant »* (fallback explicite),
  et *« une marge globale journalière, elle, reste calculable »*.
- **Ce que fait le code aujourd'hui** : ni la marge par produit (attendue comme non calculable, cohérent),
  ni le fallback volume+CA par produit, ni la marge globale journalière ne sont implémentés —
  `apps/api/src/routes/rapports.ts` (351 lignes, lu intégralement) n'expose aucune de ces trois données, et
  `apps/web/src/pages/Dashboard.tsx` (619 lignes) ne contient aucune occurrence du mot « produit ».
- **Statut** : **Écart entre spec et code — à confirmer avec l'équipe.** Contrairement à la marge par
  produit elle-même (dont l'absence est justifiée par la spec), le fallback et la marge globale sont
  présentés par la spec comme faisables aujourd'hui — leur absence n'a aucune justification documentée
  trouvée ailleurs dans le dépôt.

## Point de documentation, pas un écart spec/code au sens strict

### [Spec elle-même] Section 9, point 2ter — texte resté non mis à jour

`docs/spec-boulangerie.md:897` affirme encore littéralement que le grisage des modules hors permission
reste « à faire avant la Phase 4 » et que les entrées non accessibles sont « cachées, pas grisées ». C'est
**faux** : `apps/web/src/components/Layout.tsx:67-69,127-163` implémente bien le grisage
(`aria-disabled="true"`, `cursor-not-allowed`, infobulle) — confirmé indépendamment cette session, et
vérifié une troisième fois par le test Playwright `connexion.spec.ts:53-67`. Ce n'est pas un écart entre la
spec et le code au sens où le livre l'entend (le code, lui, est correct et conforme à l'intention de la
section 2 de la spec) — c'est un paragraphe de planification (section 9, « Ordre de construction ») resté
non nettoyé après que le travail qu'il annonçait a été livré. À corriger dans `docs/spec-boulangerie.md`
directement (simple suppression de la mention obsolète), pas dans le code.

## Correction à apporter au livre technique (fait ancien, plus vrai aujourd'hui)

`docs/livre-complet/volumes/09-ui-composants.md` affirme que `calculerLiens` (`Layout.tsx`) est définie mais
jamais appelée. **Ce n'est plus vrai** : `Layout.tsx:196` l'appelle bien
(`const liens = calculerLiens(peutLire, peutEcrire, t);`), confirmé cette session par recherche exhaustive
de toute logique de navigation dupliquée en ligne (aucune trouvée). Le code a manifestement été corrigé
après la rédaction de ce volume, sans que le volume soit régénéré. À signaler à qui reprendra le livre
technique — ni un écart spec/code, ni un point pour ce registre à proprement parler, mais une inexactitude
du livre lui-même qu'il serait dommage de laisser se propager dans un futur audit qui s'y fierait sans
revérifier.
