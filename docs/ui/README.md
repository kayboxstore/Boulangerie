# Bibliothèque de composants Premium — apps/web

> Produit dans le cadre de la tâche **F1** du plan de coordination Codex/Claude Code
> (`docs/coordination/PLAN_COORDINATION_CODEX_CLAUDE_LOMOTO.md`, version 2.0).
> Base : `main-a7fm5x` au commit `f7880b90ed1e2b735189b5c06ad9c2d88ed7fe35`.
> Branche : `claude/premium-ui-f1`.

## Périmètre de cette livraison

F1 livre la **bibliothèque de composants** elle-même — aucune page existante
n'a été modifiée, aucun écran ne consomme encore ces composants. C'est
volontaire : le plan de coordination (§6, tâche F1) réserve l'intégration
visuelle (scène de connexion, mot de passe oublié, horloge, anniversaires)
aux vagues suivantes F2/F3, et limite explicitement la zone de fichiers de
F1 à `apps/web/src/components/**`, `apps/web/src/index.css`, `docs/ui/**`,
et `apps/web/src/lib/socket.tsx` — cette dernière uniquement pour le
rollback des notifications.

Aucune route API, migration, contrat partagé (`packages/shared`) ni
dépendance n'a été touchée.

## Composants livrés

| Composant | Fichier | Tâche F1 |
|---|---|---|
| Toast Premium (variantes succès/erreur/avertissement/information) | `components/FeedbackProvider.tsx` (évolution) + `components/toast/toastBus.ts` | 1 |
| Bouton Premium (état `loading`, tailles tactiles `touch`/`icon-touch`) | `components/ui/button.tsx` (évolution additive) | 2 |
| Champ de mot de passe Premium | `components/ui/password-field.tsx` + `components/ui/robustesseMotDePasse.ts` | 3 |
| Zone de texte auto-ajustable | `components/ui/auto-textarea.tsx` + `components/ui/compteurCaracteres.ts` | 4 |
| Sélecteur date/heure en français | `components/ui/date-time-picker.tsx` + `components/ui/dateHeureFr.ts` | 5 |
| Liste mobile + Tableau ordinateur Premium (générique) | `components/premium/premium-table.tsx` + `components/premium/rechercheEtTri.ts` | 6, 7 |
| Pagination Premium générique | `components/ui/pagination.tsx` + `components/ui/pagination-logique.ts` | 8 |
| États vide / chargement / hors-ligne / réessayer | `components/ui/etats.tsx` | 9 |
| Rollback de lecture des notifications + toast d'échec | `lib/socket.tsx` (seule modification autorisée à ce fichier) | 10 |

Toutes les nouvelles chaînes visibles sont traduites en français, anglais,
lingala et kiswahili (`i18n/{fr,en,ln,sw}.json`, namespace `premium`) —
parité vérifiée par script (1039/1039 clés dans les 4 langues).

## Pourquoi un « bus de toasts » séparé du contexte React

`FeedbackProvider` est monté **sous** `SocketProvider` dans `main.tsx` :

```
<SocketProvider>
  <FeedbackProvider>
    <App />
  </FeedbackProvider>
</SocketProvider>
```

`useFeedback()` est donc structurellement inaccessible depuis
`lib/socket.tsx`, alors que la tâche F1 demande explicitement de signaler
l'échec du rollback des notifications « via le toast ». Réordonner les
providers aurait nécessité de modifier `main.tsx`, hors zone de fichiers
autorisée pour F1.

Solution retenue : `components/toast/toastBus.ts` est un petit module
d'état **hors contexte React** (le même principe que les bibliothèques de
toast usuelles) — n'importe quel code, dans l'arbre React ou non, peut
appeler `emettreToast(...)` ; `FeedbackProvider` s'y abonne et affiche.
`toastErreur()` (36 appels existants) reste inchangé et rétrocompatible.

## Pourquoi la logique pure est séparée des composants `.tsx`

Chaque composant qui contient une règle de calcul (robustesse d'un mot de
passe, formatage de date, calcul de pagination, recherche/tri, compteur de
caractères) l'expose dans un fichier `.ts` **sans import via l'alias `@/`**,
consommé ensuite par le composant `.tsx` correspondant via un import
relatif. Raison : le `vitest.config.ts` racine (qui exécute `npm test` sur
tout le monorepo, `apps/**/*.test.ts` inclus) n'a pas la résolution d'alias
`@/` → `apps/web/src` configurée — elle n'existe que dans
`apps/web/vite.config.ts`, propre au serveur de dev/au build. Un fichier de
test import la logique pure directement (`./robustesseMotDePasse`, jamais
`@/components/ui/password-field`) et s'exécute donc sans dépendre de cette
résolution.

## Limite connue et demande transmise à Codex

Aucune bibliothèque de rendu de composant (`@testing-library/react`) ni
d'environnement DOM pour Vitest (`jsdom`) n'est installée dans le dépôt —
vérifié avant d'écrire le moindre test :

```
$ find . -iname jsdom -o -iname "*testing-library*"   → aucun résultat
```

Conformément à la règle du plan de coordination (§4 : « Si une bibliothèque
frontend paraît nécessaire, Claude doit d'abord démontrer que les
dépendances présentes ne suffisent pas et transmettre la demande »), F1
n'installe **aucune** dépendance. Les 69 tests livrés (7 fichiers) couvrent
donc uniquement la **logique pure** de chaque composant — calculs,
formatage, validation — jamais le rendu DOM (clic, focus, rendu
conditionnel réel).

**Demande transmise** : `jsdom` + `@testing-library/react` (+
`@testing-library/user-event` en option) comme `devDependencies` de
`apps/web`, pour permettre de vrais tests de rendu en F2/F3 — en particulier
pour les parcours clavier/focus de `AuthShell` et la scène de connexion.

## Vérifications exécutées

```
npm test                         → 69/69 tests passants (7 fichiers, dont 61 nouveaux)
cd apps/web && npm run build     → tsc --noEmit + vite build : succès, aucune erreur
```

Le build inclut la totalité de l'application existante (toutes les pages) :
aucune régression de compilation introduite par cette évolution.

## Accessibilité

- Cibles tactiles ≥ 44 px sur tous les nouveaux contrôles interactifs
  (`size="touch"`/`"icon-touch"` du bouton, boutons de pagination, bouton
  afficher/masquer du mot de passe via une zone de clic élargie).
- Navigation clavier : tri des colonnes de `PremiumTable` via un vrai
  `<button>` (pas un simple `onClick` sur `<th>`), focus visible partout
  (`focus-visible:ring-2`).
- `prefers-reduced-motion` respecté (spinner du bouton, barre de durée du
  toast) via la variante Tailwind `motion-reduce:`.
- Toast : `role="alert"`/`"status"` selon la variante, `aria-live` cohérent,
  pause automatique au survol **et** au focus clavier (pas seulement à la
  souris).
- Contraste : nouvelles couleurs d'état (`--succes`, `--avertissement`,
  `--information`) définies en clair et sombre dans `index.css`, sur le
  même modèle que les tokens de marque existants.

## Ce qui reste hors périmètre F1 (volontairement)

Conformément au plan de coordination §6 : pas de scène de connexion à
lampe, pas de parcours mot de passe oublié, pas d'horloge « flip », pas de
« Constellation Lomoto » — ces éléments appartiennent à F2/F3, une fois les
API d'authentification de Codex (C3) disponibles.
