# Volume 26 — Glossaire, index et annexes finaux

> Dernier volume du plan de rédaction. Il ne présente aucun nouveau fichier de code : il consolide les trois documents de référence tenus à jour en continu depuis le premier chapitre (`GLOSSAIRE.md`, `INDEX_DU_CODE.md`, `annexes/ecarts-spec-code.md`) et clôt le livre par un rapport final de couverture.
>
> **Mise à jour des 19-20/08/2026** : les chiffres ci-dessous (§4, §6) sont ceux de la clôture initiale du livre (2026-08-12) et restent affichés tels quels pour la trace historique. Depuis cette date, deux révisions ont ajouté 2 chapitres (Volume 11z-6, Cycle de livraison, le 19/08 ; Volume 11l, Infrastructure temps/idempotence, le 20/08) et 11 fichiers à la matrice, et un 3ᵉ écart spec/code a été trouvé puis résolu le jour même de sa découverte — les chiffres réellement à jour sont **166/166 fichiers** (165 Vérifié + 1 En cours), **59 chapitres sur 26 volumes**, **3 écarts spec/code dont 2 encore ouverts**. Détail complet dans `ETAT_DE_PROGRESSION.md`, sections « Session de mise à jour du 19/08/2026 » et « Session du 20/08/2026 ».

## 1. Le Glossaire

`GLOSSAIRE.md` définit, par ordre alphabétique, chaque terme technique ou métier employé dans ce livre — environ 70 entrées à ce stade, de « Action critique » à « Zone de dépôt ». Deux ajouts ont été faits à l'occasion de cette consolidation finale, sans qu'aucun nouveau fichier de code n'ait été lu pour les produire :

- **Écart entre spec et code** : le terme était employé dans une dizaine de chapitres sans jamais avoir sa propre entrée — corrigé.
- **Niveau de risque métier** : la classification en trois paliers (Critique/Fonctionnel standard/Support-infrastructure), au cœur de la méthodologie de tout le livre depuis le Volume 2, n'avait pas non plus d'entrée dédiée.
- **Constat / Interprétation / Recommandation** : la convention de discours utilisée systématiquement dans les chapitres de synthèse (Volumes 19 à 25), en particulier au Volume 25, formalisée ici pour la première fois.

Une incohérence de structure a également été corrigée : une section « M » dupliquée (deux titres `## M` séparés dans le fichier, l'un contenant `manualChunks`/`Maman`/`Migration`/`Monorepo`/`MVCC`, l'autre `Middleware`/`Middleware factory`) a été fusionnée en une seule section.

## 2. L'Index du code

`INDEX_DU_CODE.md` offre trois vues croisées, pensées pour une recherche plutôt qu'une lecture linéaire :

1. **Par fichier** — chaque fichier de code déjà couvert, avec le ou les chapitres qui l'expliquent.
2. **Par symbole** — chaque fonction, composant ou route nommé, avec son fichier et son chapitre.
3. **Par terme métier** — chaque section de `docs/spec-boulangerie.md`, avec le chapitre du livre qui la couvre.

Deux lignes ont été ajoutées à la troisième vue pour cette consolidation finale, couvrant les Volumes 24 et 25 — tous deux des synthèses transversales sans section de spec dédiée, à l'image du Volume 23.

## 3. Le registre des écarts spec/code

`annexes/ecarts-spec-code.md` reste, après 26 volumes, le point de collecte unique de toute divergence trouvée entre `docs/spec-boulangerie.md` et le code réel. **Deux écarts au total** ont été trouvés sur l'ensemble de ce livre, ni plus ni moins :

1. **Aucune interface pour « Modifier les permissions d'un rôle »** (Volume 11d) — la route serveur existe et fonctionne, mais aucun composant frontend ne l'atteint.
2. **Playwright recommandé par la spec, absent du dépôt** (Volume 19) — seul Vitest est installé et exécutable.

Aucun des deux n'a été tranché par ce livre : conformément à la règle fixée dès le départ, chacun porte la mention « Écart entre spec et code — à confirmer avec l'équipe » et reste ouvert.

## 4. Rapport final de couverture

### 4.1 Couverture fichier par fichier

| Niveau | Fichiers | Vérifié | % |
|---|---:|---:|---:|
| 1 — Critique | 26 | 26 | 100 % |
| 2 — Fonctionnel standard | 66 | 66 | 100 % |
| 3 — Support/infrastructure | 63 | 63 | 100 % |
| **Total** | **155** | **154 Vérifié + 1 En cours** | **100 % traversé** |

Le seul fichier resté à l'état « En cours » plutôt que « Vérifié » est `packages/shared/src/index.ts` : ses portions Niveau 1 (fonctions financières, permissions, délégations, actions critiques, audit, commandes, commissions, caisse, travailleurs/paie) et Niveau 2/3 (stocks, production, départements, notifications, à propos, assistant, rapports, export...) ont chacune été expliquées en détail au fil des chapitres thématiques qui leur correspondent — mais, par rigueur, aucun audit exhaustif symbole par symbole de ce fichier de 1942 lignes en un seul passage n'a jamais été formellement conduit pour clore la ligne elle-même. Ce livre choisit de le signaler explicitement plutôt que de déclarer une clôture qui n'a pas été strictement vérifiée.

### 4.2 Couverture par chapitre

**26 volumes, 57 chapitres rédigés** (`volumes/01-presentation.md` à `volumes/26-glossaire-index-annexes.md`, comptant chaque sous-chapitre — 11a-11k en 13 parties, 11z en 5 parties, 18 en 4 parties, 22 en 12 parties). Tous les volumes prévus par le plan initial sont clos.

### 4.3 Écarts spec/code

**2 écarts recensés**, tous deux encore ouverts (voir §3).

### 4.4 Pistes d'évolution

**17 pistes recensées au Volume 25** — 2 fonctionnalités serveur non exposées côté écran, 5 limites connues déjà documentées pour l'utilisateur, 5 observations de qualité de code, 4 pistes d'ergonomie, 1 piste d'infrastructure — aucune ne constitue une urgence, toutes soumises à l'arbitrage de l'équipe.

### 4.5 Vérifications pratiques effectuées

Ce livre a, chaque fois que l'environnement de rédaction le permettait sans risque, préféré une vérification réelle à une simple lecture : `npm test` exécuté (11/11 tests passants, Volume 19), parité des 4 dictionnaires de traduction vérifiée par script (1013/1013 clés, Volume 17), recherches exhaustives de code mort ou de fonctionnalités inatteignables (`calculerLiens`, `roleId`, changement de `tauxTaxe`, réinitialisation de mot de passe...). Une limite reste posée dès le Volume 4 et rappelée à chaque fois qu'elle s'est représentée : aucun serveur PostgreSQL ni démon Docker n'étaient accessibles dans l'environnement de rédaction, rendant impossible toute vérification nécessitant une base de données active (migrations, seed, démarrage complet, parcours utilisateur réels bout en bout). Ces limites ont été signalées explicitement à chaque chapitre concerné plutôt que passées sous silence.

## 5. Ce que ce livre couvre, et ce qu'il ne tranche pas

Ce livre documente le **comportement actuel** du code de Boulangerie Lomoto, confronté systématiquement à ce que `docs/spec-boulangerie.md` prescrit. Il ne modifie aucun fichier applicatif (mandat respecté sur l'ensemble des 26 volumes) et ne divulgue aucune valeur sensible — mot de passe, jeton, clé API, donnée personnelle — rencontrée au fil de la lecture des fichiers de configuration et de déploiement (Volumes 5 et 21 en particulier). Les deux écarts spec/code et les 17 pistes d'évolution restent, par construction, des constats et des suggestions : leur résolution appartient à l'équipe du projet, jamais à ce livre.

## 6. Résumé du chapitre — et du livre

| Question | Réponse |
|---|---|
| Combien de fichiers de code couverts ? | 155 / 155 (154 Vérifié, 1 En cours par rigueur documentée) |
| Combien de chapitres rédigés ? | 57, répartis sur 26 volumes |
| Combien d'écarts spec/code trouvés ? | 2, tous deux encore ouverts |
| Combien de pistes d'évolution recensées ? | 17, aucune urgente |
| Le code applicatif a-t-il été modifié ? | Non, à aucun moment |
| Une donnée sensible a-t-elle été divulguée ? | Non, à aucun moment |

**Ce chapitre clôt le plan de rédaction complet du Livre Boulangerie Lomoto.**
