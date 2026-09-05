/**
 * Preuve de route HTTP RÉELLE (passe par le routeur Express, via supertest)
 * pour :
 *  - `POST /api/approbations/:id/rejeter` (correctif P1-01, Round 3, contre-
 *    revue Codex du 24/08/2026) : la transition vers REJETEE doit désormais
 *    être une écriture CONDITIONNELLE (`WHERE statut = 'EN_ATTENTE'`),
 *    jamais une pré-lecture puis un `update` inconditionnel.
 *  - `POST /api/approbations/:id/approuver`, chemin des 4 AUTRES types
 *    d'action critique (`SUPPRIMER_UTILISATEUR`, `CREER_COMPTE_ADMIN`,
 *    `MODIFIER_TYPE_CLIENT`, `MODIFIER_TAUX_TAXE`) — mission P1 « atomicité
 *    exécution métier + décision » (25/08/2026) : ce chemin passe désormais
 *    par le même mécanisme atomique générique que MODIFIER_PERMISSIONS_ROLE
 *    (`approuverEtExecuterActionMetier`, `services/actionsCritiquesMetier.js`)
 *    — réservation + exécution métier + transition, LE TOUT dans une seule
 *    transaction. Mocke la fonction la plus profonde (comme
 *    `approbations.permissionsRole.test.ts` le fait pour
 *    `approuverEtAppliquerModificationPermissionsRole`) — laisse le routeur
 *    réel décider l'aiguillage et traduire les erreurs en codes HTTP.
 *
 * Le `/rejeter` mocke `../lib/prisma.js` (client factice en mémoire,
 * `demandeApprobation` uniquement) mais PAS `../services/demandeApprobation.js`
 * : `rejeterDemandeApprobationAtomique` tourne RÉELLEMENT contre le client
 * factice, pour prouver le câblage complet route → mécanisme atomique, pas
 * seulement la route isolée.
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
  demandeFindUnique: vi.fn(),
  demandeFindUniqueOrThrow: vi.fn(),
  demandeUpdate: vi.fn(),
  approuverEtExecuterActionMetier: vi.fn(),
  // Conteneur pour le client Prisma factice courant : réaffecté au début de
  // chaque test (`creerPrismaFactice`). Doit vivre DANS `vi.hoisted` (et non
  // via un `Object.assign` séparé plus bas dans le fichier) car les
  // factories `vi.mock` sont hoistées au-dessus de toute déclaration
  // normale — seule une valeur issue de `vi.hoisted` est garantie déjà
  // initialisée au moment où `../lib/prisma.js` est résolu.
  etatPrisma: { actuel: undefined as unknown },
}));

vi.mock("../lib/prisma.js", () => ({
  get prisma() {
    return mocks.etatPrisma.actuel;
  },
}));

vi.mock("../services/actionsCritiques.js", () => ({
  ErreurAction: class ErreurAction extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock("../services/actionsCritiquesMetier.js", () => ({
  approuverEtExecuterActionMetier: mocks.approuverEtExecuterActionMetier,
}));

// Non exercé par ces tests (MODIFIER_PERMISSIONS_ROLE), mais importé par
// `routes/approbations.ts` — les classes d'erreur RÉELLES sont conservées
// (elles sont désormais génériques, `demandeApprobation.js`, et
// `actionsCritiquesMetier.js` en lève de vraies instances ci-dessous) ; seule
// la fonction profonde propre à MODIFIER_PERMISSIONS_ROLE est mockée.
vi.mock("../services/permissionsRoleAudit.js", async () => {
  const actual = await vi.importActual<typeof import("../services/permissionsRoleAudit.js")>(
    "../services/permissionsRoleAudit.js",
  );
  return {
    ErreurApprobationConcurrente: actual.ErreurApprobationConcurrente,
    ErreurConflitApprobationReessayable: actual.ErreurConflitApprobationReessayable,
    approuverEtAppliquerModificationPermissionsRole: vi.fn(),
  };
});

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
import { ErreurApprobationConcurrente, ErreurConflitApprobationReessayable } from "../services/demandeApprobation.js";

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
    if (!args.select) return avecRelationApprouvePar(d);
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

describe("POST /api/approbations/:id/approuver — chemin des 4 autres types (mission P1, 25/08/2026 — atomicité complète)", () => {
  it("exécution réussie : 200, APPROUVEE, message renvoyé, câblage exact vers le mécanisme atomique", async () => {
    const { demandes } = creerPrismaFactice([demandeInitiale()]);
    mocks.approuverEtExecuterActionMetier.mockResolvedValue({
      message: "Taux de taxe mis à jour",
      demandeStatut: "APPROUVEE",
      demandeApprouveParId: PRINCIPAL.id,
      demandeDateDecision: new Date("2026-08-25T10:00:00Z"),
    });
    // La relecture finale (après l'appel atomique mocké) simule ce que la
    // VRAIE transaction aurait committé.
    demandes.set(DEMANDE_ID, { ...demandes.get(DEMANDE_ID)!, statut: "APPROUVEE", approuveParId: PRINCIPAL.id });
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Taux de taxe mis à jour");
    expect(res.body.demande.statut).toBe("APPROUVEE");
    expect(mocks.approuverEtExecuterActionMetier).toHaveBeenCalledTimes(1);
    expect(mocks.approuverEtExecuterActionMetier).toHaveBeenCalledWith(expect.anything(), DEMANDE_ID, PRINCIPAL);
  });

  it("réservation perdue (course concurrente déjà tranchée) : 409, jamais de relecture DTO", async () => {
    creerPrismaFactice([demandeInitiale()]);
    mocks.approuverEtExecuterActionMetier.mockRejectedValue(new ErreurApprobationConcurrente());
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});
    expect(res.status).toBe(409);
    expect(res.body.erreur).toBe("Cette demande a déjà été traitée");
  });

  it("P2034 persistant, demande toujours EN_ATTENTE après épuisement : 503, message honnête, pas « déjà traitée »", async () => {
    creerPrismaFactice([demandeInitiale()]);
    mocks.approuverEtExecuterActionMetier.mockRejectedValue(new ErreurConflitApprobationReessayable());
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});
    expect(res.status).toBe(503);
    expect(res.body.erreur).not.toMatch(/déjà été traitée/);
    expect(res.body.erreur).toMatch(/réessay/i);
  });

  it("échec de l'action métier : erreur enregistrée UNIQUEMENT si la demande est encore EN_ATTENTE", async () => {
    const { demandes } = creerPrismaFactice([demandeInitiale()]);
    const ErreurActionMod = await import("../services/actionsCritiques.js");
    mocks.approuverEtExecuterActionMetier.mockRejectedValue(new ErreurActionMod.ErreurAction(422, "Produit introuvable"));
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});
    expect(res.status).toBe(422);
    expect(demandes.get(DEMANDE_ID)!.erreur).toBe("Produit introuvable");
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("EN_ATTENTE");
  });

  it("échec de l'action métier APRÈS un rejet concurrent : le message d'erreur périmé n'est PAS écrit sur la décision terminale", async () => {
    const { demandes } = creerPrismaFactice([demandeInitiale({ statut: "REJETEE", approuveParId: "u-autre" })]);
    const ErreurActionMod = await import("../services/actionsCritiques.js");
    mocks.approuverEtExecuterActionMetier.mockRejectedValue(new ErreurActionMod.ErreurAction(422, "Produit introuvable"));
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});
    expect(res.status).toBe(422);
    expect(demandes.get(DEMANDE_ID)!.erreur).toBeNull(); // jamais écrit sur une demande déjà REJETEE
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("REJETEE");
  });

  it("demande introuvable (pré-check léger) : 404, mécanisme atomique jamais appelé", async () => {
    creerPrismaFactice([]);
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});
    expect(res.status).toBe(404);
    expect(mocks.approuverEtExecuterActionMetier).not.toHaveBeenCalled();
  });

  it("acteur non Admin Principal : 403, mécanisme atomique jamais appelé", async () => {
    creerPrismaFactice([demandeInitiale()]);
    utilisateurActuel = { ...DEMANDEUR, estAdminPrincipal: false };
    const res = await request(appApprobations()).post(`/api/approbations/${DEMANDE_ID}/approuver`).send({});
    expect(res.status).toBe(403);
    expect(mocks.approuverEtExecuterActionMetier).not.toHaveBeenCalled();
  });
});
