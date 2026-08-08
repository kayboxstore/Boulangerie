# Volume 11k-3 — Calcul de paie et bulletins

**Niveau de risque : 1 — Critique.** Traitement exhaustif, ligne à ligne, avec exemple chiffré complet — c'est le sous-chapitre le plus sensible financièrement de tout le module Travailleurs : de l'argent réel dû à une personne réelle, calculé automatiquement à partir des absences et sanctions déjà couvertes au Volume 11k-2.

## Fiche d'identité (voir Volume 11k-1 pour la table complète)

Ce sous-chapitre couvre les sections `// --- Calcul de paie` et `// --- Bulletin de paie` de `apps/api/src/routes/travailleurs.ts`, et l'intégralité de `apps/web/src/components/PaieCard.tsx` (516 lignes, incluant l'interface des sanctions, Volume 11k-2, regroupée ici pour la raison expliquée au §5.4 du volet précédent).

- **Ce qu'il appelle** : `aAcces` (Volume 11a, pour l'accès personnel aux bulletins) ; `construirePdf`/`nomFichierPdf` (`services/pdf.ts`, le mécanisme d'export PDF déjà utilisé ailleurs dans le projet — par exemple pour le Bon de livraison — non redétaillé ici, traité au Volume 18).
- **Données modifiées** : `BulletinPaie` (création uniquement — **jamais** de modification ni de suppression exposée par aucune route).

## 5.1 Vue d'ensemble intuitive

> Calcul de paie (nouveau), par Travailleur et par mois : salaire de base (salaireMensuel) − retenue pour absences non justifiées de ce mois (nombre de jours × taux journalier) − retenues disciplinaires (somme des Sanction de type retenue de ce mois) = salaire net. Aucun arrondi intermédiaire : le calcul reste en précision complète jusqu'au résultat final, arrondi au Fc le plus proche une seule fois.
> — `docs/spec-boulangerie.md`, section 3.18

Deux idées à retenir avant le détail du code : (1) le calcul de paie est, comme les Commissions et la Caisse (volumes 11i, 11j), une **vue recalculée**, jamais stockée pour un mois « courant » — il n'existe aucun modèle Prisma « FichePaie » ou « CalculMensuel » ; (2) le **bulletin**, lui, est l'exception : une fois généré, il devient un **instantané figé**, la seule trace écrite et permanente de ce calcul à un instant donné. Cette distinction — calcul dynamique d'un côté, instantané figé de l'autre — structure tout ce chapitre.

## 5.2 `calculerPaieBrute` — la fonction centrale, factorisée une seule fois

```ts
// AUCUN arrondi intermédiaire : tauxJournalier et retenueAbsences restent en
// précision complète (décimales) pour que la somme des lignes affichées
// corresponde exactement au détail. Seul salaireNet est arrondi (au Fc le
// plus proche), une seule fois, à la toute fin. Factorisé ici : réutilisé à
// la fois par la vue dynamique (GET .../paie) et par la génération d'un
// Bulletin de paie (instantané figé, plus bas).
async function calculerPaieBrute(travailleurId: string, salaireMensuel: number, joursTravaillesParMois: number, mois: string) {
  const debut = new Date(`${mois}-01T00:00:00.000Z`);
  const fin = new Date(debut);
  fin.setUTCMonth(fin.getUTCMonth() + 1);

  const absences = await prisma.absence.findMany({ where: { travailleurId, decisionStatut: "NON_JUSTIFIEE", date: { gte: debut, lt: fin } }, orderBy: { date: "asc" } });
  const sanctions = await prisma.sanction.findMany({ where: { travailleurId, type: "RETENUE", date: { gte: debut, lt: fin } }, orderBy: { date: "asc" } });

  const tauxJournalier = salaireMensuel / joursTravaillesParMois;
  const retenueAbsences = absences.length * tauxJournalier;
  const totalRetenuesDisciplinaires = sanctions.reduce((s, x) => s + (x.montant ?? 0), 0);
  const salaireNet = Math.round(salaireMensuel - retenueAbsences - totalRetenuesDisciplinaires);

  return { absences, sanctions, tauxJournalier, retenueAbsences, totalRetenuesDisciplinaires, salaireNet };
}
```

**Le bornage du mois** : `debut` est le premier instant du mois demandé, en UTC explicite (`${mois}-01T00:00:00.000Z` — `mois` étant déjà au format `AAAA-MM`, validé par le schéma `moisISO`, §5.5) ; `fin` est calculé en **ajoutant un mois entier** à `debut` via `setUTCMonth(fin.getUTCMonth() + 1)`, plutôt que d'essayer de calculer « le dernier jour du mois » (un piège classique, puisque les mois n'ont pas tous le même nombre de jours — `setUTCMonth` gère cela nativement : ajouter un mois à n'importe quelle date du mois M produit toujours la même date du mois M+1, quel que soit le nombre de jours de M). Le filtre `date: { gte: debut, lt: fin }` (borne de fin **exclusive**, `lt` et non `lte`) capture ainsi exactement les 28, 29, 30 ou 31 jours du mois, sans avoir à connaître ce nombre à l'avance. Le commentaire du code confirme au passage la cohérence de ce choix : `Absence.date` et `Sanction.date` sont des colonnes `@db.Date` pures — sans fuseau, exactement comme `TauxDuJour.date` au Volume 11j.

**Le filtre `decisionStatut: "NON_JUSTIFIEE"`** est la traduction directe, en une seule ligne, de la règle de la spec : *« Seules les absences au statut "non justifiée" sont retenues — une absence en attente ou justifiée n'a aucun impact »*. Une absence encore `EN_ATTENTE` ou déjà `JUSTIFIEE` (Volume 11k-2) n'entre jamais dans ce calcul, quel que soit son nombre.

**Le filtre `type: "RETENUE"`** sur les sanctions exclut, symétriquement, toute `PUNITION` — cohérent avec la règle déjà vue au Volume 11k-2 : seule une sanction de type retenue peut porter un montant, donc seule elle peut avoir un effet financier ici.

**La règle de précision, la plus importante de ce fichier** : `tauxJournalier` et `retenueAbsences` sont laissés en JavaScript `number` à virgule flottante, **sans aucun arrondi** — contrairement à toutes les autres grandeurs financières rencontrées jusqu'ici dans ce livre (Volume 11a : « Fc, toujours stocké en nombre entier »). C'est une exception délibérée et documentée, propre à ce calcul précis : arrondir `tauxJournalier` avant de le multiplier par le nombre de jours d'absence introduirait une petite erreur cumulative qui ferait que la somme des lignes détaillées affichées à l'écran ne correspondrait plus exactement au total. `Math.round` n'intervient **qu'une seule fois**, à la toute dernière étape, sur `salaireNet` — le seul montant qui doit, in fine, être un nombre entier de Francs congolais (l'argent réellement remis ne peut pas se découper en fraction de franc).

## 5.3 `GET /:id/paie` — le calcul dynamique

```ts
travailleursRouter.get("/:id/paie", requirePermission("TRAVAILLEURS", "LECTURE"), async (req, res, next) => {
  const parsedMois = moisISO.safeParse(req.query.mois);
  if (!parsedMois.success) return res.status(400).json({ erreur: "Mois invalide (AAAA-MM attendu, ex. 2026-02)" });
  const mois = parsedMois.data;

  const travailleur = await prisma.travailleur.findUnique({ where: { id: req.params.id } });
  if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });
  if (travailleur.salaireMensuel === null || travailleur.joursTravaillesParMois === null) {
    return res.status(409).json({ erreur: "Le salaire mensuel et le nombre de jours travaillés doivent être renseignés sur la fiche avant de calculer la paie." });
  }

  const calcul = await calculerPaieBrute(travailleur.id, travailleur.salaireMensuel, travailleur.joursTravaillesParMois, mois);
  const dto: CalculPaieDTO = { travailleurId: travailleur.id, travailleurNom: travailleur.nom, mois, salaireMensuel: travailleur.salaireMensuel, joursTravaillesParMois: travailleur.joursTravaillesParMois, tauxJournalier: calcul.tauxJournalier, absencesNonJustifiees: calcul.absences.map((a) => ({ absenceId: a.id, date: a.date.toISOString().slice(0, 10), motif: a.motif })), retenueAbsences: calcul.retenueAbsences, sanctionsRetenues: calcul.sanctions.map((s) => ({ sanctionId: s.id, date: s.date.toISOString().slice(0, 10), motif: s.motif, montant: s.montant! })), totalRetenuesDisciplinaires: calcul.totalRetenuesDisciplinaires, salaireNet: calcul.salaireNet };
  res.json({ paie: dto });
});
```

Le **garde-fou** central de cette route, avant tout calcul : `salaireMensuel === null || joursTravaillesParMois === null` → `409`, avec un message explicite. Rappel du Volume 11k-1 (§5.1 du schéma) : ces deux champs sont **obligatoires pour toute nouvelle fiche**, mais restent nullable en base pour ne pas casser les fiches créées avant l'introduction de cette fonctionnalité — une fiche ancienne, jamais mise à jour, bloque donc silencieusement (avec un message, pas un plantage) tout calcul de paie tant que ces deux champs n'ont pas été renseignés a posteriori. Notez `s.montant!` (l'opérateur `!` de TypeScript, qui affirme au compilateur qu'une valeur n'est pas `null`) : sûr ici, puisque le filtre `type: "RETENUE"` de `calculerPaieBrute` ne peut renvoyer que des sanctions dont `montant` est garanti non nul par la règle de validation croisée du schéma partagé (Volume 11k-2, §5.3).

## 5.4 `POST /:id/bulletins-paie` — figer un instantané

```ts
// Génération : réservée à Admin secondaire/Principal, comme le reste du
// module. Chaque appel crée un NOUVEL instantané — aucune contrainte
// d'unicité sur (travailleurId, mois), régénérer ne modifie jamais un
// bulletin déjà émis.
travailleursRouter.post("/:id/bulletins-paie", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  const parsedMois = moisISO.safeParse(req.query.mois);
  ...
  const travailleur = await prisma.travailleur.findUnique({ where: { id: req.params.id } });
  if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });
  if (travailleur.salaireMensuel === null || travailleur.joursTravaillesParMois === null) return res.status(409).json({ erreur: "..." });

  const calcul = await calculerPaieBrute(travailleur.id, travailleur.salaireMensuel, travailleur.joursTravaillesParMois, mois);

  const bulletin = await prisma.bulletinPaie.create({
    data: {
      travailleurId: travailleur.id, mois,
      salaireMensuel: travailleur.salaireMensuel, joursTravaillesParMois: travailleur.joursTravaillesParMois,
      tauxJournalier: calcul.tauxJournalier,
      absencesNonJustifiees: calcul.absences.map((a) => ({ date: a.date.toISOString().slice(0, 10), motif: a.motif })),
      retenueAbsences: calcul.retenueAbsences,
      sanctionsRetenues: calcul.sanctions.map((s) => ({ date: s.date.toISOString().slice(0, 10), motif: s.motif, montant: s.montant! })),
      totalRetenuesDisciplinaires: calcul.totalRetenuesDisciplinaires, salaireNet: calcul.salaireNet,
      genereParId: req.utilisateur!.id,
    },
    include: INCLUDE_BULLETIN,
  });
  res.status(201).json({ bulletin: versBulletinDTO(bulletin) });
});
```

Cette route rappelle **exactement la même fonction** `calculerPaieBrute` que la vue dynamique (§5.3) — le calcul lui-même n'est jamais dupliqué, une seule implémentation, deux points d'usage (un motif de conception déjà rencontré au Volume 11f pour `EXECUTEURS`). Ce qui change ici : le résultat n'est plus seulement renvoyé, il est **écrit** dans `BulletinPaie`, avec deux champs supplémentaires — `absencesNonJustifiees` et `sanctionsRetenues` sont stockés en **JSON** (colonnes `Json` du schéma Prisma, §5.1 du Volume 11k-1), une **copie complète et indépendante** des lignes détaillées (date, motif, montant) plutôt qu'une simple référence vers les enregistrements `Absence`/`Sanction` d'origine.

**C'est ce choix — copier plutôt que référencer — qui rend le bulletin réellement immuable.** Si une décision d'absence était changée après coup (par exemple, une absence reclassée de `NON_JUSTIFIEE` à `JUSTIFIEE` à la suite d'un recours), ou si une sanction était supprimée, **aucun bulletin déjà généré n'en serait affecté** : les lignes qu'il contient sont une copie figée au moment de sa création, sans lien vivant vers les tables sources. Seul un **nouveau** calcul (vue dynamique, §5.3) ou un **nouveau** bulletin refléterait ce changement. Le commentaire du code le confirme sans ambiguïté : *« Chaque appel crée un NOUVEL instantané [...] régénérer ne modifie jamais un bulletin déjà émis »* — il n'existe même **aucune contrainte d'unicité** sur `(travailleurId, mois)`, ce qui rend explicitement possible d'avoir plusieurs bulletins pour le même travailleur et le même mois (par exemple, si un premier bulletin a été généré prématurément puis qu'un second est produit après une correction) : aucune de ces deux versions n'écrase l'autre, les deux restent consultables et téléchargeables.

## 5.5 Accès aux bulletins — lecture élargie, mais strictement personnelle

```ts
/**
 * Accès aux bulletins de paie (3.18) : un Admin (lecture TRAVAILLEURS) voit
 * tout ; un Travailleur avec compte lié voit UNIQUEMENT les siens — aucun
 * autre rôle, même un autre Travailleur avec compte, n'y accède. Vérification
 * manuelle (pas via requirePermission) car un compte sans aucun accès au
 * module Travailleurs doit tout de même pouvoir lire SES PROPRES bulletins.
 */
function peutConsulterBulletinsDe(req: Request, travailleur: { utilisateurId: string | null }): boolean {
  const permissions = req.utilisateur?.role.permissions ?? [];
  if (aAcces(permissions, "TRAVAILLEURS", "LECTURE")) return true;
  return !!req.utilisateur && travailleur.utilisateurId === req.utilisateur.id;
}
```

Cette fonction encode exactement, en deux lignes, la double condition de la spec (*« s'il a un compte Utilisateur lié, il peut consulter [...] ses propres bulletins [...] ; les Admins voient et génèrent ceux de tout le monde »*) : soit l'appelant a la lecture sur le module `TRAVAILLEURS` (réutilisant directement `aAcces`, Volume 11a, plutôt que le middleware `requirePermission`), soit il consulte les bulletins de la fiche **liée à son propre compte**. Le commentaire explique pourquoi ce n'est **pas** simplement `requirePermission("TRAVAILLEURS", "LECTURE")` posé sur la route : un Caissier(ère) ou un Chargé des commandes, qui n'a **aucun** accès au module Travailleurs dans sa matrice de permissions, doit malgré tout pouvoir consulter ses propres bulletins s'il a une fiche liée — un cas que `requirePermission`, à lui seul, ne pourrait jamais couvrir (il bloquerait tout le monde sans la permission `TRAVAILLEURS`, y compris pour ses propres données).

Trois routes exploitent cette fonction ou une variante :

```ts
// Raccourci pour le Travailleur connecté (fiche liée à son compte) : évite au
// frontend de devoir connaître son propre travailleurId. Ouvert à TOUT
// utilisateur authentifié — sans fiche liée, retourne simplement une liste
// vide (pas une erreur : rien à cacher, il n'y a rien à voir).
travailleursRouter.get("/mes-bulletins-paie", requireAuth, async (req, res, next) => {
  const travailleur = await prisma.travailleur.findUnique({ where: { utilisateurId: req.utilisateur!.id } });
  if (!travailleur) return res.json({ bulletins: [] });
  ...
});

// Liste : Admin (tous) ou le Travailleur concerné lui-même (les siens).
travailleursRouter.get("/:id/bulletins-paie", requireAuth, async (req, res, next) => {
  const travailleur = await prisma.travailleur.findUnique({ where: { id: req.params.id } });
  if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });
  if (!peutConsulterBulletinsDe(req, travailleur)) return res.status(403).json({ erreur: "Accès refusé : vous ne pouvez consulter que vos propres bulletins de paie" });
  ...
});
```

`GET /mes-bulletins-paie` (notez : montée avec `requireAuth` directement dans l'appel de route, en plus du `requireAuth` déjà posé globalement sur tout le routeur — une répétition sans effet, le middleware s'exécute deux fois mais reste idempotent) ne vérifie **aucune permission** au-delà de l'authentification : n'importe quel compte connecté peut l'appeler. Sa sécurité tient entièrement au fait qu'elle ne cherche **que** la fiche liée à `req.utilisateur!.id` — un compte sans fiche liée obtient simplement une liste vide, jamais les bulletins de quelqu'un d'autre. C'est un raccourci pratique pour le frontend, qui n'a pas besoin de connaître son propre `travailleurId` pour accéder à ses bulletins.

## 5.6 `GET /bulletins-paie/:bulletinId/pdf` — reconstruire, jamais recalculer

```ts
travailleursRouter.get("/bulletins-paie/:bulletinId/pdf", requireAuth, async (req, res, next) => {
  const bulletin = await prisma.bulletinPaie.findUnique({ where: { id: req.params.bulletinId }, include: { travailleur: { select: { id: true, nom: true, poste: true, utilisateurId: true, departement: { select: { nom: true } } } } } });
  if (!bulletin) return res.status(404).json({ erreur: "Bulletin introuvable" });
  if (!peutConsulterBulletinsDe(req, bulletin.travailleur)) return res.status(403).json({ erreur: "..." });

  const absences = bulletin.absencesNonJustifiees as { date: string; motif: string }[];
  const sanctions = bulletin.sanctionsRetenues as { date: string; motif: string; montant: number }[];

  const document: DocumentExportInput = {
    titre: `Bulletin de paie — ${bulletin.travailleur.nom}`,
    sousTitre: `${formatMoisLisible(bulletin.mois)} — ${bulletin.travailleur.poste}${bulletin.travailleur.departement ? ` — ${bulletin.travailleur.departement.nom}` : ""}`,
    modules: [],
    sections: [ /* Rémunération, Absences, Retenue absences, Retenues disciplinaires, Salaire net */ ],
  };
  const pdf = await construirePdf(document, req.utilisateur!.nom);
  ...
});
```

Le commentaire du code résume l'intention en une phrase : *« reconstruit le document UNIQUEMENT à partir des chiffres figés stockés (jamais un recalcul), pour que le PDF reste identique quels que soient les changements intervenus depuis la génération »*. Cette route ne touche **jamais** à `calculerPaieBrute` — elle lit uniquement les champs déjà écrits sur le `BulletinPaie` (y compris les colonnes JSON, retypées via `as` puisque Prisma les traite comme des `Json` génériques) et les met en forme pour l'export. `modules: []` (un tableau vide) est notable : contrairement à d'autres exports de ce projet (Commissions, Volume 11i), ce document n'est associé à aucun module particulier pour le filtrage d'accès du service PDF — cohérent avec le fait que l'accès est déjà entièrement tranché en amont par `peutConsulterBulletinsDe`, pas par le mécanisme générique d'export.

`formatMontantPdf` (`(n) => Number.isInteger(n) ? String(n) : n.toFixed(2)`) est une petite fonction d'affichage propre à ce PDF : la plupart des montants sont des entiers (`salaireMensuel`, `salaireNet`, chaque `montant` de sanction), mais `tauxJournalier` et `retenueAbsences` peuvent être décimaux (§5.2) — cette fonction affiche un entier sans décimale inutile (`"350000"`, pas `"350000.00"`), et un nombre décimal avec deux décimales (`"13461.54"`) uniquement quand c'en est réellement un.

## 5.7 Côté client — `PaieCard`

Le calcul de paie est piloté par deux sélecteurs indépendants (travailleur, mois) :

```tsx
const { data: paieData, error: paieErreur } = useQuery({
  queryKey: ["paie", paieTravailleurId, paieMois],
  queryFn: () => api<{ paie: CalculPaieDTO }>(`/api/travailleurs/${paieTravailleurId}/paie?mois=${paieMois}`),
  enabled: !!paieTravailleurId && !!paieMois,
  retry: false,
});
```

`retry: false` : contrairement au comportement par défaut de TanStack Query (qui retente automatiquement une requête échouée), cette requête ne retente **jamais** — cohérent avec le fait qu'un échec ici (`409`, salaire non renseigné) est un état métier stable, pas une panne réseau transitoire ; retenter automatiquement n'aurait aucune chance de succès tant que la fiche n'est pas complétée. L'erreur (`ApiError`, Volume 11b) est extraite et affichée directement (`messageErreurPaie`), reprenant tel quel le message explicite renvoyé par la route serveur.

Le téléchargement du PDF **ne passe pas** par le petit utilitaire `api()` habituel (Volume 11b) :

```tsx
// Le PDF revient en binaire : fetch direct + Authorization manuel plutôt
// que le helper JSON (même pattern que BarreExport.tsx).
const telechargerBulletin = useMutation({
  mutationFn: async (bulletinId: string) => {
    const res = await fetch(`/api/travailleurs/bulletins-paie/${bulletinId}/pdf`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) {
      const corps = await res.json().catch(() => null);
      throw new Error(corps?.erreur ?? t("travailleurs.paiePdfError"));
    }
    const blob = await res.blob();
    const nom = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "bulletin-paie.pdf";
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement("a");
    a.href = url;
    a.download = nom;
    a.click();
    URL.revokeObjectURL(url);
  },
  onError: (e) => toastErreur(e instanceof Error ? e.message : t("travailleurs.paiePdfError")),
});
```

`api()` (Volume 11b) suppose systématiquement une réponse JSON — inadapté ici, puisque la route renvoie un flux binaire PDF (`Content-Type: application/pdf`). Cette mutation appelle donc `fetch` directement, en reconstituant elle-même l'en-tête `Authorization` (via `getToken()`, exporté par `lib/api.ts`) que le helper aurait normalement ajouté automatiquement. Le nom de fichier suggéré par le serveur (`Content-Disposition`, Volume 11k-3 §5.6 côté serveur, `nomFichierPdf`) est extrait par une expression régulière plutôt que codé en dur côté client — si le serveur change sa convention de nommage, le client suit automatiquement. `URL.createObjectURL`/`URL.revokeObjectURL` : le blob binaire reçu est transformé en une URL temporaire locale au navigateur, utilisée pour déclencher un téléchargement (`a.click()` sur un lien invisible créé dynamiquement), puis immédiatement libérée (`revokeObjectURL`) pour ne pas laisser fuir de mémoire.

## 5.8 Exemple chiffré bout en bout

**Situation** : Jean, salaire mensuel 350 000 Fc, 26 jours travaillés par mois. En février 2026, il a deux absences tranchées `NON_JUSTIFIEE` (le 5 et le 18 février), et une sanction de type `RETENUE` de 10 000 Fc datée du 20 février (motif : matériel endommagé). Il a également une absence du 10 février encore `EN_ATTENTE`, et une sanction `PUNITION` du 12 février sans montant (avertissement écrit).

1. Un Admin ouvre `PaieCard`, sélectionne Jean et le mois `2026-02`.
2. `GET /api/travailleurs/<id>/paie?mois=2026-02`. `calculerPaieBrute` borne le mois : `debut = 2026-02-01T00:00:00.000Z`, `fin = 2026-03-01T00:00:00.000Z` (un mois entier ajouté, sans avoir à savoir que février 2026 compte 28 jours).
3. `absences = [5 février, 18 février]` — l'absence du 10 février est **exclue** (`EN_ATTENTE`, pas `NON_JUSTIFIEE`).
4. `sanctions = [20 février, 10000 Fc]` — la `PUNITION` du 12 février est **exclue** (`type !== "RETENUE"`).
5. `tauxJournalier = 350000 / 26 = 13461.538461538461...` (aucun arrondi).
6. `retenueAbsences = 2 × 13461.538461538461... = 26923.076923076922...`
7. `totalRetenuesDisciplinaires = 10000`.
8. `salaireNet = Math.round(350000 − 26923.076923076922... − 10000) = Math.round(313076.923076923...) = 313077`.
9. L'écran affiche : Salaire de base 350 000 Fc ; Taux journalier (26 jours) 13 461,54 Fc (arrondi **seulement à l'affichage**, la valeur interne reste complète) ; 2 absences non justifiées listées, retenue − 26 923,08 Fc ; 1 retenue disciplinaire listée (20 février, 10 000 Fc), total − 10 000 Fc ; **Salaire net : 313 077 Fc**.
10. L'Admin clique « Générer un bulletin ». `POST /api/travailleurs/<id>/bulletins-paie?mois=2026-02` — **exactement le même calcul**, rejoué à l'identique, écrit dans un nouveau `BulletinPaie` avec `salaireNet: 313077`, les deux lignes d'absences et la ligne de sanction copiées telles quelles en JSON.
11. Le lendemain, l'absence du 10 février est finalement tranchée `NON_JUSTIFIEE`. Le bulletin déjà généré la veille **n'est pas modifié** — il continue d'afficher 313 077 Fc, avec seulement ses deux absences d'origine. Si l'Admin consulte à nouveau la vue dynamique (§5.3) pour février, elle refléterait désormais trois absences et un salaire net inférieur — mais seul un **nouveau** bulletin capturerait ce chiffre à jour ; l'ancien reste l'archive fidèle de ce qui a été calculé et, vraisemblablement, déjà payé sur cette base.

## 5.9 Cas limites

| Situation | Comportement |
|---|---|
| Salaire ou jours travaillés non renseignés sur la fiche | `409`, calcul et génération de bulletin tous deux bloqués (§5.3, §5.4). |
| Absence en attente ou justifiée dans le mois | Aucun effet sur le calcul — seule `NON_JUSTIFIEE` compte (§5.2). |
| Sanction de type `PUNITION` dans le mois | Aucun effet sur le calcul — seule `RETENUE` compte (§5.2). |
| Régénérer un bulletin pour un mois déjà émis | Autorisé, crée un second instantané indépendant — aucune contrainte d'unicité (§5.4). |
| Décision d'absence ou sanction modifiée après génération d'un bulletin | Le bulletin déjà émis reste inchangé ; seul un nouveau calcul ou bulletin reflète le changement (§5.4, §5.8). |
| Compte sans aucun accès au module Travailleurs, mais avec fiche liée | Peut consulter ses propres bulletins (`GET /mes-bulletins-paie`, `GET /:id/bulletins-paie`, PDF) via `peutConsulterBulletinsDe` (§5.5). |
| Compte avec fiche liée tentant de consulter les bulletins d'un autre travailleur | `403`, même s'il a lui-même une fiche (§5.5). |
| Téléchargement PDF d'un bulletin | Reconstruit uniquement à partir des chiffres déjà figés — jamais un recalcul (§5.6). |

## 5.10 Croisement avec la spécification

Aucun écart trouvé. La formule (salaire de base − retenue absences − retenues disciplinaires = salaire net), la règle de précision (aucun arrondi intermédiaire, un seul arrondi final), le filtrage strict sur `NON_JUSTIFIEE` et `RETENUE`, le blocage explicite pour une fiche incomplète, l'immuabilité du bulletin une fois émis, et l'accès personnel aux bulletins pour un travailleur avec compte lié correspondent tous, point par point, à la section 3.18 de `docs/spec-boulangerie.md` — y compris la formulation quasi verbatim retrouvée dans les commentaires du code source lui-même.

## 5.11 Résumé du Volume 11k-3 (et clôture du Volume 11k)

Le calcul de paie applique, pour la première fois dans ce livre, une règle de précision inverse de celle vue partout ailleurs (Volume 11a : toujours des Fc entiers) — précision décimale complète jusqu'au tout dernier arrondi, pour que le détail affiché corresponde exactement au total. Le bulletin de paie est le seul document de ce module à rompre avec le principe « calcul recalculé à la lecture » déjà vu pour les Commissions et la Caisse : une fois généré, il devient une archive figée, copiée en JSON, immunisée contre tout changement ultérieur des absences ou sanctions qui l'ont nourri. L'accès à ces bulletins illustre un cas où la permission de module ne suffit pas : un mécanisme de vérification manuelle s'y ajoute pour qu'un employé sans aucun accès au module Travailleurs garde malgré tout la lecture de ses propres documents. Aucun écart avec la spécification.

Avec ce sous-chapitre, le **Volume 11k est clos** et les **26 fichiers Niveau 1** de ce livre sont désormais tous couverts.

---

**Suite →** Volume 13 — Base de données et migrations (ERD complet), puis les 66 fichiers Niveau 2 restants, en commençant par les fichiers déjà entrevus sans être détaillés dans ce volume (`services/emailPro.ts`, `lib/cloudflareEmail.ts`, `services/pdf.ts`, `Departement`/`Groupe`).
