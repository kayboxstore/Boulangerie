/**
 * Preuve de route HTTP RÉELLE (passe par le routeur Express, via supertest)
 * pour :
 *  - `POST /api/approbations/:id/rejeter` (correctif P1-01, Round 3, contre-
 *    revue Codex du 24/08/2026) : la transition vers REJETEE doit désormais
 *    être une écriture CONDITIONNELLE (`WHERE statut = 'EN_ATTENTE'`),
 *    jamais une pré-lecture puis un `update` inconditionnel.
 *  - `POST /api/approbations/:id/approuver`, chemin des 4 AUTRES types
 *    d'action critique (`SUPPRIMER_UTILISATEUR`, `CREER_COMPTE_ADMIN`,
 *    `MODIFIER_TYPE_CLIENT`, `MODIFIER_TAUX_TAXE`) : la transition finale
 *    vers APPROUVEE doit elle aussi être conditionnelle, pour ne plus
 *    écraser un rejet concurrent déjà gagnant.
 *
 * Mocke `../lib/prisma.js` (client factice en mémoire, `demandeApprobation`
 * uniquement) et `../services/actionsCritiques.js` (`executerAction`) — mais
 * PAS `../services/demandeApprobation.js` : les fonctions génériques
 * atomiques (`rejeterDemandeApprobationAtomique`,
 * `marquerApprouveeSiEncoreEnAttente`, `enregistrerErreurSiEncoreEnAttente`)
 * tournent RÉELLEMENT contre le client factice, pour prouver le câblage
 * complet route → mécanisme atomique, pas seulement la route isolée.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface DemandeState {
  id: string;
  type: string;
  resume: string;
  donnees: unknown;
  statut: "EN_ATTENTE" | "APPROUVEE" | "REJETEE";
  demandeParId: string;
  demandePar: { id: string; nom: string };
  approuveParId: string | null;
  approuvePar: { id: string; nom: string } | null;
  erreur: string | null;
  dateDemande: Date;
  dateDecision: Date | null;
}

const mocks = vi.hoisted(() => ({
  executerAction: vi.fn(),
  // Conteneur pour le client Prisma factice courant : réaffecté au début de
  // chaque test (`creerPrismaFactice`). Indirection nécessaire car les
  // factories `vi.mock` sont hoistées au-dessus des déclarations normales du
  // fichier — seule une valeur issue de `vi.hoisted` peut y être référencée
  // en toute sécurité (sinon TDZ au moment du chargement du module réel).
  etatPrisma: { actuel: undefined as unknown },
}));

vi.mock("../lib/prisma.js", () => ({
  get prisma() {
    return mocks.etatPrisma.actuel;
  },
}));

vi.mock("../services/actionsCritiques.js", () => ({
  executerAction: mocks.executerAction,
  ErreurAction: class ErreurAction extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

// Non exercé par ces tests (MODIFIER_PERMISSIONS_ROLE), mais importé par
// `routes/approbations.ts` — mock minimal pour ne pas construire un vrai
// PrismaClient au chargement du module.
vi.mock("../services/permissionsRoleAudit.js", () => ({
  approuverEtAppliquerModificationPermissionsRole: vi.fn(),
  ErreurApprobationConcurrente: class ErreurApprobationConcurrente extends Error {},
}));

const PRINCIPAL = { id: "u-principal", nom: "Aline (Admin Principal)" };
let utilisateurActuel: { id: string; nom: string; estAdminPrincipal: boolean } = { ...PRINCIPAL, estAdminPrincipal: true };

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = utilisateurActuel as express.Request["utilisateur"];
    next();
  },
  requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { approbationsRouter } from "./approbations.js";

function appApprobations() {
  const app = express();
  app.use(express.json());
  app.use("/api/approbations", approbationsRouter);
  return app;
}

// Simule la relation `approuvePar` : en Prisma réel, `updateMany` n'écrit que
// `approuveParId` — c'est une relecture ultérieure AVEC `include` qui
// résout l'objet complet. Le client factice reproduit ce comportement plutôt
// que de stocker `approuvePar` directement à l'écriture.
const ANNUAIRE: Record<string, { id: string; nom: string }> = {
  [PRINCIPAL.id]: PRINCIPAL,
  "u-autre": { id: "u-autre", nom: "Un autre décideur (test)" },
};

function avecRelationApprouvePar(d: DemandeState): DemandeState {
  return { ...d, approuvePar: d.approuveParId ? (ANNUAIRE[d.approuveParId] ?? null) : null };
}

function creerPrismaFactice(demandesInitiales: DemandeState[]) {
  const demandes = new Map(demandesInitiales.map((d) => [d.id, { ...d }]));

  const findUnique = vi.fn(async (args: { where: { id: string }; select?: Record<string, true> }) => {
    const d = demandes.get(args.where.id);
    if (!d) return null;
    if (!args.select) return avecRelationApprouvePar(d); // chemin ancien (4 autres types) : objet complet
    const projection: Record<string, unknown> = {};
    for (const cle of Object.keys(args.select)) projection[cle] = (d as unknown as Record<string, unknown>)[cle];
    return projection;
  });

  const findUniqueOrThrow = vi.fn(async (args: { where: { id: string } }) => {
    const d = demandes.get(args.where.id);
    if (!d) throw new Error(`DemandeApprobation introuvable en base factice : ${args.where.id}`);
    return avecRelationApprouvePar(d);
  });

  const updateMany = vi.fn(
    async (args: { where: { id: string; statut?: string }; data: Partial<DemandeState> }) => {
      const d = demandes.get(args.where.id);
      if (!d) return { count: 0 };
      if (args.where.statut !== undefined && d.statut !== args.where.statut) return { count: 0 };
      demandes.set(args.where.id, { ...d, ...args.data });
      return { count: 1 };
    },
  );

  const delegue = { demandeApprobation: { findUnique, findUniqueOrThrow, updateMany } };
  const prisma = {
    demandeApprobation: { findUnique, findUniqueOrThrow, updateMany },
    $transaction: vi.fn(async (fn: (tx: typeof delegue) => Promise<unknown>) => fn(delegue)),
  };
  mocks.etatPrisma.actuel = prisma;
  return { demandes };
}

const DEMANDE_ID = "demande-1";
const DEMANDEUR = { id: "u-secondaire", nom: "Bakari (Admin secondaire)" };

function demandeInitiale(overrides: Partial<DemandeState> = {}): DemandeState {
  return {
    id: DEMANDE_ID,
    type: "MODIFIER_TAUX_TAXE",
    resume: "modifier le taux de taxe du produit « Pain de mie »",
    donnees: { produitId: "produit-1", data: { tauxTaxe: 0.18 } },
    statut: "EN_ATTENTE",
    demandeParId: DEMANDEUR.id,
    demandePar: DEMANDEUR,
    approuveParId: null,
    approuvePar: null,
    erreur: null,
    dateDemande: new Date("2026-08-25T09:00:00Z"),
    dateDecision: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  utilisateurActuel = { ...PRINCIPAL, estAdminPrincipal: true };
});

describe("POST /api/approbations/:id/rejeter (Round 3, P1-01 — transition conditionnelle)", () => {
  it("demande EN_ATTENTE : 200, REJETEE avec l'identité exacte du rejeteur", async () => {
    const { demandes } = creerPrismaFactice([demandeInitiale()]);
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/rejeter`).send({});
    expect(res.status).toBe(200);
    expect(res.body.demande.statut).toBe("REJETEE");
    expect(res.body.demande.approuvePar).toEqual(PRINCIPAL);
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("REJETEE");
  });

  it("demande déjà APPROUVEE (course concurrente déjà gagnée par l'approbation) : 409, jamais écrasée en REJETEE", async () => {
    const { demandes } = creerPrismaFactice([demandeInitiale({ statut: "APPROUVEE", approuveParId: "u-autre" })]);
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/rejeter`).send({});
    expect(res.status).toBe(409);
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("APPROUVEE"); // jamais écrasée
    expect(demandes.get(DEMANDE_ID)!.approuveParId).toBe("u-autre");
  });

  it("demande introuvable : 404", async () => {
    creerPrismaFactice([]);
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/rejeter`).send({});
    expect(res.status).toBe(404);
  });

  it("acteur non Admin Principal : 403, aucune écriture", async () => {
    const { demandes } = creerPrismaFactice([demandeInitiale()]);
    utilisateurActuel = { ...DEMANDEUR, estAdminPrincipal: false };
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/rejeter`).send({});
    expect(res.status).toBe(403);
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("EN_ATTENTE");
  });
});

describe("POST /api/approbations/:id/approuver — chemin des 4 autres types (Round 3, P1-01 — transition finale conditionnelle)", () => {
  it("exécution réussie : 200, APPROUVEE, message renvoyé", async () => {
    const { demandes } = creerPrismaFactice([demandeInitiale()]);
    mocks.executerAction.mockResolvedValue({ message: "Taux de taxe mis à jour" });
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Taux de taxe mis à jour");
    expect(res.body.demande.statut).toBe("APPROUVEE");
    expect(demandes.get(DEMANDE_ID)!.approuveParId).toBe(PRINCIPAL.id);
  });

  it("rejet concurrent gagnant PENDANT l'exécution de l'action : 409 honnête, action déjà exécutée mais transition perdue", async () => {
    const { demandes } = creerPrismaFactice([demandeInitiale()]);
    // Simule la course : au moment où `executerAction` s'exécute (donc APRÈS
    // le pré-check EN_ATTENTE mais AVANT la transition finale), une requête
    // concurrente de rejet gagne et fait passer la demande à REJETEE.
    mocks.executerAction.mockImplementation(async () => {
      demandes.set(DEMANDE_ID, { ...demandes.get(DEMANDE_ID)!, statut: "REJETEE", approuveParId: "u-autre" });
      return { message: "Taux de taxe mis à jour" };
    });
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});
    expect(res.status).toBe(409);
    expect(res.body.erreur).toMatch(/rejetée entre-temps/);
    // La transition finale n'a JAMAIS écrasé le rejet déjà gagnant.
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("REJETEE");
    expect(demandes.get(DEMANDE_ID)!.approuveParId).toBe("u-autre");
  });

  it("échec de l'action métier : erreur enregistrée UNIQUEMENT si la demande est encore EN_ATTENTE", async () => {
    const { demandes } = creerPrismaFactice([demandeInitiale()]);
    const ErreurActionMod = await import("../services/actionsCritiques.js");
    mocks.executerAction.mockRejectedValue(new ErreurActionMod.ErreurAction(422, "Produit introuvable"));
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});
    expect(res.status).toBe(422);
    expect(demandes.get(DEMANDE_ID)!.erreur).toBe("Produit introuvable");
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("EN_ATTENTE");
  });

  it("échec de l'action métier APRÈS un rejet concurrent : le message d'erreur périmé n'est PAS écrit sur la décision terminale", async () => {
    const { demandes } = creerPrismaFactice([demandeInitiale()]);
    const ErreurActionMod = await import("../services/actionsCritiques.js");
    mocks.executerAction.mockImplementation(async () => {
      demandes.set(DEMANDE_ID, { ...demandes.get(DEMANDE_ID)!, statut: "REJETEE", approuveParId: "u-autre" });
      throw new ErreurActionMod.ErreurAction(422, "Produit introuvable");
    });
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});
    expect(res.status).toBe(422);
    expect(demandes.get(DEMANDE_ID)!.erreur).toBeNull(); // jamais écrit sur une demande déjà REJETEE
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("REJETEE");
  });

  it("demande déjà décidée AVANT même l'exécution (pré-check) : 409, executerAction jamais appelée", async () => {
    creerPrismaFactice([demandeInitiale({ statut: "REJETEE" })]);
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});
    expect(res.status).toBe(409);
    expect(mocks.executerAction).not.toHaveBeenCalled();
  });
});
