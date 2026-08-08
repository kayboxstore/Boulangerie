# Matrice de couverture — Boulangerie Lomoto

> Suivi fichier par fichier de l'avancement du livre. États possibles : **À analyser** (pas encore ouvert pour rédaction) · **En cours** (chapitre commencé) · **Expliqué** (contenu rédigé, relecture code pas encore faite) · **Vérifié** (toutes les conditions de la section « Contrôle qualité » du mandat sont remplies).
>
> Dernière mise à jour : voir `ETAT_DE_PROGRESSION.md` pour la synchronisation exacte. Ce fichier est mis à jour à la fin de chaque lot de travail.

## Légende des colonnes

- **Niveau** : 1 (Critique), 2 (Fonctionnel standard), 3 (Support/infrastructure) — voir `INVENTAIRE_DU_PROJET.md` §2.
- **Symboles clés** : fonctions/composants/routes principaux du fichier (liste non exhaustive tant que l'état n'est pas « Vérifié »).
- **Chapitre** : volume/chapitre du livre qui couvre ce fichier (rempli au fur et à mesure).
- **Écart spec** : renvoi vers `annexes/ecarts-spec-code.md` si un écart a été repéré, sinon « — ».

---

## A. `apps/api/src/` — cœur du serveur

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/api/src/app.ts` | 2 | `createApp` | À déterminer | À analyser | — | — |
| `apps/api/src/index.ts` | 3 | point d'entrée | À déterminer | À analyser | — | — |
| `apps/api/src/lib/audit.ts` | 1 | `extensionAudit`, `normaliser`, `alignerCles` | `volumes/11g-journal-audit.md` | Vérifié | — | Aucun |
| `apps/api/src/services/actionsCritiques.ts` | 1 | `EXECUTEURS`, `executerAction`, `traiterActionCritique`, `ErreurAction` | `volumes/11f-approbations.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/cloudflareEmail.ts` | 2 | `creerAdresseProfessionnelle`, etc. | À déterminer | À analyser | — | — |
| `apps/api/src/lib/contexteRequete.ts` | 2 | `contexteRequete` (AsyncLocalStorage) | `volumes/11g-journal-audit.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/events.ts` | 2 | `busEvenements` | À déterminer | À analyser | — | — |
| `apps/api/src/lib/ia.ts` | 2 | `repondreAssistantIA`, `appelerGemini` | À déterminer | À analyser | — | — |
| `apps/api/src/lib/jwt.ts` | 1 | `signToken`, `verifyToken`, `JwtPayload` | `volumes/11b-authentification-permissions-bout-en-bout.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/logger.ts` | 3 | `logger` | À déterminer | À analyser | — | — |
| `apps/api/src/lib/origines.ts` | 2 | `verifierOrigine` | À déterminer | À analyser | — | — |
| `apps/api/src/lib/parametres.ts` | 2 | `lireParametre`, `ecrireParametre` | À déterminer | À analyser | — | — |
| `apps/api/src/lib/prisma.ts` | 3 | client Prisma singleton | `volumes/11g-journal-audit.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/realtime.ts` | 2 | `initRealtime`, `getIo`, `roomUtilisateur` | À déterminer | À analyser | — | — |

## B. `apps/api/src/middleware/`

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/api/src/middleware/auth.ts` | 1 | `requireAuth`, `requirePermission`, `chargerUtilisateur` | `volumes/11b-authentification-permissions-bout-en-bout.md` | Vérifié | — | Aucun |

## C. `apps/api/src/routes/`

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/api/src/routes/approbations.ts` | 1 | `approbationsRouter` (`GET /`, `POST /:id/approuver`, `POST /:id/rejeter`) | `volumes/11f-approbations.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/apropos.ts` | 2 | `aProposRouter` | À déterminer | À analyser | — | — |
| `apps/api/src/routes/assistant.ts` | 2 | `assistantRouter` | À déterminer | À analyser | — | — |
| `apps/api/src/routes/audit.ts` | 2 | `auditRouter` (`GET /`) | `volumes/11g-journal-audit.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/auth.ts` | 1 | `authRouter` (`/login`, `/me`, `/mot-de-passe`, `/langue`, `/etat-initial`, `/langue-defaut`) | `volumes/11c-connexion.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/caisse.ts` | 1 | `caisseRouter` (registre, taux, dépenses, case farine), `construireRegistre`, `sacsUtilisesLe` | `volumes/11j-caisse.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/clients.ts` | 2 | `clientsRouter`, `typeClientsRouter` | À déterminer | À analyser | — | — |
| `apps/api/src/routes/commandes.ts` | 1 | `commandesRouter` (résumé, alertes dette, liste, création/doublon, règlements), `bornesDuJour`, `verifierAlertesDette` | `volumes/11h-commandes.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/commissions.ts` | 1 | `commissionsRouter` (`GET /`) | `volumes/11i-commissions.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/delegations.ts` | 1 | `delegationsRouter` (`GET /`, `POST /`, `DELETE /:id`) | `volumes/11e-delegations.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/departements.ts` | 2 | `departementsRouter`, `groupesRouter` | À déterminer | À analyser | — | — |
| `apps/api/src/routes/equipe.ts` | 1 | `equipeRouter` (comptes, `verifierQuotaAdmins`, `/principal`) | `volumes/11d-equipe-roles-permissions.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/etat-systeme.ts` | 2 | `etatSystemeRouter` | À déterminer | À analyser | — | — |
| `apps/api/src/routes/export.ts` | 2 | `exportRouter` | À déterminer | À analyser | — | — |
| `apps/api/src/routes/fournisseurs.ts` | 2 | `fournisseursRouter` | À déterminer | À analyser | — | — |
| `apps/api/src/routes/notifications.ts` | 2 | `notificationsRouter` | À déterminer | À analyser | — | — |
| `apps/api/src/routes/parametres.ts` | 2 | `parametresRouter` | À déterminer | À analyser | — | — |
| `apps/api/src/routes/premierLancement.ts` | 2 | `premierLancementRouter` | À déterminer | À analyser | — | — |
| `apps/api/src/routes/production.ts` | 2 | `productionRouter` (planning, Schéma, Bon de livraison) | À déterminer | À analyser | — | — |
| `apps/api/src/routes/produits.ts` | 2 | `produitsRouter` | À déterminer | À analyser | — | — |
| `apps/api/src/routes/rapports-personnels.ts` | 2 | `rapportsPersonnelsRouter` | À déterminer | À analyser | — | — |
| `apps/api/src/routes/rapports.ts` | 2 | `rapportsRouter` | À déterminer | À analyser | — | — |
| `apps/api/src/routes/roles.ts` | 1 | `rolesRouter` | `volumes/11d-equipe-roles-permissions.md` | Vérifié | — | Oui — voir `annexes/ecarts-spec-code.md` (aucune UI trouvée pour `PUT /:id/permissions`) |
| `apps/api/src/routes/stocks.ts` | 2 | `stocksRouter` | À déterminer | À analyser | — | — |
| `apps/api/src/routes/travailleurs.ts` | 1 | `travailleursRouter` (fiches, e-mail pro, pointages, absences, sanctions, `calculerPaieBrute`, bulletins) | `volumes/11k-1-travailleurs-fiches-pointage.md`, `volumes/11k-2-travailleurs-absences-sanctions.md`, `volumes/11k-3-travailleurs-paie-bulletins.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/zones-depositaires.ts` | 2 | `zonesDepositaireRouter` | À déterminer | À analyser | — | — |

## D. `apps/api/src/services/`

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/api/src/services/actionsCritiques.ts` | 1 | `traiterActionCritique` | À déterminer | À analyser | — | — |
| `apps/api/src/services/email.ts` | 2 | envoi SMTP | À déterminer | À analyser | — | — |
| `apps/api/src/services/emailPro.ts` | 2 | orchestration e-mail pro | À déterminer | À analyser | — | — |
| `apps/api/src/services/interventionsAdmin.ts` | 2 | `notifierInterventionAdmin`, `estHorsPerimetreAdmin` | À déterminer | À analyser | — | — |
| `apps/api/src/services/notifications.ts` | 2 | `publierEvenement`, `initNotificationService` | À déterminer | À analyser | — | — |
| `apps/api/src/services/pdf.ts` | 2 | générateurs PDF | À déterminer | À analyser | — | — |
| `apps/api/src/services/planificateurSauvegarde.ts` | 2 | `initPlanificateurSauvegarde`, `executerSauvegardeAutomatique` | À déterminer | À analyser | — | — |
| `apps/api/src/services/reinitialisation.ts` | 2 | `reinitialiserBase` | À déterminer | À analyser | — | — |
| `apps/api/src/services/sauvegarde.ts` | 2 | `construireDump`, `outilSauvegardeDisponible` | À déterminer | À analyser | — | — |
| `apps/api/src/services/sauvegardeLocale.ts` | 2 | `ecrireSauvegardeLocale`, `lireSauvegardeLocale` | À déterminer | À analyser | — | — |
| `apps/api/src/services/stocks.ts` | 2 | fonctions de mouvement de stock | À déterminer | À analyser | — | — |

## E. `packages/shared/src/`

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `packages/shared/src/index.ts` | 1 | `calculerCommande`, `calculerDepenseFarine`, `avanceAvantCommande`, `aAcces`, `delegationCreateSchema`, `DelegationDTO`, `TYPES_ACTION_CRITIQUE`, `STATUTS_DEMANDE`, `DemandeApprobationDTO`, `ResultatActionCritique`, `ACTIONS_AUDIT`, `AuditLogDTO`, `commandeCreateSchema`, `reglementCreateSchema`, `STRATEGIES_DOUBLON`, `CommandeDTO`, `ConflitCommandeDTO`, `montantTotalPaye`, `CommissionLigneDTO`, `calculerDepenseFarine` (application), `tauxDuJourSchema`, `depenseCreateSchema`, `depenseFarineSchema`, `RegistreCaisseDTO`, `DepenseCaisseDTO`, `travailleurCreateSchema`/`UpdateSchema`, `pointageCreerSchema`/`ModifierSchema`, `absenceDeclarerSchema`/`DecisionSchema`, `sanctionCreateSchema`, `moisISO`, `CalculPaieDTO`, `BulletinPaieDTO`, `TravailleurDTO`, `PointageDTO`, `AbsenceDTO`, `SanctionDTO` **(couverts)** ; `formatFc`, DTO/Zod des autres modules (restant) | `volumes/11a-noyau-financier-permissions.md`, `volumes/11e-delegations.md`, `volumes/11f-approbations.md`, `volumes/11g-journal-audit.md`, `volumes/11h-commandes.md`, `volumes/11i-commissions.md`, `volumes/11j-caisse.md`, `volumes/11k-1/2/3-travailleurs-*.md` (partiel) | En cours | Le fichier sert plusieurs domaines ; les portions Niveau 1 (financier, permissions, délégations, actions critiques, audit, commandes, commissions, caisse, travailleurs/paie) sont désormais toutes couvertes — le reste (DTO, schémas Zod des modules Niveau 2/3) sera couvert au fil des chapitres correspondants | Aucun repéré sur la partie couverte |
| `packages/shared/src/index.test.ts` | 1 | 11 tests Vitest (`calculerCommande` ×5, `calculerDepenseFarine` ×2, `aAcces` ×4) | `volumes/11a-noyau-financier-permissions.md` | Vérifié | — | Aucun |

## F. `prisma/`

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `prisma/schema.prisma` | 1 | 42 modèles, 16 enums (recompté au Volume 13 — l'inventaire initial datait d'avant plusieurs migrations) | `volumes/13-base-de-donnees.md` | Vérifié | — | Aucun (voir note interne §5.5, commentaire obsolète non lié à la spec) |
| `prisma/seed.ts` | 3 | `upsertRole` (autoritatif sur la matrice), fonctions de retrofit idempotentes, jeu de démonstration | `volumes/13-base-de-donnees.md` | Vérifié | — | Aucun |
| `prisma/migrations/*.sql` (29 fichiers) | 3 | historique généré — couvert par synthèse chronologique, pas ligne à ligne (conforme au mandat) | `volumes/13-base-de-donnees.md` | Vérifié | — | Aucun |

## G. `scripts/`

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `scripts/restaurer-sauvegarde.ts` | 2 | `main` (CLI restauration) | À déterminer | À analyser | — | — |

## H. `apps/web/src/` — cœur frontend

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/web/src/App.tsx` | 2 | `App`, `AppAuthentifiee`, `RequiertLecture`, `RequiertEcriture` | À déterminer | À analyser | — | — |
| `apps/web/src/main.tsx` | 3 | montage React | À déterminer | À analyser | — | — |
| `apps/web/src/lib/api.ts` | 1 | `api`, `getToken`, `setToken`, `surSessionRemplacee`, `ApiError` | `volumes/11b-authentification-permissions-bout-en-bout.md` | Vérifié | — | Aucun |
| `apps/web/src/lib/auth.tsx` | 1 | `AuthProvider`, `useAuth`, `peutLire`, `peutEcrire`, `login`, `logout`, `deconnexionForcee` | `volumes/11b-authentification-permissions-bout-en-bout.md` | Vérifié | — | Aucun |
| `apps/web/src/lib/socket.tsx` | 2 | connexion Socket.io client | À déterminer | À analyser | — | — |
| `apps/web/src/lib/theme.tsx` | 3 | thème clair/sombre | À déterminer | À analyser | — | — |
| `apps/web/src/lib/csv.ts` | 3 | export CSV | À déterminer | À analyser | — | — |
| `apps/web/src/lib/utils.ts` | 3 | `cn` | À déterminer | À analyser | — | — |

## I. `apps/web/src/i18n/`

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/web/src/i18n/index.ts` | 2 | init i18next, `appliquerLangue` | À déterminer | À analyser | — | — |
| `apps/web/src/i18n/fr.json` | 2 | dictionnaire français (langue de référence) | À déterminer | À analyser | — | — |
| `apps/web/src/i18n/en.json` | 2 | dictionnaire anglais | À déterminer | À analyser | — | — |
| `apps/web/src/i18n/ln.json` | 2 | dictionnaire lingala | À déterminer | À analyser | — | — |
| `apps/web/src/i18n/sw.json` | 2 | dictionnaire swahili | À déterminer | À analyser | — | — |

## J. `apps/web/src/pages/`

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/web/src/pages/Approbations.tsx` | 1 | `ApprobationsPage`, `BadgeStatut` | `volumes/11f-approbations.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/APropos.tsx` | 2 | `AProposPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/Assistant.tsx` | 2 | `AssistantPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/Audit.tsx` | 2 | `AuditPage`, `champsPertinents` | `volumes/11g-journal-audit.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/BonsLivraison.tsx` | 2 | `BonsLivraisonPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/Caisse.tsx` | 1 | `CaissePage`, `Poste` (tuile avec alerte solde négatif) | `volumes/11j-caisse.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Clients.tsx` | 2 | `ClientsPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/Commandes.tsx` | 1 | `CommandesPage` (apercu client via `calculerCommande`, dialogue de conflit) | `volumes/11h-commandes.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Commissions.tsx` | 1 | `CommissionsPage` | `volumes/11i-commissions.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Dashboard.tsx` | 2 | `DashboardPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/Equipe.tsx` | 1 | `EquipePage`, `messageApprobation` | `volumes/11d-equipe-roles-permissions.md` | Vérifié | Section délégations couverte sommairement, détail complet au 11e | Aucun (côté ce fichier) |
| `apps/web/src/pages/EtatSysteme.tsx` | 2 | `EtatSystemePage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/Fournisseurs.tsx` | 2 | `FournisseursPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/Login.tsx` | 1 | `LoginPage` | `volumes/11c-connexion.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Parametres.tsx` | 2 | `ParametresPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/PremierLancement.tsx` | 2 | `PremierLancementPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/Production.tsx` | 2 | `ProductionPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/Produits.tsx` | 2 | `ProduitsPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/Profil.tsx` | 2 | `ProfilPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/RapportsPersonnels.tsx` | 2 | `RapportsPersonnelsPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/Stocks.tsx` | 2 | `StocksPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/Travailleurs.tsx` | 1 | `TravailleursPage` (fiches, pointages, absences) | `volumes/11k-1-travailleurs-fiches-pointage.md`, `volumes/11k-2-travailleurs-absences-sanctions.md` | Vérifié | — | Aucun |

## K. `apps/web/src/components/` (hors `ui/`)

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/web/src/components/ActivityFeed.tsx` | 2 | `ActivityFeed` | À déterminer | À analyser | — | — |
| `apps/web/src/components/BarreExport.tsx` | 2 | `BarreExport` | À déterminer | À analyser | — | — |
| `apps/web/src/components/ChargementModule.tsx` | 3 | `ChargementModule` | À déterminer | À analyser | — | — |
| `apps/web/src/components/DepartementsCard.tsx` | 2 | `DepartementsCard` | À déterminer | À analyser | — | — |
| `apps/web/src/components/DialogNouvelleZone.tsx` | 2 | `DialogNouvelleZone` | À déterminer | À analyser | — | — |
| `apps/web/src/components/EcranDemarrage.tsx` | 3 | `EcranDemarrage`, `splashDejaVu` | À déterminer | À analyser | — | — |
| `apps/web/src/components/FeedbackProvider.tsx` | 3 | `FeedbackProvider`, `useFeedback` | À déterminer | À analyser | — | — |
| `apps/web/src/components/IndicateurConnexion.tsx` | 3 | `IndicateurConnexion` | À déterminer | À analyser | — | — |
| `apps/web/src/components/Layout.tsx` | 2 | `Layout` | À déterminer | À analyser | — | — |
| `apps/web/src/components/NotificationBell.tsx` | 2 | `NotificationBell` | À déterminer | À analyser | — | — |
| `apps/web/src/components/PaieCard.tsx` | 1 | `PaieCard` (sanctions, calcul de paie, bulletins) | `volumes/11k-3-travailleurs-paie-bulletins.md` | Vérifié | — | Aucun |
| `apps/web/src/components/PanneauEmailPro.tsx` | 2 | `PanneauEmailPro` | À déterminer | À analyser | — | — |
| `apps/web/src/components/ZonesDepositaireCard.tsx` | 2 | `ZonesDepositaireCard` | À déterminer | À analyser | — | — |

## L. `apps/web/src/components/ui/` (primitives, Niveau 3)

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/web/src/components/ui/badge.tsx` | 3 | `Badge` | À déterminer | À analyser | — | — |
| `apps/web/src/components/ui/button.tsx` | 3 | `Button` | À déterminer | À analyser | — | — |
| `apps/web/src/components/ui/card.tsx` | 3 | `Card` et sous-composants | À déterminer | À analyser | — | — |
| `apps/web/src/components/ui/carte-ligne.tsx` | 3 | `CarteLigne` (vue mobile) | À déterminer | À analyser | — | — |
| `apps/web/src/components/ui/dialog.tsx` | 3 | `Dialog` et sous-composants | À déterminer | À analyser | — | — |
| `apps/web/src/components/ui/input.tsx` | 3 | `Input` | À déterminer | À analyser | — | — |
| `apps/web/src/components/ui/label.tsx` | 3 | `Label` | À déterminer | À analyser | — | — |
| `apps/web/src/components/ui/select.tsx` | 3 | `NativeSelect` | À déterminer | À analyser | — | — |
| `apps/web/src/components/ui/sheet.tsx` | 3 | `Sheet` (panneau mobile) | À déterminer | À analyser | — | — |
| `apps/web/src/components/ui/table.tsx` | 3 | `Table` et sous-composants | À déterminer | À analyser | — | — |
| `apps/web/src/components/ui/textarea.tsx` | 3 | `Textarea` | À déterminer | À analyser | — | — |

## M. Configuration et outillage (Niveau 3)

| Chemin | Chapitre | État | Lacunes |
|---|---|---|---|
| `package.json` (racine) | À déterminer | À analyser | — |
| `apps/api/package.json` | À déterminer | À analyser | — |
| `apps/api/tsconfig.json` | À déterminer | À analyser | — |
| `apps/web/package.json` | À déterminer | À analyser | — |
| `apps/web/tsconfig.json` | À déterminer | À analyser | — |
| `apps/web/vite.config.ts` | À déterminer | À analyser | — |
| `apps/web/components.json` | À déterminer | À analyser | — |
| `packages/shared/package.json` | À déterminer | À analyser | — |
| `vitest.config.ts` | À déterminer | À analyser | — |
| `render.yaml` | `volumes/05-configuration.md` | Vérifié | — | Aucun |
| `.env.example` | `volumes/05-configuration.md` | Vérifié | — | Aucun |

## N. Sources documentaires (hors grille de risque — références croisées, pas "expliquées")

| Chemin | Utilisation dans le livre | État |
|---|---|---|
| `docs/spec-boulangerie.md` | Source de vérité du comportement voulu, croisée à chaque chapitre fonctionnel | Consulté en continu |
| `README.md` | Base du chapitre Installation | Utilisé (`volumes/04-installation.md`) — section « Phase actuelle »/Conventions Caisse signalée obsolète |
| `DEPLOIEMENT.md` | Base du chapitre Construction et déploiement | À utiliser |
| `docs/MISE-EN-PRODUCTION.md` | Référence pour le chapitre Administration/maintenance | À utiliser |

---

## Statistiques globales de la matrice

| État | Nombre de fichiers (sur 155 fichiers de code) |
|---|---:|
| À analyser | 121 |
| En cours | 1 |
| Expliqué | 0 |
| Vérifié | 33 |

*(Mis à jour à la fin de chaque lot — voir `ETAT_DE_PROGRESSION.md` pour le détail par niveau de risque.)*
