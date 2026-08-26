/**
 * Preuves de l'atomicité réservation+exécution+transition pour les 4 types
 * d'action critique SUPPRIMER_UTILISATEUR / CREER_COMPTE_ADMIN /
 * MODIFIER_TYPE_CLIENT / MODIFIER_TAUX_TAXE (`approuverEtExecuterActionCritique`).
 *
 * Défaut corrigé : jusqu'ici, le parcours d'approbation de ces 4 types
 * exécutait l'action métier PUIS, séparément, tentait de faire passer la
 * `DemandeApprobation` à APPROUVEE — deux écritures non transactionnelles.
 * Un rejet concurrent pouvait gagner la seconde APRÈS que la première ait
 * réellement eu lieu (ex. compte supprimé, mais demande affichée REJETEE).
 * Corrigé en réservant la demande AVANT de tenter l'action, LE TOUT dans une
 * seule transaction Serializable — si la réservation échoue, l'action n'est
 * JAMAIS tentée ; si l'action échoue, la réservation est annulée avec elle.
 *
 * Client Prisma factice en mémoire — `$transaction` copie l'état avant
 * d'exécuter le callback et ne le committe qu'au succès (même convention que
 * `permissionsRoleAudit.test.ts`) : preuve LOGIQUE du tout-ou-rien. La preuve
 * AUTORITAIRE de la VRAIE concurrence PostgreSQL (verrouillage de ligne,
 * deux connexions séparées) est apportée par
 * `scripts/verifier-atomicite-approbation-actions-critiques-ci.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { ErreurAction } from "../lib/erreurAction.js";
import { ErreurConflitDecisionReessayable, ErreurDecisionConcurrente } from "./demandeApprobation.js";
import { approuverEtExecuterActionCritique, executerActionTx } from "./actionsCritiques.js";

interface UtilisateurState {
  id: string;
  nom: string;
  email: string;
  estAdminPrincipal: boolean;
  roleNom: string;
}
interface DemandeState {
  id: string;
  type: string;
  donnees: unknown;
  statut: "EN_ATTENTE" | "APPROUVEE" | "REJETEE";
  approuveParId: string | null;
  dateDecision: Date | null;
  erreur: string | null;
}

/**
 * `$transaction` copie l'état avant d'exécuter le callback et ne le committe
 * qu'au succès — jamais touché s'il lève (même convention que
 * `permissionsRoleAudit.test.ts`).
 */
function creerClientFactice(
  utilisateursInitiaux: UtilisateurState[] = [],
  demandesInitiales: DemandeState[] = [],
) {
  const etat = {
    utilisateurs: new Map(utilisateursInitiaux.map((u) => [u.id, { ...u }])),
    demandes: new Map(demandesInitiales.map((d) => [d.id, { ...d }])),
  };
  let echecSuppressionP2003 = false;
  // Simule un conflit de sérialisation PostgreSQL (P2034) survenant PENDANT
  // la transaction (pas seulement sur la réservation) — `restants` tentatives
  // échouent avant que la transaction suivante réussisse.
  const p2034 = { restants: 0 };

  function construireDelegues(utilisateurs: Map<string, UtilisateurState>, demandes: Map<string, DemandeState>) {
    return {
      utilisateur: {
        findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) => {
          if (where.id) return utilisateurs.get(where.id) ?? null;
          return [...utilisateurs.values()].find((u) => u.email === where.email) ?? null;
        }),
        count: vi.fn(async () => [...utilisateurs.values()].filter((u) => u.roleNom === "Administrateur").length),
        create: vi.fn(async ({ data }: { data: { nom: string; email: string; roleId: string } }) => {
          const u: UtilisateurState = {
            id: `u-${utilisateurs.size + 1}`,
            nom: data.nom,
            email: data.email,
            estAdminPrincipal: false,
            roleNom: "Administrateur",
          };
          utilisateurs.set(u.id, u);
          return u;
        }),
        delete: vi.fn(async ({ where: { id } }: { where: { id: string } }) => {
          if (p2034.restants > 0) {
            p2034.restants--;
            throw new Prisma.PrismaClientKnownRequestError("conflit de sérialisation simulé", {
              code: "P2034",
              clientVersion: "test",
            });
          }
          if (echecSuppressionP2003) {
            throw new Prisma.PrismaClientKnownRequestError("contrainte de clé étrangère simulée", {
              code: "P2003",
              clientVersion: "test",
            });
          }
          const u = utilisateurs.get(id);
          utilisateurs.delete(id);
          return u;
        }),
      },
      travailleur: { update: vi.fn(async () => ({})) },
      typeClient: {
        findUnique: vi.fn(async () => null),
        update: vi.fn(async () => ({ nom: "n/a" })),
      },
      produit: {
        findUnique: vi.fn(async () => null),
        update: vi.fn(async () => ({ nom: "n/a", tauxTaxe: 0 })),
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
          if (!d) throw new Error(`introuvable : ${id}`);
          return d;
        }),
        findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) => demandes.get(id) ?? null),
      },
    };
  }

  const client = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const copieUtilisateurs = new Map([...etat.utilisateurs].map(([k, v]) => [k, { ...v }]));
      const copieDemandes = new Map([...etat.demandes].map(([k, v]) => [k, { ...v }]));
      const resultat = await fn(construireDelegues(copieUtilisateurs, copieDemandes));
      // Committe en MUTANT les Map d'origine (jamais en réaffectant `etat.*`) :
      // les tests destructurent `utilisateurs`/`demandes` une seule fois à la
      // création du client factice — une réaffectation de `etat.*` laisserait
      // cette référence pointer vers l'ancienne Map, jamais mise à jour.
      etat.utilisateurs.clear();
      for (const [id, u] of copieUtilisateurs) etat.utilisateurs.set(id, u);
      etat.demandes.clear();
      for (const [id, d] of copieDemandes) etat.demandes.set(id, d);
      return resultat;
    }),
    demandeApprobation: {
      findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) => {
        const d = etat.demandes.get(id);
        return d ? { statut: d.statut } : null;
      }),
    },
  };

  return {
    client: client as unknown as Parameters<typeof approuverEtExecuterActionCritique>[0],
    utilisateurs: etat.utilisateurs,
    demandes: etat.demandes,
    forcerEchecSuppressionP2003: () => {
      echecSuppressionP2003 = true;
    },
    forcerP2034: (fois: number) => {
      p2034.restants = fois;
    },
  };
}

const DEMANDE_ID = "demande-1";
const PRINCIPAL = { id: "u-principal", nom: "Aline (Admin Principal)" };
const CIBLE: UtilisateurState = {
  id: "u-cible",
  nom: "Compte à supprimer",
  email: "cible@test.local",
  estAdminPrincipal: false,
  roleNom: "Caissier(ère)",
};

function demandeSuppression(overrides: Partial<DemandeState> = {}): DemandeState {
  return {
    id: DEMANDE_ID,
    type: "SUPPRIMER_UTILISATEUR",
    donnees: { utilisateurId: CIBLE.id },
    statut: "EN_ATTENTE",
    approuveParId: null,
    dateDecision: null,
    erreur: null,
    ...overrides,
  };
}

describe("approuverEtExecuterActionCritique — SUPPRIMER_UTILISATEUR", () => {
  beforeEach(() => vi.clearAllMocks());

  it("réservation + exécution réussies : compte supprimé ET demande APPROUVEE, dans la même transaction", async () => {
    const { client, utilisateurs, demandes } = creerClientFactice([CIBLE], [demandeSuppression()]);
    const resultat = await approuverEtExecuterActionCritique(client, DEMANDE_ID, PRINCIPAL);
    expect(resultat.message).toMatch(/supprimé/);
    expect(utilisateurs.has(CIBLE.id)).toBe(false);
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("APPROUVEE");
    expect(demandes.get(DEMANDE_ID)!.approuveParId).toBe(PRINCIPAL.id);
  });

  it("demande déjà décidée (réservation perdue) : ErreurDecisionConcurrente, le compte cible n'est JAMAIS touché", async () => {
    const { client, utilisateurs, demandes } = creerClientFactice(
      [CIBLE],
      [demandeSuppression({ statut: "REJETEE" })],
    );
    await expect(approuverEtExecuterActionCritique(client, DEMANDE_ID, PRINCIPAL)).rejects.toThrow(
      ErreurDecisionConcurrente,
    );
    // Preuve du défaut corrigé : contrairement à l'ancien chemin, l'action
    // métier n'est même pas TENTÉE quand la réservation échoue.
    expect(utilisateurs.has(CIBLE.id)).toBe(true);
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("REJETEE");
  });

  it("échec de l'action métier (404 compte introuvable) : la RÉSERVATION est annulée avec elle — demande redevient EN_ATTENTE", async () => {
    const { client, demandes } = creerClientFactice([], [demandeSuppression()]);
    await expect(approuverEtExecuterActionCritique(client, DEMANDE_ID, PRINCIPAL)).rejects.toThrow(ErreurAction);
    // Preuve du défaut corrigé : la réservation (qui a réussi en premier,
    // avant que l'action échoue) est bien annulée par le rollback de TOUTE la
    // transaction — jamais une demande orpheline en APPROUVEE sans exécution.
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("EN_ATTENTE");
    expect(demandes.get(DEMANDE_ID)!.approuveParId).toBeNull();
  });

  it("échec métier (contrainte FK, P2003) traduit en ErreurAction 409, réservation également annulée", async () => {
    const { client, demandes, forcerEchecSuppressionP2003 } = creerClientFactice([CIBLE], [demandeSuppression()]);
    forcerEchecSuppressionP2003();
    await expect(approuverEtExecuterActionCritique(client, DEMANDE_ID, PRINCIPAL)).rejects.toThrow(ErreurAction);
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("EN_ATTENTE");
  });

  it("P2034 transitoire (2 échecs) : réessayé automatiquement, finit par réussir au 3ᵉ essai", async () => {
    const { client, utilisateurs, demandes, forcerP2034 } = creerClientFactice([CIBLE], [demandeSuppression()]);
    forcerP2034(2);
    const resultat = await approuverEtExecuterActionCritique(client, DEMANDE_ID, PRINCIPAL);
    expect(resultat.message).toMatch(/supprimé/);
    expect(utilisateurs.has(CIBLE.id)).toBe(false);
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("APPROUVEE");
    expect(client.$transaction).toHaveBeenCalledTimes(3);
  });

  it("P2034 persistant (tentatives épuisées), demande toujours EN_ATTENTE : ErreurConflitDecisionReessayable (jamais « déjà traitée »)", async () => {
    const { client, forcerP2034 } = creerClientFactice([CIBLE], [demandeSuppression()]);
    forcerP2034(10); // plus que NB_TENTATIVES_MAX_P2034
    await expect(approuverEtExecuterActionCritique(client, DEMANDE_ID, PRINCIPAL)).rejects.toThrow(
      ErreurConflitDecisionReessayable,
    );
  });

  it("cible Administrateur principal : refusée (409), réservation annulée", async () => {
    const { client, demandes } = creerClientFactice(
      [{ ...CIBLE, estAdminPrincipal: true }],
      [demandeSuppression()],
    );
    await expect(approuverEtExecuterActionCritique(client, DEMANDE_ID, PRINCIPAL)).rejects.toThrow(
      /Administrateur principal/,
    );
    expect(demandes.get(DEMANDE_ID)!.statut).toBe("EN_ATTENTE");
  });
});

describe("executerActionTx — dispatch tx-aware", () => {
  it("route chaque type vers son exécuteur (MODIFIER_TAUX_TAXE renvoyé tel quel s'il n'existe pas)", async () => {
    const { client } = creerClientFactice([CIBLE], []);
    await expect(
      client.$transaction((tx) => executerActionTx(tx, "MODIFIER_TAUX_TAXE", { produitId: "inconnu", data: {} })),
    ).rejects.toThrow(/introuvable/i);
  });
});
