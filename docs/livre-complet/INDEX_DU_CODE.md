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

*(Le reste des 155 fichiers du projet apparaîtra ici au fur et à mesure — voir `MATRICE_DE_COUVERTURE.md` pour la liste complète et leur état actuel.)*

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

---

*Index amorcé à la création du livre — se remplit à chaque chapitre rédigé. Un fichier ou symbole absent de cet index n'a simplement pas encore été traité ; consultez `ETAT_DE_PROGRESSION.md` pour savoir quand il sera couvert.*
