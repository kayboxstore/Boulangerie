/**
 * Preuves mockées (Passe A) du correctif P1 « atomicité exécution métier +
 * décision pour les 4 autres approbations » (25/08/2026) — SUPPRIMER_UTILISATEUR,
 * CREER_COMPTE_ADMIN, MODIFIER_TYPE_CLIENT, MODIFIER_TAUX_TAXE.
 *
 * Ces tests MOCKENT Prisma : un client factice en mémoire, même convention
 * que `permissionsRoleAudit.test.ts` — `$transaction` clone l'état avant
 * d'exécuter le callback et ne le committe QUE si le callback réussit, jamais
 * touché s'il lève (simulation logique du tout-ou-rien). La preuve
 * AUTORITAIRE de la vraie concurrence PostgreSQL (verrouillage de ligne,
 * `pg_blocking_pids`, rollback réel) est apportée séparément par
 * `scripts/verifier-concurrence-actions-metier-ci.ts` et
 * `scripts/verifier-http-actions-metier-ci.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { contexteRequete } from "../lib/contexteRequete.js";
import { ErreurAction } from "../lib/erreurAction.js";
import {
  ErreurApprobationConcurrente,
  ErreurConflitApprobationReessayable,
} from "./demandeApprobation.js";
import {
  approuverEtExecuterActionMetier,
  creerCompteAdminDirect,
  creerCompteAdminTx,
  ErreurActeurRequisPourAudit,
  MAX_COMPTES_ADMIN,
  modifierTauxTaxeDirect,
  modifierTypeClientDirect,
  ROLE_ADMINISTRATEUR,
  supprimerUtilisateurDirect,
} from "./actionsCritiquesMetier.js";

interface UtilisateurState {
  id: string;
  nom: string;
  email: string;
  roleId: string;
  roleNom: string;
  motDePasseHash: string;
  motDePasseDoitChanger: boolean;
  estAdminPrincipal: boolean;
}
interface TypeClientState {
  id: string;
  nom: string;
  prixParBac: number;
  commissionParBac: number;
}
interface ProduitState {
  id: string;
  nom: string;
  tauxTaxe: number;
}
interface TravailleurState {
  id: string;
  nom: string;
  utilisateurId: string | null;
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
interface AuditLogState {
  utilisateurId: string;
  utilisateurNom: string;
  module: string;
  typeEntite: string;
  entiteId: string;
  action: string;
  avant: unknown;
  apres: unknown;
}

class ErreurP2003Factice extends Prisma.PrismaClientKnownRequestError {
  constructor() {
    super("Foreign key constraint violated", { code: "P2003", clientVersion: "test" });
  }
}
class ErreurP2034Factice extends Prisma.PrismaClientKnownRequestError {
  constructor() {
    super("Transaction failed due to a write conflict or a deadlock", { code: "P2034", clientVersion: "test" });
  }
}

const ACTEUR = { id: "u-principal", nom: "Aline (Admin Principal)" };

/**
 * Client Prisma factice en mémoire. `$transaction` clone les 5 collections,
 * exécute le callback contre le clone, et ne recopie le clone dans l'état
 * RÉEL qu'au succès — un rollback PostgreSQL réel se comporte à l'identique
 * (aucune écriture, y compris partielle, ne survit à une levée).
 */
function creerClientFactice(seed: {
  utilisateurs?: UtilisateurState[];
  typeClients?: TypeClientState[];
  produits?: ProduitState[];
  travailleurs?: TravailleurState[];
  demandes?: DemandeState[];
}) {
  const etat = {
    utilisateurs: new Map((seed.utilisateurs ?? []).map((u) => [u.id, { ...u }])),
    typeClients: new Map((seed.typeClients ?? []).map((t) => [t.id, { ...t }])),
    produits: new Map((seed.produits ?? []).map((p) => [p.id, { ...p }])),
    travailleurs: new Map((seed.travailleurs ?? []).map((t) => [t.id, { ...t }])),
    demandes: new Map((seed.demandes ?? []).map((d) => [d.id, { ...d }])),
    auditLogs: [] as AuditLogState[],
  };
  let compteurId = 0;
  // Force un P2003 sur la PROCHAINE suppression d'Utilisateur — même
  // convention que `permissionsRoleAudit.test.ts` (`p2034SurUpsert`) : un
  // indicateur partagé, vérifié par le délégué factice, plutôt qu'un
  // remplacement de `$transaction` (qui casse la surcharge de type de la
  // méthode réelle).
  let forcerP2003SurSuppression = false;

  function construireDelegues(
    utilisateurs: Map<string, UtilisateurState>,
    typeClients: Map<string, TypeClientState>,
    produits: Map<string, ProduitState>,
    travailleurs: Map<string, TravailleurState>,
    demandes: Map<string, DemandeState>,
    auditLogs: AuditLogState[],
  ) {
    return {
      utilisateur: {
        findUnique: vi.fn(async (args: { where: { id?: string; email?: string } }) => {
          if (args.where.id) return utilisateurs.get(args.where.id) ?? null;
          if (args.where.email) return [...utilisateurs.values()].find((u) => u.email === args.where.email) ?? null;
          return null;
        }),
        count: vi.fn(async (args: { where: { role: { nom: string } } }) =>
          [...utilisateurs.values()].filter((u) => u.roleNom === args.where.role.nom).length,
        ),
        create: vi.fn(async (args: { data: Omit<UtilisateurState, "id" | "roleNom" | "estAdminPrincipal"> & { roleId: string } }) => {
          const id = `u-nouveau-${++compteurId}`;
          const u: UtilisateurState = { ...args.data, id, roleNom: ROLE_ADMINISTRATEUR, estAdminPrincipal: false };
          utilisateurs.set(id, u);
          return u;
        }),
        deleteMany: vi.fn(async (args: { where: { id: string } }) => {
          if (forcerP2003SurSuppression) {
            forcerP2003SurSuppression = false;
            throw new ErreurP2003Factice();
          }
          if (!utilisateurs.has(args.where.id)) return { count: 0 };
          utilisateurs.delete(args.where.id);
          return { count: 1 };
        }),
      },
      typeClient: {
        findUnique: vi.fn(async (args: { where: { id?: string; nom?: string } }) => {
          if (args.where.id) return typeClients.get(args.where.id) ?? null;
          if (args.where.nom) return [...typeClients.values()].find((t) => t.nom === args.where.nom) ?? null;
          return null;
        }),
        updateMany: vi.fn(async (args: { where: { id: string }; data: Partial<TypeClientState> }) => {
          const t = typeClients.get(args.where.id);
          if (!t) return { count: 0 };
          typeClients.set(args.where.id, { ...t, ...args.data });
          return { count: 1 };
        }),
        findUniqueOrThrow: vi.fn(async (args: { where: { id: string } }) => {
          const t = typeClients.get(args.where.id);
          if (!t) throw new Error("TypeClient introuvable en base factice");
          return t;
        }),
      },
      produit: {
        findUnique: vi.fn(async (args: { where: { id: string } }) => produits.get(args.where.id) ?? null),
        updateMany: vi.fn(async (args: { where: { id: string }; data: Partial<ProduitState> }) => {
          const p = produits.get(args.where.id);
          if (!p) return { count: 0 };
          produits.set(args.where.id, { ...p, ...args.data });
          return { count: 1 };
        }),
        findUniqueOrThrow: vi.fn(async (args: { where: { id: string } }) => {
          const p = produits.get(args.where.id);
          if (!p) throw new Error("Produit introuvable en base factice");
          return p;
        }),
      },
      travailleur: {
        findUnique: vi.fn(async (args: { where: { id: string } }) => travailleurs.get(args.where.id) ?? null),
        updateMany: vi.fn(async (args: { where: { id: string }; data: Partial<TravailleurState> }) => {
          const t = travailleurs.get(args.where.id);
          if (!t) return { count: 0 };
          travailleurs.set(args.where.id, { ...t, ...args.data });
          return { count: 1 };
        }),
      },
      demandeApprobation: {
        findUnique: vi.fn(async (args: { where: { id: string }; select?: Record<string, true> }) => {
          const d = demandes.get(args.where.id);
          if (!d) return null;
          if (!args.select) return d;
          const projection: Record<string, unknown> = {};
          for (const cle of Object.keys(args.select)) projection[cle] = (d as unknown as Record<string, unknown>)[cle];
          return projection;
        }),
        findUniqueOrThrow: vi.fn(async (args: { where: { id: string } }) => {
          const d = demandes.get(args.where.id);
          if (!d) throw new Error("DemandeApprobation introuvable en base factice");
          return d;
        }),
        updateMany: vi.fn(async (args: { where: { id: string; statut?: string }; data: Partial<DemandeState> }) => {
          const d = demandes.get(args.where.id);
          if (!d) return { count: 0 };
          if (args.where.statut !== undefined && d.statut !== args.where.statut) return { count: 0 };
          demandes.set(args.where.id, { ...d, ...args.data });
          return { count: 1 };
        }),
      },
      auditLog: {
        create: vi.fn(async (args: { data: AuditLogState }) => {
          auditLogs.push({ ...args.data });
          return { id: `audit-${++compteurId}`, ...args.data, createdAt: new Date() };
        }),
      },
    };
  }

  const delegue = construireDelegues(
    etat.utilisateurs,
    etat.typeClients,
    etat.produits,
    etat.travailleurs,
    etat.demandes,
    etat.auditLogs,
  );

  const transactionSpy = vi.fn(async (fn: (tx: typeof delegue) => Promise<unknown>) => {
    // Clone : le callback opère sur une COPIE, jamais sur `etat` directement —
    // ne recopie dans `etat` qu'au succès (voir en-tête de la fonction).
    const clone = {
      utilisateurs: new Map([...etat.utilisateurs].map(([k, v]) => [k, { ...v }])),
      typeClients: new Map([...etat.typeClients].map(([k, v]) => [k, { ...v }])),
      produits: new Map([...etat.produits].map(([k, v]) => [k, { ...v }])),
      travailleurs: new Map([...etat.travailleurs].map(([k, v]) => [k, { ...v }])),
      demandes: new Map([...etat.demandes].map(([k, v]) => [k, { ...v }])),
      auditLogs: [] as AuditLogState[],
    };
    const txClone = construireDelegues(
      clone.utilisateurs,
      clone.typeClients,
      clone.produits,
      clone.travailleurs,
      clone.demandes,
      clone.auditLogs,
    );
    const resultat = await fn(txClone);
    // Succès : commit — recopie le clone dans l'état réel.
    etat.utilisateurs = clone.utilisateurs;
    etat.typeClients = clone.typeClients;
    etat.produits = clone.produits;
    etat.travailleurs = clone.travailleurs;
    etat.demandes = clone.demandes;
    etat.auditLogs.push(...clone.auditLogs);
    return resultat;
  });

  const db = { ...delegue, $transaction: transactionSpy };
  return {
    db: db as unknown as Parameters<typeof supprimerUtilisateurDirect>[0],
    etat,
    transactionSpy,
    forcerP2003SurProchaineSuppression: () => {
      forcerP2003SurSuppression = true;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("supprimerUtilisateurDirect / Tx", () => {
  it("succès : compte supprimé, audit écrit DANS la transaction, une seule transaction ouverte", async () => {
    const { db, etat, transactionSpy } = creerClientFactice({
      utilisateurs: [
        { id: "u-1", nom: "Bakari", email: "bakari@lomoto.cd", roleId: "role-1", roleNom: "Caissier(ère)", motDePasseHash: "x", motDePasseDoitChanger: false, estAdminPrincipal: false },
      ],
    });
    const resultat = await contexteRequete.run(ACTEUR, () => supprimerUtilisateurDirect(db, "u-1"));
    expect(resultat.message).toMatch(/Bakari/);
    expect(etat.utilisateurs.has("u-1")).toBe(false);
    expect(etat.auditLogs).toHaveLength(1);
    expect(etat.auditLogs[0]).toMatchObject({ typeEntite: "Utilisateur", action: "SUPPRESSION", module: "EQUIPE" });
    expect(transactionSpy).toHaveBeenCalledTimes(1); // aucune transaction imbriquée
  });

  it("compte introuvable : ErreurAction 404, aucune écriture", async () => {
    const { db, etat } = creerClientFactice({});
    await expect(contexteRequete.run(ACTEUR, () => supprimerUtilisateurDirect(db, "fantome"))).rejects.toMatchObject({
      status: 404,
    });
    expect(etat.auditLogs).toHaveLength(0);
  });

  it("Admin Principal : ErreurAction 409, jamais supprimé", async () => {
    const { db, etat } = creerClientFactice({
      utilisateurs: [{ id: "u-1", nom: "Aline", email: "aline@lomoto.cd", roleId: "role-1", roleNom: ROLE_ADMINISTRATEUR, motDePasseHash: "x", motDePasseDoitChanger: false, estAdminPrincipal: true }],
    });
    await expect(contexteRequete.run(ACTEUR, () => supprimerUtilisateurDirect(db, "u-1"))).rejects.toMatchObject({ status: 409 });
    expect(etat.utilisateurs.has("u-1")).toBe(true);
  });

  it("P2003 (activité enregistrée) : traduit en ErreurAction 409, ROLLBACK complet (compte toujours présent)", async () => {
    const { db, etat, forcerP2003SurProchaineSuppression } = creerClientFactice({
      utilisateurs: [{ id: "u-1", nom: "Bakari", email: "bakari@lomoto.cd", roleId: "role-1", roleNom: "Caissier(ère)", motDePasseHash: "x", motDePasseDoitChanger: false, estAdminPrincipal: false }],
    });
    forcerP2003SurProchaineSuppression();
    await expect(contexteRequete.run(ACTEUR, () => supprimerUtilisateurDirect(db, "u-1"))).rejects.toMatchObject({ status: 409 });
    expect(etat.utilisateurs.has("u-1")).toBe(true); // rollback : jamais supprimé
    expect(etat.auditLogs).toHaveLength(0); // rollback : aucun audit orphelin
  });

  it("acteur absent du contexte de requête : ErreurActeurRequisPourAudit, ROLLBACK (compte toujours présent)", async () => {
    const { db, etat } = creerClientFactice({
      utilisateurs: [{ id: "u-1", nom: "Bakari", email: "bakari@lomoto.cd", roleId: "role-1", roleNom: "Caissier(ère)", motDePasseHash: "x", motDePasseDoitChanger: false, estAdminPrincipal: false }],
    });
    await expect(supprimerUtilisateurDirect(db, "u-1")).rejects.toBeInstanceOf(ErreurActeurRequisPourAudit);
    expect(etat.utilisateurs.has("u-1")).toBe(true);
  });
});

describe("creerCompteAdminDirect / Tx", () => {
  const DONNEES = { nom: "Nouvel Admin", email: "nouvel@lomoto.cd", roleId: "role-admin", motDePasseHash: "hash" };

  it("succès sans travailleurId : compte créé, aucun audit (create jamais intercepté)", async () => {
    const { db, etat, transactionSpy } = creerClientFactice({});
    const resultat = await contexteRequete.run(ACTEUR, () => creerCompteAdminDirect(db, DONNEES));
    expect(resultat.message).toMatch(/Nouvel Admin/);
    expect([...etat.utilisateurs.values()]).toHaveLength(1);
    expect(etat.auditLogs).toHaveLength(0);
    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });

  it("succès avec travailleurId : rattachement ATOMIQUE + audit Travailleur", async () => {
    const { db, etat } = creerClientFactice({
      travailleurs: [{ id: "t-1", nom: "Bakari", utilisateurId: null }],
    });
    await contexteRequete.run(ACTEUR, () => creerCompteAdminDirect(db, { ...DONNEES, travailleurId: "t-1" }));
    const compte = [...etat.utilisateurs.values()][0]!;
    expect(etat.travailleurs.get("t-1")!.utilisateurId).toBe(compte.id);
    expect(etat.auditLogs).toHaveLength(1);
    expect(etat.auditLogs[0]).toMatchObject({ typeEntite: "Travailleur", action: "MODIFICATION", module: "TRAVAILLEURS" });
  });

  it("email déjà utilisé : ErreurAction 409, aucune création", async () => {
    const { db, etat } = creerClientFactice({
      utilisateurs: [{ id: "u-existant", nom: "X", email: DONNEES.email, roleId: "r", roleNom: "Caissier(ère)", motDePasseHash: "x", motDePasseDoitChanger: false, estAdminPrincipal: false }],
    });
    await expect(contexteRequete.run(ACTEUR, () => creerCompteAdminDirect(db, DONNEES))).rejects.toMatchObject({ status: 409 });
    expect([...etat.utilisateurs.values()]).toHaveLength(1);
  });

  it(`limite de ${MAX_COMPTES_ADMIN} comptes Administrateur atteinte : ErreurAction 409, aucune création`, async () => {
    const admins: UtilisateurState[] = Array.from({ length: MAX_COMPTES_ADMIN }, (_, i) => ({
      id: `admin-${i}`,
      nom: `Admin ${i}`,
      email: `admin${i}@lomoto.cd`,
      roleId: "role-admin",
      roleNom: ROLE_ADMINISTRATEUR,
      motDePasseHash: "x",
      motDePasseDoitChanger: false,
      estAdminPrincipal: i === 0,
    }));
    const { db, etat } = creerClientFactice({ utilisateurs: admins });
    await expect(contexteRequete.run(ACTEUR, () => creerCompteAdminDirect(db, DONNEES))).rejects.toMatchObject({ status: 409 });
    expect([...etat.utilisateurs.values()]).toHaveLength(MAX_COMPTES_ADMIN);
  });

  it("travailleurId invalide : ErreurAction 404, ROLLBACK complet — le compte créé juste avant N'EST PAS conservé", async () => {
    const { db, etat } = creerClientFactice({});
    await expect(
      contexteRequete.run(ACTEUR, () => creerCompteAdminDirect(db, { ...DONNEES, travailleurId: "fantome" })),
    ).rejects.toMatchObject({ status: 404 });
    // Preuve du tout-ou-rien : le `create` Utilisateur a bien été exécuté DANS
    // la transaction avant l'échec du rattachement, mais le rollback l'annule
    // entièrement — aucune création partielle ne survit.
    expect([...etat.utilisateurs.values()]).toHaveLength(0);
    expect(etat.auditLogs).toHaveLength(0);
  });

  it("acteur absent du contexte de requête au moment de l'audit Travailleur : ROLLBACK, aucune création survivante", async () => {
    const { db, etat } = creerClientFactice({ travailleurs: [{ id: "t-1", nom: "Bakari", utilisateurId: null }] });
    await expect(db.$transaction((tx) => creerCompteAdminTx(tx, { ...DONNEES, travailleurId: "t-1" }))).rejects.toBeInstanceOf(
      ErreurActeurRequisPourAudit,
    );
    expect([...etat.utilisateurs.values()]).toHaveLength(0);
    expect(etat.travailleurs.get("t-1")!.utilisateurId).toBeNull();
  });
});

describe("modifierTypeClientDirect / Tx", () => {
  it("succès : mis à jour, audit écrit", async () => {
    const { db, etat } = creerClientFactice({ typeClients: [{ id: "tc-1", nom: "Dépositaire", prixParBac: 4100, commissionParBac: 0 }] });
    const resultat = await contexteRequete.run(ACTEUR, () => modifierTypeClientDirect(db, "tc-1", { prixParBac: 4200 }));
    expect(resultat.message).toMatch(/Dépositaire/);
    expect(etat.typeClients.get("tc-1")!.prixParBac).toBe(4200);
    expect(etat.auditLogs).toHaveLength(1);
    expect(etat.auditLogs[0]).toMatchObject({ typeEntite: "TypeClient", action: "MODIFICATION", module: "PARAMETRES" });
  });

  it("introuvable : ErreurAction 404", async () => {
    const { db } = creerClientFactice({});
    await expect(contexteRequete.run(ACTEUR, () => modifierTypeClientDirect(db, "fantome", { prixParBac: 1 }))).rejects.toMatchObject({
      status: 404,
    });
  });

  it("nom déjà pris par une autre Qualité : ErreurAction 409, aucune écriture", async () => {
    const { db, etat } = creerClientFactice({
      typeClients: [
        { id: "tc-1", nom: "Dépositaire", prixParBac: 4100, commissionParBac: 0 },
        { id: "tc-2", nom: "Maman", prixParBac: 6000, commissionParBac: 1650 },
      ],
    });
    await expect(contexteRequete.run(ACTEUR, () => modifierTypeClientDirect(db, "tc-1", { nom: "Maman" }))).rejects.toMatchObject({
      status: 409,
    });
    expect(etat.typeClients.get("tc-1")!.nom).toBe("Dépositaire");
  });
});

describe("modifierTauxTaxeDirect / Tx", () => {
  it("succès : taux mis à jour, audit écrit", async () => {
    const { db, etat } = creerClientFactice({ produits: [{ id: "p-1", nom: "Pain de mie", tauxTaxe: 0 }] });
    const resultat = await contexteRequete.run(ACTEUR, () => modifierTauxTaxeDirect(db, "p-1", { tauxTaxe: 0.18 }));
    expect(resultat.message).toMatch(/Pain de mie/);
    expect(etat.produits.get("p-1")!.tauxTaxe).toBe(0.18);
    expect(etat.auditLogs).toHaveLength(1);
    expect(etat.auditLogs[0]).toMatchObject({ typeEntite: "Produit", action: "MODIFICATION", module: "PARAMETRES" });
  });

  it("introuvable : ErreurAction 404", async () => {
    const { db } = creerClientFactice({});
    await expect(contexteRequete.run(ACTEUR, () => modifierTauxTaxeDirect(db, "fantome", { tauxTaxe: 0.1 }))).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("approuverEtExecuterActionMetier — atomicité réservation + exécution + transition", () => {
  function demandeInitiale(overrides: Partial<DemandeState>): DemandeState {
    return {
      id: "demande-1",
      type: "MODIFIER_TAUX_TAXE",
      donnees: { produitId: "p-1", data: { tauxTaxe: 0.18 } },
      statut: "EN_ATTENTE",
      demandeParId: "u-secondaire",
      demandePar: { id: "u-secondaire", nom: "Bakari (Admin secondaire)" },
      approuveParId: null,
      dateDecision: null,
      erreur: null,
      ...overrides,
    };
  }

  it("succès (MODIFIER_TAUX_TAXE) : demande APPROUVEE, produit mis à jour, une seule transaction", async () => {
    const { db, etat, transactionSpy } = creerClientFactice({
      produits: [{ id: "p-1", nom: "Pain de mie", tauxTaxe: 0 }],
      demandes: [demandeInitiale({})],
    });
    const resultat = await contexteRequete.run(ACTEUR, () => approuverEtExecuterActionMetier(db, "demande-1", ACTEUR));
    expect(resultat.demandeStatut).toBe("APPROUVEE");
    expect(etat.demandes.get("demande-1")!.statut).toBe("APPROUVEE");
    expect(etat.demandes.get("demande-1")!.approuveParId).toBe(ACTEUR.id);
    expect(etat.produits.get("p-1")!.tauxTaxe).toBe(0.18);
    expect(transactionSpy).toHaveBeenCalledTimes(1);
  });

  it("succès (SUPPRIMER_UTILISATEUR) : demande APPROUVEE ET compte supprimé, dans la même transaction", async () => {
    const { db, etat } = creerClientFactice({
      utilisateurs: [{ id: "u-cible", nom: "Cible", email: "cible@lomoto.cd", roleId: "r", roleNom: "Caissier(ère)", motDePasseHash: "x", motDePasseDoitChanger: false, estAdminPrincipal: false }],
      demandes: [demandeInitiale({ type: "SUPPRIMER_UTILISATEUR", donnees: { utilisateurId: "u-cible" } })],
    });
    await contexteRequete.run(ACTEUR, () => approuverEtExecuterActionMetier(db, "demande-1", ACTEUR));
    expect(etat.demandes.get("demande-1")!.statut).toBe("APPROUVEE");
    expect(etat.utilisateurs.has("u-cible")).toBe(false);
  });

  it("réservation perdue (demande déjà décidée) : ErreurApprobationConcurrente, aucune exécution", async () => {
    const { db, etat } = creerClientFactice({
      produits: [{ id: "p-1", nom: "Pain de mie", tauxTaxe: 0 }],
      demandes: [demandeInitiale({ statut: "REJETEE", approuveParId: "u-autre" })],
    });
    await expect(contexteRequete.run(ACTEUR, () => approuverEtExecuterActionMetier(db, "demande-1", ACTEUR))).rejects.toBeInstanceOf(
      ErreurApprobationConcurrente,
    );
    expect(etat.produits.get("p-1")!.tauxTaxe).toBe(0); // jamais exécuté
  });

  it("échec métier (produit introuvable) : ROLLBACK complet — demande redevenue EN_ATTENTE, jamais APPROUVEE à tort", async () => {
    const { db, etat } = creerClientFactice({
      demandes: [demandeInitiale({ donnees: { produitId: "fantome", data: { tauxTaxe: 0.18 } } })],
    });
    await expect(contexteRequete.run(ACTEUR, () => approuverEtExecuterActionMetier(db, "demande-1", ACTEUR))).rejects.toMatchObject({
      status: 404,
    });
    // La réservation (statut → APPROUVEE) avait eu lieu AVANT l'échec métier,
    // dans la MÊME transaction — le rollback l'annule elle aussi.
    expect(etat.demandes.get("demande-1")!.statut).toBe("EN_ATTENTE");
    expect(etat.demandes.get("demande-1")!.approuveParId).toBeNull();
  });

  it("P2034 transitoire : réessayé automatiquement, succès à la 2e tentative", async () => {
    const { db, etat, transactionSpy } = creerClientFactice({
      produits: [{ id: "p-1", nom: "Pain de mie", tauxTaxe: 0 }],
      demandes: [demandeInitiale({})],
    });
    let appels = 0;
    const resultat = await contexteRequete.run(ACTEUR, () =>
      approuverEtExecuterActionMetier(db, "demande-1", ACTEUR, {
        apresReservationAvantExecution: async () => {
          appels++;
          if (appels === 1) throw new ErreurP2034Factice();
        },
      }),
    );
    expect(resultat.demandeStatut).toBe("APPROUVEE");
    expect(etat.demandes.get("demande-1")!.statut).toBe("APPROUVEE");
    expect(transactionSpy).toHaveBeenCalledTimes(2); // 1 tentative avortée + 1 réussie
  });

  it("P2034 persistant, demande devenue REJETEE entre-temps (décision concurrente réellement gagnante) : 409 honnête", async () => {
    const { db, etat } = creerClientFactice({
      produits: [{ id: "p-1", nom: "Pain de mie", tauxTaxe: 0 }],
      demandes: [demandeInitiale({})],
    });
    let appels = 0;
    await expect(
      contexteRequete.run(ACTEUR, () =>
        approuverEtExecuterActionMetier(db, "demande-1", ACTEUR, {
          apresReservationAvantExecution: async () => {
            appels++;
            if (appels === 3) {
              // Simule une décision concurrente RÉELLE (transaction séparée,
              // committée) exactement au moment du dernier échec forcé.
              etat.demandes.set("demande-1", { ...etat.demandes.get("demande-1")!, statut: "REJETEE", approuveParId: "u-autre" });
            }
            throw new ErreurP2034Factice();
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ErreurApprobationConcurrente);
    expect(appels).toBe(3); // NB_TENTATIVES_MAX_P2034
  });

  it("P2034 persistant, demande TOUJOURS EN_ATTENTE après épuisement : 503 réessayable, jamais « déjà traitée »", async () => {
    const { db } = creerClientFactice({
      produits: [{ id: "p-1", nom: "Pain de mie", tauxTaxe: 0 }],
      demandes: [demandeInitiale({})],
    });
    await expect(
      contexteRequete.run(ACTEUR, () =>
        approuverEtExecuterActionMetier(db, "demande-1", ACTEUR, {
          apresReservationAvantExecution: async () => {
            throw new ErreurP2034Factice();
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ErreurConflitApprobationReessayable);
  });
});
