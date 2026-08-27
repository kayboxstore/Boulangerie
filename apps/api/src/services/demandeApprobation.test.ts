/**
 * Preuves du mécanisme GÉNÉRIQUE de transition atomique de
 * `DemandeApprobation` (correctif P1-01, Round 3, contre-revue Codex du
 * 24/08/2026) — voir l'en-tête de `demandeApprobation.ts` pour le défaut
 * corrigé (course rejet/approbation par pré-lecture puis `update`
 * inconditionnel).
 *
 * Ces tests MOCKENT Prisma : un client factice en mémoire (même convention
 * que `permissionsRoleAudit.test.ts`) — preuve LOGIQUE de l'écriture
 * conditionnelle et de la garde `EN_ATTENTE`. La preuve AUTORITAIRE de la
 * VRAIE concurrence PostgreSQL (deux connexions séparées, verrou de ligne
 * réellement observé) est apportée par
 * `scripts/verifier-audit-permissions-role-ci.ts` (nouveaux scénarios
 * approbation-gagne-contre-rejet / rejet-gagne-contre-approbation).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enregistrerErreurSiEncoreEnAttente,
  ErreurDecisionConcurrente,
  rejeterDemandeApprobationAtomique,
  type IdentiteDecideur,
} from "./demandeApprobation.js";

interface DemandeState {
  id: string;
  statut: "EN_ATTENTE" | "APPROUVEE" | "REJETEE";
  approuveParId: string | null;
  dateDecision: Date | null;
  erreur: string | null;
}

function creerClientFactice(demandesInitiales: DemandeState[]) {
  const demandes = new Map(demandesInitiales.map((d) => [d.id, { ...d }]));

  const updateMany = vi.fn(
    async (args: { where: { id: string; statut: string }; data: Partial<DemandeState> }) => {
      const d = demandes.get(args.where.id);
      if (!d || d.statut !== args.where.statut) return { count: 0 };
      demandes.set(args.where.id, { ...d, ...args.data });
      return { count: 1 };
    },
  );

  const delegue = { demandeApprobation: { updateMany } };

  const client = {
    demandeApprobation: { updateMany },
    $transaction: vi.fn(async (fn: (tx: typeof delegue) => Promise<unknown>) => fn(delegue)),
  };

  return { client: client as never, demandes };
}

const DEMANDE_ID = "demande-1";
const REJETEUR: IdentiteDecideur = { id: "u-principal", nom: "Aline (Admin Principal)" };

function demandeInitiale(overrides: Partial<DemandeState> = {}): DemandeState {
  return { id: DEMANDE_ID, statut: "EN_ATTENTE", approuveParId: null, dateDecision: null, erreur: null, ...overrides };
}

describe("rejeterDemandeApprobationAtomique", () => {
  beforeEach(() => vi.clearAllMocks());

  it("demande EN_ATTENTE : passe à REJETEE avec l'identité exacte du rejeteur", async () => {
    const { client, demandes } = creerClientFactice([demandeInitiale()]);
    await rejeterDemandeApprobationAtomique(client, DEMANDE_ID, REJETEUR);
    const d = demandes.get(DEMANDE_ID)!;
    expect(d.statut).toBe("REJETEE");
    expect(d.approuveParId).toBe(REJETEUR.id);
    expect(d.dateDecision).not.toBeNull();
  });

  it("demande déjà APPROUVEE : ErreurDecisionConcurrente, jamais écrasée en REJETEE", async () => {
    const { client, demandes } = creerClientFactice([demandeInitiale({ statut: "APPROUVEE", approuveParId: "u-autre" })]);
    await expect(rejeterDemandeApprobationAtomique(client, DEMANDE_ID, REJETEUR)).rejects.toThrow(
      ErreurDecisionConcurrente,
    );
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("APPROUVEE"); // décision terminale jamais écrasée
    expect(demandes.get(DEMANDE_ID)!.approuveParId).toBe("u-autre");
  });

  it("demande déjà REJETEE (double rejet) : ErreurDecisionConcurrente également", async () => {
    const { client } = creerClientFactice([demandeInitiale({ statut: "REJETEE" })]);
    await expect(rejeterDemandeApprobationAtomique(client, DEMANDE_ID, REJETEUR)).rejects.toThrow(
      ErreurDecisionConcurrente,
    );
  });

  it("crochet de test apresReservationAvantCommit appelé APRÈS la réservation réussie", async () => {
    const { client, demandes } = creerClientFactice([demandeInitiale()]);
    const ordre: string[] = [];
    await rejeterDemandeApprobationAtomique(client, DEMANDE_ID, REJETEUR, {
      apresReservationAvantCommit: async () => {
        ordre.push("crochet");
        expect(demandes.get(DEMANDE_ID)!.statut).toBe("REJETEE"); // déjà réservé dans la copie de transaction
      },
    });
    expect(ordre).toEqual(["crochet"]);
  });

  it("le crochet n'est jamais appelé si la réservation échoue", async () => {
    const { client } = creerClientFactice([demandeInitiale({ statut: "APPROUVEE" })]);
    const crochet = vi.fn();
    await expect(
      rejeterDemandeApprobationAtomique(client, DEMANDE_ID, REJETEUR, { apresReservationAvantCommit: crochet }),
    ).rejects.toThrow(ErreurDecisionConcurrente);
    expect(crochet).not.toHaveBeenCalled();
  });
});

describe("enregistrerErreurSiEncoreEnAttente", () => {
  beforeEach(() => vi.clearAllMocks());

  it("demande EN_ATTENTE : le champ erreur est écrit", async () => {
    const { client, demandes } = creerClientFactice([demandeInitiale()]);
    await enregistrerErreurSiEncoreEnAttente(client, DEMANDE_ID, "Rôle introuvable");
    expect(demandes.get(DEMANDE_ID)!.erreur).toBe("Rôle introuvable");
  });

  it("demande déjà REJETEE entre-temps : aucune écriture, jamais de message périmé sur une décision terminale", async () => {
    const { client, demandes } = creerClientFactice([demandeInitiale({ statut: "REJETEE" })]);
    await enregistrerErreurSiEncoreEnAttente(client, DEMANDE_ID, "Rôle introuvable"); // silencieux, ne lève pas
    expect(demandes.get(DEMANDE_ID)!.erreur).toBeNull();
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("REJETEE");
  });

  it("demande déjà APPROUVEE entre-temps : aucune écriture non plus", async () => {
    const { client, demandes } = creerClientFactice([demandeInitiale({ statut: "APPROUVEE" })]);
    await enregistrerErreurSiEncoreEnAttente(client, DEMANDE_ID, "Rôle introuvable");
    expect(demandes.get(DEMANDE_ID)!.erreur).toBeNull();
  });
});
