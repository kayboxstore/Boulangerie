/**
 * Seed initial — Boulangerie Lomoto (Phase 1).
 *
 * Crée : la hiérarchie de rôles (section 2 de la spec), la matrice de
 * permissions lecture/écriture, les types de clients (section 3.4),
 * un utilisateur de démonstration par rôle et un catalogue de pains.
 */
import { PrismaClient, Module, NiveauAcces } from "@prisma/client";
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

  // --- Rôles, hiérarchie et matrice de permissions (section 2, à jour) ---

  // DG : lecture seule partout SAUF Paramètres (aucun accès, ni lecture ni écriture).
  await upsertRole(
    "Directeur Général",
    null,
    TOUS_LES_MODULES.filter((m) => m !== Module.PARAMETRES).map(lecture),
  );

  // Administrateur : hors hiérarchie opérationnelle (rattaché au DG organisationnellement).
  // Écriture sur Paramètres et Équipe & droits d'accès uniquement.
  // Jusqu'à 3 comptes (1 principal + 2 secondaires) — voir Utilisateur.estAdminPrincipal.
  await upsertRole("Administrateur", "Directeur Général", [
    ecriture(Module.PARAMETRES),
    ecriture(Module.EQUIPE),
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

  // Chargé du personnel : écriture Travailleurs (module construit en phase ultérieure).
  await upsertRole("Chargé du personnel", "Directeur Général", [ecriture(Module.TRAVAILLEURS)]);

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
  await upsertUtilisateur("Directeur Général", "dg@lomoto.cd", "Directeur Général");
  await upsertUtilisateur("Administrateur", "admin@lomoto.cd", "Administrateur");
  await upsertUtilisateur("Caissière", "caisse@lomoto.cd", "Caissier(ère)");
  await upsertUtilisateur("Chargé des commandes", "commandes@lomoto.cd", "Chargé des commandes");
  await upsertUtilisateur("Responsable de production", "production@lomoto.cd", "Responsable de production");
  await upsertUtilisateur("Responsable Fournisseurs", "achats@lomoto.cd", "Responsable Stock/Achats et Fournisseurs");
  await upsertUtilisateur("Chargé du stock", "stock@lomoto.cd", "Responsable Stock/Achats et Fournisseurs");
  await upsertUtilisateur("Chargé du personnel", "personnel@lomoto.cd", "Chargé du personnel");

  // Le compte admin seedé est le compte Administrateur principal (unique).
  await prisma.utilisateur.updateMany({
    where: { estAdminPrincipal: true, email: { not: "admin@lomoto.cd" } },
    data: { estAdminPrincipal: false },
  });
  await prisma.utilisateur.update({
    where: { email: "admin@lomoto.cd" },
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

  // --- Paramètres de la boutique (section 3.9) ---
  // Seuil d'alerte transaction inhabituelle (3.10) : 100 000 Fc par défaut,
  // modifiable ensuite par l'Admin dans les Paramètres.
  await prisma.parametreBoutique.upsert({
    where: { cle: "seuil_alerte_transaction" },
    update: {},
    create: { cle: "seuil_alerte_transaction", valeur: "100000" },
  });

  // --- Catalogue produits initial (pain — exonéré de TVA, tauxTaxe = 0) ---
  const produits = [
    { nom: "Pain bac (standard)", prixVente: 4100, categorie: "Pain" },
    { nom: "Baguette", prixVente: 500, categorie: "Pain" },
    { nom: "Pain complet", prixVente: 800, categorie: "Pain" },
    { nom: "Pain de mie", prixVente: 1500, categorie: "Pain" },
    { nom: "Petit pain", prixVente: 250, categorie: "Pain" },
  ];
  for (const p of produits) {
    await prisma.produit.upsert({
      where: { nom: p.nom },
      update: {},
      create: { ...p, tauxTaxe: 0 },
    });
  }

  console.log("Seed terminé — 7 rôles, 3 types de clients, 8 utilisateurs, 5 clients, 5 produits.");
  console.log(`Mot de passe de démonstration pour tous les comptes : ${MOT_DE_PASSE_DEMO}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
