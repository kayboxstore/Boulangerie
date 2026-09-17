/**
 * Vérification CI, contre une VRAIE base PostgreSQL éphémère ET un VRAI
 * serveur HTTP Express (via `supertest`), du parcours COMPLET de
 * `MODIFIER_PERMISSIONS_ROLE` — correctif P2-01, Round 3, contre-revue Codex
 * du 24/08/2026 (« Test de route du parcours direct » / « Test de route du
 * parcours avec approbation » avaient déjà des équivalents MOCKÉS —
 * `apps/api/src/routes/roles.permissions.test.ts` et
 * `apps/api/src/routes/approbations.permissionsRole.test.ts` — mais ceux-ci
 * mockent `../lib/prisma.js` ET la fonction de service la plus profonde
 * (`appliquerModificationPermissionsRole` /
 * `approuverEtAppliquerModificationPermissionsRole`) : ils prouvent le
 * CÂBLAGE de la route (bons arguments, bon aiguillage, bons codes HTTP), pas
 * le parcours PERSISTANT complet — aucune écriture Prisma n'y est réelle).
 *
 * Défaut visé : prétendre qu'un « test de route HTTP » couvre le correctif
 * P1 (audit + atomicité de `MODIFIER_PERMISSIONS_ROLE`) alors que le service
 * d'écriture et Prisma sont mockés ne prouve RIEN sur la persistance réelle —
 * ni que les permissions sont VRAIMENT écrites en base, ni que l'AuditLog
 * relu APRÈS coup porte VRAIMENT l'acteur exact de la requête HTTP (identité
 * qui transite par `contexteRequete`, un `AsyncLocalStorage` peuplé par le
 * VRAI middleware `requireAuth` — un mock d'authentification pourrait très
 * bien omettre cette étape sans qu'aucun test mocké ne le remarque).
 *
 * Ce script-ci exerce le VRAI routeur Express (`rolesRouter`,
 * `approbationsRouter`, tels qu'importés depuis le code de production, jamais
 * réimplémentés), servi par un VRAI serveur `supertest`, avec une VRAIE
 * authentification JWT — un jeton RÉELLEMENT signé (`signToken`, même module
 * que la route `/api/auth/connexion`) pour un VRAI `Utilisateur` en base,
 * dont le VRAI `requireAuth` (`middleware/auth.ts`) vérifie la signature, la
 * session (`sessionActuelleId`), charge le VRAI DTO utilisateur, ET peuple
 * `contexteRequete` — EXACTEMENT comme en production. Aucun mock
 * d'authentification n'a donc été nécessaire ; ce script n'« adapte » rien à
 * `contexteRequete`, il laisse le code de production le peupler lui-même.
 *
 * Deux parcours vérifiés, chacun avec relecture Prisma indépendante APRÈS la
 * réponse HTTP (jamais une confiance aveugle dans le corps de la réponse) :
 *  - DIRECT (Admin Principal) : `PUT /api/roles/:id/permissions` → 200,
 *    RolePermission RÉELLEMENT écrite, AuditLog RÉELLEMENT relu avec l'acteur
 *    exact, `typeActionCritique = MODIFIER_PERMISSIONS_ROLE`,
 *    `modeExecution = DIRECTE`, `demandeApprobationId = null`.
 *  - APPROBATION (Admin secondaire soumet, Admin Principal approuve) :
 *    `PUT /api/roles/:id/permissions` (secondaire) → 202 + une VRAIE
 *    `DemandeApprobation` créée en base, puis
 *    `POST /api/approbations/:id/approuver` (Principal) → 200,
 *    RolePermission/DemandeApprobation/AuditLog RÉELLEMENT relus : acteur =
 *    Principal, demandeur = secondaire (distincts), id de demande exact,
 *    `modeExecution = APPROBATION`.
 *
 * SÉCURITÉ : même garde que les autres scripts d'intégration —
 * `verifierEnvironnementIntegrationCI` (réutilisée telle quelle) exige
 * simultanément un hôte local, le nom de base EXACT `lomoto_ci`, et la
 * confirmation explicite propre à cette famille de scripts. Voir
 * `scripts/garde-integration-ci.ts`.
 *
 * IMPORTANT — imports DYNAMIQUES : `apps/api/src/lib/prisma.js` construit son
 * `PrismaClient` DÈS SON CHARGEMENT (au niveau module, pas dans une fonction
 * exportée) — et `routes/roles.js` / `routes/approbations.js` l'importent
 * tous deux statiquement. Un `import` STATIQUE de ces routeurs en haut de ce
 * fichier ouvrirait donc une connexion AVANT que la garde ci-dessous ne
 * s'exécute (les imports ES sont résolus avant le corps du module). D'où le
 * `await import(...)` DYNAMIQUE de ces modules, APRÈS la garde — même
 * convention que documentée dans `verifier-integration-bootstrap-ci.ts` pour
 * `prisma/bootstrap-production.ts`.
 *
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-http-permissions-role-ci.ts
 */
import { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

// --- Garde — voir l'en-tête. Toute première instruction, avant tout accès
// Prisma. `express`/`supertest` n'ouvrent aucune connexion Prisma ; seuls les
// imports dynamiques plus bas (après la garde) chargent du code touchant
// Prisma. ---
verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-http-permissions-role-ci.ts");

const prisma = new PrismaClient();

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification HTTP réelle du correctif P2-01 (audit permissions rôle) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function reinitialiserBase() {
  await prisma.auditLog.deleteMany();
  await prisma.demandeApprobation.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.utilisateur.deleteMany();
  await prisma.role.deleteMany();
}

async function creerRoleAdministrateurAvecEquipeEcriture(nom: string) {
  const role = await prisma.role.create({ data: { nom, roleParentId: null } });
  await prisma.rolePermission.create({ data: { roleId: role.id, module: "EQUIPE", niveauAcces: "ECRITURE" } });
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
  // --- Imports dynamiques, APRÈS la garde — voir l'en-tête. ---
  const { rolesRouter } = await import("../apps/api/src/routes/roles.js");
  const { approbationsRouter } = await import("../apps/api/src/routes/approbations.js");
  const { signToken } = await import("../apps/api/src/lib/jwt.js");

  const app = express();
  app.use(express.json());
  app.use("/api/roles", rolesRouter);
  app.use("/api/approbations", approbationsRouter);

  await reinitialiserBase();

  console.log("→ Scénario 1/2 : parcours DIRECT réel — PUT /api/roles/:id/permissions (Admin Principal, VRAI HTTP)…");
  {
    const roleAdmin = await creerRoleAdministrateurAvecEquipeEcriture("Administrateur");
    const { utilisateur: principal, jeton: jetonPrincipal } = await creerCompteConnecte(
      "Principal HTTP",
      "principal-http@test.local",
      roleAdmin.id,
      true,
      signToken,
    );
    const roleCible = await prisma.role.create({ data: { nom: "Rôle Cible Direct", roleParentId: null } });

    const res = await request(app)
      .put(`/api/roles/${roleCible.id}/permissions`)
      .set("Authorization", `Bearer ${jetonPrincipal}`)
      .send({ permissions: [{ module: "CAISSE", niveauAcces: "LECTURE" }] });

    if (res.status !== 200) echouer(`scénario 1 : attendu 200, reçu ${res.status} (corps : ${JSON.stringify(res.body)})`);
    if (res.body.statut !== "execute") echouer(`scénario 1 : statut de réponse attendu "execute", reçu ${JSON.stringify(res.body)}`);

    // Relecture Prisma INDÉPENDANTE de la réponse HTTP — via une connexion
    // séparée, pour ne dépendre d'aucun cache du client ayant servi la route.
    const clientVerif = new PrismaClient();
    let permsReelles: Awaited<ReturnType<typeof clientVerif.rolePermission.findMany>>;
    let ligneAudit: Awaited<ReturnType<typeof clientVerif.auditLog.findFirstOrThrow>>;
    try {
      permsReelles = await clientVerif.rolePermission.findMany({ where: { roleId: roleCible.id } });
      ligneAudit = await clientVerif.auditLog.findFirstOrThrow({ where: { typeEntite: "Role", entiteId: roleCible.id } });
    } finally {
      await clientVerif.$disconnect();
    }

    if (permsReelles.length !== 1 || permsReelles[0]?.module !== "CAISSE" || permsReelles[0]?.niveauAcces !== "LECTURE") {
      echouer(`scénario 1 : RolePermission réelle attendue = [CAISSE:LECTURE], trouvé ${JSON.stringify(permsReelles)}`);
    }
    if (ligneAudit.utilisateurId !== principal.id) {
      echouer(`scénario 1 : acteur de l'AuditLog attendu = le Principal authentifié (${principal.id}), trouvé ${ligneAudit.utilisateurId}`);
    }
    const apres = ligneAudit.apres as {
      typeActionCritique: string;
      modeExecution: string;
      demandeApprobationId: string | null;
    };
    if (apres.typeActionCritique !== "MODIFIER_PERMISSIONS_ROLE") echouer("scénario 1 : typeActionCritique attendu MODIFIER_PERMISSIONS_ROLE");
    if (apres.modeExecution !== "DIRECTE") echouer(`scénario 1 : modeExecution attendu DIRECTE, trouvé ${apres.modeExecution}`);
    if (apres.demandeApprobationId !== null) echouer("scénario 1 : demandeApprobationId attendu null (parcours direct)");
    console.log(
      "  ✓ parcours HTTP DIRECT entièrement réel (JWT réel, requireAuth réel, routeur réel, Prisma réel) : " +
        "RolePermission réellement écrite, AuditLog réellement relu avec l'acteur exact et les métadonnées exactes.",
    );
  }

  // Réinitialisation OBLIGATOIRE entre les deux scénarios : un index unique
  // PARTIEL PostgreSQL (`Utilisateur_admin_principal_unique`, défini en SQL
  // brut dans la migration — jamais représentable dans schema.prisma, donc
  // jamais recréé par un simple `prisma db push`) garantit au plus UN
  // `estAdminPrincipal = true` en base. Sans cette réinitialisation, créer un
  // second Principal pour le scénario 2 violerait réellement cette
  // contrainte (P2002) — découvert en CI (migrations réelles appliquées),
  // pas localement avec `db push` (qui ignore cet index, absent du schéma
  // déclaratif).
  await reinitialiserBase();

  console.log("→ Scénario 2/2 : parcours APPROBATION réel — soumission par un secondaire, approbation par le Principal (VRAI HTTP)…");
  {
    const roleAdmin = await creerRoleAdministrateurAvecEquipeEcriture("Administrateur Approbation");
    const { utilisateur: principal, jeton: jetonPrincipal } = await creerCompteConnecte(
      "Principal HTTP Approbation",
      "principal-http-approbation@test.local",
      roleAdmin.id,
      true,
      signToken,
    );
    const { utilisateur: secondaire, jeton: jetonSecondaire } = await creerCompteConnecte(
      "Secondaire HTTP",
      "secondaire-http@test.local",
      roleAdmin.id,
      false,
      signToken,
    );
    const roleCible = await prisma.role.create({ data: { nom: "Rôle Cible Approbation", roleParentId: null } });

    // 1) Le secondaire soumet RÉELLEMENT la modification via la route HTTP.
    const resSoumission = await request(app)
      .put(`/api/roles/${roleCible.id}/permissions`)
      .set("Authorization", `Bearer ${jetonSecondaire}`)
      .send({ permissions: [{ module: "STOCKS", niveauAcces: "ECRITURE" }] });

    if (resSoumission.status !== 202) {
      echouer(`scénario 2 : soumission attendue 202 (mise en attente), reçu ${resSoumission.status} (corps : ${JSON.stringify(resSoumission.body)})`);
    }

    // La réponse de soumission ne porte pas l'id de la demande (comportement
    // de production inchangé, `ResultatActionCritique`) — relu directement
    // depuis PostgreSQL, exactement comme le ferait l'écran de file
    // d'attente de l'Admin Principal (`GET /api/approbations`).
    const demandeReelle = await prisma.demandeApprobation.findFirstOrThrow({
      where: { type: "MODIFIER_PERMISSIONS_ROLE", demandeParId: secondaire.id, statut: "EN_ATTENTE" },
    });

    // 2) Le Principal approuve RÉELLEMENT cette demande via la route HTTP.
    const resApprobation = await request(app)
      .post(`/api/approbations/${demandeReelle.id}/approuver`)
      .set("Authorization", `Bearer ${jetonPrincipal}`)
      .send({});

    if (resApprobation.status !== 200) {
      echouer(`scénario 2 : approbation attendue 200, reçu ${resApprobation.status} (corps : ${JSON.stringify(resApprobation.body)})`);
    }
    if (resApprobation.body.demande?.id !== demandeReelle.id) {
      echouer(`scénario 2 : id de demande dans la réponse attendu exact (${demandeReelle.id}), reçu ${resApprobation.body.demande?.id}`);
    }
    if (resApprobation.body.demande?.statut !== "APPROUVEE") echouer("scénario 2 : statut de réponse attendu APPROUVEE");
    if (resApprobation.body.demande?.approuvePar?.id !== principal.id) echouer("scénario 2 : approuvePar attendu = le Principal exact");
    if (resApprobation.body.demande?.demandePar?.id !== secondaire.id) echouer("scénario 2 : demandePar attendu = le secondaire exact");

    // Relecture Prisma INDÉPENDANTE, connexion séparée.
    const clientVerif = new PrismaClient();
    let permsReelles: Awaited<ReturnType<typeof clientVerif.rolePermission.findMany>>;
    let demandeApres: Awaited<ReturnType<typeof clientVerif.demandeApprobation.findUniqueOrThrow>>;
    let ligneAudit: Awaited<ReturnType<typeof clientVerif.auditLog.findFirstOrThrow>>;
    try {
      permsReelles = await clientVerif.rolePermission.findMany({ where: { roleId: roleCible.id } });
      demandeApres = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demandeReelle.id } });
      ligneAudit = await clientVerif.auditLog.findFirstOrThrow({ where: { typeEntite: "Role", entiteId: roleCible.id } });
    } finally {
      await clientVerif.$disconnect();
    }

    if (permsReelles.length !== 1 || permsReelles[0]?.module !== "STOCKS" || permsReelles[0]?.niveauAcces !== "ECRITURE") {
      echouer(`scénario 2 : RolePermission réelle attendue = [STOCKS:ECRITURE], trouvé ${JSON.stringify(permsReelles)}`);
    }
    if (demandeApres.statut !== "APPROUVEE" || demandeApres.approuveParId !== principal.id) {
      echouer(`scénario 2 : DemandeApprobation réelle attendue APPROUVEE par le Principal, trouvé ${JSON.stringify(demandeApres)}`);
    }
    // Acteur de l'AuditLog = celui qui a APPROUVÉ (le Principal), jamais le
    // demandeur d'origine — preuve que `contexteRequete`, peuplé par le VRAI
    // `requireAuth` sur CETTE requête HTTP précise (celle du Principal), a
    // bien porté l'identité exacte de l'appelant jusqu'à l'écriture Prisma.
    if (ligneAudit.utilisateurId !== principal.id) {
      echouer(`scénario 2 : acteur de l'AuditLog attendu = le Principal (${principal.id}), trouvé ${ligneAudit.utilisateurId}`);
    }
    if (ligneAudit.utilisateurId === secondaire.id) {
      echouer("scénario 2 : l'AuditLog ne doit JAMAIS porter l'identité du demandeur d'origine comme acteur");
    }
    const apres = ligneAudit.apres as {
      typeActionCritique: string;
      modeExecution: string;
      demandeApprobationId: string;
      demandePar: { id: string; nom: string } | null;
    };
    if (apres.typeActionCritique !== "MODIFIER_PERMISSIONS_ROLE") echouer("scénario 2 : typeActionCritique attendu MODIFIER_PERMISSIONS_ROLE");
    if (apres.modeExecution !== "APPROBATION") echouer(`scénario 2 : modeExecution attendu APPROBATION, trouvé ${apres.modeExecution}`);
    if (apres.demandeApprobationId !== demandeReelle.id) echouer("scénario 2 : demandeApprobationId attendu exact");
    if (apres.demandePar?.id !== secondaire.id) echouer("scénario 2 : demandePar attendu = le secondaire exact, distinct de l'acteur");
    console.log(
      "  ✓ parcours HTTP APPROBATION entièrement réel (deux VRAIS JWT, requireAuth réel pour CHAQUE requête, " +
        "routeurs réels, Prisma réel) : DemandeApprobation réellement créée puis réellement approuvée, " +
        "RolePermission réellement écrite, AuditLog réellement relu avec l'acteur exact (Principal, jamais le " +
        "demandeur), demandeApprobationId et demandePar exacts.",
    );
  }

  await reinitialiserBase();
  console.log(
    "\n✅ Vérification HTTP réelle du correctif P2-01 : 2 parcours (direct, approbation) passent contre un VRAI " +
      "serveur Express + VRAIE authentification JWT + VRAIE base PostgreSQL — aucun mock d'authentification, de " +
      "service d'écriture, ou de Prisma ; RolePermission et AuditLog systématiquement relus depuis une connexion " +
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
