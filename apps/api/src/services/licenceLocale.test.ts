import { describe, expect, it, vi } from "vitest";
import type { prisma as prismaApp } from "../lib/prisma.js";
import { ErreurServiceLicences, type ReponseServiceLicences } from "./licenceCentrale.js";
import { activerLicence, calculerEtatLicencePourFrontend, rafraichirEtatLicence } from "./licenceLocale.js";

function creerPrismaFactice() {
  return {
    etatLicence: { upsert: vi.fn() },
  } as unknown as typeof prismaApp & { etatLicence: { upsert: ReturnType<typeof vi.fn> } };
}

describe("calculerEtatLicencePourFrontend", () => {
  it("jamais contacté (aucune ligne en cache) -> bloque", () => {
    expect(calculerEtatLicencePourFrontend(null, new Date("2026-06-01"))).toEqual({ bloque: true });
  });

  it("ligne en cache mais dernierContactReussi jamais renseigné -> bloque", () => {
    const resultat = calculerEtatLicencePourFrontend(
      { dernierStatutConnu: "ESSAI", joursRestants: 20, dernierContactReussi: null },
      new Date("2026-06-01"),
    );
    expect(resultat).toEqual({ bloque: true });
  });

  it("contact récent (aujourd'hui) -> pas bloqué, pas d'avertissement", () => {
    const maintenant = new Date("2026-06-10T12:00:00Z");
    const resultat = calculerEtatLicencePourFrontend(
      { dernierStatutConnu: "ESSAI", joursRestants: 15, dernierContactReussi: new Date("2026-06-10T08:00:00Z") },
      maintenant,
    );
    expect(resultat).toEqual({ bloque: false, avertissement: false, joursRestants: 15, joursDepuisContact: 0 });
  });

  it("contact ancien mais moins de 5 jours (ex. 3 jours) -> pas bloqué, avertissement", () => {
    const maintenant = new Date("2026-06-13T00:00:00Z");
    const resultat = calculerEtatLicencePourFrontend(
      { dernierStatutConnu: "ACTIVE", joursRestants: null, dernierContactReussi: new Date("2026-06-10T00:00:00Z") },
      maintenant,
    );
    expect(resultat).toEqual({ bloque: false, avertissement: true, joursRestants: undefined, joursDepuisContact: 3 });
  });

  it("exactement 1 jour depuis le dernier contact -> pas d'avertissement (limite exclue)", () => {
    const maintenant = new Date("2026-06-11T00:00:00Z");
    const resultat = calculerEtatLicencePourFrontend(
      { dernierStatutConnu: "ACTIVE", joursRestants: null, dernierContactReussi: new Date("2026-06-10T00:00:00Z") },
      maintenant,
    );
    expect(resultat).toEqual({ bloque: false, avertissement: false, joursRestants: undefined, joursDepuisContact: 1 });
  });

  it("exactement 5 jours depuis le dernier contact -> pas encore bloqué (limite incluse dans la grâce)", () => {
    const maintenant = new Date("2026-06-15T00:00:00Z");
    const resultat = calculerEtatLicencePourFrontend(
      { dernierStatutConnu: "ESSAI", joursRestants: 2, dernierContactReussi: new Date("2026-06-10T00:00:00Z") },
      maintenant,
    );
    expect(resultat.bloque).toBe(false);
    expect(resultat.avertissement).toBe(true);
  });

  it("plus de 5 jours depuis le dernier contact -> bloque", () => {
    const maintenant = new Date("2026-06-16T00:00:00Z");
    const resultat = calculerEtatLicencePourFrontend(
      { dernierStatutConnu: "ACTIVE", joursRestants: null, dernierContactReussi: new Date("2026-06-10T00:00:00Z") },
      maintenant,
    );
    expect(resultat).toEqual({ bloque: true, joursDepuisContact: 6 });
  });

  it("statut EXPIREE confirmé, même avec un contact du jour même -> bloque (pas de grâce pour un essai réellement terminé)", () => {
    const maintenant = new Date("2026-06-10T12:00:00Z");
    const resultat = calculerEtatLicencePourFrontend(
      { dernierStatutConnu: "EXPIREE", joursRestants: null, dernierContactReussi: new Date("2026-06-10T08:00:00Z") },
      maintenant,
    );
    expect(resultat).toEqual({ bloque: true, joursDepuisContact: 0 });
  });
});

describe("rafraichirEtatLicence (job périodique)", () => {
  it("succès : met à jour le cache (dernierStatutConnu, joursRestants, nomClientLicence, dernierContactReussi)", async () => {
    const prisma = creerPrismaFactice();
    const reponse: ReponseServiceLicences = { statut: "ESSAI", joursRestants: 22 };
    const appelerService = vi.fn().mockResolvedValue(reponse);

    await rafraichirEtatLicence(prisma, appelerService);

    expect(appelerService).toHaveBeenCalledWith();
    expect(prisma.etatLicence.upsert).toHaveBeenCalledOnce();
    const arg = prisma.etatLicence.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 1 });
    expect(arg.update).toEqual(
      expect.objectContaining({
        dernierStatutConnu: "ESSAI",
        joursRestants: 22,
        nomClientLicence: null,
      }),
    );
    expect(arg.update.dernierContactReussi).toBeInstanceOf(Date);
  });

  it("échec réseau/timeout : NE TOUCHE PAS le cache (upsert jamais appelé)", async () => {
    const prisma = creerPrismaFactice();
    const appelerService = vi.fn().mockRejectedValue(new ErreurServiceLicences("timeout"));

    await expect(rafraichirEtatLicence(prisma, appelerService)).resolves.toBeUndefined();

    expect(prisma.etatLicence.upsert).not.toHaveBeenCalled();
  });
});

describe("activerLicence (route POST /api/licence/activer)", () => {
  it("succès avec licence valide : met à jour le cache et renvoie statut/joursRestants/nomClient", async () => {
    const prisma = creerPrismaFactice();
    const reponse: ReponseServiceLicences = { statut: "ACTIVE", nomClient: "Boulangerie Test" };
    const appelerService = vi.fn().mockResolvedValue(reponse);

    const resultat = await activerLicence("CLE-VALIDE", prisma, appelerService);

    expect(appelerService).toHaveBeenCalledWith("CLE-VALIDE");
    expect(resultat).toEqual({ statut: "ACTIVE", joursRestants: undefined, nomClient: "Boulangerie Test", erreurActivation: undefined });
    expect(prisma.etatLicence.upsert).toHaveBeenCalledOnce();
  });

  it("réponse avec erreurActivation (ex. clé introuvable) : met quand même à jour le cache (contact réussi) et renvoie l'erreur telle quelle", async () => {
    const prisma = creerPrismaFactice();
    const reponse: ReponseServiceLicences = {
      statut: "ESSAI",
      joursRestants: 10,
      erreurActivation: "Clé de licence introuvable.",
    };
    const appelerService = vi.fn().mockResolvedValue(reponse);

    const resultat = await activerLicence("CLE-INCONNUE", prisma, appelerService);

    expect(resultat.erreurActivation).toBe("Clé de licence introuvable.");
    expect(resultat.statut).toBe("ESSAI");
    expect(prisma.etatLicence.upsert).toHaveBeenCalledOnce();
  });

  it("échec réseau/timeout : relance ErreurServiceLicences (l'appelant décide, pas de cache modifié)", async () => {
    const prisma = creerPrismaFactice();
    const appelerService = vi.fn().mockRejectedValue(new ErreurServiceLicences("injoignable"));

    await expect(activerLicence("CLE-X", prisma, appelerService)).rejects.toBeInstanceOf(ErreurServiceLicences);
    expect(prisma.etatLicence.upsert).not.toHaveBeenCalled();
  });
});
