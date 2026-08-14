import type { PrismaClient, Prisma } from "@prisma/client";
import { contexteRequete } from "./contexteRequete.js";
import { logger } from "./logger.js";

/**
 * Journal d'audit centralisé (section 3.17).
 *
 * Plutôt que de dupliquer un appel de journalisation dans chacun des ~13
 * modules, on branche une extension Prisma sur les opérations d'ÉCRITURE
 * `update` et `delete`. Les créations ne sont PAS journalisées (déjà tracées via
 * créePar/enregistrePar sur chaque entité) ; les tentatives refusées (403) non
 * plus (elles n'atteignent jamais Prisma). Seules les actions RÉUSSIES sont
 * enregistrées : si `query()` échoue, on ne journalise rien.
 *
 * L'auteur est lu dans le contexte de requête (AsyncLocalStorage) : toute
 * écriture déclenchée dans le fil d'une requête authentifiée — y compris
 * l'exécution différée d'une tâche critique par le workflow d'approbation — est
 * ainsi attribuée à la bonne personne.
 */

// Correspondance modèle Prisma → module applicatif (pour le filtrage). Les
// modèles absents de cette table ne sont pas audités : c'est le cas de
// Notification (système, haut volume), d'AuditLog lui-même, et de
// SauvegardeBase (journal en AJOUT SEUL — aucun update ni delete à intercepter).
// Ajouter ici tout nouveau modèle qui, lui, se modifie ou se supprime.
const MODELE_MODULE: Record<string, string> = {
  // Équipe & droits d'accès
  Utilisateur: "EQUIPE",
  Role: "EQUIPE",
  RolePermission: "EQUIPE",
  DemandeApprobation: "EQUIPE",
  DelegationRole: "EQUIPE",
  // Paramètres
  Produit: "PARAMETRES",
  TypeClient: "PARAMETRES",
  ParametreBoutique: "PARAMETRES",
  // Commandes clients
  Client: "COMMANDES",
  CommandeClient: "COMMANDES",
  PaiementCommande: "COMMANDES",
  // Zones de dépôt (3.3 d) — organisationnel, sans permission propre,
  // gouverné par le module COMMANDES (rattachées à la fiche Client).
  ZoneDepositaire: "COMMANDES",
  // Caisse — registre journalier (3.1). Vente/LigneVente/ClotureCaisse sont
  // orphelines depuis la refonte : plus rien ne les écrit, rien à auditer.
  TauxDuJour: "CAISSE",
  DepenseCaisse: "CAISSE",
  // Stocks
  MatierePremiere: "STOCKS",
  MouvementStock: "STOCKS",
  // Production
  PlanningProduction: "PRODUCTION",
  PlanningLigneProduit: "PRODUCTION",
  ProductionDon: "PRODUCTION",
  MotifDon: "PRODUCTION",
  Production: "PRODUCTION",
  ProductionPerte: "PRODUCTION",
  MotifPerte: "PRODUCTION",
  ControleQualite: "PRODUCTION",
  MotifNonConformite: "PRODUCTION",
  // Schéma de commande (3.3 d)
  SchemaCommande: "PRODUCTION",
  SchemaCommandeLigne: "PRODUCTION",
  // Bon de livraison (3.3 e)
  BonLivraison: "PRODUCTION",
  BonLivraisonLigne: "PRODUCTION",
  CycleLivraison: "PRODUCTION",
  CycleLivraisonLigne: "PRODUCTION",
  TransitionCycleLivraison: "PRODUCTION",
  AnomalieCycleLivraison: "PRODUCTION",
  // Fournisseurs & achats
  Fournisseur: "FOURNISSEURS",
  CommandeFournisseur: "FOURNISSEURS",
  LigneCommandeFournisseur: "FOURNISSEURS",
  // Travailleurs
  Travailleur: "TRAVAILLEURS",
  Presence: "TRAVAILLEURS", // ORPHELINE (remplacée par Pointage/Absence, 3.18)
  Pointage: "TRAVAILLEURS",
  Absence: "TRAVAILLEURS",
  Sanction: "TRAVAILLEURS",
  BulletinPaie: "TRAVAILLEURS",
  // Départements & Groupes (3.18) — organisationnel, sans permission propre,
  // gouverné par le module TRAVAILLEURS.
  Departement: "TRAVAILLEURS",
  Groupe: "TRAVAILLEURS",
};

// Champs sensibles jamais copiés dans les instantanés avant/après.
const CLE_SENSIBLE = /hash|motdepasse|password|secret|token/i;

/** Rend une valeur Prisma sérialisable (Decimal → nombre/chaîne, Date → ISO). */
function normaliser(valeur: unknown): Record<string, unknown> | null {
  if (valeur === null || valeur === undefined) return null;
  const json = JSON.stringify(valeur, (_cle, v) => (typeof v === "bigint" ? v.toString() : v));
  const obj = JSON.parse(json);
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return null;
  // Expurge les secrets et écarte les relations imbriquées (objets/tableaux) —
  // l'instantané ne garde que les champs scalaires de l'entité.
  const propre: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (CLE_SENSIBLE.test(k)) continue;
    if (v !== null && typeof v === "object") continue;
    propre[k] = v;
  }
  return propre;
}

/** Ne garde de `apres` que les clés présentes dans `avant` (cohérence du diff). */
function alignerCles(
  apres: Record<string, unknown> | null,
  avant: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!apres) return null;
  if (!avant) return apres;
  const aligne: Record<string, unknown> = {};
  for (const k of Object.keys(avant)) if (k in apres) aligne[k] = apres[k];
  return aligne;
}

const versDelegate = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

/**
 * Construit l'extension d'audit. `base` est le client NON étendu : les lectures
 * « avant » et l'écriture du journal passent par lui pour ne pas retraverser
 * l'extension (pas de récursion, pas d'interférence avec une transaction en
 * cours — une simple lecture MVCC ne bloque pas sous PostgreSQL).
 */
export function extensionAudit(base: PrismaClient) {
  async function lireAvant(model: string, where: unknown): Promise<Record<string, unknown> | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const delegate = (base as any)[versDelegate(model)];
      const enregistrement = await delegate.findUnique({ where });
      return normaliser(enregistrement);
    } catch {
      return null;
    }
  }

  async function journaliser(
    model: string,
    action: "MODIFICATION" | "SUPPRESSION",
    avant: Record<string, unknown> | null,
    apres: Record<string, unknown> | null,
  ) {
    const acteur = contexteRequete.getStore();
    const moduleApp = MODELE_MODULE[model];
    if (!acteur || !moduleApp) return; // hors requête authentifiée ou modèle non audité
    const entiteId = String((avant?.id ?? apres?.id) ?? "?");
    try {
      await base.auditLog.create({
        data: {
          utilisateurId: acteur.id,
          utilisateurNom: acteur.nom,
          module: moduleApp as Prisma.AuditLogCreateInput["module"],
          typeEntite: model,
          entiteId,
          action,
          avant: (avant ?? undefined) as Prisma.InputJsonValue | undefined,
          apres: (apres ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (e) {
      // Un échec de journalisation ne doit jamais faire échouer l'action métier.
      logger.error("Échec d'écriture du journal d'audit", { erreur: e });
    }
  }

  // Renvoie la DÉFINITION de l'extension (appliquée par lib/prisma via $extends).
  return {
    name: "audit",
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async update({ model, args, query }: any) {
          const doitAuditer = !!MODELE_MODULE[model] && !!contexteRequete.getStore();
          const avant = doitAuditer ? await lireAvant(model, args.where) : null;
          const result = await query(args); // échec → propagé, rien n'est journalisé
          if (doitAuditer) {
            const apres = alignerCles(normaliser(result), avant);
            await journaliser(model, "MODIFICATION", avant, apres);
          }
          return result;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async delete({ model, args, query }: any) {
          const doitAuditer = !!MODELE_MODULE[model] && !!contexteRequete.getStore();
          const avant = doitAuditer ? await lireAvant(model, args.where) : null;
          const result = await query(args);
          if (doitAuditer) await journaliser(model, "SUPPRESSION", avant, null);
          return result;
        },
      },
    },
  };
}
