# Volume 10 — Navigation et gestion de l'état

**Niveau de risque : 2.** Traitement complet. Ce chapitre couvre la seconde moitié de `apps/web/src/App.tsx` (l'arbre de routes de l'utilisateur authentifié, laissée de côté au Volume 8) et fait la synthèse des conventions TanStack Query déjà rencontrées, sans les redémontrer, dans la quasi-totalité des chapitres applicatifs de ce livre.

## Fiche d'identité

| Fichier | Rôle |
|---|---|
| `apps/web/src/App.tsx` (`AppAuthentifiee`, `RequiertLecture`, `RequiertEcriture`) | Arbre de routes, gardes de permission |
| Conventions TanStack Query (transversales, `apps/web/src/lib/api.ts` et chaque page) | Cache de données serveur, invalidation |

## 5.1 Chargement à la demande — `React.lazy`

```tsx
// Tous les modules métier sont chargés à la demande via React.lazy — leur
// code (et les grosses libs qu'ils tirent, ex. Recharts pour le Dashboard)
// n'entre pas dans le chunk initial et n'est récupéré qu'à la navigation.
const DashboardPage = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const CommandesPage = lazy(() => import("@/pages/Commandes").then((m) => ({ default: m.CommandesPage })));
// ... 18 autres pages, toutes lazy ...
```

Sur les 22 pages du projet (Volume 7), **20 sont chargées en lazy** — seule `LoginPage` reste dans le bundle initial, un choix déjà justifié au Volume 8 (c'est l'écran d'entrée, un délai y serait plus gênant qu'ailleurs). `.then((m) => ({ default: m.CommandesPage }))` est nécessaire parce que `React.lazy` attend un module avec un export **par défaut** — or, convention constante de tout ce projet déjà relevée à de nombreuses reprises (Volume 2), chaque page exporte un composant **nommé** (`export function CommandesPage()`), jamais un `export default`. Cette petite fonction d'adaptation republie l'export nommé sous la forme attendue par `lazy`. Conséquence pratique pour la taille du bundle : une bibliothèque lourde utilisée par un seul écran (Recharts pour le Tableau de bord, cité explicitement en commentaire) n'alourdit jamais le chargement initial de l'application — elle n'est récupérée par le navigateur qu'au moment où l'utilisateur visite effectivement cet écran.

## 5.2 Les gardes de permission — `RequiertLecture` et `RequiertEcriture`

```tsx
function RequiertLecture({ module, children }: { module: Module; children: ReactNode }) {
  const { peutLire } = useAuth();
  if (!peutLire(module)) return <Navigate to="/" replace />;
  return children;
}

function RequiertEcriture({ module, children }: { module: Module; children: ReactNode }) {
  const { peutEcrire } = useAuth();
  if (!peutEcrire(module)) return <Navigate to="/" replace />;
  return children;
}
```

Deux composants presque identiques, distingués uniquement par la fonction de vérification appelée (`peutLire`/`peutEcrire`, Volume 11b). Chacun enveloppe l'élément de route correspondant :

```tsx
<Route path="/caisse" element={<RequiertLecture module="CAISSE"><CaissePage /></RequiertLecture>} />
<Route path="/approbations" element={<RequiertEcriture module="EQUIPE"><ApprobationsPage /></RequiertEcriture>} />
```

**Rappel de sécurité déjà formulé au Volume 11b, et qui vaut la peine d'être répété ici** : ces gardes ne sont **jamais** la protection réelle des données — elles empêchent seulement l'affichage d'un écran inutile à un utilisateur qui, de toute façon, verrait chacun de ses appels réseau refusés par `requirePermission` côté serveur (Volume 11b). Un utilisateur qui contournerait cette garde (en modifiant le code JavaScript exécuté dans son propre navigateur, par exemple) n'obtiendrait jamais de données qu'il n'a pas le droit de lire : la garde côté client est un confort d'expérience utilisateur, la garde côté serveur est la sécurité réelle. Toutes deux s'appuient sur les mêmes fonctions pures (`aAcces`, Volume 11a), mais évaluées dans deux contextes d'exécution entièrement différents et non interchangeables.

`Navigate to="/" replace` : une redirection vers le tableau de bord (accessible à tous, sans `module` requis, Volume 9) plutôt qu'un message d'erreur affiché — cohérent avec la règle de menu déjà vue (Volume 9) : un lien vers un module hors permission n'apparaît de toute façon jamais cliquable, cette garde ne protège donc que contre un accès direct par URL.

## 5.3 L'arbre de routes complet

```tsx
function AppAuthentifiee() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/produits" element={<ProduitsPage />} />
        <Route path="/caisse" element={<RequiertLecture module="CAISSE"><CaissePage /></RequiertLecture>} />
        {/* ... */}
        <Route path="/profil" element={<ProfilPage />} />
        <Route path="/rapports" element={<RapportsPersonnelsPage />} />
        <Route path="/a-propos" element={<AProposPage />} />
        <Route path="/assistant" element={<AssistantPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

**Une seule route imbriquée** (`<Route element={<Layout />}>`) englobe toutes les autres — un motif standard de React Router : `Layout` (Volume 9) rend sa coquille de navigation puis un `<Outlet />` à l'endroit où la route enfant active doit s'afficher. Toutes les pages authentifiées partagent donc systématiquement la même barre latérale/tiroir mobile, sans avoir à la répéter dans chaque page.

Trois catégories de routes, visibles par la présence ou l'absence d'une garde :

- **Sans garde** : `/` (Tableau de bord), `/produits` (catalogue, lecture ouverte à tous — Volume 18), `/profil`, `/rapports` (portée résolue côté serveur, Volume 11k-3 pour le principe similaire des bulletins personnels), `/a-propos`, `/assistant` — tous accessibles à n'importe quel utilisateur authentifié, sans notion de module.
- **`RequiertLecture`** : la majorité des routes métier (`/caisse`, `/commandes`, `/stocks`, `/production`, `/fournisseurs`, `/equipe`, `/travailleurs`, `/commissions`, `/parametres`, `/audit`) — accessibles à qui a au moins la lecture sur le module correspondant.
- **`RequiertEcriture`** : seulement `/approbations` et `/etat-systeme`, toutes deux sur le module `EQUIPE` — cohérent avec le fait que ces deux écrans sont réservés aux Admins (Volumes 11f, 23), l'écriture sur `EQUIPE` étant, dans la matrice de rôles par défaut (Volume 13, `seed.ts`), le propre du rôle Administrateur.

`<Route path="*" element={<Navigate to="/" replace />} />`, en dehors du `Layout`, capture toute URL non reconnue par l'arbre authentifié et redirige vers le tableau de bord — le même filet de sécurité que la route `"*"` déjà vue pour l'utilisateur non authentifié (Volume 8).

## 5.4 Gestion de l'état — état serveur (TanStack Query) contre état local (`useState`)

Ce livre a déjà rencontré, chapitre après chapitre, une convention constante que ce volume rassemble sans la redémontrer :

- **Toute donnée qui vit sur le serveur** (une liste de commandes, un registre de caisse, la matrice de permissions...) est lue via `useQuery`, jamais copiée dans un `useState` local — le cache de TanStack Query (configuré une seule fois dans `main.tsx`, Volume 8) *est* l'état, partagé par tous les composants qui utilisent la même clé de requête.
- **Toute donnée propre à un formulaire ou une interaction en cours** (le contenu d'un champ de saisie, l'ouverture d'un dialogue) reste un `useState` local au composant, jamais mise en cache serveur.

### Convention des clés de requête

Une clé de requête (`queryKey`) est systématiquement un tableau commençant par une chaîne stable identifiant la ressource, suivie de ses paramètres de filtrage :

```tsx
useQuery({ queryKey: ["commandes", filtres], queryFn: () => api(`/api/commandes?${paramsListe}`) });
useQuery({ queryKey: ["paie", paieTravailleurId, paieMois], queryFn: () => api(`/api/travailleurs/${paieTravailleurId}/paie?mois=${paieMois}`) });
```

Changer un filtre change la clé, ce qui déclenche automatiquement une nouvelle requête réseau plutôt qu'un filtrage en mémoire sur des données déjà chargées — un choix systématique déjà relevé explicitement aux volumes 11g (Journal d'audit), 11h (Commandes) et 11i (Commissions) : le serveur, pas le client, reste la source de vérité du filtrage.

### Convention d'invalidation après une mutation

```tsx
const rafraichir = () => {
  queryClient.invalidateQueries({ queryKey: ["commandes"] });
  queryClient.invalidateQueries({ queryKey: ["commandes-resume-jour"] });
  queryClient.invalidateQueries({ queryKey: ["clients"] });
  queryClient.invalidateQueries({ queryKey: ["commissions"] });
};
```

Après une écriture réussie (`onSuccess` d'un `useMutation`), le motif constant est d'invalider **toutes** les clés susceptibles d'être affectées par ce changement, pas seulement celle de l'écran courant — l'exemple ci-dessus (Volume 11h) invalide jusqu'à quatre clés différentes après l'enregistrement d'une seule commande, parce qu'une commande affecte le résumé du jour, le solde d'avance du client, et potentiellement les commissions. `invalidateQueries` ne recharge pas immédiatement les données : il marque le cache existant comme obsolète, ce qui déclenche un nouveau chargement au prochain composant qui consulte cette clé (immédiatement si un composant l'affiche déjà à l'écran).

### `enabled` — ne pas interroger le serveur pour rien

```tsx
useQuery({ queryKey: ["alertes-absence"], queryFn: () => api("/api/travailleurs/alertes-absence"), enabled: peutEcrire("TRAVAILLEURS") });
useQuery({ queryKey: ["paie", paieTravailleurId, paieMois], queryFn: () => api(`/api/travailleurs/${paieTravailleurId}/paie?mois=${paieMois}`), enabled: !!paieTravailleurId && !!paieMois });
```

Deux usages distincts déjà rencontrés dans ce livre : suspendre une requête tant qu'un utilisateur n'a pas la permission requise (Volume 9, cohérent avec la garde côté serveur qui la refuserait de toute façon), ou tant qu'un paramètre nécessaire n'est pas encore renseigné (un travailleur et un mois sélectionnés, Volume 11k-3). Dans les deux cas, `enabled: false` évite un appel réseau voué à échouer ou dénué de sens plutôt que de le laisser partir puis gérer son erreur.

## 5.5 Cas limites

| Situation | Comportement |
|---|---|
| Accès direct par URL à une route protégée sans la permission requise | Redirection silencieuse vers `/` — jamais de message d'erreur affiché côté client (§5.2). |
| URL inconnue une fois authentifié | Redirection vers `/` (route `"*"`, §5.3). |
| Changement de filtre sur un écran de liste | Nouvelle requête réseau, jamais un filtrage en mémoire sur l'ancien résultat (§5.4). |
| Mutation réussie sur un écran qui affecte plusieurs autres vues | Toutes les clés concernées sont invalidées, pas seulement celle de l'écran courant (§5.4). |

## 5.6 Croisement avec la spécification

Aucune section de la spec ne dicte directement l'architecture de routage ou de cache — ce chapitre porte sur des choix techniques d'implémentation. Le seul point vérifiable contre la spec, déjà confirmé au Volume 9, est la correspondance exacte entre chaque route protégée et son module de permission dans la matrice (Volume 11a) — aucun écart trouvé.

## 5.7 Résumé

L'arbre de routes authentifié combine chargement à la demande (vingt pages sur vingt-deux, pour garder le bundle initial léger) et deux gardes de permission simples, dont le rôle reste un confort d'affichage — jamais la sécurité réelle, toujours assurée côté serveur. La gestion de l'état suit une séparation stricte entre état serveur (TanStack Query, clés structurées, invalidation large après chaque écriture) et état local d'interaction (`useState`), une convention appliquée sans exception dans tous les écrans déjà couverts par ce livre.

---

**Suite →** Reprise du parcours dans l'ordre du mandat : Volume 11 (reste du back-end Niveau 2 — Stocks, Fournisseurs, Production, Départements, Notifications) et Volume 12 (API et communications réseau, Socket.io).
