# État par module — Audit du 4 septembre 2026

> Fait suite au registre d'écarts du livre technique (`docs/livre-complet/annexes/ecarts-spec-code.md`,
> arrêté au 20/08/2026) et à sa matrice de couverture (166/166 fichiers, 165 Vérifié + 1 En cours). Ce
> document ne les remplace pas : il synthétise leur contenu, le recroise avec les ~15 jours de commits
> fusionnés depuis (Lots P0/P1 de durcissement, éditeur de permissions de rôle, mise en place de
> Playwright), et tranche l'état de chaque module de la spec avec une preuve concrète.
>
> **Méthodologie** — chaque ligne porte un état parmi quatre, jamais deviné :
> - **Complet** : construit, atteignable depuis l'interface par le rôle qui en a l'écriture, cohérent avec la spec.
> - **Partiel** : une partie fonctionne, une partie manque ou reste inatteignable.
> - **Absent-délibéré** : rien n'est construit, et une décision documentée (commentaire de code, spec,
>   docs/coordination/) explique pourquoi — ce n'est pas un oubli.
> - **Absent-oublié** : rien ne documente pourquoi c'est absent — candidat réel à un futur lot de travail.
>
> Preuve = fichier(s) cité(s) ou renvoi au chapitre du livre technique qui l'a déjà établi (avec sa propre
> preuve). Une preuve « Non confirmé dans le code actuel » signale un point resté incertain après recherche —
> volontairement laissé tel quel plutôt que tranché à l'aveugle.

## Note méthodologique (point de départ de cet audit)

Une tentative récente de désigner un module « Prospect » comme priorité suivante s'est appuyée sur
`docs/coordination/PLAN_ATTAQUE_APPLICATION_LOMOTO.md` (audit du 12/08/2026, figé sur l'**ancien** `main`,
déjà signalé obsolète par `docs/coordination/ETAT_REEL_MAIN_A7FM5X.md` §1 dès le 13/08/2026). Ce plan listait
« Prospect » comme un manque (`PLAN_ATTAQUE_APPLICATION_LOMOTO.md:477` : *« Prospect | Aucun | Impossible de
préparer et suivre la prospection | Créer fiche prospect et historique »*). Or `docs/spec-boulangerie.md:604`
(section 3.5, actuelle) est explicite : *« sans nouveau concept de prospect (envisagé dans l'audit initial du
Lot 7, explicitement écarté faute de besoin réel identifié) »*. Le concept a été examiné puis **rejeté
consciemment**, pas oublié — la distinction que cet audit applique systématiquement ci-dessous.

---

## 3.1 Caisse — registre journalier

**État : Complet.**

Taux du jour, registre (entrées/dettes payées/dépenses/solde, disjonction garantie sans double comptage),
dépense farine automatique, règlement déclaré/confirmé, session nominative + discipline chronologique,
remise contradictoire, clôture avec écart/motif obligatoire, correction post-clôture réservée à l'Admin
Principal — tout confirmé par `apps/api/src/routes/caisse.ts` (Volume 11j du livre, « correspondance quasi
verbatim avec la section 3.1 ») et par les preuves PostgreSQL réelles de `scripts/verifier-concurrence-caisse-ci.ts`
(verrou de ligne réel `SELECT ... FOR UPDATE`, PID PostgreSQL capturé, rollback sur échec d'audit — confirmé
par l'agent de vérification de cette session).

## 3.2 Stocks & matières premières

**État : Complet.**

Mouvements entrée/sortie, seuils d'alerte (au franchissement **et** au balayage périodique de 30 min),
lien `MatierePremiere.code` exposé côté formulaire (correctif bug terrain déjà livré). `apps/api/src/routes/stocks.ts`,
Volume 11z-1.

## 3.3 Production

**État global : Complet.** Détail par sous-module (la spec elle-même les nomme a–g) :

| Sous-module | État | Preuve |
|---|---|---|
| a) Planning de production | Complet | `apps/api/src/routes/production.ts`, Volume 11z-2 |
| b) Productions enregistrées (réconciliation non bloquante) | Complet | idem |
| c) Ingrédients utilisés → décrémentation stock | Complet | idem, même mécanisme que 3.2 |
| d) Schéma de commande + zones de dépôt | Complet | idem, Volume 11z-3 (zones) |
| e) Bon de livraison + PDF imprimable | Complet | idem, `services/pdf.ts` |
| f) Cycle de livraison (C4, 11 statuts) | Complet | `routes/cycles-livraison.ts`, Volume 11z-6 ; statut `ANNULEE` **non relié à une action** — mais la spec elle-même le dit explicitement « réservé à une décision métier future » (`docs/spec-boulangerie.md:414`), donc **Absent-délibéré**, pas un oubli |
| g) Contrôle qualité, pertes motivées, clôture verrouillée | Complet | Lot 4.5/4.6/4.8, Volume 11z-2 |

Couverture en conditions réelles (PostgreSQL) confirmée pour le cycle C4 par `scripts/verifier-integrite-c4-ci.ts`
et `scripts/verifier-distribution-ci.ts` (6 scénarios HTTP+DB réels, dont un reliant explicitement C4 à la
remise contradictoire de Caisse).

## 3.4 Commandes clients

**État : Complet.**

Calcul avance/dette/commission figée, détection de doublon (Modifier/Remplacer, refusé si déjà réglée),
tableau de bord journalier, alerte dette non payée (balayage périodique), règlement de dette. `apps/api/src/routes/commandes.ts`,
Volume 11h. Confirmé en conditions réelles par `scripts/verifier-http-confirmer-reglements-ci.ts`.

## 3.5 Clients & fidélité

**État : Complet — au sens où la spec elle-même ne s'engage pas au-delà de ce qui est construit.**

- Fiche client, historique, clients inactifs (30 jours) : Complet (Volume 11z-3, Lot 7 pt 5).
- Programme de fidélité : **Absent-délibéré**, confirmé indépendamment cette session — `prisma/schema.prisma`
  ne porte que le placeholder `pointsFidelite Int @default(0)` (aucune relation, aucune contrainte), une
  recherche exhaustive dans `apps/api`/`apps/web` (grep `fidel|fidél|reward|recompense`) ne trouve aucune
  logique de calcul ni écran, et `docs/spec-boulangerie.md:602` documente explicitement : *« conçu mais NON
  activé (décision métier) »*.
- Concept « Prospect » : **Absent-délibéré**, voir la note méthodologique en tête de ce document.

## 3.6 Fournisseurs & achats

**État : Complet.**

Fiches, bons de commande, réception (met à jour le stock via `appliquerMouvement`, point de passage unique
avec 3.2/3.3). `apps/api/src/routes/fournisseurs.ts`, Volume 11z-1. Durci en atomicité par le Lot P1 du
31/08/2026 (voir `ECARTS_SPEC_CODE.md` pour le nouveau message d'erreur de concurrence introduit, non
documenté dans la spec — n'affecte pas la complétude fonctionnelle).

## 3.7 Équipe & droits d'accès

**État : Complet.**

- Comptes rattachés à un rôle, hiérarchie, matrice de permissions : Complet (Volume 11d).
- Délégation temporaire de rôle : Complet, confirmée cette session — `apps/api/src/routes/delegations.ts`
  (CRUD complet, calcul d'activité par date) et `apps/web/src/pages/Equipe.tsx:201-245,547-803` (UI complète,
  création + révocation).
- Session unique / déconnexion forcée : Complet, confirmée cette session — `apps/api/src/lib/realtime.ts:89-94`
  (`invaliderSessionUtilisateur`, déconnexion socket forcée) et `apps/web/src/lib/auth.tsx:152-164`
  (`deconnexionForcee`, câblée sur `connect_error` et `sessionInvalidee` dans `lib/socket.tsx:169-178`).
- Identifiant de connexion issu de Travailleurs, réaffectation d'équipe, assistant de premier lancement :
  Complet (Volumes 11d, 22a).
- **Modifier les permissions d'un rôle** (tâche critique n°5) : **Complet — écart historique résolu cette
  session.** Voir `ECARTS_SPEC_CODE.md` pour la preuve détaillée (`apps/web/src/pages/Equipe.tsx:162-186`).

## 3.8 Tableau de bord & rapports

**État : Partiel.**

- Les 7 widgets composés par permission, résumé de clôture quotidien (avec sélecteur de date), masse
  salariale, identité visuelle, écran de démarrage, multilingue : Complet (`apps/api/src/routes/rapports.ts`,
  Volume 18c/11z-5).
- **Marge par produit / marge globale journalière** : **Partiel — écart réel avec la spec**, confirmé cette
  session. La spec (`docs/spec-boulangerie.md:629`) prévoit explicitement un fallback (« le widget affiche
  volume + CA par produit en attendant ») et affirme qu'« une marge globale journalière, elle, reste
  calculable ». Ni l'un ni l'autre n'existe : `apps/api/src/routes/rapports.ts` (351 lignes, lu intégralement)
  ne calcule aucune marge ni aucun volume+CA par produit, et `apps/web/src/pages/Dashboard.tsx` (619 lignes)
  ne contient aucune occurrence du mot « produit ». Voir `ECARTS_SPEC_CODE.md`.

## 3.9 Paramètres

**État : Complet.**

Catalogue produits, prix, taxes, infos boutique, gestion rôles/hiérarchie, types de clients, langue par
défaut — écriture réservée à l'Admin. `apps/api/src/routes/parametres.ts`/`produits.ts`, Volume 18a/11z-1.
Nuance déjà connue (Volume 25 §4, toujours valide) : `ParametresPage` ne distingue pas visuellement une
exécution immédiate d'une mise en attente d'approbation, contrairement à `Equipe.tsx` — piste d'ergonomie,
pas un manque fonctionnel.

## 3.10 Notifications temps réel

**État : Complet.**

Portée commandes/stock/production/caisse, Socket.io, `rolesDestinataires`. Volume 12.

## 3.11 Commissions

**État : Complet.**

Vue dérivée en lecture seule, calcul automatique, commission figée à l'enregistrement (Lot 7 pt 6).
`apps/api/src/routes/commissions.ts`, Volume 11i.

## 3.12 À propos

**État : Complet.** Volume 11z-5.

## 3.13 Rapports (personnels)

**État : Complet.**

Portée par personne + exceptions nommées (Caissier↔Chargé des commandes), export PDF/email/impression sur
6 écrans (Lot 7 pt 4). Volume 11z-5.

## 3.14 Activation

**État : Complet.** `apps/api/src/routes/equipe.ts`, Volume 11d.

## 3.15 État système

**État : Complet — fonctionnellement plus riche que ce que documente la spec.**

Statut base de données, sauvegardes automatiques/manuelles/téléchargement, réinitialisation avec
confirmation par mot exact. Tout présent et fonctionnel (Volume 11z-4). **Mais** le Lot P0 du 30/08/2026 a
ajouté trois comportements observables par l'utilisateur, absents du texte de la spec section 3.15 : une
coupure de service globale pendant la préparation d'une réinitialisation, une désactivation par défaut de la
réinitialisation en production (`REINITIALISATION_PRODUCTION_AUTORISEE`), et une validation renforcée du
dump avant téléchargement. Ce n'est pas un manque de fonctionnalité (au contraire, c'est un durcissement
réel et voulu) mais un écart de documentation — voir `ECARTS_SPEC_CODE.md`, entrée prioritaire.

## 3.16 Approbations

**État : Complet.** `apps/api/src/routes/approbations.ts`, Volume 11f.

## 3.17 Journal d'audit

**État : Complet.** `apps/api/src/lib/audit.ts`, Volume 11g.

## 3.18 Travailleurs

**État : Complet.**

Fiches, pointage (horodatage entrée/sortie), absences, email pro (Cloudflare), départements & groupes,
salaire/paie (calcul sans arrondi intermédiaire, bulletins figés), suppression bloquée par bulletins déjà
émis. `apps/api/src/routes/travailleurs.ts`/`departements.ts`, Volumes 11k-1/2/3, 11z-3.

- Départements & Groupes confirmés Complet cette session : `prisma/schema.prisma:904-923`, CRUD complet
  dans `apps/api/src/routes/departements.ts` (210 lignes), UI `apps/web/src/components/DepartementsCard.tsx`.

## 3.19 Assistant

**État : Complet — au sens de ce qui est engagé pour cette version.**

Chat temps réel mode humain, file visible par les 3 Admins. Couche IA Gemini : **Absent-délibéré, confirmé
indépendamment cette session** — `apps/api/src/routes/assistant.ts:25` (`IA_ACTIVE = process.env.ASSISTANT_IA_ACTIF === "true"`)
et `render.yaml:70-74` fixent explicitement `ASSISTANT_IA_ACTIF: "false"` en production, avec un commentaire
qui reprend mot pour mot la raison donnée par la spec (facturation Google Cloud non finalisée). Décision
cohérente entre spec, code et configuration de déploiement — pas un problème caché.

---

## Résumé

| État | Nombre de sections (sur 19) |
|---|---:|
| Complet | 18 |
| Partiel | 1 (3.8 — marge par produit) |
| Absent-délibéré (documenté) | 0 section entière — 3 points isolés dans des sections par ailleurs Complet (fidélité en 3.5, Prospect en 3.5, IA en 3.19, statut `ANNULEE` en 3.3f) |
| Absent-oublié | 0 |

Voir `POURCENTAGE_AVANCEMENT.md` pour la traduction chiffrée de ce tableau, et `ZONES_OMBRE.md` pour ce que
« Complet » ne capture pas (profondeur de test, dépendances externes, risques d'infrastructure).
