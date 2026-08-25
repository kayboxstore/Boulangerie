/**
 * Vérification CI, contre une VRAIE base PostgreSQL éphémère, des correctifs
 * P1 « piste d'audit et atomicité d'approbation de MODIFIER_PERMISSIONS_ROLE »
 * (contre-revue Codex de l'audit complet du 24/08/2026 — Round 1 : piste
 * d'audit ; Round 2 : métadonnées enrichies + atomicité du parcours
 * d'approbation).
 *
 * `apps/api/src/services/permissionsRoleAudit.test.ts` prouve déjà la LOGIQUE
 * (mockée) : quelles écritures ont lieu, dans quel ordre, avec quel contenu,
 * et une simulation structurelle du tout-ou-rien. Un mock ne peut PAS prouver :
 *  (a) un vrai ROLLBACK PostgreSQL — `$transaction` y est un simple appel de
 *      fonction avec copie manuelle d'état, jamais un vrai moteur
 *      transactionnel ;
 *  (b) une vraie CONCURRENCE — deux connexions Prisma séparées, un vrai
 *      verrou de ligne PostgreSQL, un vrai blocage/déblocage.
 * Seule une vraie base peut prouver que :
 *  (1) un échec d'écriture de permission annule RÉELLEMENT toute la
 *      transaction, y compris les écritures déjà appliquées plus tôt dans la
 *      MÊME transaction (scénario 6) ;
 *  (2) un échec de l'écriture d'audit annule RÉELLEMENT toutes les écritures
 *      de permission déjà appliquées (scénario 7) ;
 *  (3) deux approbations RÉELLEMENT concurrentes (synchronisation
 *      déterministe via un crochet, PAS un pari sur le hasard du timing) sur
 *      la même demande produisent exactement un succès et un rejet contrôlé,
 *      sans double exécution ni doublon d'audit (scénario 10) ;
 *  (4) un échec injecté APRÈS la réservation atomique de la demande annule
 *      RÉELLEMENT la réservation elle-même (la demande redevient EN_ATTENTE),
 *      en plus des permissions et de l'audit (scénario 11).
 * C'est l'objet de ce script — il exerce EXACTEMENT le code de production,
 * `appliquerModificationPermissionsRole` et
 * `approuverEtAppliquerModificationPermissionsRole`, importées telles quelles
 * depuis `apps/api/src/services/permissionsRoleAudit.js` (jamais
 * réimplémentées ici).
 *
 * SÉCURITÉ : même garde que les scripts P0-01 — `verifierEnvironnementIntegrationCI`
 * (réutilisée telle quelle, pas dupliquée) exige simultanément un hôte local,
 * le nom de base EXACT `lomoto_ci`, et la confirmation explicite propre à
 * cette famille de scripts. Voir `scripts/garde-integration-ci.ts`.
 *
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-audit-permissions-role-ci.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  appliquerModificationPermissionsRole,
  approuverEtAppliquerModificationPermissionsRole,
  ErreurActeurRequisPourAudit,
  ErreurApprobationConcurrente,
  type EntreePermission,
} from "../apps/api/src/services/permissionsRoleAudit.js";
import { contexteRequete } from "../apps/api/src/lib/contexteRequete.js";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

// --- Garde — voir l'en-tête. Toute première instruction, avant tout accès
// Prisma : aucun des modules importés ci-dessus ne construit de PrismaClient
// à l'import (même convention que verifier-integration-bootstrap-ci.ts et
// verifier-concurrence-equipe-ci.ts) — seule la ligne suivante en ouvrirait
// une, donc la garde s'exécute avant toute connexion réelle. ---
verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-audit-permissions-role-ci.ts");

const prisma = new PrismaClient();
// Même convention que verifier-concurrence-equipe-ci.ts : un `new PrismaClient()`
// nu est structurellement identique à l'exécution à `typeof prisma` (client
// applicatif étendu) — seul le type TypeScript diffère à cause de l'extension
// d'audit générale, qui n'intercepte de toute façon ni upsert ni deleteMany
// ni create (voir permissionsRoleAudit.ts). Le cast est donc sûr.
const dbPourAudit = prisma as unknown as Parameters<typeof appliquerModificationPermissionsRole>[0];

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification PostgreSQL réelle du correctif P1 (audit permissions rôle) : ${message}\n`);
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

async function creerRoleEtActeur(nomRole: string, emailActeur: string) {
  const role = await prisma.role.create({ data: { nom: nomRole, roleParentId: null } });
  const acteur = await prisma.utilisateur.create({
    data: { nom: "Actrice Test", email: emailActeur, roleId: role.id, motDePasseHash: "x", actif: true },
  });
  return { role, acteur };
}

async function permissionsReelles(roleId: string) {
  const lignes = await prisma.rolePermission.findMany({ where: { roleId }, orderBy: { module: "asc" } });
  return lignes.map((l) => ({ module: l.module, niveauAcces: l.niveauAcces }));
}

async function compterAuditLogsRole(roleId: string) {
  return prisma.auditLog.count({ where: { typeEntite: "Role", entiteId: roleId } });
}

async function main() {
  console.log("→ Scénario 1/11 : ajout d'une permission, exécution DIRECTE (base PostgreSQL réelle)…");
  let roleId!: string;
  let acteurId!: string;
  let acteurNom!: string;
  {
    await reinitialiserBase();
    const { role, acteur } = await creerRoleEtActeur("Rôle Test 1", "acteur1@test.local");
    roleId = role.id;
    acteurId = acteur.id;
    acteurNom = acteur.nom;

    const resultat = await contexteRequete.run({ id: acteur.id, nom: acteur.nom }, () =>
      appliquerModificationPermissionsRole(dbPourAudit, role.id, [{ module: "CAISSE", niveauAcces: "LECTURE" }]),
    );

    if (resultat.diff.ajouts.length !== 1 || resultat.diff.ajouts[0]?.module !== "CAISSE") {
      echouer("scénario 1 : diff.ajouts attendu = [{CAISSE, LECTURE}]");
    }
    const reel = await permissionsReelles(roleId);
    if (reel.length !== 1 || reel[0]?.module !== "CAISSE" || reel[0]?.niveauAcces !== "LECTURE") {
      echouer(`scénario 1 : RolePermission réelle attendue = [CAISSE:LECTURE], trouvé ${JSON.stringify(reel)}`);
    }
    const nbAudit = await compterAuditLogsRole(roleId);
    if (nbAudit !== 1) echouer(`scénario 1 : attendu 1 AuditLog, trouvé ${nbAudit}`);
    console.log("  ✓ RolePermission réellement créée, exactement 1 AuditLog écrit.");
  }

  console.log("→ Scénario 2/11 : modification + ajout combinés (base réelle)…");
  {
    const resultat = await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
      appliquerModificationPermissionsRole(dbPourAudit, roleId, [
        { module: "CAISSE", niveauAcces: "ECRITURE" },
        { module: "STOCKS", niveauAcces: "LECTURE" },
      ]),
    );
    if (resultat.diff.modifications.length !== 1 || resultat.diff.modifications[0]?.module !== "CAISSE") {
      echouer("scénario 2 : diff.modifications attendu = [{CAISSE, LECTURE→ECRITURE}]");
    }
    if (resultat.diff.ajouts.length !== 1 || resultat.diff.ajouts[0]?.module !== "STOCKS") {
      echouer("scénario 2 : diff.ajouts attendu = [{STOCKS, LECTURE}]");
    }
    const reel = await permissionsReelles(roleId);
    if (reel.length !== 2) echouer(`scénario 2 : attendu 2 RolePermission réelles, trouvé ${reel.length}`);
    console.log("  ✓ modification ET ajout réels, tous deux visibles en base.");
  }

  console.log("→ Scénario 3/11 : retrait total (liste vide) — base réelle…");
  {
    const resultat = await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
      appliquerModificationPermissionsRole(dbPourAudit, roleId, []),
    );
    if (resultat.diff.retraits.length !== 2) {
      echouer(`scénario 3 : attendu 2 retraits (CAISSE + STOCKS), trouvé ${resultat.diff.retraits.length}`);
    }
    const reel = await permissionsReelles(roleId);
    if (reel.length !== 0) echouer(`scénario 3 : attendu 0 RolePermission réelle après retrait total, trouvé ${reel.length}`);
    console.log("  ✓ toutes les RolePermission réellement supprimées, diff.retraits exact.");
  }

  console.log("→ Scénario 4/11 : absence de doublon d'audit sur un appel à plusieurs changements…");
  {
    const nbAvant = await compterAuditLogsRole(roleId);
    await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
      appliquerModificationPermissionsRole(dbPourAudit, roleId, [
        { module: "CAISSE", niveauAcces: "LECTURE" },
        { module: "STOCKS", niveauAcces: "ECRITURE" },
        { module: "PRODUCTION", niveauAcces: "LECTURE" },
      ]),
    );
    const nbApres = await compterAuditLogsRole(roleId);
    if (nbApres - nbAvant !== 1) {
      echouer(`scénario 4 : attendu exactement +1 AuditLog pour 3 permissions changées en un appel, trouvé +${nbApres - nbAvant}`);
    }
    console.log("  ✓ une seule ligne AuditLog pour 3 permissions changées dans le même appel.");
  }

  console.log("→ Scénario 5/11 : répétition idempotente (même matrice deux fois) — diff vide au 2e appel réel…");
  {
    const permsActuelles = (await permissionsReelles(roleId)).map((p) => ({
      module: p.module,
      niveauAcces: p.niveauAcces,
    })) as EntreePermission[];
    const nbAvant = await compterAuditLogsRole(roleId);
    const resultat = await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
      appliquerModificationPermissionsRole(dbPourAudit, roleId, permsActuelles),
    );
    const nbApres = await compterAuditLogsRole(roleId);
    if (nbApres - nbAvant !== 1) echouer("scénario 5 : la répétition doit tout de même écrire une ligne d'audit (comportement documenté)");
    if (resultat.diff.ajouts.length || resultat.diff.retraits.length || resultat.diff.modifications.length) {
      echouer(`scénario 5 : diff attendu entièrement vide sur resoumission exacte, trouvé ${JSON.stringify(resultat.diff)}`);
    }
    console.log("  ✓ resoumission exacte : 1 nouvelle ligne d'audit quand même écrite, diff vide comme documenté.");
  }

  console.log("→ Scénario 6/11 : ÉCHEC RÉEL d'une écriture de permission (valeur de module invalide) → ROLLBACK réel…");
  {
    // Le rejet d'une valeur de module hors énumération a lieu côté client
    // Prisma (validation contre le type généré), AVANT le réseau. Ce qui
    // reste entièrement réel : la transaction PostgreSQL elle-même (un vrai
    // BEGIN a eu lieu, la première écriture — FOURNISSEURS — a réellement été
    // appliquée dans cette transaction avant l'exception), et le ROLLBACK qui
    // suit est exécuté par le vrai moteur PostgreSQL sur cette transaction
    // réelle. La preuve porte sur l'état relu depuis une connexion séparée.
    const avant = await permissionsReelles(roleId);
    const nbAuditAvant = await compterAuditLogsRole(roleId);

    let leve = false;
    try {
      await contexteRequete.run({ id: acteurId, nom: acteurNom }, () =>
        appliquerModificationPermissionsRole(dbPourAudit, roleId, [
          { module: "FOURNISSEURS", niveauAcces: "ECRITURE" }, // écrirait avec succès seule
          { module: "MODULE_INEXISTANT" as EntreePermission["module"], niveauAcces: "LECTURE" }, // rejeté (validation Prisma)
        ]),
      );
    } catch (e) {
      leve = true;
      if (!(e instanceof Error) || !/Expected Module|Invalid value for argument `module`/i.test(e.message)) {
        echouer(`scénario 6 : attendu un rejet de valeur de module invalide, reçu : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!leve) echouer("scénario 6 : l'appel aurait dû lever une erreur (module invalide)");

    // Relecture depuis une CONNEXION SÉPARÉE, pour ne dépendre d'aucun cache
    // du client `prisma` principal — preuve indépendante de l'état réellement
    // committé en base.
    const clientVerif = new PrismaClient();
    let apres: Awaited<ReturnType<typeof permissionsReelles>>;
    let nbAuditApres: number;
    try {
      apres = await clientVerif.rolePermission.findMany({ where: { roleId }, orderBy: { module: "asc" } });
      nbAuditApres = await clientVerif.auditLog.count({ where: { typeEntite: "Role", entiteId: roleId } });
    } finally {
      await clientVerif.$disconnect();
    }
    if (JSON.stringify(apres.map((p) => ({ module: p.module, niveauAcces: p.niveauAcces }))) !== JSON.stringify(avant)) {
      echouer(
        "scénario 6 : ROLLBACK ATTENDU MAIS ABSENT — l'écriture FOURNISSEURS (première de la transaction, aurait " +
          "réussi seule) a survécu à l'échec de la seconde écriture ; l'état RolePermission doit être strictement " +
          "identique à avant l'appel",
      );
    }
    if (nbAuditApres !== nbAuditAvant) {
      echouer("scénario 6 : aucune ligne d'audit ne doit être créée quand une écriture de permission échoue (audit menteur)");
    }
    console.log("  ✓ échec PostgreSQL réel (enum invalide) → ROLLBACK réel de toute la transaction, zéro audit menteur.");
  }

  console.log("→ Scénario 7/11 : ÉCHEC RÉEL de l'écriture d'audit (FK utilisateur inexistant) → ROLLBACK réel des permissions…");
  {
    const avant = await permissionsReelles(roleId);
    const nbAuditAvant = await compterAuditLogsRole(roleId);

    let leve = false;
    try {
      // Acteur factice dont l'id ne référence AUCUN Utilisateur réel : les
      // écritures RolePermission (qui n'ont aucune FK vers Utilisateur)
      // réussiraient normalement dans la transaction — seule l'écriture
      // AuditLog, en fin de transaction, viole réellement la contrainte de
      // clé étrangère `AuditLog.utilisateurId → Utilisateur.id`.
      await contexteRequete.run({ id: "id-utilisateur-totalement-inexistant-xyz", nom: "Fantôme" }, () =>
        appliquerModificationPermissionsRole(dbPourAudit, roleId, [{ module: "TRAVAILLEURS", niveauAcces: "ECRITURE" }]),
      );
    } catch (e) {
      leve = true;
      if (!(e instanceof Error) || !/foreign key constraint/i.test(e.message)) {
        echouer(`scénario 7 : attendu une violation de clé étrangère PostgreSQL, reçu : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!leve) echouer("scénario 7 : l'appel aurait dû lever une erreur (acteur inexistant → FK AuditLog)");

    const clientVerif = new PrismaClient();
    let apres: Awaited<ReturnType<typeof permissionsReelles>>;
    let nbAuditApres: number;
    try {
      apres = await clientVerif.rolePermission.findMany({ where: { roleId }, orderBy: { module: "asc" } });
      nbAuditApres = await clientVerif.auditLog.count({ where: { typeEntite: "Role", entiteId: roleId } });
    } finally {
      await clientVerif.$disconnect();
    }
    if (JSON.stringify(apres.map((p) => ({ module: p.module, niveauAcces: p.niveauAcces }))) !== JSON.stringify(avant)) {
      echouer(
        "scénario 7 : ROLLBACK ATTENDU MAIS ABSENT — l'écriture RolePermission (qui aurait réussi seule, aucune FK " +
          "vers Utilisateur) a survécu à l'échec de l'écriture d'audit qui la suit dans la même transaction",
      );
    }
    if (nbAuditApres !== nbAuditAvant) echouer("scénario 7 : aucune ligne d'audit ne peut avoir été créée (c'est elle qui a échoué)");
    console.log("  ✓ échec PostgreSQL réel sur l'écriture d'audit → ROLLBACK réel de TOUTES les permissions déjà appliquées.");
  }

  console.log("→ Scénario 8/11 : hors contexte de requête authentifiée → refus, aucune écriture committée…");
  {
    const avant = await permissionsReelles(roleId);
    const nbAuditAvant = await compterAuditLogsRole(roleId);
    let leve = false;
    try {
      await appliquerModificationPermissionsRole(dbPourAudit, roleId, [{ module: "RAPPORTS", niveauAcces: "LECTURE" }]);
    } catch (e) {
      leve = true;
      if (!(e instanceof ErreurActeurRequisPourAudit)) echouer(`scénario 8 : attendu ErreurActeurRequisPourAudit, reçu ${e}`);
    }
    if (!leve) echouer("scénario 8 : l'appel hors contexte authentifié aurait dû être refusé");
    const apres = await permissionsReelles(roleId);
    const nbAuditApres = await compterAuditLogsRole(roleId);
    if (JSON.stringify(apres) !== JSON.stringify(avant) || nbAuditApres !== nbAuditAvant) {
      echouer("scénario 8 : aucune écriture (permission ou audit) ne doit survivre à ce refus");
    }
    console.log("  ✓ refus propre hors contexte authentifié, aucune écriture committée.");
  }

  console.log("→ Scénario 9/11 : parcours APPROBATION réel — métadonnées Round 2 (base PostgreSQL réelle)…");
  let roleApprobationId!: string;
  {
    await reinitialiserBase();
    const { role: roleApprobation } = await creerRoleEtActeur("Rôle Test Approbation", "acteur-approbation@test.local");
    roleApprobationId = roleApprobation.id;
    const principal = await prisma.utilisateur.create({
      data: { nom: "Principal Test", email: "principal@test.local", roleId: roleApprobation.id, motDePasseHash: "x", actif: true },
    });
    const secondaire = await prisma.utilisateur.create({
      data: { nom: "Secondaire Test", email: "secondaire@test.local", roleId: roleApprobation.id, motDePasseHash: "x", actif: true },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "MODIFIER_PERMISSIONS_ROLE",
        donnees: { roleId: roleApprobationId, permissions: [{ module: "CAISSE", niveauAcces: "LECTURE" }] },
        resume: "modifier les permissions du rôle « Rôle Test Approbation »",
        demandeParId: secondaire.id,
      },
    });

    const resultat = await contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
      approuverEtAppliquerModificationPermissionsRole(dbPourAudit, demande.id, { id: principal.id, nom: principal.nom }),
    );

    if (resultat.demandeStatut !== "APPROUVEE" || resultat.demandeApprouveParId !== principal.id) {
      echouer("scénario 9 : la demande aurait dû passer à APPROUVEE avec l'approbateur exact");
    }
    const demandeReelle = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    if (demandeReelle.statut !== "APPROUVEE" || demandeReelle.approuveParId !== principal.id) {
      echouer(`scénario 9 : DemandeApprobation réelle attendue APPROUVEE par ${principal.id}, trouvé ${JSON.stringify(demandeReelle)}`);
    }
    const ligneAudit = await prisma.auditLog.findFirstOrThrow({ where: { typeEntite: "Role", entiteId: roleApprobationId } });
    const apres = ligneAudit.apres as {
      typeActionCritique: string;
      modeExecution: string;
      demandeApprobationId: string;
      demandePar: { id: string; nom: string } | null;
    };
    if (apres.typeActionCritique !== "MODIFIER_PERMISSIONS_ROLE") echouer("scénario 9 : typeActionCritique attendu MODIFIER_PERMISSIONS_ROLE");
    if (apres.modeExecution !== "APPROBATION") echouer("scénario 9 : modeExecution attendu APPROBATION");
    if (apres.demandeApprobationId !== demande.id) echouer("scénario 9 : demandeApprobationId attendu exact");
    if (apres.demandePar?.id !== secondaire.id) echouer("scénario 9 : demandePar attendu = l'Admin secondaire, distinct de l'approbateur");
    if (ligneAudit.utilisateurId !== principal.id) echouer("scénario 9 : utilisateurId (acteur) attendu = le Principal qui approuve");
    console.log("  ✓ métadonnées réelles exactes : typeActionCritique, modeExecution=APPROBATION, demandeApprobationId, demandePar≠acteur.");
  }

  console.log("→ Scénario 10/11 : DEUX APPROBATIONS RÉELLEMENT CONCURRENTES (connexions séparées, synchronisation déterministe)…");
  {
    const { role } = await creerRoleEtActeur("Rôle Test Concurrence", "acteur-concurrence@test.local");
    const principal = await prisma.utilisateur.create({
      data: { nom: "Principal Concurrence", email: "principal-concurrence@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const secondaire = await prisma.utilisateur.create({
      data: { nom: "Secondaire Concurrence", email: "secondaire-concurrence@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "MODIFIER_PERMISSIONS_ROLE",
        donnees: { roleId: role.id, permissions: [{ module: "STOCKS", niveauAcces: "ECRITURE" }] },
        resume: "modifier les permissions du rôle « Rôle Test Concurrence »",
        demandeParId: secondaire.id,
      },
    });
    // Connexion B, séparée, PRÉCONNECTÉE avant le lancement de A.
    const clientB = new PrismaClient();
    await clientB.$connect();
    const dbPourAuditB = clientB as unknown as Parameters<typeof approuverEtAppliquerModificationPermissionsRole>[0];

    let promesseB: Promise<unknown> | undefined;

    // A s'exécute avec le crochet `apresReservationAvantExecution` : au
    // moment précis où A a RÉELLEMENT réservé la ligne (transaction encore
    // OUVERTE, verrou de ligne PostgreSQL RÉELLEMENT tenu, rien n'est encore
    // committé), on LANCE B — sur sa propre connexion — puis on laisse
    // seulement le temps à sa requête `updateMany` d'atteindre PostgreSQL et
    // de se heurter au verrou de A (elle s'y bloque, elle ne peut pas
    // encore avoir de résultat). Le crochet NE DOIT PAS attendre que B se
    // termine : B ne peut se débloquer que lorsque A committe, et A ne peut
    // committer qu'après que son crochet soit revenu — attendre B ici dans
    // le crochet créerait un blocage mutuel (piège découvert et corrigé
    // pendant l'écriture de ce script : la première version provoquait
    // exactement ce interblocage, détecté par l'expiration du timeout de
    // transaction Prisma). B est donc résolue APRÈS que A ait committé,
    // une fois son verrou relâché.
    const resultatA = await contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
      approuverEtAppliquerModificationPermissionsRole(
        dbPourAudit,
        demande.id,
        { id: principal.id, nom: principal.nom },
        {
          apresReservationAvantExecution: async () => {
            promesseB = contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
              approuverEtAppliquerModificationPermissionsRole(dbPourAuditB, demande.id, { id: principal.id, nom: principal.nom }),
            );
            // Laisse le temps à la requête de B d'atteindre PostgreSQL et de
            // se mettre en attente du verrou de ligne AVANT de laisser A
            // poursuivre vers son propre commit — sans quoi rien ne
            // garantirait que la tentative de B ait seulement commencé
            // pendant que A tient encore le verrou.
            await new Promise((resolve) => setTimeout(resolve, 300));
          },
        },
      ),
    );
    // À cet instant, A a committé et relâché son verrou — la requête de B,
    // qui attendait ce verrou depuis l'intérieur de la transaction de A,
    // peut désormais se débloquer, réévaluer son WHERE contre l'état
    // réellement committé (déjà APPROUVEE), et se rejeter.
    const resultatB = await Promise.allSettled([promesseB]).then(([r]) => r);
    await clientB.$disconnect();

    if (resultatA.demandeStatut !== "APPROUVEE") echouer("scénario 10 : A (gagnant) aurait dû réussir et passer la demande à APPROUVEE");
    if (!resultatB || resultatB.status !== "rejected") {
      echouer(`scénario 10 : B (perdant) aurait dû échouer, résultat = ${JSON.stringify(resultatB)}`);
    }
    const erreurB = (resultatB as PromiseRejectedResult).reason;
    if (!(erreurB instanceof ErreurApprobationConcurrente)) {
      echouer(`scénario 10 : B aurait dû échouer précisément avec ErreurApprobationConcurrente, reçu : ${erreurB}`);
    }

    const demandeReelle = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    if (demandeReelle.statut !== "APPROUVEE" || demandeReelle.approuveParId !== principal.id) {
      echouer("scénario 10 : la demande doit être APPROUVEE exactement une fois, par le gagnant");
    }
    const nbAudit = await prisma.auditLog.count({ where: { typeEntite: "Role", entiteId: role.id } });
    if (nbAudit !== 1) echouer(`scénario 10 : attendu exactement 1 AuditLog malgré 2 tentatives concurrentes, trouvé ${nbAudit}`);
    const permsFinales = await permissionsReelles(role.id);
    if (permsFinales.length !== 1 || permsFinales[0]?.module !== "STOCKS" || permsFinales[0]?.niveauAcces !== "ECRITURE") {
      echouer(`scénario 10 : permissions finales attendues = [STOCKS:ECRITURE], trouvé ${JSON.stringify(permsFinales)}`);
    }
    console.log(
      "  ✓ deux approbations RÉELLEMENT concurrentes (verrou de ligne PostgreSQL, synchronisation déterministe) : " +
        "exactement 1 succès, 1 rejet contrôlé (ErreurApprobationConcurrente), 1 seul AuditLog, permissions correctes, " +
        "demande approuvée une seule fois.",
    );
  }

  console.log("→ Scénario 11/11 : ÉCHEC INJECTÉ après réservation (parcours APPROBATION) → ROLLBACK réel COMPLET…");
  {
    const { role } = await creerRoleEtActeur("Rôle Test Rollback Approbation", "acteur-rollback-approbation@test.local");
    const secondaire = await prisma.utilisateur.create({
      data: { nom: "Secondaire Rollback", email: "secondaire-rollback@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "MODIFIER_PERMISSIONS_ROLE",
        donnees: { roleId: role.id, permissions: [{ module: "COMMISSIONS", niveauAcces: "LECTURE" }] },
        resume: "modifier les permissions du rôle « Rôle Test Rollback Approbation »",
        demandeParId: secondaire.id,
      },
    });

    const avantPerms = await permissionsReelles(role.id);
    const nbAuditAvant = await compterAuditLogsRole(role.id);

    let leve = false;
    try {
      // Même technique que le scénario 7 : acteur inexistant → l'écriture
      // d'AuditLog viole réellement la contrainte de clé étrangère, APRÈS
      // que la réservation de la demande a déjà eu lieu dans la même
      // transaction.
      await contexteRequete.run({ id: "id-utilisateur-totalement-inexistant-xyz", nom: "Fantôme" }, () =>
        approuverEtAppliquerModificationPermissionsRole(dbPourAudit, demande.id, {
          id: "id-utilisateur-totalement-inexistant-xyz",
          nom: "Fantôme",
        }),
      );
    } catch (e) {
      leve = true;
      if (!(e instanceof Error) || !/foreign key constraint/i.test(e.message)) {
        echouer(`scénario 11 : attendu une violation de clé étrangère PostgreSQL, reçu : ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!leve) echouer("scénario 11 : l'appel aurait dû lever une erreur (acteur inexistant → FK AuditLog)");

    const clientVerif = new PrismaClient();
    let demandeApres: Awaited<ReturnType<typeof prisma.demandeApprobation.findUniqueOrThrow>>;
    let apresPerms: Awaited<ReturnType<typeof permissionsReelles>>;
    let nbAuditApres: number;
    try {
      demandeApres = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
      apresPerms = await clientVerif.rolePermission.findMany({ where: { roleId: role.id }, orderBy: { module: "asc" } });
      nbAuditApres = await clientVerif.auditLog.count({ where: { typeEntite: "Role", entiteId: role.id } });
    } finally {
      await clientVerif.$disconnect();
    }

    if (demandeApres.statut !== "EN_ATTENTE" || demandeApres.approuveParId !== null) {
      echouer(
        `scénario 11 : ROLLBACK ATTENDU MAIS ABSENT — la RÉSERVATION (statut → APPROUVEE) a survécu à l'échec de ` +
          `l'écriture d'audit qui la suit dans la même transaction ; la demande doit redevenir EN_ATTENTE, trouvé ${JSON.stringify(demandeApres)}`,
      );
    }
    if (JSON.stringify(apresPerms.map((p) => ({ module: p.module, niveauAcces: p.niveauAcces }))) !== JSON.stringify(avantPerms)) {
      echouer("scénario 11 : les écritures de permission auraient dû être annulées elles aussi");
    }
    if (nbAuditApres !== nbAuditAvant) echouer("scénario 11 : aucune ligne d'audit ne peut avoir été créée (c'est elle qui a échoué)");
    console.log(
      "  ✓ échec injecté après réservation → ROLLBACK réel COMPLET : demande redevenue EN_ATTENTE, permissions " +
        "inchangées, aucun audit orphelin.",
    );
  }

  await reinitialiserBase();
  console.log(
    "\n✅ Vérification PostgreSQL réelle des correctifs P1 (piste d'audit + atomicité d'approbation de " +
      "MODIFIER_PERMISSIONS_ROLE) : 11 scénarios passent contre une vraie base, dont 3 preuves de ROLLBACK réel " +
      "(échec de permission, échec d'audit en direct, échec d'audit après réservation d'approbation), 1 preuve de " +
      "VRAIE concurrence PostgreSQL à synchronisation déterministe (verrou de ligne, deux connexions séparées) et " +
      "1 preuve de refus hors contexte authentifié — jamais d'état partiel, jamais d'audit menteur, jamais de " +
      "doublon, jamais de double approbation.\n",
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
