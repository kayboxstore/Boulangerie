/**
 * Preuves unitaires du mouvement de stock transactionnel.
 *
 * Le rollback PostgreSQL réel après une première matière modifiée est couvert
 * par scripts/verifier-production-ci.ts ; ici on verrouille le câblage précis
 * verrou → mouvement → updateMany → relecture → AuditLog.
 */
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { contexteRequete } from "../lib/contexteRequete.js";
import { appliquerMouvement, ErreurStock } from "./stocks.js";

const date = new Date("2026-08-31T08:00:00.000Z");

function matiere(stock: number) {
  return {
    id: "farine-1",
    nom: "Farine",
    code: "FARINE" as const,
    unite: "sac",
    quantiteStock: new Prisma.Decimal(stock),
    seuilAlerte: new Prisma.Decimal(5),
    alerteSeuilEnvoyeeLe: null,
    createdAt: date,
    updatedAt: date,
  };
}

function fauxTx(avant = matiere(10), apres = matiere(8)) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: avant.id }]),
    matierePremiere: {
      findUniqueOrThrow: vi.fn().mockResolvedValueOnce(avant).mockResolvedValueOnce(apres),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    mouvementStock: {
      create: vi.fn().mockResolvedValue({ id: "mouvement-1" }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: "audit-1" }),
    },
  };
}

const executer = <T>(operation: () => Promise<T>) =>
  contexteRequete.run({ id: "utilisateur-1", nom: "Responsable Stock" }, operation);

describe("appliquerMouvement — verrou et audit transactionnel", () => {
  it("verrouille, écrit via updateMany, relit puis audite le stock exact", async () => {
    const tx = fauxTx();

    const resultat = await executer(() =>
      appliquerMouvement(tx as never, {
        matierePremiereId: "farine-1",
        type: "SORTIE",
        quantite: 2,
        reference: "Production n°42",
        productionId: "production-1",
        auteurId: "utilisateur-1",
      }),
    );

    expect(resultat.matiere.quantiteStock.equals(8)).toBe(true);
    expect(tx.$queryRaw).toHaveBeenCalledBefore(tx.mouvementStock.create);
    expect(tx.mouvementStock.create).toHaveBeenCalledBefore(tx.matierePremiere.updateMany);
    expect(tx.matierePremiere.updateMany).toHaveBeenCalledBefore(tx.auditLog.create);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        utilisateurId: "utilisateur-1",
        utilisateurNom: "Responsable Stock",
        module: "STOCKS",
        typeEntite: "MatierePremiere",
        entiteId: "farine-1",
        action: "MODIFICATION",
      }),
    });
  });

  it("refuse un stock insuffisant avant tout mouvement et tout audit", async () => {
    const tx = fauxTx(matiere(1), matiere(1));

    await expect(
      executer(() =>
        appliquerMouvement(tx as never, {
          matierePremiereId: "farine-1",
          type: "SORTIE",
          quantite: 2,
          auteurId: "utilisateur-1",
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });

    expect(tx.mouvementStock.create).not.toHaveBeenCalled();
    expect(tx.matierePremiere.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it("propage l'échec d'audit après les écritures pour forcer le rollback de l'appelant", async () => {
    const tx = fauxTx();
    tx.auditLog.create.mockRejectedValue(new Error("audit indisponible"));

    await expect(
      executer(() =>
        appliquerMouvement(tx as never, {
          matierePremiereId: "farine-1",
          type: "SORTIE",
          quantite: 2,
          auteurId: "utilisateur-1",
        }),
      ),
    ).rejects.toThrow("audit indisponible");

    expect(tx.mouvementStock.create).toHaveBeenCalled();
    expect(tx.matierePremiere.updateMany).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalled();
  });
});
