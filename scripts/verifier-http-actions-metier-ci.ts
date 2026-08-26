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
import { ROLE_ADMINISTRATEUR } from "@lomoto/shared";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-http-actions-metier-ci.ts");

const prisma = new PrismaClient();
// Correctif (Round 2, contre-revue Codex du 25/08/2026) : DOIT être
// EXACTEMENT `ROLE_ADMINISTRATEUR` (« Administrateur ») — un nom de rôle
// différent (l'ancien « Administrateur HTTP Réel ») fait prendre à
// `routes/equipe.ts` (`role.nom === ROLE_ADMINISTRATEUR`) le chemin de
// création DIRECTE non-admin au lieu du chemin CREER_COMPTE_ADMIN, et fait
// désormais rejeter la demande par la revérification de rôle du correctif
// P1 (`creerCompteAdminTx`) — les scénarios 4 et 6 (CREER_COMPTE_ADMIN)
// testaient donc, avant ce correctif, le MAUVAIS chemin de code sans jamais
// le signaler.
const ROLE_ADMIN = ROLE_ADMINISTRATEUR;
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
      { roleId: role.id, module: "TRAVAILLEURS", niveauAcces: "ECRITURE" },
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
  const { travailleursRouter } = await import("../apps/api/src/routes/travailleurs.js");
  const { signToken } = await import("../apps/api/src/lib/jwt.js");

  const app = express();
  app.use(express.json());
  app.use("/api/equipe", equipeRouter);
  app.use("/api/type-clients", typeClientsRouter);
  app.use("/api/produits", produitsRouter);
  app.use("/api/approbations", approbationsRouter);
  app.use("/api/travailleurs", travailleursRouter);

  await reinitialiserBase();

  console.log("→ Scénario 1/9 : SUPPRIMER_UTILISATEUR, parcours DIRECT réel — DELETE /api/equipe/:id (Admin Principal)…");
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

  console.log("→ Scénario 2/9 : MODIFIER_TYPE_CLIENT, parcours DIRECT réel — PUT /api/type-clients/:id (Admin Principal)…");
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

  console.log("→ Scénario 3/9 : MODIFIER_TAUX_TAXE, parcours DIRECT réel — PUT /api/produits/:id (Admin Principal)…");
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

  console.log("→ Scénario 4/9 : CREER_COMPTE_ADMIN, parcours DIRECT réel — POST /api/equipe (Admin Principal)…");
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
    // CREER_COMPTE_ADMIN passe par `traiterActionCritique` (section 2/3.16) :
    // exécution directe par l'Admin Principal → 200 `{statut:"execute"}`,
    // JAMAIS 201 (ce code n'est renvoyé que par le chemin de création directe
    // d'un compte NON-Administrateur, plus bas dans `routes/equipe.ts`).
    if (res.status !== 200) echouer(`scénario 4 : attendu 200, reçu ${res.status} (corps : ${JSON.stringify(res.body)})`);
    if (res.body.statut !== "execute") echouer(`scénario 4 : statut de réponse attendu "execute", reçu ${JSON.stringify(res.body)}`);

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

  console.log("→ Scénario 5/9 : SUPPRIMER_UTILISATEUR, parcours APPROBATION réel — POST /api/approbations/:id/approuver…");
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

  console.log("→ Scénario 6/9 : CREER_COMPTE_ADMIN, parcours APPROBATION réel — rattachement Travailleur atomique…");
  {
    await reinitialiserBase();
    const roleAdmin = await creerRoleAvecPermissions(ROLE_ADMIN);
    const { utilisateur: principal, jeton: jetonPrincipal } = await creerCompteConnecte("Principal S6", "principal-s6@test.local", roleAdmin.id, true, signToken);
    const { utilisateur: secondaire } = await creerCompteConnecte("Secondaire S6", "secondaire-s6@test.local", roleAdmin.id, false, signToken);
    const emailS6 = "nouvelle-admin-s6@test.local";
    const travailleur = await prisma.travailleur.create({
      data: { nom: "Nouvelle Admin S6", poste: "Administratrice", dateEmbauche: new Date("2026-01-01"), emailProStatut: "ACTIF", emailProAdresse: emailS6 },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "CREER_COMPTE_ADMIN",
        donnees: { nom: "Nouvelle Admin S6", email: emailS6, roleId: roleAdmin.id, motDePasseHash: "hash-s6", travailleurId: travailleur.id },
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

  console.log("→ Scénario 7/9 : MODIFIER_TYPE_CLIENT, parcours APPROBATION réel…");
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

  console.log("→ Scénario 8/9 : MODIFIER_TAUX_TAXE, parcours APPROBATION réel…");
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

  console.log(
    "→ Scénario 9/9 : CREER_COMPTE_ADMIN, protection RÉELLE contre l'écrasement du rattachement (correctif P1, Round 2, " +
      "contre-revue Codex du 25/08/2026) — Travailleur rattaché entre-temps à un AUTRE compte via le VRAI parcours HTTP " +
      "Travailleurs, avant que l'ancienne demande ne soit approuvée…",
  );
  {
    await reinitialiserBase();
    const roleAdmin = await creerRoleAvecPermissions(ROLE_ADMIN);
    const roleAutre = await creerRoleAvecPermissions(ROLE_AUTRE);
    const { jeton: jetonPrincipal } = await creerCompteConnecte("Principal S9", "principal-s9@test.local", roleAdmin.id, true, signToken);
    const { utilisateur: secondaire } = await creerCompteConnecte("Secondaire S9", "secondaire-s9@test.local", roleAdmin.id, false, signToken);

    const email = "nouvelle-admin-s9@test.local";
    const travailleur = await prisma.travailleur.create({
      data: { nom: "Fiche S9", poste: "Administratrice", dateEmbauche: new Date("2026-01-01"), emailProStatut: "ACTIF", emailProAdresse: email },
    });

    // 1) Une demande CREER_COMPTE_ADMIN RÉELLE est créée pour ce Travailleur,
    //    encore libre à cet instant.
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "CREER_COMPTE_ADMIN",
        donnees: { nom: "Nouvelle Admin S9", email, roleId: roleAdmin.id, motDePasseHash: "hash-s9", travailleurId: travailleur.id },
        resume: "créer le compte Administrateur « Nouvelle Admin S9 »",
        demandeParId: secondaire.id,
      },
    });

    // 2) AVANT l'approbation, ce Travailleur est légitimement rattaché à un
    //    AUTRE compte via le VRAI parcours HTTP autorisé
    //    (PUT /api/travailleurs/:id, routeur réel, requireAuth réel) —
    //    exactement ce que ferait un Chargé du personnel, sans savoir qu'une
    //    demande d'approbation désormais obsolète vise encore cette fiche.
    const compteAutre = await prisma.utilisateur.create({
      data: { nom: "Compte Autre S9", email: "compte-autre-s9@test.local", roleId: roleAutre.id, motDePasseHash: "x", actif: true },
    });
    const resRattachement = await request(app)
      .put(`/api/travailleurs/${travailleur.id}`)
      .set("Authorization", `Bearer ${jetonPrincipal}`)
      .send({ utilisateurId: compteAutre.id });
    if (resRattachement.status !== 200) {
      echouer(
        `scénario 9 : le rattachement réel préalable (PUT /api/travailleurs/:id) aurait dû réussir, reçu ${resRattachement.status} ` +
          `(corps : ${JSON.stringify(resRattachement.body)})`,
      );
    }

    // 3) L'ancienne demande, désormais obsolète, est approuvée — DOIT échouer
    //    proprement plutôt que d'écraser silencieusement le rattachement RÉCENT.
    const resApprobation = await request(app)
      .post(`/api/approbations/${demande.id}/approuver`)
      .set("Authorization", `Bearer ${jetonPrincipal}`)
      .send({});
    if (resApprobation.status !== 409) {
      echouer(
        `scénario 9 : attendu 409 (rattachement devenu obsolète entre-temps), reçu ${resApprobation.status} ` +
          `(corps : ${JSON.stringify(resApprobation.body)})`,
      );
    }

    const clientVerif = new PrismaClient();
    let travailleurReel: Awaited<ReturnType<typeof clientVerif.travailleur.findUniqueOrThrow>>;
    let demandeReelle: Awaited<ReturnType<typeof clientVerif.demandeApprobation.findUniqueOrThrow>>;
    let compteNouveau: Awaited<ReturnType<typeof clientVerif.utilisateur.findFirst>>;
    let auditsTravailleur: Awaited<ReturnType<typeof clientVerif.auditLog.findMany>>;
    try {
      travailleurReel = await clientVerif.travailleur.findUniqueOrThrow({ where: { id: travailleur.id } });
      demandeReelle = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
      compteNouveau = await clientVerif.utilisateur.findFirst({ where: { email } });
      auditsTravailleur = await clientVerif.auditLog.findMany({ where: { typeEntite: "Travailleur", entiteId: travailleur.id } });
    } finally {
      await clientVerif.$disconnect();
    }
    if (travailleurReel.utilisateurId !== compteAutre.id) {
      echouer("scénario 9 : le rattachement RÉCENT (fait via l'API Travailleurs) a été écrasé — régression du correctif P1 Round 2");
    }
    if (compteNouveau) echouer("scénario 9 : AUCUN compte Administrateur n'aurait dû être créé pour cette demande devenue obsolète");
    if (demandeReelle.statut !== "EN_ATTENTE") {
      echouer(`scénario 9 : la demande aurait dû rester EN_ATTENTE (réservation annulée par le rollback), trouvé ${demandeReelle.statut}`);
    }
    if (demandeReelle.approuveParId !== null || demandeReelle.dateDecision !== null) {
      echouer("scénario 9 : aucun champ approuveParId/dateDecision n'aurait dû être committé sur cette tentative avortée");
    }
    // Correctif P1 (Round 3, contre-revue Codex du 26/08/2026) : le
    // rattachement légitime de l'étape 2 (PUT /api/travailleurs/:id) écrit
    // désormais RÉELLEMENT un AuditLog manuel transactionnel (voir Scénario
    // 10 ci-dessous) — l'assertion « zéro audit » d'avant ce correctif était
    // une absence de PREUVE (rien n'était jamais audité ici), pas une preuve
    // d'absence de problème. Corrigé : exactement UN AuditLog (celui du
    // rattachement légitime qui A RÉUSSI), jamais deux (la tentative
    // d'approbation rejetée en 409 ci-dessus ne doit, elle, en ajouter aucun).
    if (auditsTravailleur.length !== 1) {
      echouer(
        `scénario 9 : exactement 1 AuditLog Travailleur attendu (le rattachement légitime réussi de l'étape 2 ; ` +
          `la tentative d'approbation rejetée en 409 ne doit, elle, en ajouter aucun), trouvé ${auditsTravailleur.length}`,
      );
    }
    if (auditsTravailleur[0]!.apres === null || (auditsTravailleur[0]!.apres as { utilisateurId?: string }).utilisateurId !== compteAutre.id) {
      echouer("scénario 9 : l'unique AuditLog réel doit refléter le rattachement légitime (apres.utilisateurId = compteAutre.id)");
    }
    console.log(
      "  ✓ rattachement réel (PUT /api/travailleurs/:id) conservé intact ET réellement audité (1 AuditLog exact), " +
        "approbation de la demande obsolète refusée avec 409 SANS ajouter de second AuditLog, AUCUN compte Administrateur créé, " +
        "demande redevenue EN_ATTENTE (jamais approuveParId/dateDecision committés) — chemin HTTP entièrement réel, aucun " +
        "écrasement silencieux, aucune double journalisation.",
    );
  }

  console.log(
    "→ Scénario 10/10 : PUT /api/travailleurs/:id, audit manuel transactionnel du rattachement (correctif P1, Round 3, " +
      "contre-revue Codex du 26/08/2026) — updateMany n'est jamais intercepté par l'extension d'audit générale…",
  );
  {
    await reinitialiserBase();
    const roleAdmin = await creerRoleAvecPermissions(ROLE_ADMIN);
    const { jeton: jetonPrincipal } = await creerCompteConnecte("Principal S10", "principal-s10@test.local", roleAdmin.id, true, signToken);
    const compteA = await prisma.utilisateur.create({
      data: { nom: "Compte A S10", email: "compte-a-s10@test.local", roleId: roleAdmin.id, motDePasseHash: "x", actif: true },
    });
    const compteB = await prisma.utilisateur.create({
      data: { nom: "Compte B S10", email: "compte-b-s10@test.local", roleId: roleAdmin.id, motDePasseHash: "x", actif: true },
    });

    console.log("  → 10a : liaison réussie (utilisateurId null → id) — exactement 1 AuditLog exact…");
    const fiche = await prisma.travailleur.create({
      data: { nom: "Fiche S10", poste: "Boulanger", dateEmbauche: new Date("2026-01-01"), salaireMensuel: 150_000, joursTravaillesParMois: 26 },
    });
    const resLiaison = await request(app)
      .put(`/api/travailleurs/${fiche.id}`)
      .set("Authorization", `Bearer ${jetonPrincipal}`)
      .send({ utilisateurId: compteA.id });
    if (resLiaison.status !== 200) echouer(`scénario 10a : attendu 200, reçu ${resLiaison.status} (corps : ${JSON.stringify(resLiaison.body)})`);
    {
      const v = new PrismaClient();
      let audits: Awaited<ReturnType<typeof v.auditLog.findMany>>;
      try {
        audits = await v.auditLog.findMany({ where: { typeEntite: "Travailleur", entiteId: fiche.id } });
      } finally {
        await v.$disconnect();
      }
      if (audits.length !== 1) echouer(`scénario 10a : exactement 1 AuditLog attendu après la liaison, trouvé ${audits.length}`);
      const a = audits[0]!;
      if (a.action !== "MODIFICATION") echouer("scénario 10a : action attendue MODIFICATION");
      const avant = a.avant as { utilisateurId: string | null } | null;
      const apres = a.apres as { utilisateurId: string | null } | null;
      if (avant?.utilisateurId !== null) echouer("scénario 10a : avant.utilisateurId réel attendu null");
      if (apres?.utilisateurId !== compteA.id) echouer("scénario 10a : apres.utilisateurId réel attendu = compteA");
    }
    console.log("    ✓ 1 AuditLog réel exact (avant.utilisateurId=null → apres.utilisateurId=compteA), aucune double journalisation.");

    console.log("  → 10b : déliaison réussie (utilisateurId id → null) — un second AuditLog exact…");
    const resDeliaison = await request(app)
      .put(`/api/travailleurs/${fiche.id}`)
      .set("Authorization", `Bearer ${jetonPrincipal}`)
      .send({ utilisateurId: null });
    if (resDeliaison.status !== 200) echouer(`scénario 10b : attendu 200, reçu ${resDeliaison.status} (corps : ${JSON.stringify(resDeliaison.body)})`);
    {
      const v = new PrismaClient();
      let audits: Awaited<ReturnType<typeof v.auditLog.findMany>>;
      try {
        audits = await v.auditLog.findMany({ where: { typeEntite: "Travailleur", entiteId: fiche.id }, orderBy: { createdAt: "asc" } });
      } finally {
        await v.$disconnect();
      }
      if (audits.length !== 2) echouer(`scénario 10b : exactement 2 AuditLog cumulés attendus (liaison + déliaison), trouvé ${audits.length}`);
      const a = audits[1]!;
      const avant = a.avant as { utilisateurId: string | null } | null;
      const apres = a.apres as { utilisateurId: string | null } | null;
      if (avant?.utilisateurId !== compteA.id) echouer("scénario 10b : avant.utilisateurId réel attendu = compteA");
      if (apres?.utilisateurId !== null) echouer("scénario 10b : apres.utilisateurId réel attendu null");
    }
    console.log("    ✓ second AuditLog réel exact (avant.utilisateurId=compteA → apres.utilisateurId=null).");

    console.log("  → 10c : modification combinée utilisateurId + poste/salaire — un AuditLog avant/après COMPLET…");
    const resCombine = await request(app)
      .put(`/api/travailleurs/${fiche.id}`)
      .set("Authorization", `Bearer ${jetonPrincipal}`)
      .send({ utilisateurId: compteB.id, poste: "Chef boulanger", salaireMensuel: 220_000 });
    if (resCombine.status !== 200) echouer(`scénario 10c : attendu 200, reçu ${resCombine.status} (corps : ${JSON.stringify(resCombine.body)})`);
    {
      const v = new PrismaClient();
      let audits: Awaited<ReturnType<typeof v.auditLog.findMany>>;
      try {
        audits = await v.auditLog.findMany({ where: { typeEntite: "Travailleur", entiteId: fiche.id }, orderBy: { createdAt: "asc" } });
      } finally {
        await v.$disconnect();
      }
      if (audits.length !== 3) echouer(`scénario 10c : exactement 3 AuditLog cumulés attendus, trouvé ${audits.length}`);
      const a = audits[2]!;
      const avant = a.avant as { utilisateurId: string | null; poste: string; salaireMensuel: number } | null;
      const apres = a.apres as { utilisateurId: string | null; poste: string; salaireMensuel: number } | null;
      if (avant?.utilisateurId !== null || avant?.poste !== "Boulanger" || avant?.salaireMensuel !== 150_000) {
        echouer(`scénario 10c : instantané "avant" réel incomplet ou inexact : ${JSON.stringify(avant)}`);
      }
      if (apres?.utilisateurId !== compteB.id || apres?.poste !== "Chef boulanger" || apres?.salaireMensuel !== 220_000) {
        echouer(`scénario 10c : instantané "apres" réel incomplet ou inexact : ${JSON.stringify(apres)}`);
      }
    }
    console.log("    ✓ AuditLog réel unique, avant/après COMPLETS (utilisateurId ET poste ET salaireMensuel), écriture combinée atomique.");

    console.log(
      "  → 10d : course RÉELLE entre deux PUT concurrents visant la MÊME fiche libre (jamais un délai comme preuve — " +
        "verrouillage de ligne PostgreSQL réel via Promise.all sur deux vraies requêtes HTTP)…",
    );
    const ficheLibre = await prisma.travailleur.create({
      data: { nom: "Fiche Course S10", poste: "Vendeuse", dateEmbauche: new Date("2026-01-01") },
    });
    const [resCourseA, resCourseB] = await Promise.all([
      request(app).put(`/api/travailleurs/${ficheLibre.id}`).set("Authorization", `Bearer ${jetonPrincipal}`).send({ utilisateurId: compteA.id }),
      request(app).put(`/api/travailleurs/${ficheLibre.id}`).set("Authorization", `Bearer ${jetonPrincipal}`).send({ utilisateurId: compteB.id }),
    ]);
    const statuts = [resCourseA.status, resCourseB.status].sort();
    if (statuts[0] !== 200 || statuts[1] !== 409) {
      echouer(
        `scénario 10d : sur deux PUT réellement concurrents visant la même fiche libre, attendu exactement un 200 et un 409, ` +
          `reçu [${resCourseA.status}, ${resCourseB.status}]`,
      );
    }
    {
      const v = new PrismaClient();
      let ficheReelle: Awaited<ReturnType<typeof v.travailleur.findUniqueOrThrow>>;
      let audits: Awaited<ReturnType<typeof v.auditLog.findMany>>;
      try {
        ficheReelle = await v.travailleur.findUniqueOrThrow({ where: { id: ficheLibre.id } });
        audits = await v.auditLog.findMany({ where: { typeEntite: "Travailleur", entiteId: ficheLibre.id } });
      } finally {
        await v.$disconnect();
      }
      if (ficheReelle.utilisateurId !== compteA.id && ficheReelle.utilisateurId !== compteB.id) {
        echouer("scénario 10d : la fiche réelle devrait être rattachée au gagnant réel de la course (compteA OU compteB)");
      }
      // Exactement 1 AuditLog réel — celui du gagnant réel de la course
      // (déterminé en base, jamais présumé) ; le perdant (409) n'en écrit
      // AUCUN : aucun écrasement silencieux, aucune double journalisation.
      if (audits.length !== 1) {
        echouer(`scénario 10d : exactement 1 AuditLog réel attendu (le gagnant réel de la course), trouvé ${audits.length}`);
      }
      const apres = audits[0]!.apres as { utilisateurId: string | null } | null;
      if (apres?.utilisateurId !== ficheReelle.utilisateurId) {
        echouer("scénario 10d : l'unique AuditLog réel doit refléter le gagnant réel de la course (relu en base, jamais présumé)");
      }
    }
    console.log(
      "    ✓ course réellement disputée (deux vraies requêtes HTTP concurrentes, verrouillage de ligne PostgreSQL réel, jamais " +
        "un délai comme preuve) : exactement un 200 + un 409, exactement 1 AuditLog réel — celui du gagnant réel, aucun pour le " +
        "perdant, aucun écrasement silencieux.",
    );

    // Limite honnêtement documentée (même convention que le bloc R2-8 de
    // `verifier-concurrence-actions-metier-ci.ts`) : prouver, contre une
    // VRAIE base PostgreSQL et via des entrées HTTP légitimes, qu'un échec de
    // l'écriture `tx.auditLog.create` elle-même entraîne bien le rollback de
    // la modification `updateMany` qui l'a précédée dans la MÊME transaction
    // nécessiterait soit de faire échouer artificiellement cette insertion
    // précise (aucune entrée HTTP légitime ne peut violer une contrainte sur
    // `AuditLog` : `module`/`typeEntite`/`entiteId`/`action` sont tous des
    // littéraux fixés par le code, jamais dérivés du corps de la requête),
    // soit d'ajouter un crochet de test dédié à la route de production
    // (hors périmètre de ce correctif, qui ne demande aucun changement de
    // contrat public). La garantie elle-même découle directement d'une
    // primitive PostgreSQL (toute instruction qui échoue DANS une
    // transaction encore ouverte annule la transaction ENTIÈRE, y compris
    // les écritures précédentes) — jamais réimplémentée manuellement ici —
    // et le contrat OBSERVABLE (« l'appelant HTTP ne voit jamais un succès
    // pour une modification devenue non tracée ») est prouvé de façon
    // déterministe par le test mocké dédié
    // (`routes/travailleurs.audit.test.ts`, scénario « échec de l'écriture
    // d'audit »).
  }

  await reinitialiserBase();
  console.log(
    "\n✅ Vérification HTTP réelle (mission P1, Round 1 + Round 2 + Round 3 du 25-26/08/2026) : 10 scénarios (4 types × " +
      "direct/approbation, la protection contre l'écrasement du rattachement Travailleur, PLUS l'audit manuel transactionnel du " +
      "rattachement) passent contre un VRAI serveur Express + VRAIE authentification JWT + VRAIE base PostgreSQL — aucun mock " +
      "d'authentification, de service d'écriture, ou de Prisma ; toutes les écritures relues depuis une connexion Prisma " +
      "indépendante après chaque appel HTTP.\n",
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
