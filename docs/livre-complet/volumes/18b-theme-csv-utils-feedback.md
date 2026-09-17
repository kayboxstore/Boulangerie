# Volume 18b — Fichiers `lib/` restants du frontend : `theme.tsx`, `csv.ts`, `utils.ts`, `FeedbackProvider.tsx`

> Deuxième sous-chapitre du Volume 18. Quatre petits fichiers Niveau 3 (infrastructure/support), tous transversaux — utilisés par la quasi-totalité des écrans déjà couverts sans que leur propre code n'ait été montré. Traitement concis, conforme à la règle Niveau 3 du mandat (« correct mais concis »).

## 1. `apps/web/src/lib/theme.tsx` (70 lignes) — thème clair/sombre

### 1.1 Intuition

Un contexte React classique pour le thème clair/sombre, avec une particularité : il doit s'appliquer **avant** le premier rendu, pour éviter un « flash » où l'utilisateur verrait d'abord le thème clair puis basculerait brutalement vers le sombre au montage.

### 1.2 Le mécanisme en deux temps

**Temps 1 — avant React, dans `main.tsx`** :

```ts
export function initTheme() {
  const stocke = lireThemeStocke();
  appliquerClasseDark(stocke ? stocke === "dark" : preferenceSystemeSombre());
}
```

`main.tsx` appelle `initTheme()` **avant** `createRoot(...).render(...)` (ligne 16 du fichier, avant la ligne 22 qui monte l'arbre React) — la classe CSS `.dark` sur `<html>` est donc déjà en place au moment où le premier pixel s'affiche, quelle que soit la vitesse de démarrage de React.

**Temps 2 — le contexte React**, `ThemeProvider`/`useTheme`, pour que n'importe quel composant (typiquement un bouton dans `Layout.tsx`, Volume 9) puisse lire l'état courant et le faire basculer via `basculer()`.

### 1.3 Ordre de résolution du thème

Trois sources, dans cet ordre de priorité, identiques dans `initTheme()` et dans l'état initial de `ThemeProvider` (dupliqué intentionnellement — la première doit s'exécuter en dehors de tout composant React) :

1. **Choix explicite déjà mémorisé** (`localStorage["lomoto_theme"]`, `"light"` ou `"dark"`) — dès que l'utilisateur a cliqué une fois sur le bouton de bascule, ce choix prime sur tout le reste, définitivement (jusqu'à effacement du `localStorage`).
2. **Préférence système** (`window.matchMedia("(prefers-color-scheme: dark)")`), tant qu'aucun choix explicite n'a été fait.
3. Un second `useEffect` **écoute en direct** les changements de préférence système (`mq.addEventListener("change", ...)`) — mais seulement tant que `lireThemeStocke()` renvoie `null`. Dès qu'un choix explicite existe, cet effet ne s'abonne même plus (`if (lireThemeStocke()) return;` en tout début d'effet) : l'app cesse alors de suivre le système, le choix humain gagnant définitivement.

C'est un réglage purement local à l'appareil (`localStorage`, jamais une colonne Prisma ni un réglage de `ParametreBoutique` comme au Volume 18a) — cohérent avec le fait qu'un thème clair/sombre est une préférence d'affichage individuelle et non une donnée de gestion de la boutique.

### 1.4 Confrontation avec la spec

La spec ne mentionne pas de thème sombre parmi les fonctionnalités listées. **Non confirmé dans la spec actuelle** que cette fonctionnalité y soit décrite explicitement — ce n'est pas un écart (rien dans la spec ne l'interdit ou ne le contredit), simplement une amélioration d'interface ajoutée au fil du développement et non répercutée dans le document de spécification. Cohérent avec la même observation déjà faite pour d'autres détails d'interface au Volume 9.

## 2. `apps/web/src/lib/csv.ts` (36 lignes) — export CSV générique

### 2.1 Intuition

Un petit générateur de fichier CSV « à sections » : chaque export peut contenir plusieurs blocs (un par widget exporté), chacun avec son propre titre, ses propres en-têtes de colonnes et ses propres lignes.

### 2.2 Le code, en deux fonctions

```ts
export function genererCSV(sections: SectionCSV[]): string {
  const blocs = sections.map((s) =>
    [echapper(s.titre), s.entetes.map(echapper).join(";"), ...s.lignes.map((l) => l.map(echapper).join(";"))].join("\n"),
  );
  return `﻿${blocs.join("\n\n")}`;
}

export function telechargerCSV(nomFichier: string, sections: SectionCSV[]) {
  const blob = new Blob([genererCSV(sections)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nomFichier; a.click();
  URL.revokeObjectURL(url);
}
```

Deux détails techniques précis, tous deux commentés dans le code source lui-même :

- **`echapper`** : entoure de guillemets, en doublant les guillemets internes, toute valeur contenant un point-virgule, un guillemet ou un retour à la ligne — le séparateur choisi est le point-virgule (`;`), pas la virgule, ce qui est la convention CSV la plus répandue dans les locales francophones (Excel en français attend `;` par défaut).
- **Le caractère invisible `﻿`** au tout début de la chaîne renvoyée par `genererCSV` est un BOM UTF-8 (Byte Order Mark) — sans lui, un Excel configuré en français affiche souvent les caractères accentués de travers, car il suppose par défaut un encodage Windows-1252 en l'absence de ce marqueur explicite.

`telechargerCSV` déclenche un téléchargement de fichier **entièrement côté client** : `Blob` + `URL.createObjectURL` + un `<a download>` cliqué par programme, sans aucun aller-retour serveur — le CSV n'existe jamais que dans la mémoire du navigateur, ce qui a du sens puisque les données à exporter ont, dans tous les cas observés, déjà été chargées dans l'écran avant l'export.

### 2.3 Qui l'utilise

`genererCSV`/`telechargerCSV` sont appelés depuis `components/BarreExport.tsx` (Volume 11z-5, le composant d'export réutilisable partagé par plusieurs écrans) et directement depuis trois pages : `Dashboard.tsx`, `Commissions.tsx` (Volume 11i) et `RapportsPersonnels.tsx` (Volume 11z-5) — ce dernier groupe des cas où l'export CSV est construit sur mesure pour la page plutôt que délégué au composant générique.

### 2.4 Confrontation avec la spec

Spec 3.8 (Rapports) mentionne un « export comptable (CSV) » pour le registre de Caisse et, plus largement, des capacités d'export sur plusieurs écrans. Cohérent avec le code : format à sections multiples, séparateur `;`, encodage UTF-8 avec BOM. **Aucun écart spec/code.**

## 3. `apps/web/src/lib/utils.ts` (6 lignes) — `cn`

Le plus petit fichier du projet éligible à ce livre :

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

`cn` combine deux bibliothèques déjà nommées au Volume 3 (Technologies) sans que leur usage combiné n'ait été montré : `clsx` assemble une liste de classes CSS en gérant les valeurs conditionnelles/`undefined`/tableaux, puis `twMerge` résout les conflits entre classes Tailwind (par exemple `"p-2 p-4"` → seule `"p-4"` est conservée, la dernière valeur gagnant sur une même propriété). C'est **le motif de composition de classes standard de shadcn/ui** (déjà signalé au Volume 3 comme un générateur de composants et non une dépendance figée) : chacune des 11 primitives `components/ui/` du Volume 9 l'utilise pour permettre à un appelant de surcharger ponctuellement le style par défaut d'un composant via une prop `className`, sans conflit ni doublon de classes. Utilisé dans 18 fichiers du projet au total.

## 4. `apps/web/src/components/FeedbackProvider.tsx` (121 lignes) — confirmations et erreurs globales

### 4.1 Intuition

Deux besoins d'interface récurrents dans toute application avec des actions destructrices ou des échecs réseau : demander confirmation avant une action irréversible, et signaler un échec sans bloquer l'utilisateur avec les boîtes de dialogue natives disgracieuses du navigateur (`window.confirm`, `window.alert`). `FeedbackProvider` remplace les deux par des composants cohérents avec le reste de l'interface (`Dialog` du Volume 9, toasts personnalisés).

### 4.2 `confirmer` : une Promise pilotée par l'état React

```ts
const confirmer = useCallback((options: OptionsConfirmation) => {
  setConfirmation(options);
  return new Promise<boolean>((resolve) => {
    resolveRef.current = resolve;
  });
}, []);

const repondre = useCallback((valeur: boolean) => {
  setConfirmation(null);
  resolveRef.current?.(valeur);
  resolveRef.current = null;
}, []);
```

Le point technique à retenir : `confirmer()` renvoie une `Promise<boolean>` que l'appelant peut `await`-er exactement comme le ferait `window.confirm()` de façon synchrone (`if (await confirmer({ description: "..." })) { ... }`), alors que l'affichage réel passe par l'état React (`setConfirmation`) et attend un clic humain sur l'un des deux boutons de la boîte de dialogue affichée. La `Promise` n'est résolue que lorsque `repondre(true|false)` est appelée — depuis le bouton Confirmer, le bouton Annuler, ou la fermeture de la boîte de dialogue elle-même (`onOpenChange`, traité comme une annulation). `resolveRef`, une `ref` plutôt qu'un état, conserve la fonction `resolve` de la `Promise` en cours entre les rendus sans déclencher de re-rendu supplémentaire à chaque affectation.

L'option `destructive` change uniquement la couleur du bouton de confirmation (`variant="destructive"` au lieu de `"cta"`) — un signal visuel de dernier recours avant une action irréversible, sans logique de blocage supplémentaire côté client (la vraie protection contre les actions destructrices reste, comme toujours dans ce projet, côté serveur : permissions, actions critiques du Volume 11f, confirmation manuelle de `restaurer-sauvegarde.ts` au Volume 18a).

### 4.3 `toastErreur` : une file de bandeaux auto-expirants

```ts
const toastErreur = useCallback((message: string) => {
  const id = ++prochainToastId;
  setToasts((prev) => [...prev, { id, message }]);
  setTimeout(() => retirerToast(id), DUREE_TOAST_MS);
}, [retirerToast]);
```

`prochainToastId`, un compteur module-scope (hors du composant, partagé par toutes les instances), garantit un identifiant unique à chaque appel même en cas d'appels rapprochés. Chaque toast se retire lui-même après `DUREE_TOAST_MS` (7000 ms) via `setTimeout`, sans action de l'utilisateur requise — plusieurs toasts peuvent s'empiler simultanément (`toasts` est un tableau), chacun avec son propre minuteur de disparition indépendant.

### 4.4 Position dans l'arbre de providers

Vu au Volume 8 sans que ce fichier n'ait encore été détaillé : `main.tsx` imbrique `FeedbackProvider` **à l'intérieur** de `SocketProvider`/`AuthProvider`, lui-même à l'intérieur de `ThemeProvider` :

```
ThemeProvider → AuthProvider → SocketProvider → FeedbackProvider → App
```

Utilisé par `useFeedback()` dans 19 fichiers du projet — la quasi-totalité des écrans avec une action de suppression ou une mutation TanStack Query dont l'échec doit être signalé à l'utilisateur.

### 4.5 Confrontation avec la spec

La spec ne prescrit pas explicitement ce mécanisme, mais elle exige de façon transversale (section 3.8, motif déjà repéré au Volume 15) des messages d'erreur clairs et compréhensibles — `toastErreur` en est l'un des deux relais visuels côté frontend (l'autre étant les messages inline de formulaire alimentés par les schémas Zod partagés, également Volume 15). **Aucun écart spec/code.**

## 5. Résumé du sous-chapitre

| Fichier | Rôle en une phrase | Écart spec/code |
|---|---|---|
| `lib/theme.tsx` | Thème clair/sombre, appliqué avant le premier rendu pour éviter le flash, avec bascule automatique système tant qu'aucun choix explicite n'existe | Aucun (fonctionnalité non mentionnée dans la spec, sans contradiction) |
| `lib/csv.ts` | Générateur CSV à sections multiples, séparateur `;`, BOM UTF-8 pour Excel, téléchargement entièrement côté client | Aucun |
| `lib/utils.ts` | `cn` : fusion `clsx` + `twMerge`, motif standard shadcn/ui utilisé par les 11 primitives `ui/` | Aucun |
| `components/FeedbackProvider.tsx` | Remplace `window.confirm`/`window.alert` par une boîte de dialogue et des toasts cohérents avec le design, `confirmer()` exposée comme une `Promise` | Aucun |

**Prochain sous-chapitre** : Volume 18c — pages restantes (`Dashboard.tsx`, `Profil.tsx`).
