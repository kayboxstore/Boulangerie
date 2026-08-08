# Volume 11k-1 — Travailleurs : fiches et pointage

**Niveau de risque : 1 — Critique.** Traitement exhaustif. `apps/api/src/routes/travailleurs.ts` est, avec ses 985 lignes, le plus gros fichier de route du projet — ce livre le traite en **trois sous-chapitres** plutôt qu'un seul : ce premier volet couvre les fiches (CRUD), la délégation vers l'e-mail professionnel, et le pointage. Le Volume 11k-2 couvrira les absences et sanctions ; le Volume 11k-3, le plus sensible financièrement, couvrira le calcul de paie et les bulletins.

## Fiche d'identité (pour l'ensemble du Volume 11k)

| Fichier | Lignes | Rôle |
|---|---:|---|
| `apps/api/src/routes/travailleurs.ts` | 985 | Toutes les routes du module Travailleurs — fiches, e-mail pro, pointage, absences, sanctions, paie, bulletins |
| `apps/web/src/pages/Travailleurs.tsx` | 1054 | Écran principal : liste des fiches, pointage, absences, sanctions |
| `apps/web/src/components/PaieCard.tsx` | 516 | Carte de calcul de paie et génération de bulletins, traitée en détail au 11k-3 |

- **Qui les appelle** : `travailleursRouter` est monté sur `/api/travailleurs` dans `app.ts` ; `TravailleursPage` est affichée par la route `/travailleurs` de `App.tsx`, écriture réservée à l'Admin (secondaire ou Principal), lecture seule pour le DG.
- **Ce qu'ils appellent (ce sous-chapitre)** : `declencherEmailPro`/`verifierEmailPro` (`services/emailPro.ts`, la logique Cloudflare Email Routing déjà construite plus tôt dans le projet — non redétaillée ici, seulement son point d'appel) ; `busEvenements` (Volume 12).
- **Données modifiées (ce sous-chapitre)** : `Travailleur` (création, modification, suppression, champs e-mail pro), `Pointage` (création, modification, suppression).

## 5.1 Vue d'ensemble intuitive

> Roster du personnel, plus large que les seuls comptes Utilisateur : couvre aussi le personnel sans accès à l'application (ex. livreur, agent d'entretien).
> — `docs/spec-boulangerie.md`, section 3.18

Point à ne pas confondre, déjà entrevu au Volume 11d : un `Travailleur` n'est **pas** un `Utilisateur`. Le second est un compte de connexion (Volume 11b-11d) ; le premier est une fiche de personnel, qui peut exister **sans** compte de connexion associé (un livreur, un agent d'entretien), et qui peut optionnellement être **liée** à un compte existant (`utilisateurId`, nullable) — c'est cette liaison, précisément, qui permet à un membre du personnel connecté de consulter ses propres bulletins de paie (Volume 11k-3) sans avoir accès au module Travailleurs lui-même.

## 5.2 `versTravailleurDTO`, `validerDepartementGroupe`, `verifierCompteLie`

```ts
export const versTravailleurDTO = (t: TravailleurAvecCompte): TravailleurDTO => ({
  id: t.id, nom: t.nom, telephone: t.telephone, poste: t.poste,
  dateEmbauche: t.dateEmbauche.toISOString().slice(0, 10),
  compte: t.utilisateur, emailDestination: t.emailDestination,
  emailProAdresse: t.emailProAdresse, emailProStatut: t.emailProStatut as StatutEmailPro,
  emailProErreur: t.emailProErreur, departement: t.departement, groupe: t.groupe,
  salaireMensuel: t.salaireMensuel, joursTravaillesParMois: t.joursTravaillesParMois,
});
```

Notez que `versTravailleurDTO` et `INCLUDE_TRAVAILLEUR` sont **exportés** (`export const`) — un cas rare dans ce livre jusqu'ici, où chaque fichier de route garde généralement ses fonctions de conversion privées. La raison : ils sont réimportés par d'autres routes du même module (les routes e-mail pro, §5.4, ont besoin de reconvertir un `Travailleur` après une mise à jour effectuée par `services/emailPro.ts`).

```ts
async function validerDepartementGroupe(departementId, groupeId) {
  if (!departementId) return { departementId: null, groupeId: null };
  const departement = await prisma.departement.findUnique({ where: { id: departementId } });
  if (!departement) return { status: 404, erreur: "Département introuvable" };
  if (!groupeId) return { departementId, groupeId: null };
  const groupe = await prisma.groupe.findUnique({ where: { id: groupeId } });
  if (!groupe) return { status: 404, erreur: "Groupe introuvable" };
  if (groupe.departementId !== departementId) {
    return { status: 400, erreur: "Le groupe sélectionné n'appartient pas à ce département" };
  }
  return { departementId, groupeId };
}
```

Une fonction de validation métier (pas seulement de forme, contrairement à Zod) : elle garantit qu'un `Groupe` sélectionné appartient réellement au `Département` sélectionné — les deux sont des entités séparées (traitées en détail au Volume 18, Niveau 2), et rien au niveau du schéma Prisma n'empêche, en théorie, d'envoyer un `groupeId` valide mais appartenant à un autre département. Cette fonction ferme cette possibilité. Sa signature de retour (un type « union » — soit `{ status, erreur }`, soit les identifiants validés) est un motif déjà rencontré dans ce livre (`verifierCompteLie` juste en dessous, ou `avanceAvantCommande`-like patterns) : le type de retour indique lui-même, par sa forme, s'il s'agit d'un succès ou d'un échec, sans exception levée.

```ts
async function verifierCompteLie(utilisateurId: string, ignorerTravailleurId?: string) {
  const compte = await prisma.utilisateur.findUnique({ where: { id: utilisateurId } });
  if (!compte) return { status: 404, erreur: "Compte utilisateur introuvable" };
  const dejaLie = await prisma.travailleur.findUnique({ where: { utilisateurId } });
  if (dejaLie && dejaLie.id !== ignorerTravailleurId) {
    return { status: 409, erreur: `Ce compte est déjà lié à la fiche de ${dejaLie.nom}` };
  }
  return null;
}
```

`Travailleur.utilisateurId` est `@unique` dans le schéma (§5.1) — un compte ne peut être lié qu'à une seule fiche. Cette fonction le vérifie explicitement avant l'écriture plutôt que de laisser la contrainte SQL échouer avec une erreur technique brute. Le paramètre `ignorerTravailleurId` sert uniquement lors d'une **modification** (§5.3) : sans lui, mettre à jour une fiche déjà liée à son propre compte serait à tort détecté comme un conflit avec elle-même.

## 5.3 CRUD des fiches : création, modification, suppression

La création (`POST /`) et la modification (`PUT /:id`) suivent le même schéma : valider le corps (Zod), vérifier la cohérence du lien de compte (`verifierCompteLie`) et du département/groupe (`validerDepartementGroupe`), puis écrire. Une nuance de `PUT /:id` mérite d'être relevée :

```ts
const departementFinal = departementId !== undefined ? departementId : existant.departementId;
const groupeFinal = groupeId !== undefined ? groupeId : existant.groupeId;
const depGroupe = await validerDepartementGroupe(departementFinal, groupeFinal);
```

`travailleurUpdateSchema` (§5.1) distingue explicitement, pour ces champs, `undefined` (champ absent de la requête — ne pas y toucher) de `null` (retirer explicitement la valeur). Puisqu'une requête `PUT` peut ne modifier qu'un seul champ (par exemple, juste le téléphone) sans reformuler intégralement département et groupe, la route reconstitue d'abord la paire département/groupe **résultante** — en partant de l'existant pour tout champ non transmis — avant de la revalider dans son ensemble avec `validerDepartementGroupe`. Sans cette étape, modifier un champ sans rapport pourrait, dans un cas limite, resoumettre une combinaison département/groupe déjà incohérente sans jamais la revérifier.

```ts
// La suppression retire aussi pointages/absences/sanctions (cascade, purement
// opérationnel) — la fiche fait foi. Les bulletins de paie, eux, sont un
// historique officiel (mêmes principe que les commandes d'un client, voir
// clients.ts) : jamais supprimés silencieusement avec la fiche.
travailleursRouter.delete("/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  const travailleur = await prisma.travailleur.findUnique({ where: { id: req.params.id }, include: { _count: { select: { bulletinsPaie: true } } } });
  if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });
  if (travailleur._count.bulletinsPaie > 0) {
    return res.status(409).json({ erreur: `Suppression impossible : ${travailleur._count.bulletinsPaie} bulletin(s) de paie enregistré(s) pour ce travailleur` });
  }
  await prisma.travailleur.delete({ where: { id: travailleur.id } });
  res.status(204).end();
});
```

Un point d'histoire du projet, documenté explicitement dans la spécification elle-même : *« Correction apportée après coup : la suppression n'effectuait initialement aucune vérification »* (section 3.18). Cette vérification par `_count` (une agrégation Prisma qui compte les bulletins liés sans les charger entièrement) est donc un **correctif**, pas le comportement d'origine — exactement le même schéma que la faille de sécurité corrigée sur `POST /equipe/:id/principal` documentée au Volume 11d : le livre note ici, comme là-bas, qu'il s'agit d'un comportement corrigé plutôt que de laisser croire que la protection a toujours existé. Notez que **seuls les bulletins de paie bloquent la suppression** — les pointages, absences et sanctions, purement opérationnels, sont supprimés en cascade sans aucune vérification, cohérent avec le principe déjà énoncé pour les Commandes/Clients (Volume 11h) : un historique *officiel* (bulletin de paie, commande client) ne disparaît jamais silencieusement ; une donnée *opérationnelle* peut l'être.

**Détail d'implémentation à connaître** : le schéma Prisma déclare en réalité `onDelete: Cascade` sur **les quatre** relations (`Pointage`, `Absence`, `Sanction`, **et** `BulletinPaie`) depuis `Travailleur` — la base de données, livrée à elle-même, autoriserait donc une suppression en cascade des bulletins aussi. C'est la vérification applicative de cette route (`_count.bulletinsPaie > 0` → `409`), et elle seule, qui empêche ce cas en pratique — puisque `DELETE /:id` est le seul endroit du code qui appelle `prisma.travailleur.delete`. La protection réelle n'est donc pas une contrainte de base de données, mais une règle de code, à ne jamais contourner en appelant Prisma directement ailleurs dans le projet.

## 5.4 Adresse e-mail professionnelle — délégation, pas duplication

```ts
travailleursRouter.post("/:id/email-pro", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  const travailleur = await prisma.travailleur.findUnique({ where: { id: req.params.id } });
  if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });
  const parsed = emailProCreerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ erreur: parsed.error.issues[0]?.message ?? "Données invalides" });
  const maj = await declencherEmailPro(travailleur, parsed.data.emailDestination);
  const complet = await prisma.travailleur.findUnique({ where: { id: maj.id }, include: INCLUDE_TRAVAILLEUR });
  res.status(201).json({ travailleur: versTravailleurDTO(complet!) });
});

travailleursRouter.post("/:id/email-pro/verifier", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  const travailleur = await prisma.travailleur.findUnique({ where: { id: req.params.id } });
  if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });
  const resultat = await verifierEmailPro(travailleur);
  if (resultat.erreur) return res.status(resultat.status ?? 400).json({ erreur: resultat.erreur });
  const complet = await prisma.travailleur.findUnique({ where: { id: resultat.travailleur.id }, include: INCLUDE_TRAVAILLEUR });
  res.json({ travailleur: versTravailleurDTO(complet!) });
});
```

Ces deux routes sont volontairement minces : elles vérifient seulement que la fiche visée existe, valident le corps si nécessaire, puis **délèguent l'intégralité de la logique** à `declencherEmailPro`/`verifierEmailPro` (`apps/api/src/services/emailPro.ts`) — le mécanisme d'intégration Cloudflare Email Routing, construit et déjà opérationnel dans ce dépôt avant la rédaction de ce livre. Ce fichier de service, ainsi que `lib/cloudflareEmail.ts` qu'il utilise, sont classés Niveau 2 dans `INVENTAIRE_DU_PROJET.md` et traités en détail au Volume 18 — ce chapitre n'explique que **le point d'appel côté Travailleurs**, pas l'intégration Cloudflare elle-même, pour éviter une double explication entre deux chapitres. Le champ `emailProStatut` (`TravailleurDTO`, §5.2 : « en attente de vérification / actif / échec ») reflète l'état renvoyé par ce service, affiché tel quel sur la fiche.

## 5.5 Pointage — l'horodatage fait foi, jamais une « date »

> Pointage : horodatage réel d'entrée et de sortie (date + heure, pas juste une date) — gère nativement les équipes de nuit qui commencent un jour et finissent le lendemain
> — `docs/spec-boulangerie.md`, section 3.18

Le choix de conception central de ce modèle, souligné en commentaire dans le code lui-même : `Pointage.horodatageEntree`/`horodatageSortie` sont des `DateTime` complets, jamais réduits à une simple date. Une équipe qui commence à 22h un jour et termine à 6h le lendemain n'a besoin d'aucun traitement spécial — les deux horodatages, comparés directement, restent cohérents sans qu'aucune logique de « jour de travail » distincte du jour calendaire n'ait à être inventée.

```ts
travailleursRouter.post("/pointages", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  const parsed = pointageCreerSchema.safeParse(req.body);
  ...
  const { travailleurId, horodatageEntree, horodatageSortie } = parsed.data;
  const travailleur = await prisma.travailleur.findUnique({ where: { id: travailleurId } });
  if (!travailleur) return res.status(404).json({ erreur: "Travailleur introuvable" });
  if (horodatageSortie && new Date(horodatageSortie) <= new Date(horodatageEntree)) {
    return res.status(400).json({ erreur: "L'horodatage de sortie doit être postérieur à l'horodatage d'entrée" });
  }
  const pointage = await prisma.pointage.create({ data: { travailleurId, horodatageEntree: new Date(horodatageEntree), horodatageSortie: horodatageSortie ? new Date(horodatageSortie) : null, enregistreParId: req.utilisateur!.id }, include: INCLUDE_POINTAGE });
  res.status(201).json({ pointage: versPointageDTO(pointage) });
});
```

`horodatageSortie` est **optionnel** dans le schéma de création (`pointageCreerSchema`, §5.1) — un pointage peut être créé « ouvert » (la personne est encore en poste, on ne connaît pas encore l'heure de sortie) aussi bien que déjà complet (saisie après coup d'un pointage déjà terminé). La seule contrainte : si une sortie est fournie, elle doit être strictement postérieure à l'entrée.

```ts
travailleursRouter.put("/pointages/:id", requirePermission("TRAVAILLEURS", "ECRITURE"), async (req, res, next) => {
  const parsed = pointageModifierSchema.safeParse(req.body);
  ...
  const existant = await prisma.pointage.findUnique({ where: { id: req.params.id } });
  if (!existant) return res.status(404).json({ erreur: "Pointage introuvable" });
  const { horodatageEntree, horodatageSortie } = parsed.data;
  const entreeFinale = horodatageEntree ? new Date(horodatageEntree) : existant.horodatageEntree;
  const sortieFinale = horodatageSortie === undefined ? existant.horodatageSortie : horodatageSortie ? new Date(horodatageSortie) : null;
  if (sortieFinale && sortieFinale <= entreeFinale) return res.status(400).json({ erreur: "..." });
  ...
});
```

Le champ `horodatageSortie` de `pointageModifierSchema` est `nullable().optional()` — trois états distincts, chacun avec un sens différent : **absent** (`undefined`, champ non transmis) laisse la sortie existante intacte ; **`null`** (transmis explicitement) **rouvre** un pointage déjà clôturé, en retirant sa sortie ; une **valeur** ferme ou corrige la sortie. `sortieFinale = horodatageSortie === undefined ? existant.horodatageSortie : horodatageSortie ? new Date(horodatageSortie) : null` encode ces trois cas en une seule expression conditionnelle imbriquée — une lecture attentive s'impose : le premier `?:` teste `undefined` explicitement (`===`, pas une simple négation, pour bien distinguer de `null`), le second teste la valeur elle-même une fois qu'on sait qu'elle n'est pas `undefined`.

## 5.6 Côté client — fiches et pointage dans `TravailleursPage`

L'écran combine plusieurs sections dans une seule page (pas d'onglets séparés au niveau du routeur — une différence avec d'autres modules de ce livre) : liste des fiches, pointages filtrés, absences filtrées (Volume 11k-2), plus les composants partagés `PanneauEmailPro` (Volume 18), `DepartementsCard` (Volume 18) et `PaieCard` (Volume 11k-3).

Le formulaire de fiche (`dialogFiche`) et le formulaire de pointage (`dialogPointage`) suivent le schéma déjà vu de nombreuses fois dans ce livre (état local, mutation TanStack Query, erreur affichée dans le formulaire). Deux détails propres au pointage méritent d'être relevés :

```tsx
function versInputLocal(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function versISO(valeurLocale: string): string {
  return new Date(valeurLocale).toISOString();
}
```

Un `<input type="datetime-local">` HTML natif attend et renvoie une chaîne **sans indication de fuseau**, interprétée implicitement dans le fuseau du navigateur — alors que l'API attend et renvoie du ISO 8601 complet (avec fuseau, en pratique toujours UTC une fois sérialisé par `toISOString()`). `versInputLocal` convertit un ISO serveur vers ce que le champ peut afficher (en corrigeant l'écart de fuseau via `getTimezoneOffset()`, pour que l'heure affichée soit bien l'heure locale de l'utilisateur, pas l'heure UTC brute) ; `versISO` fait l'inverse au moment de soumettre. Sans cette paire de fonctions, un utilisateur dans un fuseau différent de UTC verrait un horodatage décalé par rapport à ce qu'il a réellement saisi.

```tsx
const cloturerMaintenant = useMutation({
  mutationFn: (id: string) => api(`/api/travailleurs/pointages/${id}`, { method: "PUT", body: JSON.stringify({ horodatageSortie: new Date().toISOString() }) }),
  onSuccess: rafraichir,
  onError: (e) => toastErreur(e instanceof Error ? e.message : t("travailleurs.clockInError")),
});
```

Un raccourci d'un clic pour clôturer un pointage encore ouvert avec l'heure actuelle, sans ouvrir le formulaire complet — un appel direct à `PUT /pointages/:id` avec uniquement `horodatageSortie` renseigné (donc `horodatageEntree` reste `undefined`, intact côté serveur, §5.5).

## 5.7 Cas limites

| Situation | Comportement |
|---|---|
| Lier un compte déjà lié à une autre fiche | `409`, avec le nom de la fiche déjà liée (§5.2, `verifierCompteLie`). |
| Sélectionner un groupe n'appartenant pas au département choisi | `400`, explicitement rejeté (§5.2, `validerDepartementGroupe`). |
| Modifier seulement le téléphone d'une fiche avec département/groupe déjà cohérents | La combinaison département/groupe existante est reconstituée et revalidée quand même (§5.3). |
| Supprimer une fiche ayant au moins un bulletin de paie | `409`, suppression bloquée (§5.3) — même si le schéma Prisma autoriserait la cascade. |
| Supprimer une fiche sans bulletin, mais avec pointages/absences/sanctions | Autorisé, cascade silencieuse sur ces trois entités opérationnelles (§5.3). |
| Créer un pointage sans heure de sortie | Autorisé — pointage « ouvert » (§5.5). |
| Modifier un pointage avec `horodatageSortie: null` | Rouvre le pointage (retire la sortie existante) (§5.5). |
| Heure de sortie antérieure ou égale à l'heure d'entrée | `400`, à la création comme à la modification (§5.5). |
| Équipe de nuit (entrée un jour, sortie le lendemain) | Aucun traitement spécial requis — l'horodatage complet gère nativement le cas (§5.5). |

## 5.8 Croisement avec la spécification

Aucun écart trouvé sur ce sous-chapitre. La fiche (nom, téléphone, poste, date d'embauche, lien optionnel vers un compte), le pointage en horodatage complet gérant nativement les équipes de nuit, et la règle de suppression bloquée par les bulletins de paie mais pas par les données opérationnelles correspondent exactement à la section 3.18. Le mécanisme e-mail professionnel correspond également à la section 3.18 — vérifié uniquement au niveau du point d'appel dans ce fichier, le détail de l'intégration Cloudflare elle-même étant traité au Volume 18.

## 5.9 Résumé

Ce premier volet du Volume 11k pose les bases du module Travailleurs — une fiche de personnel plus large que les comptes de connexion, avec deux garde-fous de cohérence (compte déjà lié, groupe hors de son département) et une règle de suppression asymétrique entre historique officiel (bulletins, jamais supprimés silencieusement) et données opérationnelles (pointages/absences/sanctions, supprimées sans ménagement). Le pointage lui-même mise entièrement sur l'horodatage complet pour éviter toute logique spéciale sur les équipes de nuit. Aucun écart avec la spécification.

---

**Suite →** Volume 11k-2 — Absences et sanctions, qui réutilise le même pattern d'alerte paresseuse déjà vu au Volume 11h pour les dettes non payées.
