# Volume 18d — Configuration et outillage (section M de la matrice)

> Quatrième et dernier sous-chapitre du Volume 18 — et dernier chapitre nécessaire pour clore entièrement `MATRICE_DE_COUVERTURE.md`. Neuf fichiers de configuration Niveau 3, tous déjà mentionnés en passant (Volumes 3, 5, 7, 9) sans que leur contenu exact n'ait été montré. Traitement concis, conforme à la règle Niveau 3 du mandat.
>
> **Mise à jour (correctif P0-01, 19-20/08/2026, complété après revue externe)** : les extraits ci-dessous montrent `"db:seed": "prisma db seed"` et `"seed": "tsx prisma/seed.ts"` — ces noms n'existent plus. Le script npm est désormais `db:seed:demo` (dev/test uniquement, invoqué via un lanceur Node multiplateforme, `scripts/lancer-seed-demo.mjs`), la configuration `"prisma".seed` pointe vers `prisma/seed-demo.ts`, et `apps/api/tsconfig.json` référence `prisma/seed-demo.ts` (plus `prisma/bootstrap-production.ts`, nouveau). Voir `DEPLOIEMENT.md` § « Correctif P0-01 » pour l'état actuel faisant foi. Ce chapitre reste un instantané du code tel qu'il existait à sa rédaction et n'est pas réécrit au-delà de cette note.

## 1. `package.json` (racine) — l'orchestrateur du monorepo

```json
{
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "npm-run-all --parallel dev:api dev:web",
    "dev:api": "npm run dev --workspace apps/api",
    "dev:web": "npm run dev --workspace apps/web",
    "build": "npm run typecheck --workspace apps/api && npm run build --workspace apps/web",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "db:seed": "prisma db seed",
    "test": "vitest run",
    "restore:backup": "tsx scripts/restaurer-sauvegarde.ts"
  },
  "prisma": { "schema": "prisma/schema.prisma", "seed": "tsx prisma/seed.ts" }
}
```

Le champ `workspaces` (déjà nommé au Volume 7 sans être montré) est ce qui fait de ce dépôt un **monorepo npm** au sens strict : `apps/api`, `apps/web` et `packages/shared` sont chacun un paquet npm indépendant (leur propre `package.json`), mais un seul `npm install` à la racine installe les dépendances des trois à la fois, et `@lomoto/shared` (référencé comme `"*"` dans les `dependencies` d'`apps/api`/`apps/web`) est résolu par un lien symbolique local plutôt que publié sur un registre — cohérent avec sa description au Volume 3 (« consommé en source, pas de build séparé »).

`npm-run-all2` (le fork maintenu de `npm-run-all`, déjà listé au Volume 3) permet à `npm run dev` de démarrer les deux serveurs (API sur le port 3001, frontend Vite sur le port 5173) **en parallèle** dans un seul terminal, plutôt que d'exiger deux terminaux séparés.

Le script `build` illustre une asymétrie délibérée déjà pressentie au Volume 8 : `apps/api` n'est **jamais compilé** en production (`tsc --noEmit`, une vérification de types pure — le serveur tourne directement via `tsx`, l'exécuteur TypeScript), alors qu'`apps/web` est réellement construit en fichiers statiques par `vite build`. C'est cohérent avec le déploiement Render à service unique déjà détaillé au Volume 5 : un seul processus Node sert à la fois l'API et les fichiers statiques compilés du frontend (`app.ts`, Volume 8).

Le bloc `"prisma"` (`schema`, `seed`) est la convention officielle par laquelle Prisma CLI trouve le schéma et la commande de seed sans argument explicite à chaque invocation — c'est ce qui permet à `prisma migrate dev`/`prisma db seed` (Volume 13) de fonctionner tels quels depuis n'importe quel sous-dossier.

Le script `restore:backup`, ajouté en même temps que `scripts/restaurer-sauvegarde.ts` (Volume 18a), en est le raccourci officiel — `npm run restore:backup -- <fichier.dump> --confirmer`.

## 2. `apps/api/package.json` — dépendances du serveur

Confirme, avec les numéros de version exacts au moment de l'audit, la liste déjà énoncée au Volume 3 : Express 4.21, Prisma Client 6.8, `bcryptjs` 3.0 (Volume 11c), `jsonwebtoken` 9.0 (`lib/jwt.ts`, Volume 11b), `node-cron` 4.6 (`planificateurSauvegarde.ts`, Volume 11z-4), `nodemailer` 9.0 (`services/email.ts`, Volume 11z-5), `pdfkit` 0.19 (`services/pdf.ts`, Volumes 11z-2/11z-5), `socket.io` 4.8 (`lib/realtime.ts`, Volume 12), `zod` 3.24 (Volume 15), `cors` 2.8 (`lib/origines.ts`, Volume 14), `dotenv` 16.5 (chargement de `.env`, Volume 5). Le seul script propre à ce paquet digne de remarque, `"typecheck": "tsc --noEmit"`, est celui invoqué par le `build` racine (§1) — jamais de compilation réelle vers `dist/`.

## 3. `apps/api/tsconfig.json` — configuration TypeScript du serveur

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noEmit": true, "allowImportingTsExtensions": true
  },
  "include": ["src/**/*.ts", "../../packages/shared/src/**/*.ts", "../../prisma/seed.ts"]
}
```

Deux réglages méritent d'être expliqués au-delà du standard :

- **`allowImportingTsExtensions`** couplé à **`noEmit: true`** : ce projet importe ses propres fichiers avec l'extension `.js` explicite dans le code source (`import { prisma } from "./prisma.js"`, motif visible dans tous les fichiers déjà lus, par exemple `lib/parametres.ts` au Volume 18a) alors que les fichiers réels portent l'extension `.ts`. C'est la convention imposée par Node.js en mode ESM (Volume 3, note sur ESM) : au runtime, Node résout des imports `.js`, jamais `.ts` — mais comme ce projet ne compile jamais réellement vers du JavaScript (`tsx` exécute le TypeScript directement, `noEmit: true` empêche même `tsc` de rien écrire), l'extension `.js` dans le code source ne correspond à aucun fichier `.js` réel sur le disque. `allowImportingTsExtensions` existe normalement pour l'inverse (importer littéralement des fichiers `.ts`) ; ici, sa présence tolère surtout que TypeScript ne s'alarme pas de résoudre un import `.js` vers un fichier `.ts` voisin.
- **`include` couvrant trois racines distinctes** (`src/`, `packages/shared/src/`, `prisma/seed.ts`) : `tsc --noEmit` (le typecheck du §2) vérifie donc, en une seule commande, non seulement le code de l'API mais aussi le fichier partagé et le script de seed — cohérent avec le fait que `packages/shared/src/index.ts` est consommé **en source** (jamais compilé séparément, Volume 3) : c'est littéralement le typecheck de l'API qui, une fois de plus, revalide ce fichier partagé à chaque exécution.

## 4. `apps/web/package.json` — dépendances du frontend

Confirme la liste du Volume 3 avec les versions exactes : React 19.1, React Router 7.5, TanStack Query 5.75, Tailwind CSS 4.1 (via le plugin Vite `@tailwindcss/vite`, pas un fichier `tailwind.config.js` séparé — cohérent avec Tailwind 4), Radix UI (`react-dialog`, `react-label`, `react-slot` — les trois primitives réellement utilisées, Volume 9), `class-variance-authority` 0.7 (`cva`, Volume 9), `clsx` 2.1 et `tailwind-merge` 3.2 (les deux dépendances de `cn`, Volume 18b), `i18next`/`react-i18next` (Volume 17), `recharts` 3.9 (graphiques du Tableau de bord, Volume 18c), `framer-motion` 12.4 (animation de `NotificationBell`, Volume 11z-4), `socket.io-client` 4.8 (Volume 12), `lucide-react` (bibliothèque d'icônes, utilisée dans la quasi-totalité des composants déjà lus). Script `"build": "tsc --noEmit && vite build"` : contrairement à `apps/api`, le frontend **est** réellement compilé — le typecheck précède la construction Vite, qui échouerait de toute façon silencieusement sur des erreurs de type sans ce garde-fou explicite.

## 5. `apps/web/tsconfig.json` — configuration TypeScript du frontend

Même structure que celle de l'API (§3), avec trois différences dictées par la nature du code :

- **`"lib": ["ES2022", "DOM", "DOM.Iterable"]`** — ajoute les types du navigateur (`window`, `document`, `localStorage`...) absents côté API.
- **`"jsx": "react-jsx"`** — active la transformation JSX moderne (pas besoin d'importer `React` explicitement dans chaque fichier `.tsx` pour utiliser la syntaxe `<Composant />`).
- **`"paths": { "@/*": ["./src/*"] }`** — définit l'alias `@/` (vu des dizaines de fois dans les imports de ce livre, ex. `@/lib/api`, `@/components/ui/button`) comme un raccourci vers `src/`, en miroir exact de l'alias `"@"` défini côté bundler dans `vite.config.ts` (§6) — les deux doivent rester synchronisés : `tsconfig.json` pour que l'éditeur/le typecheck résolvent l'alias, `vite.config.ts` pour que le bundler le résolve à l'exécution/au build.

`include` couvre `src`, `vite.config.ts` lui-même, et `../../packages/shared/src` — même logique qu'en §3 : le fichier partagé est retypé à chaque `tsc --noEmit` du frontend également.

## 6. `apps/web/vite.config.ts` — bundler et serveur de développement

```ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  build: {
    rollupOptions: { output: { manualChunks: {
      "react-vendor": ["react", "react-dom", "react-router-dom"],
      "query-vendor": ["@tanstack/react-query"],
      "i18n-vendor": ["i18next", "react-i18next"],
    } } },
  },
  server: {
    host: true, port: 5173,
    proxy: { "/api": { target: "http://localhost:3001", changeOrigin: true }, "/socket.io": { target: "http://localhost:3001", ws: true } },
  },
  preview: { host: true, port: 4173, proxy: { /* identique */ } },
});
```

Trois points, chacun accompagné d'un commentaire explicite dans le code source lui-même :

- **`manualChunks`** — isole trois groupes de dépendances « socle » (React lui-même, TanStack Query, i18next) dans des fichiers JavaScript séparés et stables, mis en cache long terme par le navigateur indépendamment du reste du code applicatif qui change à chaque déploiement. Le commentaire du fichier précise un choix négatif tout aussi délibéré : `recharts` (Volume 18c) et `framer-motion` (Volume 11z-4) sont **volontairement exclus** de cette liste, car les y inclure les ferait précharger (`modulepreload`) dès le démarrage de l'application — alors que ce sont précisément deux dépendances lourdes consommées uniquement par des pages/composants en chargement paresseux (`React.lazy`, Volume 10 : `Dashboard.tsx` pour `recharts`, `NotificationBell.tsx` pour `framer-motion`). Laissées au découpage automatique de Rollup, elles ne sont récupérées par le navigateur qu'au moment où l'utilisateur navigue réellement vers l'écran qui en a besoin.
- **`server.host: true`** — fait écouter le serveur de développement Vite sur toutes les interfaces réseau (`0.0.0.0`), pas seulement `localhost`, pour permettre de tester l'application depuis un autre appareil du même réseau Wi-Fi (typiquement un téléphone, cohérent avec l'exigence « responsive mobile » de la spec, section 1) — sans ce réglage, seule la machine de développement elle-même pourrait atteindre le serveur.
- **`server.proxy`** — en développement, le frontend (port 5173) et l'API (port 3001) sont deux processus distincts ; ce proxy fait que le navigateur n'a besoin de connaître que le port 5173, Vite relayant en coulisses tout ce qui commence par `/api` ou `/socket.io` vers le port 3001 (avec `ws: true` pour le second, indispensable pour relayer une connexion WebSocket et pas seulement des requêtes HTTP classiques). C'est une commodité **de développement uniquement** — en production, un seul processus Express sert les deux (`app.ts`, Volume 8), donc ce bloc `proxy` n'a plus aucun rôle une fois l'application construite et déployée. Le bloc `preview` reproduit la même configuration pour `vite preview` (test local d'un build de production).

## 7. `apps/web/components.json` — pilotage de shadcn/ui

```json
{
  "style": "new-york", "tailwind": { "baseColor": "neutral", "cssVariables": true },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui" }
}
```

Déjà nommé aux Volumes 7 et 9 (« pas une dépendance, un générateur ») sans que son contenu n'ait été montré. `"style": "new-york"` sélectionne l'une des deux variantes visuelles proposées par shadcn/ui pour ses composants générés (plus dense/anguleuse que l'alternative `"default"`) ; `"cssVariables": true` fait que les couleurs de thème sont exposées comme variables CSS (exploitées par le mode sombre de `lib/theme.tsx`, Volume 18b, via la classe `.dark` sur `<html>`) plutôt qu'en valeurs Tailwind figées à la génération. Les `aliases` (`components`, `utils`, `ui`) sont ce qui permet à la commande `npx shadcn add <composant>` (jamais exécutée dans ce livre, car hors périmètre d'exécution de code, mais dont l'effet est visible dans `components/ui/`, Volume 9) de savoir où déposer chaque nouveau fichier généré — ils pointent tous vers le même alias `@/` déjà vu en `tsconfig.json` (§5) et `vite.config.ts` (§6).

## 8. `packages/shared/package.json` — le paquet transversal

```json
{
  "name": "@lomoto/shared",
  "main": "./src/index.ts", "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": { "zod": "^3.24.4" }
}
```

Le plus court des trois `package.json` du monorepo, et le plus révélateur de la convention « consommé en source » déjà énoncée au Volume 3 : `main`, `types` et `exports` pointent tous les trois directement vers le fichier `.ts` **source**, jamais vers un dossier `dist/` compilé. Un paquet npm classique publié sur un registre pointerait ces champs vers du JavaScript déjà transpilé ; ici, `apps/api` et `apps/web` important `@lomoto/shared` reçoivent littéralement le fichier `packages/shared/src/index.ts` tel quel, retypé et recompilé à la volée par le `tsconfig.json` de chacun des deux consommateurs (§3, §5) — il n'existe tout simplement aucune étape de build propre à ce paquet. `zod` est sa seule dépendance réelle, cohérent avec son contenu (Volume 15) : types, DTO, fonctions de calcul pures et schémas de validation Zod, rien d'autre.

## 9. `vitest.config.ts` (racine) — configuration des tests

```ts
export default defineConfig({
  test: { include: ["packages/**/*.test.ts", "apps/**/*.test.ts"] },
});
```

Le plus court fichier de configuration du projet. Un seul réglage explicite : le motif de découverte des fichiers de test, qui balaie l'ensemble du monorepo (`packages/` et `apps/`) plutôt que de se limiter à un seul paquet. Au moment de l'audit, **un seul fichier de test existe réellement dans tout le projet** : `packages/shared/src/index.test.ts` (Volume 11a, 11 tests Vitest sur `calculerCommande`/`calculerDepenseFarine`/`aAcces`) — ce fichier de configuration est donc dimensionné pour une croissance future (tests d'autres paquets) plutôt que pour l'usage actuel, qui ne l'exploite que sur une infime fraction de son périmètre déclaré. **Non confirmé dans le code actuel** qu'un test existe ailleurs que ce fichier unique — vérifié par recherche exhaustive de `*.test.ts` sur l'ensemble du dépôt.

## 10. Confrontation avec la spec

La spec ne traite d'aucun des neuf fichiers de configuration eux-mêmes — elle décrit un comportement fonctionnel, pas une chaîne d'outillage. **Aucun écart spec/code** n'est possible par construction pour cette catégorie de fichiers : les points déjà croisés avec la spec l'ont été aux volumes où leurs effets observables sont visibles (Volume 1 pour l'exigence « responsive mobile » qui motive `server.host: true`, Volume 5 pour le déploiement à service unique qui motive l'asymétrie de build API/frontend).

## 11. Résumé du sous-chapitre et clôture du Volume 18

| Fichier | Rôle en une phrase |
|---|---|
| `package.json` (racine) | Orchestrateur du monorepo (workspaces, scripts `dev`/`build`/`test`, configuration Prisma CLI) |
| `apps/api/package.json` | Dépendances serveur — jamais compilé, exécuté directement via `tsx` |
| `apps/api/tsconfig.json` | TypeScript serveur — `noEmit`, `include` couvrant aussi `packages/shared` et `prisma/seed.ts` |
| `apps/web/package.json` | Dépendances frontend — seul paquet réellement compilé (`vite build`) |
| `apps/web/tsconfig.json` | TypeScript frontend — types DOM, JSX moderne, alias `@/*` en miroir de Vite |
| `apps/web/vite.config.ts` | Bundler + serveur dev — découpage de chunks vendor délibérément sélectif, proxy `/api`+`/socket.io` (dev uniquement) |
| `apps/web/components.json` | Pilotage du générateur shadcn/ui — style, alias, variables CSS de thème |
| `packages/shared/package.json` | Paquet transversal consommé en source, jamais compilé séparément |
| `vitest.config.ts` (racine) | Découverte des tests sur tout le monorepo — un seul fichier de test existe à ce jour |

**Le Volume 18 est désormais clos** (4 sous-chapitres : 18a, 18b, 18c, 18d — 18 fichiers, aucun écart spec/code trouvé sur l'ensemble). Avec ce sous-chapitre, `MATRICE_DE_COUVERTURE.md` atteint **155/155 fichiers** à l'état « Vérifié » ou « En cours » — seul `packages/shared/src/index.ts` reste à l'état « En cours », cas particulier documenté depuis le Volume 11a (fichier transversal couvert domaine par domaine plutôt qu'en un seul passage, chacune de ses portions Niveau 1/2 étant elle-même intégralement expliquée dans son chapitre thématique). La priorité du livre bascule maintenant vers les Volumes 19 à 21 (Tests, performances, construction et déploiement).
