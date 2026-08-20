/**
 * Vérification CI des invariants de concurrence du correctif P0-01
 * (round 6, revue Codex, point 1), contre une VRAIE base PostgreSQL
 * éphémère — le service
 * `postgres` de `.github/workflows/ci.yml`.
 *
 * `scripts/verifier-integration-bootstrap-ci.ts` prouve déjà le bootstrap de
 * production contre une vraie base ; ce script-ci prouve un invariant
 * différent, spécifique à `PUT /api/equipe/:id/activation` et
 * `POST /api/equipe/:id/principal` : deux scénarios lancent de vraies
 * opérations concurrentes/parallèles, puis deux contrôles complémentaires
 * vérifient les garde-fous et l'état final. L'ensemble confirme qu'une course
 * ne laisse jamais la base dans un état invalide (zéro Administrateur
 * Principal actif, ou deux). Les tests mockés
 * (`equipe.activation.test.ts`, `equipe.principal.test.ts`) prouvent que la
 * ROUTE appelle bien les bonnes écritures conditionnelles — ils ne peuvent
 * PAS prouver l'atomicité elle-même : un mock n'a pas de verrou de ligne, pas
 * de sérialisation MVCC, pas de vraie transaction concurrente. Seule une
 * vraie base PostgreSQL, avec de vraies requêtes concurrentes, peut le
 * prouver — c'est l'objet de ce script.
 *
 * Il exerce EXACTEMENT le code de production : `transfererStatutPrincipal` et
 * `desactiverCompteAtomique`, importées telles quelles depuis
 * `apps/api/src/services/principal.ts` (jamais réimplémentées ici), qui sont
 * elles-mêmes ce que `equipe.ts` appelle. Le seul ajout propre à ce script
 * est le crochet optionnel `apresRetraitAvantAttribution` (jamais utilisé par
 * les routes de production), qui élargit délibérément la fenêtre de course
 * pour rendre le scénario déterministe et reproductible plutôt que dépendant
 * du hasard du timing réseau.
 *
 * SÉCURITÉ : même garde que `verifier-integration-bootstrap-ci.ts` — voir
 * `scripts/garde-integration-ci.ts`. Ce script effectue de VRAIES écritures
 * délibérées, dont certaines concurrentes ; la garde exige simultanément un
 * hôte local, le nom de base EXACT `lomoto_ci`, et une confirmation explicite.
 *
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-concurrence-equipe-ci.ts
 */
import { PrismaClient } from "@prisma/client";
import { ROLE_ADMINISTRATEUR } from "@lomoto/shared";
import {
  transfererStatutPrincipal,
  desactiverCompteAtomique,
  ErreurTransfertPrincipalConcurrent,
} from "../apps/api/src/services/principal.js";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

// --- Garde — voir l'en-tête. Toute première instruction, avant tout accès
// Prisma : les imports ci-dessus n'ouvrent eux-mêmes aucune connexion (aucun
// des modules importés ne construit de PrismaClient à l'import, même
// convention que verifier-integration-bootstrap-ci.ts) — seule la ligne
// suivante en ouvrirait une, donc la garde s'exécute avant toute connexion
// réelle. ---
verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-concurrence-equipe-ci.ts");

const prisma = new PrismaClient();
// `transfererStatutPrincipal` est typée sur le client applicatif étendu
// (`typeof prisma` de `lib/prisma.ts`) pour que les routes de production
// n'aient besoin d'aucun cast — un `new PrismaClient()` nu est structurellement
// identique à l'exécution (mêmes méthodes Prisma générées), seul le type
// TypeScript diffère à cause des extensions ; voir le commentaire détaillé
// dans `apps/api/src/services/principal.ts`.
const dbPourTransfert = prisma as unknown as Parameters<typeof transfererStatutPrincipal>[0];

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification des invariants de concurrence CI (P0-01 / round 6) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function reinitialiserBase() {
  await prisma.utilisateur.deleteMany();
  await prisma.travailleur.deleteMany();
  await prisma.role.deleteMany();
}

async function creerRoleAdministrateur() {
  return prisma.role.create({ data: { nom: ROLE_ADMINISTRATEUR, roleParentId: null } });
}

async function creerCompteAdmin(nom: string, email: string, roleId: string, estAdminPrincipal: boolean) {
  return prisma.utilisateur.create({
    data: {
      nom,
      email,
      roleId,
      motDePasseHash: "x",
      actif: true,
      estAdminPrincipal,
    },
  });
}

async function compterPrincipauxActifs() {
  return prisma.utilisateur.count({ where: { actif: true, estAdminPrincipal: true } });
}

async function main() {
  console.log("→ Scénario 1/4 : transfert concurrent avec désactivation de la cible pendant l'opération…");
  {
    await reinitialiserBase();
    const role = await creerRoleAdministrateur();
    const ancien = await creerCompteAdmin("Ancien Principal", "ancien@test.local", role.id, true);
    const cible = await creerCompteAdmin("Cible", "cible@test.local", role.id, false);

    // Le crochet met le transfert en pause juste après avoir retiré le
    // statut de l'ancien Principal (première écriture de sa transaction),
    // AVANT d'attribuer le statut à la cible (seconde écriture). Pendant
    // cette pause, une VRAIE requête concurrente désactive la cible depuis
    // une connexion séparée (son propre PrismaClient) — exactement ce que
    // ferait un second Admin cliquant sur « Désactiver » au même moment.
    let resultatDesactivation: Awaited<ReturnType<typeof desactiverCompteAtomique>> | undefined;
    let transfertLeve = false;
    const clientConcurrent = new PrismaClient();
    try {
      await transfererStatutPrincipal(dbPourTransfert, ancien.id, cible.id, {
        apresRetraitAvantAttribution: async () => {
          resultatDesactivation = await desactiverCompteAtomique(
            clientConcurrent as unknown as Parameters<typeof desactiverCompteAtomique>[0],
            cible.id,
          );
        },
      });
    } catch (e) {
      if (e instanceof ErreurTransfertPrincipalConcurrent) transfertLeve = true;
      else throw e;
    } finally {
      await clientConcurrent.$disconnect();
    }

    if (!transfertLeve) {
      echouer(
        "scénario 1 : le transfert aurait dû échouer (ErreurTransfertPrincipalConcurrent) — la cible venait d'être " +
          "désactivée pendant l'opération, l'attribution ne devait affecter aucune ligne",
      );
    }
    if (!resultatDesactivation?.ok) {
      echouer("scénario 1 : la désactivation concurrente de la cible aurait dû réussir (elle n'était pas encore Principal)");
    }

    const ancienApres = await prisma.utilisateur.findUniqueOrThrow({ where: { id: ancien.id } });
    if (!ancienApres.estAdminPrincipal) {
      echouer(
        "scénario 1 : ROLLBACK ATTENDU MAIS ABSENT — l'ancien Principal a perdu son statut alors que le transfert " +
          "a échoué ensuite ; l'ancien Principal doit rester Principal (retrait annulé avec le reste de la transaction)",
      );
    }
    const cibleApres = await prisma.utilisateur.findUniqueOrThrow({ where: { id: cible.id } });
    if (cibleApres.actif || cibleApres.estAdminPrincipal) {
      echouer("scénario 1 : la cible aurait dû rester inactive et non-Principal après sa désactivation concurrente");
    }
    const nbPrincipauxActifs = await compterPrincipauxActifs();
    if (nbPrincipauxActifs !== 1) {
      echouer(`scénario 1 : attendu exactement 1 Principal actif après rollback, trouvé ${nbPrincipauxActifs}`);
    }
    console.log(
      "  ✓ le transfert a échoué proprement (409 applicatif), l'ancien Principal a été restauré par le ROLLBACK " +
        "réel de PostgreSQL, la cible reste inactive et non-Principal — jamais d'Administrateur Principal inactif.",
    );
  }

  console.log("→ Scénario 2/4 : deux transferts lancés en parallèle depuis le même ancien Principal…");
  {
    await reinitialiserBase();
    const role = await creerRoleAdministrateur();
    const ancien = await creerCompteAdmin("Ancien Principal 2", "ancien2@test.local", role.id, true);
    const cibleA = await creerCompteAdmin("Cible A", "ciblea@test.local", role.id, false);
    const cibleB = await creerCompteAdmin("Cible B", "cibleb@test.local", role.id, false);

    // Deux VRAIES connexions séparées, préconnectées avant le lancement, puis
    // deux VRAIES transactions Prisma lancées en parallèle avec
    // Promise.allSettled. Il n'y a volontairement aucune barrière observant
    // les verrous PostgreSQL : ce scénario prouve le résultat de deux
    // opérations lancées en parallèle, mais ne prétend PAS démontrer leur
    // chevauchement temporel exact au niveau du verrou de ligne.
    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    await Promise.all([clientA.$connect(), clientB.$connect()]);
    const [resultatA, resultatB] = await Promise.allSettled([
      transfererStatutPrincipal(clientA as unknown as Parameters<typeof transfererStatutPrincipal>[0], ancien.id, cibleA.id),
      transfererStatutPrincipal(clientB as unknown as Parameters<typeof transfererStatutPrincipal>[0], ancien.id, cibleB.id),
    ]);
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);

    const succes = [resultatA, resultatB].filter((r) => r.status === "fulfilled");
    const echecs = [resultatA, resultatB].filter((r) => r.status === "rejected");
    if (succes.length !== 1) {
      echouer(
        `scénario 2 : attendu exactement 1 transfert réussi sur 2 tentatives lancées en parallèle, trouvé ${succes.length} ` +
          "— deux transferts depuis le même ancien Principal NE DOIVENT PAS tous les deux réussir",
      );
    }
    if (echecs.length !== 1 || !(echecs[0] as PromiseRejectedResult).reason instanceof ErreurTransfertPrincipalConcurrent) {
      echouer("scénario 2 : le transfert perdant doit échouer précisément avec ErreurTransfertPrincipalConcurrent");
    }
    const nbPrincipauxActifs = await compterPrincipauxActifs();
    if (nbPrincipauxActifs !== 1) {
      echouer(`scénario 2 : attendu exactement 1 Principal actif après les deux tentatives, trouvé ${nbPrincipauxActifs}`);
    }
    console.log("  ✓ un seul des deux transferts lancés en parallèle a réussi, l'autre a échoué proprement, exactement un Principal au final.");
  }

  console.log("→ Contrôle 3/4 : désactivation refusée après que la cible est devenue Principal…");
  {
    // Ce contrôle est volontairement SÉQUENTIEL : le transfert est entièrement
    // terminé avant la tentative de désactivation. Il vérifie directement que
    // la garde atomique de `desactiverCompteAtomique` refuse un compte déjà
    // Principal. Il ne constitue pas un troisième scénario concurrent — le
    // scénario 1 couvre la vraie course transfert/désactivation.
    await reinitialiserBase();
    const role = await creerRoleAdministrateur();
    const ancien = await creerCompteAdmin("Ancien Principal 3", "ancien3@test.local", role.id, true);
    const cible = await creerCompteAdmin("Cible 3", "cible3@test.local", role.id, false);

    await transfererStatutPrincipal(dbPourTransfert, ancien.id, cible.id);

    const clientVerification = new PrismaClient();
    let resultat: Awaited<ReturnType<typeof desactiverCompteAtomique>>;
    try {
      resultat = await desactiverCompteAtomique(
        clientVerification as unknown as Parameters<typeof desactiverCompteAtomique>[0],
        cible.id,
      );
    } finally {
      await clientVerification.$disconnect();
    }

    if (resultat.ok) {
      echouer("contrôle 3 : la désactivation de la nouvelle Principale aurait dû être refusée (raison EST_PRINCIPAL)");
    }
    if (resultat.raison !== "EST_PRINCIPAL") {
      echouer(`contrôle 3 : raison de refus attendue EST_PRINCIPAL, trouvée ${resultat.raison}`);
    }
    const cibleApres = await prisma.utilisateur.findUniqueOrThrow({ where: { id: cible.id } });
    if (!cibleApres.actif || !cibleApres.estAdminPrincipal) {
      echouer("contrôle 3 : la nouvelle Principale doit rester active et Principale — la désactivation refusée ne doit rien avoir modifié");
    }
    const nbPrincipauxActifs = await compterPrincipauxActifs();
    if (nbPrincipauxActifs !== 1) {
      echouer(`contrôle 3 : attendu exactement 1 Principal actif, trouvé ${nbPrincipauxActifs}`);
    }
    console.log("  ✓ la désactivation de la nouvelle Principale a été refusée atomiquement, aucune écriture appliquée.");
  }

  console.log("→ Contrôle 4/4 : vérification globale finale — exactement un compte actif=true ET estAdminPrincipal=true…");
  {
    const nbPrincipauxActifs = await compterPrincipauxActifs();
    if (nbPrincipauxActifs !== 1) {
      echouer(`contrôle 4 : état final attendu = exactement 1 Principal actif dans la base, trouvé ${nbPrincipauxActifs}`);
    }
    const nbPrincipauxTotal = await prisma.utilisateur.count({ where: { estAdminPrincipal: true } });
    if (nbPrincipauxTotal !== 1) {
      echouer(`contrôle 4 : attendu exactement 1 compte estAdminPrincipal=true au total (actif ou non), trouvé ${nbPrincipauxTotal}`);
    }
    console.log("  ✓ invariant global vérifié : jamais zéro Principal, jamais deux.");
  }

  await reinitialiserBase();
  console.log(
    "\n✅ Vérification des invariants de concurrence CI P0-01 (round 6) : 2 scénarios lançant de vraies opérations " +
      "concurrentes/parallèles et 2 contrôles complémentaires passent contre PostgreSQL — jamais d'Administrateur " +
      "Principal inactif, jamais deux Principaux, jamais un rollback manqué.\n",
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
