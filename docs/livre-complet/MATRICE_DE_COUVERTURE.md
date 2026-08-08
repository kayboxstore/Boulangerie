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
| `apps/api/src/app.ts` | 2 | `createApp` (middlewares, montage des 26 routeurs, repli SPA, gestion d'erreurs) | `volumes/08-cycle-demarrage.md` | Vérifié | — | Aucun |
| `apps/api/src/index.ts` | 3 | point d'entrée (serveur HTTP, Socket.io, notifications, planificateur) | `volumes/08-cycle-demarrage.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/audit.ts` | 1 | `extensionAudit`, `normaliser`, `alignerCles` | `volumes/11g-journal-audit.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/cloudflareEmail.ts` | 2 | `creerOuObtenirDestination`, `obtenirDestination`, `creerRegleRoutage` | `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/contexteRequete.ts` | 2 | `contexteRequete` (AsyncLocalStorage) | `volumes/11g-journal-audit.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/events.ts` | 2 | `busEvenements`, `EvenementMetier` | `volumes/12-api-reseau.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/ia.ts` | 2 | `repondreAssistantIA`, `appelerGemini`, `testerConnexionIA` | `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/jwt.ts` | 1 | `signToken`, `verifyToken`, `JwtPayload` | `volumes/11b-authentification-permissions-bout-en-bout.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/logger.ts` | 3 | `logger` (`info`/`warn`/`error`), `remplacantErreur` | `volumes/16-erreurs-journalisation.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/origines.ts` | 2 | `verifierOrigine`, `APEX`, `DOMAINE_CANONIQUE` | `volumes/14-authentification-securite.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/parametres.ts` | 2 | `lireParametre`, `ecrireParametre` | `volumes/18a-parametres-intervention-admin-restauration.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/prisma.ts` | 3 | client Prisma singleton | `volumes/11g-journal-audit.md` | Vérifié | — | Aucun |
| `apps/api/src/lib/realtime.ts` | 2 | `initRealtime`, `getIo`, `roomUtilisateur`, `roomRole`, `invaliderSessionUtilisateur` | `volumes/12-api-reseau.md` | Vérifié | — | Aucun |

## B. `apps/api/src/middleware/`

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/api/src/middleware/auth.ts` | 1 | `requireAuth`, `requirePermission`, `chargerUtilisateur` | `volumes/11b-authentification-permissions-bout-en-bout.md` | Vérifié | — | Aucun |

## C. `apps/api/src/routes/`

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/api/src/routes/approbations.ts` | 1 | `approbationsRouter` (`GET /`, `POST /:id/approuver`, `POST /:id/rejeter`) | `volumes/11f-approbations.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/apropos.ts` | 2 | `aProposRouter` | `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/assistant.ts` | 2 | `assistantRouter` (conversations, escalade, diagnostic IA) | `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/audit.ts` | 2 | `auditRouter` (`GET /`) | `volumes/11g-journal-audit.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/auth.ts` | 1 | `authRouter` (`/login`, `/me`, `/mot-de-passe`, `/langue`, `/etat-initial`, `/langue-defaut`) | `volumes/11c-connexion.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/caisse.ts` | 1 | `caisseRouter` (registre, taux, dépenses, case farine), `construireRegistre`, `sacsUtilisesLe` | `volumes/11j-caisse.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/clients.ts` | 2 | `clientsRouter`, `typeClientsRouter` (`MODIFIER_TYPE_CLIENT` via action critique) | `volumes/11z-3-departements-zones-clients.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/commandes.ts` | 1 | `commandesRouter` (résumé, alertes dette, liste, création/doublon, règlements), `bornesDuJour`, `verifierAlertesDette` | `volumes/11h-commandes.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/commissions.ts` | 1 | `commissionsRouter` (`GET /`) | `volumes/11i-commissions.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/delegations.ts` | 1 | `delegationsRouter` (`GET /`, `POST /`, `DELETE /:id`) | `volumes/11e-delegations.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/departements.ts` | 2 | `departementsRouter`, `groupesRouter` | `volumes/11z-3-departements-zones-clients.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/equipe.ts` | 1 | `equipeRouter` (comptes, `verifierQuotaAdmins`, `/principal`) | `volumes/11d-equipe-roles-permissions.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/etat-systeme.ts` | 2 | `etatSystemeRouter` (état, sauvegarde manuelle, téléchargement local, réinitialisation) | `volumes/11z-4-notifications-etat-systeme-parametres.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/export.ts` | 2 | `exportRouter` (`moduleInterdit`, `/pdf`, `/email`) | `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/fournisseurs.ts` | 2 | `fournisseursRouter` (fournisseurs, commandes, réception) | `volumes/11z-1-stocks-fournisseurs-produits.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/notifications.ts` | 2 | `notificationsRouter` | `volumes/11z-4-notifications-etat-systeme-parametres.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/parametres.ts` | 2 | `parametresRouter` | `volumes/11z-4-notifications-etat-systeme-parametres.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/premierLancement.ts` | 2 | `premierLancementRouter` (`exigerBaseVide`, 4 étapes) | `volumes/11z-4-notifications-etat-systeme-parametres.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/production.ts` | 2 | `productionRouter` (planning, productions, Schéma, Bon de livraison, écarts) | `volumes/11z-2-production.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/produits.ts` | 2 | `produitsRouter` (catalogue, `MODIFIER_TAUX_TAXE` via action critique) | `volumes/11z-1-stocks-fournisseurs-produits.md` | Vérifié | UI `ProduitsPage` n'envoie jamais de changement de `tauxTaxe` — chemin serveur non atteint par l'UI actuelle | Aucun |
| `apps/api/src/routes/rapports-personnels.ts` | 2 | `rapportsPersonnelsRouter` (`resoudrePortee`, 8 sources agrégées) | `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/rapports.ts` | 2 | `rapportsRouter` (7 widgets Tableau de bord) | `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | Commentaire de `/cloture-quotidienne` obsolète (portée Admin non reflétée) | Aucun |
| `apps/api/src/routes/roles.ts` | 1 | `rolesRouter` | `volumes/11d-equipe-roles-permissions.md` | Vérifié | — | Oui — voir `annexes/ecarts-spec-code.md` (aucune UI trouvée pour `PUT /:id/permissions`) |
| `apps/api/src/routes/stocks.ts` | 2 | `stocksRouter` (matières premières, journal des mouvements) | `volumes/11z-1-stocks-fournisseurs-produits.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/travailleurs.ts` | 1 | `travailleursRouter` (fiches, e-mail pro, pointages, absences, sanctions, `calculerPaieBrute`, bulletins) | `volumes/11k-1-travailleurs-fiches-pointage.md`, `volumes/11k-2-travailleurs-absences-sanctions.md`, `volumes/11k-3-travailleurs-paie-bulletins.md` | Vérifié | — | Aucun |
| `apps/api/src/routes/zones-depositaires.ts` | 2 | `zonesDepositaireRouter`, `ecritureZones` (middleware personnalisé) | `volumes/11z-3-departements-zones-clients.md` | Vérifié | — | Aucun |

## D. `apps/api/src/services/`

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/api/src/services/actionsCritiques.ts` | 1 | `EXECUTEURS`, `executerAction`, `traiterActionCritique`, `ErreurAction` | `volumes/11f-approbations.md` | Vérifié | — | Aucun |
| `apps/api/src/services/email.ts` | 2 | `envoyerRapport`, `emailConfigure` (Nodemailer/Gmail) | `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | — | Aucun |
| `apps/api/src/services/emailPro.ts` | 2 | `declencherEmailPro`, `verifierEmailPro`, `genererAdresseProUnique` | `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | — | Aucun |
| `apps/api/src/services/interventionsAdmin.ts` | 2 | `notifierInterventionAdmin`, `estHorsPerimetreAdmin` | `volumes/18a-parametres-intervention-admin-restauration.md` | Vérifié | — | Aucun |
| `apps/api/src/services/notifications.ts` | 2 | `publierEvenement`, `rolesDestinataires`, `rolesAvecLecture`, `initNotificationService` | `volumes/11z-4-notifications-etat-systeme-parametres.md` | Vérifié | — | Aucun |
| `apps/api/src/services/pdf.ts` | 2 | `construirePdfBonsLivraison`, `nomFichierPdf`, `construirePdf` générique | `volumes/11z-2-production.md`, `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | — | Aucun |
| `apps/api/src/services/planificateurSauvegarde.ts` | 2 | `initPlanificateurSauvegarde`, `executerSauvegardeAutomatique` | `volumes/11z-4-notifications-etat-systeme-parametres.md` | Vérifié | — | Aucun |
| `apps/api/src/services/reinitialisation.ts` | 2 | `reinitialiserBase` | `volumes/11z-4-notifications-etat-systeme-parametres.md` | Vérifié | — | Aucun |
| `apps/api/src/services/sauvegarde.ts` | 2 | `construireDump`, `outilSauvegardeDisponible`, `coordonneesBase` | `volumes/11z-4-notifications-etat-systeme-parametres.md` | Vérifié | — | Aucun |
| `apps/api/src/services/sauvegardeLocale.ts` | 2 | `ecrireSauvegardeLocale`, `lireSauvegardeLocale` | `volumes/11z-4-notifications-etat-systeme-parametres.md` | Vérifié | — | Aucun |
| `apps/api/src/services/stocks.ts` | 2 | `appliquerMouvement`, `emettreAlerteSeuil`, `ErreurStock` | `volumes/11z-1-stocks-fournisseurs-produits.md` | Vérifié | — | Aucun |

## E. `packages/shared/src/`

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `packages/shared/src/index.ts` | 1 | Portions Niveau 1 (financier, permissions, délégations, actions critiques, audit, commandes, commissions, caisse, travailleurs/paie) **entièrement couvertes** ; portions Niveau 2/3 (stocks, fournisseurs, produits, production, départements, zones, clients, notifications, état système, paramètres, premier lancement, à propos, assistant, rapports, export) **couvertes au fil des chapitres 11z-1 à 11z-5** ; motif transversal de validation Zod synthétisé au Volume 15 (53 schémas, `.partial()`, `.refine()`, `setErrorMap`) | `volumes/11a` à `11k-*`, `volumes/11z-1` à `11z-5`, `volumes/12-api-reseau.md`, `volumes/15-validation.md` | En cours | Fichier de 1942 lignes servant tous les domaines ; tous les domaines fonctionnels ont été traversés au moins une fois par un chapitre thématique, mais aucun audit symbole-par-symbole exhaustif n'a formellement clos ce fichier — laissé « En cours » par rigueur plutôt que déclaré « Vérifié » sans cette vérification finale | Aucun repéré sur les parties couvertes |
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
| `scripts/restaurer-sauvegarde.ts` | 2 | `main` (CLI restauration) | `volumes/18a-parametres-intervention-admin-restauration.md` | Vérifié | — | Aucun |

## H. `apps/web/src/` — cœur frontend

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/web/src/App.tsx` | 2 | `App`, `AppAuthentifiee`, `RequiertLecture`, `RequiertEcriture` | `volumes/08-cycle-demarrage.md`, `volumes/10-navigation-etat.md` | Vérifié | — | Aucun |
| `apps/web/src/main.tsx` | 3 | montage React (providers empilés) | `volumes/08-cycle-demarrage.md` | Vérifié | — | Aucun |
| `apps/web/src/lib/api.ts` | 1 | `api`, `getToken`, `setToken`, `surSessionRemplacee`, `ApiError` | `volumes/11b-authentification-permissions-bout-en-bout.md` | Vérifié | — | Aucun |
| `apps/web/src/lib/auth.tsx` | 1 | `AuthProvider`, `useAuth`, `peutLire`, `peutEcrire`, `login`, `logout`, `deconnexionForcee` | `volumes/11b-authentification-permissions-bout-en-bout.md` | Vérifié | — | Aucun |
| `apps/web/src/lib/socket.tsx` | 2 | `SocketProvider`, `useSocket` | `volumes/12-api-reseau.md` | Vérifié | Clés d'invalidation `["ventes"]`/`["clotures"]` mortes (module CAISSE) | Aucun |
| `apps/web/src/lib/theme.tsx` | 3 | `initTheme`, `ThemeProvider`, `useTheme` | `volumes/18b-theme-csv-utils-feedback.md` | Vérifié | Fonctionnalité non mentionnée par la spec, sans contradiction | Aucun |
| `apps/web/src/lib/csv.ts` | 3 | `genererCSV`, `telechargerCSV` | `volumes/18b-theme-csv-utils-feedback.md` | Vérifié | — | Aucun |
| `apps/web/src/lib/utils.ts` | 3 | `cn` | `volumes/18b-theme-csv-utils-feedback.md` | Vérifié | — | Aucun |

## I. `apps/web/src/i18n/`

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/web/src/i18n/index.ts` | 2 | init i18next, `appliquerLangue`, `RESSOURCES` | `volumes/17-i18n.md` | Vérifié | — | Aucun |
| `apps/web/src/i18n/fr.json` | 2 | dictionnaire français (langue de référence, 1013 clés) | `volumes/17-i18n.md` | Vérifié | — | Aucun |
| `apps/web/src/i18n/en.json` | 2 | dictionnaire anglais (parité 1013/1013 vérifiée) | `volumes/17-i18n.md` | Vérifié | — | Aucun |
| `apps/web/src/i18n/ln.json` | 2 | dictionnaire lingala (« premier jet », `_note`) | `volumes/17-i18n.md` | Vérifié | Traduction non relue par un locuteur natif (signalé dans le fichier lui-même) | Aucun |
| `apps/web/src/i18n/sw.json` | 2 | dictionnaire swahili (« premier jet », `_note`) | `volumes/17-i18n.md` | Vérifié | Traduction non relue par un locuteur natif (signalé dans le fichier lui-même) | Aucun |

## J. `apps/web/src/pages/`

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/web/src/pages/Approbations.tsx` | 1 | `ApprobationsPage`, `BadgeStatut` | `volumes/11f-approbations.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/APropos.tsx` | 2 | `AProposPage` | `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Assistant.tsx` | 2 | `AssistantPage`, `VueUtilisateur`, `VueAdmin`, `Composeur` | `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Audit.tsx` | 2 | `AuditPage`, `champsPertinents` | `volumes/11g-journal-audit.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/BonsLivraison.tsx` | 2 | `BonsLivraisonPage` | `volumes/11z-2-production.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Caisse.tsx` | 1 | `CaissePage`, `Poste` (tuile avec alerte solde négatif) | `volumes/11j-caisse.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Clients.tsx` | 2 | `ClientsPage` | `volumes/11z-3-departements-zones-clients.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Commandes.tsx` | 1 | `CommandesPage` (apercu client via `calculerCommande`, dialogue de conflit) | `volumes/11h-commandes.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Commissions.tsx` | 1 | `CommissionsPage` | `volumes/11i-commissions.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Dashboard.tsx` | 2 | `DashboardPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/Equipe.tsx` | 1 | `EquipePage`, `messageApprobation` | `volumes/11d-equipe-roles-permissions.md` | Vérifié | Section délégations couverte sommairement, détail complet au 11e | Aucun (côté ce fichier) |
| `apps/web/src/pages/EtatSysteme.tsx` | 2 | `EtatSystemePage` | `volumes/11z-4-notifications-etat-systeme-parametres.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Fournisseurs.tsx` | 2 | `FournisseursPage` | `volumes/11z-1-stocks-fournisseurs-produits.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Login.tsx` | 1 | `LoginPage` | `volumes/11c-connexion.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Parametres.tsx` | 2 | `ParametresPage` | `volumes/11z-4-notifications-etat-systeme-parametres.md` | Vérifié | Modification de Qualité sans distinction visuelle exécuté/en attente d'approbation (contrairement à `Equipe.tsx`) | Aucun |
| `apps/web/src/pages/PremierLancement.tsx` | 2 | `PremierLancementPage` | `volumes/11z-4-notifications-etat-systeme-parametres.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Production.tsx` | 2 | `ProductionPage` | `volumes/11z-2-production.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Produits.tsx` | 2 | `ProduitsPage` | `volumes/11z-1-stocks-fournisseurs-produits.md` | Vérifié | N'envoie jamais de changement de `tauxTaxe` (chemin serveur non atteint) | Aucun |
| `apps/web/src/pages/Profil.tsx` | 2 | `ProfilPage` | À déterminer | À analyser | — | — |
| `apps/web/src/pages/RapportsPersonnels.tsx` | 2 | `RapportsPersonnelsPage` | `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Stocks.tsx` | 2 | `StocksPage` | `volumes/11z-1-stocks-fournisseurs-produits.md` | Vérifié | — | Aucun |
| `apps/web/src/pages/Travailleurs.tsx` | 1 | `TravailleursPage` (fiches, pointages, absences) | `volumes/11k-1-travailleurs-fiches-pointage.md`, `volumes/11k-2-travailleurs-absences-sanctions.md` | Vérifié | — | Aucun |

## K. `apps/web/src/components/` (hors `ui/`)

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/web/src/components/ActivityFeed.tsx` | 2 | `ActivityFeed`, `tempsRelatif` | `volumes/12-api-reseau.md` | Vérifié | — | Aucun |
| `apps/web/src/components/BarreExport.tsx` | 2 | `BarreExport` | `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | — | Aucun |
| `apps/web/src/components/ChargementModule.tsx` | 3 | `ChargementModule` | `volumes/08-cycle-demarrage.md` | Vérifié | — | Aucun |
| `apps/web/src/components/DepartementsCard.tsx` | 2 | `DepartementsCard` | `volumes/11z-3-departements-zones-clients.md` | Vérifié | — | Aucun |
| `apps/web/src/components/DialogNouvelleZone.tsx` | 2 | `DialogNouvelleZone` | `volumes/11z-3-departements-zones-clients.md` | Vérifié | — | Aucun |
| `apps/web/src/components/EcranDemarrage.tsx` | 3 | `EcranDemarrage`, `splashDejaVu` | `volumes/08-cycle-demarrage.md` | Vérifié | — | Aucun |
| `apps/web/src/components/FeedbackProvider.tsx` | 3 | `FeedbackProvider`, `useFeedback` | `volumes/18b-theme-csv-utils-feedback.md` | Vérifié | — | Aucun |
| `apps/web/src/components/IndicateurConnexion.tsx` | 3 | `IndicateurConnexion` | `volumes/12-api-reseau.md` | Vérifié | — | Aucun |
| `apps/web/src/components/Layout.tsx` | 2 | `Layout`, `ListeNavigation`, `calculerLiens` (dupliquée, jamais appelée — voir lacunes) | `volumes/09-ui-composants.md` | Vérifié | Duplication de logique repérée (`calculerLiens` non appelée, réimplémentée en ligne) — signalée, pas corrigée (hors périmètre) | Aucun |
| `apps/web/src/components/NotificationBell.tsx` | 2 | `NotificationBell` (lazy, framer-motion) | `volumes/11z-4-notifications-etat-systeme-parametres.md` | Vérifié | — | Aucun |
| `apps/web/src/components/PaieCard.tsx` | 1 | `PaieCard` (sanctions, calcul de paie, bulletins) | `volumes/11k-3-travailleurs-paie-bulletins.md` | Vérifié | — | Aucun |
| `apps/web/src/components/PanneauEmailPro.tsx` | 2 | `PanneauEmailPro` | `volumes/11z-5-apropos-assistant-export-rapports.md` | Vérifié | — | Aucun |
| `apps/web/src/components/ZonesDepositaireCard.tsx` | 2 | `ZonesDepositaireCard` | `volumes/11z-3-departements-zones-clients.md` | Vérifié | — | Aucun |

## L. `apps/web/src/components/ui/` (primitives, Niveau 3)

| Chemin | Niveau | Symboles clés | Chapitre | État | Lacunes | Écart spec |
|---|:---:|---|---|---|---|---|
| `apps/web/src/components/ui/badge.tsx` | 3 | `Badge` (variantes `cva` : default/gold/secondary/destructive/outline) | `volumes/09-ui-composants.md` | Vérifié | — | Aucun |
| `apps/web/src/components/ui/button.tsx` | 3 | `Button` (variantes/tailles `cva`, `asChild` via `@radix-ui/react-slot`) | `volumes/09-ui-composants.md` | Vérifié | — | Aucun |
| `apps/web/src/components/ui/card.tsx` | 3 | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | `volumes/09-ui-composants.md` | Vérifié | — | Aucun |
| `apps/web/src/components/ui/carte-ligne.tsx` | 3 | `CarteLigne`, `CarteLigneTitre`, `CarteLigneChamp`, `CarteLigneActions` (vue mobile) | `volumes/09-ui-composants.md` | Vérifié | — | Aucun |
| `apps/web/src/components/ui/dialog.tsx` | 3 | wrapper `@radix-ui/react-dialog`, bouton de fermeture intégré à `DialogContent` | `volumes/09-ui-composants.md` | Vérifié | — | Aucun |
| `apps/web/src/components/ui/input.tsx` | 3 | `Input` | `volumes/09-ui-composants.md` | Vérifié | — | Aucun |
| `apps/web/src/components/ui/label.tsx` | 3 | `Label` (wrapper `@radix-ui/react-label`) | `volumes/09-ui-composants.md` | Vérifié | — | Aucun |
| `apps/web/src/components/ui/select.tsx` | 3 | `NativeSelect` (`<select>` HTML natif stylé, pas un composant Radix) | `volumes/09-ui-composants.md` | Vérifié | — | Aucun |
| `apps/web/src/components/ui/sheet.tsx` | 3 | `Sheet` (tiroir mobile — réutilise le même primitif Radix que `Dialog`, stylé différemment) | `volumes/09-ui-composants.md` | Vérifié | — | Aucun |
| `apps/web/src/components/ui/table.tsx` | 3 | `Table` (enveloppé `overflow-auto`), `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` | `volumes/09-ui-composants.md` | Vérifié | — | Aucun |
| `apps/web/src/components/ui/textarea.tsx` | 3 | `Textarea` | `volumes/09-ui-composants.md` | Vérifié | — | Aucun |

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

> Audit du 2026-08-08 : la matrice ne comptait que 128 lignes de tableau pour 155 fichiers réels. Écart résolu et expliqué ci-dessous — les chiffres suivants comptent les **fichiers réels**, pas les lignes de tableau.

| État | Nombre de fichiers (sur 155 fichiers de code) |
|---|---:|
| À analyser | 11 |
| En cours | 1 |
| Expliqué | 0 |
| Vérifié | 143 |

Méthodologie de comptage (pour que ce tableau reste vérifiable) :
- La section F regroupe volontairement les 29 fichiers `prisma/migrations/*.sql` sur **une seule ligne de tableau** (conforme au mandat : « couvertes de façon groupée, pas ligne à ligne »). Cette ligne, à l'état Vérifié, compte donc pour **29 fichiers Vérifié**, pas pour 1 — d'où l'écart entre 128 lignes de tableau et 155 fichiers.
- Une ligne fantôme dupliquait `apps/api/src/services/actionsCritiques.ts` (une copie correcte « Vérifié » en section A, mal placée, et une copie fantôme « À analyser » en section D). Corrigé le 2026-08-08 : une seule ligne subsiste, à sa place correcte (section D), à l'état Vérifié.
- Volume 18a (`parametres.ts`, `interventionsAdmin.ts`, `restaurer-sauvegarde.ts`) et Volume 18b (`theme.tsx`, `csv.ts`, `utils.ts`, `FeedbackProvider.tsx`) ont fait passer 7 fichiers de « À analyser » à « Vérifié ».
- Les 11 fichiers réellement « À analyser » restants : `apps/web/src/pages/Dashboard.tsx`, `apps/web/src/pages/Profil.tsx`, et les 9 fichiers de configuration de la section M (`package.json` racine, `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/components.json`, `packages/shared/package.json`, `vitest.config.ts`) — couverts par les Volumes 18c et 18d.

*(Mis à jour à la fin de chaque lot — voir `ETAT_DE_PROGRESSION.md` pour le détail par niveau de risque.)*
