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
 * prouver — c'est l'objet de ce script, rejoué NB_ITERATIONS_CONCURRENCE
 * fois par scénario (aucune instabilité tolérée) :
 *
 *  1. Deux finalisations concurrentes utilisant le MÊME secret. A réserve le
 *     secret en premier (verrou de ligne PostgreSQL désormais posé) puis,
 *     depuis le crochet de test `apresReservationAvantEcriture`, lance B en
 *     arrière-plan SANS l'attendre depuis le crochet (l'attendre bloquerait
 *     le processus Node entier : B attend le verrou que A détient, or A
 *     attend que le crochet termine — deadlock applicatif). Confirme via
 *     `pg_blocking_pids()`, depuis une TROISIÈME connexion, que B est
 *     RÉELLEMENT bloqué sur le PID de A — jamais un délai comme preuve —
 *     PUIS laisse le crochet terminer (A peut continuer et committer) et
 *     ENSUITE attend la promesse de B, déjà lancée. Le résultat COMPLET de B
 *     est conservé (plus de `.then(() => undefined, () => undefined)`, qui
 *     aurait laissé passer une erreur brute inattendue sans le faire échouer
 *     honnêtement) : A doit réussir (elle a réservé le secret la première),
 *     B doit échouer précisément avec `ErreurAction(401)`, exactement un
 *     compte est créé et rattaché au bon travailleur, le secret n'est
 *     consommé qu'une seule fois, et un rejeu séquentiel du même secret
 *     après coup échoue encore en 401.
 *
 *  2. Deux finalisations concurrentes utilisant CHACUNE son propre secret
 *     valide (deux administrateurs légitimes agissant au même instant).
 *     `Promise.allSettled` seul ne garantit PAS que les deux transactions se
 *     chevauchent réellement — l'une pourrait terminer avant même que
 *     l'autre ne démarre, ce qui prouverait l'absence de plantage, pas la
 *     résistance à la concurrence. Une BARRIÈRE déterministe, construite sur
 *     le crochet de test existant (`apresReservationAvantEcriture`, appelé
 *     par chaque transaction juste après avoir réservé SON PROPRE secret —
 *     pas de conflit de ligne à ce stade, deux secrets distincts), force les
 *     deux transactions à attendre que l'autre soit arrivée avant de
 *     continuer vers la relecture `utilisateur.count()` : c'est CE moment,
 *     et non le simple lancement des deux promesses, qui doit réellement se
 *     chevaucher. `pg_blocking_pids()` n'est pas pertinent ici — les deux
 *     secrets sont des lignes distinctes, il n'y a pas de verrou de ligne à
 *     observer entre elles ; c'est la relecture Serializable de
 *     `utilisateur.count()` qui détecte le conflit, via un vrai P2034
 *     PostgreSQL ou un rejet métier propre selon l'ordre exact de
 *     validation des deux transactions — les deux issues sont acceptées. La
 *     transaction perdante, si elle rejoue via le réessai borné interne
 *     après un P2034, retraverse la même barrière déjà résolue : elle ne
 *     bloque donc pas une seconde fois (une Promise déjà résolue résout
 *     immédiatement tout `await` suivant, y compris d'un nouvel appelant).
 *     Exactement une finalisation réussit, rattachée au bon travailleur ;
 *     l'autre échoue proprement (jamais un plantage brut) ; et — lorsque
 *     l'échec final est un rejet métier propre (409), donc un état
 *     déterministe à vérifier — le secret de la transaction perdante est
 *     confirmé RESTAURÉ par le rollback intégral de sa transaction avortée :
 *     toujours valide, non consommé.
 *
 * Dans les deux cas : exactement UNE finalisation réussit, l'autre échoue
 * proprement, et il n'existe jamais plus d'un compte Administrateur
 * Principal.
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
  secretPremierLancementValide,
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

// Même idiome que NB_ITERATIONS_CONCURRENCE dans
// verifier-concurrence-actions-metier-ci.ts : chaque scénario est rejoué
// plusieurs fois — aucune instabilité tolérée.
const NB_ITERATIONS_CONCURRENCE = 10;

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

/**
 * Barrière de synchronisation à N participants — construite uniquement pour
 * ce harnais de preuve, sans aucun impact sur le code de production. Chaque
 * participant appelle `attendre()` ; personne ne continue tant que les N ne
 * sont pas arrivés. Une fois résolue, elle le reste : un participant qui la
 * retraverse plus tard (ex. lors d'un réessai après P2034) passe
 * immédiatement, sans bloquer une seconde fois.
 */
function creerBarriere(nbParticipants: number) {
  let arrivees = 0;
  let resoudre!: () => void;
  const attente = new Promise<void>((resolve) => {
    resoudre = resolve;
  });
  return {
    async attendre() {
      arrivees++;
      if (arrivees >= nbParticipants) resoudre();
      await attente;
    },
  };
}

async function scenario1(iteration: number) {
  await reinitialiserBase();
  await creerRoleAdministrateur();
  const t1 = await creerTravailleurPret(`Aline${iteration}`, `aline${iteration}@lomoto.test`);
  const t2 = await creerTravailleurPret(`Bosco${iteration}`, `bosco${iteration}@lomoto.test`);
  const { secretClair } = await genererSecretPremierLancement(prisma, 60 * 60 * 1000);

  const clientA = new PrismaClient();
  const clientB = new PrismaClient();
  try {
    await Promise.all([clientA.$connect(), clientB.$connect()]);

    let promesseB: Promise<{ ok: true } | { ok: false; erreur: unknown }> | undefined;
    let pidA: number | undefined;

    const crochets: CrochetsTestFinalisationPremierLancement = {
      apresReservationAvantEcriture: async (tx) => {
        const ligne = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pidA = ligne[0]!.pid;

        // Lance B en ARRIÈRE-PLAN, sans l'attendre ici (voir l'en-tête —
        // l'attendre bloquerait ce processus indéfiniment). Le résultat
        // COMPLET (succès ou erreur précise) est conservé, jamais effacé.
        promesseB = finaliserPremierLancementDirect(clientB as unknown as DbApp, {
          secretFourni: secretClair,
          travailleurId: t2.id,
          motDePasse: "motdepasse123",
        }).then(
          () => ({ ok: true as const }),
          (erreur: unknown) => ({ ok: false as const, erreur }),
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
              `scénario 1 (itération ${iteration}) : la finalisation B n'a jamais été observée bloquée sur le PID de A — le verrou de ligne ` +
                "PostgreSQL attendu (réservation du même secret) ne s'est pas produit, la course n'est pas prouvée",
            );
          }
        } finally {
          await clientVerification.$disconnect();
        }
        // Le crochet termine ici : A peut continuer et committer, ce qui
        // libère le verrou et laisse B reprendre.
      },
    };

    try {
      await finaliserPremierLancementDirect(
        clientA as unknown as DbApp,
        { secretFourni: secretClair, travailleurId: t1.id, motDePasse: "motdepasse123" },
        crochets,
      );
    } catch (e) {
      echouer(
        `scénario 1 (itération ${iteration}) : A a réservé le secret avant même de lancer B — elle doit réussir, a échoué avec ${String(e)}`,
      );
    }

    if (!promesseB) {
      echouer(`scénario 1 (itération ${iteration}) : le crochet n'a jamais lancé B — la course n'a pas eu lieu`);
    }
    const resultatB = await promesseB;

    if (resultatB.ok) {
      echouer(
        `scénario 1 (itération ${iteration}) : B a réussi alors que le secret était déjà réservé par A — deux comptes ont pu être créés`,
      );
    }
    if (!(resultatB.erreur instanceof ErreurAction) || resultatB.erreur.status !== 401) {
      echouer(`scénario 1 (itération ${iteration}) : B doit échouer précisément avec ErreurAction(401) — reçu ${String(resultatB.erreur)}`);
    }

    const nbUtilisateurs = await prisma.utilisateur.count();
    if (nbUtilisateurs !== 1) {
      echouer(`scénario 1 (itération ${iteration}) : attendu exactement 1 Administrateur Principal créé au final, trouvé ${nbUtilisateurs}`);
    }

    const travailleur1 = await prisma.travailleur.findUnique({ where: { id: t1.id } });
    const travailleur2 = await prisma.travailleur.findUnique({ where: { id: t2.id } });
    if (!travailleur1 || !travailleur1.utilisateurId) {
      echouer(`scénario 1 (itération ${iteration}) : le travailleur de A (qui a réussi) doit être rattaché à un compte`);
    }
    if (travailleur2?.utilisateurId) {
      echouer(`scénario 1 (itération ${iteration}) : le travailleur de B (qui a échoué) ne doit PAS être rattaché à un compte`);
    }
    const compte = await prisma.utilisateur.findUnique({ where: { id: travailleur1.utilisateurId } });
    if (!compte || compte.email !== t1.emailProAdresse) {
      echouer(`scénario 1 (itération ${iteration}) : le compte créé doit être rattaché exactement au travailleur de A`);
    }

    const secretsRestants = await prisma.secretPremierLancement.findMany();
    if (secretsRestants.length !== 1 || !secretsRestants[0]!.consommeLe) {
      echouer(`scénario 1 (itération ${iteration}) : le secret doit être consommé exactement une fois (une seule ligne, consommeLe non nul)`);
    }

    try {
      await finaliserPremierLancementDirect(prisma as unknown as DbApp, {
        secretFourni: secretClair,
        travailleurId: t2.id,
        motDePasse: "motdepasse123",
      });
      echouer(`scénario 1 (itération ${iteration}) : un rejeu séquentiel du secret déjà consommé doit échouer en 401, a réussi`);
    } catch (e) {
      if (!(e instanceof ErreurAction) || e.status !== 401) {
        echouer(`scénario 1 (itération ${iteration}) : rejeu séquentiel — attendu ErreurAction(401), reçu ${String(e)}`);
      }
    }
  } finally {
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);
  }
}

async function scenario2(iteration: number) {
  await reinitialiserBase();
  await creerRoleAdministrateur();
  const t1 = await creerTravailleurPret(`Chantal${iteration}`, `chantal${iteration}@lomoto.test`);
  const t2 = await creerTravailleurPret(`David${iteration}`, `david${iteration}@lomoto.test`);
  const { secretClair: secretA } = await genererSecretPremierLancement(prisma, 60 * 60 * 1000);
  const { secretClair: secretB } = await genererSecretPremierLancement(prisma, 60 * 60 * 1000);

  const clientA = new PrismaClient();
  const clientB = new PrismaClient();
  try {
    await Promise.all([clientA.$connect(), clientB.$connect()]);

    // Barrière déterministe : chaque transaction n'a le droit de continuer
    // vers la relecture `utilisateur.count()` qu'une fois que LES DEUX ont
    // réservé leur propre secret et atteint le crochet — le chevauchement
    // réel est ainsi garanti, pas seulement espéré via Promise.allSettled.
    const barriere = creerBarriere(2);
    const crochetsA: CrochetsTestFinalisationPremierLancement = {
      apresReservationAvantEcriture: () => barriere.attendre(),
    };
    const crochetsB: CrochetsTestFinalisationPremierLancement = {
      apresReservationAvantEcriture: () => barriere.attendre(),
    };

    const [resultatA, resultatB] = await Promise.allSettled([
      finaliserPremierLancementDirect(
        clientA as unknown as DbApp,
        { secretFourni: secretA, travailleurId: t1.id, motDePasse: "motdepasse123" },
        crochetsA,
      ),
      finaliserPremierLancementDirect(
        clientB as unknown as DbApp,
        { secretFourni: secretB, travailleurId: t2.id, motDePasse: "motdepasse123" },
        crochetsB,
      ),
    ]);

    const participants = [
      { nom: "A", secret: secretA, travailleurId: t1.id, promesse: resultatA },
      { nom: "B", secret: secretB, travailleurId: t2.id, promesse: resultatB },
    ];
    const gagnants = participants.filter((p) => p.promesse.status === "fulfilled");
    const perdants = participants.filter((p) => p.promesse.status === "rejected");

    if (gagnants.length !== 1) {
      echouer(
        `scénario 2 (itération ${iteration}) : attendu exactement 1 finalisation réussie sur 2 tentatives avec des secrets DIFFÉRENTS, ` +
          `forcées à se chevaucher via la barrière, trouvé ${gagnants.length}`,
      );
    }
    if (perdants.length !== 1) {
      echouer(`scénario 2 (itération ${iteration}) : attendu exactement 1 échec`);
    }

    const perdant = perdants[0]!;
    const raisonEchec = (perdant.promesse as PromiseRejectedResult).reason;
    const echecPropre = raisonEchec instanceof ErreurAction && raisonEchec.status === 409;
    const echecReessayable = raisonEchec instanceof ErreurFinalisationReessayable;
    if (!echecPropre && !echecReessayable) {
      echouer(
        `scénario 2 (itération ${iteration}) : le perdant doit échouer proprement (ErreurAction 409, ou ErreurFinalisationReessayable ` +
          `après épuisement des réessais P2034) — reçu ${String(raisonEchec)}`,
      );
    }

    const nbUtilisateurs = await prisma.utilisateur.count();
    if (nbUtilisateurs !== 1) {
      echouer(`scénario 2 (itération ${iteration}) : attendu exactement 1 Administrateur Principal créé au final, trouvé ${nbUtilisateurs}`);
    }

    const gagnant = gagnants[0]!;
    const travailleurGagnant = await prisma.travailleur.findUnique({ where: { id: gagnant.travailleurId } });
    const travailleurPerdant = await prisma.travailleur.findUnique({ where: { id: perdant.travailleurId } });
    if (!travailleurGagnant || !travailleurGagnant.utilisateurId) {
      echouer(`scénario 2 (itération ${iteration}) : le travailleur du gagnant doit être rattaché à un compte`);
    }
    if (travailleurPerdant?.utilisateurId) {
      echouer(`scénario 2 (itération ${iteration}) : le travailleur du perdant ne doit PAS être rattaché à un compte`);
    }
    const compte = await prisma.utilisateur.findUnique({ where: { id: travailleurGagnant.utilisateurId } });
    if (!compte) {
      echouer(`scénario 2 (itération ${iteration}) : le compte du gagnant est introuvable`);
    }

    // Rollback du secret perdant : seulement vérifiable lorsque l'échec est
    // un rejet métier propre (409) — état final déterministe. Après
    // épuisement des réessais P2034 (ErreurFinalisationReessayable), l'état
    // du secret dépend du nombre exact de tentatives et n'est pas assertable
    // simplement ici.
    if (echecPropre) {
      const secretPerdantEncoreValide = await secretPremierLancementValide(prisma, perdant.secret);
      if (!secretPerdantEncoreValide) {
        echouer(
          `scénario 2 (itération ${iteration}) : après un échec métier propre (409), le secret de la transaction perdante doit avoir été ` +
            "restauré par le rollback intégral de sa transaction avortée — il apparaît consommé ou invalide",
        );
      }
    }
  } finally {
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);
  }
}

async function main() {
  console.log(`→ Scénario 1/2 (${NB_ITERATIONS_CONCURRENCE}x) : deux finalisations concurrentes utilisant le MÊME secret…`);
  for (let i = 1; i <= NB_ITERATIONS_CONCURRENCE; i++) {
    await scenario1(i);
  }
  console.log(
    `  ✓ ${NB_ITERATIONS_CONCURRENCE} itérations, aucune instabilité : verrou de ligne PostgreSQL réel confirmé par pg_blocking_pids à ` +
      "chaque fois, A gagne systématiquement, B échoue précisément en 401, secret consommé une seule fois, rejeu séquentiel refusé.",
  );

  console.log(
    `→ Scénario 2/2 (${NB_ITERATIONS_CONCURRENCE}x) : deux finalisations concurrentes, CHACUNE avec son propre secret valide, chevauchement ` +
      "forcé par barrière déterministe…",
  );
  for (let i = 1; i <= NB_ITERATIONS_CONCURRENCE; i++) {
    await scenario2(i);
  }
  console.log(
    `  ✓ ${NB_ITERATIONS_CONCURRENCE} itérations, aucune instabilité : exactement un administrateur créé et rattaché à chaque fois, ` +
      "l'autre échoue proprement, secret perdant restauré par rollback lorsque l'échec est un rejet métier propre.",
  );

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
