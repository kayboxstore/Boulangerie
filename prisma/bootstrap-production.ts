/**
 * Bootstrap de production — Boulangerie Lomoto (correctif P0-01).
 *
 * Contrepartie sûre de `prisma/seed-demo.ts` : ce fichier ne crée QUE de la
 * configuration structurelle strictement nécessaire au fonctionnement de
 * l'application sur une base neuve — jamais un compte, jamais un mot de
 * passe, jamais une donnée métier (client/fournisseur/stock) fictive.
 *
 * Ce qu'il crée, et pourquoi c'est indispensable :
 *  - Les 6 rôles + leur matrice de permissions (section 2 de la spec) — sans
 *    eux, l'Assistant de premier lancement (`routes/premierLancement.ts`,
 *    étape `/finaliser`) échoue avec « Rôle Administrateur introuvable » : il
 *    cherche le rôle par son nom, il ne le crée jamais lui-même.
 *  - Les motifs fixes de don/perte/non-conformité (section 3.3 b/f) — aucune
 *    route de l'application ne permet de les créer (seules des routes `GET`
 *    existent, vérifié dans `routes/production.ts`) : sans ce bootstrap, ces
 *    listes resteraient vides en permanence sur une base neuve, empêchant de
 *    justifier une perte ou de clôturer une Production avec des bacs foutus.
 *
 * Ce qu'il NE crée JAMAIS, volontairement :
 *  - Aucun `Utilisateur` — le premier compte (Administrateur Principal) est
 *    créé par l'Assistant de premier lancement lui-même, avec un mot de passe
 *    choisi par le véritable responsable, jamais par ce script.
 *  - Aucun `Client`, `Fournisseur`, ni stock initial de `MatierePremiere` —
 *    ce sont des données métier réelles, propres à chaque déploiement, que ce
 *    script n'a aucune autorité pour inventer.
 *  - Aucun `TypeClient` ni `Produit` — leurs tarifs sont des décisions
 *    métier réelles (prix par bac, taux de taxe) que l'Admin configure
 *    consciemment depuis Paramètres après le premier lancement, jamais
 *    présumées par ce script.
 *  - Aucun `ParametreBoutique` — nom/adresse/contact de la boutique ; laissés
 *    vides plutôt que remplis d'une valeur de démonstration (`lireParametre`
 *    renvoie déjà un repli sûr si la clé n'existe pas, voir `lib/parametres.ts`).
 *
 * Idempotent par construction : chaque écriture est un `upsert` sur une clé
 * unique stable (nom de rôle, nom de motif) — rejouable indéfiniment, à
 * chaque déploiement, sans jamais dupliquer ni écraser une modification
 * ultérieure faite par un Admin (voir le commentaire sur `upsertRole` :
 * autoritatif sur la matrice de permissions elle-même, mais cette matrice
 * n'a par nature aucun lien avec un compte utilisateur).
 */
import { Module, NiveauAcces, PrismaClient } from "@prisma/client";

type PermissionSeed = { module: Module; niveauAcces: NiveauAcces };

const TOUS_LES_MODULES = Object.values(Module);
const ecriture = (module: Module): PermissionSeed => ({ module, niveauAcces: NiveauAcces.ECRITURE });
const lecture = (module: Module): PermissionSeed => ({ module, niveauAcces: NiveauAcces.LECTURE });

export interface RolePermissionSpec {
  nom: string;
  roleParentNom: string | null;
  permissions: PermissionSeed[];
}

/**
 * La matrice de rôles (section 2 de la spec), source UNIQUE — reprise telle
 * quelle par `seed-demo.ts` pour ne jamais la dupliquer entre les deux
 * scripts (un rôle créé différemment selon l'environnement serait un bug en
 * puissance).
 */
export const MATRICE_ROLES: RolePermissionSpec[] = [
  // DG : lecture seule partout SAUF Paramètres (aucun accès, ni lecture ni écriture).
  {
    nom: "Directeur Général",
    roleParentNom: null,
    permissions: TOUS_LES_MODULES.filter((m) => m !== Module.PARAMETRES).map(lecture),
  },
  // Administrateur (section 2). Les deux niveaux (Principal/secondaire)
  // partagent CE rôle ; ils ne sont distingués que par
  // `Utilisateur.estAdminPrincipal`, jamais touché par ce fichier. La matrice
  // porte le socle de l'Admin SECONDAIRE : lecture sur tout, écriture sur
  // Paramètres/Équipe/Travailleurs. L'Admin PRINCIPAL voit tous ses modules
  // relevés en ÉCRITURE au moment de la construction de son DTO
  // (middleware/auth.ts) — jamais en base.
  {
    nom: "Administrateur",
    roleParentNom: "Directeur Général",
    permissions: [
      ...TOUS_LES_MODULES.filter(
        (m) => m !== Module.PARAMETRES && m !== Module.EQUIPE && m !== Module.TRAVAILLEURS,
      ).map(lecture),
      ecriture(Module.PARAMETRES),
      ecriture(Module.EQUIPE),
      ecriture(Module.TRAVAILLEURS),
    ],
  },
  {
    nom: "Caissier(ère)",
    roleParentNom: "Directeur Général",
    permissions: [
      ecriture(Module.CAISSE),
      lecture(Module.COMMANDES),
      lecture(Module.COMMISSIONS),
      lecture(Module.PRODUCTION),
    ],
  },
  {
    nom: "Chargé des commandes",
    roleParentNom: "Caissier(ère)",
    permissions: [ecriture(Module.COMMANDES), lecture(Module.COMMISSIONS)],
  },
  {
    nom: "Responsable de production",
    roleParentNom: "Directeur Général",
    permissions: [ecriture(Module.PRODUCTION)],
  },
  {
    nom: "Responsable Stock/Achats et Fournisseurs",
    roleParentNom: "Directeur Général",
    permissions: [ecriture(Module.STOCKS), ecriture(Module.FOURNISSEURS)],
  },
];

/** Motifs fixes mais extensibles (aucune route de création n'existe — voir l'en-tête). */
export const MOTIFS_DON = ["Police", "Baraka"];
export const MOTIFS_PERTE = ["Cuisson ratée", "Casse / manutention", "Invendu périmé"];
export const MOTIFS_NON_CONFORMITE = ["Cuisson insuffisante", "Aspect non conforme", "Poids non conforme"];

/**
 * Type minimal requis par ce module : uniquement les modèles structurels.
 * Volontairement plus étroit que `PrismaClient` complet — un appel à
 * `prisma.utilisateur.*` (ou tout autre modèle métier) ne compilerait même
 * pas contre ce type, en plus d'être absent du code ci-dessous.
 */
export type ClientBootstrap = Pick<PrismaClient, "role" | "rolePermission" | "motifDon" | "motifPerte" | "motifNonConformite">;

/**
 * Le seed est AUTORITATIF sur la matrice de permissions d'un rôle donné :
 * les permissions absentes de la liste sont supprimées (permet un retrait
 * futur, ex. DG sans accès Paramètres) — identique au comportement historique
 * de `seed.ts`, seulement déplacé ici pour devenir la source unique.
 */
async function upsertRole(prisma: ClientBootstrap, spec: RolePermissionSpec) {
  const roleParent = spec.roleParentNom
    ? await prisma.role.findUniqueOrThrow({ where: { nom: spec.roleParentNom } })
    : null;

  const role = await prisma.role.upsert({
    where: { nom: spec.nom },
    update: { roleParentId: roleParent?.id ?? null },
    create: { nom: spec.nom, roleParentId: roleParent?.id ?? null },
  });

  for (const p of spec.permissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_module: { roleId: role.id, module: p.module } },
      update: { niveauAcces: p.niveauAcces },
      create: { roleId: role.id, module: p.module, niveauAcces: p.niveauAcces },
    });
  }
  await prisma.rolePermission.deleteMany({
    where: { roleId: role.id, module: { notIn: spec.permissions.map((p) => p.module) } },
  });
}

export interface ResultatBootstrap {
  roles: number;
  motifsDon: number;
  motifsPerte: number;
  motifsNonConformite: number;
}

/**
 * Point d'entrée réutilisable — appelé directement par le script CLI
 * ci-dessous, par `seed-demo.ts` (source unique de la matrice de rôles), et
 * par les tests. Ne touche jamais `Utilisateur`, `Client`, `Fournisseur`,
 * `TypeClient`, `Produit`, `MatierePremiere` ni `ParametreBoutique` — recherche
 * exhaustive dans ce fichier : aucune de ces sept chaînes n'y apparaît en
 * dehors de ce commentaire, vérifié par `bootstrap-production.test.ts`.
 */
export async function bootstrapProduction(prisma: ClientBootstrap): Promise<ResultatBootstrap> {
  // Les rôles parents doivent exister avant leurs enfants — l'ordre de
  // MATRICE_ROLES respecte déjà cette contrainte (Directeur Général en
  // premier, Chargé des commandes après Caissier(ère) dont il dépend).
  for (const spec of MATRICE_ROLES) {
    await upsertRole(prisma, spec);
  }

  for (const nom of MOTIFS_DON) {
    await prisma.motifDon.upsert({ where: { nom }, update: {}, create: { nom } });
  }
  for (const nom of MOTIFS_PERTE) {
    await prisma.motifPerte.upsert({ where: { nom }, update: {}, create: { nom } });
  }
  for (const nom of MOTIFS_NON_CONFORMITE) {
    await prisma.motifNonConformite.upsert({ where: { nom }, update: {}, create: { nom } });
  }

  return {
    roles: MATRICE_ROLES.length,
    motifsDon: MOTIFS_DON.length,
    motifsPerte: MOTIFS_PERTE.length,
    motifsNonConformite: MOTIFS_NON_CONFORMITE.length,
  };
}

// --- Exécution directe (`tsx prisma/bootstrap-production.ts` /
// `npm run db:bootstrap:production`) uniquement — ne s'exécute jamais quand
// ce fichier est importé par `seed-demo.ts` ou par les tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  const prisma = new PrismaClient();
  bootstrapProduction(prisma)
    .then((resultat) => {
      console.log(
        `Bootstrap de production terminé — ${resultat.roles} rôles, ${resultat.motifsDon} motifs de don, ` +
          `${resultat.motifsPerte} motifs de perte, ${resultat.motifsNonConformite} motifs de non-conformité. ` +
          `Aucun utilisateur créé — utilisez l'Assistant de premier lancement pour créer l'Administrateur Principal.`,
      );
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
