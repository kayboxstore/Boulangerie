# Pourcentage d'avancement — Audit du 4 septembre 2026

## Ce que ce pourcentage mesure, et ce qu'il ne mesure pas

Le périmètre de référence est **`docs/spec-boulangerie.md`**, pas une checklist externe : c'est le document
qui porte l'engagement de périmètre réel pour cette v1 (« le périmètre v1 est complet », spec §9). Le
pourcentage ci-dessous répond à une seule question : *parmi les fonctionnalités que la spec engage pour
cette version, combien sont construites et atteignables depuis l'interface par le rôle qui doit pouvoir les
utiliser ?*

Il ne mesure **pas** :
- la qualité ou la profondeur des tests (voir `ZONES_OMBRE.md`) ;
- la fraîcheur de la documentation (le livre technique a par exemple deux affirmations obsolètes, voir
  `ZONES_OMBRE.md` §5, sans que cela change l'état réel du code) ;
- les fonctionnalités listées « Hors périmètre (v1) » par la spec elle-même (section 4) ou explicitement
  écartées par une décision documentée — elles sont comptées à part, plus bas, jamais mélangées au calcul.

## Méthode

19 sections numérotées de `docs/spec-boulangerie.md` §3 (3.1 à 3.19), chacune notée :
**1** = Complet (construit, atteignable, cohérent avec la spec) · **0,5** = Partiel · **0** = Absent-oublié.
Même méthode de notation que celle déjà utilisée dans ce dépôt pour un exercice comparable
(`docs/coordination/ETAT_REEL_APRES_VAGUE_2.md` §7). Le détail section par section, avec preuves, est dans
`ETAT_PAR_MODULE.md` — ce document n'en reprend que le score.

| # | Section | Score |
|---|---|---:|
| 3.1 | Caisse | 1 |
| 3.2 | Stocks & matières premières | 1 |
| 3.3 | Production (a-g) | 1 |
| 3.4 | Commandes clients | 1 |
| 3.5 | Clients & fidélité | 1 |
| 3.6 | Fournisseurs & achats | 1 |
| 3.7 | Équipe & droits d'accès | 1 |
| 3.8 | Tableau de bord & rapports | 0,5 |
| 3.9 | Paramètres | 1 |
| 3.10 | Notifications temps réel | 1 |
| 3.11 | Commissions | 1 |
| 3.12 | À propos | 1 |
| 3.13 | Rapports (personnels) | 1 |
| 3.14 | Activation | 1 |
| 3.15 | État système | 1 |
| 3.16 | Approbations | 1 |
| 3.17 | Journal d'audit | 1 |
| 3.18 | Travailleurs | 1 |
| 3.19 | Assistant | 1 |
| | **Total** | **18,5 / 19** |

## Résultat

# **≈ 97 %** des fonctionnalités engagées par la spec pour cette v1 sont complètes.

La seule section notée en dessous de 1 est **3.8 (Tableau de bord & rapports)**, à 0,5 : le widget « Marge
par produit » et son fallback promis par la spec elle-même (« volume + CA par produit », « marge globale
journalière ») ne sont pas construits — détail et preuve dans `ETAT_PAR_MODULE.md` §3.8 et
`ECARTS_SPEC_CODE.md`.

Trois points isolés, comptés dans des sections par ailleurs à 1 (parce que la spec les écarte elle-même
explicitement, donc pleinement conformes à l'engagement réel), ne réduisent pas le score :
- le programme de fidélité (3.5) — *« conçu mais NON activé (décision métier) »* ;
- le concept de « Prospect » (3.5) — *« explicitement écarté faute de besoin réel identifié »* ;
- la couche IA de l'Assistant (3.19) — *« désactivée temporairement, bloquée par la facturation Google
  Cloud »*, cohérente entre spec, code et configuration de déploiement.

## Hors périmètre spec — backlog non compté (ni en positif, ni en négatif)

Ces idées ne font pas partie de l'engagement v1 et n'affectent donc pas le pourcentage ci-dessus, qu'elles
soient un jour construites ou non :

**Explicitement hors périmètre (`docs/spec-boulangerie.md` §4)** :
- Gestion multi-boutiques (plusieurs points de vente) ;
- Application mobile native ;
- Paiement en ligne / e-commerce ;
- Gestion de la paie des employés (RH complète) — **point de vigilance** : la spec 3.18 décrit et le code
  livre un calcul de paie et des bulletins bien réels (salaire de base, retenues, arrondi final, PDF figé).
  Il n'est pas tranché par cet audit si « RH complète » en §4 vise un système plus large (déclarations
  sociales, contrats, congés payés formalisés...) que ce qui est déjà construit en 3.18, ou si les deux
  passages de la spec se contredisent partiellement. **Non confirmé dans le code actuel** lequel des deux
  lire comme périmètre réel — à clarifier avec l'équipe plutôt qu'à trancher ici.
- Mode hors-ligne complet de la caisse.

**Limites connues, déjà documentées comme non prioritaires (Volume 25 du livre technique, toujours valides)** :
- Aucune réinitialisation de mot de passe (self-service ou par un Admin) ;
- Aucune pagination réelle sur les listes longues (plafonds fixes actuels jugés suffisants) ;
- Traductions lingala/swahili non relues par un locuteur natif.

**Constat de cette session, à ajouter à ce backlog** (non compté, car non engagé par la spec comme faisable
immédiatement au même titre que le reste de 3.8) :
- Le fallback « volume + CA par produit » et la marge globale journalière (voir plus haut) — techniquement
  dans le périmètre de 3.8, mais listés ici aussi pour rappeler qu'ils restent à faire, sans être une
  fonctionnalité manquante « oubliée » au hasard : la spec elle-même les présente comme une étape
  intermédiaire en attendant un futur calcul CUMP.

## À ne pas confondre avec ce pourcentage

`docs/livre-complet/MATRICE_DE_COUVERTURE.md` affiche 165/166 fichiers « Vérifié » (99 %) — c'est une mesure
différente : la proportion de fichiers de code que le **livre technique** a lui-même expliqués et vérifiés,
pas la proportion de fonctionnalités **construites**. Les deux chiffres sont proches (97 % vs 99 %) mais ne
mesurent pas la même chose et ne doivent pas être cités l'un pour l'autre.
