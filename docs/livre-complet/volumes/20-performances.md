# Volume 20 — Performances

> Chapitre de synthèse transversale (comme les Volumes 6, 14, 15, 16, 19) : aucun nouveau fichier de code n'est présenté ligne à ligne, ce chapitre rassemble et met en perspective des choix de conception liés à la performance déjà rencontrés séparément dans une dizaine de chapitres précédents, et complète l'image avec quelques vérifications ciblées effectuées pour ce chapitre.

## 1. Ce que dit — et ne dit pas — la spec

La spec (`docs/spec-boulangerie.md`) ne contient **aucune section dédiée aux performances**, aucun objectif chiffré (temps de réponse, nombre d'utilisateurs simultanés), et aucune exigence de scalabilité. C'est cohérent avec le contexte posé dès la section 1 : « une petite équipe de 2 à 5 personnes ». Ce chapitre n'évalue donc aucun choix du code contre une exigence chiffrée qui n'existe pas — il documente les choix de conception effectivement faits, et laisse ouverte la question de leur adéquation à une éventuelle croissance future (traitée plus largement au Volume 25, Possibilités d'évolution).

## 2. Frontend : ne charger que ce qui est affiché

### 2.1 Découpage par page (`React.lazy`)

Déjà détaillé au Volume 10 : 20 des 22 pages de `apps/web/src/pages` sont chargées paresseusement (`React.lazy`/`import()` dynamique) — seules `Login.tsx` et `PremierLancement.tsx` restent dans le paquet JavaScript initial, parce qu'elles sont nécessaires avant même qu'un utilisateur soit authentifié. Concrètement, le code d'un écran comme `Travailleurs.tsx` (1054 lignes, le plus long du frontend) n'est jamais téléchargé par un compte qui n'a pas la permission d'y accéder, ni même par un compte autorisé tant qu'il n'a pas cliqué sur ce module.

### 2.2 Découpage par dépendance (`manualChunks`)

Déjà détaillé au Volume 18d, avec un choix négatif aussi important que le choix positif : `vite.config.ts` isole React/React Router, TanStack Query et i18next dans des chunks « vendor » mis en cache long terme, mais **exclut délibérément** `recharts` et `framer-motion` de cette liste. Ces deux bibliothèques, plutôt lourdes, sont laissées au découpage automatique de Rollup pour rester attachées à leurs seuls consommateurs en chargement paresseux (`recharts` → `Dashboard.tsx`, Volume 18c ; `framer-motion` → `NotificationBell.tsx`, Volume 11z-4) — les y inclure en chunk manuel les aurait fait précharger dès le démarrage de l'application, pour tout le monde, même les comptes qui ne visitent jamais le Tableau de bord.

### 2.3 Le cache client de TanStack Query

Déjà détaillé au Volume 10 : chaque écran interroge le serveur via `useQuery` avec des clés de requête structurées (`["ressource", filtres]`) ; TanStack Query met le résultat en cache côté client et ne redemande **pas** systématiquement les mêmes données à chaque navigation — seule une invalidation explicite après une mutation (volontairement large, toutes les clés affectées plutôt que la seule vue courante, également Volume 10) déclenche un nouveau chargement. L'option `enabled` (rencontrée à des dizaines de reprises dans ce livre, la plus visible étant les 8 requêtes conditionnelles du Tableau de bord, Volume 18c) évite en plus qu'une requête parte pour un module que l'utilisateur n'a même pas la permission de lire — une économie de requête réseau qui s'ajoute au filtrage d'affichage, pas seulement une question de sécurité.

## 3. Base de données : index et état incrémental

### 3.1 Indexation explicite du schéma

Déjà couvert au Volume 13, revérifié pour ce chapitre : `prisma/schema.prisma` compte **29 directives `@@index` explicites** et 71 contraintes `@id`/`@unique` (qui créent chacune un index implicite en PostgreSQL). Les index explicites suivent un motif récurrent visible dans presque tous les modèles transactionnels du projet : une paire `(clé étrangère, date)` — par exemple `@@index([matierePremiereId, date])` sur `MouvementStock`, `@@index([clientId])` et `@@index([dateCreation])` sur `Commande`, `@@index([destinataireId, lu])` et `@@index([destinataireId, dateCreation])` sur `Notification`. Ce motif correspond directement à la façon dont ces tables sont interrogées dans les routes déjà lues tout au long de ce livre : « toutes les notifications d'un destinataire, triées par date » (Volume 11z-4), « tous les mouvements d'une matière première sur une période » (Volume 11z-1), « toutes les commandes d'un client » (Volume 11h) — chaque filtre fréquent dans le code a son index correspondant dans le schéma, plutôt qu'un jeu d'index générique déconnecté de l'usage réel.

L'**index unique partiel** garantissant qu'un seul compte a `estAdminPrincipal = true` à la fois (Volume 13) mérite d'être re-signalé ici sous l'angle performance autant que sous l'angle intégrité : la contrainte est appliquée par PostgreSQL lui-même à l'écriture, sans qu'aucune requête `SELECT COUNT(*)` supplémentaire ne soit nécessaire côté application pour la vérifier avant chaque écriture.

### 3.2 État courant stocké et maintenu de façon incrémentale, jamais recalculé par agrégation

Ce chapitre corrige une formulation trop générale du Glossaire (entrée « Journal append-only »), repérée en vérifiant `services/stocks.ts` pour ce chapitre précis : le journal des mouvements de stock (`MouvementStock`) est bien append-only (jamais modifié ni supprimé), mais la quantité en stock courante (`MatierePremiere.quantiteStock`) **n'est pas recalculée en sommant ce journal à chaque lecture** — elle est stockée comme un champ à part entière sur `MatierePremiere`, mis à jour par `increment`/`decrement` (`appliquerMouvement`, Volume 11z-1) dans la **même transaction** que l'écriture de la ligne de journal :

```ts
await tx.mouvementStock.create({ data: { /* ... */ } });
const maj = await tx.matierePremiere.update({
  where: { id: matiere.id },
  data: { quantiteStock: params.type === "ENTREE" ? { increment: params.quantite } : { decrement: params.quantite } },
});
```

La conséquence pratique : lire le stock actuel d'une matière première (affiché sur chaque écran qui en a besoin — Stocks, Production, Tableau de bord) est une lecture directe d'un seul champ, en complexité constante, indépendante du nombre de mouvements déjà enregistrés dans l'historique — qu'il y ait 10 ou 10 000 lignes dans `MouvementStock`, la lecture du stock courant coûte la même chose. Seule la consultation explicite de l'**historique** des mouvements (Volume 11z-1) interroge réellement la table `MouvementStock`, avec la pagination par capage décrite au §3.3.

Le Journal d'audit (`AuditLog`, Volume 11g) suit un principe voisin mais distinct : chaque entrée stocke elle-même un instantané avant/après de la modification qu'elle décrit (le « diff » affiché par `AuditPage`, Volume 11g), plutôt que de recalculer ce diff en comparant deux lectures séparées de l'entité concernée — l'entrée du journal est autosuffisante à l'affichage, sans jointure ni agrégation supplémentaire nécessaire pour la reconstituer.

### 3.3 Un plafond fixe plutôt qu'une pagination réelle

Vérification effectuée pour ce chapitre (recherche exhaustive de `take:`/`skip:` dans `apps/api/src/routes`) : le projet utilise systématiquement `take: N` (une borne fixe — 60, 100 ou 200 selon la route) sur ses listes potentiellement longues (bons de commande fournisseurs, demandes d'approbation, historique de l'État système, journal d'audit, activités du fil temps réel, sources agrégées des rapports personnels), mais **`skip` n'apparaît jamais** dans tout le code des routes — il n'existe donc aucune vraie pagination (page suivante, défilement infini) nulle part dans l'application : chaque écran affiche au maximum les N entrées les plus récentes, sans moyen d'accéder aux plus anciennes au-delà de ce plafond. Ce n'est pas un écart spec/code (la spec ne prescrit aucune exigence de pagination), mais une limite de conception réelle à garder à l'esprit si le volume de données d'une boulangerie utilisant cette application venait à dépasser significativement ces plafonds après plusieurs années d'usage continu — question directement liée aux « Possibilités d'évolution » traitées au Volume 25.

## 4. Ce qui n'a pas pu être mesuré dans cet environnement

Cohérent avec la limite déjà signalée à plusieurs reprises dans ce livre depuis le Volume 4 : aucun serveur PostgreSQL ni démon Docker n'étaient accessibles dans l'environnement de rédaction. Aucune mesure réelle de temps de réponse, de plan d'exécution SQL (`EXPLAIN ANALYZE`), ni de charge (nombre de requêtes simultanées supportées) n'a donc pu être effectuée pour ce chapitre — les observations ci-dessus portent exclusivement sur les choix de conception visibles dans le code source (présence d'index, motif d'écriture incrémentale, absence de pagination), pas sur leur effet mesuré en conditions réelles. **Non vérifiable dans cet environnement.**

## 5. Résumé du chapitre

| Domaine | Choix observé | Effet |
|---|---|---|
| Chargement frontend | `React.lazy` sur 20/22 pages | Le code d'un module non consulté n'est jamais téléchargé |
| Découpage de bundle | `manualChunks` sélectif (Volume 18d) | Les dépendances lourdes (`recharts`, `framer-motion`) restent liées à leur consommateur paresseux |
| Cache client | TanStack Query, invalidation large, `enabled` conditionnel | Évite les requêtes redondantes et les requêtes vers un module sans permission |
| Indexation base de données | 29 `@@index` explicites, motif `(clé étrangère, date)` | Aligné sur les filtres réellement utilisés dans les routes |
| État courant du stock | Stocké et mis à jour de façon incrémentale (`increment`/`decrement`), jamais recalculé par agrégation du journal | Lecture en complexité constante, indépendante de la taille de l'historique |
| Listes longues | Plafond fixe (`take: N`), jamais de vraie pagination (`skip`) | Simplicité de mise en œuvre, au prix d'un accès borné à l'historique le plus ancien |

Aucun écart spec/code sur ce chapitre — la spec ne fixant aucune exigence de performance, aucune comparaison de ce type n'est possible par construction. L'image d'ensemble est celle d'un projet dont les choix de performance, bien que jamais formalisés dans un document séparé, sont cohérents et proportionnés à l'échelle annoncée (une petite équipe, un volume de données modeste) plutôt qu'accumulés sans discernement.
