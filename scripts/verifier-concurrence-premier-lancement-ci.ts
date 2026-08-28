/**
 * Vérification CI des garanties de concurrence du secret de bootstrap du
 * premier lancement (P1-A, 28/08/2026), contre une VRAIE base PostgreSQL
 * éphémère — le service `postgres` de `.github/workflows/ci.yml`.
 *
 * Les tests mockés (`apps/api/src/services/premierLancement.test.ts`)
 * prouvent que la logique de service se comporte correctement contre un
 * client Prisma simulé — ils ne peuvent PAS prouver l'atomicité elle-même :
 * un mock n'a pas de verrou de ligne PostgreSQL réel, pas de sérialisation
 * MVCC, pas de vraie transaction concurrente. Seule une vraie base peut le
 * prouver — c'est l'objet de ce script, en deux scénarios :
 *
 *  1. Deux finalisations concurrentes utilisant le MÊME secret valide.
 *     Un crochet de test capture le PID réel de la transaction A (via
 *     `tx.$queryRaw`, sur la MÊME connexion que la transaction — jamais un
 *     `PrismaClient` séparé, qui piocherait une connexion différente du
 *     pool) juste après sa réservation réussie du secret (verrou de ligne
 *     PostgreSQL désormais posé), lance B en arrière-plan SANS l'attendre
 *     depuis le crochet (l'attendre bloquerait le processus Node entier :
 *     B attend le verrou que A détient, or A attend que le crochet
 *     termine — deadlock applicatif), confirme via `pg_blocking_pids()`
 *     depuis une TROISIÈME connexion que B est RÉELLEMENT bloqué sur le
 *     PID de A, PUIS laisse le crochet terminer (A peut continuer et
 *     committer) — et seulement ENSUITE attend la promesse de B, déjà
 *     lancée.
 *  2. Deux finalisations concurrentes utilisant CHACUNE son propre secret
 *     valide (deux administrateurs légitimes agissant au même instant) —
 *     deux vraies connexions séparées, préconnectées, lancées en parallèle
 *     avec `Promise.allSettled` (même idiome que le scénario 2 de
 *     `verifier-concurrence-equipe-ci.ts`).
 *
 * Dans les deux cas : exactement UNE finalisation réussit, l'autre échoue
 * proprement (jamais un plantage brut), et il n'existe jamais plus d'un
 * compte Administrateur Principal.
 *
 * SÉCURITÉ : même garde que les scripts d'intégration voisins — hôte local,
 * nom de base EXACT `lomoto_ci`, confirmation explicite. Voir
 * `scripts/garde-integration-ci.ts`.
 *
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-concurrence-premier-lancement-ci.ts
 */
import { PrismaClient } from "@prisma/client";
import { ROLE_ADMINISTRATEUR } from "@lomoto/shared";
import {
  type CrochetsTestFinalisationPremierLancement,
  ErreurFinalisationReessayable,
  finaliserPremierLancementDirect,
  genererSecretPremierLancement,
} from "../apps/api/src/services/premierLancement.js";
import { ErreurAction } from "../apps/api/src/lib/erreurAction.js";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-concurrence-premier-lancement-ci.ts");

const prisma = new PrismaClient();
// Même convention que verifier-concurrence-equipe-ci.ts : les fonctions de
// production sont typées sur le client applicatif étendu (`typeof prisma`
// de `lib/prisma.ts`) — un `new PrismaClient()` nu est structurellement
// identique à l'exécution, seul le type diffère.
type DbApp = Parameters<typeof finaliserPremierLancementDirect>[0];

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification de concurrence CI (premier lancement) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function reinitialiserBase() {
  await prisma.secretPremierLancement.deleteMany();
  await prisma.utilisateur.deleteMany();
  await prisma.travailleur.deleteMany();
  await prisma.role.deleteMany();
}

async function creerRoleAdministrateur() {
  return prisma.role.create({ data: { nom: ROLE_ADMINISTRATEUR, roleParentId: null } });
}

async function creerTravailleurPret(nom: string, email: string) {
  return prisma.travailleur.create({
    data: {
      nom,
      poste: "Gérant",
      dateEmbauche: new Date(),
      emailProStatut: "ACTIF",
      emailProAdresse: email,
    },
  });
}

async function attendre(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("→ Scénario 1/2 : deux finalisations concurrentes utilisant le MÊME secret…");
  {
    await reinitialiserBase();
    await creerRoleAdministrateur();
    const t1 = await creerTravailleurPret("Aline", "aline@lomoto.test");
    const t2 = await creerTravailleurPret("Bosco", "bosco@lomoto.test");
    const { secretClair } = await genererSecretPremierLancement(prisma, 60 * 60 * 1000);

    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    await Promise.all([clientA.$connect(), clientB.$connect()]);

    let promesseB: Promise<void> | undefined;
    let pidA: number | undefined;
    let resultatA: "ok" | "erreur" = "ok";
    let erreurA: unknown;

    const crochets: CrochetsTestFinalisationPremierLancement = {
      apresReservationAvantEcriture: async (tx) => {
        const ligne = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pidA = ligne[0]!.pid;

        // Lance B en ARRIÈRE-PLAN, sans l'attendre ici (voir l'en-tête —
        // l'attendre bloquerait ce processus indéfiniment).
        promesseB = finaliserPremierLancementDirect(clientB as unknown as DbApp, {
          secretFourni: secretClair,
          travailleurId: t2.id,
          motDePasse: "motdepasse123",
        }).then(
          () => undefined,
          () => undefined, // l'échec de B est un résultat légitime, capturé plus bas via l'état réel
        );

        // Confirme, depuis une TROISIÈME connexion, que B est RÉELLEMENT
        // bloqué sur le PID de A — jamais un délai comme preuve.
        const clientVerification = new PrismaClient();
        try {
          let bloque = false;
          for (let i = 0; i < 100 && !bloque; i++) {
            const bloquants = await clientVerification.$queryRaw<{ pid: number }[]>`
              SELECT unnest(pg_blocking_pids(pid)) AS pid
              FROM pg_stat_activity
              WHERE state = 'active' AND pid <> pg_backend_pid()
            `;
            bloque = bloquants.some((b) => b.pid === pidA);
            if (!bloque) await attendre(20);
          }
          if (!bloque) {
            echouer(
              "scénario 1 : la finalisation B n'a jamais été observée bloquée sur le PID de A — le verrou de ligne " +
                "PostgreSQL attendu (réservation du même secret) ne s'est pas produit, la course n'est pas prouvée",
            );
          }
          console.log(`  · B confirmé bloqué sur le PID de A (${pidA}) via pg_blocking_pids — verrou de ligne réel.`);
        } finally {
          await clientVerification.$disconnect();
        }
        // Le crochet termine ici : A peut continuer et committer, ce qui
        // libère le verrou et laisse B reprendre.
      },
    };

    try {
      await finaliserPremierLancementDirect(clientA as unknown as DbApp, { secretFourni: secretClair, travailleurId: t1.id, motDePasse: "motdepasse123" }, crochets);
    } catch (e) {
      resultatA = "erreur";
      erreurA = e;
    }

    if (!promesseB) echouer("scénario 1 : le crochet n'a jamais lancé B — la course n'a pas eu lieu");
    await promesseB;
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);

    const nbUtilisateurs = await prisma.utilisateur.count();
    if (nbUtilisateurs !== 1) {
      echouer(`scénario 1 : attendu exactement 1 Administrateur Principal créé au final, trouvé ${nbUtilisateurs}`);
    }
    if (resultatA === "erreur" && !(erreurA instanceof ErreurAction && erreurA.status === 401)) {
      echouer(`scénario 1 : si A échoue, attendu ErreurAction(401) précisément — reçu ${String(erreurA)}`);
    }
    console.log(
      `  ✓ un seul compte créé au final (A a ${resultatA === "ok" ? "réussi" : "échoué proprement en 401"}), ` +
        "verrou de ligne PostgreSQL réel confirmé par pg_blocking_pids — jamais un délai comme preuve.",
    );
  }

  console.log("→ Scénario 2/2 : deux finalisations concurrentes, CHACUNE avec son propre secret valide…");
  {
    await reinitialiserBase();
    await creerRoleAdministrateur();
    const t1 = await creerTravailleurPret("Chantal", "chantal@lomoto.test");
    const t2 = await creerTravailleurPret("David", "david@lomoto.test");
    const { secretClair: secretA } = await genererSecretPremierLancement(prisma, 60 * 60 * 1000);
    const { secretClair: secretB } = await genererSecretPremierLancement(prisma, 60 * 60 * 1000);

    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    await Promise.all([clientA.$connect(), clientB.$connect()]);

    // Deux VRAIES connexions séparées, préconnectées, lancées en parallèle —
    // même idiome que le scénario 2 de verifier-concurrence-equipe-ci.ts :
    // prouve le résultat de deux opérations réellement concurrentes, sans
    // prétendre garantir leur chevauchement exact au niveau du verrou.
    const [resultatA, resultatB] = await Promise.allSettled([
      finaliserPremierLancementDirect(clientA as unknown as DbApp, { secretFourni: secretA, travailleurId: t1.id, motDePasse: "motdepasse123" }),
      finaliserPremierLancementDirect(clientB as unknown as DbApp, { secretFourni: secretB, travailleurId: t2.id, motDePasse: "motdepasse123" }),
    ]);
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);

    const resultats = [resultatA, resultatB];
    const succes = resultats.filter((r) => r.status === "fulfilled");
    const echecs = resultats.filter((r) => r.status === "rejected");

    if (succes.length !== 1) {
      echouer(
        `scénario 2 : attendu exactement 1 finalisation réussie sur 2 tentatives lancées en parallèle avec des secrets ` +
          `DIFFÉRENTS, trouvé ${succes.length} — deux administrateurs ne doivent jamais tous les deux réussir`,
      );
    }
    if (echecs.length !== 1) {
      echouer("scénario 2 : attendu exactement 1 échec");
    }
    const raisonEchec = (echecs[0] as PromiseRejectedResult).reason;
    const echecPropre =
      (raisonEchec instanceof ErreurAction && raisonEchec.status === 409) || raisonEchec instanceof ErreurFinalisationReessayable;
    if (!echecPropre) {
      echouer(
        `scénario 2 : le perdant doit échouer proprement (ErreurAction 409, ou ErreurFinalisationReessayable après ` +
          `épuisement des réessais P2034) — reçu ${String(raisonEchec)}`,
      );
    }

    const nbUtilisateurs = await prisma.utilisateur.count();
    if (nbUtilisateurs !== 1) {
      echouer(`scénario 2 : attendu exactement 1 Administrateur Principal créé au final, trouvé ${nbUtilisateurs}`);
    }
    console.log(
      "  ✓ un seul des deux administrateurs lancés en parallèle (secrets différents) a réussi, l'autre a échoué " +
        "proprement, exactement un Administrateur Principal au final.",
    );
  }

  console.log("\n✅ Vérification de concurrence CI « premier lancement » : jamais plus d'un Administrateur Principal, quel que soit le scénario de course.\n");
}

main()
  .catch((e) => {
    if (process.exitCode !== 1) {
      console.error(e);
      process.exitCode = 1;
    }
  })
  .finally(() => prisma.$disconnect());
