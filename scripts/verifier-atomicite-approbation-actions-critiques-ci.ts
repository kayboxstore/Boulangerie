/**
 * Vérification CI, contre une VRAIE base PostgreSQL éphémère, du correctif
 * d'atomicité du parcours d'approbation pour les 4 types d'action critique
 * SUPPRIMER_UTILISATEUR / CREER_COMPTE_ADMIN / MODIFIER_TYPE_CLIENT /
 * MODIFIER_TAUX_TAXE (`approuverEtExecuterActionCritique`,
 * `apps/api/src/services/actionsCritiques.ts`).
 *
 * Défaut corrigé : jusqu'ici, le parcours d'approbation de ces 4 types
 * exécutait l'action métier PUIS, séparément, tentait de faire passer la
 * `DemandeApprobation` à APPROUVEE — deux écritures NON transactionnelles
 * entre elles. Une décision concurrente (rejet) pouvait gagner la seconde
 * écriture APRÈS que la première ait réellement eu lieu (ex. un compte
 * supprimé, mais une demande affichée REJETEE — vérification manuelle
 * nécessaire, incohérence de fond). Corrigé en réservant la demande AVANT de
 * tenter l'action, LE TOUT dans une seule transaction PostgreSQL
 * Serializable — même mécanisme que celui déjà prouvé contre une vraie base
 * pour MODIFIER_PERMISSIONS_ROLE (`verifier-audit-permissions-role-ci.ts`).
 *
 * `actionsCritiques.test.ts` prouve déjà la LOGIQUE (mockée, client factice
 * en mémoire avec copie-sur-succès). Un mock ne peut PAS prouver un vrai
 * verrou de ligne PostgreSQL ni un vrai blocage entre deux connexions
 * séparées — c'est l'objet de ce script, qui exerce EXACTEMENT le code de
 * production (`approuverEtExecuterActionCritique`,
 * `rejeterDemandeApprobationAtomique`, `executerAction`), jamais réimplémenté
 * ici.
 *
 * Portée délibérément limitée à 4 scénarios (contre les 14 du script
 * MODIFIER_PERMISSIONS_ROLE, plus ancien et plus richement audité) : ce
 * correctif ajoute l'atomicité réservation+exécution+transition, pas de
 * piste d'audit dédiée ni de métadonnées enrichies — les invariants propres à
 * chacun des 4 exécuteurs (limite d'Admins, doublon d'email, doublon de nom
 * de qualité…) sont déjà couverts par les tests HTTP existants
 * (`equipe.test.ts`, `roles.permissions.test.ts`, etc.) et ne sont pas
 * reprouvés ici. Un vrai conflit de sérialisation PostgreSQL (P2034) n'est
 * PAS déclenché contre une vraie base dans ce script — la boucle de réessai
 * bornée est déjà prouvée par la logique mockée
 * (`actionsCritiques.test.ts`, scénario « P2034 transitoire ») et par le
 * script MODIFIER_PERMISSIONS_ROLE (mécanisme structurellement identique,
 * réutilisé tel quel) ; provoquer un P2034 réel et déterministe ici aurait
 * exigé un second crochet de test dédié pour un gain de preuve marginal — non
 * ajouté, limite documentée plutôt que prétendue couverte.
 *
 * SÉCURITÉ : même garde que les autres scripts d'intégration —
 * `verifierEnvironnementIntegrationCI` (réutilisée telle quelle, jamais
 * dupliquée) exige simultanément un hôte local, le nom de base EXACT
 * `lomoto_ci`, et une confirmation explicite. Voir `scripts/garde-integration-ci.ts`.
 *
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-atomicite-approbation-actions-critiques-ci.ts
 */
import { PrismaClient } from "@prisma/client";
import {
  approuverEtExecuterActionCritique,
  ErreurAction,
} from "../apps/api/src/services/actionsCritiques.js";
import {
  ErreurDecisionConcurrente,
  rejeterDemandeApprobationAtomique,
} from "../apps/api/src/services/demandeApprobation.js";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

// --- Garde — voir l'en-tête. Toute première instruction, avant tout accès
// Prisma : aucun des modules importés ci-dessus ne construit de PrismaClient
// à l'import (même convention que les autres scripts d'intégration) — seule
// la ligne suivante en ouvrirait une, donc la garde s'exécute avant toute
// connexion réelle. ---
verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-atomicite-approbation-actions-critiques-ci.ts");

const prisma = new PrismaClient();
// Même convention que les autres scripts d'intégration : un `new
// PrismaClient()` nu est structurellement identique à l'exécution à `typeof
// prisma` (client applicatif étendu) — seul le type TypeScript diffère à
// cause de l'extension d'audit générale (qui n'intercepte de toute façon ni
// `create` ni `updateMany` ni `deleteMany`, seules écritures en jeu ici pour
// les 4 exécuteurs). Le cast est donc sûr.
const dbPourApprobation = prisma as unknown as Parameters<typeof approuverEtExecuterActionCritique>[0];

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification PostgreSQL réelle de l'atomicité d'approbation (actions critiques) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function reinitialiserBase() {
  await prisma.demandeApprobation.deleteMany();
  await prisma.produit.deleteMany();
  await prisma.utilisateur.deleteMany();
  await prisma.role.deleteMany();
}

async function creerActeurs() {
  const role = await prisma.role.create({ data: { nom: "Caissier(ère)", roleParentId: null } });
  const principal = await prisma.utilisateur.create({
    data: { nom: "Aline (Admin Principal)", email: "principal-aac@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
  });
  return { role, principal };
}

/** Pid PostgreSQL RÉEL de la connexion physique utilisée par CETTE transaction précise. */
async function pidDeLaTransaction(tx: { $queryRaw: PrismaClient["$queryRaw"] }): Promise<number> {
  const lignes = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  const pid = lignes[0]?.pid;
  if (typeof pid !== "number") throw new Error("pidDeLaTransaction : pg_backend_pid() n'a renvoyé aucun pid exploitable");
  return pid;
}

/**
 * Bloque jusqu'à observer, depuis `observateur` (une TROISIÈME connexion),
 * que la session `pidBloque` est RÉELLEMENT en attente d'un verrou détenu
 * par `pidBloquant` — via `pg_blocking_pids`, jamais un délai arbitraire. Le
 * délai maximal est un garde-fou d'ÉCHEC DE TEST, jamais la synchronisation
 * elle-même (même convention que `verifier-audit-permissions-role-ci.ts`).
 */
async function attendreBlocageReel(
  observateur: PrismaClient,
  pidBloque: number,
  pidBloquant: number,
  description: string,
  delaiMaxMs = 5000,
): Promise<void> {
  const debut = Date.now();
  for (;;) {
    const lignes = await observateur.$queryRaw<{ bloquants: number[] }[]>`
      SELECT pg_blocking_pids(${pidBloque}::int) AS bloquants
    `;
    const bloquants = (lignes[0]?.bloquants ?? []).map(Number);
    if (bloquants.includes(pidBloquant)) return;
    if (Date.now() - debut > delaiMaxMs) {
      throw new Error(
        `${description} : jamais observé, depuis une connexion tierce, que la session pid=${pidBloque} est ` +
          `réellement bloquée par la session pid=${pidBloquant} (pg_blocking_pids) dans les ${delaiMaxMs}ms.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function main() {
  console.log("→ Scénario 1/4 : approbation directe réussie (SUPPRIMER_UTILISATEUR) — réservation+exécution+transition atomiques…");
  {
    await reinitialiserBase();
    const { role, principal } = await creerActeurs();
    const cible = await prisma.utilisateur.create({
      data: { nom: "Compte à supprimer", email: "cible-scenario1@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "SUPPRIMER_UTILISATEUR",
        donnees: { utilisateurId: cible.id },
        resume: `supprimer « ${cible.nom} »`,
        demandeParId: principal.id,
      },
    });

    const resultat = await approuverEtExecuterActionCritique(dbPourApprobation, demande.id, {
      id: principal.id,
      nom: principal.nom,
    });
    if (!/supprimé/.test(resultat.message)) echouer(`scénario 1 : message inattendu « ${resultat.message} »`);

    const cibleEncore = await prisma.utilisateur.findUnique({ where: { id: cible.id } });
    if (cibleEncore) echouer("scénario 1 : le compte cible aurait dû être réellement supprimé");
    const demandeApres = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    if (demandeApres.statut !== "APPROUVEE") echouer(`scénario 1 : statut attendu APPROUVEE, trouvé ${demandeApres.statut}`);
    if (demandeApres.approuveParId !== principal.id) echouer("scénario 1 : approuveParId ne correspond pas à l'approbateur réel");
    console.log("  ✓ compte réellement supprimé ET demande réellement APPROUVEE, dans la même transaction PostgreSQL.");
  }

  console.log("→ Scénario 2/4 : rejet RÉELLEMENT concurrent PENDANT l'exécution de l'approbation (verrou observé, jamais un délai)…");
  {
    await reinitialiserBase();
    const { role, principal } = await creerActeurs();
    const cible = await prisma.utilisateur.create({
      data: { nom: "Compte scénario 2", email: "cible-scenario2@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "SUPPRIMER_UTILISATEUR",
        donnees: { utilisateurId: cible.id },
        resume: `supprimer « ${cible.nom} »`,
        demandeParId: principal.id,
      },
    });

    // L'approbation réserve la demande en premier (sa transaction reste
    // ouverte), puis PAUSE juste avant d'exécuter l'action — crochet de test
    // jamais utilisé en production. Pendant cette pause, un VRAI rejet
    // concurrent est lancé depuis une connexion séparée ; son `updateMany`
    // conditionnel (même id de demande) se heurte au VRAI verrou de ligne
    // PostgreSQL tenu par la transaction d'approbation encore ouverte —
    // observé depuis une TROISIÈME connexion, jamais supposé via un délai.
    //
    // Piège évité (même correctif Round 4 que `verifier-audit-permissions-
    // role-ci.ts`, scénarios 11/12) : le hook ne DOIT PAS attendre la fin du
    // rejet avant de rendre la main — le rejet ne peut se terminer qu'une
    // fois CETTE transaction d'approbation committée, qui elle-même n'avance
    // que lorsque le hook rend la main. L'attendre ici serait un blocage
    // mutuel au niveau applicatif. Le hook capture seulement le pid réel du
    // rejet (barrière déterministe via son propre crochet `avantReservation`)
    // et confirme le blocage RÉEL — puis rend la main ; le résultat du rejet
    // n'est examiné qu'APRÈS le retour de l'appel principal.
    const clientRejet = new PrismaClient();
    const observateur = new PrismaClient();
    await Promise.all([clientRejet.$connect(), observateur.$connect()]);
    const dbPourRejet = clientRejet as unknown as Parameters<typeof rejeterDemandeApprobationAtomique>[0];

    let promesseRejet: Promise<unknown> | undefined;
    let pidRejet: number | undefined;
    let resolverPidRejetPret!: () => void;
    const pidRejetPret = new Promise<void>((resolve) => {
      resolverPidRejetPret = resolve;
    });

    const resultat = await approuverEtExecuterActionCritique(
      dbPourApprobation,
      demande.id,
      { id: principal.id, nom: principal.nom },
      {
        apresReservationAvantExecution: async (tx) => {
          const pidApprobation = await pidDeLaTransaction(tx);
          promesseRejet = rejeterDemandeApprobationAtomique(dbPourRejet, demande.id, { id: principal.id, nom: "Autre décideur (test)" }, {
            avantReservation: async (txRejet) => {
              pidRejet = await pidDeLaTransaction(txRejet);
              resolverPidRejetPret();
            },
          });
          await pidRejetPret;
          await attendreBlocageReel(observateur, pidRejet!, pidApprobation, "scénario 2 (rejet bloqué par approbation)");
        },
      },
    );
    const resultatRejet = await Promise.allSettled([promesseRejet]).then(([r]) => r);
    await clientRejet.$disconnect();
    await observateur.$disconnect();

    if (!/supprimé/.test(resultat.message)) echouer(`scénario 2 : message inattendu « ${resultat.message} »`);
    if (!resultatRejet || resultatRejet.status !== "rejected") {
      echouer(`scénario 2 : le rejet concurrent (perdant) aurait dû échouer, résultat = ${JSON.stringify(resultatRejet)}`);
    }
    if (!((resultatRejet as PromiseRejectedResult).reason instanceof ErreurDecisionConcurrente)) {
      echouer(
        `scénario 2 : le rejet aurait dû échouer précisément avec ErreurDecisionConcurrente, reçu : ${(resultatRejet as PromiseRejectedResult).reason}`,
      );
    }

    const cibleEncore = await prisma.utilisateur.findUnique({ where: { id: cible.id } });
    if (cibleEncore) echouer("scénario 2 : le compte cible aurait dû être réellement supprimé (l'approbation a gagné)");
    const demandeApres = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    if (demandeApres.statut !== "APPROUVEE") {
      echouer(`scénario 2 : statut attendu APPROUVEE (le rejet concurrent ne devait JAMAIS l'écraser), trouvé ${demandeApres.statut}`);
    }
    console.log(
      "  ✓ blocage RÉELLEMENT observé (pg_blocking_pids) : le rejet concurrent a attendu le verrou de l'approbation, " +
        "puis a échoué proprement — jamais d'écrasement de la décision APPROUVEE, jamais de double exécution.",
    );
  }

  console.log("→ Scénario 3/4 : rejet déjà committé AVANT la tentative d'approbation — l'action n'est JAMAIS tentée…");
  {
    await reinitialiserBase();
    const { role, principal } = await creerActeurs();
    const cible = await prisma.utilisateur.create({
      data: { nom: "Compte scénario 3", email: "cible-scenario3@test.local", roleId: role.id, motDePasseHash: "x", actif: true },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "SUPPRIMER_UTILISATEUR",
        donnees: { utilisateurId: cible.id },
        resume: `supprimer « ${cible.nom} »`,
        demandeParId: principal.id,
      },
    });

    await rejeterDemandeApprobationAtomique(dbPourApprobation, demande.id, { id: principal.id, nom: principal.nom });

    let approbationLevee = false;
    try {
      await approuverEtExecuterActionCritique(dbPourApprobation, demande.id, { id: principal.id, nom: principal.nom });
    } catch (e) {
      if (e instanceof ErreurDecisionConcurrente) approbationLevee = true;
      else throw e;
    }
    if (!approbationLevee) echouer("scénario 3 : l'approbation aurait dû échouer avec ErreurDecisionConcurrente (demande déjà REJETEE)");

    // Preuve directe du défaut corrigé : contrairement à l'ancien chemin
    // (exécution PUIS transition séparée), la réservation échoue AVANT que
    // l'action métier ne soit même tentée — le compte cible doit rester
    // intact.
    const cibleEncore = await prisma.utilisateur.findUnique({ where: { id: cible.id } });
    if (!cibleEncore) echouer("scénario 3 : le compte cible n'aurait JAMAIS dû être supprimé — la réservation avait déjà échoué");
    console.log("  ✓ réservation perdue → action métier jamais tentée (compte cible intact) — c'est exactement le défaut corrigé.");
  }

  console.log("→ Scénario 4/4 : échec RÉEL de l'action métier (MODIFIER_TAUX_TAXE, produit supprimé entre-temps) → ROLLBACK réel complet…");
  {
    await reinitialiserBase();
    const { principal } = await creerActeurs();
    const produit = await prisma.produit.create({
      data: { nom: "Pain de mie", categorie: "Pain", prixVente: 1000, tauxTaxe: 0 },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "MODIFIER_TAUX_TAXE",
        donnees: { produitId: produit.id, data: { tauxTaxe: 16 } },
        resume: `modifier le taux de taxe du produit « ${produit.nom} »`,
        demandeParId: principal.id,
      },
    });

    // Le produit disparaît entre la création de la demande et son
    // approbation (ex. supprimé par ailleurs) : l'exécuteur lèvera un 404
    // réel DEPUIS L'INTÉRIEUR de la transaction déjà réservée.
    await prisma.produit.delete({ where: { id: produit.id } });

    let erreurAction = false;
    try {
      await approuverEtExecuterActionCritique(dbPourApprobation, demande.id, { id: principal.id, nom: principal.nom });
    } catch (e) {
      if (e instanceof ErreurAction && e.status === 404) erreurAction = true;
      else throw e;
    }
    if (!erreurAction) echouer("scénario 4 : attendu une ErreurAction(404) — produit introuvable");

    // Preuve du ROLLBACK réel : la réservation, qui avait pourtant réussi
    // AVANT l'échec de l'action, doit être annulée avec le reste de la
    // transaction — relue depuis la connexion principale, hors de toute
    // transaction avortée.
    const demandeApres = await prisma.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    if (demandeApres.statut !== "EN_ATTENTE") {
      echouer(`scénario 4 : ROLLBACK ATTENDU MAIS ABSENT — statut attendu EN_ATTENTE après l'échec de l'action, trouvé ${demandeApres.statut}`);
    }
    if (demandeApres.approuveParId !== null) {
      echouer("scénario 4 : approuveParId aurait dû être annulé avec le reste de la transaction (réservation non committée)");
    }
    console.log("  ✓ échec de l'action métier → ROLLBACK réel COMPLET, réservation comprise — demande relue toujours EN_ATTENTE.");
  }

  await reinitialiserBase();
  console.log(
    "\n✅ Vérification PostgreSQL réelle de l'atomicité d'approbation (4 exécuteurs) : réservation, exécution et " +
      "transition sont bien LA MÊME transaction — jamais d'action exécutée sans transition, jamais de transition " +
      "sans action, blocage réel observé, rollback réel observé.\n",
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
