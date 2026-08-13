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
| Rollback de lecture des notifications + toast d'échec | `lib/socket.tsx` (seule modification autorisée à ce fichier) + `lib/notificationsRollback.ts` | 10 |

Toutes les nouvelles chaînes visibles sont traduites en français, anglais,
lingala et kiswahili (`i18n/{fr,en,ln,sw}.json`, namespace `premium`) — les
**26 nouvelles clés `premium.*`** sont en parité parfaite dans les 4 langues
(vérifié par script). Précision (correction revue Codex sur la formulation
initiale) : le compte *total* de clés par fichier diffère d'une unité selon
la langue — 1039 en FR/EN, 1040 en LN/SW — uniquement à cause de la clé
`_note` (préexistante, propre à ln.json/sw.json, documentant que ces deux
traductions sont un premier jet non définitif — voir Volume 17 du livre
technique). Cette clé de métadonnées n'est pas une chaîne visible et n'entre
pas dans les 26 clés `premium.*` elles-mêmes, dont la parité est totale.

## Corrections apportées suite à la revue Codex (13 août, 2ᵉ commit)

F1 n'était pas validée en l'état : sept points de correction ont été
transmis, tous traités dans cette même branche, avant nouvelle revue.

1. **Rollback ciblé (`lib/socket.tsx` + `lib/notificationsRollback.ts`,
   nouveau)** — l'ancienne version capturait l'état des notifications dans
   un setter React pour le rejouer tel quel après l'appel réseau : un
   rollback qui remplaçait le tableau entier, effaçant au passage toute
   notification arrivée entre-temps via Socket.io. Remplacé par un rollback
   qui ne touche que l'identifiant concerné (jamais un remplacement complet)
   et par un registre de propriété par identifiant (jeton `Symbol` par
   appel) : une requête échouée ne peut plus annuler une mutation plus
   récente ou déjà réussie sur le même identifiant, y compris entre
   `marquerLue` et `toutMarquerLu` concurrents.
2. **`AutoTextarea`** — le compteur de caractères ne suivait `value` qu'au
   premier rendu (pas de resynchronisation si le parent la changeait sans
   passer par `onChange`) ; corrigé par un effet dédié. Le `style`
   personnalisé de l'appelant était entièrement écrasé par `{ maxHeight }`
   (l'ordre des props JSX donnait la main au spread qui suivait) ; corrigé
   par une fusion explicite avec `maxHeight` appliqué en dernier.
3. **`PremiumTable`** — la page affichée ne se recalculait que sur
   changement de recherche/tri, jamais sur une simple baisse du nombre de
   données ou de `taillePage`, pouvant afficher une page vide avec des
   résultats disponibles. Remplacé par une page effective **dérivée**
   (`bornerPage()`, testée), recalculée à chaque rendu sans effet
   supplémentaire ni clignotement.
4. **Système de toasts** — l'ancien plafonnement gardait les 3 *derniers*
   toasts arrivés et perdait silencieusement les précédents, y compris
   persistants. Remplacé par une vraie file d'attente : `toasts` est
   désormais la liste complète, jamais tronquée à l'émission ; seuls les 3
   premiers de la file sont rendus, les suivants prennent le relais dès
   qu'une place se libère. Refonte visuelle : position haut-droite
   (ordinateur) / haut-centré (mobile) au lieu de bas-droite partout, halo
   dégradé derrière un badge d'icône circulaire plus affirmé, cible de
   fermeture 44×44 px.
5. **Accessibilité/cibles tactiles** — `DateHeurePicker` utilise désormais
   `React.useId()` en repli quand `id` n'est pas fourni (l'association
   `Label`/champ était rompue sans lui). Bouton afficher/masquer du mot de
   passe et sélecteur de taille de page portés à 44×44/44 px réels (pas
   seulement visuels). Cases à cocher de `PremiumTable` : un `<span>` avec
   du padding agrandit visuellement la zone mais ne transmet pas le clic à
   la case — remplacé par un vrai `<label>` englobant, qui délègue
   nativement le clic sur toute sa surface.
6. **Tests** — 23 tests supplémentaires (`notificationsRollback.test.ts`,
   nouveau ; `pagination-logique.test.ts` et `toastBus.test.ts` étendus)
   couvrant le rollback ciblé et les scénarios de concurrence simulés, la
   file d'attente de toasts (persistant jamais évincé), et le bornage de
   pagination. Toujours aucune dépendance installée.
7. **Documentation** — précision sur le compte de clés i18n (voir plus bas).

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
n'installe **aucune** dépendance — ni `package.json`, ni `package-lock.json`,
ni aucune configuration de dépendances n'est modifiée. Les 92 tests livrés
(8 fichiers) couvrent donc uniquement la **logique pure** de chaque
composant — calculs, formatage, validation, rollback ciblé, file d'attente
de toasts, bornage de pagination — jamais le rendu DOM (clic, focus, rendu
conditionnel réel).

**Demande approuvée côté Codex** (revue du 13 août) : `jsdom`,
`@testing-library/react`, `@testing-library/user-event` et
`@testing-library/jest-dom` seront ajoutés en `devDependencies` de
`apps/web` par Codex, dans un harnais publié séparément (zone de
dépendances hors périmètre F1). Une fois ce harnais disponible, les tests
DOM suivants restent à ajouter : rollback et concurrence (montage réel de
`SocketProvider`), toasts persistants/timers/pause/fermeture, navigation
clavier/focus, `AutoTextarea` en usage contrôlé, association label/champ,
tailles et états réels des contrôles, pagination après réduction des
données.

## Vérifications exécutées

```
npm test                         → 92/92 tests passants (8 fichiers, 81 nouveaux)
cd apps/web && npm run build     → tsc --noEmit + vite build : succès, aucune erreur
```

Le build inclut la totalité de l'application existante (toutes les pages) :
aucune régression de compilation introduite par cette évolution.

## Accessibilité

- Cibles tactiles réellement ≥ 44×44 px sur tous les contrôles interactifs
  neufs (`size="touch"`/`"icon-touch"` du bouton, boutons de pagination et
  son sélecteur de taille, bouton afficher/masquer du mot de passe centré
  sur le champ, cases à cocher de `PremiumTable` via un vrai `<label>`
  englobant — pas une zone agrandie seulement visuellement).
- Association label/champ : `DateHeurePicker` génère un identifiant stable
  via `React.useId()` quand l'appelant n'en fournit pas, pour ne jamais
  perdre l'association `Label`/champ.
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

---

# F2 — Connexion et enveloppe Premium

> Base : `agent/integration-wave-1` au commit `04b87de1fb3ada819d0a0806117d523d5d327b17`
> (intègre F1 + ses tests DOM, PR #5 fusionnée).
> Branche : `claude/premium-shell-f2`.

## Architecture

- **`components/auth/AuthShell.tsx`** — enveloppe commune aux trois écrans
  d'authentification (connexion, mot de passe oublié, nouveau mot de passe).
  Principe non négociable, documenté en tête du fichier : le formulaire
  (`children`) reste **toujours** pleinement opaque, lisible et utilisable —
  jamais assombri, jamais `pointer-events: none`, jamais retiré de l'ordre
  de tabulation. La lampe à ficelle ne pilote qu'un halo décoratif autour de
  la scène de marque ; la « révélation progressive » du formulaire (tâche 4)
  est une simple animation d'entrée au montage (fondu + léger mouvement),
  indépendante de l'état de la lampe.
- **`components/auth/LampeFicelle.tsx`** + **`lampeLogique.ts`** — lampe
  décorative et interactive. Un vrai `<button>` porte toute la zone
  cliquable (clavier natif, Entrée/Espace). Le clic bascule l'état ; un
  glissement (souris ou tactile, unifié via les Pointer Events) vers le bas
  au-delà d'un seuil de 32 px bascule l'état de la même façon, sans
  déclencher un second basculement au `click` de fin de geste
  (`aBasculeParGlissement`). La logique de seuil est pure et testée sans
  dépendre du DOM.
- **`components/auth/prefersReducedMotion.ts`** — hook `matchMedia` en
  direct (même modèle que `lib/theme.tsx`), utilisé pour : suspendre les
  classes d'animation CSS (`.lomoto-authshell-*`, `index.css`, même
  convention que `.lomoto-splash-*` d'`EcranDemarrage.tsx`) et démarrer la
  lampe déjà « allumée » quand la préférence système la demande — la
  variante réduite est donc observable, pas seulement l'absence de mouvement.
- **`components/HorlogeFlip.tsx`** + **`horlogeLogique.ts`** — horloge
  compacte de l'en-tête (`Layout.tsx`, barre desktop et en-tête mobile).
  Composant isolé : son propre `setInterval`, nettoyé au démontage — seul ce
  composant se re-rend chaque seconde, jamais le reste de l'arbre. Toujours
  affichée en Africa/Kinshasa (`Intl.DateTimeFormat` avec `timeZone` fixe),
  indépendamment du fuseau du navigateur.
- **`pages/MotDePasseOublie.tsx`** / **`pages/NouveauMotDePasse.tsx`** —
  voir « Comportement provisoire » ci-dessous.
- **`components/Layout.tsx`** — la logique de navigation basée sur les rôles
  (`calculerLiens`), auparavant dupliquée entre la barre latérale desktop et
  le tiroir mobile, est désormais une seule fonction exportée et testée. La
  politique de visibilité existante (spec section 2 : tous les modules
  visibles, grisés hors périmètre du rôle) est **inchangée** — seule la
  duplication de code a été supprimée.

## Comportement provisoire des pages de récupération (tâches 9-10)

Aucun appel réseau n'est jamais effectué par `MotDePasseOublie.tsx` ni
`NouveauMotDePasse.tsx` : pas de faux jeton, pas de fausse demande envoyée,
pas de message laissant croire à un succès. Une soumission valide (après
validation locale uniquement) affiche un message persistant explicite
(`role="status"`) indiquant que l'intégration serveur est en attente, plus
un toast de la même teneur. Ce choix est requis par le plan de coordination
(§7) : *« La PR F2 peut rester en brouillon tant que les API
d'authentification nécessaires ne sont pas fusionnées »* — ces écrans
attendent les endpoints Codex C3 (réinitialisation par jeton, anti-
énumération, limitation de fréquence).

## i18n

Nouveau namespace `auth.*` (lampe, lien « mot de passe oublié », pages de
récupération, libellé accessible de l'horloge) ajouté aux 4 langues
(FR/EN/LN/SW), parité vérifiée par script (0 clé manquante ou en trop).

## Tests ajoutés

| Fichier | Couvre |
|---|---|
| `auth/lampeLogique.test.ts` | Seuil de glissement (logique pure) |
| `horlogeLogique.test.ts` | Décomposition Kinshasa, passage de minuit, libellé accessible |
| `auth/LampeFicelle.dom.test.tsx` | Clavier (bouton natif), clic, glissement Pointer Events au-dessus/en-dessous du seuil, non-double-basculement |
| `auth/AuthShell.dom.test.tsx` | Formulaire toujours utilisable quel que soit l'état de la lampe, variante `prefers-reduced-motion`, filigrane décoratif, lampe desktop + mobile |
| `HorlogeFlip.dom.test.tsx` | Affichage initial, progression par seconde, nettoyage exact de l'intervalle au démontage |
| `pages/Login.dom.test.tsx` | Lien « mot de passe oublié », focus clavier, soumission, erreur accessible |
| `pages/MotDePasseOublie.dom.test.tsx` | Association label/champ, validation, **absence d'appel réseau**, absence de message de succès |
| `pages/NouveauMotDePasse.dom.test.tsx` | Idem + validation longueur/correspondance des mots de passe |
| `Layout.navigation.test.ts` | `calculerLiens` sur plusieurs combinaisons de permissions (lecture, écriture, sans module) |

Résultat : `npm test` → 242/242 tests passants (29 fichiers). `npm run
build` (tsc + vite) et `npm audit` (0 vulnérabilité) passent également.
`npm ci` exécuté avec succès avant la vérification finale.

## Correctif découvert pendant la prise des captures d'écran

L'état « éteint » de l'icône de l'ampoule (`LampeFicelle.tsx`) utilisait une
couleur fixe (`text-creme/40`) pensée pour le panneau de marque sombre du
bureau — invisible sur le fond clair de l'en-tête compact mobile. Corrigé en
`text-current/40` (et `bg-current/40` pour le cordon) : la couleur suit
désormais celle posée par l'appelant sur chaque instance (crème sur le
panneau marine, marine/crème selon le thème dans l'en-tête mobile).

## Captures d'écran

Connexion (bureau et mobile), variante `prefers-reduced-motion`, enveloppe
authentifiée (bureau et mobile, tiroir de navigation ouvert) — voir le
rapport de livraison F2.
