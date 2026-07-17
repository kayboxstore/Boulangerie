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
  return role;
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
  // --- Rôles, hiérarchie et matrice de permissions (section 2) ---

  // DG : lecture seule PARTOUT, y compris son propre périmètre — il ne modifie jamais rien.
  await upsertRole("Directeur Général", null, TOUS_LES_MODULES.map(lecture));

  // Administrateur : hors hiérarchie opérationnelle (rattaché au DG organisationnellement).
  // Écriture sur Paramètres et Équipe & droits d'accès uniquement.
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

  await upsertRole("Chargé des commandes", "Caissier(ère)", [ecriture(Module.COMMANDES)]);

  await upsertRole("Responsable de production", "Directeur Général", [ecriture(Module.PRODUCTION)]);

  // Responsable Fournisseurs/achats : écriture Fournisseurs ; lecture Stocks (son subordonné).
  await upsertRole("Responsable Fournisseurs/achats", "Directeur Général", [
    ecriture(Module.FOURNISSEURS),
    lecture(Module.STOCKS),
  ]);

  await upsertRole("Chargé du stock", "Responsable Fournisseurs/achats", [ecriture(Module.STOCKS)]);

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
  await upsertUtilisateur("Responsable Fournisseurs", "achats@lomoto.cd", "Responsable Fournisseurs/achats");
  await upsertUtilisateur("Chargé du stock", "stock@lomoto.cd", "Chargé du stock");

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

  console.log("Seed terminé — 7 rôles, 3 types de clients, 7 utilisateurs, 5 clients, 5 produits.");
  console.log(`Mot de passe de démonstration pour tous les comptes : ${MOT_DE_PASSE_DEMO}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
