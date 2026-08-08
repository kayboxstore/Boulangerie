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

## Par terme métier (section de la spécification ↔ chapitre du livre)

| Section de `docs/spec-boulangerie.md` | Sujet | Chapitre du livre |
|---|---|---|
| 3.1 (dépense farine) | Registre de Caisse | `volumes/11a-noyau-financier-permissions.md` (formule), `volumes/11j-caisse.md` (à venir, écran complet) |
| 3.4 (commandes, avance/dette) | Commandes clients | `volumes/11a-noyau-financier-permissions.md` (formule), `volumes/11h-commandes.md` (à venir, écran complet) |
| 2 (rôles, hiérarchie, permissions, garde-fou Admin Principal) | Authentification et permissions | `volumes/11b-authentification-permissions-bout-en-bout.md` |
| 3.7 (session unique, délégations) | Authentification et permissions | `volumes/11b-authentification-permissions-bout-en-bout.md`, `volumes/11c-connexion.md` |
| 3.7 (délégation temporaire de rôle) | Délégations | `volumes/11e-delegations.md` |
| 2 (5 tâches critiques), 3.16 (Approbations) | Approbations et actions critiques | `volumes/11f-approbations.md` |
| 3.17 (Journal d'audit) | Journal d'audit | `volumes/11g-journal-audit.md` |
| 3.14 (activation/désactivation d'un compte) | Connexion | `volumes/11c-connexion.md` |
| 2 (5 tâches critiques : créer/supprimer un compte Admin, modifier permissions/taux/qualité) | Équipe, rôles et permissions | `volumes/11d-equipe-roles-permissions.md` |
| 3.7 (quota de 3 Admins, réaffectation) | Équipe, rôles et permissions | `volumes/11d-equipe-roles-permissions.md` |

---

*Index amorcé à la création du livre — se remplit à chaque chapitre rédigé. Un fichier ou symbole absent de cet index n'a simplement pas encore été traité ; consultez `ETAT_DE_PROGRESSION.md` pour savoir quand il sera couvert.*
