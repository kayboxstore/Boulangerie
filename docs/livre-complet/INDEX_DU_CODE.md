# Index du code — Le Livre Boulangerie Lomoto

> Table de correspondance entre un fichier ou un symbole (fonction, composant, route) et le(s) chapitre(s) du livre qui l'expliquent. Utilisez `Ctrl+F` / recherche de texte pour trouver un nom exact.
>
> Complète `MATRICE_DE_COUVERTURE.md` (qui suit l'avancement) avec une vue orientée « je cherche telle chose dans le code, où en parle le livre ? ».

## Par fichier (uniquement les fichiers déjà couverts par au moins un chapitre)

| Fichier | Chapitre(s) |
|---|---|
| `packages/shared/src/index.ts` — fonctions `calculerCommande`, `avanceAvantCommande`, `calculerDepenseFarine`, `aAcces` | `volumes/11a-noyau-financier-permissions.md` |
| `packages/shared/src/index.test.ts` | `volumes/11a-noyau-financier-permissions.md` |
| `apps/api/src/lib/jwt.ts` | `volumes/11b-authentification-permissions-bout-en-bout.md` |
| `apps/api/src/middleware/auth.ts` | `volumes/11b-authentification-permissions-bout-en-bout.md` |
| `apps/web/src/lib/api.ts` | `volumes/11b-authentification-permissions-bout-en-bout.md` |
| `apps/web/src/lib/auth.tsx` | `volumes/11b-authentification-permissions-bout-en-bout.md` |
| `apps/api/src/routes/auth.ts` | `volumes/11c-connexion.md` |
| `apps/web/src/pages/Login.tsx` | `volumes/11c-connexion.md` |
| `apps/api/src/routes/equipe.ts` | `volumes/11d-equipe-roles-permissions.md` |
| `apps/api/src/routes/roles.ts` | `volumes/11d-equipe-roles-permissions.md` |
| `apps/web/src/pages/Equipe.tsx` | `volumes/11d-equipe-roles-permissions.md` |
| `apps/api/src/routes/delegations.ts` | `volumes/11e-delegations.md` |
| `packages/shared/src/index.ts` — `delegationCreateSchema`, `DelegationDTO` | `volumes/11e-delegations.md` |
| `apps/api/src/services/actionsCritiques.ts` | `volumes/11f-approbations.md` |
| `apps/api/src/routes/approbations.ts` | `volumes/11f-approbations.md` |
| `apps/web/src/pages/Approbations.tsx` | `volumes/11f-approbations.md` |
| `packages/shared/src/index.ts` — `TYPES_ACTION_CRITIQUE`, `STATUTS_DEMANDE`, `DemandeApprobationDTO`, `ResultatActionCritique` | `volumes/11f-approbations.md` |
| `apps/api/src/lib/audit.ts` | `volumes/11g-journal-audit.md` |
| `apps/api/src/lib/contexteRequete.ts` | `volumes/11g-journal-audit.md` |
| `apps/api/src/lib/prisma.ts` | `volumes/11g-journal-audit.md` |
| `apps/api/src/routes/audit.ts` | `volumes/11g-journal-audit.md` |
| `apps/web/src/pages/Audit.tsx` | `volumes/11g-journal-audit.md` |
| `packages/shared/src/index.ts` — `ACTIONS_AUDIT`, `AuditLogDTO` | `volumes/11g-journal-audit.md` |
| `apps/api/src/routes/commandes.ts` | `volumes/11h-commandes.md` |
| `apps/web/src/pages/Commandes.tsx` | `volumes/11h-commandes.md` |
| `packages/shared/src/index.ts` — `commandeCreateSchema`, `reglementCreateSchema`, `STRATEGIES_DOUBLON`, `CommandeDTO`, `ConflitCommandeDTO` | `volumes/11h-commandes.md` |
| `apps/api/src/routes/commissions.ts` | `volumes/11i-commissions.md` |
| `apps/web/src/pages/Commissions.tsx` | `volumes/11i-commissions.md` |
| `packages/shared/src/index.ts` — `montantTotalPaye`, `CommissionLigneDTO` | `volumes/11i-commissions.md` |
| `apps/api/src/routes/caisse.ts` | `volumes/11j-caisse.md` |
| `apps/web/src/pages/Caisse.tsx` | `volumes/11j-caisse.md` |
| `packages/shared/src/index.ts` — `tauxDuJourSchema`, `depenseCreateSchema`, `depenseFarineSchema`, `RegistreCaisseDTO`, `DepenseCaisseDTO` | `volumes/11j-caisse.md` |
| `apps/api/src/routes/travailleurs.ts` | `volumes/11k-1-travailleurs-fiches-pointage.md`, `volumes/11k-2-travailleurs-absences-sanctions.md`, `volumes/11k-3-travailleurs-paie-bulletins.md` |
| `apps/web/src/pages/Travailleurs.tsx` | `volumes/11k-1-travailleurs-fiches-pointage.md`, `volumes/11k-2-travailleurs-absences-sanctions.md` |
| `apps/web/src/components/PaieCard.tsx` | `volumes/11k-3-travailleurs-paie-bulletins.md` |
| `packages/shared/src/index.ts` — `travailleurCreateSchema`/`UpdateSchema`, `pointageCreerSchema`/`ModifierSchema`, `absenceDeclarerSchema`/`DecisionSchema`, `sanctionCreateSchema`, `moisISO`, `CalculPaieDTO`, `BulletinPaieDTO` | `volumes/11k-1/2/3-travailleurs-*.md` |
| `prisma/schema.prisma` (42 modèles, 16 enums) | `volumes/13-base-de-donnees.md` |
| `prisma/migrations/*.sql` (29 fichiers, synthèse chronologique) | `volumes/13-base-de-donnees.md` |
| `prisma/seed.ts` | `volumes/13-base-de-donnees.md` |
| `README.md` | `volumes/04-installation.md` |
| `render.yaml` | `volumes/05-configuration.md` |
| `.env.example` | `volumes/05-configuration.md` |
| Arborescence complète (`apps/`, `packages/`, `prisma/`, `docs/`, `scripts/`) | `volumes/07-arborescence.md` |
| `apps/api/src/index.ts` | `volumes/08-cycle-demarrage.md` |
| `apps/api/src/app.ts` | `volumes/08-cycle-demarrage.md` |
| `apps/web/src/main.tsx` | `volumes/08-cycle-demarrage.md` |
| `apps/web/src/App.tsx` | `volumes/08-cycle-demarrage.md`, `volumes/10-navigation-etat.md` |
| `apps/web/src/components/EcranDemarrage.tsx` | `volumes/08-cycle-demarrage.md` |
| `apps/web/src/components/ChargementModule.tsx` | `volumes/08-cycle-demarrage.md` |
| `apps/web/src/components/Layout.tsx` | `volumes/09-ui-composants.md` |
| `apps/web/src/components/ui/badge.tsx` | `volumes/09-ui-composants.md` |
| `apps/web/src/components/ui/button.tsx` | `volumes/09-ui-composants.md` |
| `apps/web/src/components/ui/card.tsx` | `volumes/09-ui-composants.md` |
| `apps/web/src/components/ui/carte-ligne.tsx` | `volumes/09-ui-composants.md` |
| `apps/web/src/components/ui/dialog.tsx` | `volumes/09-ui-composants.md` |
| `apps/web/src/components/ui/input.tsx` | `volumes/09-ui-composants.md` |
| `apps/web/src/components/ui/label.tsx` | `volumes/09-ui-composants.md` |
| `apps/web/src/components/ui/select.tsx` | `volumes/09-ui-composants.md` |
| `apps/web/src/components/ui/sheet.tsx` | `volumes/09-ui-composants.md` |
| `apps/web/src/components/ui/table.tsx` | `volumes/09-ui-composants.md` |
| `apps/web/src/components/ui/textarea.tsx` | `volumes/09-ui-composants.md` |
| `apps/api/src/routes/stocks.ts` | `volumes/11z-1-stocks-fournisseurs-produits.md` |
| `apps/api/src/services/stocks.ts` | `volumes/11z-1-stocks-fournisseurs-produits.md` |
| `apps/api/src/routes/fournisseurs.ts` | `volumes/11z-1-stocks-fournisseurs-produits.md` |
| `apps/api/src/routes/produits.ts` | `volumes/11z-1-stocks-fournisseurs-produits.md` |
| `apps/web/src/pages/Stocks.tsx` | `volumes/11z-1-stocks-fournisseurs-produits.md` |
| `apps/web/src/pages/Fournisseurs.tsx` | `volumes/11z-1-stocks-fournisseurs-produits.md` |
| `apps/web/src/pages/Produits.tsx` | `volumes/11z-1-stocks-fournisseurs-produits.md` |
| `apps/api/src/routes/production.ts` | `volumes/11z-2-production.md` |
| `apps/api/src/services/pdf.ts` — `construirePdfBonsLivraison`, `nomFichierPdf` | `volumes/11z-2-production.md` |
| `apps/web/src/pages/Production.tsx` | `volumes/11z-2-production.md` |
| `apps/web/src/pages/BonsLivraison.tsx` | `volumes/11z-2-production.md` |
| `apps/api/src/routes/departements.ts` | `volumes/11z-3-departements-zones-clients.md` |
| `apps/api/src/routes/zones-depositaires.ts` | `volumes/11z-3-departements-zones-clients.md` |
| `apps/api/src/routes/clients.ts` | `volumes/11z-3-departements-zones-clients.md` |
| `apps/web/src/components/DepartementsCard.tsx` | `volumes/11z-3-departements-zones-clients.md` |
| `apps/web/src/components/ZonesDepositaireCard.tsx` | `volumes/11z-3-departements-zones-clients.md` |
| `apps/web/src/components/DialogNouvelleZone.tsx` | `volumes/11z-3-departements-zones-clients.md` |
| `apps/web/src/pages/Clients.tsx` | `volumes/11z-3-departements-zones-clients.md` |
| `apps/api/src/routes/notifications.ts` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `apps/api/src/services/notifications.ts` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `apps/api/src/routes/etat-systeme.ts` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `apps/api/src/services/sauvegarde.ts` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `apps/api/src/services/sauvegardeLocale.ts` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `apps/api/src/services/planificateurSauvegarde.ts` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `apps/api/src/services/reinitialisation.ts` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `apps/api/src/routes/parametres.ts` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `apps/api/src/routes/premierLancement.ts` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `apps/web/src/pages/EtatSysteme.tsx` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `apps/web/src/pages/Parametres.tsx` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `apps/web/src/pages/PremierLancement.tsx` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `apps/web/src/components/NotificationBell.tsx` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `apps/api/src/routes/apropos.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/web/src/pages/APropos.tsx` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/api/src/services/emailPro.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/api/src/lib/cloudflareEmail.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/web/src/components/PanneauEmailPro.tsx` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/api/src/routes/assistant.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/api/src/lib/ia.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/web/src/pages/Assistant.tsx` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/api/src/routes/rapports.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/api/src/routes/rapports-personnels.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/web/src/pages/RapportsPersonnels.tsx` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/api/src/routes/export.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/api/src/services/email.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/api/src/services/pdf.ts` (`construirePdf` générique) | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/web/src/components/BarreExport.tsx` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `apps/api/src/lib/realtime.ts` | `volumes/12-api-reseau.md` |
| `apps/api/src/lib/events.ts` | `volumes/12-api-reseau.md` |
| `apps/web/src/lib/socket.tsx` | `volumes/12-api-reseau.md` |
| `apps/web/src/components/ActivityFeed.tsx` | `volumes/12-api-reseau.md` |
| `apps/web/src/components/IndicateurConnexion.tsx` | `volumes/12-api-reseau.md` |
| `apps/api/src/lib/origines.ts` | `volumes/14-authentification-securite.md` |
| `apps/api/src/lib/logger.ts` | `volumes/16-erreurs-journalisation.md` |
| `apps/api/src/app.ts` — middleware d'erreur centralisé | `volumes/16-erreurs-journalisation.md` |
| `apps/web/src/i18n/index.ts` | `volumes/17-i18n.md` |
| `apps/web/src/i18n/fr.json`, `en.json`, `ln.json`, `sw.json` | `volumes/17-i18n.md` |
| `apps/api/src/lib/parametres.ts` | `volumes/18a-parametres-intervention-admin-restauration.md` |
| `apps/api/src/services/interventionsAdmin.ts` | `volumes/18a-parametres-intervention-admin-restauration.md` |
| `scripts/restaurer-sauvegarde.ts` | `volumes/18a-parametres-intervention-admin-restauration.md` |
| `apps/web/src/lib/theme.tsx` | `volumes/18b-theme-csv-utils-feedback.md` |
| `apps/web/src/lib/csv.ts` | `volumes/18b-theme-csv-utils-feedback.md` |
| `apps/web/src/lib/utils.ts` | `volumes/18b-theme-csv-utils-feedback.md` |
| `apps/web/src/components/FeedbackProvider.tsx` | `volumes/18b-theme-csv-utils-feedback.md` |
| `apps/web/src/pages/Dashboard.tsx` | `volumes/18c-dashboard-profil.md` |
| `apps/web/src/pages/Profil.tsx` | `volumes/18c-dashboard-profil.md` |
| `package.json` (racine) | `volumes/18d-configuration-outillage.md` |
| `apps/api/package.json` | `volumes/18d-configuration-outillage.md` |
| `apps/api/tsconfig.json` | `volumes/18d-configuration-outillage.md` |
| `apps/web/package.json` | `volumes/18d-configuration-outillage.md` |
| `apps/web/tsconfig.json` | `volumes/18d-configuration-outillage.md` |
| `apps/web/vite.config.ts` | `volumes/18d-configuration-outillage.md` |
| `apps/web/components.json` | `volumes/18d-configuration-outillage.md` |
| `packages/shared/package.json` | `volumes/18d-configuration-outillage.md` |
| `vitest.config.ts` | `volumes/18d-configuration-outillage.md`, `volumes/19-tests.md` (stratégie) |
| `packages/shared/src/index.test.ts` (angle stratégie) | `volumes/19-tests.md` |
| `apps/api/src/services/stocks.ts` (angle performance) | `volumes/20-performances.md` |
| `prisma/schema.prisma` (indexation, angle performance) | `volumes/20-performances.md` |
| `DEPLOIEMENT.md` | `volumes/21-build-deploiement.md` |
| `docs/MISE-EN-PRODUCTION.md` | `volumes/21-build-deploiement.md` |
| `render.yaml` (rappel architecture, angle déploiement) | `volumes/21-build-deploiement.md` |

*(Tous les fichiers de code du projet sont désormais couverts par au moins un chapitre — voir `MATRICE_DE_COUVERTURE.md` pour l'état détaillé de chacun.)*

## Par symbole (fonctions, composants, routes déjà expliqués)

| Symbole | Fichier | Chapitre |
|---|---|---|
| `calculerCommande` | `packages/shared/src/index.ts` | `volumes/11a-noyau-financier-permissions.md` |
| `avanceAvantCommande` | `packages/shared/src/index.ts` | `volumes/11a-noyau-financier-permissions.md` |
| `calculerDepenseFarine` | `packages/shared/src/index.ts` | `volumes/11a-noyau-financier-permissions.md` |
| `aAcces` | `packages/shared/src/index.ts` | `volumes/11a-noyau-financier-permissions.md` |
| `CalculCommande` (type de retour) | `packages/shared/src/index.ts` | `volumes/11a-noyau-financier-permissions.md` |
| `signToken` / `verifyToken` | `apps/api/src/lib/jwt.ts` | `volumes/11b-authentification-permissions-bout-en-bout.md` |
| `requireAuth` | `apps/api/src/middleware/auth.ts` | `volumes/11b-authentification-permissions-bout-en-bout.md` |
| `requirePermission` | `apps/api/src/middleware/auth.ts` | `volumes/11b-authentification-permissions-bout-en-bout.md` |
| `chargerUtilisateur` | `apps/api/src/middleware/auth.ts` | `volumes/11b-authentification-permissions-bout-en-bout.md` |
| `api` / `ApiError` | `apps/web/src/lib/api.ts` | `volumes/11b-authentification-permissions-bout-en-bout.md` |
| `AuthProvider` / `useAuth` | `apps/web/src/lib/auth.tsx` | `volumes/11b-authentification-permissions-bout-en-bout.md` |
| `peutLire` / `peutEcrire` | `apps/web/src/lib/auth.tsx` | `volumes/11b-authentification-permissions-bout-en-bout.md` |
| `authRouter` (`/login`, `/me`, `/mot-de-passe`, `/langue`, `/etat-initial`, `/langue-defaut`) | `apps/api/src/routes/auth.ts` | `volumes/11c-connexion.md` |
| `LoginPage` | `apps/web/src/pages/Login.tsx` | `volumes/11c-connexion.md` |
| `invaliderSessionUtilisateur` | `apps/api/src/lib/realtime.ts` | `volumes/11c-connexion.md` (introduction ; détail complet au Volume 12) |
| `verifierQuotaAdmins` | `apps/api/src/routes/equipe.ts` | `volumes/11d-equipe-roles-permissions.md` |
| `equipeRouter` (comptes, `/principal`, `/activation`) | `apps/api/src/routes/equipe.ts` | `volumes/11d-equipe-roles-permissions.md` |
| `rolesRouter` (`/`, `/:id/permissions`) | `apps/api/src/routes/roles.ts` | `volumes/11d-equipe-roles-permissions.md` |
| `EquipePage` / `messageApprobation` | `apps/web/src/pages/Equipe.tsx` | `volumes/11d-equipe-roles-permissions.md` |
| `delegationsRouter` (`GET /`, `POST /`, `DELETE /:id`) | `apps/api/src/routes/delegations.ts` | `volumes/11e-delegations.md` |
| `delegationCreateSchema` | `packages/shared/src/index.ts` | `volumes/11e-delegations.md` |
| `versDTO` (délégations) | `apps/api/src/routes/delegations.ts` | `volumes/11e-delegations.md` |
| `EXECUTEURS` / `executerAction` / `traiterActionCritique` / `ErreurAction` | `apps/api/src/services/actionsCritiques.ts` | `volumes/11f-approbations.md` |
| `approbationsRouter` (`GET /`, `POST /:id/approuver`, `POST /:id/rejeter`) | `apps/api/src/routes/approbations.ts` | `volumes/11f-approbations.md` |
| `ApprobationsPage` / `BadgeStatut` | `apps/web/src/pages/Approbations.tsx` | `volumes/11f-approbations.md` |
| `extensionAudit` / `normaliser` / `alignerCles` | `apps/api/src/lib/audit.ts` | `volumes/11g-journal-audit.md` |
| `contexteRequete` | `apps/api/src/lib/contexteRequete.ts` | `volumes/11g-journal-audit.md` |
| `prisma` (client étendu) / `TxClient` | `apps/api/src/lib/prisma.ts` | `volumes/11g-journal-audit.md` |
| `auditRouter` (`GET /`) | `apps/api/src/routes/audit.ts` | `volumes/11g-journal-audit.md` |
| `AuditPage` / `champsPertinents` | `apps/web/src/pages/Audit.tsx` | `volumes/11g-journal-audit.md` |
| `commandesRouter` (`GET /resume-jour`, `/livraisons-du-jour`, `/alertes-dette`, `/`, `POST /`, `POST /:id/reglements`) | `apps/api/src/routes/commandes.ts` | `volumes/11h-commandes.md` |
| `bornesDuJour` / `verifierAlertesDette` | `apps/api/src/routes/commandes.ts` | `volumes/11h-commandes.md` |
| `CommandesPage` | `apps/web/src/pages/Commandes.tsx` | `volumes/11h-commandes.md` |
| `commissionsRouter` (`GET /`) | `apps/api/src/routes/commissions.ts` | `volumes/11i-commissions.md` |
| `montantTotalPaye` | `packages/shared/src/index.ts` | `volumes/11i-commissions.md` |
| `CommissionsPage` | `apps/web/src/pages/Commissions.tsx` | `volumes/11i-commissions.md` |
| `caisseRouter` (`GET /registre`, `PUT /taux`, `POST /depenses`, `DELETE /depenses/:id`, `PUT /depenses/farine`) | `apps/api/src/routes/caisse.ts` | `volumes/11j-caisse.md` |
| `construireRegistre` / `sacsUtilisesLe` | `apps/api/src/routes/caisse.ts` | `volumes/11j-caisse.md` |
| `CaissePage` / `Poste` | `apps/web/src/pages/Caisse.tsx` | `volumes/11j-caisse.md` |
| `versTravailleurDTO` / `validerDepartementGroupe` / `verifierCompteLie` | `apps/api/src/routes/travailleurs.ts` | `volumes/11k-1-travailleurs-fiches-pointage.md` |
| `verifierAlertesAbsenceEnAttente` | `apps/api/src/routes/travailleurs.ts` | `volumes/11k-2-travailleurs-absences-sanctions.md` |
| `calculerPaieBrute` / `peutConsulterBulletinsDe` | `apps/api/src/routes/travailleurs.ts` | `volumes/11k-3-travailleurs-paie-bulletins.md` |
| `TravailleursPage` | `apps/web/src/pages/Travailleurs.tsx` | `volumes/11k-1-travailleurs-fiches-pointage.md`, `volumes/11k-2-travailleurs-absences-sanctions.md` |
| `PaieCard` | `apps/web/src/components/PaieCard.tsx` | `volumes/11k-3-travailleurs-paie-bulletins.md` |
| `createApp` | `apps/api/src/app.ts` | `volumes/08-cycle-demarrage.md` |
| `App` / `AppAuthentifiee` / `RequiertLecture` / `RequiertEcriture` | `apps/web/src/App.tsx` | `volumes/08-cycle-demarrage.md`, `volumes/10-navigation-etat.md` |
| `EcranDemarrage` / `splashDejaVu` | `apps/web/src/components/EcranDemarrage.tsx` | `volumes/08-cycle-demarrage.md` |
| `Layout` / `ListeNavigation` / `calculerLiens` (dupliquée, jamais appelée) | `apps/web/src/components/Layout.tsx` | `volumes/09-ui-composants.md` |
| `CarteLigne` / `CarteLigneTitre` / `CarteLigneChamp` / `CarteLigneActions` | `apps/web/src/components/ui/carte-ligne.tsx` | `volumes/09-ui-composants.md` |
| `NativeSelect` | `apps/web/src/components/ui/select.tsx` | `volumes/09-ui-composants.md` |
| `Sheet` (réutilise `@radix-ui/react-dialog`) | `apps/web/src/components/ui/sheet.tsx` | `volumes/09-ui-composants.md` |
| `appliquerMouvement` / `emettreAlerteSeuil` / `ErreurStock` | `apps/api/src/services/stocks.ts` | `volumes/11z-1-stocks-fournisseurs-produits.md` |
| `stocksRouter` (`/matieres`, `/mouvements`) | `apps/api/src/routes/stocks.ts` | `volumes/11z-1-stocks-fournisseurs-produits.md` |
| `fournisseursRouter` (`/`, `/commandes`, `/commandes/:id/reception`) | `apps/api/src/routes/fournisseurs.ts` | `volumes/11z-1-stocks-fournisseurs-produits.md` |
| `produitsRouter` | `apps/api/src/routes/produits.ts` | `volumes/11z-1-stocks-fournisseurs-produits.md` |
| `productionRouter` (`/planning`, `/schema-commande`, `/bons-livraison`, `/productions`, `/ecarts`) | `apps/api/src/routes/production.ts` | `volumes/11z-2-production.md` |
| `chargerSchemaCommandeJour` / `chargerBonLivraisonJour` | `apps/api/src/routes/production.ts` | `volumes/11z-2-production.md` |
| `totalDestinationsBacs` | `packages/shared/src/index.ts` | `volumes/11z-2-production.md` |
| `construirePdfBonsLivraison` | `apps/api/src/services/pdf.ts` | `volumes/11z-2-production.md` |
| `departementsRouter` / `groupesRouter` | `apps/api/src/routes/departements.ts` | `volumes/11z-3-departements-zones-clients.md` |
| `ecritureZones` (middleware combinant `COMMANDES` OU `PRODUCTION`) | `apps/api/src/routes/zones-depositaires.ts` | `volumes/11z-3-departements-zones-clients.md` |
| `clientsRouter` / `typeClientsRouter` | `apps/api/src/routes/clients.ts` | `volumes/11z-3-departements-zones-clients.md` |
| `rolesDestinataires` / `rolesAvecLecture` / `publierEvenement` | `apps/api/src/services/notifications.ts` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `construireDump` / `coordonneesBase` | `apps/api/src/services/sauvegarde.ts` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `reinitialiserBase` | `apps/api/src/services/reinitialisation.ts` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `premierLancementRouter` (`exigerBaseVide`, 4 étapes) | `apps/api/src/routes/premierLancement.ts` | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| `declencherEmailPro` / `verifierEmailPro` / `genererAdresseProUnique` | `apps/api/src/services/emailPro.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `creerOuObtenirDestination` / `creerRegleRoutage` | `apps/api/src/lib/cloudflareEmail.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `appelerGemini` / `repondreAssistantIA` / `testerConnexionIA` | `apps/api/src/lib/ia.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `assistantRouter` (`/messages`, `/escalader`, `/conversations`) | `apps/api/src/routes/assistant.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `resoudrePortee` | `apps/api/src/routes/rapports-personnels.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `construirePdf` (générique) | `apps/api/src/services/pdf.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `envoyerRapport` | `apps/api/src/services/email.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `moduleInterdit` | `apps/api/src/routes/export.ts` | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| `initRealtime` / `getIo` / `roomUtilisateur` / `roomRole` / `invaliderSessionUtilisateur` | `apps/api/src/lib/realtime.ts` | `volumes/12-api-reseau.md` |
| `busEvenements` (`EvenementMetier`) | `apps/api/src/lib/events.ts` | `volumes/12-api-reseau.md` |
| `SocketProvider` / `useSocket` | `apps/web/src/lib/socket.tsx` | `volumes/12-api-reseau.md` |
| `verifierOrigine` | `apps/api/src/lib/origines.ts` | `volumes/14-authentification-securite.md` |
| `logger` (`info`/`warn`/`error`) / `remplacantErreur` | `apps/api/src/lib/logger.ts` | `volumes/16-erreurs-journalisation.md` |
| `appliquerLangue` / `RESSOURCES` | `apps/web/src/i18n/index.ts` | `volumes/17-i18n.md` |
| `lireParametre` / `ecrireParametre` | `apps/api/src/lib/parametres.ts` | `volumes/18a-parametres-intervention-admin-restauration.md` |
| `estHorsPerimetreAdmin` / `notifierInterventionAdmin` | `apps/api/src/services/interventionsAdmin.ts` | `volumes/18a-parametres-intervention-admin-restauration.md` |
| `initTheme` / `ThemeProvider` / `useTheme` | `apps/web/src/lib/theme.tsx` | `volumes/18b-theme-csv-utils-feedback.md` |
| `genererCSV` / `telechargerCSV` | `apps/web/src/lib/csv.ts` | `volumes/18b-theme-csv-utils-feedback.md` |
| `cn` | `apps/web/src/lib/utils.ts` | `volumes/18b-theme-csv-utils-feedback.md` |
| `FeedbackProvider` / `useFeedback` | `apps/web/src/components/FeedbackProvider.tsx` | `volumes/18b-theme-csv-utils-feedback.md` |
| `Compteur` / `CarteKPI` / `construireSections` | `apps/web/src/pages/Dashboard.tsx` | `volumes/18c-dashboard-profil.md` |
| `ProfilPage` | `apps/web/src/pages/Profil.tsx` | `volumes/18c-dashboard-profil.md` |

## Par terme métier (section de la spécification ↔ chapitre du livre)

| Section de `docs/spec-boulangerie.md` | Sujet | Chapitre du livre |
|---|---|---|
| 3.1 (registre journalier, dépense farine) | Caisse | `volumes/11a-noyau-financier-permissions.md` (formule farine), `volumes/11j-caisse.md` (écran complet) |
| 3.18 (fiche, pointage, absence, sanction, salaire/paie, bulletins) | Travailleurs | `volumes/11k-1-travailleurs-fiches-pointage.md`, `volumes/11k-2-travailleurs-absences-sanctions.md`, `volumes/11k-3-travailleurs-paie-bulletins.md` |
| 3.4 (commandes, avance/dette, doublon) | Commandes clients | `volumes/11a-noyau-financier-permissions.md` (formule), `volumes/11h-commandes.md` (écran complet) |
| 3.11 (Commissions) | Commissions | `volumes/11i-commissions.md` |
| 2 (rôles, hiérarchie, permissions, garde-fou Admin Principal) | Authentification et permissions | `volumes/11b-authentification-permissions-bout-en-bout.md` |
| 3.7 (session unique, délégations) | Authentification et permissions | `volumes/11b-authentification-permissions-bout-en-bout.md`, `volumes/11c-connexion.md` |
| 3.7 (délégation temporaire de rôle) | Délégations | `volumes/11e-delegations.md` |
| 2 (5 tâches critiques), 3.16 (Approbations) | Approbations et actions critiques | `volumes/11f-approbations.md` |
| 3.17 (Journal d'audit) | Journal d'audit | `volumes/11g-journal-audit.md` |
| 3.14 (activation/désactivation d'un compte) | Connexion | `volumes/11c-connexion.md` |
| 2 (5 tâches critiques : créer/supprimer un compte Admin, modifier permissions/taux/qualité) | Équipe, rôles et permissions | `volumes/11d-equipe-roles-permissions.md` |
| 3.7 (quota de 3 Admins, réaffectation) | Équipe, rôles et permissions | `volumes/11d-equipe-roles-permissions.md` |
| 3.2 (matières premières, mouvements, seuils) | Stocks | `volumes/11z-1-stocks-fournisseurs-produits.md` |
| 3.6 (fournisseurs, bons de commande, réception) | Fournisseurs | `volumes/11z-1-stocks-fournisseurs-produits.md` |
| 3.9 (catalogue produits, prix, taxes) | Produits/Paramètres | `volumes/11z-1-stocks-fournisseurs-produits.md` |
| 3.3 a-e (planning, productions, ingrédients, schéma de commande, bon de livraison) | Production | `volumes/11z-2-production.md` |
| 3.18 (départements, groupes) | Départements/Groupes | `volumes/11z-3-departements-zones-clients.md` |
| 3.3 d (zones de dépôt) | Zones de dépôt | `volumes/11z-3-departements-zones-clients.md` |
| 3.4 (clients, qualités) | Clients | `volumes/11z-3-departements-zones-clients.md` |
| 3.10 (notifications temps réel, ciblage hiérarchique) | Notifications | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| 3.15 (État système, sauvegardes, réinitialisation) | État système | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| 3.9 (paramètres boutique, langue par défaut) | Paramètres | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| 3.7 (Assistant de premier lancement) | Premier lancement | `volumes/11z-4-notifications-etat-systeme-parametres.md` |
| 3.12 (À propos) | À propos | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| 3.18 (email professionnel, Cloudflare) | Email pro | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| 3.19 (Assistant, chat, IA) | Assistant | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| 3.13 (Rapports personnels, export/partage) | Rapports personnels, Export | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| 3.8 (widgets Tableau de bord) | Rapports (widgets) | `volumes/11z-5-apropos-assistant-export-rapports.md` |
| 2 (garde-fou intervention Admin Principal hors périmètre) | Notification d'intervention Admin | `volumes/18a-parametres-intervention-admin-restauration.md` |
| 3.15 (État système) — restauration, hors périmètre applicatif | Restauration de sauvegarde | `volumes/18a-parametres-intervention-admin-restauration.md` |
| 3.8 (widgets Tableau de bord, composition par rôle, résumé de clôture) | Tableau de bord (écran) | `volumes/18c-dashboard-profil.md` |
| 2/3.7 (mot de passe), 3.9 (langue individuelle), 3.18 (bulletins personnels) | Profil individuel | `volumes/18c-dashboard-profil.md` |
| 1 (vue d'ensemble technique, monorepo npm workspaces) | Configuration et outillage | `volumes/18d-configuration-outillage.md` |
| 7 (stack technique), 3.15 (sauvegarde/restauration) | Construction et déploiement | `volumes/21-build-deploiement.md` |
| 3.7 (premier lancement, session unique), 3.14 (activation/désactivation) | Premiers pas (guide utilisateur) | `volumes/22a-premiers-pas.md` |
| 2 (rôles, hiérarchie, permissions, garde-fou Admin Principal, 5 tâches critiques) | Rôles et permissions (guide utilisateur) | `volumes/22b-roles-et-permissions.md` |
| 3.4 (commandes, avance/dette/trop-perçu, doublon, clients, Qualités), 3.3 d (zones de dépôt) | Commandes et Clients (guide utilisateur) | `volumes/22c-commandes-et-clients.md` |
| 3.3 a-e (Planning, Schéma de commande, Bon de livraison, Productions, Écarts) | Production (guide utilisateur) | `volumes/22d-production.md` |
| 3.2 (stocks, seuils), 3.6 (fournisseurs, réception), 3.9 (catalogue produits) | Matières premières, Fournisseurs et Catalogue (guide utilisateur) | `volumes/22e-stocks-fournisseurs.md` |
| 3.1 (registre journalier, dépense farine, solde négatif) | Caisse (guide utilisateur) | `volumes/22f-caisse.md` |
| 3.11 (Commissions, vue dérivée, montant total payé) | Commissions (guide utilisateur) | `volumes/22g-commissions.md` |
| 3.18 (fiche, pointage, absence, sanction, salaire/paie, bulletins) | Travailleurs et Paie (guide utilisateur) | `volumes/22h-travailleurs-paie.md` |
| 2 (comptes, quota Admin, transfert Principal, workflow d'approbation), 3.7 (délégations) | Équipe et Approbations (guide utilisateur) | `volumes/22i-equipe-et-approbations.md` |
| 3.15 (État système, sauvegardes, réinitialisation) | État système et Sauvegardes (guide utilisateur) | `volumes/22j-etat-systeme-sauvegardes.md` |
| 3.9 (paramètres boutique), 3.12 (À propos), 3.19 (Assistant, IA optionnelle) | Paramètres, À propos et Assistant (guide utilisateur) | `volumes/22k-parametres-a-propos-assistant.md` |

---

*Index amorcé à la création du livre — se remplit à chaque chapitre rédigé. Un fichier ou symbole absent de cet index n'a simplement pas encore été traité ; consultez `ETAT_DE_PROGRESSION.md` pour savoir quand il sera couvert.*
