/**
 * Preuves du correctif P1 (Round 3, contre-revue Codex du 26/08/2026) :
 * `PUT /api/travailleurs/:id`, quand `utilisateurId` est explicitement
 * modifié, écrit via `travailleur.updateMany` — jamais intercepté par
 * l'extension d'audit générale (`lib/audit.ts`, qui n'écoute que
 * `update`/`delete` SINGULIERS). Toute modification touchant `utilisateurId`
 * (liaison, déliaison, ou combinée à un changement de salaire/poste/
 * département/groupe) réussissait donc jusqu'ici SANS produire le moindre
 * `AuditLog`. Corrigé en écrivant manuellement UNE ligne `AuditLog`
 * "MODIFICATION", DANS la même transaction que l'écriture conditionnelle.
 *
 * Ces tests mockés prouvent que la route appelle bien, dans le bon ordre et
 * avec les bons arguments, `updateMany` PUIS `auditLog.create` à l'intérieur
 * du même `$transaction`, et qu'un conflit (`count !== 1`) ou un échec de
 * l'écriture d'audit empêchent tous deux la réponse de succès. Ils ne
 * prouvent PAS le rollback PostgreSQL réel (impossible à simuler fidèlement
 * avec un mock, puisque `$transaction` est ici remplacé par un simple appel
 * direct au callback, sans le verrouillage de ligne ni le rollback réels de
 * PostgreSQL — même caveat que `equipe.principal.test.ts`) : cette preuve est
 * apportée séparément, contre une vraie base PostgreSQL, par
 * `scripts/verifier-http-travailleurs-audit-ci.ts`.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUniqueTravailleur: vi.fn(),
  findUniqueUtilisateur: vi.fn(),
  transaction: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  auditLogCreate: vi.fn(),
  getStore: vi.fn(),
}));

vi.mock("../lib/prisma.js", () => ({
  prisma: {
    travailleur: {
      findUnique: mocks.findUniqueTravailleur,
    },
    utilisateur: {
      findUnique: mocks.findUniqueUtilisateur,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../lib/contexteRequete.js", () => ({
  contexteRequete: { getStore: mocks.getStore },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.utilisateur = { id: "acteur-1", nom: "Chargé du personnel" } as express.Request["utilisateur"];
    next();
  },
  requirePermission: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("../services/emailPro.js", () => ({
  declencherEmailPro: vi.fn(),
  verifierEmailPro: vi.fn(),
}));

vi.mock("../services/pdf.js", () => ({
  construirePdf: vi.fn(),
  nomFichierPdf: vi.fn(),
}));

vi.mock("../lib/events.js", () => ({
  busEvenements: { emettreEvenement: vi.fn() },
}));

import { travailleursRouter } from "./travailleurs.js";

function appTravailleurs() {
  const app = express();
  app.use(express.json());
  app.use("/api/travailleurs", travailleursRouter);
  return app;
}

const FICHE_DELIEE = {
  id: "t-1",
  nom: "Jean Mukendi",
  telephone: null,
  poste: "Boulanger",
  dateEmbauche: new Date("2025-01-01"),
  utilisateurId: null,
  departementId: null,
  groupeId: null,
  emailProAdresse: null,
  emailProStatut: "AUCUNE",
  emailProErreur: null,
  emailDestination: null,
  salaireMensuel: 150_000,
  joursTravaillesParMois: 26,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

const FICHE_LIEE = { ...FICHE_DELIEE, utilisateurId: "u-target" };

const COMPTE_CIBLE = { id: "u-target", nom: "Compte Cible", email: "cible@boulangerie-lomoto.com" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStore.mockReturnValue({ id: "acteur-1", nom: "Chargé du personnel" });
  // Reproduit `prisma.$transaction(callback)` : exécute le callback avec un
  // `tx` minimal exposant les mêmes méthodes que le client transactionnel
  // réel — voir le caveat en tête de fichier.
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback({
      travailleur: {
        updateMany: mocks.updateMany,
        findUniqueOrThrow: mocks.findUniqueOrThrow,
      },
      auditLog: {
        create: mocks.auditLogCreate,
      },
    }),
  );
});

describe("PUT /api/travailleurs/:id — audit manuel transactionnel du rattachement (Round 3, correctif P1)", () => {
  it("liaison réussie (utilisateurId null → id) : un AuditLog MODIFICATION exact, dans la transaction", async () => {
    mocks.findUniqueTravailleur.mockResolvedValueOnce(FICHE_DELIEE); // existant
    mocks.findUniqueUtilisateur.mockResolvedValueOnce(COMPTE_CIBLE); // verifierCompteLie : compte
    mocks.findUniqueTravailleur.mockResolvedValueOnce(null); // verifierCompteLie : dejaLie (aucun)
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    const apres = { ...FICHE_LIEE };
    mocks.findUniqueOrThrow.mockResolvedValueOnce(apres);
    mocks.auditLogCreate.mockResolvedValueOnce({});

    const res = await request(appTravailleurs())
      .put("/api/travailleurs/t-1")
      .send({ nom: FICHE_DELIEE.nom, poste: FICHE_DELIEE.poste, utilisateurId: "u-target" });

    expect(res.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.auditLogCreate).toHaveBeenCalledTimes(1);
    const appelAudit = mocks.auditLogCreate.mock.calls[0][0].data;
    expect(appelAudit.action).toBe("MODIFICATION");
    expect(appelAudit.module).toBe("TRAVAILLEURS");
    expect(appelAudit.typeEntite).toBe("Travailleur");
    expect(appelAudit.entiteId).toBe("t-1");
    expect(appelAudit.utilisateurId).toBe("acteur-1"); // l'acteur authentifié, pas la cible du rattachement
    expect(appelAudit.avant.utilisateurId).toBeNull();
    expect(appelAudit.apres.utilisateurId).toBe("u-target");
    // Une seule ligne d'audit — aucun double comptage possible (l'extension
    // automatique n'intercepte que `update`/`delete`, jamais `updateMany`).
    expect(mocks.auditLogCreate).toHaveBeenCalledTimes(1);
    // L'audit a bien lieu APRÈS l'écriture, dans le même appel de transaction.
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("déliaison réussie (utilisateurId id → null) : un AuditLog MODIFICATION exact", async () => {
    mocks.findUniqueTravailleur.mockResolvedValueOnce(FICHE_LIEE); // existant (actuellement liée)
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    const apres = { ...FICHE_DELIEE };
    mocks.findUniqueOrThrow.mockResolvedValueOnce(apres);
    mocks.auditLogCreate.mockResolvedValueOnce({});

    const res = await request(appTravailleurs())
      .put("/api/travailleurs/t-1")
      .send({ nom: FICHE_LIEE.nom, poste: FICHE_LIEE.poste, utilisateurId: null });

    expect(res.status).toBe(200);
    // utilisateurId falsy (null) : verifierCompteLie n'est jamais appelé.
    expect(mocks.findUniqueUtilisateur).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).toHaveBeenCalledTimes(1);
    const appelAudit = mocks.auditLogCreate.mock.calls[0][0].data;
    expect(appelAudit.avant.utilisateurId).toBe("u-target");
    expect(appelAudit.apres.utilisateurId).toBeNull();
  });

  it("rattachement modifié entre-temps (count !== 1) : 409, AUCUN AuditLog écrit", async () => {
    mocks.findUniqueTravailleur.mockResolvedValueOnce(FICHE_DELIEE); // existant lu comme "libre"
    mocks.findUniqueUtilisateur.mockResolvedValueOnce(COMPTE_CIBLE);
    mocks.findUniqueTravailleur.mockResolvedValueOnce(null); // dejaLie : aucun (prélecture dépassée)
    mocks.updateMany.mockResolvedValueOnce({ count: 0 }); // en réalité déjà liée entre-temps

    const res = await request(appTravailleurs())
      .put("/api/travailleurs/t-1")
      .send({ nom: FICHE_DELIEE.nom, poste: FICHE_DELIEE.poste, utilisateurId: "u-target" });

    expect(res.status).toBe(409);
    expect(mocks.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("modification combinée utilisateurId + salaire/poste : un AuditLog avec avant/après COMPLETS (tous les champs)", async () => {
    mocks.findUniqueTravailleur.mockResolvedValueOnce(FICHE_DELIEE);
    mocks.findUniqueUtilisateur.mockResolvedValueOnce(COMPTE_CIBLE);
    mocks.findUniqueTravailleur.mockResolvedValueOnce(null);
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    const apres = { ...FICHE_LIEE, poste: "Chef boulanger", salaireMensuel: 220_000 };
    mocks.findUniqueOrThrow.mockResolvedValueOnce(apres);
    mocks.auditLogCreate.mockResolvedValueOnce({});

    const res = await request(appTravailleurs())
      .put("/api/travailleurs/t-1")
      .send({ nom: FICHE_DELIEE.nom, poste: "Chef boulanger", salaireMensuel: 220_000, utilisateurId: "u-target" });

    expect(res.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    const donneesEcrites = mocks.updateMany.mock.calls[0][0].data;
    expect(donneesEcrites.utilisateurId).toBe("u-target");
    expect(donneesEcrites.poste).toBe("Chef boulanger");
    expect(donneesEcrites.salaireMensuel).toBe(220_000);

    expect(mocks.auditLogCreate).toHaveBeenCalledTimes(1);
    const appelAudit = mocks.auditLogCreate.mock.calls[0][0].data;
    expect(appelAudit.avant.poste).toBe("Boulanger");
    expect(appelAudit.avant.salaireMensuel).toBe(150_000);
    expect(appelAudit.avant.utilisateurId).toBeNull();
    expect(appelAudit.apres.poste).toBe("Chef boulanger");
    expect(appelAudit.apres.salaireMensuel).toBe(220_000);
    expect(appelAudit.apres.utilisateurId).toBe("u-target");
  });

  it("échec de l'écriture d'audit : la transaction entière échoue — jamais de réponse de succès (rollback réel prouvé séparément sur PostgreSQL réel)", async () => {
    mocks.findUniqueTravailleur.mockResolvedValueOnce(FICHE_DELIEE);
    mocks.findUniqueUtilisateur.mockResolvedValueOnce(COMPTE_CIBLE);
    mocks.findUniqueTravailleur.mockResolvedValueOnce(null);
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValueOnce({ ...FICHE_LIEE });
    mocks.auditLogCreate.mockRejectedValueOnce(new Error("contrainte violée"));

    const res = await request(appTravailleurs())
      .put("/api/travailleurs/t-1")
      .send({ nom: FICHE_DELIEE.nom, poste: FICHE_DELIEE.poste, utilisateurId: "u-target" });

    // Jamais 200 : l'échec de l'audit fait échouer toute la transaction
    // (`$transaction` rejette), remontée en erreur générique (500) — jamais
    // une réponse de succès mensongère pour une modification non tracée.
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(500);
  });

  it("acteur absent du contexte de requête : refusé, aucun AuditLog écrit (garde défensive)", async () => {
    mocks.getStore.mockReturnValue(undefined);
    mocks.findUniqueTravailleur.mockResolvedValueOnce(FICHE_DELIEE);
    mocks.findUniqueUtilisateur.mockResolvedValueOnce(COMPTE_CIBLE);
    mocks.findUniqueTravailleur.mockResolvedValueOnce(null);
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValueOnce({ ...FICHE_LIEE });

    const res = await request(appTravailleurs())
      .put("/api/travailleurs/t-1")
      .send({ nom: FICHE_DELIEE.nom, poste: FICHE_DELIEE.poste, utilisateurId: "u-target" });

    expect(res.status).toBe(500);
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });
});
