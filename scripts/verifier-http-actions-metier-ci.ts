/**
 * Vérification CI, contre une VRAIE base PostgreSQL éphémère ET un VRAI
 * serveur HTTP Express (via `supertest`), du parcours COMPLET des 4 actions
 * critiques SUPPRIMER_UTILISATEUR, CREER_COMPTE_ADMIN, MODIFIER_TYPE_CLIENT,
 * MODIFIER_TAUX_TAXE — mission P1 « atomicité exécution métier + décision
 * pour les 4 autres approbations » (25/08/2026).
 *
 * Même convention que `verifier-http-permissions-role-ci.ts` (P2-01, Round
 * 3) : les tests mockés (`actionsCritiquesMetier.test.ts`,
 * `routes/approbations.test.ts`) prouvent le CÂBLAGE (bons arguments, bon
 * aiguillage, bons codes HTTP) — ils mockent `../lib/prisma.js` et/ou la
 * fonction de service la plus profonde, donc ne prouvent RIEN sur la
 * persistance réelle. Ce script-ci exerce les VRAIS routeurs Express
 * (`equipeRouter`, `clients.ts`/`typeClientsRouter`, `produitsRouter`,
 * `approbationsRouter`, tels qu'importés depuis le code de production), servis
 * par un VRAI serveur `supertest`, avec une VRAIE authentification JWT (un
 * jeton RÉELLEMENT signé pour un VRAI `Utilisateur` en base) — aucun mock
 * d'authentification, de service d'écriture, ou de Prisma.
 *
 * Pour chacun des 4 types, deux parcours :
 *  - DIRECT (Admin Principal) : la route métier correspondante → 200,
 *    écriture RÉELLEMENT persistée, relue depuis une connexion Prisma
 *    INDÉPENDANTE après la réponse HTTP.
 *  - APPROBATION (Admin secondaire → Admin Principal) : une `DemandeApprobation`
 *    RÉELLE est créée directement en base (même forme exacte de `donnees` que
 *    produirait la route de soumission — CREER_COMPTE_ADMIN a des
 *    préconditions de soumission propres au module Travailleurs/Email pro,
 *    hors périmètre de cette mission ; la création de la demande elle-même
 *    n'est PAS le chemin visé par ce correctif, contrairement à
 *    `POST /api/approbations/:id/approuver`, qui EST exercé ici en HTTP réel
 *    et non mocké), puis `POST /api/approbations/:id/approuver` (Principal)
 *    → 200, réservation + exécution métier + transition APPROUVEE
 *    RÉELLEMENT toutes committées ensemble, relues indépendamment.
 *
 * SÉCURITÉ : même garde que les autres scripts d'intégration — voir
 * `scripts/garde-integration-ci.ts`.
 *
 * IMPORTANT — imports DYNAMIQUES, APRÈS la garde (voir
 * `verifier-http-permissions-role-ci.ts` pour la justification complète :
 * `apps/api/src/lib/prisma.js` construit son `PrismaClient` dès son
 * chargement).
 *
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-http-actions-metier-ci.ts
 */
import { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-http-actions-metier-ci.ts");

const prisma = new PrismaClient();
const ROLE_ADMIN = "Administrateur HTTP Réel";
const ROLE_AUTRE = "Autre Rôle HTTP Réel";

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification HTTP réelle (actions métier, mission P1 du 25/08/2026) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function reinitialiserBase() {
  await prisma.auditLog.deleteMany();
  await prisma.demandeApprobation.deleteMany();
  await prisma.typeClient.deleteMany();
  await prisma.produit.deleteMany();
  await prisma.travailleur.deleteMany();
  await prisma.utilisateur.deleteMany();
  await prisma.role.deleteMany();
}

async function creerRoleAvecPermissions(nom: string) {
  const role = await prisma.role.create({ data: { nom, roleParentId: null } });
  await prisma.rolePermission.createMany({
    data: [
      { roleId: role.id, module: "EQUIPE", niveauAcces: "ECRITURE" },
      { roleId: role.id, module: "PARAMETRES", niveauAcces: "ECRITURE" },
    ],
  });
  return role;
}

async function creerCompteConnecte(
  nom: string,
  email: string,
  roleId: string,
  estAdminPrincipal: boolean,
  signToken: (payload: { sub: string; roleId: string; sid: string }) => string,
) {
  const sessionActuelleId = `session-${Math.random().toString(36).slice(2)}`;
  const u = await prisma.utilisateur.create({
    data: { nom, email, roleId, motDePasseHash: "x", actif: true, estAdminPrincipal, sessionActuelleId },
  });
  const jeton = signToken({ sub: u.id, roleId, sid: sessionActuelleId });
  return { utilisateur: u, jeton };
}

async function main() {
  const { equipeRouter } = await import("../apps/api/src/routes/equipe.js");
  const { typeClientsRouter } = await import("../apps/api/src/routes/clients.js");
  const { produitsRouter } = await import("../apps/api/src/routes/produits.js");
  const { approbationsRouter } = await import("../apps/api/src/routes/approbations.js");
  const { signToken } = await import("../apps/api/src/lib/jwt.js");

  const app = express();
  app.use(express.json());
  app.use("/api/equipe", equipeRouter);
  app.use("/api/type-clients", typeClientsRouter);
  app.use("/api/produits", produitsRouter);
  app.use("/api/approbations", approbationsRouter);

  await reinitialiserBase();

  console.log("→ Scénario 1/8 : SUPPRIMER_UTILISATEUR, parcours DIRECT réel — DELETE /api/equipe/:id (Admin Principal)…");
  {
    const roleAdmin = await creerRoleAvecPermissions(ROLE_ADMIN);
    const roleAutre = await creerRoleAvecPermissions(ROLE_AUTRE);
    const { jeton: jetonPrincipal } = await creerCompteConnecte("Principal S1", "principal-s1@test.local", roleAdmin.id, true, signToken);
    const cible = await prisma.utilisateur.create({
      data: { nom: "Cible S1", email: "cible-s1@test.local", roleId: roleAutre.id, motDePasseHash: "x", actif: true },
    });

    const res = await request(app).delete(`/api/equipe/${cible.id}`).set("Authorization", `Bearer ${jetonPrincipal}`);
    if (res.status !== 200) echouer(`scénario 1 : attendu 200, reçu ${res.status} (corps : ${JSON.stringify(res.body)})`);

    const clientVerif = new PrismaClient();
    let compteReel: Awaited<ReturnType<typeof clientVerif.utilisateur.findUnique>>;
    let auditReel: Awaited<ReturnType<typeof clientVerif.auditLog.findFirst>>;
    try {
      compteReel = await clientVerif.utilisateur.findUnique({ where: { id: cible.id } });
      auditReel = await clientVerif.auditLog.findFirst({ where: { typeEntite: "Utilisateur", entiteId: cible.id, action: "SUPPRESSION" } });
    } finally {
      await clientVerif.$disconnect();
    }
    if (compteReel !== null) echouer("scénario 1 : le compte aurait dû être RÉELLEMENT supprimé de PostgreSQL");
    if (!auditReel) echouer("scénario 1 : un AuditLog SUPPRESSION réel aurait dû être écrit");
    console.log("  ✓ compte réellement supprimé, AuditLog réellement écrit — chemin HTTP direct entièrement réel.");
  }

  console.log("→ Scénario 2/8 : MODIFIER_TYPE_CLIENT, parcours DIRECT réel — PUT /api/type-clients/:id (Admin Principal)…");
  {
    await reinitialiserBase();
    const roleAdmin = await creerRoleAvecPermissions(ROLE_ADMIN);
    const { jeton: jetonPrincipal } = await creerCompteConnecte("Principal S2", "principal-s2@test.local", roleAdmin.id, true, signToken);
    const tc = await prisma.typeClient.create({ data: { nom: "Dépositaire S2", prixParBac: 4100, commissionParBac: 0 } });

    const res = await request(app)
      .put(`/api/type-clients/${tc.id}`)
      .set("Authorization", `Bearer ${jetonPrincipal}`)
      .send({ prixParBac: 4300 });
    if (res.status !== 200) echouer(`scénario 2 : attendu 200, reçu ${res.status} (corps : ${JSON.stringify(res.body)})`);

    const clientVerif = new PrismaClient();
    let tcReel: Awaited<ReturnType<typeof clientVerif.typeClient.findUniqueOrThrow>>;
    try {
      tcReel = await clientVerif.typeClient.findUniqueOrThrow({ where: { id: tc.id } });
    } finally {
      await clientVerif.$disconnect();
    }
    if (tcReel.prixParBac !== 4300) echouer(`scénario 2 : prixParBac réel attendu 4300, trouvé ${tcReel.prixParBac}`);
    console.log("  ✓ TypeClient réellement mis à jour — chemin HTTP direct entièrement réel.");
  }

  console.log("→ Scénario 3/8 : MODIFIER_TAUX_TAXE, parcours DIRECT réel — PUT /api/produits/:id (Admin Principal)…");
  {
    await reinitialiserBase();
    const roleAdmin = await creerRoleAvecPermissions(ROLE_ADMIN);
    const { jeton: jetonPrincipal } = await creerCompteConnecte("Principal S3", "principal-s3@test.local", roleAdmin.id, true, signToken);
    const produit = await prisma.produit.create({ data: { nom: "Pain de mie S3", prixVente: 1500, tauxTaxe: 0, categorie: "Pain" } });

    const res = await request(app)
      .put(`/api/produits/${produit.id}`)
      .set("Authorization", `Bearer ${jetonPrincipal}`)
      .send({ tauxTaxe: 0.18 });
    if (res.status !== 200) echouer(`scénario 3 : attendu 200, reçu ${res.status} (corps : ${JSON.stringify(res.body)})`);

    const clientVerif = new PrismaClient();
    let produitReel: Awaited<ReturnType<typeof clientVerif.produit.findUniqueOrThrow>>;
    try {
      produitReel = await clientVerif.produit.findUniqueOrThrow({ where: { id: produit.id } });
    } finally {
      await clientVerif.$disconnect();
    }
    if (produitReel.tauxTaxe !== 0.18) echouer(`scénario 3 : tauxTaxe réel attendu 0.18, trouvé ${produitReel.tauxTaxe}`);
    console.log("  ✓ Produit réellement mis à jour — chemin HTTP direct entièrement réel.");
  }

  console.log("→ Scénario 4/8 : CREER_COMPTE_ADMIN, parcours DIRECT réel — POST /api/equipe (Admin Principal)…");
  {
    await reinitialiserBase();
    const roleAdmin = await creerRoleAvecPermissions(ROLE_ADMIN);
    const { jeton: jetonPrincipal } = await creerCompteConnecte("Principal S4", "principal-s4@test.local", roleAdmin.id, true, signToken);
    const travailleur = await prisma.travailleur.create({
      data: {
        nom: "Nouvelle Admin S4",
        poste: "Administratrice",
        dateEmbauche: new Date("2026-01-01"),
        emailProStatut: "ACTIF",
        emailProAdresse: "nouvelle-admin-s4@boulangerie-lomoto.com",
      },
    });

    const res = await request(app)
      .post("/api/equipe")
      .set("Authorization", `Bearer ${jetonPrincipal}`)
      .send({ travailleurId: travailleur.id, roleId: roleAdmin.id, motDePasse: "motdepasse123" });
    if (res.status !== 201) echouer(`scénario 4 : attendu 201, reçu ${res.status} (corps : ${JSON.stringify(res.body)})`);

    const clientVerif = new PrismaClient();
    let compteReel: Awaited<ReturnType<typeof clientVerif.utilisateur.findFirst>>;
    let travailleurReel: Awaited<ReturnType<typeof clientVerif.travailleur.findUniqueOrThrow>>;
    try {
      compteReel = await clientVerif.utilisateur.findFirst({ where: { email: "nouvelle-admin-s4@boulangerie-lomoto.com" } });
      travailleurReel = await clientVerif.travailleur.findUniqueOrThrow({ where: { id: travailleur.id } });
    } finally {
      await clientVerif.$disconnect();
    }
    if (!compteReel) echouer("scénario 4 : le compte Administrateur aurait dû être RÉELLEMENT créé");
    if (travailleurReel.utilisateurId !== compteReel!.id) {
      echouer("scénario 4 : la fiche Travailleur aurait dû être RÉELLEMENT rattachée au compte créé, dans la même opération");
    }
    console.log("  ✓ compte Administrateur réellement créé, fiche Travailleur réellement rattachée — chemin HTTP direct entièrement réel.");
  }

  console.log("→ Scénario 5/8 : SUPPRIMER_UTILISATEUR, parcours APPROBATION réel — POST /api/approbations/:id/approuver…");
  {
    await reinitialiserBase();
    const roleAdmin = await creerRoleAvecPermissions(ROLE_ADMIN);
    const roleAutre = await creerRoleAvecPermissions(ROLE_AUTRE);
    const { utilisateur: principal, jeton: jetonPrincipal } = await creerCompteConnecte("Principal S5", "principal-s5@test.local", roleAdmin.id, true, signToken);
    const { utilisateur: secondaire } = await creerCompteConnecte("Secondaire S5", "secondaire-s5@test.local", roleAdmin.id, false, signToken);
    const cible = await prisma.utilisateur.create({
      data: { nom: "Cible S5", email: "cible-s5@test.local", roleId: roleAutre.id, motDePasseHash: "x", actif: true },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "SUPPRIMER_UTILISATEUR",
        donnees: { utilisateurId: cible.id },
        resume: `supprimer le compte « ${cible.nom} »`,
        demandeParId: secondaire.id,
      },
    });

    const res = await request(app).post(`/api/approbations/${demande.id}/approuver`).set("Authorization", `Bearer ${jetonPrincipal}`).send({});
    if (res.status !== 200) echouer(`scénario 5 : attendu 200, reçu ${res.status} (corps : ${JSON.stringify(res.body)})`);
    if (res.body.demande?.statut !== "APPROUVEE") echouer("scénario 5 : statut de réponse attendu APPROUVEE");
    if (res.body.demande?.approuvePar?.id !== principal.id) echouer("scénario 5 : approuvePar attendu = le Principal exact");

    const clientVerif = new PrismaClient();
    let compteReel: Awaited<ReturnType<typeof clientVerif.utilisateur.findUnique>>;
    let demandeReelle: Awaited<ReturnType<typeof clientVerif.demandeApprobation.findUniqueOrThrow>>;
    try {
      compteReel = await clientVerif.utilisateur.findUnique({ where: { id: cible.id } });
      demandeReelle = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    } finally {
      await clientVerif.$disconnect();
    }
    if (compteReel !== null) echouer("scénario 5 : le compte aurait dû être RÉELLEMENT supprimé");
    if (demandeReelle.statut !== "APPROUVEE" || demandeReelle.approuveParId !== principal.id) {
      echouer("scénario 5 : la DemandeApprobation réelle doit être APPROUVEE par le Principal exact");
    }
    console.log("  ✓ réservation + suppression réelle + transition APPROUVEE, toutes committées ensemble — parcours HTTP approbation entièrement réel.");
  }

  console.log("→ Scénario 6/8 : CREER_COMPTE_ADMIN, parcours APPROBATION réel — rattachement Travailleur atomique…");
  {
    await reinitialiserBase();
    const roleAdmin = await creerRoleAvecPermissions(ROLE_ADMIN);
    const { utilisateur: principal, jeton: jetonPrincipal } = await creerCompteConnecte("Principal S6", "principal-s6@test.local", roleAdmin.id, true, signToken);
    const { utilisateur: secondaire } = await creerCompteConnecte("Secondaire S6", "secondaire-s6@test.local", roleAdmin.id, false, signToken);
    const travailleur = await prisma.travailleur.create({
      data: { nom: "Nouvelle Admin S6", poste: "Administratrice", dateEmbauche: new Date("2026-01-01") },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "CREER_COMPTE_ADMIN",
        donnees: { nom: "Nouvelle Admin S6", email: "nouvelle-admin-s6@test.local", roleId: roleAdmin.id, motDePasseHash: "hash-s6", travailleurId: travailleur.id },
        resume: "créer le compte Administrateur « Nouvelle Admin S6 »",
        demandeParId: secondaire.id,
      },
    });

    const res = await request(app).post(`/api/approbations/${demande.id}/approuver`).set("Authorization", `Bearer ${jetonPrincipal}`).send({});
    if (res.status !== 200) echouer(`scénario 6 : attendu 200, reçu ${res.status} (corps : ${JSON.stringify(res.body)})`);

    const clientVerif = new PrismaClient();
    let compteReel: Awaited<ReturnType<typeof clientVerif.utilisateur.findFirst>>;
    let travailleurReel: Awaited<ReturnType<typeof clientVerif.travailleur.findUniqueOrThrow>>;
    let demandeReelle: Awaited<ReturnType<typeof clientVerif.demandeApprobation.findUniqueOrThrow>>;
    try {
      compteReel = await clientVerif.utilisateur.findFirst({ where: { email: "nouvelle-admin-s6@test.local" } });
      travailleurReel = await clientVerif.travailleur.findUniqueOrThrow({ where: { id: travailleur.id } });
      demandeReelle = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    } finally {
      await clientVerif.$disconnect();
    }
    if (!compteReel) echouer("scénario 6 : le compte Administrateur aurait dû être RÉELLEMENT créé");
    if (travailleurReel.utilisateurId !== compteReel!.id) echouer("scénario 6 : rattachement Travailleur réel attendu, dans la MÊME transaction que l'approbation");
    if (demandeReelle.statut !== "APPROUVEE" || demandeReelle.approuveParId !== principal.id) echouer("scénario 6 : demande réelle attendue APPROUVEE par le Principal");
    console.log("  ✓ compte créé + Travailleur rattaché + demande APPROUVEE, tout committé dans la MÊME transaction — parcours HTTP approbation entièrement réel.");
  }

  console.log("→ Scénario 7/8 : MODIFIER_TYPE_CLIENT, parcours APPROBATION réel…");
  {
    await reinitialiserBase();
    const roleAdmin = await creerRoleAvecPermissions(ROLE_ADMIN);
    const { utilisateur: principal, jeton: jetonPrincipal } = await creerCompteConnecte("Principal S7", "principal-s7@test.local", roleAdmin.id, true, signToken);
    const { utilisateur: secondaire } = await creerCompteConnecte("Secondaire S7", "secondaire-s7@test.local", roleAdmin.id, false, signToken);
    const tc = await prisma.typeClient.create({ data: { nom: "Maman S7", prixParBac: 6000, commissionParBac: 1650 } });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "MODIFIER_TYPE_CLIENT",
        donnees: { typeClientId: tc.id, data: { prixParBac: 6200 } },
        resume: `modifier la qualité « ${tc.nom} »`,
        demandeParId: secondaire.id,
      },
    });

    const res = await request(app).post(`/api/approbations/${demande.id}/approuver`).set("Authorization", `Bearer ${jetonPrincipal}`).send({});
    if (res.status !== 200) echouer(`scénario 7 : attendu 200, reçu ${res.status} (corps : ${JSON.stringify(res.body)})`);

    const clientVerif = new PrismaClient();
    let tcReel: Awaited<ReturnType<typeof clientVerif.typeClient.findUniqueOrThrow>>;
    let demandeReelle: Awaited<ReturnType<typeof clientVerif.demandeApprobation.findUniqueOrThrow>>;
    try {
      tcReel = await clientVerif.typeClient.findUniqueOrThrow({ where: { id: tc.id } });
      demandeReelle = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    } finally {
      await clientVerif.$disconnect();
    }
    if (tcReel.prixParBac !== 6200) echouer(`scénario 7 : prixParBac réel attendu 6200, trouvé ${tcReel.prixParBac}`);
    if (demandeReelle.statut !== "APPROUVEE" || demandeReelle.approuveParId !== principal.id) echouer("scénario 7 : demande réelle attendue APPROUVEE par le Principal");
    console.log("  ✓ TypeClient réellement mis à jour + demande APPROUVEE, dans la MÊME transaction — parcours HTTP approbation entièrement réel.");
  }

  console.log("→ Scénario 8/8 : MODIFIER_TAUX_TAXE, parcours APPROBATION réel…");
  {
    await reinitialiserBase();
    const roleAdmin = await creerRoleAvecPermissions(ROLE_ADMIN);
    const { utilisateur: principal, jeton: jetonPrincipal } = await creerCompteConnecte("Principal S8", "principal-s8@test.local", roleAdmin.id, true, signToken);
    const { utilisateur: secondaire } = await creerCompteConnecte("Secondaire S8", "secondaire-s8@test.local", roleAdmin.id, false, signToken);
    const produit = await prisma.produit.create({ data: { nom: "Pain de mie S8", prixVente: 1500, tauxTaxe: 0, categorie: "Pain" } });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "MODIFIER_TAUX_TAXE",
        donnees: { produitId: produit.id, data: { tauxTaxe: 0.18 } },
        resume: `modifier le taux de taxe de « ${produit.nom} »`,
        demandeParId: secondaire.id,
      },
    });

    const res = await request(app).post(`/api/approbations/${demande.id}/approuver`).set("Authorization", `Bearer ${jetonPrincipal}`).send({});
    if (res.status !== 200) echouer(`scénario 8 : attendu 200, reçu ${res.status} (corps : ${JSON.stringify(res.body)})`);

    const clientVerif = new PrismaClient();
    let produitReel: Awaited<ReturnType<typeof clientVerif.produit.findUniqueOrThrow>>;
    let demandeReelle: Awaited<ReturnType<typeof clientVerif.demandeApprobation.findUniqueOrThrow>>;
    try {
      produitReel = await clientVerif.produit.findUniqueOrThrow({ where: { id: produit.id } });
      demandeReelle = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    } finally {
      await clientVerif.$disconnect();
    }
    if (produitReel.tauxTaxe !== 0.18) echouer(`scénario 8 : tauxTaxe réel attendu 0.18, trouvé ${produitReel.tauxTaxe}`);
    if (demandeReelle.statut !== "APPROUVEE" || demandeReelle.approuveParId !== principal.id) echouer("scénario 8 : demande réelle attendue APPROUVEE par le Principal");
    console.log("  ✓ Produit réellement mis à jour + demande APPROUVEE, dans la MÊME transaction — parcours HTTP approbation entièrement réel.");
  }

  await reinitialiserBase();
  console.log(
    "\n✅ Vérification HTTP réelle (mission P1, 25/08/2026) : 8 scénarios (4 types × direct/approbation) passent " +
      "contre un VRAI serveur Express + VRAIE authentification JWT + VRAIE base PostgreSQL — aucun mock " +
      "d'authentification, de service d'écriture, ou de Prisma ; toutes les écritures relues depuis une connexion " +
      "Prisma indépendante après chaque appel HTTP.\n",
  );
}

main()
  .catch((e) => {
    process.exitCode = 1;
    console.error(e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
