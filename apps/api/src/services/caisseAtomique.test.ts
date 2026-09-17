/**
 * Preuves mockées (P1-B, 28/08/2026) du mécanisme commun d'atomicité de la
 * caisse : verrou de session (mocké — un vrai SELECT ... FOR UPDATE ne peut
 * être prouvé que contre PostgreSQL réel, voir
 * scripts/verifier-concurrence-caisse-ci.ts), audit transactionnel manuel,
 * réessai borné P2034.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { contexteRequete } from "../lib/contexteRequete.js";
import { ErreurAction } from "../lib/erreurAction.js";
import {
  auditerCaisseTx,
  ErreurActeurRequisPourAuditCaisse,
  ErreurEcritureCaisseReessayable,
  executerAvecReessaiP2034,
  verrouillerSessionFermeeParId,
  verrouillerSessionOuverte,
  verrouillerSessionOuverteParId,
} from "./caisseAtomique.js";

const ACTEUR = { id: "u-1", nom: "Alice" };

interface SessionState {
  id: string;
  date: Date;
  statut: "OUVERTE" | "FERMEE";
  soldeOuverture: number;
  updatedAt: Date;
}

function creerTxFactice(sessions: SessionState[]) {
  const auditLogs: unknown[] = [];
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...valeurs: unknown[]) => {
      // Émule `SELECT id FROM "SessionCaisse" WHERE date = $1 FOR UPDATE`.
      const date = valeurs[0] as Date;
      const trouvee = sessions.find((s) => s.date.getTime() === date.getTime());
      return trouvee ? [{ id: trouvee.id }] : [];
    }),
    sessionCaisse: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string }; select?: unknown }) => {
        return sessions.find((s) => s.id === where.id) ?? null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const trouvee = sessions.find((s) => s.id === where.id);
        if (!trouvee) throw new Error("introuvable");
        return trouvee;
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        auditLogs.push(data);
        return data;
      }),
    },
  };
  return { tx: tx as never, auditLogs };
}

describe("verrouillerSessionOuverte", () => {
  it("lève ErreurAction(409) quand aucune session n'existe pour la date", async () => {
    const { tx } = creerTxFactice([]);
    await expect(verrouillerSessionOuverte(tx, "2026-08-28")).rejects.toMatchObject({ status: 409 });
  });

  it("lève ErreurAction(409) quand la session existe mais est FERMEE", async () => {
    const { tx } = creerTxFactice([
      { id: "s-1", date: new Date("2026-08-28T00:00:00.000Z"), statut: "FERMEE", soldeOuverture: 0, updatedAt: new Date() },
    ]);
    await expect(verrouillerSessionOuverte(tx, "2026-08-28")).rejects.toMatchObject({ status: 409 });
  });

  it("renvoie la session verrouillée quand elle est OUVERTE", async () => {
    const { tx } = creerTxFactice([
      { id: "s-1", date: new Date("2026-08-28T00:00:00.000Z"), statut: "OUVERTE", soldeOuverture: 5000, updatedAt: new Date() },
    ]);
    const session = await verrouillerSessionOuverte(tx, "2026-08-28");
    expect(session.id).toBe("s-1");
    expect(session.soldeOuverture).toBe(5000);
  });
});

describe("verrouillerSessionOuverteParId", () => {
  it("lève 404 si l'id ne correspond à aucune session", async () => {
    const { tx } = creerTxFactice([]);
    await expect(verrouillerSessionOuverteParId(tx, "absent")).rejects.toMatchObject({ status: 404 });
  });

  it("renvoie la session quand l'id correspond et qu'elle est OUVERTE", async () => {
    const { tx } = creerTxFactice([
      { id: "s-1", date: new Date("2026-08-28T00:00:00.000Z"), statut: "OUVERTE", soldeOuverture: 0, updatedAt: new Date() },
    ]);
    const session = await verrouillerSessionOuverteParId(tx, "s-1");
    expect(session.id).toBe("s-1");
  });
});

describe("verrouillerSessionFermeeParId", () => {
  it("lève 404 si l'id ne correspond à aucune session", async () => {
    const { tx } = creerTxFactice([]);
    await expect(verrouillerSessionFermeeParId(tx, "absent")).rejects.toMatchObject({ status: 404 });
  });

  it("lève 409 si la session est encore OUVERTE", async () => {
    const { tx } = creerTxFactice([
      { id: "s-1", date: new Date("2026-08-28T00:00:00.000Z"), statut: "OUVERTE", soldeOuverture: 0, updatedAt: new Date() },
    ]);
    await expect(verrouillerSessionFermeeParId(tx, "s-1")).rejects.toMatchObject({ status: 409 });
  });

  it("renvoie la session quand elle est FERMEE", async () => {
    const { tx } = creerTxFactice([
      { id: "s-1", date: new Date("2026-08-28T00:00:00.000Z"), statut: "FERMEE", soldeOuverture: 0, updatedAt: new Date() },
    ]);
    const session = await verrouillerSessionFermeeParId(tx, "s-1");
    expect(session.statut).toBe("FERMEE");
  });
});

describe("auditerCaisseTx", () => {
  it("lève ErreurActeurRequisPourAuditCaisse hors contexte de requête authentifiée", async () => {
    const { tx } = creerTxFactice([]);
    await expect(
      auditerCaisseTx(tx, { module: "CAISSE", typeEntite: "TauxDuJour", entiteId: "t-1", action: "MODIFICATION", avant: {}, apres: {} }),
    ).rejects.toBeInstanceOf(ErreurActeurRequisPourAuditCaisse);
  });

  it("écrit exactement un AuditLog avec l'acteur du contexte, avant/après normalisés", async () => {
    const { tx, auditLogs } = creerTxFactice([]);
    await contexteRequete.run(ACTEUR, () =>
      auditerCaisseTx(tx, {
        module: "CAISSE",
        typeEntite: "TauxDuJour",
        entiteId: "t-1",
        action: "MODIFICATION",
        avant: { id: "t-1", valeur: 100 },
        apres: { id: "t-1", valeur: 120 },
      }),
    );
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      utilisateurId: "u-1",
      utilisateurNom: "Alice",
      module: "CAISSE",
      typeEntite: "TauxDuJour",
      entiteId: "t-1",
      action: "MODIFICATION",
    });
  });

  it("expurge les champs sensibles des instantanés avant/après", async () => {
    const { tx, auditLogs } = creerTxFactice([]);
    await contexteRequete.run(ACTEUR, () =>
      auditerCaisseTx(tx, {
        module: "CAISSE",
        typeEntite: "TauxDuJour",
        entiteId: "t-1",
        action: "MODIFICATION",
        avant: { id: "t-1", motDePasseHash: "secret-hash" },
        apres: { id: "t-1", motDePasseHash: "autre-secret" },
      }),
    );
    const donnees = auditLogs[0] as { avant: Record<string, unknown>; apres: Record<string, unknown> };
    expect(donnees.avant).not.toHaveProperty("motDePasseHash");
    expect(donnees.apres).not.toHaveProperty("motDePasseHash");
  });
});

describe("executerAvecReessaiP2034", () => {
  beforeEach(() => vi.clearAllMocks());

  function erreurP2034() {
    return new Prisma.PrismaClientKnownRequestError("conflit de sérialisation", {
      code: "P2034",
      clientVersion: "test",
    });
  }

  // Forme RÉELLEMENT observée contre PostgreSQL (voir
  // scripts/verifier-concurrence-caisse-ci.ts) : un conflit de sérialisation
  // (SQLSTATE 40001) survenant DANS un `$queryRaw` (notre `SELECT ... FOR
  // UPDATE` de verrouillage) remonte en `P2010` générique, jamais `P2034` —
  // le vrai code PostgreSQL est niché dans `meta.code`.
  function erreurSerialisationRawQuery() {
    return new Prisma.PrismaClientKnownRequestError("Raw query failed. Code: `40001`.", {
      code: "P2010",
      clientVersion: "test",
      meta: { code: "40001", message: "could not serialize access due to concurrent update" },
    });
  }

  it("réussit du premier coup sans réessai", async () => {
    const operation = vi.fn().mockResolvedValue("ok");
    await expect(executerAvecReessaiP2034(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("réessaie sur P2034 puis réussit, avec une NOUVELLE tentative à chaque fois", async () => {
    const operation = vi.fn().mockRejectedValueOnce(erreurP2034()).mockResolvedValueOnce("ok-au-2e-essai");
    await expect(executerAvecReessaiP2034(operation)).resolves.toBe("ok-au-2e-essai");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("réessaie aussi sur un conflit de sérialisation survenu dans un $queryRaw (P2010 + meta.code 40001, pas P2034)", async () => {
    // Régression : reproduit exactement la forme d'erreur observée en
    // exécutant réellement scripts/verifier-concurrence-caisse-ci.ts contre
    // PostgreSQL — le SELECT ... FOR UPDATE de verrouillage, en cas de
    // conflit réel, ne remonte PAS en P2034.
    const operation = vi.fn().mockRejectedValueOnce(erreurSerialisationRawQuery()).mockResolvedValueOnce("ok-au-2e-essai");
    await expect(executerAvecReessaiP2034(operation)).resolves.toBe("ok-au-2e-essai");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("épuise les 3 tentatives puis lève ErreurEcritureCaisseReessayable (jamais un P2034 brut)", async () => {
    const operation = vi.fn().mockRejectedValue(erreurP2034());
    await expect(executerAvecReessaiP2034(operation)).rejects.toBeInstanceOf(ErreurEcritureCaisseReessayable);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("propage une ErreurAction immédiatement, sans réessayer (rejet métier honnête, pas un conflit)", async () => {
    const operation = vi.fn().mockRejectedValue(new ErreurAction(409, "conflit métier"));
    await expect(executerAvecReessaiP2034(operation)).rejects.toMatchObject({ status: 409 });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("propage toute autre erreur immédiatement, sans réessayer", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("panne inattendue"));
    await expect(executerAvecReessaiP2034(operation)).rejects.toThrow("panne inattendue");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
