import { Prisma } from "@prisma/client";
import { MODULES } from "@lomoto/shared";
import type { Module, NiveauAcces } from "@lomoto/shared";
import type { prisma as prismaApp, TxClient } from "../lib/prisma.js";
import { contexteRequete } from "../lib/contexteRequete.js";

/**
 * Piste d'audit dédiée, transactionnelle, pour l'action critique
 * `MODIFIER_PERMISSIONS_ROLE` (correctif P1 — contre-revue Codex de l'audit
 * complet du 24/08/2026).
 *
 * Défaut corrigé : `EXECUTEURS.MODIFIER_PERMISSIONS_ROLE` (`actionsCritiques.ts`)
 * écrit `RolePermission` via `upsert`/`deleteMany`. L'extension Prisma
 * générale d'audit (`lib/audit.ts`) n'intercepte que `update`/`delete`
 * singuliers — jamais `upsert`, jamais `*Many`, jamais `create` — donc AUCUNE
 * de ces écritures n'était journalisée, y compris quand l'acteur est
 * l'Administrateur Principal (qui exécute cette action immédiatement, sans
 * passer par le workflow d'approbation qui aurait pu laisser une trace
 * alternative). La modification de permissions la plus sensible du système
 * ne laissait donc aucune trace exploitable.
 *
 * Choix de conception (voir contraintes de la mission) :
 *  - AUCUN changement de schéma Prisma : le correctif réutilise le modèle
 *    `AuditLog` existant tel quel (mêmes colonnes), en tirant parti de la
 *    souplesse de ses champs JSON `avant`/`apres` pour porter l'état complet
 *    des permissions ET les métadonnées propres à cette action (demandeur,
 *    diff). Rien n'est stocké qui ne soit pas dérivable de `avant`/`apres`
 *    OU absent du modèle de données réel du workflow d'approbation.
 *  - `lib/audit.ts` (l'extension générale) n'est PAS modifiée — un correctif
 *    ciblé, propre à cette action sensible, est ajouté à côté plutôt que de
 *    complexifier un mécanisme générique conçu pour `update`/`delete` afin
 *    de lui faire comprendre `upsert`/`*Many`, ce qui l'aurait rendu plus
 *    fragile pour tous les autres modèles qu'il couvre déjà correctement.
 *  - Une SEULE ligne `AuditLog` est écrite par exécution réussie (jamais une
 *    par permission modifiée) : elle porte l'état COMPLET (les 10 modules,
 *    y compris ceux à `AUCUN`) avant et après, trié par ordre alphabétique
 *    de module — déterministe, indépendant de l'ordre de retour des lignes
 *    par PostgreSQL. Les permissions ajoutées/retirées/modifiées sont
 *    calculées par comparaison pure de ces deux instantanés complets
 *    (`calculerDiffPermissions`), jamais stockées séparément : aucune
 *    désynchronisation possible entre le diff et l'état qu'il est censé
 *    résumer.
 *  - L'écriture d'audit a lieu DANS LA MÊME transaction Prisma que les
 *    écritures `RolePermission`, en dernière position : si une écriture de
 *    permission échoue, l'exécution s'arrête avant même d'atteindre
 *    l'écriture d'audit (rien n'est journalisé) ; si l'écriture d'audit
 *    échoue, PostgreSQL annule (ROLLBACK) la transaction entière, y compris
 *    les écritures de permission déjà appliquées plus tôt dans la même
 *    transaction. Aucun état partiel, jamais.
 */

export interface EntreePermission {
  module: Module;
  niveauAcces: NiveauAcces;
}

export interface DiffPermissions {
  ajouts: EntreePermission[];
  retraits: EntreePermission[];
  modifications: { module: Module; avant: NiveauAcces; apres: NiveauAcces }[];
}

export interface InstantanePermissionsRole {
  roleId: string;
  roleNom: string;
  permissions: EntreePermission[];
}

export interface IdentiteActeur {
  id: string;
  nom: string;
}

export interface ResultatModificationPermissionsRole {
  roleNom: string;
  avant: EntreePermission[];
  apres: EntreePermission[];
  diff: DiffPermissions;
}

/**
 * Levée quand l'action s'exécute hors contexte de requête authentifiée
 * (`contexteRequete` vide). Sans acteur identifié, aucune piste d'audit
 * fiable n'est possible : l'action entière est refusée plutôt que
 * silencieusement non tracée (contrairement à l'extension générale, qui se
 * contente de ne pas auditer hors contexte — acceptable pour elle car elle
 * couvre des écritures non critiques ; inacceptable ici).
 */
export class ErreurActeurRequisPourAudit extends Error {
  constructor() {
    super(
      "Modification des permissions d'un rôle refusée : aucun acteur authentifié dans le contexte de requête — " +
        "impossible de produire une piste d'audit fiable pour cette action sensible.",
    );
  }
}

// Ordre alphabétique fixe, calculé une seule fois : source unique de
// déterminisme pour tous les instantanés et diffs de ce module.
const MODULES_TRIES = [...MODULES].sort() as Module[];

/**
 * Reconstruit l'état COMPLET des permissions d'un rôle : les 10 modules,
 * y compris ceux sans ligne `RolePermission` (implicitement `AUCUN`), triés
 * par ordre alphabétique de module.
 */
async function instantane(tx: TxClient, roleId: string, roleNom: string): Promise<InstantanePermissionsRole> {
  const lignes = await tx.rolePermission.findMany({ where: { roleId }, select: { module: true, niveauAcces: true } });
  const parModule = new Map<string, string>(lignes.map((l) => [l.module, l.niveauAcces]));
  const permissions: EntreePermission[] = MODULES_TRIES.map((module) => ({
    module,
    niveauAcces: (parModule.get(module) ?? "AUCUN") as NiveauAcces,
  }));
  return { roleId, roleNom, permissions };
}

/**
 * Partition déterministe et exhaustive (ajout / retrait / modification),
 * calculée UNIQUEMENT par comparaison des deux instantanés complets — jamais
 * stockée séparément de `avant`/`apres`, toujours dérivable d'eux.
 *  - ajout : le module était `AUCUN` avant, ne l'est plus après ;
 *  - retrait : le module n'était pas `AUCUN` avant, l'est devenu après ;
 *  - modification : le module n'était `AUCUN` ni avant ni après, mais le
 *    niveau d'accès diffère (ex. LECTURE → ECRITURE).
 */
export function calculerDiffPermissions(avant: EntreePermission[], apres: EntreePermission[]): DiffPermissions {
  const avantParModule = new Map(avant.map((p) => [p.module, p.niveauAcces]));
  const apresParModule = new Map(apres.map((p) => [p.module, p.niveauAcces]));
  const diff: DiffPermissions = { ajouts: [], retraits: [], modifications: [] };
  for (const module of MODULES_TRIES) {
    const av = avantParModule.get(module) ?? "AUCUN";
    const ap = apresParModule.get(module) ?? "AUCUN";
    if (av === ap) continue;
    if (av === "AUCUN") diff.ajouts.push({ module, niveauAcces: ap });
    else if (ap === "AUCUN") diff.retraits.push({ module, niveauAcces: av });
    else diff.modifications.push({ module, avant: av, apres: ap });
  }
  return diff;
}

/**
 * Applique une nouvelle matrice de permissions à un rôle ET journalise
 * l'opération, DANS LA MÊME transaction PostgreSQL Serializable — logique
 * atomique partagée entre `EXECUTEURS.MODIFIER_PERMISSIONS_ROLE`
 * (`actionsCritiques.ts`) et `scripts/verifier-audit-permissions-role-ci.ts`,
 * qui l'exerce telle quelle contre une vraie base PostgreSQL (même
 * convention que `services/principal.ts` pour
 * `scripts/verifier-concurrence-equipe-ci.ts` : jamais de réimplémentation
 * parallèle qui pourrait diverger du code de production réel).
 *
 * `demandePar` distingue le demandeur d'origine (Admin secondaire dont la
 * demande a été approuvée) de l'acteur qui a réellement exécuté/autorisé
 * l'écriture (lu via `contexteRequete` — l'Admin Principal, que ce soit en
 * exécution directe ou en approbation). `null` quand l'action a été exécutée
 * directement par l'Admin Principal, sans détour par le workflow
 * d'approbation : dans ce cas demandeur et exécutant sont la même personne,
 * déjà portée par `utilisateurId`/`utilisateurNom` de la ligne `AuditLog`.
 */
export async function appliquerModificationPermissionsRole(
  db: typeof prismaApp,
  roleId: string,
  permissions: EntreePermission[],
  demandePar: IdentiteActeur | null,
): Promise<ResultatModificationPermissionsRole> {
  return db.$transaction(
    async (tx) => {
      const role = await tx.role.findUniqueOrThrow({ where: { id: roleId } });

      const avantSnap = await instantane(tx, roleId, role.nom);

      for (const p of permissions) {
        await tx.rolePermission.upsert({
          where: { roleId_module: { roleId, module: p.module } },
          update: { niveauAcces: p.niveauAcces },
          create: { roleId, module: p.module, niveauAcces: p.niveauAcces },
        });
      }
      // Les modules absents de la liste (ou passés à AUCUN) sont retirés —
      // comportement métier inchangé, identique à l'original.
      const gardes = permissions.filter((p) => p.niveauAcces !== "AUCUN").map((p) => p.module);
      await tx.rolePermission.deleteMany({
        where: { roleId, module: { notIn: gardes.length ? gardes : ["CAISSE"] } },
      });
      if (!gardes.length) await tx.rolePermission.deleteMany({ where: { roleId } });

      const apresSnap = await instantane(tx, roleId, role.nom);
      const diff = calculerDiffPermissions(avantSnap.permissions, apresSnap.permissions);

      // Toujours journalisé, même quand `diff` est entièrement vide (aucun
      // changement réel — ex. resoumission exacte de l'état courant) :
      // l'audit enregistre alors fidèlement « cette personne a confirmé cet
      // état à cette date », ce qui reste une information de gouvernance
      // légitime, plutôt que de faire dépendre l'existence d'une trace d'un
      // calcul de no-op. Comportement volontaire, prouvé par un test dédié.
      const acteur = contexteRequete.getStore();
      if (!acteur) throw new ErreurActeurRequisPourAudit();

      await tx.auditLog.create({
        data: {
          utilisateurId: acteur.id,
          utilisateurNom: acteur.nom,
          module: "EQUIPE" as Prisma.AuditLogCreateInput["module"],
          typeEntite: "Role",
          entiteId: roleId,
          action: "MODIFICATION",
          avant: avantSnap as unknown as Prisma.InputJsonValue,
          apres: { ...apresSnap, demandePar, diff } as unknown as Prisma.InputJsonValue,
        },
      });

      return { roleNom: role.nom, avant: avantSnap.permissions, apres: apresSnap.permissions, diff };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
