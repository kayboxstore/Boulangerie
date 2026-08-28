/**
 * Preuves mockées (P1-A, 28/08/2026) du secret de bootstrap du premier
 * lancement — couvre les 5 scénarios demandés par Augustin : absence de
 * secret, mauvais secret, expiration, rejeu (secret déjà consommé), et
 * course entre deux finalisations concurrentes.
 *
 * Ces tests MOCKENT Prisma : un client factice en mémoire, même convention
 * que `actionsCritiquesMetier.test.ts`/`permissionsRoleAudit.test.ts` —
 * `$transaction` clone l'état avant d'exécuter le callback et ne le committe
 * QUE si le callback réussit. Ces fonctions prennent leur client Prisma en
 * paramètre (même convention que `actionsCritiquesMetier.ts`), pas besoin de
 * mocker `lib/prisma.js`. La preuve AUTORITAIRE de la vraie concurrence
 * PostgreSQL (deux finalisations réellement simultanées, `pg_blocking_pids`,
 * rollback réel) est apportée séparément par
 * `scripts/verifier-concurrence-premier-lancement-ci.ts`.
 */
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { ErreurAction } from "../lib/erreurAction.js";
import {
  ErreurFinalisationReessayable,
  finaliserPremierLancementDirect,
  genererSecretPremierLancement,
  secretPremierLancementValide,
} from "./premierLancement.js";

interface SecretState {
  id: string;
  secretHash: string;
  expiresAt: Date;
  consommeLe: Date | null;
}
interface UtilisateurState {
  id: string;
  nom: string;
  email: string;
  roleId: string;
  estAdminPrincipal: boolean;
}
interface TravailleurState {
  id: string;
  nom: string;
  utilisateurId: string | null;
  emailProStatut: "AUCUNE" | "EN_ATTENTE_VERIFICATION" | "ACTIF" | "ECHEC";
  emailProAdresse: string | null;
}
interface RoleState {
  id: string;
  nom: string;
}

class ErreurP2034Factice extends Prisma.PrismaClientKnownRequestError {
  constructor() {
    super("Transaction failed due to a write conflict or a deadlock", { code: "P2034", clientVersion: "test" });
  }
}

const SECRET_CLAIR = "secret-de-test-abc123";
const AUTRE_SECRET_CLAIR = "un-autre-secret-xyz789";

// Doit être STRICTEMENT identique à `hacherSecret` (premierLancement.ts, non
// exporté) pour que le client factice retrouve les mêmes lignes — sinon ce
// test dépendrait d'une coïncidence plutôt que d'une preuve.
function hacherPourTest(secretClair: string): string {
  return crypto.createHash("sha256").update(secretClair, "utf8").digest("hex");
}

function creerClientFactice(seed: {
  secrets?: SecretState[];
  utilisateurs?: UtilisateurState[];
  travailleurs?: TravailleurState[];
  roles?: RoleState[];
  forcerP2034Toujours?: boolean;
}) {
  const etat = {
    secrets: new Map((seed.secrets ?? []).map((s) => [s.id, { ...s }])),
    utilisateurs: new Map((seed.utilisateurs ?? []).map((u) => [u.id, { ...u }])),
    travailleurs: new Map((seed.travailleurs ?? []).map((t) => [t.id, { ...t }])),
    roles: new Map((seed.roles ?? [{ id: "role-admin", nom: "Administrateur" }]).map((r) => [r.id, { ...r }])),
  };
  let compteurId = 0;

  function construireClient(cible: typeof etat) {
    return {
      secretPremierLancement: {
        findUnique: async ({ where }: { where: { secretHash: string } }) => {
          for (const s of cible.secrets.values()) if (s.secretHash === where.secretHash) return { ...s };
          return null;
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { secretHash: string; consommeLe: null; expiresAt: { gt: Date } };
          data: { consommeLe: Date };
        }) => {
          let count = 0;
          for (const s of cible.secrets.values()) {
            if (s.secretHash === where.secretHash && s.consommeLe === null && s.expiresAt > where.expiresAt.gt) {
              s.consommeLe = data.consommeLe;
              count++;
            }
          }
          return { count };
        },
        create: async ({ data }: { data: { secretHash: string; expiresAt: Date } }) => {
          const id = `secret-${++compteurId}`;
          const enregistrement: SecretState = { id, secretHash: data.secretHash, expiresAt: data.expiresAt, consommeLe: null };
          cible.secrets.set(id, enregistrement);
          return { ...enregistrement };
        },
      },
      utilisateur: {
        count: async () => cible.utilisateurs.size,
        create: async ({ data }: { data: Omit<UtilisateurState, "id"> }) => {
          const id = `u-${++compteurId}`;
          const compte: UtilisateurState = { id, ...data };
          cible.utilisateurs.set(id, compte);
          return { ...compte };
        },
      },
      travailleur: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const t = cible.travailleurs.get(where.id);
          return t ? { ...t } : null;
        },
        update: async ({ where, data }: { where: { id: string }; data: Partial<TravailleurState> }) => {
          const t = cible.travailleurs.get(where.id);
          if (!t) throw new Error("travailleur introuvable (factice)");
          Object.assign(t, data);
          return { ...t };
        },
      },
      role: {
        findUnique: async ({ where }: { where: { nom: string } }) => {
          for (const r of cible.roles.values()) if (r.nom === where.nom) return { ...r };
          return null;
        },
      },
    };
  }

  const clientRacine = construireClient(etat);

  return {
    ...clientRacine,
    $transaction: async (callback: (tx: ReturnType<typeof construireClient>) => Promise<unknown>) => {
      if (seed.forcerP2034Toujours) throw new ErreurP2034Factice();
      // Clone profond : la transaction ne doit modifier RIEN de l'état réel
      // tant qu'elle n'a pas réussi — même garantie qu'un vrai ROLLBACK.
      const clone = {
        secrets: new Map([...etat.secrets].map(([k, v]) => [k, { ...v }])),
        utilisateurs: new Map([...etat.utilisateurs].map(([k, v]) => [k, { ...v }])),
        travailleurs: new Map([...etat.travailleurs].map(([k, v]) => [k, { ...v }])),
        roles: new Map([...etat.roles].map(([k, v]) => [k, { ...v }])),
      };
      const txClient = construireClient(clone);
      const resultat = await callback(txClient);
      etat.secrets = clone.secrets;
      etat.utilisateurs = clone.utilisateurs;
      etat.travailleurs = clone.travailleurs;
      etat.roles = clone.roles;
      return resultat;
    },
    _etat: etat,
  };
}

const TRAVAILLEUR_PRET: TravailleurState = {
  id: "t-1",
  nom: "Aline",
  utilisateurId: null,
  emailProStatut: "ACTIF",
  emailProAdresse: "aline@lomoto.test",
};

function secretValideDansUneHeure(secretHash: string): SecretState {
  return { id: "s-1", secretHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000), consommeLe: null };
}

describe("premierLancement — secret de bootstrap", () => {
  it("secretPremierLancementValide : true pour un secret valide, non expiré, non consommé", async () => {
    const client = creerClientFactice({ secrets: [secretValideDansUneHeure(hacherPourTest(SECRET_CLAIR))] });
    expect(await secretPremierLancementValide(client as never, SECRET_CLAIR)).toBe(true);
  });

  it("secretPremierLancementValide : false si aucun secret fourni", async () => {
    const client = creerClientFactice({});
    expect(await secretPremierLancementValide(client as never, undefined)).toBe(false);
  });

  it("Scénario 1 — absence de secret : finaliser rejette (401) avant toute écriture", async () => {
    const client = creerClientFactice({ travailleurs: [TRAVAILLEUR_PRET] });
    await expect(
      finaliserPremierLancementDirect(client as never, { secretFourni: undefined, travailleurId: "t-1", motDePasse: "motdepasse123" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(client._etat.utilisateurs.size).toBe(0);
  });

  it("Scénario 2 — mauvais secret : finaliser rejette (401), aucun compte créé, le vrai secret reste utilisable", async () => {
    const client = creerClientFactice({
      secrets: [secretValideDansUneHeure(hacherPourTest(SECRET_CLAIR))],
      travailleurs: [TRAVAILLEUR_PRET],
    });
    await expect(
      finaliserPremierLancementDirect(client as never, {
        secretFourni: AUTRE_SECRET_CLAIR,
        travailleurId: "t-1",
        motDePasse: "motdepasse123",
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(client._etat.utilisateurs.size).toBe(0);
    expect(client._etat.secrets.get("s-1")?.consommeLe).toBeNull();
  });

  it("Scénario 3 — secret expiré : finaliser rejette (401) même avec le bon secret", async () => {
    const secretExpire: SecretState = {
      id: "s-1",
      secretHash: hacherPourTest(SECRET_CLAIR),
      expiresAt: new Date(Date.now() - 1000),
      consommeLe: null,
    };
    const client = creerClientFactice({ secrets: [secretExpire], travailleurs: [TRAVAILLEUR_PRET] });
    await expect(
      finaliserPremierLancementDirect(client as never, { secretFourni: SECRET_CLAIR, travailleurId: "t-1", motDePasse: "motdepasse123" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(client._etat.utilisateurs.size).toBe(0);
  });

  it("Scénario 4 — rejeu : un secret déjà consommé ne peut plus servir, même non expiré", async () => {
    const secretDejaConsomme: SecretState = {
      id: "s-1",
      secretHash: hacherPourTest(SECRET_CLAIR),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      consommeLe: new Date(Date.now() - 1000),
    };
    const client = creerClientFactice({ secrets: [secretDejaConsomme], travailleurs: [TRAVAILLEUR_PRET] });
    await expect(
      finaliserPremierLancementDirect(client as never, { secretFourni: SECRET_CLAIR, travailleurId: "t-1", motDePasse: "motdepasse123" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(client._etat.utilisateurs.size).toBe(0);
  });

  it("secret valide + fiche prête : finalise avec succès, consomme le secret, un seul compte Admin Principal", async () => {
    const client = creerClientFactice({
      secrets: [secretValideDansUneHeure(hacherPourTest(SECRET_CLAIR))],
      travailleurs: [TRAVAILLEUR_PRET],
    });
    await finaliserPremierLancementDirect(client as never, { secretFourni: SECRET_CLAIR, travailleurId: "t-1", motDePasse: "motdepasse123" });

    expect(client._etat.utilisateurs.size).toBe(1);
    const compte = [...client._etat.utilisateurs.values()][0];
    expect(compte.estAdminPrincipal).toBe(true);
    expect(compte.email).toBe("aline@lomoto.test");
    expect(client._etat.travailleurs.get("t-1")?.utilisateurId).toBe(compte.id);
    expect(client._etat.secrets.get("s-1")?.consommeLe).not.toBeNull();

    // Rejeu immédiat du même secret, une fois consommé : refusé.
    await expect(
      finaliserPremierLancementDirect(client as never, { secretFourni: SECRET_CLAIR, travailleurId: "t-1", motDePasse: "autremotdepasse" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(client._etat.utilisateurs.size).toBe(1);
  });

  it("Scénario 5 — course entre deux finalisations (base déjà non vide au moment de la relecture DANS la transaction) : rejet propre (409), un seul compte, secret non consommé pour rien", async () => {
    // Simule ce qu'une VRAIE transaction Serializable détecterait : au
    // moment où la 2e finalisation relit `utilisateur.count()` dans SA
    // transaction, un compte existe déjà (créé par la 1re, gagnante).
    const client = creerClientFactice({
      secrets: [secretValideDansUneHeure(hacherPourTest(SECRET_CLAIR))],
      travailleurs: [TRAVAILLEUR_PRET, { ...TRAVAILLEUR_PRET, id: "t-2", emailProAdresse: "autre@lomoto.test" }],
      utilisateurs: [{ id: "u-existant", nom: "Déjà admin", email: "deja@lomoto.test", roleId: "role-admin", estAdminPrincipal: true }],
    });
    await expect(
      finaliserPremierLancementDirect(client as never, { secretFourni: SECRET_CLAIR, travailleurId: "t-2", motDePasse: "motdepasse123" }),
    ).rejects.toMatchObject({ status: 409 });
    expect(client._etat.utilisateurs.size).toBe(1);
    // Le rollback annule aussi la réservation du secret faite DANS cette
    // transaction : elle n'a jamais été committée, le secret reste utilisable.
    expect(client._etat.secrets.get("s-1")?.consommeLe).toBeNull();
  });

  it("rôle Administrateur introuvable : rejet 500 explicite, aucun compte créé, secret non consommé", async () => {
    const client = creerClientFactice({
      secrets: [secretValideDansUneHeure(hacherPourTest(SECRET_CLAIR))],
      travailleurs: [TRAVAILLEUR_PRET],
      roles: [],
    });
    await expect(
      finaliserPremierLancementDirect(client as never, { secretFourni: SECRET_CLAIR, travailleurId: "t-1", motDePasse: "motdepasse123" }),
    ).rejects.toMatchObject({ status: 500 });
    expect(client._etat.utilisateurs.size).toBe(0);
    expect(client._etat.secrets.get("s-1")?.consommeLe).toBeNull();
  });

  it("P2034 épuisé après réessais : erreur réessayable honnête, pas un plantage brut", async () => {
    const client = creerClientFactice({
      secrets: [secretValideDansUneHeure(hacherPourTest(SECRET_CLAIR))],
      travailleurs: [TRAVAILLEUR_PRET],
      forcerP2034Toujours: true,
    });
    await expect(
      finaliserPremierLancementDirect(client as never, { secretFourni: SECRET_CLAIR, travailleurId: "t-1", motDePasse: "motdepasse123" }),
    ).rejects.toBeInstanceOf(ErreurFinalisationReessayable);
  });

  it("genererSecretPremierLancement : insère l'empreinte, jamais le secret en clair", async () => {
    const client = creerClientFactice({});
    await genererSecretPremierLancement(client as never, 60 * 60 * 1000);
    expect(client._etat.secrets.size).toBe(1);
    const enregistrement = [...client._etat.secrets.values()][0];
    expect(enregistrement.secretHash).toHaveLength(64); // hex SHA-256
    expect(JSON.stringify(enregistrement)).not.toContain("secretClair");
  });

  it("ErreurAction (réutilisée, pas redéfinie localement) porte bien status + message", () => {
    const e = new ErreurAction(401, "test");
    expect(e.status).toBe(401);
    expect(e.message).toBe("test");
  });
});
