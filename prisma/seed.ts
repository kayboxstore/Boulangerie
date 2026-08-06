/**
 * Seed initial — Boulangerie Lomoto (Phase 1).
 *
 * Crée : la hiérarchie de rôles (section 2 de la spec), la matrice de
 * permissions lecture/écriture, les types de clients (section 3.4),
 * un utilisateur de démonstration par rôle et un catalogue de pains.
 */
import { PrismaClient, Module, NiveauAcces, CodeIngredient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const TOUS_LES_MODULES = Object.values(Module);

// Mot de passe de démonstration commun (dev uniquement).
const MOT_DE_PASSE_DEMO = "Lomoto2026!";

type PermissionSeed = { module: Module; niveauAcces: NiveauAcces };

const ecriture = (module: Module): PermissionSeed => ({ module, niveauAcces: NiveauAcces.ECRITURE });
const lecture = (module: Module): PermissionSeed => ({ module, niveauAcces: NiveauAcces.LECTURE });

// Le seed est AUTORITATIF sur la matrice : les permissions absentes de la
// liste sont supprimées (permet les retraits, ex. DG sans accès Paramètres).
async function upsertRole(nom: string, roleParentNom: string | null, permissions: PermissionSeed[]) {
  const roleParent = roleParentNom
    ? await prisma.role.findUniqueOrThrow({ where: { nom: roleParentNom } })
    : null;

  const role = await prisma.role.upsert({
    where: { nom },
    update: { roleParentId: roleParent?.id ?? null },
    create: { nom, roleParentId: roleParent?.id ?? null },
  });

  for (const p of permissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_module: { roleId: role.id, module: p.module } },
      update: { niveauAcces: p.niveauAcces },
      create: { roleId: role.id, module: p.module, niveauAcces: p.niveauAcces },
    });
  }
  await prisma.rolePermission.deleteMany({
    where: { roleId: role.id, module: { notIn: permissions.map((p) => p.module) } },
  });
  return role;
}

/**
 * Retrofit (mise à jour de la section 2 de la spec) : fusionne
 * « Responsable Fournisseurs/achats » et « Chargé du stock » en un seul rôle
 * « Responsable Stock/Achats et Fournisseurs ». Les utilisateurs des deux
 * anciens rôles sont rattachés au rôle fusionné, puis les anciens rôles sont
 * supprimés. Idempotent : ne fait rien si les anciens rôles n'existent plus.
 */
async function fusionnerRolesStockAchats(nomFusionne: string) {
  const anciens = await prisma.role.findMany({
    where: { nom: { in: ["Responsable Fournisseurs/achats", "Chargé du stock"] } },
  });
  if (anciens.length === 0) return;

  const fusionne = await prisma.role.upsert({
    where: { nom: nomFusionne },
    update: {},
    create: { nom: nomFusionne },
  });

  for (const ancien of anciens) {
    await prisma.utilisateur.updateMany({
      where: { roleId: ancien.id },
      data: { roleId: fusionne.id },
    });
    // Détache les éventuels sous-rôles avant suppression (Chargé du stock
    // rapportait au Responsable Fournisseurs/achats).
    await prisma.role.updateMany({ where: { roleParentId: ancien.id }, data: { roleParentId: null } });
    await prisma.role.delete({ where: { id: ancien.id } }); // permissions supprimées en cascade
  }
  console.log(`Retrofit : rôles fusionnés en « ${nomFusionne} » (${anciens.length} ancien(s) rôle(s) supprimé(s))`);
}

/**
 * Retrofit (section 2/3.18) : le rôle « Chargé du personnel » disparaît —
 * Travailleurs passe à l'écriture de l'Admin secondaire. Les comptes qui
 * portaient encore ce rôle sont rebasculés sur « Administrateur » (en tant
 * que secondaire : `estAdminPrincipal` n'est jamais touché ici, il ne devient
 * `true` que pour le compte admin@boulangerie-lomoto.com plus bas). Idempotent : ne fait
 * rien si le rôle n'existe plus.
 */
async function retirerRoleChargeDuPersonnel() {
  const ancien = await prisma.role.findUnique({ where: { nom: "Chargé du personnel" } });
  if (!ancien) return;

  const administrateur = await prisma.role.upsert({
    where: { nom: "Administrateur" },
    update: {},
    create: { nom: "Administrateur" },
  });

  const { count } = await prisma.utilisateur.updateMany({
    where: { roleId: ancien.id },
    data: { roleId: administrateur.id },
  });
  await prisma.role.updateMany({ where: { roleParentId: ancien.id }, data: { roleParentId: null } });
  await prisma.role.delete({ where: { id: ancien.id } }); // permissions supprimées en cascade
  console.log(`Retrofit : rôle « Chargé du personnel » supprimé (${count} compte(s) rebasculé(s) sur Administrateur)`);
}

/**
 * Retrofit : migration du domaine des comptes de démonstration, de l'ancien
 * lomoto.cd vers boulangerie-lomoto.com (3.18). Ces comptes sont seedés
 * directement (pas de fiche Travailleur associée), donc hors du flux email
 * pro/Cloudflare : un simple renommage de l'identifiant de connexion suffit.
 * Idempotent : ne fait rien si l'ancienne adresse n'existe plus.
 */
const MIGRATION_EMAILS_DEMO: [string, string][] = [
  ["dg@lomoto.cd", "dg@boulangerie-lomoto.com"],
  ["admin@lomoto.cd", "admin@boulangerie-lomoto.com"],
  ["admin2@lomoto.cd", "admin2@boulangerie-lomoto.com"],
  ["caisse@lomoto.cd", "caisse@boulangerie-lomoto.com"],
  ["commandes@lomoto.cd", "commandes@boulangerie-lomoto.com"],
  ["production@lomoto.cd", "production@boulangerie-lomoto.com"],
  ["achats@lomoto.cd", "achats@boulangerie-lomoto.com"],
  ["stock@lomoto.cd", "stock@boulangerie-lomoto.com"],
  // Compte résiduel du rôle « Chargé du personnel » supprimé (retrofit
  // ci-dessus) : le rôle n'existe plus mais le compte, lui, reste — même
  // politique « jamais de suppression » que pour les tables ORPHELINE.
  ["personnel@lomoto.cd", "personnel@boulangerie-lomoto.com"],
];

async function migrerEmailsDemoVersNouveauDomaine() {
  for (const [ancien, nouveau] of MIGRATION_EMAILS_DEMO) {
    const existant = await prisma.utilisateur.findUnique({ where: { email: ancien } });
    if (!existant) continue;
    const cible = await prisma.utilisateur.findUnique({ where: { email: nouveau } });
    if (cible) continue;
    await prisma.utilisateur.update({ where: { id: existant.id }, data: { email: nouveau } });
    console.log(`Retrofit : compte de démo migré ${ancien} → ${nouveau}`);
  }
}

async function upsertUtilisateur(nom: string, email: string, roleNom: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { nom: roleNom } });
  const motDePasseHash = await bcrypt.hash(MOT_DE_PASSE_DEMO, 10);
  await prisma.utilisateur.upsert({
    where: { email },
    update: { roleId: role.id },
    create: { nom, email, motDePasseHash, roleId: role.id },
  });
}

async function main() {
  // --- Retrofit de la matrice (fusion des rôles stock/achats) ---
  await fusionnerRolesStockAchats("Responsable Stock/Achats et Fournisseurs");
  // --- Retrofit : suppression du rôle Chargé du personnel (3.18) ---
  await retirerRoleChargeDuPersonnel();
  // --- Retrofit : migration des comptes de démo vers boulangerie-lomoto.com ---
  await migrerEmailsDemoVersNouveauDomaine();

  // --- Rôles, hiérarchie et matrice de permissions (section 2, à jour) ---

  // DG : lecture seule partout SAUF Paramètres (aucun accès, ni lecture ni écriture).
  await upsertRole(
    "Directeur Général",
    null,
    TOUS_LES_MODULES.filter((m) => m !== Module.PARAMETRES).map(lecture),
  );

  // Administrateur (section 2, refonte des permissions). Les deux niveaux
  // partagent CE rôle ; ils ne sont distingués que par Utilisateur.estAdminPrincipal.
  // La matrice porte donc le socle de l'Admin SECONDAIRE : lecture sur tout,
  // écriture sur Paramètres, Équipe et Travailleurs (qui couvre Activation, État
  // système et Approbations, plus le roster du personnel depuis le retrait du
  // rôle Chargé du personnel). L'Admin PRINCIPAL, super utilisateur, voit tous
  // ses modules relevés en ÉCRITURE à la construction de son DTO
  // (middleware/auth.ts) — même mécanisme que la fusion des délégations temporaires.
  await upsertRole("Administrateur", "Directeur Général", [
    ...TOUS_LES_MODULES.filter(
      (m) => m !== Module.PARAMETRES && m !== Module.EQUIPE && m !== Module.TRAVAILLEURS,
    ).map(lecture),
    ecriture(Module.PARAMETRES),
    ecriture(Module.EQUIPE),
    ecriture(Module.TRAVAILLEURS),
  ]);

  // Caissier(ère) : écriture Caisse ; lecture Commandes (son subordonné),
  // plus l'exception explicite : lecture Commissions et Production.
  await upsertRole("Caissier(ère)", "Directeur Général", [
    ecriture(Module.CAISSE),
    lecture(Module.COMMANDES),
    lecture(Module.COMMISSIONS),
    lecture(Module.PRODUCTION),
  ]);

  // Chargé des commandes : écriture Commandes ; lecture Commissions (les
  // commissions dérivent directement de ses commandes).
  await upsertRole("Chargé des commandes", "Caissier(ère)", [
    ecriture(Module.COMMANDES),
    lecture(Module.COMMISSIONS),
  ]);

  await upsertRole("Responsable de production", "Directeur Général", [ecriture(Module.PRODUCTION)]);

  // Rôle fusionné : écriture sur Stocks ET Fournisseurs & achats.
  await upsertRole("Responsable Stock/Achats et Fournisseurs", "Directeur Général", [
    ecriture(Module.STOCKS),
    ecriture(Module.FOURNISSEURS),
  ]);

  // --- Types de clients (section 3.4) — montants en Fc ---
  const typesClients = [
    { nom: "Dépositaire", prixParBac: 4100, commissionParBac: 0 },
    { nom: "Vente cash (VC)", prixParBac: 4350, commissionParBac: 0 },
    { nom: "Maman", prixParBac: 6000, commissionParBac: 1650 },
  ];
  for (const tc of typesClients) {
    await prisma.typeClient.upsert({
      where: { nom: tc.nom },
      update: { prixParBac: tc.prixParBac, commissionParBac: tc.commissionParBac },
      create: tc,
    });
  }

  // --- Utilisateurs de démonstration (un par rôle) ---
  await upsertUtilisateur("Directeur Général", "dg@boulangerie-lomoto.com", "Directeur Général");
  await upsertUtilisateur("Administrateur", "admin@boulangerie-lomoto.com", "Administrateur");
  // Admin secondaire (démo Phase 10) : ses tâches critiques passent par une
  // demande d'approbation à l'Admin Principal, il n'exécute jamais directement.
  await upsertUtilisateur("Administrateur secondaire", "admin2@boulangerie-lomoto.com", "Administrateur");
  await upsertUtilisateur("Caissière", "caisse@boulangerie-lomoto.com", "Caissier(ère)");
  await upsertUtilisateur("Chargé des commandes", "commandes@boulangerie-lomoto.com", "Chargé des commandes");
  await upsertUtilisateur("Responsable de production", "production@boulangerie-lomoto.com", "Responsable de production");
  await upsertUtilisateur("Responsable Fournisseurs", "achats@boulangerie-lomoto.com", "Responsable Stock/Achats et Fournisseurs");
  await upsertUtilisateur("Chargé du stock", "stock@boulangerie-lomoto.com", "Responsable Stock/Achats et Fournisseurs");

  // Le compte admin seedé est le compte Administrateur principal (unique).
  await prisma.utilisateur.updateMany({
    where: { estAdminPrincipal: true, email: { not: "admin@boulangerie-lomoto.com" } },
    data: { estAdminPrincipal: false },
  });
  await prisma.utilisateur.update({
    where: { email: "admin@boulangerie-lomoto.com" },
    data: { estAdminPrincipal: true },
  });

  // --- Clients de démonstration (le solde d'avance démarre à 0) ---
  const clients = [
    { nom: "Maman Micheline", telephone: "+243 810 000 001", typeClientNom: "Maman" },
    { nom: "Maman Chantal", telephone: "+243 810 000 002", typeClientNom: "Maman" },
    { nom: "Dépôt Matonge", telephone: "+243 810 000 003", typeClientNom: "Dépositaire" },
    { nom: "Dépôt Victoire", telephone: null, typeClientNom: "Dépositaire" },
    { nom: "Client comptoir", telephone: null, typeClientNom: "Vente cash (VC)" },
  ];
  for (const c of clients) {
    const typeClient = await prisma.typeClient.findUniqueOrThrow({ where: { nom: c.typeClientNom } });
    const existant = await prisma.client.findFirst({ where: { nom: c.nom } });
    if (!existant) {
      await prisma.client.create({
        data: { nom: c.nom, telephone: c.telephone, typeClientId: typeClient.id },
      });
    }
  }

  // --- Paramètres de la boutique (section 3.9) — magasin clé/valeur ---
  // Modifiables par l'Admin dans les Paramètres ; on ne réécrit pas une valeur
  // déjà présente (update: {}), pour ne pas écraser une saisie existante.
  const parametresBoutique = [
    { cle: "boutique_nom", valeur: "Boulangerie Lomoto" },
    { cle: "boutique_adresse", valeur: "Kinshasa, République démocratique du Congo" },
    { cle: "boutique_contact", valeur: "+243 810 000 000 · contact@lomoto.cd" },
    { cle: "langue_defaut", valeur: "FR" },
  ];
  for (const p of parametresBoutique) {
    await prisma.parametreBoutique.upsert({ where: { cle: p.cle }, update: {}, create: p });
  }

  // --- Catalogue produits (Caisse) — catalogue RÉEL confirmé (section 3.1).
  // 100 % pain, exonéré de TVA (tauxTaxe = 0). En production, ce catalogue est
  // saisi/ajusté par un Admin via Paramètres → Produits ; on le seede ici pour
  // que l'environnement de démo reflète la réalité (Carré / Baguette).
  const produits = [
    { nom: "Carré 1.500 Fc", prixVente: 1500, categorie: "Pain" },
    { nom: "Carré 1.000 Fc", prixVente: 1000, categorie: "Pain" },
    { nom: "Baguette 500 Fc", prixVente: 500, categorie: "Pain" },
    { nom: "Baguette 1.000 Fc", prixVente: 1000, categorie: "Pain" },
  ];
  for (const p of produits) {
    await prisma.produit.upsert({
      where: { nom: p.nom },
      update: {},
      create: { ...p, tauxTaxe: 0 },
    });
  }

  // --- Matières premières (section 3.2) — stock initial hors journal (seed) ---
  // `code` relie les 4 ingrédients saisis à la production (section 3.3) à leur
  // matière : c'est lui qui pilote la décrémentation automatique du stock.
  // L'unité suit ce qui est réellement saisi (sacs de farine, paquets de levure).
  const matieres = [
    { nom: "Farine de blé", code: CodeIngredient.FARINE, unite: "sac", quantiteStock: 120, seuilAlerte: 20 },
    { nom: "Levure boulangère", code: CodeIngredient.LEVURE, unite: "paquet", quantiteStock: 60, seuilAlerte: 10 },
    { nom: "Sel", code: CodeIngredient.SEL, unite: "kg", quantiteStock: 15, seuilAlerte: 5 },
    { nom: "Huile", code: CodeIngredient.HUILE, unite: "L", quantiteStock: 40, seuilAlerte: 10 },
    { nom: "Sucre", code: null, unite: "kg", quantiteStock: 40, seuilAlerte: 10 },
    { nom: "Beurre", code: null, unite: "kg", quantiteStock: 25, seuilAlerte: 8 },
  ];
  for (const m of matieres) {
    // `update` porte le code et l'unité : une base déjà seedée avant la refonte
    // de 3.3 est ainsi alignée sans perdre son stock ni son historique.
    await prisma.matierePremiere.upsert({
      where: { nom: m.nom },
      update: { code: m.code, unite: m.unite },
      create: m,
    });
  }

  // --- Motifs de don de bacs (section 3.3 b) — liste fixe extensible ---------
  for (const nom of ["Police", "Baraka"]) {
    await prisma.motifDon.upsert({ where: { nom }, update: {}, create: { nom } });
  }

  // --- Fournisseurs de démonstration (section 3.6) ---
  const fournisseurs = [
    { nom: "Minoterie du Congo", contact: "+243 820 000 010 — Av. des Moulins, Kinshasa" },
    { nom: "Ets Kivu Distribution", contact: "+243 820 000 011" },
  ];
  for (const f of fournisseurs) {
    await prisma.fournisseur.upsert({
      where: { nom: f.nom },
      update: {},
      create: f,
    });
  }

  console.log("Seed terminé — 6 rôles, 3 types de clients, 8 utilisateurs, 5 clients, 4 produits, 6 matières premières, 2 motifs de don, 2 fournisseurs.");
  console.log(`Mot de passe de démonstration pour tous les comptes : ${MOT_DE_PASSE_DEMO}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
