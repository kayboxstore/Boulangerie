/**
 * Bootstrap de production — Boulangerie Lomoto (correctif P0-01, round 2).
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
 * Non-destructif par construction (correctif round 2, suite à la revue
 * indépendante « P1-01 ») : CHAQUE rôle et CHAQUE motif est traité
 * individuellement en « créer seulement s'il est totalement absent ». Si un
 * rôle existe déjà (qu'il ait été créé par un bootstrap précédent, ou que sa
 * matrice de permissions ait depuis été modifiée par un Administrateur via
 * `PUT /api/roles/:id/permissions`), ce fichier ne touche plus JAMAIS :
 *  - une permission existante (aucun `update` de `niveauAcces`) ;
 *  - la hiérarchie existante (`roleParentId`) ;
 *  - il ne supprime plus non plus une permission absente de la matrice
 *    (l'ancien `rolePermission.deleteMany` autoritatif a été retiré).
 * Un rôle nouvellement introduit dans une future version de la matrice est
 * bien installé (c'est la seule façon dont il peut jamais exister), mais
 * modifier la matrice d'un rôle déjà déployé n'est plus possible via ce
 * fichier — cela doit désormais passer par une migration Prisma versionnée
 * (`prisma/migrations/`), jamais par un rejeu indéfini du bootstrap.
 *
 * Atomique : toute l'installation (rôles + permissions + motifs) tourne dans
 * une seule transaction Prisma interactive. Si une écriture échoue en cours
 * de route (contrainte violée, connexion perdue...), PostgreSQL annule tout
 * ce que cette exécution avait déjà écrit — aucune initialisation partielle
 * ne peut jamais persister. Voir `bootstrap-production.test.ts` pour la
 * preuve (rôle cassé injecté au milieu de la liste, transaction avortée,
 * zéro rôle créé) contre une vraie base PostgreSQL.
 */
import { Module, NiveauAcces, PrismaClient, Prisma } from "@prisma/client";
import { pathToFileURL } from "node:url";

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
 * puissance). Rappel (voir en-tête) : ceci n'installe un rôle que s'il est
 * absent — modifier ici la matrice d'un rôle déjà déployé ailleurs n'aura
 * aucun effet ; passer par une migration Prisma pour ce cas.
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

const NOMS_MODELES_STRUCTURELS = ["role", "rolePermission", "motifDon", "motifPerte", "motifNonConformite"] as const;

/**
 * Vue restreinte du client Prisma utilisable À L'INTÉRIEUR de la transaction
 * atomique — mêmes 5 modèles que `ClientBootstrap`, mais typée sur
 * `Prisma.TransactionClient` (le type du paramètre reçu par le callback de
 * `$transaction`) plutôt que sur `PrismaClient` lui-même.
 */
export type TransactionBootstrap = Pick<Prisma.TransactionClient, (typeof NOMS_MODELES_STRUCTURELS)[number]>;

/**
 * Type minimal requis par ce module : uniquement les modèles structurels, et
 * un `$transaction` dont le callback ne reçoit lui-même que ces 5 modèles
 * (`TransactionBootstrap`) — pas le client de transaction complet. Un appel à
 * `prisma.utilisateur.*` (ou tout autre modèle métier), que ce soit hors ou à
 * l'intérieur de la transaction, ne compilerait même pas contre ce type, en
 * plus d'être absent du code ci-dessous.
 */
export type ClientBootstrap = Pick<PrismaClient, (typeof NOMS_MODELES_STRUCTURELS)[number]> & {
  $transaction: <T>(
    fn: (tx: TransactionBootstrap) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ) => Promise<T>;
};

/**
 * Timeout explicite de la transaction interactive (round 3, point 6 — P2
 * signalé en revue). Le défaut Prisma (`timeout: 5000`ms, `maxWait: 2000`ms)
 * est pensé pour une poignée d'écritures ; l'installation initiale complète
 * enchaîne jusqu'à ~80 aller-retours séquentiels (6 rôles × jusqu'à 9
 * permissions chacun, + 8 motifs, chacun `findUnique` puis éventuel
 * `create`). Sur une base Render à froid (premier déploiement, connexion pas
 * encore établie), le défaut pourrait être trop serré et faire échouer le
 * tout premier bootstrap sans raison de fond — ce qui échouerait fermé (le
 * build Render entier s'arrête, aucune écriture partielle, voir l'en-tête),
 * mais reste une gêne opérationnelle évitable.
 */
const OPTIONS_TRANSACTION_BOOTSTRAP = { maxWait: 10_000, timeout: 30_000 };

/**
 * Installe un rôle SEULEMENT s'il n'existe pas encore — ne touche plus jamais
 * un rôle déjà présent (ni ses permissions, ni sa hiérarchie). Voir l'en-tête
 * du fichier : c'est le cœur du correctif P1-01 (round 2).
 */
async function installerRoleSiAbsent(tx: TransactionBootstrap, spec: RolePermissionSpec): Promise<boolean> {
  const existant = await tx.role.findUnique({ where: { nom: spec.nom } });
  if (existant) return false;

  const roleParent = spec.roleParentNom
    ? await tx.role.findUniqueOrThrow({ where: { nom: spec.roleParentNom } })
    : null;

  const role = await tx.role.create({ data: { nom: spec.nom, roleParentId: roleParent?.id ?? null } });
  for (const p of spec.permissions) {
    await tx.rolePermission.create({ data: { roleId: role.id, module: p.module, niveauAcces: p.niveauAcces } });
  }
  return true;
}

type DelegueMotif = { findUnique: (args: { where: { nom: string } }) => Promise<unknown>; create: (args: { data: { nom: string } }) => Promise<unknown> };

/** Même principe que `installerRoleSiAbsent`, pour les 3 listes de motifs fixes. */
async function installerMotifsSiAbsents(delegue: DelegueMotif, noms: string[]): Promise<number> {
  let installes = 0;
  for (const nom of noms) {
    const existant = await delegue.findUnique({ where: { nom } });
    if (existant) continue;
    await delegue.create({ data: { nom } });
    installes++;
  }
  return installes;
}

export interface ResultatBootstrap {
  rolesInstalles: number;
  rolesDejaPresents: number;
  motifsDonInstalles: number;
  motifsPerteInstalles: number;
  motifsNonConformiteInstalles: number;
}

/**
 * Point d'entrée réutilisable — appelé directement par le script CLI
 * ci-dessous, par `seed-demo.ts` (source unique de la matrice de rôles), et
 * par les tests. Ne touche jamais `Utilisateur`, `Client`, `Fournisseur`,
 * `TypeClient`, `Produit`, `MatierePremiere` ni `ParametreBoutique` — recherche
 * exhaustive dans ce fichier : aucune de ces sept chaînes n'y apparaît en
 * dehors de ce commentaire, vérifié par `bootstrap-production.test.ts`.
 *
 * `roles`/`motifsDon`/`motifsPerte`/`motifsNonConformite` sont injectables
 * (par défaut : les constantes exportées ci-dessus) UNIQUEMENT pour permettre
 * aux tests de prouver l'atomicité avec une vraie transaction PostgreSQL (en
 * injectant une spec volontairement cassée) — `seed-demo.ts` et le CLI
 * ci-dessous n'utilisent jamais que les valeurs par défaut réelles.
 */
export async function bootstrapProduction(
  prisma: ClientBootstrap,
  roles: RolePermissionSpec[] = MATRICE_ROLES,
  motifsDon: string[] = MOTIFS_DON,
  motifsPerte: string[] = MOTIFS_PERTE,
  motifsNonConformite: string[] = MOTIFS_NON_CONFORMITE,
): Promise<ResultatBootstrap> {
  return prisma.$transaction(async (tx) => {
    let rolesInstalles = 0;
    // Les rôles parents doivent exister avant leurs enfants — l'ordre de
    // MATRICE_ROLES respecte déjà cette contrainte (Directeur Général en
    // premier, Chargé des commandes après Caissier(ère) dont il dépend).
    for (const spec of roles) {
      if (await installerRoleSiAbsent(tx, spec)) rolesInstalles++;
    }

    const motifsDonInstalles = await installerMotifsSiAbsents(tx.motifDon, motifsDon);
    const motifsPerteInstalles = await installerMotifsSiAbsents(tx.motifPerte, motifsPerte);
    const motifsNonConformiteInstalles = await installerMotifsSiAbsents(tx.motifNonConformite, motifsNonConformite);

    return {
      rolesInstalles,
      rolesDejaPresents: roles.length - rolesInstalles,
      motifsDonInstalles,
      motifsPerteInstalles,
      motifsNonConformiteInstalles,
    };
  }, OPTIONS_TRANSACTION_BOOTSTRAP);
}

// --- Exécution directe (`tsx prisma/bootstrap-production.ts` /
// `npm run db:bootstrap:production`) uniquement — ne s'exécute jamais quand
// ce fichier est importé par `seed-demo.ts` ou par les tests.
//
// Round 3 (revue Codex, point 2) : `import.meta.url === \`file://${process.argv[1]}\``
// n'est PAS fiable — sous Windows, `process.argv[1]` est un chemin natif
// (`C:\...`, séparateurs `\`) qui ne correspond jamais littéralement à une
// URL `file://` ; et tout chemin contenant des caractères devant être
// encodés en URL (espaces, accents...) ne correspond pas non plus tel quel.
// Un échec silencieux de cette comparaison signifie que le bloc ne s'exécute
// JAMAIS : le processus se termine avec succès sans avoir rien bootstrapé.
// `pathToFileURL` est la construction robuste recommandée par Node pour ce
// test (POSIX, Windows, et chemins avec espaces/caractères spéciaux) —
// vérifié par `bootstrap-production.test.ts` sur les trois cas.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prisma = new PrismaClient();
  bootstrapProduction(prisma)
    .then((resultat) => {
      console.log(
        `Bootstrap de production terminé — ${resultat.rolesInstalles} rôle(s) installé(s), ` +
          `${resultat.rolesDejaPresents} déjà présent(s) et laissé(s) intact(s) ; ` +
          `${resultat.motifsDonInstalles} motif(s) de don, ${resultat.motifsPerteInstalles} motif(s) de perte, ` +
          `${resultat.motifsNonConformiteInstalles} motif(s) de non-conformité installé(s). ` +
          `Aucun utilisateur créé — utilisez l'Assistant de premier lancement pour créer l'Administrateur Principal.`,
      );
    })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
