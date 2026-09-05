# Volume 11k-2 — Travailleurs : absences et sanctions

**Niveau de risque : 1 — Critique.** Deuxième volet du Volume 11k. Ce sous-chapitre couvre les absences (déclaration, décision, alerte paresseuse) et les sanctions — deux entités qui alimenteront directement le calcul de paie détaillé au Volume 11k-3.

## Fiche d'identité (voir Volume 11k-1 pour la table complète)

Ce sous-chapitre couvre les sections `// --- Absence` et `// --- Sanction` de `apps/api/src/routes/travailleurs.ts`, ainsi que les sections correspondantes de `apps/web/src/pages/Travailleurs.tsx`.

- **Ce qu'il appelle** : `busEvenements.emettreEvenement` (Volume 12) ; le même mécanisme d'alerte paresseuse que `verifierAlertesDette` (Volume 11h, `routes/commandes.ts`) — réutilisé, pas redéfini, mais réimplémenté séparément dans ce fichier (aucune fonction partagée entre les deux, voir §5.2).
- **Données modifiées** : `Absence` (création, décision, suppression), `Sanction` (création, suppression).

## 5.1 Absence — déclaration et décision, deux actes distincts

> Absence : motif déclaré + décision distincte (justifiée / non justifiée / en attente), tranchée par l'Admin secondaire ou Principal — pas le chef de département (purement organisationnel)
> — `docs/spec-boulangerie.md`, section 3.18

Le modèle sépare volontairement **deux actes qui peuvent être posés par des personnes différentes, à des moments différents** : la déclaration initiale (quelqu'un signale une absence, avec un motif) et la décision (un Admin tranche si cette absence est justifiée, non justifiée, ou reste en attente). Le commentaire du code le confirme explicitement à propos de la route de décision : *« sans exiger que ce soit une personne différente de celle qui a déclaré l'absence »* — les deux actes sont distincts par leur nature, pas nécessairement par leur auteur.

```ts
// Déclaration initiale : motif + date, decisionStatut démarre à EN_ATTENTE
// (jamais choisi ici — c'est la route de décision, plus bas, qui la tranche).
travailleursRouter.post("/absences", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  const parsed = absenceDeclarerSchema.safeParse(req.body);
  ...
  const { travailleurId, date, motif } = parsed.data;
  const travailleur = await prisma.travailleur.findUnique({ where: { id: travailleurId } });
  if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });
  const absence = await prisma.absence.create({ data: { travailleurId, date: new Date(date), motif, declareParId: req.utilisateur!.id }, include: INCLUDE_ABSENCE });
  res.status(201).json({ absence: versAbsenceDTO(absence) });
});
```

Remarquez ce que ce schéma **ne permet pas de faire** : `absenceDeclarerSchema` ne contient pas de champ `decisionStatut` — il n'existe donc aucun moyen, via cette route, de déclarer une absence *déjà* décidée. `decisionStatut` prend systématiquement sa valeur par défaut du schéma Prisma (`EN_ATTENTE`) à la création — un choix de conception qui force le passage par les deux actes séparément, jamais un raccourci qui fusionnerait les deux.

```ts
// Décision : acte distinct de la déclaration [...] Notifie en temps réel quand
// la décision est NON_JUSTIFIEE (le travailleur concerné, s'il a un compte, + les Admins).
travailleursRouter.put("/absences/:id/decision", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  const parsed = absenceDecisionSchema.safeParse(req.body);
  ...
  const existant = await prisma.absence.findUnique({ where: { id: req.params.id }, include: INCLUDE_ABSENCE });
  if (!existant) return res.status(404).json({ erreur: "Absence introuvable" });
  const absence = await prisma.absence.update({ where: { id: existant.id }, data: { decisionStatut: parsed.data.decisionStatut, decideParId: req.utilisateur!.id, dateDecision: new Date() }, include: INCLUDE_ABSENCE });

  if (parsed.data.decisionStatut === "NON_JUSTIFIEE") {
    const autresAdmins = await prisma.utilisateur.findMany({ where: { actif: true, id: { not: req.utilisateur!.id }, role: { nom: ROLE_ADMINISTRATEUR } }, select: { id: true } });
    const destinataires = new Set(autresAdmins.map((a) => a.id));
    const travailleurConcerne = await prisma.travailleur.findUnique({ where: { id: existant.travailleurId } });
    if (travailleurConcerne?.utilisateurId) destinataires.add(travailleurConcerne.utilisateurId);
    if (destinataires.size > 0) {
      busEvenements.emettreEvenement({ type: "ABSENCE_NON_JUSTIFIEE", module: "TRAVAILLEURS", emetteurId: req.utilisateur!.id, evenementRef: absence.id, priorite: "HAUTE", destinataireIdsDirects: [...destinataires], message: `Absence de ${absence.travailleur.nom} le ${absence.date.toISOString().slice(0, 10)} tranchée non justifiée`, donnees: { absenceId: absence.id, travailleurId: absence.travailleur.id } });
    }
  }
  res.json({ absence: versAbsenceDTO(absence) });
});
```

Cette route peut prendre trois valeurs de décision (`EN_ATTENTE`, `JUSTIFIEE`, `NON_JUSTIFIEE`) — techniquement, rien n'empêche de la rappeler pour revenir en arrière ou changer d'avis, la route ne vérifie aucun état antérieur avant d'écrire (contrairement, par exemple, à l'approbation d'une demande critique, Volume 11f, qui refuse de retraiter une demande déjà décidée). Seule la valeur `NON_JUSTIFIEE` déclenche une notification, avec un **ensemble de destinataires construit dynamiquement** : tous les autres Admins actifs (excluant l'auteur de la décision lui-même, via `id: { not: req.utilisateur!.id }`), **plus**, si le travailleur concerné a un compte de connexion lié, ce compte précis — pour qu'il soit informé que sa propre absence a été jugée non justifiée. L'usage d'un `Set` (`destinataires`) garantit qu'un même destinataire n'apparaît jamais deux fois, même dans le cas limite où le travailleur concerné serait lui-même l'un des « autres Admins » (un Admin peut théoriquement avoir une fiche Travailleur liée à son propre compte).

## 5.2 L'alerte « absence en attente » — même schéma que Commandes, appliqué séparément

```ts
async function verifierAlertesAbsenceEnAttente(): Promise<void> {
  const debut = debutAujourdhui();
  const enAttente = await prisma.absence.findMany({ where: { decisionStatut: "EN_ATTENTE", date: { lt: debut }, alerteEnvoyeeLe: null }, include: { travailleur: { select: { nom: true } } }, take: 200 });
  for (const a of enAttente) {
    const { count } = await prisma.absence.updateMany({ where: { id: a.id, alerteEnvoyeeLe: null }, data: { alerteEnvoyeeLe: new Date() } });
    if (count !== 1) continue;
    busEvenements.emettreEvenement({ type: "ABSENCE_EN_ATTENTE", module: "TRAVAILLEURS", emetteurId: null, evenementRef: a.id, priorite: "HAUTE", restreindreAuxRoles: [ROLE_ADMINISTRATEUR], message: `Absence de ${a.travailleur.nom} le ${a.date.toISOString().slice(0, 10)} toujours en attente de décision`, donnees: { absenceId: a.id, travailleurId: a.travailleurId } });
  }
}
```

Le commentaire du code renvoie lui-même explicitement au mécanisme déjà expliqué en détail au Volume 11h (`verifierAlertesDette`, `routes/commandes.ts`) : *« même pattern exact [...] pas de tâche planifiée, `updateMany` gardé sur `alerteEnvoyeeLe: null` en compare-and-set atomique pour ne jamais renvoyer deux fois »*. La logique est identique trait pour trait — sélectionner les absences en attente antérieures à aujourd'hui et jamais encore notifiées, tenter un `updateMany` gardé sur la même condition (compare-and-set, Glossaire), n'émettre l'événement que si `count === 1`. Ce chapitre ne redérive donc pas cette mécanique (déjà expliquée en détail, avec le raisonnement sur la concurrence, au Volume 11h §5.6) — seule une différence est à signaler :

**`restreindreAuxRoles: [ROLE_ADMINISTRATEUR]`** — contrairement à l'alerte de dette (qui cible tous les rôles ayant lecture sur `COMMANDES`), cette alerte est **restreinte au seul rôle Administrateur** malgré le fait que le DG a également une lecture sur `TRAVAILLEURS` (matrice de permissions, Volume 11d). Le commentaire du code le précise sans ambiguïté : *« restreint aux Admins (secondaire + Principal) — pas le DG, qui a pourtant lecture sur Travailleurs »*. C'est cohérent avec la spec, qui parle explicitement de « l'Admin secondaire et Principal » pour ce rappel — une restriction plus fine que le simple critère de permission, appliquée délibérément via un mécanisme de ciblage par rôle plutôt que par module.

```ts
travailleursRouter.get("/alertes-absence", requirePermission("TRAVAILLEURS", "LECTURE"), async (_req, res, next) => {
  await verifierAlertesAbsenceEnAttente();
  const debut = debutAujourdhui();
  const enAttente = await prisma.absence.findMany({ where: { decisionStatut: "EN_ATTENTE", date: { lt: debut } }, include: { travailleur: { select: { nom: true } } }, orderBy: { date: "asc" }, take: 100 });
  const alertes: AlerteAbsenceDTO[] = enAttente.map((a) => ({ absenceId: a.id, travailleurNom: a.travailleur.nom, motif: a.motif, date: a.date.toISOString().slice(0, 10), joursDepuis: Math.max(1, Math.floor((debut.getTime() - a.date.getTime()) / 86_400_000)), alerteEnvoyeeLe: a.alerteEnvoyeeLe?.toISOString() ?? null }));
  res.json({ alertes });
});
```

Même distinction déjà vue au Volume 11h entre déclenchement de la vérification (une fois) et affichage de la liste complète (à chaque appel, sans filtrer sur `alerteEnvoyeeLe`) : la cloche ne sonne qu'une fois par absence, mais la liste des absences en attente reste visible dans l'écran tant qu'aucune décision n'est prise, qu'une alerte ait déjà été envoyée ou non. Notez, côté frontend (§5.4), que cette route est appelée avec `enabled: editable` — seuls les rôles en écriture (les Admins) déclenchent réellement cette vérification en la consultant, cohérent avec le fait que seuls eux peuvent trancher une décision.

## 5.3 Sanction — motif, type, et un montant réservé aux retenues

> Sanction (nouveau, distincte des déductions automatiques pour absence) : punition ou retenue disciplinaire déclarée sur une fiche — motif, date, et un montant uniquement pour une retenue (jamais pour une punition non financière).
> — `docs/spec-boulangerie.md`, section 3.18

```ts
travailleursRouter.post("/sanctions", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  const parsed = sanctionCreateSchema.safeParse(req.body);
  ...
  const { travailleurId, type, motif, date, montant } = parsed.data;
  const travailleur = await prisma.travailleur.findUnique({ where: { id: travailleurId } });
  if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });
  const sanction = await prisma.sanction.create({ data: { travailleurId, type, motif, date: new Date(date), montant: montant ?? null, enregistreParId: req.utilisateur!.id }, include: INCLUDE_SANCTION });
  res.status(201).json({ sanction: versSanctionDTO(sanction) });
});
```

Le champ `type` (`PUNITION` ou `RETENUE`, l'énumération `TypeSanction`) détermine si `montant` a un sens. La route elle-même ne fait **aucune vérification croisée** entre `type` et `montant` — c'est `sanctionCreateSchema` (`packages/shared`, non reproduit intégralement ici) qui porte cette règle de cohérence au niveau de la validation, avant même d'atteindre la route : une sanction de type `PUNITION` avec un `montant` renseigné, ou une `RETENUE` sans `montant`, est rejetée en amont par Zod. Cette répartition — la route ne fait que vérifier l'existence du travailleur, le schéma partagé porte la cohérence des champs entre eux — est le même principe déjà rencontré à plusieurs reprises dans ce livre (Volume 15, à venir, pour une synthèse transversale).

**Pourquoi c'est important pour le calcul de paie (Volume 11k-3)** : seules les sanctions de type `RETENUE` (avec leur `montant`) seront soustraites du salaire net — une `PUNITION` (avertissement écrit, mise à pied non payée traitée par ailleurs, etc.) n'a, par construction du modèle, aucun montant à soustraire, donc aucun effet automatique sur la paie.

## 5.4 Côté client — absences dans `TravailleursPage`

Les dialogues de déclaration d'absence (`dialogAbsence`) et de décision suivent le même schéma déjà établi (état local, mutation, erreur dans le formulaire) — non détaillés ligne à ligne ici. Un badge de statut (`BADGE_DECISION`, une table de correspondance `StatutDecisionAbsence → classes CSS`) colore chaque absence selon sa décision (couleur neutre pour `EN_ATTENTE`, teinte dorée pour `JUSTIFIEE`, teinte terracotta pleine pour `NON_JUSTIFIEE`) — un motif de badge déjà rencontré à plusieurs reprises dans ce livre (`BadgeStatut` des approbations, Volume 11f ; badges du Journal d'audit, Volume 11g), toujours construit comme une simple table de correspondance statut → style, jamais une logique conditionnelle répétée dans le JSX.

**Précision sur l'emplacement du code** : contrairement aux fiches et au pointage (Volume 11k-1), l'interface des **sanctions** ne vit pas dans `TravailleursPage` mais dans `PaieCard.tsx` — un composant distinct, monté sur la page Travailleurs mais responsable à la fois des sanctions et du calcul de paie (Volume 11k-3). Ce regroupement n'est pas arbitraire : les sanctions de type `RETENUE` alimentent directement le calcul de paie affiché dans la même carte, juste en dessous.

## 5.5 Cas limites

| Situation | Comportement |
|---|---|
| Déclarer une absence | `decisionStatut` démarre systématiquement à `EN_ATTENTE`, aucun raccourci pour la déclarer déjà décidée (§5.1). |
| Décider une absence, plusieurs fois de suite | Aucune vérification d'état antérieur — chaque appel écrase la décision précédente (§5.1). |
| Décision « Non justifiée » sur une absence d'un travailleur sans compte lié | Notification envoyée aux seuls Admins (le `Set` de destinataires ne contient que les Admins) (§5.1). |
| Rappel d'absence en attente | Restreint aux Admins malgré la lecture du DG sur `TRAVAILLEURS` — différence volontaire avec l'alerte de dette (§5.2). |
| Sanction de type `PUNITION` avec un montant fourni | Rejetée par le schéma Zod partagé, avant d'atteindre la route (§5.3). |
| Sanction de type `RETENUE` sans montant | Rejetée de la même façon (§5.3). |

## 5.6 Croisement avec la spécification

Aucun écart trouvé. La séparation déclaration/décision, la restriction de la décision aux Admins (jamais le chef de département), le rappel ponctuel non répété une fois envoyé, sa restriction aux seuls Admins malgré la lecture du DG, et la règle « montant uniquement pour une retenue » correspondent tous exactement à la section 3.18.

## 5.7 Résumé

Ce deuxième volet complète les entrées du calcul de paie à venir : les absences non justifiées et les sanctions de type retenue sont les deux seules sources de déduction automatique, chacune avec ses propres règles de déclaration/décision ou de validation. L'alerte d'absence en attente réutilise, sans le redéfinir, le principe déjà expliqué en détail pour les dettes non payées (Volume 11h) — avec une restriction de destinataires plus fine, propre à ce module. Aucun écart avec la spécification.

---

**Suite →** Volume 11k-3 — Calcul de paie et bulletins, le sous-chapitre le plus sensible financièrement de tout le module Travailleurs, avec exemple chiffré complet.
