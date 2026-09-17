# Volume 11l — Infrastructure transversale : fuseau Lomoto et idempotence des écritures

**Niveau de risque : 1 — Critique.** Chapitre ajouté le 20/08/2026, comblant une lacune identifiée lors de la révision générale du livre du 19/08/2026 (voir `ETAT_DE_PROGRESSION.md`, §2 bis et §5) : ces trois fichiers étaient déjà cités et partiellement expliqués **à l'usage** par plusieurs chapitres (11j-caisse.md, 11z-6-cycle-livraison.md) depuis leur écriture, mais n'avaient encore aucun chapitre qui leur soit propre. Contrairement aux autres chapitres transversaux groupés de ce livre (18b, par exemple, qui rassemble quatre fichiers de support Niveau 3 sans lien fonctionnel entre eux), les trois fichiers ici sont réunis parce qu'ils sont **effectivement utilisés ensemble**, dans les mêmes routes, pour les mêmes écritures financières — ce n'est pas un regroupement de convenance.

## Fiche d'identité des fichiers couverts

| Fichier | Lignes | Rôle |
|---|---:|---|
| `apps/api/src/lib/temps.ts` | 46 | Fuseau opérationnel unique (`Africa/Kinshasa`) : jour civil, bornes de journée, arithmétique de date, valeur SQL stable |
| `apps/api/src/lib/idempotence.ts` | 148 | Déduplication des écritures sensibles côté serveur, appuyée sur une contrainte d'unicité en base |
| `apps/web/src/lib/idempotence.ts` | 52 | Génération et réutilisation de la clé côté client, pour les écrans qui déclenchent ces écritures |

- **Qui les appelle** : `lib/temps.ts` est importé par tous les modules qui raisonnent en jour civil de la boutique plutôt qu'en horodatage brut — `routes/caisse.ts` (Volume 11j, l'appelant historique), `routes/production.ts` (Volume 11z-2), `routes/commandes.ts` (Volume 11h), `routes/rapports.ts` (Volume 11z-5), `services/planificateurAlertes.ts`. `lib/idempotence.ts` (serveur) est appelé par les 7 points d'écriture financière recensés au §4 ; son pendant client par les composants qui déclenchent ces mêmes écritures (`Caisse.tsx`, `Commandes.tsx`, `DialogAcceptationCycle.tsx`).
- **Ce qu'ils appellent** : `lib/temps.ts` n'a aucune dépendance applicative — seulement `Intl.DateTimeFormat` (natif) et `estDateISOValide` (`packages/shared`). `lib/idempotence.ts` (serveur) appelle `prisma.$transaction` (isolation `Serializable`) et le modèle `OperationIdempotente`. Le fichier client n'appelle que `crypto.randomUUID()` (Web Crypto, disponible nativement dans tous les navigateurs ciblés).
- **Données modifiées** : `OperationIdempotente` (créée puis mise à jour dans la même transaction que l'écriture métier qu'elle protège) — le seul modèle de données propre à ce chapitre. `lib/temps.ts` ne touche aucune donnée : c'est une bibliothèque de fonctions pures.

## 1. `lib/temps.ts` — un seul fuseau, jamais celui du serveur

```ts
export const FUSEAU_LOMOTO = "Africa/Kinshasa" as const;
const DECALAGE_KINSHASA_MS = 60 * 60 * 1000; // Kinshasa reste à UTC+1 toute l'année

export function jourLomoto(instant: Date = new Date()): string {
  const parties = formateurJour.formatToParts(instant); // Intl.DateTimeFormat("fr-CA", { timeZone: FUSEAU_LOMOTO, ... })
  return `${valeur("year")}-${valeur("month")}-${valeur("day")}`;
}

export function bornesJourLomoto(jour: string = jourLomoto()): [Date, Date] {
  const debutMs = Date.UTC(annee, mois - 1, date) - DECALAGE_KINSHASA_MS;
  return [new Date(debutMs), new Date(debutMs + UN_JOUR_MS - 1)];
}

export function dateSQLDepuisJourLomoto(jour: string): Date {
  return new Date(`${jour}T00:00:00.000Z`);
}
```

Le problème que ce fichier résout est un piège classique : `new Date()` et `Date.prototype.getDate()`/`getHours()` en JavaScript côté serveur répondent selon le **fuseau du processus Node**, pas selon celui de la boutique — et ce fuseau serveur dépend entièrement de l'hébergeur (Render, dans ce projet, tourne en UTC par défaut ; un changement d'hébergeur ou de configuration pourrait le faire varier silencieusement). Sans ce fichier, « le jour d'aujourd'hui » calculé au serveur pourrait décaler d'une heure — ou d'un jour entier, tard le soir — par rapport au jour réellement vécu à Kinshasa, faussant tout ce qui se raisonne « par jour » : le registre de Caisse (Volume 11j), les commandes du jour (Volume 11h), le résumé de clôture (Volume 11z-5). `jourLomoto` contourne le problème en passant explicitement `timeZone: "Africa/Kinshasa"` à `Intl.DateTimeFormat` — l'API de fuseau la plus fiable disponible nativement en JavaScript, sans dépendance externe (pas de `date-fns-tz` ni `luxon` dans ce projet).

**Kinshasa n'a pas d'heure d'été** (`DECALAGE_KINSHASA_MS` est une constante, `60 * 60 * 1000`, jamais recalculée) — un choix qui simplifie `bornesJourLomoto` en un simple décalage arithmétique plutôt qu'un calcul dépendant du calendrier, mais qui suppose explicitement que ce décalage ne changera jamais. Le commentaire du code l'assume ouvertement plutôt que de le cacher derrière une bibliothèque de fuseaux qui gérerait le cas général sans que personne n'ait besoin d'y penser.

**Trois fonctions, trois usages distincts** — reprenant exactement la distinction déjà posée au Volume 11j §5.2, généralisée ici à tout le reste du projet :

- **`jourLomoto(instant?)`** — convertit un horodatage (ou « maintenant » par défaut) en jour civil `AAAA-MM-JJ`. Utilisée aussi bien en lecture (déterminer le jour d'aujourd'hui) qu'en écriture (formater une date déjà stockée pour une réponse JSON).
- **`bornesJourLomoto(jour?)`** — donne les deux horodatages UTC exacts (`[début, fin]`, tous deux inclusifs) d'un jour civil de Kinshasa, pour borner une requête Prisma sur une colonne `DateTime` classique (horodatage complet — `CommandeClient.dateCreation`, `PaiementCommande.date`). **Vérifié par test** (`temps.test.ts`) : le jour bascule à `23:00:00.000Z` (23h UTC = minuit à Kinshasa, UTC+1), pas à minuit UTC — la bascule la plus fréquemment mal implémentée dans ce genre de code.
- **`dateSQLDepuisJourLomoto(jour)`** — convertit un jour civil en la valeur exacte à stocker dans une colonne `@db.Date` (un vrai type SQL `DATE`, sans composante horaire — `TauxDuJour.date`, `SessionCaisse.date`...). Toujours minuit UTC pour cette date précise, jamais les bornes d'un intervalle : ces colonnes stockent un jour, pas une plage.

**`decalerJourLomoto(jour, nombreDeJours)`** — une quatrième fonction exportée, testée (`temps.test.ts`, y compris un cas d'année bissextile : `decalerJourLomoto("2024-02-28", 1) === "2024-02-29"`), mais **jamais appelée par aucune route ni aucun service** à ce jour (recherche exhaustive : `decalerJourLomoto` n'apparaît que dans sa propre déclaration et dans son test). Ni une erreur ni du code mort au sens strict — une fonction utilitaire écrite et vérifiée par avance, prête pour un futur besoin (ex. « hier », « demain » dans un futur écran), signalée ici plutôt que passée sous silence.

## 2. `lib/idempotence.ts` (serveur) — dédupliquer via une contrainte d'unicité, pas via un cache

```ts
export async function executerEcritureIdempotente<TValeur, TCorps>(
  req: Request, portee: string, donnees: unknown,
  executer: (tx: TxClient) => Promise<TValeur>,
  versReponse: (valeur: TValeur) => ReponseEcriture<TCorps>,
): Promise<ResultatEcriture<TValeur, TCorps>> {
  const cle = lireCleIdempotence(req);
  if (!cle) {
    // Pas de clé : comportement d'avant ce mécanisme, transaction simple, jamais mémorisée.
    const valeur = await prisma.$transaction(executer, { isolationLevel: Serializable });
    return { ...versReponse(valeur), valeur, rejoue: false };
  }

  const empreinte = empreinteIdempotence(portee, donnees);
  const dejaFaite = await retrouver<TCorps>(utilisateurId, portee, cle, empreinte);
  if (dejaFaite) return dejaFaite; // rejeu : ne rappelle jamais `executer`

  try {
    return await prisma.$transaction(async (tx) => {
      const operation = await tx.operationIdempotente.create({ data: { utilisateurId, portee, cle, empreinte, statutHttp: 0, reponse: {} } });
      const valeur = await executer(tx);
      const reponse = versReponse(valeur);
      await tx.operationIdempotente.update({ where: { id: operation.id }, data: { statutHttp: reponse.statutHttp, reponse: reponse.corps } });
      return { ...reponse, valeur, rejoue: false };
    }, { isolationLevel: Serializable });
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      // Course perdue : une autre requête a créé la ligne en premier — relire son résultat.
      const concurrente = await retrouver<TCorps>(utilisateurId, portee, cle, empreinte);
      if (concurrente) return concurrente;
    }
    throw erreur;
  }
}
```

### 2.1 Le modèle `OperationIdempotente` — une contrainte d'unicité comme verrou de course

```prisma
model OperationIdempotente {
  id            String      @id @default(cuid())
  utilisateurId String
  utilisateur   Utilisateur @relation(fields: [utilisateurId], references: [id], onDelete: Cascade)
  portee        String
  cle           String
  empreinte     String
  statutHttp    Int
  reponse       Json
  createdAt     DateTime    @default(now())

  @@unique([utilisateurId, portee, cle])
  @@index([createdAt])
}
```

`portee` distingue les espaces de noms (`"POST:/api/caisse/depenses"`, `"POST:/api/commandes"`...) — la même valeur de `Idempotency-Key`, envoyée par deux utilisateurs différents ou pour deux routes différentes, ne collisionne jamais (l'unicité porte sur le triplet `utilisateurId` + `portee` + `cle`, pas sur `cle` seule). `empreinte` (voir §2.2) est stockée pour détecter une réutilisation frauduleuse ou accidentelle de la même clé avec un contenu différent. `statutHttp`/`reponse` mémorisent exactement ce qui sera rejoué — pas seulement « ça a réussi », mais la réponse HTTP complète, au corps près.

**Le point le plus important du fichier** : la ligne `OperationIdempotente` n'est pas créée *après* l'écriture métier réussie, pour l'enregistrer — elle est créée *avant*, avec `statutHttp: 0` et `reponse: {}` comme valeurs provisoires, **dans la même transaction** `Serializable` que l'écriture métier elle-même. C'est cette insertion précoce qui joue le rôle du verrou : si une seconde requête, portant la même `Idempotency-Key`, arrive presque simultanément, sa propre tentative de `create` sur `OperationIdempotente` va se heurter à la contrainte `@@unique([utilisateurId, portee, cle])` déjà engagée par la première transaction — Postgres la fait attendre, puis échoue avec le code `P2002` (violation de contrainte unique) une fois la première transaction validée. Le `catch` relit alors la ligne désormais commitée par la gagnante (`retrouver`) et renvoie sa réponse — la perdante de la course **ne rejoue jamais l'écriture métier**, elle se contente de récupérer le résultat de l'autre. Aucun verrou explicite (`SELECT ... FOR UPDATE`), aucun cache en mémoire, aucune dépendance externe (Redis, etc.) : la garantie tient entièrement sur une contrainte d'unicité SQL ordinaire, combinée à l'isolation `Serializable` de la transaction.

### 2.2 `empreinteIdempotence` — une clé n'est valide qu'avec UN SEUL contenu

```ts
function canonique(valeur: unknown): unknown {
  if (valeur === null || typeof valeur !== "object") return valeur;
  if (Array.isArray(valeur)) return valeur.map(canonique);
  return Object.fromEntries(
    Object.keys(valeur).filter((cle) => valeur[cle] !== undefined).sort().map((cle) => [cle, canonique(valeur[cle])]),
  );
}
export function empreinteIdempotence(portee: string, donnees: unknown): string {
  return createHash("sha256").update(JSON.stringify({ portee, donnees: canonique(donnees) })).digest("hex");
}
```

`canonique` trie récursivement les clés de tout objet (et neutralise les champs `undefined`) avant sérialisation JSON — sans ce tri, `{ montant: 10, motif: "x" }` et `{ motif: "x", montant: 10 }` produiraient deux chaînes JSON différentes, donc deux empreintes SHA-256 différentes, alors qu'ils représentent la même écriture. **Vérifié par test** (`idempotence.test.ts`) : les deux ordres produisent bien la même empreinte ; une portée différente ou une seule valeur différente en produit une différente. Cette empreinte n'est **jamais** la clé elle-même (la clé vient du client, §3) — elle sert uniquement à détecter un cas d'abus ou d'erreur : si la même `Idempotency-Key` revient avec un contenu différent, `retrouver()` lève `CLE_IDEMPOTENCE_REUTILISEE` (409) plutôt que de rejouer une réponse qui ne correspond pas à la nouvelle demande, ou pire, d'écraser silencieusement l'ancienne opération.

### 2.3 Compatibilité ascendante — l'en-tête reste optionnel, sauf une exception

`lireCleIdempotence` renvoie `null` (pas une erreur) quand l'en-tête `Idempotency-Key` est absent — la branche `if (!cle)` de `executerEcritureIdempotente` retombe alors sur une transaction `Serializable` ordinaire, jamais mémorisée : **exactement le comportement d'avant l'introduction de ce mécanisme** (vague C2, mi-août). C'était une nécessité au moment de l'introduire (des clients déjà déployés n'envoyaient pas encore l'en-tête) et cela reste vrai aujourd'hui — **6 des 7 points d'appel** (§4) laissent la clé facultative. La seule exception : `POST /cycles-livraison/:id/transitions` avec l'action `CONFIRMER_ACCEPTATION` (Volume 11z-6) vérifie `lireCleIdempotence(req)` **avant** d'appeler `executerEcritureIdempotente`, et rejette explicitement (`400 CLE_IDEMPOTENCE_INVALIDE`) toute tentative sans en-tête — cohérent avec le fait que cette action, seule de tout le projet, peut créer une `CommandeClient` en argent réel à partir d'une confirmation de livraison, un enjeu jugé suffisant pour rendre la protection obligatoire plutôt que facultative.

Si l'en-tête est présent mais mal formé (hors de `/^[A-Za-z0-9._:-]{8,128}$/`), `lireCleIdempotence` lève `400 CLE_IDEMPOTENCE_INVALIDE` immédiatement, avant toute transaction — jamais une clé invalide silencieusement ignorée.

## 3. `lib/idempotence.ts` (client) — décider quand une clé doit changer

```ts
export function resoudreCleIdempotence(precedent: EtatIdempotence | null, empreinte: string): EtatIdempotence {
  if (precedent && precedent.empreinte === empreinte) return precedent; // rejeu : même clé
  return { cle: genererCleIdempotence(), empreinte }; // nouvelle opération : nouvelle clé
}
export function useCleIdempotence(): (empreinte: string) => string {
  const precedent = useRef<EtatIdempotence | null>(null);
  return (empreinte: string) => {
    const resolue = resoudreCleIdempotence(precedent.current, empreinte);
    precedent.current = resolue;
    return resolue.cle;
  };
}
```

**Deux notions distinctes portent le même mot « empreinte » de part et d'autre de la frontière réseau — à ne pas confondre.** Côté serveur (§2.2), c'est un hachage SHA-256 opaque, calculé sur des données déjà canonicalisées, qui sert de garde-fou contre la réutilisation abusive d'une clé. Côté client, c'est simplement une **sérialisation JSON du corps** fournie telle quelle par l'appelant (`JSON.stringify(corps)`, sans tri ni hachage) — comparée par égalité stricte de chaîne (`precedent.empreinte === empreinte`) pour décider, non pas de la validité d'une clé, mais de s'il faut en générer une **nouvelle**. `genererCleIdempotence()` produit un UUID v4 (`crypto.randomUUID()`) — la clé elle-même n'a donc **aucun rapport structurel** avec le contenu qu'elle protège, contrairement à l'empreinte serveur qui, elle, en dérive directement.

Le principe : une nouvelle opération (formulaire vidé et resaisi, cible différente) doit toujours recevoir une clé neuve — sinon deux écritures réellement distinctes se confondraient sous un seul identifiant, et le serveur rejetterait la seconde avec `CLE_IDEMPOTENCE_REUTILISEE` (409) plutôt que de l'exécuter. À l'inverse, un rejeu strictement identique (double-clic avant que le bouton ne se désactive, retry réseau après un timeout apparent côté client) doit réutiliser exactement la même clé — sinon le mécanisme serveur ne verrait jamais deux requêtes portant la même clé, et ne pourrait donc jamais les dédupliquer. `useCleIdempotence()` est un simple habillage React de cette décision (`useRef` portant la tentative précédente), pour éviter de dupliquer ce `useRef`/`resoudreCleIdempotence` dans chaque composant qui déclenche une écriture protégée — généralisé le 19/08/2026 (plan d'action de l'audit) à 5 mutations supplémentaires, initialement réservé à la seule confirmation d'acceptation d'un cycle de livraison (`DialogAcceptationCycle.tsx`, premier usage historique de ce mécanisme, Volume 11z-6).

**Piège explicitement évité par la conception** : le corps envoyé au serveur (`body: JSON.stringify(corps)`) et la chaîne utilisée pour calculer l'empreinte client ne sont **pas nécessairement identiques**. Sur la remise de caisse et la confirmation de règlements (Volume 11j §5.12-5.13), l'empreinte inclut l'identifiant de la session ciblée (`sessionId`) — absent du corps envoyé, déjà porté par l'URL — pour qu'une saisie identique sur une **autre** session ne réutilise jamais par erreur la clé d'une remise précédente. L'appelant construit ces deux chaînes séparément ; `useCleIdempotence` ne fait aucune supposition sur leur relation.

## 4. Les 7 points d'appel — inventaire complet

| Route | Fichier | Clé obligatoire ? | Chapitre |
|---|---|:---:|---|
| `POST /api/commandes` | `routes/commandes.ts` | Non | Volume 11h |
| `POST /api/commandes/:id/reglements` | `routes/commandes.ts` | Non | Volume 11h |
| `POST /api/caisse/depenses` | `routes/caisse.ts` | Non | Volume 11j §5.5 |
| `POST /api/caisse/sessions` | `routes/caisse.ts` | Non | Volume 11j §5.10 |
| `POST /api/caisse/sessions/:id/remises` | `routes/caisse.ts` | Non | Volume 11j §5.12 |
| `POST /api/caisse/sessions/:id/confirmer-reglements` | `routes/caisse.ts` | Non | Volume 11j §5.13 |
| `POST /api/production/cycles-livraison/:id/transitions` (action `CONFIRMER_ACCEPTATION` uniquement) | `routes/cycles-livraison.ts` | **Oui** | Volume 11z-6 §4 |

Recherche exhaustive dans `apps/api/src/routes/*.ts` : aucun autre appelant de `executerEcritureIdempotente` à ce jour. Côté client, `useCleIdempotence` est appliqué aux 6 premières lignes de ce tableau (`Commandes.tsx`, `Caisse.tsx`) plus `DialogAcceptationCycle.tsx` pour la 7ᵉ — une couverture client désormais complète face à la couverture serveur.

## 5. Cas limites

| Situation | Comportement |
|---|---|
| Bascule de jour à Kinshasa (23h00 UTC) | `jourLomoto` change de valeur exactement à cet instant, pas à minuit UTC (§1, vérifié par test). |
| Requête sans en-tête `Idempotency-Key`, sur une route où elle est facultative | Transaction simple, jamais mémorisée — comportement identique à avant l'introduction du mécanisme (§2.3). |
| `CONFIRMER_ACCEPTATION` sans en-tête | `400 CLE_IDEMPOTENCE_INVALIDE` — seule exception où la clé est obligatoire (§2.3). |
| En-tête présent mais mal formé (hors `[A-Za-z0-9._:-]{8,128}`) | `400 CLE_IDEMPOTENCE_INVALIDE`, avant toute transaction. |
| Même clé, même corps (même empreinte), rejouée | Réponse mémorisée renvoyée telle quelle, `executer` jamais rappelé, en-tête `Idempotency-Replayed: true` ajouté. |
| Même clé, corps différent (empreinte différente) | `409 CLE_IDEMPOTENCE_REUTILISEE` — la seconde tentative est rejetée, pas exécutée. |
| Deux requêtes portant la même clé, réellement simultanées | Une seule exécute l'écriture métier (gagne la contrainte d'unicité) ; l'autre reçoit `P2002`, relit la ligne gagnante et renvoie la même réponse (§2.1). |
| Côté client, resoumission d'un formulaire dont le contenu a changé entre-temps | Nouvelle empreinte → nouvelle clé générée → traité comme une opération distincte par le serveur, jamais rejeté (§3). |
| `decalerJourLomoto` | Fonction exportée et testée, mais non appelée par le code applicatif actuel (§1) — pas une erreur, une capacité en réserve. |

## 6. Observation — aucune purge de `OperationIdempotente`

`@@index([createdAt])` existe sur le modèle, mais recherche exhaustive dans `apps/api/src` : aucun job planifié (`planificateurAlertes.ts`, `planificateurSauvegarde.ts`) ni aucune route n'efface jamais de ligne `OperationIdempotente`. La table grandit donc indéfiniment, d'une ligne par écriture protégée effectuée avec un en-tête — pour une boulangerie de taille modeste (2 à 5 utilisateurs), le volume reste marginal à l'échelle de plusieurs années, mais l'index sur `createdAt`, actuellement inutilisé par aucune requête du code, suggère qu'une purge par ancienneté a été anticipée sans être implémentée. Observation de qualité de code, comparable à celles déjà rassemblées au Volume 25 (Possibilités d'évolution) — non corrigée ici, modification du code applicatif hors périmètre de ce chapitre.

## 7. Croisement avec la spécification

`docs/spec-boulangerie.md` ne mentionne l'idempotence par son nom nulle part — la section 3.1 (Caisse) décrit le comportement métier attendu (« un second envoi sur la même date met à jour la valeur » pour le taux, par exemple) sans jamais prescrire le mécanisme technique qui le protège contre un double-clic ou un retry réseau. Ce n'est pas un écart : la spec documente le comportement voulu de l'application, pas le choix d'implémentation qui le rend robuste à la concurrence — un `Idempotency-Key` HTTP est un détail d'implémentation, au même titre que le choix de Prisma ou d'Express eux-mêmes, dont la spec ne parle pas non plus. Le fuseau horaire, en revanche, **est** prescrit implicitement par la spec à travers ses très nombreuses références à « aujourd'hui », « le jour », « la date » — toutes cohérentes avec un fonctionnement à l'heure de Kinshasa, jamais contredites par `lib/temps.ts`. Aucun écart trouvé.

## 8. Résumé

Ce chapitre referme la dernière lacune de couverture identifiée lors de la révision générale du 19/08/2026 : deux fichiers utilisés depuis plusieurs semaines par les modules les plus sensibles du projet (Caisse, Commandes, Cycle de livraison) sans jamais avoir eu leur propre traitement. Le mécanisme d'idempotence illustre un principe déjà croisé ailleurs dans ce livre — préférer une garantie portée par la base de données elle-même (une contrainte d'unicité) à un mécanisme applicatif plus complexe et plus fragile (verrou en mémoire, cache externe) — pendant que `lib/temps.ts` illustre l'inverse : parfois, la solution la plus sûre à un problème de fuseau horaire n'est pas une bibliothèque supplémentaire, mais une seule fonction native (`Intl.DateTimeFormat`) appliquée avec constance à travers tout le projet. Aucun écart avec la spécification.

---

**Suite →** Ce chapitre clôt, à la connaissance de ce livre au 20/08/2026, l'ensemble des lacunes de couverture connues (`ETAT_DE_PROGRESSION.md`, §5). Toute reprise future resterait un travail d'entretien face à l'évolution du code, pas la poursuite d'un manque déjà identifié.
