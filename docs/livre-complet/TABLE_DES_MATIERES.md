# Table des matières — Le Livre Boulangerie Lomoto

> Sommaire de haut niveau. Pour le détail des sous-sections prévues dans chaque volume, voir `PLAN_DETAILLE.md`. Pour la correspondance fichier de code → chapitre, voir `INDEX_DU_CODE.md`.
>
> État de chaque volume : ✅ Rédigé · 🟡 Partiel · ⬜ Non commencé. Mis à jour à chaque lot de travail (source de vérité : `ETAT_DE_PROGRESSION.md`).

| # | Volume | Fichier(s) dans `volumes/` | État |
|---|---|---|:---:|
| 1 | Présentation du produit et du problème résolu | `01-presentation.md` | ✅ |
| 2 | Guide de lecture et notions fondamentales | `02-guide-de-lecture.md` | ✅ |
| 3 | Technologies, langages et dépendances | `03-technologies.md` | ✅ |
| 4 | Installation de l'environnement | `04-installation.md` | ✅ |
| 5 | Configuration et variables d'environnement | `05-configuration.md` | ✅ |
| 6 | Architecture générale | `06-architecture.md` | ⬜ |
| 7 | Arborescence détaillée du projet | `07-arborescence.md` | ✅ |
| 8 | Cycle de démarrage de l'application | `08-cycle-demarrage.md` | ✅ |
| 9 | Interface utilisateur et composants | `09-ui-composants.md` | ✅ |
| 10 | Navigation et gestion de l'état | `10-navigation-etat.md` | ✅ |
| 11 | Back-end, services et règles métier | `11a` à `11z` (voir détail ci-dessous) | 🟡 |
| 12 | API et communications réseau | `12-api-reseau.md` | ⬜ |
| 13 | Base de données et migrations | `13-base-de-donnees.md` | ✅ |
| 14 | Authentification, autorisations et sécurité (synthèse transversale) | `14-authentification-securite.md` | ⬜ |
| 15 | Validation des données | `15-validation.md` | ⬜ |
| 16 | Gestion des erreurs et journalisation | `16-erreurs-journalisation.md` | ⬜ |
| 17 | Internationalisation | `17-i18n.md` | ⬜ |
| 18 | Explication exhaustive des fichiers sources restants | `18a` à `18z` (Niveau 2/3 non couverts ailleurs) | ⬜ |
| 19 | Tests et stratégie de vérification | `19-tests.md` | ⬜ |
| 20 | Performances | `20-performances.md` | ⬜ |
| 21 | Construction et déploiement | `21-build-deploiement.md` | ⬜ |
| 22 | Guide complet d'utilisation | `22a` à `22z` (un chapitre par rôle/écran) | ⬜ |
| 23 | Administration et maintenance | `23-administration-maintenance.md` | ⬜ |
| 24 | Débogage et résolution des problèmes | `24-debogage.md` | ⬜ |
| 25 | Possibilités d'évolution | `25-evolutions.md` | ⬜ |
| 26 | Glossaire, index et annexes | voir `GLOSSAIRE.md`, `INDEX_DU_CODE.md`, `annexes/` | 🟡 |

## Détail du Volume 11 (Back-end, services et règles métier)

Ce volume est scindé en un chapitre par domaine fonctionnel, dans l'ordre de priorité Niveau 1 → Niveau 2 imposé par le mandat :

| Chapitre | Fichier(s) de code couverts | Niveau | État |
|---|---|:---:|:---:|
| `11a-noyau-financier-permissions.md` | `packages/shared/src/index.ts` (fonctions `calculerCommande`, `avanceAvantCommande`, `calculerDepenseFarine`, `aAcces`) | 1 | ✅ |
| `11b-authentification-permissions-bout-en-bout.md` | `apps/api/src/lib/jwt.ts`, `apps/api/src/middleware/auth.ts`, `apps/web/src/lib/auth.tsx`, `apps/web/src/lib/api.ts` | 1 | ✅ |
| `11c-connexion.md` | `apps/api/src/routes/auth.ts`, `apps/web/src/pages/Login.tsx` | 1 | ✅ |
| `11d-equipe-roles-permissions.md` | `apps/api/src/routes/equipe.ts`, `apps/api/src/routes/roles.ts`, `apps/web/src/pages/Equipe.tsx` | 1 | ✅ |
| `11e-delegations.md` | `apps/api/src/routes/delegations.ts` | 1 | ✅ |
| `11f-approbations.md` | `apps/api/src/services/actionsCritiques.ts`, `apps/api/src/routes/approbations.ts`, `apps/web/src/pages/Approbations.tsx` | 1 | ✅ |
| `11g-journal-audit.md` | `apps/api/src/lib/audit.ts` | 1 | ✅ |
| `11h-commandes.md` | `apps/api/src/routes/commandes.ts`, `apps/web/src/pages/Commandes.tsx` | 1 | ✅ |
| `11i-commissions.md` | `apps/api/src/routes/commissions.ts`, `apps/web/src/pages/Commissions.tsx` | 1 | ✅ |
| `11j-caisse.md` | `apps/api/src/routes/caisse.ts`, `apps/web/src/pages/Caisse.tsx` | 1 | ✅ |
| `11k-1-travailleurs-fiches-pointage.md` | `apps/api/src/routes/travailleurs.ts` (fiches, e-mail pro, pointage), `apps/web/src/pages/Travailleurs.tsx` (partiel) | 1 | ✅ |
| `11k-2-travailleurs-absences-sanctions.md` | `apps/api/src/routes/travailleurs.ts` (absences, sanctions), `apps/web/src/pages/Travailleurs.tsx` (partiel) | 1 | ✅ |
| `11k-3-travailleurs-paie-bulletins.md` | `apps/api/src/routes/travailleurs.ts` (paie, bulletins), `apps/web/src/components/PaieCard.tsx` | 1 | ✅ |
| `11z-1-stocks-fournisseurs-produits.md` | `routes/stocks.ts`, `services/stocks.ts`, `routes/fournisseurs.ts`, `routes/produits.ts`, `pages/Stocks.tsx`, `pages/Fournisseurs.tsx`, `pages/Produits.tsx` | 2 | ✅ |
| `11z-2-production.md` | `routes/production.ts`, `pages/Production.tsx`, `pages/BonsLivraison.tsx`, `services/pdf.ts` (partiel) | 2 | ✅ |
| `11z-3-departements-zones-clients.md` | `routes/departements.ts`, `routes/zones-depositaires.ts`, `routes/clients.ts`, `DepartementsCard.tsx`, `ZonesDepositaireCard.tsx`, `DialogNouvelleZone.tsx`, `pages/Clients.tsx` | 2 | ✅ |
| `11z-4` à `11z-n` (à venir) | Notifications, État système, Paramètres (boutique), Premier lancement, À propos, Assistant, Export, Rapports, Rapports personnels | 2 | ⬜ |

## Détail du Volume 22 (Guide complet d'utilisation)

Un chapitre par grande zone fonctionnelle, écrit en croisant `docs/spec-boulangerie.md` et une vérification réelle de l'écran quand c'est possible sans risque :

| Chapitre | Contenu | État |
|---|---|:---:|
| `22a-premiers-pas.md` | Installation, premier démarrage, création du premier compte, connexion/déconnexion | ⬜ |
| `22b-roles-et-permissions.md` | Les rôles de l'application et ce que chacun peut faire | ⬜ |
| `22c-commandes-et-clients.md` | Écran Commandes + sous-module Clients | ⬜ |
| `22d-production.md` | Planning, Schéma de commande, Bon de livraison | ⬜ |
| `22e-stocks-fournisseurs.md` | Matières premières, mouvements, fournisseurs, achats | ⬜ |
| `22f-caisse.md` | Registre journalier | ⬜ |
| `22g-commissions.md` | Consultation des commissions | ⬜ |
| `22h-travailleurs-paie.md` | Fiches, pointages, absences, sanctions, bulletins de paie | ⬜ |
| `22i-equipe-et-approbations.md` | Comptes, rôles, délégations, approbations | ⬜ |
| `22j-etat-systeme-sauvegardes.md` | Sauvegarde, restauration, réinitialisation | ⬜ |
| `22k-parametres-a-propos-assistant.md` | Paramètres, page À propos, Assistant | ⬜ |
| `22l-rapports-et-exports.md` | Rapports personnels, exports CSV/PDF/e-mail | ⬜ |

---

*Ce sommaire évoluera au fur et à mesure de la rédaction — notamment le découpage exact du Volume 11k (Travailleurs/Paie) et du Volume 18 (fichiers restants), qui seront précisés une fois ces chapitres entamés.*
