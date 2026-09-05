/**
 * Preuves du correctif P0-01, côté `bootstrap-production.ts` — round 2, après
 * la revue indépendante « P1-01 » : le chemin de production ne doit jamais
 * pouvoir créer ou modifier un utilisateur, un client, un fournisseur, un
 * stock ou toute autre donnée métier — et NE DOIT PLUS JAMAIS modifier ou
 * supprimer une permission, un niveau d'accès ou une hiérarchie de rôle déjà
 * existants, même rejoué à chaque déploiement. L'installation initiale doit
 * rester atomique (tout ou rien) sur une base neuve.
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
import type { ClientBootstrap, RolePermissionSpec } from "./bootstrap-production.js";

const CHEMIN_SOURCE = fileURLToPath(new URL("./bootstrap-production.ts", import.meta.url));
const SOURCE = readFileSync(CHEMIN_SOURCE, "utf-8");

type RoleFacticeState = { id: string; roleParentId: string | null };
type PermissionFacticeState = { roleId: string; module: string; niveauAcces: string };

/**
 * Fabrique les délégués Prisma factices (`role`, `rolePermission`, 3 modèles
 * de motifs) branchés sur les Maps/Sets passées en paramètre — utilisé à la
 * fois pour l'état "committé" du client factice et pour l'état "en cours" à
 * l'intérieur d'une transaction simulée (voir `$transaction` plus bas).
 */
function construireDelegues(
  rolesParNom: Map<string, RoleFacticeState>,
  permissions: Map<string, PermissionFacticeState>,
  motifsDon: Set<string>,
  motifsPerte: Set<string>,
  motifsNonConformite: Set<string>,
  compteur: { valeur: number },
) {
  const role = {
    findUnique: vi.fn(async ({ where: { nom } }: { where: { nom: string } }) => {
      const existant = rolesParNom.get(nom);
      return existant ? { id: existant.id, nom, roleParentId: existant.roleParentId } : null;
    }),
    findUniqueOrThrow: vi.fn(async ({ where: { nom } }: { where: { nom: string } }) => {
      const existant = rolesParNom.get(nom);
      if (!existant) throw new Error(`Rôle introuvable en base factice : ${nom}`);
      return { id: existant.id, nom, roleParentId: existant.roleParentId };
    }),
    create: vi.fn(async ({ data }: { data: { nom: string; roleParentId: string | null } }) => {
      const id = `role-${++compteur.valeur}`;
      rolesParNom.set(data.nom, { id, roleParentId: data.roleParentId });
      return { id, nom: data.nom, roleParentId: data.roleParentId };
    }),
  };

  const rolePermission = {
    create: vi.fn(
      async ({ data }: { data: { roleId: string; module: string; niveauAcces: string } }) => {
        permissions.set(`${data.roleId}:${data.module}`, { ...data });
      },
    ),
  };

  const creerMotifDelegue = (ensemble: Set<string>) => ({
    findUnique: vi.fn(async ({ where: { nom } }: { where: { nom: string } }) =>
      ensemble.has(nom) ? { nom } : null,
    ),
    create: vi.fn(async ({ data: { nom } }: { data: { nom: string } }) => {
      ensemble.add(nom);
    }),
  });

  return {
    role,
    rolePermission,
    motifDon: creerMotifDelegue(motifsDon),
    motifPerte: creerMotifDelegue(motifsPerte),
    motifNonConformite: creerMotifDelegue(motifsNonConformite),
  };
}

/**
 * Client Prisma factice, strictement limité aux 5 modèles structurels +
 * `$transaction`. Enveloppé dans un `Proxy` qui lève sur tout accès à une
 * propriété hors de cette liste : preuve à l'EXÉCUTION (pas seulement au
 * typage) que `bootstrapProduction` ne peut pas toucher `utilisateur`,
 * `client`, `fournisseur`, `typeClient`, `produit`, `matierePremiere` ou
 * `parametreBoutique`.
 *
 * `$transaction` simule une vraie transaction PostgreSQL : le callback
 * s'exécute contre une COPIE de l'état ; sur succès, la copie remplace l'état
 * committé ; sur échec (rejet), rien n'est propagé — reproduisant la garantie
 * « tout ou rien » sans base réelle. La preuve contre une vraie base
 * PostgreSQL est faite séparément (voir le rapport de vérification manuelle).
 */
function creerClientFactice() {
  const etat = {
    rolesParNom: new Map<string, RoleFacticeState>(),
    permissions: new Map<string, PermissionFacticeState>(),
    motifsDon: new Set<string>(),
    motifsPerte: new Set<string>(),
    motifsNonConformite: new Set<string>(),
  };
  const compteur = { valeur: 0 };

  const AUTORISES = new Set(["role", "rolePermission", "motifDon", "motifPerte", "motifNonConformite", "$transaction"]);

  const cible = {
    ...construireDelegues(
      etat.rolesParNom,
      etat.permissions,
      etat.motifsDon,
      etat.motifsPerte,
      etat.motifsNonConformite,
      compteur,
    ),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const rolesCopie = new Map(etat.rolesParNom);
      const permissionsCopie = new Map(etat.permissions);
      const donCopie = new Set(etat.motifsDon);
      const perteCopie = new Set(etat.motifsPerte);
      const ncCopie = new Set(etat.motifsNonConformite);
      const tx = construireDelegues(rolesCopie, permissionsCopie, donCopie, perteCopie, ncCopie, compteur);

      const resultat = await fn(tx); // si `fn` lève, on ne touche jamais à `etat` (rollback simulé)

      etat.rolesParNom = rolesCopie;
      etat.permissions = permissionsCopie;
      etat.motifsDon = donCopie;
      etat.motifsPerte = perteCopie;
      etat.motifsNonConformite = ncCopie;
      return resultat;
    }),
  };

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

  return { client, etat };
}

describe("bootstrapProduction — installation initiale (correctif P0-01)", () => {
  it("s'exécute sans jamais accéder à un modèle hors rôles/permissions/motifs", async () => {
    const { client } = creerClientFactice();
    await expect(bootstrapProduction(client)).resolves.toBeDefined();
  });

  it("sur une base vide, installe la matrice complète (6 rôles, tous les motifs)", async () => {
    const { client, etat } = creerClientFactice();
    const resultat = await bootstrapProduction(client);
    expect(resultat).toEqual({
      rolesInstalles: MATRICE_ROLES.length,
      rolesDejaPresents: 0,
      motifsDonInstalles: MOTIFS_DON.length,
      motifsPerteInstalles: MOTIFS_PERTE.length,
      motifsNonConformiteInstalles: MOTIFS_NON_CONFORMITE.length,
    });
    expect(etat.rolesParNom.size).toBe(MATRICE_ROLES.length);
    expect([...etat.motifsDon].sort()).toEqual([...MOTIFS_DON].sort());
    expect([...etat.motifsPerte].sort()).toEqual([...MOTIFS_PERTE].sort());
    expect([...etat.motifsNonConformite].sort()).toEqual([...MOTIFS_NON_CONFORMITE].sort());
  });

  it("crée les rôles avec la bonne hiérarchie parent/enfant", async () => {
    const { client, etat } = creerClientFactice();
    await bootstrapProduction(client);
    for (const spec of MATRICE_ROLES) {
      const role = etat.rolesParNom.get(spec.nom);
      expect(role).toBeDefined();
      if (spec.roleParentNom) {
        expect(role?.roleParentId).toBe(etat.rolesParNom.get(spec.roleParentNom)?.id);
      } else {
        expect(role?.roleParentId).toBeNull();
      }
    }
  });

  it("2ᵉ exécution sur le même état : rien de nouveau installé, état strictement identique (idempotence)", async () => {
    const { client, etat } = creerClientFactice();
    const premier = await bootstrapProduction(client);
    const rolesApres1 = new Map(etat.rolesParNom);
    const permissionsApres1 = new Map(etat.permissions);

    const second = await bootstrapProduction(client);

    expect(second).toEqual({
      rolesInstalles: 0,
      rolesDejaPresents: MATRICE_ROLES.length,
      motifsDonInstalles: 0,
      motifsPerteInstalles: 0,
      motifsNonConformiteInstalles: 0,
    });
    expect(premier.rolesInstalles).toBe(MATRICE_ROLES.length);
    expect(etat.rolesParNom).toEqual(rolesApres1);
    expect(etat.permissions).toEqual(permissionsApres1);
  });
});

describe("bootstrapProduction — non-destructif sur une base déjà initialisée (P1-01)", () => {
  it("une permission modifiée manuellement après le 1ᵉʳ bootstrap reste STRICTEMENT inchangée après un rejeu", async () => {
    const { client, etat } = creerClientFactice();
    await bootstrapProduction(client);

    const cleAdminParametres = [...etat.permissions.keys()].find((cle) => {
      const p = etat.permissions.get(cle)!;
      const role = [...etat.rolesParNom.entries()].find(([, r]) => r.id === p.roleId);
      return role?.[0] === "Administrateur" && p.module === "PARAMETRES";
    });
    expect(cleAdminParametres, "permission Administrateur/PARAMETRES introuvable après le 1ᵉʳ bootstrap").toBeDefined();

    // Simule une vraie décision d'Admin via PUT /api/roles/:id/permissions :
    // rétrograde la permission en LECTURE.
    etat.permissions.set(cleAdminParametres!, { ...etat.permissions.get(cleAdminParametres!)!, niveauAcces: "LECTURE" });
    const valeurPersonnalisee = { ...etat.permissions.get(cleAdminParametres!)! };

    await bootstrapProduction(client); // simule un redéploiement

    expect(etat.permissions.get(cleAdminParametres!)).toEqual(valeurPersonnalisee);
  });

  it("une permission retirée intentionnellement n'est PAS recréée par un rejeu", async () => {
    const { client, etat } = creerClientFactice();
    await bootstrapProduction(client);

    const uneCle = [...etat.permissions.keys()][0];
    expect(uneCle).toBeDefined();
    etat.permissions.delete(uneCle); // simule un retrait manuel (DB directe / futur endpoint DELETE)
    const nbPermissionsApresRetrait = etat.permissions.size;

    await bootstrapProduction(client);

    expect(etat.permissions.has(uneCle)).toBe(false);
    expect(etat.permissions.size).toBe(nbPermissionsApresRetrait);
  });

  it("la hiérarchie d'un rôle déjà existant n'est jamais réécrite par un rejeu", async () => {
    const { client, etat } = creerClientFactice();
    await bootstrapProduction(client);

    const admin = etat.rolesParNom.get("Administrateur")!;
    const idOriginal = admin.roleParentId;
    etat.rolesParNom.set("Administrateur", { ...admin, roleParentId: null }); // corruption/modif simulée

    await bootstrapProduction(client);

    expect(etat.rolesParNom.get("Administrateur")?.roleParentId).toBeNull(); // toujours la valeur simulée, jamais réécrite
    expect(etat.rolesParNom.get("Administrateur")?.roleParentId).not.toBe(idOriginal);
  });

  it("un rôle déjà présent n'est jamais retouché, même si sa spec en mémoire changeait", async () => {
    const { client, etat } = creerClientFactice();
    await bootstrapProduction(client);
    const nbPermissionsAvant = etat.permissions.size;

    // Rejoue avec une spec où « Caissier(ère) » aurait une permission en
    // moins — puisque le rôle existe déjà, il doit être intégralement ignoré.
    const specModifiee: RolePermissionSpec[] = MATRICE_ROLES.map((r) =>
      r.nom === "Caissier(ère)" ? { ...r, permissions: r.permissions.slice(0, 1) } : r,
    );
    const resultat = await bootstrapProduction(client, specModifiee);

    expect(resultat.rolesInstalles).toBe(0);
    expect(etat.permissions.size).toBe(nbPermissionsAvant);
  });
});

describe("bootstrapProduction — atomicité (P1-01)", () => {
  it("un échec en cours d'installation n'écrit RIEN (aucune initialisation partielle)", async () => {
    const { client, etat } = creerClientFactice();

    // Spec volontairement cassée : le 3ᵉ rôle référence un parent inexistant
    // → `findUniqueOrThrow` lève au milieu de la boucle, après que 2 rôles
    // aient déjà été « écrits » À L'INTÉRIEUR de la transaction simulée.
    const specCassee: RolePermissionSpec[] = [
      MATRICE_ROLES[0]!,
      MATRICE_ROLES[1]!,
      { nom: "Rôle Cassé", roleParentNom: "N'existe Pas Du Tout", permissions: [] },
      ...MATRICE_ROLES.slice(2),
    ];

    await expect(bootstrapProduction(client, specCassee)).rejects.toThrow(/N'existe Pas Du Tout/);

    // Rollback simulé : rien de ce que la transaction avortée avait déjà
    // "écrit" (les 2 premiers rôles) ne doit persister dans l'état committé.
    expect(etat.rolesParNom.size).toBe(0);
    expect(etat.permissions.size).toBe(0);
  });

  it("après un échec, une exécution normale réussit et installe tout depuis zéro", async () => {
    const { client, etat } = creerClientFactice();
    const specCassee: RolePermissionSpec[] = [{ nom: "Rôle Cassé", roleParentNom: "Fantôme", permissions: [] }];
    await expect(bootstrapProduction(client, specCassee)).rejects.toThrow();
    expect(etat.rolesParNom.size).toBe(0);

    const resultat = await bootstrapProduction(client); // spec réelle, par défaut
    expect(resultat.rolesInstalles).toBe(MATRICE_ROLES.length);
    expect(etat.rolesParNom.size).toBe(MATRICE_ROLES.length);
  });
});

describe("bootstrapProduction — détection d'entrypoint CLI, multiplateforme (round 3, point 2)", () => {
  it("utilise pathToFileURL, pas une concaténation manuelle `file://` (non fiable sous Windows / chemins à encoder)", () => {
    expect(SOURCE).toContain('import { pathToFileURL } from "node:url"');
    expect(SOURCE).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
    expect(SOURCE).not.toMatch(/`file:\/\/\$\{process\.argv\[1\]\}`/);
  });

  it(
    "le bloc CLI s'exécute réellement en exécution directe, y compris depuis un chemin contenant un espace",
    async () => {
      // Preuve dynamique, pas seulement statique : copie le fichier (+ ses
      // imports relatifs) dans un répertoire temporaire DONT LE NOM CONTIENT
      // UN ESPACE — exactement le genre de chemin que l'ancienne comparaison
      // `` `file://${process.argv[1]}` `` pouvait mal gérer (les espaces d'un
      // chemin doivent être pourcent-encodés dans une URL `file://`, ce que
      // `pathToFileURL` fait correctement et qu'une concaténation manuelle ne
      // fait pas). Placé SOUS `prisma/` pour que la résolution de
      // `node_modules` (remontée de répertoires par Node) continue de
      // fonctionner.
      const { mkdtempSync, copyFileSync, rmSync } = await import("node:fs");
      const path = await import("node:path");
      const { spawnSync } = await import("node:child_process");

      const dossierTemp = mkdtempSync(path.join(path.dirname(CHEMIN_SOURCE), "tmp espace test "));
      try {
        const copie = path.join(dossierTemp, "bootstrap-production.ts");
        copyFileSync(CHEMIN_SOURCE, copie);

        // DATABASE_URL volontairement injoignable (port 1) : si le bloc CLI
        // s'exécute (comportement attendu), Prisma tente une connexion réelle
        // et échoue avec un message de connexion explicite, code de sortie
        // non nul. Si le bloc CLI ne s'exécutait JAMAIS (régression exacte
        // signalée par la revue Codex), le processus se terminerait
        // SILENCIEUSEMENT avec le code 0, sans avoir rien tenté.
        const resultat = spawnSync("npx", ["tsx", copie], {
          cwd: path.dirname(CHEMIN_SOURCE),
          env: { ...process.env, DATABASE_URL: "postgresql://user:pass@127.0.0.1:1/injoignable" },
          encoding: "utf-8",
          timeout: 20_000,
        });

        expect(
          resultat.status,
          `sortie attendue non-nulle (preuve que le bloc CLI a bien été atteint) ; stdout=${resultat.stdout} stderr=${resultat.stderr}`,
        ).not.toBe(0);
        expect(resultat.stdout + resultat.stderr).toMatch(/Can't reach database|ECONNREFUSED|P1001/);
      } finally {
        rmSync(dossierTemp, { recursive: true, force: true });
      }
    },
    25_000,
  );
});

describe("bootstrapProduction — preuves statiques", () => {
  it("le CODE (hors commentaires) ne référence jamais un modèle utilisateur ou métier", () => {
    // Le docblock d'en-tête décrit volontairement ces modèles interdits pour
    // expliquer pourquoi ils sont absents — on retire donc les commentaires
    // avant de chercher, pour ne vérifier que le CODE réellement exécuté.
    const codeSansCommentaires = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const INTERDITS = [
      "prisma.utilisateur",
      "tx.utilisateur",
      ".utilisateur.",
      "prisma.client.",
      "tx.client.",
      "prisma.fournisseur",
      "tx.fournisseur",
      "prisma.typeClient",
      "tx.typeClient",
      "prisma.produit",
      "tx.produit",
      "prisma.matierePremiere",
      "tx.matierePremiere",
      "prisma.parametreBoutique",
      "tx.parametreBoutique",
      "estAdminPrincipal",
      "deleteMany", // le retrait autoritatif (P1-01) ne doit plus jamais réapparaître
    ];
    for (const motif of INTERDITS) {
      expect(
        codeSansCommentaires.includes(motif),
        `« ${motif} » ne doit jamais apparaître dans le code de bootstrap-production.ts`,
      ).toBe(false);
    }
  });

  it("ClientBootstrap ET TransactionBootstrap dérivent tous deux de la même liste de modèles autorisés", () => {
    const correspondanceListe = SOURCE.match(/NOMS_MODELES_STRUCTURELS = \[([^\]]+)\] as const/);
    expect(correspondanceListe, "NOMS_MODELES_STRUCTURELS introuvable").not.toBeNull();
    const modeles = correspondanceListe![1]
      .split(",")
      .map((s) => s.trim().replace(/"/g, ""))
      .filter(Boolean);
    expect(modeles.sort()).toEqual(["role", "rolePermission", "motifDon", "motifPerte", "motifNonConformite"].sort());

    // Les deux types Pick<> (hors et dans la transaction) doivent tous deux
    // référencer cette même liste — jamais une liste réécrite séparément.
    expect(SOURCE).toContain("Pick<PrismaClient, (typeof NOMS_MODELES_STRUCTURELS)[number]>");
    expect(SOURCE).toContain("Pick<Prisma.TransactionClient, (typeof NOMS_MODELES_STRUCTURELS)[number]>");
  });

  it("bootstrapProduction retourne dans une transaction Prisma ($transaction) — pas d'écriture hors transaction", () => {
    const debut = SOURCE.indexOf("export async function bootstrapProduction");
    const fin = SOURCE.indexOf("\n}\n\n// --- Exécution directe");
    expect(debut).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(debut);
    const corps = SOURCE.slice(debut, fin);
    expect(corps).toContain("return prisma.$transaction(async (tx) => {");
  });

  it("la transaction reçoit un timeout explicite et généreux (round 3, point 6 — évite l'échec du 1ᵉʳ bootstrap sur une base Render froide)", () => {
    expect(SOURCE).toContain("OPTIONS_TRANSACTION_BOOTSTRAP = { maxWait: 10_000, timeout: 30_000 }");
    expect(SOURCE).toContain("}, OPTIONS_TRANSACTION_BOOTSTRAP);");
    // Nettement au-dessus du défaut Prisma (timeout 5000ms, maxWait 2000ms) —
    // sans quoi cette option n'aurait aucun effet réel. On cible précisément
    // la valeur RÉELLEMENT utilisée (OPTIONS_TRANSACTION_BOOTSTRAP), pas
    // n'importe quelle occurrence du mot "timeout" dans le fichier (qui
    // apparaît aussi en prose, dans le docblock expliquant le défaut Prisma).
    const correspondance = SOURCE.match(
      /OPTIONS_TRANSACTION_BOOTSTRAP = \{ maxWait: ([\d_]+), timeout: ([\d_]+) \}/,
    );
    expect(correspondance).not.toBeNull();
    expect(Number(correspondance![2].replace(/_/g, ""))).toBeGreaterThan(5000);
    expect(Number(correspondance![1].replace(/_/g, ""))).toBeGreaterThan(2000);
  });
});
