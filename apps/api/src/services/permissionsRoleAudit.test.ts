/**
 * Preuves du correctif P1 (contre-revue Codex, audit complet du 24/08/2026) :
 * « Les modifications des permissions d'un rôle réalisées par l'action
 * critique MODIFIER_PERMISSIONS_ROLE ne disposent pas d'une piste d'audit
 * complète et atomique. » — voir `permissionsRoleAudit.ts` pour le détail du
 * défaut et du correctif.
 *
 * Ces tests MOCKENT Prisma : un client factice en mémoire, même convention
 * que `prisma/bootstrap-production.test.ts` — `$transaction` exécute le
 * callback contre une COPIE de l'état (rôles/permissions/journal d'audit),
 * committée seulement si le callback réussit, jamais touchée s'il lève.
 * C'est une preuve LOGIQUE (quelles écritures ont lieu, dans quel ordre, avec
 * quel contenu) et une simulation structurelle correcte du tout-ou-rien —
 * mais un mock n'a ni verrou de ligne PostgreSQL réel, ni vrai moteur
 * transactionnel MVCC. La preuve AUTORITAIRE du rollback réel, contre une
 * vraie base PostgreSQL jetable, est apportée séparément par
 * `scripts/verifier-audit-permissions-role-ci.ts` (voir aussi son résultat
 * dans le rapport de livraison de ce correctif).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Module, NiveauAcces } from "@lomoto/shared";
import { contexteRequete } from "../lib/contexteRequete.js";
import {
  appliquerModificationPermissionsRole,
  calculerDiffPermissions,
  ErreurActeurRequisPourAudit,
  type EntreePermission,
} from "./permissionsRoleAudit.js";

const ROLE_ID = "role-1";
const ROLE_NOM = "Caissier(ère)";

type PermissionState = { roleId: string; module: Module; niveauAcces: NiveauAcces };
interface AuditLogState {
  id: string;
  utilisateurId: string;
  utilisateurNom: string;
  module: string;
  typeEntite: string;
  entiteId: string;
  action: string;
  avant: unknown;
  apres: unknown;
}

/**
 * Client Prisma factice en mémoire — `$transaction` copie l'état avant
 * d'exécuter le callback et ne le committe qu'au succès (voir l'en-tête).
 * Deux crochets (`forcerEchecUpsert`/`forcerEchecAuditLog`) permettent de
 * déclencher une erreur Prisma simulée à un point précis, sans mocker
 * `$transaction` lui-même de façon spécifique à chaque test.
 */
function creerClientFactice(permissionsInitiales: PermissionState[] = []) {
  const etat = {
    roles: new Map([[ROLE_ID, { id: ROLE_ID, nom: ROLE_NOM }]]),
    permissions: new Map(permissionsInitiales.map((p) => [`${p.roleId}:${p.module}`, { ...p }])),
    auditLogs: [] as AuditLogState[],
  };
  let compteurAudit = 0;
  let echecUpsertPourModule: Module | null = null;
  let echecAuditLog = false;

  function construireDelegues(
    roles: Map<string, { id: string; nom: string }>,
    permissions: Map<string, PermissionState>,
    auditLogs: AuditLogState[],
  ) {
    return {
      role: {
        findUniqueOrThrow: vi.fn(async ({ where: { id } }: { where: { id: string } }) => {
          const r = roles.get(id);
          if (!r) throw new Error(`Rôle introuvable en base factice : ${id}`);
          return r;
        }),
      },
      rolePermission: {
        findMany: vi.fn(async ({ where: { roleId } }: { where: { roleId: string } }) =>
          [...permissions.values()]
            .filter((p) => p.roleId === roleId)
            .map((p) => ({ module: p.module, niveauAcces: p.niveauAcces })),
        ),
        upsert: vi.fn(
          async (args: {
            where: { roleId_module: { roleId: string; module: Module } };
            update: { niveauAcces: NiveauAcces };
            create: { roleId: string; module: Module; niveauAcces: NiveauAcces };
          }) => {
            const { module, roleId } = args.where.roleId_module;
            if (echecUpsertPourModule === module) {
              throw new Error(`Échec Prisma simulé (contrainte) sur le module ${module}`);
            }
            const cle = `${roleId}:${module}`;
            const existant = permissions.get(cle);
            const valeur: PermissionState = existant
              ? { ...existant, niveauAcces: args.update.niveauAcces }
              : { ...args.create };
            permissions.set(cle, valeur);
            return valeur;
          },
        ),
        deleteMany: vi.fn(async (args: { where: { roleId: string; module?: { notIn: Module[] } } }) => {
          let count = 0;
          for (const [cle, p] of permissions) {
            if (p.roleId !== args.where.roleId) continue;
            if (args.where.module && args.where.module.notIn.includes(p.module)) continue;
            permissions.delete(cle);
            count++;
          }
          return { count };
        }),
      },
      auditLog: {
        create: vi.fn(async (args: { data: Omit<AuditLogState, "id"> }) => {
          if (echecAuditLog) throw new Error("Échec Prisma simulé sur l'écriture d'AuditLog");
          const ligne: AuditLogState = { id: `audit-${++compteurAudit}`, ...args.data };
          auditLogs.push(ligne);
          return ligne;
        }),
      },
    };
  }

  const client = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const rolesCopie = new Map(etat.roles);
      const permissionsCopie = new Map(etat.permissions);
      const auditLogsCopie = [...etat.auditLogs];
      const tx = construireDelegues(rolesCopie, permissionsCopie, auditLogsCopie);
      const resultat = await fn(tx); // si `fn` lève, `etat` n'est JAMAIS modifié (rollback simulé)
      etat.roles = rolesCopie;
      etat.permissions = permissionsCopie;
      etat.auditLogs = auditLogsCopie;
      return resultat;
    }),
  };

  return {
    client: client as unknown as Parameters<typeof appliquerModificationPermissionsRole>[0],
    etat,
    forcerEchecUpsert: (module: Module | null) => {
      echecUpsertPourModule = module;
    },
    forcerEchecAuditLog: (valeur: boolean) => {
      echecAuditLog = valeur;
    },
  };
}

function permissionsRoleActuelles(etat: ReturnType<typeof creerClientFactice>["etat"]): PermissionState[] {
  return [...etat.permissions.values()].filter((p) => p.roleId === ROLE_ID);
}

const ACTEUR = { id: "u-admin-principal", nom: "Aline (Admin Principal)" };

async function executer(
  client: ReturnType<typeof creerClientFactice>["client"],
  permissions: EntreePermission[],
  demandePar: { id: string; nom: string } | null = null,
  acteur: { id: string; nom: string } | null = ACTEUR,
) {
  const appel = () => appliquerModificationPermissionsRole(client, ROLE_ID, permissions, demandePar);
  return acteur ? contexteRequete.run(acteur, appel) : appel();
}

describe("calculerDiffPermissions (fonction pure)", () => {
  it("classe correctement ajout / retrait / modification / inchangé", () => {
    const avant: EntreePermission[] = [
      { module: "CAISSE", niveauAcces: "LECTURE" },
      { module: "STOCKS", niveauAcces: "ECRITURE" },
      { module: "PRODUCTION", niveauAcces: "AUCUN" },
      { module: "RAPPORTS", niveauAcces: "LECTURE" },
    ];
    const apres: EntreePermission[] = [
      { module: "CAISSE", niveauAcces: "ECRITURE" }, // modification
      { module: "STOCKS", niveauAcces: "AUCUN" }, // retrait
      { module: "PRODUCTION", niveauAcces: "LECTURE" }, // ajout
      { module: "RAPPORTS", niveauAcces: "LECTURE" }, // inchangé
    ];
    const diff = calculerDiffPermissions(avant, apres);
    expect(diff.modifications).toEqual([{ module: "CAISSE", avant: "LECTURE", apres: "ECRITURE" }]);
    expect(diff.retraits).toEqual([{ module: "STOCKS", niveauAcces: "ECRITURE" }]);
    expect(diff.ajouts).toEqual([{ module: "PRODUCTION", niveauAcces: "LECTURE" }]);
  });
});

describe("appliquerModificationPermissionsRole", () => {
  beforeEach(() => vi.clearAllMocks());

  // --- Scénario 1 : ajout d'une permission ---------------------------------
  it("ajout d'une permission : diff.ajouts la contient, RolePermission créée", async () => {
    const { client, etat } = creerClientFactice([{ roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" }]);
    const resultat = await executer(client, [
      { module: "CAISSE", niveauAcces: "LECTURE" },
      { module: "STOCKS", niveauAcces: "ECRITURE" },
    ]);
    expect(resultat.diff.ajouts).toEqual([{ module: "STOCKS", niveauAcces: "ECRITURE" }]);
    expect(resultat.diff.retraits).toEqual([]);
    expect(resultat.diff.modifications).toEqual([]);
    expect(permissionsRoleActuelles(etat).find((p) => p.module === "STOCKS")?.niveauAcces).toBe("ECRITURE");
  });

  // --- Scénario 2 : suppression d'une permission ---------------------------
  it("suppression d'une permission (omise de la liste) : diff.retraits la contient, RolePermission supprimée", async () => {
    const { client, etat } = creerClientFactice([
      { roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" },
      { roleId: ROLE_ID, module: "STOCKS", niveauAcces: "ECRITURE" },
    ]);
    const resultat = await executer(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }]);
    expect(resultat.diff.retraits).toEqual([{ module: "STOCKS", niveauAcces: "ECRITURE" }]);
    expect(resultat.diff.ajouts).toEqual([]);
    expect(resultat.diff.modifications).toEqual([]);
    expect(permissionsRoleActuelles(etat).some((p) => p.module === "STOCKS")).toBe(false);
  });

  // --- Scénario 3 : modification d'une permission existante ---------------
  it("modification d'un niveau d'accès existant : diff.modifications la contient", async () => {
    const { client, etat } = creerClientFactice([{ roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" }]);
    const resultat = await executer(client, [{ module: "CAISSE", niveauAcces: "ECRITURE" }]);
    expect(resultat.diff.modifications).toEqual([{ module: "CAISSE", avant: "LECTURE", apres: "ECRITURE" }]);
    expect(permissionsRoleActuelles(etat).find((p) => p.module === "CAISSE")?.niveauAcces).toBe("ECRITURE");
  });

  // --- Scénario 4 : combinaison ajout + modification + suppression --------
  it("combinaison ajout + modification + suppression dans un seul appel", async () => {
    const { client } = creerClientFactice([
      { roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" },
      { roleId: ROLE_ID, module: "STOCKS", niveauAcces: "ECRITURE" },
    ]);
    const resultat = await executer(client, [
      { module: "CAISSE", niveauAcces: "ECRITURE" }, // modification
      { module: "PRODUCTION", niveauAcces: "LECTURE" }, // ajout
      // STOCKS omis → retrait
    ]);
    expect(resultat.diff.modifications).toEqual([{ module: "CAISSE", avant: "LECTURE", apres: "ECRITURE" }]);
    expect(resultat.diff.ajouts).toEqual([{ module: "PRODUCTION", niveauAcces: "LECTURE" }]);
    expect(resultat.diff.retraits).toEqual([{ module: "STOCKS", niveauAcces: "ECRITURE" }]);
  });

  // --- Scénario 5 : exactitude des instantanés avant/après -----------------
  it("les instantanés avant/après couvrent les 10 modules, triés alphabétiquement, avec AUCUN par défaut", async () => {
    const { client, etat } = creerClientFactice([{ roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" }]);
    await executer(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }]);
    const ligne = etat.auditLogs[0]!;
    const avant = (ligne.avant as { permissions: EntreePermission[] }).permissions;
    const apres = (ligne.apres as { permissions: EntreePermission[] }).permissions;
    expect(avant).toHaveLength(10);
    expect(apres).toHaveLength(10);
    const modulesTries = avant.map((p) => p.module);
    expect(modulesTries).toEqual([...modulesTries].sort());
    // Un module jamais accordé (ex. FOURNISSEURS) doit apparaître explicitement à AUCUN.
    expect(avant.find((p) => p.module === "FOURNISSEURS")?.niveauAcces).toBe("AUCUN");
    expect(apres.find((p) => p.module === "CAISSE")?.niveauAcces).toBe("LECTURE");
  });

  // Déterminisme : deux appels équivalents mais formulés dans un ORDRE
  // différent doivent produire des instantanés strictement identiques —
  // preuve que le tri élimine toute différence artificielle liée à l'ordre.
  it("l'ordre des permissions dans la requête n'affecte pas l'instantané persisté (tri déterministe)", async () => {
    const { client: clientA, etat: etatA } = creerClientFactice();
    await executer(clientA, [
      { module: "STOCKS", niveauAcces: "ECRITURE" },
      { module: "CAISSE", niveauAcces: "LECTURE" },
    ]);
    const { client: clientB, etat: etatB } = creerClientFactice();
    await executer(clientB, [
      { module: "CAISSE", niveauAcces: "LECTURE" },
      { module: "STOCKS", niveauAcces: "ECRITURE" },
    ]);
    expect(etatA.auditLogs[0]!.apres).toEqual(etatB.auditLogs[0]!.apres);
  });

  // --- Scénario 6 : identité de l'acteur, du rôle, et du demandeur ---------
  it("l'AuditLog porte l'identité exacte de l'acteur exécutant/approbateur et du rôle ciblé", async () => {
    const { client, etat } = creerClientFactice();
    await executer(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }]);
    const ligne = etat.auditLogs[0]!;
    expect(ligne.utilisateurId).toBe(ACTEUR.id);
    expect(ligne.utilisateurNom).toBe(ACTEUR.nom);
    expect(ligne.entiteId).toBe(ROLE_ID);
    expect(ligne.typeEntite).toBe("Role");
    expect(ligne.module).toBe("EQUIPE");
    expect((ligne.apres as { roleNom: string }).roleNom).toBe(ROLE_NOM);
  });

  it("distingue le demandeur d'origine (workflow d'approbation) de l'acteur qui exécute/approuve", async () => {
    const demandeur = { id: "u-admin-secondaire", nom: "Bakari (Admin secondaire)" };
    const { client, etat } = creerClientFactice();
    // Simule l'approbation : contexteRequete = l'Admin Principal qui approuve,
    // demandePar = l'Admin secondaire qui avait soumis la demande.
    await executer(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }], demandeur, ACTEUR);
    const ligne = etat.auditLogs[0]!;
    expect(ligne.utilisateurId).toBe(ACTEUR.id); // qui a APPROUVÉ/exécuté
    expect((ligne.apres as { demandePar: typeof demandeur | null }).demandePar).toEqual(demandeur); // qui a DEMANDÉ
  });

  it("exécution directe par l'Admin Principal (sans workflow d'approbation) : demandePar est null", async () => {
    const { client, etat } = creerClientFactice();
    await executer(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }], null, ACTEUR);
    const ligne = etat.auditLogs[0]!;
    expect((ligne.apres as { demandePar: unknown }).demandePar).toBeNull();
  });

  // --- Scénario 7 : absence de doublon d'audit ------------------------------
  it("une action réussie, même avec plusieurs permissions changées, ne produit QU'UNE SEULE ligne d'audit", async () => {
    const { client, etat } = creerClientFactice([{ roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" }]);
    await executer(client, [
      { module: "CAISSE", niveauAcces: "ECRITURE" },
      { module: "STOCKS", niveauAcces: "LECTURE" },
      { module: "PRODUCTION", niveauAcces: "LECTURE" },
    ]);
    expect(etat.auditLogs).toHaveLength(1);
  });

  // --- Scénario 8 : répétition idempotente / absence de changement réel ----
  // Décision documentée (voir permissionsRoleAudit.ts) : une ligne d'audit
  // est TOUJOURS écrite, même quand rien ne change réellement — l'action est
  // alors fidèlement enregistrée comme une confirmation de l'état courant à
  // cette date, plutôt que d'être masquée par un calcul de no-op.
  it("répétition exacte de la même matrice de permissions : 2 lignes d'audit (une par appel), état inchangé au 2e", async () => {
    const { client, etat } = creerClientFactice([{ roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" }]);
    await executer(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }]);
    await executer(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }]);
    expect(etat.auditLogs).toHaveLength(2);
    const deuxieme = etat.auditLogs[1]!;
    const avantPerms = (deuxieme.avant as { permissions: unknown }).permissions;
    const apresPerms = (deuxieme.apres as { permissions: unknown }).permissions;
    expect(avantPerms).toEqual(apresPerms); // état inchangé : avant === après au 2e appel
    expect((deuxieme.apres as { diff: { ajouts: unknown[]; retraits: unknown[]; modifications: unknown[] } }).diff).toEqual({
      ajouts: [],
      retraits: [],
      modifications: [],
    });
  });

  it("répétition exacte : le diff retourné par la fonction est bien entièrement vide au 2e appel", async () => {
    const { client, etat } = creerClientFactice([{ roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" }]);
    await executer(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }]);
    const resultat2 = await executer(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }]);
    expect(resultat2.diff).toEqual({ ajouts: [], retraits: [], modifications: [] });
    expect(etat.auditLogs).toHaveLength(2);
  });

  // --- Scénario 9 : échec de l'écriture d'audit → rollback des permissions -
  it("échec simulé de l'écriture d'audit : les écritures de permission de CET appel sont annulées (rollback simulé)", async () => {
    const { client, etat, forcerEchecAuditLog } = creerClientFactice([
      { roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" },
    ]);
    const permissionsAvant = permissionsRoleActuelles(etat);
    const nbAuditAvant = etat.auditLogs.length;

    forcerEchecAuditLog(true);
    await expect(executer(client, [{ module: "STOCKS", niveauAcces: "ECRITURE" }])).rejects.toThrow(
      "Échec Prisma simulé sur l'écriture d'AuditLog",
    );

    // La ligne RolePermission pour STOCKS avait bien été écrite AVANT l'échec
    // (dans la copie de transaction) — le test prouve qu'elle n'a PAS survécu
    // au rollback : l'état committé reste identique à avant l'appel.
    expect(permissionsRoleActuelles(etat)).toEqual(permissionsAvant);
    expect(etat.auditLogs).toHaveLength(nbAuditAvant);
  });

  // --- Scénario 10 : échec d'une écriture de permission → aucun audit menteur
  it("échec simulé d'une écriture de permission : AUCUNE ligne d'audit n'est créée, aucune permission modifiée", async () => {
    const { client, etat, forcerEchecUpsert } = creerClientFactice([
      { roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" },
    ]);
    const permissionsAvant = permissionsRoleActuelles(etat);

    forcerEchecUpsert("STOCKS");
    await expect(
      executer(client, [
        { module: "CAISSE", niveauAcces: "ECRITURE" }, // aurait réussi seule
        { module: "STOCKS", niveauAcces: "ECRITURE" }, // échoue
      ]),
    ).rejects.toThrow("Échec Prisma simulé (contrainte) sur le module STOCKS");

    expect(permissionsRoleActuelles(etat)).toEqual(permissionsAvant); // CAISSE n'a PAS été modifiée non plus
    expect(etat.auditLogs).toHaveLength(0); // l'audit, exécuté APRÈS la boucle, n'a jamais été atteint
  });

  // --- Garde : aucun acteur authentifié → refus, rollback complet ----------
  it("hors contexte de requête authentifiée : ErreurActeurRequisPourAudit, aucune écriture committée", async () => {
    const { client, etat } = creerClientFactice([{ roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" }]);
    const permissionsAvant = permissionsRoleActuelles(etat);

    await expect(executer(client, [{ module: "STOCKS", niveauAcces: "ECRITURE" }], null, null)).rejects.toThrow(
      ErreurActeurRequisPourAudit,
    );

    expect(permissionsRoleActuelles(etat)).toEqual(permissionsAvant);
    expect(etat.auditLogs).toHaveLength(0);
  });
});
