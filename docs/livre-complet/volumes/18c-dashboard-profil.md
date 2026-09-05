# Volume 18c — Pages restantes : `Dashboard.tsx`, `Profil.tsx`

> Troisième sous-chapitre du Volume 18. Deux pages Niveau 2 qui, contrairement à la plupart des écrans déjà couverts, n'appartiennent à aucun module fonctionnel unique — l'une agrège tous les modules à la fois, l'autre est individuelle et ne dépend d'aucune permission de module. C'est précisément pour cette raison qu'elles avaient été volontairement reportées (`Dashboard.tsx`, dès le Volume 11z-5) ou laissées de côté (`Profil.tsx`) jusqu'à ce sous-chapitre dédié.

## 1. `apps/web/src/pages/Dashboard.tsx` (593 lignes) — le tableau de bord

### 1.1 Intuition

Le Tableau de bord est l'écran d'accueil (`/`, route racine de `App.tsx`) : plutôt que de raconter une histoire fonctionnelle nouvelle, il **recompose** des données déjà expliquées ailleurs — les 7 widgets de `routes/rapports.ts` (Volume 11z-5) — sous une forme visuelle dense (cartes KPI, graphiques Recharts, fil d'activité temps réel). Ce chapitre ne réexplique donc pas ce que chaque rapport signifie (déjà fait au Volume 11z-5), mais comment cette page les assemble, les filtre par permission, et les rend consommables par un humain d'un coup d'œil.

### 1.2 Huit requêtes indépendantes, chacune conditionnée à sa propre permission

```ts
const litCaisse = peutLire("CAISSE");
// ... 6 autres litX
const litRapports = peutLire("RAPPORTS");

const { data: caisse } = useQuery({
  queryKey: ["rapports", "caisse"],
  queryFn: () => api<RapportCaisseDTO>("/api/rapports/caisse"),
  enabled: litCaisse,
});
// ... répété pour commandes, commissions, stock, production, fournisseurs, travailleurs, cloture
```

Motif déjà nommé au Volume 10 (option `enabled` de TanStack Query) : chaque widget n'effectue sa requête que si l'utilisateur connecté a au moins la lecture sur le module correspondant — cohérent avec la spec 3.8 : « chaque widget... n'apparaît que si le rôle connecté a au moins la lecture sur le module correspondant ». Chaque section JSX du composant reprend ensuite la même garde (`{litCaisse && caisse && (...)}`) : la page affiche donc, sans ligne de code dédiée à un rôle en particulier, une composition différente selon qui la consulte — un Caissier ne verra jamais le widget Travailleurs, un Responsable de production ne verra que Production. **8ᵉ requête** (`cloture`, `/api/rapports/cloture-quotidienne`) : c'est le « Résumé de clôture quotidien » entrevu au Volume 11z-5, gardé par `litRapports` (module `RAPPORTS`, accessible au DG et aux deux niveaux d'Admin depuis la refonte de la section 2).

### 1.3 `Compteur` : une micro-animation, pas un nouveau calcul

```ts
function Compteur({ valeur, format }: { valeur: number; format: (n: number) => string }) {
  const [affiche, setAffiche] = useState(0);
  const precedent = useRef(0);
  useEffect(() => {
    const depart = precedent.current;
    precedent.current = valeur;
    if (depart === valeur) return setAffiche(valeur);
    const duree = 600;
    const debut = performance.now();
    const pas = (maintenant: number) => {
      const progression = Math.min(1, (maintenant - debut) / duree);
      const facteur = 1 - Math.pow(1 - progression, 3); // ease-out cubic
      setAffiche(Math.round(depart + (valeur - depart) * facteur));
      if (progression < 1) requestAnimationFrame(pas);
    };
    requestAnimationFrame(pas);
  }, [valeur]);
  return <>{format(affiche)}</>;
}
```

Chaque carte KPI (`CarteKPI`) affiche sa valeur via ce compteur, qui interpole visuellement de l'ancienne valeur vers la nouvelle en 600 ms (courbe « ease-out cubic », un ralentissement progressif en fin d'animation) plutôt que de basculer brutalement — purement cosmétique, `precedent` (une `ref`, pas un état) mémorise la valeur de départ de l'animation en cours sans provoquer de re-rendu supplémentaire. Aucun calcul métier n'a lieu ici : la valeur finale vient toujours telle quelle du DTO retourné par le serveur.

### 1.4 L'alerte visuelle de solde négatif, retrouvée une troisième fois

```ts
const enAlerte = !!alerteSiNegatif && valeur < 0;
// ...
enAlerte && "border-2 border-rouge-alerte bg-rouge-alerte/10",
// ...
enAlerte && "font-extrabold text-rouge-alerte dark:text-rouge-alerte",
```

`CarteKPI` reçoit une prop `alerteSiNegatif`, appliquée aux KPI de solde de caisse (`soldeJour`, `solde30Jours`) — c'est la même règle déjà vue en détail deux fois : d'abord dans la spec elle-même (3.1, « solde négatif... affiché en gras et en rouge vif... partout où il apparaît — registre de Caisse **et tableau de bord** »), puis dans le code de `CaissePage` (Volume 11j, tuile `Poste`). `Dashboard.tsx` est donc le troisième et dernier endroit du projet où cette règle apparaît, et sa présence ici confirme littéralement la clause « partout où il apparaît » de la spec — la couleur `rouge-alerte`, déjà signalée au Volume 11j comme volontairement hors palette de marque, est réutilisée à l'identique. **Aucun écart spec/code.**

### 1.5 La courbe de chiffre d'affaires : compléter les jours sans vente

```ts
const serieCA = useMemo(() => {
  if (!caisse) return [];
  const parDate = new Map(caisse.serie30Jours.map((p) => [p.date, p.total]));
  const points: { date: string; total: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const cle = d.toISOString().slice(0, 10);
    points.push({ date: cle, total: parDate.get(cle) ?? 0 });
  }
  return points;
}, [caisse]);
```

Le serveur (`RapportCaisseDTO.serie30Jours`, Volume 11z-5) ne renvoie que les jours où une entrée a réellement eu lieu — un jour sans aucune vente n'a simplement pas de ligne. Le frontend reconstruit ici les 30 derniers jours calendaires un par un et complète à zéro (`?? 0`) les dates absentes de la `Map`, pour que le graphique Recharts (`AreaChart`) affiche une courbe continue plutôt que des points reliés par des sauts trompeurs sur les jours sans activité.

### 1.6 `construireSections` : le pont entre trois formats d'export différents

```ts
function construireSections(): SectionCSV[] {
  const c = (k: string) => t(`dashboard.csv.${k}`);
  const sections: SectionCSV[] = [];
  if (caisse) { sections.push({ titre: c("caTitle"), entetes: [...], lignes: [...] }); /* + 2 autres sections caisse */ }
  if (commandes) { sections.push({ ... }); }
  // ... un bloc par widget déjà chargé
  return sections;
}
```

C'est la fonction la plus importante de ce fichier au sens de la réutilisation transversale : elle construit un tableau de `SectionCSV` (le type défini au Volume 18b, `lib/csv.ts`) à partir des données **déjà chargées en mémoire** par les 7 `useQuery` du widget — aucun nouvel appel réseau. Cette même fonction sert ensuite à **trois** destinations différentes :

1. **`exporterCSV()`** l'appelle directement, puis passe le résultat à `telechargerCSV` (Volume 18b) — export local immédiat.
2. **`BarreExport`** (Volume 11z-5) la reçoit en prop `construireSections`, et l'utilise pour l'export PDF/e-mail générique (`construirePdf`, également Volume 11z-5) — la même donnée nourrit un document PDF sans être reconstruite.
3. Chaque section n'apparaît que si son widget correspondant a effectivement été chargé (`if (caisse)`, `if (commandes)`...) — cohérent avec `modulesDocument`, qui ne liste que les modules effectivement lus par l'utilisateur courant :

```ts
const modulesDocument = ([
  litCaisse && "CAISSE", litCommandes && "COMMANDES", /* ... */
].filter(Boolean) as Module[]);
```

Cette liste est transmise à `BarreExport`, qui — comme détaillé au Volume 11z-5 — revérifie côté serveur que chaque module est bien autorisé avant de produire le document final : la page ne fait ici que proposer une liste candidate, jamais une autorisation en soi.

### 1.7 Un commentaire de code qui documente une régression déjà corrigée

```
{/* Widgets secondaires — chacun conditionné à la lecture du module.
    [&>*]:min-w-0 : comme les enfants flex, un élément de grille refuse
    par défaut de rétrécir sous la largeur minimale de son contenu — sans
    ça, la carte la plus « large »... élargit toute la colonne de grille
    implicite... (déjà observé : les 6 cartes rapportaient ~400px sur un
    écran de 375px). */}
<div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
```

Ce commentaire, contrairement aux commentaires obsolètes déjà signalés aux Volumes 11j/13/11z-5 (Vente/LigneVente/ClotureCaisse, `/cloture-quotidienne`), documente au contraire un **correctif réel et actuel** : `min-w-0` sur les enfants d'une grille CSS annule le comportement par défaut qui empêche une cellule de grille de rétrécir sous la largeur intrinsèque de son contenu — un piège CSS classique, déjà résolu ici, dont la trace explique pourquoi la classe est présente plutôt que de laisser un futur lecteur la supprimer par erreur en la croyant superflue.

### 1.8 Confrontation avec la spec

Le tableau de bord correspond très directement à la spec 3.8 : composition par rôle déjà vérifiée au §1.2 ci-dessus, résumé de clôture quotidien étendu au DG et aux deux niveaux d'Admin (déjà noté au Volume 11z-5), export CSV/PDF/e-mail. **Aucun écart spec/code.**

## 2. `apps/web/src/pages/Profil.tsx` (265 lignes) — le profil individuel

### 2.1 Intuition

`Profil.tsx` est le seul écran de gestion de compte **auto-administré** — contrairement à `Equipe.tsx` (Volume 11d), où un Admin gère les comptes des autres, ici chaque utilisateur gère les quelques réglages qui lui appartiennent en propre : son mot de passe, sa langue d'affichage, et — pour qui a une fiche Travailleur liée — la consultation de ses propres bulletins de paie. C'est pourquoi la route `/profil` (`App.tsx`) n'est protégée par **aucun** garde de permission de module (contrairement à `/equipe`, `/parametres`...) : n'importe quel compte authentifié y accède, comme `/rapports` et `/a-propos`, déjà signalées ainsi aux volumes précédents.

### 2.2 Mes bulletins de paie : réutilisation intégrale du Volume 11k-3

```ts
const { data: bulletinsData } = useQuery({
  queryKey: ["mesBulletinsPaie"],
  queryFn: () => api<{ bulletins: BulletinPaieDTO[] }>("/api/travailleurs/mes-bulletins-paie"),
});
```

`GET /api/travailleurs/mes-bulletins-paie` est la route déjà détaillée au Volume 11k-3 (`peutConsulterBulletinsDe`) : elle ne vérifie aucune permission de module au-delà de l'authentification, sa sécurité tenant entièrement au fait qu'elle ne recherche que la fiche liée à `req.utilisateur!.id`. `Profil.tsx` en est le **seul appelant** de tout le frontend — la section entière ne s'affiche que si `mesBulletins.length > 0` (aucune fiche liée, ou fiche liée sans bulletin émis, se traduisent tous deux par un tableau vide, jamais par une erreur). Le téléchargement du PDF reprend le même motif que `telechargerCSV`/`telechargerBonLivraison` déjà vus : `fetch` manuel avec l'en-tête `Authorization` (plutôt que l'utilitaire `api()`, car la réponse est un flux binaire et non du JSON), lecture du nom de fichier suggéré dans l'en-tête `Content-Disposition`, `Blob`/`URL.createObjectURL`/clic programmatique.

### 2.3 Le sélecteur de langue : `""` comme valeur spéciale « suivre la boutique »

```tsx
<NativeSelect
  value={utilisateur?.languePreferee ?? ""}
  onChange={(e) => changerLangueMut.mutate(e.target.value)}
>
  <option value="">{t("profil.languageDefault", { langue: LANGUE_LABELS[langueDefautBoutique] })}</option>
  {LANGUES.map((l) => (<option key={l} value={l}>{LANGUE_LABELS[l]}</option>))}
</NativeSelect>
```

C'est ici, concrètement, que se manifeste la distinction déjà posée en abstrait au Volume 17 entre `langueDefaut` (réglage de la boutique, `ParametreBoutique`, Volume 18a) et `Utilisateur.languePreferee` (individuel, nullable). La chaîne vide `""` est traitée comme une valeur sentinelle : sélectionner la première option (« suit la langue de la boutique ») appelle `changerLangue(null)`, remettant `languePreferee` à `null` en base plutôt que de choisir explicitement la langue actuellement affichée — tant qu'aucun choix individuel n'est fait, l'utilisateur suit automatiquement tout changement futur de la langue par défaut de la boutique (`routes/parametres.ts`, Volume 11z-4). `changerLangue` elle-même (définie dans `lib/auth.tsx`, Volume 11b) appelle la route déjà documentée au Volume 11c (`PUT /api/auth/langue`).

### 2.4 Changement de mot de passe : validation client redondante avec le serveur

```ts
function soumettre(e: React.FormEvent) {
  e.preventDefault();
  setSucces(false);
  if (nouveauMotDePasse !== confirmation) {
    setErreur(t("profil.passwordMismatch"));
    return;
  }
  setErreur(null);
  changerMotDePasse.mutate();
}
```

La comparaison `nouveauMotDePasse !== confirmation` est une vérification **purement côté client**, absente du schéma Zod serveur (`POST /api/auth/mot-de-passe`, Volume 11c) — le champ « Confirmer le mot de passe » n'existe que dans cette page, jamais transmis au serveur. C'est un confort d'interface (éviter un aller-retour réseau pour une faute de frappe évidente) et non une règle de sécurité : la vraie validation (longueur minimale via `minLength={8}` côté HTML, correction du mot de passe actuel) reste entièrement assurée par la route serveur déjà détaillée au Volume 11c, cohérent avec le principe transversal déjà énoncé au Volume 14 (la sécurité réelle n'est jamais déléguée au client).

### 2.5 Confrontation avec la spec

La spec ne consacre pas de section dédiée à un écran « Profil » nommé comme tel, mais chacun des trois blocs qui composent la page est rattaché à une section déjà croisée ailleurs : changement de mot de passe (spec, section 2/3.7, authentification), sélecteur de langue individuelle (section 3.9, « langue par défaut » — l'override individuel est une extension cohérente et non contredite), consultation des bulletins personnels (section 3.18, « les siens uniquement »). **Aucun écart spec/code.**

## 3. Résumé du sous-chapitre

| Fichier | Rôle en une phrase | Écart spec/code |
|---|---|---|
| `pages/Dashboard.tsx` | Écran d'accueil qui recompose les 7 widgets de `routes/rapports.ts` (déjà expliqués au Volume 11z-5) par permission, avec micro-animations et export CSV/PDF/e-mail partagé | Aucun |
| `pages/Profil.tsx` | Seul écran de gestion de compte auto-administré (mot de passe, langue individuelle, bulletins de paie personnels), sans garde de permission de module | Aucun |

Ces deux pages confirment, une dernière fois avant la clôture du Volume 18, le motif déjà observé à plusieurs reprises dans ce livre : la plupart des « nouveautés » apparentes d'un chapitre tardif sont en réalité des recompositions de mécanismes déjà expliqués en détail ailleurs (widgets de rapports, export CSV/PDF, langue individuelle, bulletins de paie) — ce qui confirme, chapitre après chapitre, la cohérence interne du projet plutôt qu'une accumulation de code isolé.

**Prochain et dernier sous-chapitre** : Volume 18d — configuration et outillage (les 9 fichiers de la section M de la matrice), qui clôturera le Volume 18 et portera la couverture du livre à 155/155.
