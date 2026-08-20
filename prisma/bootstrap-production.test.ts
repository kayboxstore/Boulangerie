/**
 * Preuves du correctif P0-01, côté `bootstrap-production.ts` : le chemin de
 * production ne doit jamais pouvoir créer ou modifier un utilisateur, un
 * client, un fournisseur, un stock ou toute autre donnée métier — seulement
 * les rôles/permissions et les motifs fixes, de façon idempotente.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  bootstrapProduction,
  MATRICE_ROLES,
  MOTIFS_DON,
  MOTIFS_NON_CONFORMITE,
  MOTIFS_PERTE,
} from "./bootstrap-production.js";
import type { ClientBootstrap } from "./bootstrap-production.js";

const CHEMIN_SOURCE = fileURLToPath(new URL("./bootstrap-production.ts", import.meta.url));
const SOURCE = readFileSync(CHEMIN_SOURCE, "utf-8");

type RoleUpsertArgs = {
  where: { nom: string };
  update: { roleParentId: string | null };
  create: { nom: string; roleParentId: string | null };
};
type RolePermissionUpsertArgs = {
  where: { roleId_module: { roleId: string; module: string } };
  update: { niveauAcces: string };
  create: { roleId: string; module: string; niveauAcces: string };
};
type RolePermissionDeleteManyArgs = { where: { roleId: string; module: { notIn: string[] } } };
type MotifUpsertArgs = { where: { nom: string }; update: Record<string, never>; create: { nom: string } };

/**
 * Client Prisma factice, strictement limité aux 5 modèles structurels que le
 * type `ClientBootstrap` autorise. Enveloppé dans un `Proxy` qui lève sur
 * tout accès à une propriété hors de cette liste : preuve à l'EXÉCUTION (pas
 * seulement au typage) que `bootstrapProduction` ne peut pas toucher
 * `utilisateur`, `client`, `fournisseur`, `typeClient`, `produit`,
 * `matierePremiere` ou `parametreBoutique`.
 */
function creerClientFactice() {
  let compteurIdRole = 0;
  const rolesParNom = new Map<string, { id: string; roleParentId: string | null }>();
  const permissions = new Map<string, { roleId: string; module: string; niveauAcces: string }>();
  const motifs = { don: new Set<string>(), perte: new Set<string>(), nonConformite: new Set<string>() };

  const role = {
    findUniqueOrThrow: vi.fn(async ({ where: { nom } }: { where: { nom: string } }) => {
      const existant = rolesParNom.get(nom);
      if (!existant) throw new Error(`Rôle introuvable en base factice : ${nom}`);
      return { id: existant.id, nom, roleParentId: existant.roleParentId };
    }),
    upsert: vi.fn(async ({ where: { nom }, create }: RoleUpsertArgs) => {
      const existant = rolesParNom.get(nom);
      const id = existant?.id ?? `role-${++compteurIdRole}`;
      rolesParNom.set(nom, { id, roleParentId: create.roleParentId });
      return { id, nom, roleParentId: create.roleParentId };
    }),
  };

  const rolePermission = {
    upsert: vi.fn(
      async ({
        where: {
          roleId_module: { roleId, module },
        },
        create,
      }: RolePermissionUpsertArgs) => {
        permissions.set(`${roleId}:${module}`, { roleId, module, niveauAcces: create.niveauAcces });
      },
    ),
    deleteMany: vi.fn(async ({ where }: RolePermissionDeleteManyArgs) => {
      for (const cle of [...permissions.keys()]) {
        const [roleId, module] = cle.split(":");
        if (roleId === where.roleId && !where.module.notIn.includes(module)) permissions.delete(cle);
      }
    }),
  };

  const creerMotif = (ensemble: Set<string>) =>
    vi.fn(async ({ where: { nom } }: MotifUpsertArgs) => {
      ensemble.add(nom);
    });

  const motifDon = { upsert: creerMotif(motifs.don) };
  const motifPerte = { upsert: creerMotif(motifs.perte) };
  const motifNonConformite = { upsert: creerMotif(motifs.nonConformite) };

  const AUTORISES = new Set(["role", "rolePermission", "motifDon", "motifPerte", "motifNonConformite"]);
  const cible = { role, rolePermission, motifDon, motifPerte, motifNonConformite };

  const client = new Proxy(cible, {
    get(objet, propriete, recepteur) {
      if (typeof propriete === "string" && !AUTORISES.has(propriete)) {
        throw new Error(
          `bootstrapProduction a tenté d'accéder au modèle Prisma « ${propriete} » — interdit (correctif P0-01).`,
        );
      }
      return Reflect.get(objet, propriete, recepteur);
    },
  }) as unknown as ClientBootstrap;

  return { client, permissions, rolesParNom, motifs };
}

describe("bootstrapProduction (correctif P0-01)", () => {
  it("s'exécute sans jamais accéder à un modèle hors rôles/permissions/motifs", async () => {
    const { client } = creerClientFactice();
    await expect(bootstrapProduction(client)).resolves.toBeDefined();
  });

  it("retourne les décomptes exacts de la matrice de rôles et des motifs fixes", async () => {
    const { client } = creerClientFactice();
    const resultat = await bootstrapProduction(client);
    expect(resultat).toEqual({
      roles: MATRICE_ROLES.length,
      motifsDon: MOTIFS_DON.length,
      motifsPerte: MOTIFS_PERTE.length,
      motifsNonConformite: MOTIFS_NON_CONFORMITE.length,
    });
  });

  it("crée les rôles avec la bonne hiérarchie parent/enfant", async () => {
    const { client, rolesParNom } = creerClientFactice();
    await bootstrapProduction(client);
    expect(rolesParNom.size).toBe(MATRICE_ROLES.length);
    for (const spec of MATRICE_ROLES) {
      const role = rolesParNom.get(spec.nom);
      expect(role).toBeDefined();
      if (spec.roleParentNom) {
        expect(role?.roleParentId).toBe(rolesParNom.get(spec.roleParentNom)?.id);
      } else {
        expect(role?.roleParentId).toBeNull();
      }
    }
  });

  it("crée tous les motifs fixes attendus (don, perte, non-conformité)", async () => {
    const { client, motifs } = creerClientFactice();
    await bootstrapProduction(client);
    expect([...motifs.don].sort()).toEqual([...MOTIFS_DON].sort());
    expect([...motifs.perte].sort()).toEqual([...MOTIFS_PERTE].sort());
    expect([...motifs.nonConformite].sort()).toEqual([...MOTIFS_NON_CONFORMITE].sort());
  });

  it("est idempotent : deux exécutions successives donnent le même résultat, sans doublon", async () => {
    const { client, rolesParNom, motifs } = creerClientFactice();

    const premier = await bootstrapProduction(client);
    const nbRolesApres1 = rolesParNom.size;
    const nbMotifsApres1 = motifs.don.size + motifs.perte.size + motifs.nonConformite.size;

    const second = await bootstrapProduction(client);

    expect(second).toEqual(premier);
    expect(rolesParNom.size).toBe(nbRolesApres1);
    expect(motifs.don.size + motifs.perte.size + motifs.nonConformite.size).toBe(nbMotifsApres1);
  });

  it("preuve statique : le CODE (hors commentaires) ne référence jamais un modèle utilisateur ou métier", () => {
    // Le docblock d'en-tête décrit volontairement ces modèles interdits pour
    // expliquer pourquoi ils sont absents (ex. `prisma.utilisateur.*` ligne
    // ~123) — on retire donc les commentaires avant de chercher, pour ne
    // vérifier que le CODE réellement exécuté.
    const codeSansCommentaires = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const INTERDITS = [
      "prisma.utilisateur",
      ".utilisateur.",
      "prisma.client.",
      "prisma.fournisseur",
      "prisma.typeClient",
      "prisma.produit",
      "prisma.matierePremiere",
      "prisma.parametreBoutique",
      "estAdminPrincipal",
    ];
    for (const motif of INTERDITS) {
      expect(
        codeSansCommentaires.includes(motif),
        `« ${motif} » ne doit jamais apparaître dans le code de bootstrap-production.ts`,
      ).toBe(false);
    }
  });

  it("le type ClientBootstrap n'expose structurellement que les 5 modèles structurels", () => {
    // Recherche de la déclaration `Pick<PrismaClient, ...>` — si un futur modèle
    // métier y était ajouté par erreur, ce test échouerait immédiatement.
    const correspondance = SOURCE.match(/Pick<PrismaClient,\s*("[^"]+"(?:\s*\|\s*"[^"]+")*)\s*>/);
    expect(correspondance).not.toBeNull();
    const modeles = correspondance![1].split("|").map((s) => s.trim().replace(/"/g, ""));
    expect(modeles.sort()).toEqual(
      ["role", "rolePermission", "motifDon", "motifPerte", "motifNonConformite"].sort(),
    );
  });
});
