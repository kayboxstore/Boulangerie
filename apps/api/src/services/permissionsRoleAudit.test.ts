/**
 * Preuves des correctifs P1 (contre-revue Codex de l'audit complet du
 * 24/08/2026) :
 *  - Round 1 : piste d'audit atomique pour MODIFIER_PERMISSIONS_ROLE.
 *  - Round 2, P1-01 : métadonnées de traçabilité enrichies
 *    (typeActionCritique, modeExecution, demandeApprobationId, demandePar).
 *  - Round 2, P1-02 : atomicité réservation/exécution/audit/transition pour
 *    le parcours d'approbation.
 *
 * Ces tests MOCKENT Prisma : un client factice en mémoire, même convention
 * que `prisma/bootstrap-production.test.ts` — `$transaction` exécute le
 * callback contre une COPIE de l'état (rôles/permissions/audit/demandes),
 * committée seulement si le callback réussit, jamais touchée s'il lève.
 * Preuve LOGIQUE et simulation structurelle correcte du tout-ou-rien — la
 * preuve AUTORITAIRE du rollback réel et de la VRAIE concurrence PostgreSQL
 * (verrouillage de ligne, synchronisation déterministe entre deux connexions
 * séparées) est apportée séparément par
 * `scripts/verifier-audit-permissions-role-ci.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { Module, NiveauAcces } from "@lomoto/shared";
import { contexteRequete } from "../lib/contexteRequete.js";
import { ErreurAction } from "../lib/erreurAction.js";
import {
  appliquerModificationPermissionsRole,
  approuverEtAppliquerModificationPermissionsRole,
  calculerDiffPermissions,
  ErreurActeurRequisPourAudit,
  ErreurApprobationConcurrente,
  type EntreePermission,
} from "./permissionsRoleAudit.js";

const ROLE_ID = "role-1";
const ROLE_NOM = "Caissier(ère)";
const DEMANDE_ID = "demande-1";

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
interface DemandeState {
  id: string;
  type: string;
  donnees: unknown;
  statut: "EN_ATTENTE" | "APPROUVEE" | "REJETEE";
  demandeParId: string;
  demandePar: { id: string; nom: string };
  approuveParId: string | null;
  dateDecision: Date | null;
  erreur: string | null;
}

/**
 * Client Prisma factice en mémoire — `$transaction` copie l'état avant
 * d'exécuter le callback et ne le committe qu'au succès (voir l'en-tête).
 * Trois crochets de test forcent une erreur Prisma simulée à un point
 * précis, sans mocker `$transaction` lui-même différemment par test.
 */
function creerClientFactice(
  permissionsInitiales: PermissionState[] = [],
  demandesInitiales: DemandeState[] = [],
) {
  const etat = {
    roles: new Map([[ROLE_ID, { id: ROLE_ID, nom: ROLE_NOM }]]),
    permissions: new Map(permissionsInitiales.map((p) => [`${p.roleId}:${p.module}`, { ...p }])),
    auditLogs: [] as AuditLogState[],
    demandes: new Map(demandesInitiales.map((d) => [d.id, { ...d }])),
  };
  let compteurAudit = 0;
  let echecUpsertPourModule: Module | null = null;
  let echecAuditLog = false;
  // P2-02 (Round 3) : simule un conflit de sérialisation PostgreSQL (P2034)
  // survenant PENDANT la transaction — pas sur le premier `updateMany` de
  // réservation, mais plus tard (ici : l'upsert RolePermission), pour
  // prouver que l'enveloppe de réessai couvre bien la transaction COMPLÈTE.
  const p2034SurUpsert = { module: null as Module | null, restants: 0 };

  function construireDelegues(
    roles: Map<string, { id: string; nom: string }>,
    permissions: Map<string, PermissionState>,
    auditLogs: AuditLogState[],
    demandes: Map<string, DemandeState>,
  ) {
    return {
      role: {
        findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) => roles.get(id) ?? null),
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
            if (p2034SurUpsert.module === module && p2034SurUpsert.restants > 0) {
              p2034SurUpsert.restants--;
              throw new Prisma.PrismaClientKnownRequestError(
                "Transaction failed due to a write conflict or a deadlock. Please retry your transaction",
                { code: "P2034", clientVersion: "test" },
              );
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
      demandeApprobation: {
        updateMany: vi.fn(
          async (args: { where: { id: string; statut: string }; data: Partial<DemandeState> }) => {
            const d = demandes.get(args.where.id);
            if (!d || d.statut !== args.where.statut) return { count: 0 };
            demandes.set(args.where.id, { ...d, ...args.data });
            return { count: 1 };
          },
        ),
        findUniqueOrThrow: vi.fn(async ({ where: { id } }: { where: { id: string } }) => {
          const d = demandes.get(id);
          if (!d) throw new Error(`DemandeApprobation introuvable en base factice : ${id}`);
          return d;
        }),
      },
    };
  }

  const client = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const rolesCopie = new Map(etat.roles);
      const permissionsCopie = new Map(etat.permissions);
      const auditLogsCopie = [...etat.auditLogs];
      const demandesCopie = new Map(etat.demandes);
      const tx = construireDelegues(rolesCopie, permissionsCopie, auditLogsCopie, demandesCopie);
      const resultat = await fn(tx); // si `fn` lève, `etat` n'est JAMAIS modifié (rollback simulé)
      etat.roles = rolesCopie;
      etat.permissions = permissionsCopie;
      etat.auditLogs = auditLogsCopie;
      etat.demandes = demandesCopie;
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
    forcerP2034SurUpsert: (module: Module | null, nbEchecs: number) => {
      p2034SurUpsert.module = module;
      p2034SurUpsert.restants = nbEchecs;
    },
  };
}

function permissionsRoleActuelles(etat: ReturnType<typeof creerClientFactice>["etat"]): PermissionState[] {
  return [...etat.permissions.values()].filter((p) => p.roleId === ROLE_ID);
}

const ACTEUR = { id: "u-admin-principal", nom: "Aline (Admin Principal)" };
const DEMANDEUR = { id: "u-admin-secondaire", nom: "Bakari (Admin secondaire)" };

async function executerDirecte(
  client: ReturnType<typeof creerClientFactice>["client"],
  permissions: EntreePermission[],
  acteur: { id: string; nom: string } | null = ACTEUR,
) {
  const appel = () => appliquerModificationPermissionsRole(client, ROLE_ID, permissions);
  return acteur ? contexteRequete.run(acteur, appel) : appel();
}

function demandeInitiale(overrides: Partial<DemandeState> = {}): DemandeState {
  return {
    id: DEMANDE_ID,
    type: "MODIFIER_PERMISSIONS_ROLE",
    donnees: { roleId: ROLE_ID, permissions: [{ module: "CAISSE", niveauAcces: "LECTURE" }] },
    statut: "EN_ATTENTE",
    demandeParId: DEMANDEUR.id,
    demandePar: DEMANDEUR,
    approuveParId: null,
    dateDecision: null,
    erreur: null,
    ...overrides,
  };
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
      { module: "CAISSE", niveauAcces: "ECRITURE" },
      { module: "STOCKS", niveauAcces: "AUCUN" },
      { module: "PRODUCTION", niveauAcces: "LECTURE" },
      { module: "RAPPORTS", niveauAcces: "LECTURE" },
    ];
    const diff = calculerDiffPermissions(avant, apres);
    expect(diff.modifications).toEqual([{ module: "CAISSE", avant: "LECTURE", apres: "ECRITURE" }]);
    expect(diff.retraits).toEqual([{ module: "STOCKS", niveauAcces: "ECRITURE" }]);
    expect(diff.ajouts).toEqual([{ module: "PRODUCTION", niveauAcces: "LECTURE" }]);
  });
});

describe("appliquerModificationPermissionsRole — exécution DIRECTE", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ajout d'une permission : diff.ajouts la contient, RolePermission créée", async () => {
    const { client, etat } = creerClientFactice([{ roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" }]);
    const resultat = await executerDirecte(client, [
      { module: "CAISSE", niveauAcces: "LECTURE" },
      { module: "STOCKS", niveauAcces: "ECRITURE" },
    ]);
    expect(resultat.diff.ajouts).toEqual([{ module: "STOCKS", niveauAcces: "ECRITURE" }]);
    expect(permissionsRoleActuelles(etat).find((p) => p.module === "STOCKS")?.niveauAcces).toBe("ECRITURE");
  });

  it("suppression d'une permission (omise de la liste) : diff.retraits la contient", async () => {
    const { client, etat } = creerClientFactice([
      { roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" },
      { roleId: ROLE_ID, module: "STOCKS", niveauAcces: "ECRITURE" },
    ]);
    const resultat = await executerDirecte(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }]);
    expect(resultat.diff.retraits).toEqual([{ module: "STOCKS", niveauAcces: "ECRITURE" }]);
    expect(permissionsRoleActuelles(etat).some((p) => p.module === "STOCKS")).toBe(false);
  });

  it("modification d'un niveau d'accès existant : diff.modifications la contient", async () => {
    const { client, etat } = creerClientFactice([{ roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" }]);
    const resultat = await executerDirecte(client, [{ module: "CAISSE", niveauAcces: "ECRITURE" }]);
    expect(resultat.diff.modifications).toEqual([{ module: "CAISSE", avant: "LECTURE", apres: "ECRITURE" }]);
    expect(permissionsRoleActuelles(etat).find((p) => p.module === "CAISSE")?.niveauAcces).toBe("ECRITURE");
  });

  it("combinaison ajout + modification + suppression dans un seul appel", async () => {
    const { client } = creerClientFactice([
      { roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" },
      { roleId: ROLE_ID, module: "STOCKS", niveauAcces: "ECRITURE" },
    ]);
    const resultat = await executerDirecte(client, [
      { module: "CAISSE", niveauAcces: "ECRITURE" },
      { module: "PRODUCTION", niveauAcces: "LECTURE" },
    ]);
    expect(resultat.diff.modifications).toEqual([{ module: "CAISSE", avant: "LECTURE", apres: "ECRITURE" }]);
    expect(resultat.diff.ajouts).toEqual([{ module: "PRODUCTION", niveauAcces: "LECTURE" }]);
    expect(resultat.diff.retraits).toEqual([{ module: "STOCKS", niveauAcces: "ECRITURE" }]);
  });

  it("les instantanés avant/après couvrent les 10 modules, triés alphabétiquement, avec AUCUN par défaut", async () => {
    const { client, etat } = creerClientFactice([{ roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" }]);
    await executerDirecte(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }]);
    const ligne = etat.auditLogs[0]!;
    const avant = (ligne.avant as { permissions: EntreePermission[] }).permissions;
    const apres = (ligne.apres as { permissions: EntreePermission[] }).permissions;
    expect(avant).toHaveLength(10);
    expect(apres).toHaveLength(10);
    const modulesTries = avant.map((p) => p.module);
    expect(modulesTries).toEqual([...modulesTries].sort());
    expect(avant.find((p) => p.module === "FOURNISSEURS")?.niveauAcces).toBe("AUCUN");
  });

  it("l'ordre des permissions dans la requête n'affecte pas l'instantané persisté (tri déterministe)", async () => {
    const { client: clientA, etat: etatA } = creerClientFactice();
    await executerDirecte(clientA, [
      { module: "STOCKS", niveauAcces: "ECRITURE" },
      { module: "CAISSE", niveauAcces: "LECTURE" },
    ]);
    const { client: clientB, etat: etatB } = creerClientFactice();
    await executerDirecte(clientB, [
      { module: "CAISSE", niveauAcces: "LECTURE" },
      { module: "STOCKS", niveauAcces: "ECRITURE" },
    ]);
    expect(etatA.auditLogs[0]!.apres).toEqual(etatB.auditLogs[0]!.apres);
  });

  // --- P1-01 : métadonnées de traçabilité, mode DIRECTE ---------------------
  it("métadonnées Round 2 (mode DIRECTE) : typeActionCritique, modeExecution=DIRECTE, demandeApprobationId=null, demandePar=null", async () => {
    const { client, etat } = creerClientFactice();
    await executerDirecte(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }]);
    const apres = etat.auditLogs[0]!.apres as {
      typeActionCritique: string;
      modeExecution: string;
      demandeApprobationId: string | null;
      demandePar: unknown;
    };
    expect(apres.typeActionCritique).toBe("MODIFIER_PERMISSIONS_ROLE");
    expect(apres.modeExecution).toBe("DIRECTE");
    expect(apres.demandeApprobationId).toBeNull();
    expect(apres.demandePar).toBeNull();
  });

  it("l'AuditLog porte l'identité exacte de l'acteur exécutant et du rôle ciblé", async () => {
    const { client, etat } = creerClientFactice();
    await executerDirecte(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }]);
    const ligne = etat.auditLogs[0]!;
    expect(ligne.utilisateurId).toBe(ACTEUR.id);
    expect(ligne.utilisateurNom).toBe(ACTEUR.nom);
    expect(ligne.entiteId).toBe(ROLE_ID);
    expect(ligne.typeEntite).toBe("Role");
    expect((ligne.apres as { roleNom: string }).roleNom).toBe(ROLE_NOM);
  });

  it("une action réussie, même avec plusieurs permissions changées, ne produit QU'UNE SEULE ligne d'audit", async () => {
    const { client, etat } = creerClientFactice([{ roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" }]);
    await executerDirecte(client, [
      { module: "CAISSE", niveauAcces: "ECRITURE" },
      { module: "STOCKS", niveauAcces: "LECTURE" },
      { module: "PRODUCTION", niveauAcces: "LECTURE" },
    ]);
    expect(etat.auditLogs).toHaveLength(1);
  });

  it("répétition exacte de la même matrice : 2 lignes d'audit, diff vide au 2e appel (idempotence documentée)", async () => {
    const { client, etat } = creerClientFactice([{ roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" }]);
    await executerDirecte(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }]);
    const resultat2 = await executerDirecte(client, [{ module: "CAISSE", niveauAcces: "LECTURE" }]);
    expect(etat.auditLogs).toHaveLength(2);
    expect(resultat2.diff).toEqual({ ajouts: [], retraits: [], modifications: [] });
  });

  it("échec simulé de l'écriture d'audit : les écritures de permission de CET appel sont annulées (rollback simulé)", async () => {
    const { client, etat, forcerEchecAuditLog } = creerClientFactice([
      { roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" },
    ]);
    const permissionsAvant = permissionsRoleActuelles(etat);
    forcerEchecAuditLog(true);
    await expect(executerDirecte(client, [{ module: "STOCKS", niveauAcces: "ECRITURE" }])).rejects.toThrow(
      "Échec Prisma simulé sur l'écriture d'AuditLog",
    );
    expect(permissionsRoleActuelles(etat)).toEqual(permissionsAvant);
    expect(etat.auditLogs).toHaveLength(0);
  });

  it("échec simulé d'une écriture de permission : AUCUNE ligne d'audit créée, aucune permission modifiée", async () => {
    const { client, etat, forcerEchecUpsert } = creerClientFactice([
      { roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" },
    ]);
    const permissionsAvant = permissionsRoleActuelles(etat);
    forcerEchecUpsert("STOCKS");
    await expect(
      executerDirecte(client, [
        { module: "CAISSE", niveauAcces: "ECRITURE" },
        { module: "STOCKS", niveauAcces: "ECRITURE" },
      ]),
    ).rejects.toThrow("Échec Prisma simulé (contrainte) sur le module STOCKS");
    expect(permissionsRoleActuelles(etat)).toEqual(permissionsAvant);
    expect(etat.auditLogs).toHaveLength(0);
  });

  it("hors contexte de requête authentifiée : ErreurActeurRequisPourAudit, aucune écriture committée", async () => {
    const { client, etat } = creerClientFactice([{ roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" }]);
    const permissionsAvant = permissionsRoleActuelles(etat);
    await expect(executerDirecte(client, [{ module: "STOCKS", niveauAcces: "ECRITURE" }], null)).rejects.toThrow(
      ErreurActeurRequisPourAudit,
    );
    expect(permissionsRoleActuelles(etat)).toEqual(permissionsAvant);
    expect(etat.auditLogs).toHaveLength(0);
  });

  it("rôle introuvable : ErreurAction(404), aucune écriture", async () => {
    const { client, etat } = creerClientFactice();
    await expect(
      contexteRequete.run(ACTEUR, () => appliquerModificationPermissionsRole(client, "role-inexistant", [])),
    ).rejects.toThrow(ErreurAction);
    expect(etat.auditLogs).toHaveLength(0);
  });
});

describe("approuverEtAppliquerModificationPermissionsRole — parcours APPROBATION (Round 2, P1-01 + P1-02)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("métadonnées Round 2 (mode APPROBATION) : typeActionCritique, modeExecution=APPROBATION, demandeApprobationId et demandePar exacts", async () => {
    const { client, etat } = creerClientFactice(
      [{ roleId: ROLE_ID, module: "CAISSE", niveauAcces: "LECTURE" }],
      [demandeInitiale()],
    );
    await contexteRequete.run(ACTEUR, () =>
      approuverEtAppliquerModificationPermissionsRole(client, DEMANDE_ID, ACTEUR),
    );
    const ligne = etat.auditLogs[0]!;
    const apres = ligne.apres as {
      typeActionCritique: string;
      modeExecution: string;
      demandeApprobationId: string;
      demandePar: { id: string; nom: string };
    };
    expect(apres.typeActionCritique).toBe("MODIFIER_PERMISSIONS_ROLE");
    expect(apres.modeExecution).toBe("APPROBATION");
    expect(apres.demandeApprobationId).toBe(DEMANDE_ID);
    expect(apres.demandePar).toEqual(DEMANDEUR);
    // L'acteur (qui a EXÉCUTÉ/APPROUVÉ) reste distinct du demandeur d'origine.
    expect(ligne.utilisateurId).toBe(ACTEUR.id);
    expect(ligne.utilisateurId).not.toBe(DEMANDEUR.id);
  });

  it("deux demandes distinctes du même demandeur visant le même rôle restent corrélables sans ambiguïté", async () => {
    const { client, etat } = creerClientFactice(
      [],
      [
        demandeInitiale({ id: "demande-A", donnees: { roleId: ROLE_ID, permissions: [{ module: "CAISSE", niveauAcces: "LECTURE" }] } }),
        demandeInitiale({ id: "demande-B", donnees: { roleId: ROLE_ID, permissions: [{ module: "STOCKS", niveauAcces: "ECRITURE" }] } }),
      ],
    );
    await contexteRequete.run(ACTEUR, () => approuverEtAppliquerModificationPermissionsRole(client, "demande-A", ACTEUR));
    await contexteRequete.run(ACTEUR, () => approuverEtAppliquerModificationPermissionsRole(client, "demande-B", ACTEUR));
    expect(etat.auditLogs).toHaveLength(2);
    const ids = etat.auditLogs.map((l) => (l.apres as { demandeApprobationId: string }).demandeApprobationId);
    expect(new Set(ids)).toEqual(new Set(["demande-A", "demande-B"])); // distincts, jamais confondus
  });

  it("la demande passe à APPROUVEE avec l'identité exacte de l'approbateur", async () => {
    const { client, etat } = creerClientFactice([], [demandeInitiale()]);
    const resultat = await contexteRequete.run(ACTEUR, () =>
      approuverEtAppliquerModificationPermissionsRole(client, DEMANDE_ID, ACTEUR),
    );
    expect(resultat.demandeStatut).toBe("APPROUVEE");
    expect(resultat.demandeApprouveParId).toBe(ACTEUR.id);
    expect(etat.demandes.get(DEMANDE_ID)!.statut).toBe("APPROUVEE");
    expect(etat.demandes.get(DEMANDE_ID)!.approuveParId).toBe(ACTEUR.id);
  });

  // --- P1-02 : réservation atomique — simulation logique (la preuve de VRAIE
  // concurrence PostgreSQL est dans scripts/verifier-audit-permissions-role-ci.ts) --
  it("demande déjà APPROUVEE : ErreurApprobationConcurrente, aucune nouvelle exécution, aucun nouvel audit", async () => {
    const { client, etat } = creerClientFactice([], [demandeInitiale({ statut: "APPROUVEE" })]);
    await expect(
      contexteRequete.run(ACTEUR, () => approuverEtAppliquerModificationPermissionsRole(client, DEMANDE_ID, ACTEUR)),
    ).rejects.toThrow(ErreurApprobationConcurrente);
    expect(etat.auditLogs).toHaveLength(0);
  });

  it("deux appels séquentiels sur la même demande EN_ATTENTE : le premier gagne, le second échoue proprement (simulation de la course)", async () => {
    const { client, etat } = creerClientFactice([], [demandeInitiale()]);
    const resultat1 = await contexteRequete.run(ACTEUR, () =>
      approuverEtAppliquerModificationPermissionsRole(client, DEMANDE_ID, ACTEUR),
    );
    expect(resultat1.demandeStatut).toBe("APPROUVEE");
    await expect(
      contexteRequete.run(ACTEUR, () => approuverEtAppliquerModificationPermissionsRole(client, DEMANDE_ID, ACTEUR)),
    ).rejects.toThrow(ErreurApprobationConcurrente);
    expect(etat.auditLogs).toHaveLength(1); // jamais un doublon
  });

  it("échec injecté de l'écriture d'audit APRÈS la réservation : la demande redevient EN_ATTENTE (rollback simulé), aucune permission modifiée", async () => {
    const { client, etat, forcerEchecAuditLog } = creerClientFactice([], [demandeInitiale()]);
    forcerEchecAuditLog(true);
    await expect(
      contexteRequete.run(ACTEUR, () => approuverEtAppliquerModificationPermissionsRole(client, DEMANDE_ID, ACTEUR)),
    ).rejects.toThrow("Échec Prisma simulé sur l'écriture d'AuditLog");
    // La réservation (statut → APPROUVEE) faisait partie de la MÊME
    // transaction que l'écriture d'audit qui a échoué : elle est donc annulée
    // elle aussi — la demande redevient EN_ATTENTE comme avant l'appel.
    expect(etat.demandes.get(DEMANDE_ID)!.statut).toBe("EN_ATTENTE");
    expect(permissionsRoleActuelles(etat)).toEqual([]);
    expect(etat.auditLogs).toHaveLength(0);
  });

  it("type d'action inattendu dans la demande : refus explicite plutôt qu'une exécution silencieuse erronée", async () => {
    const { client, etat } = creerClientFactice([], [demandeInitiale({ type: "MODIFIER_TAUX_TAXE" })]);
    await expect(
      contexteRequete.run(ACTEUR, () => approuverEtAppliquerModificationPermissionsRole(client, DEMANDE_ID, ACTEUR)),
    ).rejects.toThrow(/type d'action inattendu/);
    // La réservation avait déjà eu lieu avant la détection — mais la garde
    // lève DANS la même transaction, donc tout est annulé y compris elle.
    expect(etat.demandes.get(DEMANDE_ID)!.statut).toBe("EN_ATTENTE");
  });

  // --- P2-02 (Round 3) : gestion COMPLÈTE de P2034, pas seulement sur le
  // premier updateMany de réservation — voir l'en-tête de la fonction. ------
  it("P2034 pendant l'upsert RolePermission (pas la réservation) : réessai borné, succès à la 3e tentative", async () => {
    const { client, etat, forcerP2034SurUpsert } = creerClientFactice([], [demandeInitiale()]);
    // Échoue par P2034 aux 2 premières tentatives (sur l'écriture
    // RolePermission, APRÈS que la réservation ait déjà réussi dans cette
    // même transaction avortée), réussit à la 3e — prouve que le réessai
    // ouvre bien une TOUTE NOUVELLE transaction à chaque fois (la
    // réservation est rejouée, pas supposée acquise) et que la boucle
    // couvre la transaction ENTIÈRE, pas seulement l'updateMany initial.
    forcerP2034SurUpsert("CAISSE", 2);
    const resultat = await contexteRequete.run(ACTEUR, () =>
      approuverEtAppliquerModificationPermissionsRole(client, DEMANDE_ID, ACTEUR),
    );
    expect(resultat.demandeStatut).toBe("APPROUVEE");
    expect(client.$transaction).toHaveBeenCalledTimes(3);
    expect(etat.demandes.get(DEMANDE_ID)!.statut).toBe("APPROUVEE");
    expect(etat.auditLogs).toHaveLength(1); // jamais de doublon malgré les 2 tentatives avortées
  });

  it("P2034 persistant au-delà des tentatives bornées : ErreurApprobationConcurrente (jamais un 500 brut), jamais de réessai infini", async () => {
    const { client, etat, forcerP2034SurUpsert } = creerClientFactice([], [demandeInitiale()]);
    // Échoue par P2034 indéfiniment (bien plus que NB_TENTATIVES_MAX_P2034).
    forcerP2034SurUpsert("CAISSE", 999);
    await expect(
      contexteRequete.run(ACTEUR, () => approuverEtAppliquerModificationPermissionsRole(client, DEMANDE_ID, ACTEUR)),
    ).rejects.toThrow(ErreurApprobationConcurrente);
    // Bornée à exactement 3 tentatives — jamais infinie.
    expect(client.$transaction).toHaveBeenCalledTimes(3);
    // Chaque transaction avortée annule aussi sa réservation : la demande
    // reste EN_ATTENTE, jamais faussement APPROUVEE ni orpheline.
    expect(etat.demandes.get(DEMANDE_ID)!.statut).toBe("EN_ATTENTE");
    expect(etat.auditLogs).toHaveLength(0);
  });

  it("une erreur Prisma non-P2034 pendant l'upsert n'est jamais réessayée (remontée immédiatement)", async () => {
    const { client, etat, forcerEchecUpsert } = creerClientFactice([], [demandeInitiale()]);
    forcerEchecUpsert("CAISSE");
    await expect(
      contexteRequete.run(ACTEUR, () => approuverEtAppliquerModificationPermissionsRole(client, DEMANDE_ID, ACTEUR)),
    ).rejects.toThrow(/Échec Prisma simulé \(contrainte\)/);
    expect(client.$transaction).toHaveBeenCalledTimes(1); // pas de réessai pour une erreur qui n'est pas un conflit de sérialisation
    expect(etat.demandes.get(DEMANDE_ID)!.statut).toBe("EN_ATTENTE");
  });
});
