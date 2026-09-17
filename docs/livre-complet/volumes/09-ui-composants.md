# Volume 9 — Interface utilisateur et composants

**Niveau de risque : mixte.** `apps/web/src/components/Layout.tsx` est Niveau 2 (traitement complet — navigation filtrée par permission, donc pas purement cosmétique). Les primitives de `components/ui/` et les composants de présentation pure (`EcranDemarrage.tsx`, `ChargementModule.tsx`, déjà couverts au Volume 8) sont Niveau 3.

## Fiche d'identité

| Fichier / dossier | Niveau | Rôle |
|---|:---:|---|
| `apps/web/src/components/Layout.tsx` | 2 | Ossature de page : barre latérale desktop, tiroir mobile, navigation filtrée par permission |
| `apps/web/src/components/ui/*.tsx` (11 fichiers) | 3 | Primitives d'interface génériques, sans logique métier |
| `apps/web/components.json` | 3 | Configuration shadcn/ui |

## 5.1 Le système de design — Tailwind, Radix, shadcn/ui

Rappel du Volume 3 : le projet n'installe pas de bibliothèque de composants complète (pas de Material UI, pas d'Ant Design). Il combine trois couches :

- **Tailwind CSS** fournit les classes utilitaires (`flex`, `rounded-lg`, `text-marine`...) qui composent le style directement dans le JSX, sans fichiers CSS séparés par composant.
- **Radix UI** fournit le comportement accessible et sans état visuel imposé des composants interactifs complexes (dialogues, menus) — `@radix-ui/react-dialog`, `@radix-ui/react-label`, `@radix-ui/react-slot` (Volume 3).
- **shadcn/ui**, via `components.json`, n'est pas une dépendance installée mais un **générateur** : il copie des composants Radix déjà stylés avec les classes Tailwind du projet directement dans `components/ui/` — expliquant pourquoi ces 11 fichiers appartiennent au code source versionné plutôt qu'à `node_modules`, et peuvent donc être librement modifiés pour coller à l'identité visuelle Lomoto (couleurs `marine`/`or`/`creme`/`terracotta`, déjà rencontrées dans de nombreux chapitres applicatifs).

## 5.2 `components/ui/` — les onze primitives

| Fichier | Rôle |
|---|---|
| `button.tsx` | Bouton avec variantes (`cta`, `outline`, `ghost`...) déjà rencontrées dans presque tous les chapitres applicatifs |
| `card.tsx` | Conteneur à en-tête/contenu/description, brique de base de la plupart des écrans |
| `dialog.tsx` | Boîte modale (Radix), utilisée pour tous les formulaires de création/édition de ce livre |
| `sheet.tsx` | Tiroir latéral coulissant — utilisé pour le menu mobile (§5.3) |
| `table.tsx` | Tableau HTML sémantique, visible à partir du point de rupture `md:` |
| `carte-ligne.tsx` | L'équivalent mobile d'une ligne de tableau (§5.4) |
| `select.tsx` (`NativeSelect`) | Sélecteur — un `<select>` HTML natif stylé, pas un composant Radix, plus simple et suffisant pour ce projet |
| `input.tsx`, `textarea.tsx`, `label.tsx` | Champs de formulaire de base |
| `badge.tsx` | Étiquette colorée (statuts, rôles) — la brique de tous les motifs `BadgeStatut` déjà rencontrés (approbations, absences, journal d'audit) |

Ces onze fichiers ne contiennent, par construction, **aucune règle métier** — un `Badge` ne sait pas ce qu'est une commande, il reçoit une couleur et un texte. C'est systématiquement le composant appelant (une page ou un composant de domaine) qui décide, via une table de correspondance statut → variante, quelle couleur afficher — le motif déjà documenté à plusieurs reprises dans ce livre (Volume 11k-2, §5.4).

## 5.3 `CarteLigne` — le motif mobile/desktop, uniforme dans tout le projet

```tsx
const CarteLigne = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("rounded-lg border bg-card p-3 text-sm", className)} {...props} />,
);
const CarteLigneChamp = ({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) => (
  <div className={cn("flex items-center justify-between gap-3 py-1", className)}>
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-right">{value}</span>
  </div>
);
```

Le commentaire du fichier résume son rôle exact : *« remplace une ligne de tableau quand ses colonnes ne tiennent pas sur un petit écran »*. Quatre sous-composants composables : `CarteLigne` (le conteneur), `CarteLigneTitre` (équivalent de la première colonne, souvent avec un badge de statut à côté), `CarteLigneChamp` (une paire libellé/valeur — l'équivalent d'une cellule secondaire), `CarteLigneActions` (rangée de boutons, séparée par une ligne). Ce motif a été rencontré à l'identique dans la quasi-totalité des chapitres applicatifs de ce livre (Commissions, Caisse, Travailleurs...) : chaque écran de liste affiche systématiquement **les deux représentations en parallèle** — un `<Table>` masqué sous `md:` (`className="hidden md:table"`) et une pile de `CarteLigne` masquée à partir de `md:` (`className="space-y-2 md:hidden"`) — jamais une seule représentation qui se redimensionnerait, toujours deux arbres JSX distincts partageant les mêmes données déjà chargées.

## 5.4 `Layout.tsx` — la coquille de navigation

Déjà entrevu au Volume 8 pour son rôle dans le cycle de démarrage ; ce chapitre en détaille la logique de navigation elle-même.

### La règle d'affichage du menu — jamais un module caché, toujours grisé

```tsx
// Règle d'interface (spec section 2) : TOUS les modules apparaissent dans le
// menu pour tout le monde ; ceux hors du périmètre du rôle connecté (ou pas
// encore construits) restent visibles mais grisés/non cliquables.
interface EntreeNav {
  labelKey: string;
  icon: typeof LayoutDashboard;
  module?: Module; // absent = accessible à tous
  to?: string;      // absent = module pas encore construit
  ecriture?: boolean; // exige l'ÉCRITURE (pas la simple lecture)
}
```

Chaque entrée de navigation porte jusqu'à quatre informations : sa clé de traduction, son icône, le `Module` de permission qui la gouverne (absent pour les écrans ouverts à tous — Tableau de bord, Assistant, À propos), et si elle exige l'**écriture** plutôt que la simple lecture (Approbations et État système, réservés aux Admins, Volumes 11f/23). `calculerLiens` transforme cette liste statique en liens effectifs :

```tsx
const aPermission = !n.module || (n.ecriture ? peutEcrire(n.module) : peutLire(n.module));
const construit = !!n.to;
return { ...n, label: t(n.labelKey), actif: aPermission && construit, motif: !aPermission ? t("nav.outOfScope") : !construit ? t("nav.moduleComingSoon") : undefined };
```

Un lien n'est cliquable (`actif`) que si l'utilisateur a la permission requise **et** que le module est effectivement construit (`to` renseigné) — les deux conditions sont indépendantes et donnent un message différent (`motif`) selon laquelle échoue : *« hors de votre périmètre »* ou *« module à venir »*. `ListeNavigation` (§5.5) affiche ensuite soit un `NavLink` cliquable, soit un `<span aria-disabled>` grisé avec ce motif en infobulle — jamais une entrée simplement absente de la liste, conformément à la règle d'interface citée directement dans le commentaire du code.

### Un détail de code à signaler : logique dupliquée, jamais réellement appelée en fonction

```tsx
type LienNavigation = ReturnType<typeof calculerLiens>[number];
function calculerLiens(peutLire, peutEcrire, t) { /* ... */ }

export function Layout() {
  // ...
  const liens = navigation.map((n) => {
    const aPermission = !n.module || (n.ecriture ? peutEcrire(n.module) : peutLire(n.module));
    const construit = !!n.to;
    return { ...n, label: t(n.labelKey), actif: aPermission && construit, motif: /* ... */ };
  });
  // ...
}
```

Une vérification directe dans le reste du fichier (et du projet) confirme que la fonction `calculerLiens`, bien que définie et non triviale, **n'est jamais appelée** — elle ne sert qu'à dériver le type `LienNavigation` via `ReturnType<typeof calculerLiens>`. Le composant `Layout()` lui-même **réimplémente exactement la même logique en ligne**, quelques lignes plus loin, plutôt que d'invoquer `calculerLiens(peutLire, peutEcrire, t)`. Les deux copies produisent aujourd'hui un résultat identique — ce n'est donc pas un bug de comportement — mais c'est une duplication de logique métier (le calcul de `aPermission`/`actif`/`motif`) qui, si l'une des deux copies était modifiée sans l'autre lors d'une évolution future, divergerait silencieusement. **Recommandation** (distincte d'un constat) : appeler `calculerLiens(...)` depuis `Layout()` plutôt que de dupliquer son corps, ou supprimer la fonction si elle ne sert plus qu'à un type.

### `ListeNavigation` — un seul rendu, deux emplacements

```tsx
/**
 * Liste des liens de navigation — un seul rendu, réutilisé par la barre
 * latérale (desktop) ET le tiroir mobile, pour ne jamais les faire diverger.
 */
function ListeNavigation({ liens, t }) { /* ... */ }
```

Contrairement au motif `CarteLigne`/`Table` (§5.3), où deux arbres JSX distincts coexistent pour deux tailles d'écran, la navigation elle-même est **un seul composant**, appelé deux fois (barre latérale fixe pour desktop, contenu du tiroir `Sheet` pour mobile) — le commentaire du code explique pourquoi : éviter que les deux versions de la navigation ne divergent, un risque bien réel comme le montre `calculerLiens` juste au-dessus. Le tiroir mobile (`Sheet`, Radix) se ferme automatiquement à chaque changement de route (`useEffect(() => setMenuOuvert(false), [location.pathname])`) — sans quoi naviguer depuis le menu laisserait le tiroir ouvert par-dessus le nouvel écran.

### Alertes paresseuses déclenchées depuis la coquille

```tsx
useQuery({
  queryKey: ["alertes-dette"],
  queryFn: () => api<{ alertes: AlerteDetteDTO[] }>("/api/commandes/alertes-dette"),
  enabled: peutLire("COMMANDES"),
  staleTime: 5 * 60 * 1000,
});
useQuery({
  queryKey: ["alertes-absence"],
  queryFn: () => api<{ alertes: AlerteAbsenceDTO[] }>("/api/travailleurs/alertes-absence"),
  enabled: peutEcrire("TRAVAILLEURS"),
  staleTime: 5 * 60 * 1000,
});
```

`Layout` étant monté pour **toute** la durée d'une session authentifiée (c'est l'élément englobant de l'arbre de routes, Volume 10), c'est l'endroit naturel pour déclencher les deux vérifications paresseuses déjà expliquées en détail aux volumes 11h et 11k-2 (`verifierAlertesDette`, `verifierAlertesAbsenceEnAttente`) — une seule fois par chargement de session, indépendamment de l'écran affiché. `staleTime: 5 * 60 * 1000` (5 minutes) évite de redéclencher ces vérifications à chaque changement de route pendant cette fenêtre, tout en gardant les données assez fraîches pour rester utiles.

## 5.5 Cas limites

| Situation | Comportement |
|---|---|
| Un module de la liste `navigation` sans `module` défini | Toujours actif pour tout utilisateur authentifié (Tableau de bord, Assistant, À propos) — §5.4. |
| Un module avec `to` mais sans accès (permission insuffisante) | Grisé, infobulle « hors de votre périmètre » — jamais absent de la liste. |
| Naviguer depuis le tiroir mobile | Le tiroir se ferme automatiquement au changement de route. |
| `calculerLiens` modifiée sans mettre à jour la copie en ligne dans `Layout()` | Les deux versions divergeraient silencieusement — aucun mécanisme ne les garde synchronisées (§5.4). |

## 5.6 Croisement avec la spécification

La règle « tous les modules visibles, grisés si hors périmètre » correspond exactement à la section 2 de la spec, citée verbatim dans le commentaire du code. Aucun écart trouvé. La duplication de `calculerLiens` (§5.4) est une observation de qualité de code, pas un écart de comportement avec la spécification — non ajoutée à `annexes/ecarts-spec-code.md`.

## 5.7 Résumé

Le système de design repose sur trois couches minces (Tailwind pour le style, Radix pour le comportement accessible, shadcn/ui comme générateur plutôt que dépendance) qui laissent au projet un contrôle total sur ses onze primitives. Le motif `CarteLigne`/`Table` traite systématiquement mobile et desktop comme deux rendus distincts partageant les mêmes données ; la navigation, à l'inverse, est un seul composant partagé entre les deux tailles d'écran — une différence de stratégie assumée. `Layout.tsx` porte, en plus de la coquille visuelle, une vraie logique de sécurité d'affichage (filtrage par permission) et les deux déclenchements paresseux d'alertes déjà expliqués ailleurs — avec, au passage, une duplication de code repérée et signalée.

---

**Suite →** Volume 10 — Navigation et gestion de l'état, qui détaille l'arbre de routes complet (`AppAuthentifiee`) et les conventions TanStack Query déjà entrevues dans ce chapitre.
