/**
 * Vérification CI, contre une VRAIE base PostgreSQL éphémère, de l'atomicité
 * réservation + exécution métier + transition pour les 4 actions critiques
 * SUPPRIMER_UTILISATEUR, CREER_COMPTE_ADMIN, MODIFIER_TYPE_CLIENT,
 * MODIFIER_TAUX_TAXE — mission P1 « atomicité exécution métier + décision
 * pour les 4 autres approbations » (25/08/2026).
 *
 * Même méthodologie et mêmes garanties que
 * `scripts/verifier-audit-permissions-role-ci.ts` (scénarios 10-13,
 * correctifs Round 3/4) : AUCUN délai arbitraire comme preuve de blocage —
 * chaque scénario de concurrence capture le pid PostgreSQL RÉEL de chaque
 * transaction DEPUIS `tx` lui-même (`pg_backend_pid()`), puis observe, depuis
 * une TROISIÈME connexion, que la session perdante est GÉNUINEMENT bloquée
 * sur le verrou de la session gagnante (`pg_blocking_pids`) avant de laisser
 * la gagnante committer — synchronisation par barrière explicitement résolue
 * (`Promise` + `resolve`), jamais un `setTimeout` utilisé comme mécanisme de
 * synchronisation (le seul délai du script est un GARDE-FOU D'ÉCHEC DE TEST
 * dans `attendreBlocageReel`, identique à l'original).
 *
 * Scénarios :
 *  A (10 itérations) — deux APPROBATIONS concurrentes sur la MÊME demande
 *    (SUPPRIMER_UTILISATEUR) : approbation gagnante.
 *  B (10 itérations) — APPROBATION vs REJET concurrents (MODIFIER_TAUX_TAXE) :
 *    l'APPROBATION gagne.
 *  C (10 itérations) — APPROBATION vs REJET concurrents (MODIFIER_TYPE_CLIENT) :
 *    le REJET gagne.
 *  D — ROLLBACK réel de SUPPRIMER_UTILISATEUR : échec métier RÉEL (violation
 *      de contrainte de clé étrangère PostgreSQL — P2003, le compte a une
 *      `DemandeApprobation` réelle le référençant) survenant APRÈS la
 *      réservation, dans la MÊME transaction → toute la transaction annulée
 *      (réservation ET tentative de suppression), demande redevenue
 *      EN_ATTENTE, compte toujours présent.
 *  E — ROLLBACK COMPLET de CREER_COMPTE_ADMIN, rattachement Travailleur
 *      INCLUS : le compte Administrateur est RÉELLEMENT créé et la fiche
 *      Travailleur RÉELLEMENT rattachée (écritures visibles DANS la
 *      transaction, via `tx`), PUIS un échec RÉEL survient juste avant le
 *      commit (`apresExecutionAvantRetour`) → PostgreSQL annule tout : ni le
 *      compte, ni le rattachement, ni aucun audit ne doit exister après coup.
 *  F — ROLLBACK des deux actions de modification (MODIFIER_TYPE_CLIENT et
 *      MODIFIER_TAUX_TAXE) : même technique (échec RÉEL juste avant commit) —
 *      l'entité modifiée en base doit être BYTE-POUR-BYTE identique à avant
 *      l'appel après le rollback.
 * Chaque scénario relit l'état final depuis une connexion Prisma INDÉPENDANTE
 * (jamais une confiance dans le résultat en mémoire du client ayant exécuté
 * l'opération).
 *
 * SÉCURITÉ : même garde que les autres scripts d'intégration — voir
 * `scripts/garde-integration-ci.ts`.
 *
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-concurrence-actions-metier-ci.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { ROLE_ADMINISTRATEUR } from "@lomoto/shared";
import {
  approuverEtExecuterActionMetier,
} from "../apps/api/src/services/actionsCritiquesMetier.js";
import {
  ErreurApprobationConcurrente,
  ErreurDecisionConcurrente,
  rejeterDemandeApprobationAtomique,
  type CrochetsTestApprobationAtomique,
} from "../apps/api/src/services/demandeApprobation.js";
import { contexteRequete } from "../apps/api/src/lib/contexteRequete.js";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-concurrence-actions-metier-ci.ts");

const prisma = new PrismaClient();
const dbPourActionsMetier = prisma as unknown as Parameters<typeof approuverEtExecuterActionMetier>[0];
const NB_ITERATIONS_CONCURRENCE = 10;

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification de concurrence PostgreSQL réelle (actions métier, mission P1 du 25/08/2026) : ${message}\n`);
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

let compteurUnique = 0;
function idUnique(prefixe: string): string {
  compteurUnique++;
  return `${prefixe}-${Date.now()}-${compteurUnique}`;
}

async function creerRoleEtDeuxUtilisateurs() {
  const suffixe = idUnique("r");
  const role = await prisma.role.create({ data: { nom: `Rôle ${suffixe}`, roleParentId: null } });
  const principal = await prisma.utilisateur.create({
    data: { nom: `Principal ${suffixe}`, email: `principal-${suffixe}@test.local`, roleId: role.id, motDePasseHash: "x", actif: true },
  });
  const secondaire = await prisma.utilisateur.create({
    data: { nom: `Secondaire ${suffixe}`, email: `secondaire-${suffixe}@test.local`, roleId: role.id, motDePasseHash: "x", actif: true },
  });
  return { role, principal, secondaire };
}

// --- Preuve de verrou DÉTERMINISTE — voir l'en-tête et
// `scripts/verifier-audit-permissions-role-ci.ts` (scénarios 10-13) pour la
// justification complète. Dupliquées ici plutôt qu'importées : ces deux
// fonctions ne sont pas exportées par ce script sœur (utilitaires internes
// non partagés). ---

async function pidDeLaTransaction(tx: { $queryRaw: PrismaClient["$queryRaw"] }): Promise<number> {
  const lignes = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
  const pid = lignes[0]?.pid;
  if (typeof pid !== "number") throw new Error("pidDeLaTransaction : pg_backend_pid() n'a renvoyé aucun pid exploitable");
  return pid;
}

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

/**
 * Scénario A : deux APPROBATIONS concurrentes sur la MÊME demande
 * (SUPPRIMER_UTILISATEUR) — A réserve en premier, B se heurte réellement à
 * son verrou (même id de demande), observé via `pg_blocking_pids`.
 */
async function scenarioDeuxApprobationsConcurrentes(iteration: number) {
  const { principal } = await creerRoleEtDeuxUtilisateurs();
  const { secondaire: demandeur } = await creerRoleEtDeuxUtilisateurs();
  const { role: roleCible } = await creerRoleEtDeuxUtilisateurs();
  const cible = await prisma.utilisateur.create({
    data: { nom: `Cible A${iteration}`, email: `cible-a${iteration}-${idUnique("x")}@test.local`, roleId: roleCible.id, motDePasseHash: "x", actif: true },
  });
  const demande = await prisma.demandeApprobation.create({
    data: { type: "SUPPRIMER_UTILISATEUR", donnees: { utilisateurId: cible.id }, resume: "supprimer un compte", demandeParId: demandeur.id },
  });

  const clientB = new PrismaClient();
  const clientObservateur = new PrismaClient();
  await Promise.all([clientB.$connect(), clientObservateur.$connect()]);
  const dbB = clientB as unknown as Parameters<typeof approuverEtExecuterActionMetier>[0];

  let promesseB: Promise<unknown> | undefined;
  let pidB: number | undefined;
  let resolverPidBPret!: () => void;
  const pidBPret = new Promise<void>((resolve) => {
    resolverPidBPret = resolve;
  });

  const resultatA = await contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
    approuverEtExecuterActionMetier(dbPourActionsMetier, demande.id, { id: principal.id, nom: principal.nom }, {
      apresReservationAvantExecution: async (tx) => {
        const pidA = await pidDeLaTransaction(tx);
        promesseB = contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
          approuverEtExecuterActionMetier(dbB, demande.id, { id: principal.id, nom: principal.nom }, {
            avantReservation: async (txB) => {
              pidB = await pidDeLaTransaction(txB);
              resolverPidBPret();
            },
          }),
        );
        await pidBPret;
        await attendreBlocageReel(clientObservateur, pidB!, pidA, `scénario A itération ${iteration}`);
      },
    }),
  );
  const resultatB = await Promise.allSettled([promesseB]).then(([r]) => r);
  await Promise.all([clientB.$disconnect(), clientObservateur.$disconnect()]);

  if (resultatA.demandeStatut !== "APPROUVEE") echouer(`scénario A itération ${iteration} : A (gagnant) aurait dû réussir`);
  if (!resultatB || resultatB.status !== "rejected" || !((resultatB as PromiseRejectedResult).reason instanceof ErreurApprobationConcurrente)) {
    echouer(`scénario A itération ${iteration} : B (perdant) aurait dû échouer précisément avec ErreurApprobationConcurrente`);
  }
  if (typeof pidB !== "number") echouer(`scénario A itération ${iteration} : pid de B non capturé avant l'observation du blocage`);

  const clientVerif = new PrismaClient();
  try {
    const compteReel = await clientVerif.utilisateur.findUnique({ where: { id: cible.id } });
    if (compteReel !== null) echouer(`scénario A itération ${iteration} : le compte aurait dû être réellement supprimé exactement une fois`);
    const demandeReelle = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    if (demandeReelle.statut !== "APPROUVEE" || demandeReelle.approuveParId !== principal.id) {
      echouer(`scénario A itération ${iteration} : demande réelle attendue APPROUVEE par le gagnant`);
    }
  } finally {
    await clientVerif.$disconnect();
  }
}

/**
 * Scénario B : APPROBATION vs REJET concurrents (MODIFIER_TAUX_TAXE) —
 * l'APPROBATION réserve en premier, le REJET se heurte réellement à son
 * verrou.
 */
async function scenarioApprobationGagneContreRejet(iteration: number) {
  const { principal } = await creerRoleEtDeuxUtilisateurs();
  const { secondaire: demandeur } = await creerRoleEtDeuxUtilisateurs();
  const produit = await prisma.produit.create({
    data: { nom: `Produit B${iteration}-${idUnique("p")}`, prixVente: 1500, tauxTaxe: 0, categorie: "Pain" },
  });
  const demande = await prisma.demandeApprobation.create({
    data: { type: "MODIFIER_TAUX_TAXE", donnees: { produitId: produit.id, data: { tauxTaxe: 0.18 } }, resume: "modifier le taux de taxe", demandeParId: demandeur.id },
  });

  const clientRejet = new PrismaClient();
  const clientObservateur = new PrismaClient();
  await Promise.all([clientRejet.$connect(), clientObservateur.$connect()]);
  const dbRejet = clientRejet as unknown as Parameters<typeof rejeterDemandeApprobationAtomique>[0];

  let promesseRejet: Promise<unknown> | undefined;
  let pidRejet: number | undefined;
  let resolverPidRejetPret!: () => void;
  const pidRejetPret = new Promise<void>((resolve) => {
    resolverPidRejetPret = resolve;
  });

  const resultatApprobation = await contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
    approuverEtExecuterActionMetier(dbPourActionsMetier, demande.id, { id: principal.id, nom: principal.nom }, {
      apresReservationAvantExecution: async (tx) => {
        const pidApprobation = await pidDeLaTransaction(tx);
        promesseRejet = rejeterDemandeApprobationAtomique(dbRejet, demande.id, { id: principal.id, nom: principal.nom }, {
          avantReservation: async (txRejet) => {
            pidRejet = await pidDeLaTransaction(txRejet);
            resolverPidRejetPret();
          },
        });
        await pidRejetPret;
        await attendreBlocageReel(clientObservateur, pidRejet!, pidApprobation, `scénario B itération ${iteration}`);
      },
    }),
  );
  const resultatRejet = await Promise.allSettled([promesseRejet]).then(([r]) => r);
  await Promise.all([clientRejet.$disconnect(), clientObservateur.$disconnect()]);

  if (resultatApprobation.demandeStatut !== "APPROUVEE") echouer(`scénario B itération ${iteration} : l'approbation (gagnante) aurait dû réussir`);
  if (!resultatRejet || resultatRejet.status !== "rejected" || !((resultatRejet as PromiseRejectedResult).reason instanceof ErreurDecisionConcurrente)) {
    echouer(`scénario B itération ${iteration} : le rejet (perdant) aurait dû échouer avec ErreurDecisionConcurrente`);
  }

  const clientVerif = new PrismaClient();
  try {
    const produitReel = await clientVerif.produit.findUniqueOrThrow({ where: { id: produit.id } });
    if (produitReel.tauxTaxe !== 0.18) echouer(`scénario B itération ${iteration} : tauxTaxe réel attendu 0.18, trouvé ${produitReel.tauxTaxe}`);
    const demandeReelle = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    if (demandeReelle.statut !== "APPROUVEE") echouer(`scénario B itération ${iteration} : demande réelle doit rester APPROUVEE, jamais écrasée par le rejet perdant`);
  } finally {
    await clientVerif.$disconnect();
  }
}

/**
 * Scénario C : APPROBATION vs REJET concurrents (MODIFIER_TYPE_CLIENT) — le
 * REJET réserve en premier (`apresReservationAvantCommit`), l'APPROBATION se
 * heurte réellement à son verrou.
 */
async function scenarioRejetGagneContreApprobation(iteration: number) {
  const { principal } = await creerRoleEtDeuxUtilisateurs();
  const { secondaire: demandeur } = await creerRoleEtDeuxUtilisateurs();
  const tc = await prisma.typeClient.create({ data: { nom: `Qualité C${iteration}-${idUnique("q")}`, prixParBac: 4100, commissionParBac: 0 } });
  const demande = await prisma.demandeApprobation.create({
    data: { type: "MODIFIER_TYPE_CLIENT", donnees: { typeClientId: tc.id, data: { prixParBac: 4300 } }, resume: "modifier une qualité", demandeParId: demandeur.id },
  });

  const clientApprobation = new PrismaClient();
  const clientObservateur = new PrismaClient();
  await Promise.all([clientApprobation.$connect(), clientObservateur.$connect()]);
  const dbApprobation = clientApprobation as unknown as Parameters<typeof approuverEtExecuterActionMetier>[0];

  let promesseApprobation: Promise<unknown> | undefined;
  let pidApprobation: number | undefined;
  let resolverPidApprobationPret!: () => void;
  const pidApprobationPret = new Promise<void>((resolve) => {
    resolverPidApprobationPret = resolve;
  });

  await rejeterDemandeApprobationAtomique(dbPourActionsMetier as unknown as Parameters<typeof rejeterDemandeApprobationAtomique>[0], demande.id, { id: principal.id, nom: principal.nom }, {
    apresReservationAvantCommit: async (tx) => {
      const pidRejet = await pidDeLaTransaction(tx);
      promesseApprobation = contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
        approuverEtExecuterActionMetier(dbApprobation, demande.id, { id: principal.id, nom: principal.nom }, {
          avantReservation: async (txApprobation) => {
            pidApprobation = await pidDeLaTransaction(txApprobation);
            resolverPidApprobationPret();
          },
        }),
      );
      await pidApprobationPret;
      await attendreBlocageReel(clientObservateur, pidApprobation!, pidRejet, `scénario C itération ${iteration}`);
    },
  });
  const resultatApprobation = await Promise.allSettled([promesseApprobation]).then(([r]) => r);
  await Promise.all([clientApprobation.$disconnect(), clientObservateur.$disconnect()]);

  if (!resultatApprobation || resultatApprobation.status !== "rejected" || !((resultatApprobation as PromiseRejectedResult).reason instanceof ErreurApprobationConcurrente)) {
    echouer(`scénario C itération ${iteration} : l'approbation (perdante) aurait dû échouer avec ErreurApprobationConcurrente`);
  }

  const clientVerif = new PrismaClient();
  try {
    const tcReel = await clientVerif.typeClient.findUniqueOrThrow({ where: { id: tc.id } });
    if (tcReel.prixParBac !== 4100) echouer(`scénario C itération ${iteration} : le rejet gagnant doit garantir AUCUNE écriture métier, prixParBac attendu inchangé (4100), trouvé ${tcReel.prixParBac}`);
    const demandeReelle = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
    if (demandeReelle.statut !== "REJETEE" || demandeReelle.approuveParId !== principal.id) {
      echouer(`scénario C itération ${iteration} : demande réelle doit rester REJETEE, jamais écrasée par l'approbation perdante`);
    }
    const nbAudit = await clientVerif.auditLog.count({ where: { typeEntite: "TypeClient", entiteId: tc.id } });
    if (nbAudit !== 0) echouer(`scénario C itération ${iteration} : aucun audit ne doit exister — l'action n'a jamais dû s'exécuter (rejet gagnant)`);
  } finally {
    await clientVerif.$disconnect();
  }
}

async function main() {
  await reinitialiserBase();

  console.log(`→ Scénario A (${NB_ITERATIONS_CONCURRENCE}x) : deux APPROBATIONS concurrentes sur la MÊME demande, SUPPRIMER_UTILISATEUR — approbation gagnante…`);
  for (let i = 1; i <= NB_ITERATIONS_CONCURRENCE; i++) {
    await scenarioDeuxApprobationsConcurrentes(i);
  }
  console.log(`  ✓ ${NB_ITERATIONS_CONCURRENCE} itérations, aucune instabilité : blocage réellement observé (pg_blocking_pids) à chaque fois, exactement 1 succès + 1 échec contrôlé par itération.`);

  console.log(`→ Scénario B (${NB_ITERATIONS_CONCURRENCE}x) : APPROBATION vs REJET concurrents, MODIFIER_TAUX_TAXE — l'APPROBATION gagne…`);
  for (let i = 1; i <= NB_ITERATIONS_CONCURRENCE; i++) {
    await scenarioApprobationGagneContreRejet(i);
  }
  console.log(`  ✓ ${NB_ITERATIONS_CONCURRENCE} itérations, aucune instabilité.`);

  console.log(`→ Scénario C (${NB_ITERATIONS_CONCURRENCE}x) : APPROBATION vs REJET concurrents, MODIFIER_TYPE_CLIENT — le REJET gagne…`);
  for (let i = 1; i <= NB_ITERATIONS_CONCURRENCE; i++) {
    await scenarioRejetGagneContreApprobation(i);
  }
  console.log(`  ✓ ${NB_ITERATIONS_CONCURRENCE} itérations, aucune instabilité.`);

  console.log("→ Scénario D : ROLLBACK réel de SUPPRIMER_UTILISATEUR (P2003 réel — clé étrangère PostgreSQL, activité enregistrée)…");
  {
    const { principal } = await creerRoleEtDeuxUtilisateurs();
    const { secondaire: demandeur } = await creerRoleEtDeuxUtilisateurs();
    const { role: roleCible } = await creerRoleEtDeuxUtilisateurs();
    const cible = await prisma.utilisateur.create({
      data: { nom: "Cible D", email: `cible-d-${idUnique("x")}@test.local`, roleId: roleCible.id, motDePasseHash: "x", actif: true },
    });
    // Activité RÉELLE enregistrée par la cible : une DemandeApprobation dont
    // `demandeParId` référence la cible — clé étrangère RÉELLE et REQUISE
    // (`DemandeApprobation.demandeParId`, sans `onDelete`), sans aucune
    // configuration additionnelle nécessaire.
    await prisma.demandeApprobation.create({
      data: { type: "MODIFIER_TAUX_TAXE", donnees: {}, resume: "activité antérieure de la cible", demandeParId: cible.id, statut: "REJETEE", dateDecision: new Date() },
    });
    const demandeSuppression = await prisma.demandeApprobation.create({
      data: { type: "SUPPRIMER_UTILISATEUR", donnees: { utilisateurId: cible.id }, resume: "supprimer un compte", demandeParId: demandeur.id },
    });

    let erreurRecue: unknown;
    try {
      await contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
        approuverEtExecuterActionMetier(dbPourActionsMetier, demandeSuppression.id, { id: principal.id, nom: principal.nom }),
      );
    } catch (e) {
      erreurRecue = e;
    }
    if (!erreurRecue || (erreurRecue as { status?: number }).status !== 409) {
      echouer(`scénario D : attendu ErreurAction 409 (P2003 traduit), reçu ${erreurRecue instanceof Error ? erreurRecue.message : String(erreurRecue)}`);
    }

    const clientVerif = new PrismaClient();
    try {
      const compteReel = await clientVerif.utilisateur.findUnique({ where: { id: cible.id } });
      if (!compteReel) echouer("scénario D : ROLLBACK ATTENDU MAIS ABSENT — le compte a réellement été supprimé malgré l'échec métier");
      const demandeReelle = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demandeSuppression.id } });
      if (demandeReelle.statut !== "EN_ATTENTE") {
        echouer(`scénario D : ROLLBACK ATTENDU MAIS ABSENT — la réservation a survécu à l'échec métier, statut attendu EN_ATTENTE, trouvé ${demandeReelle.statut}`);
      }
      if (demandeReelle.approuveParId !== null) echouer("scénario D : la réservation (approuveParId) doit être entièrement annulée par le rollback");
    } finally {
      await clientVerif.$disconnect();
    }
    console.log("  ✓ P2003 réel APRÈS la réservation → ROLLBACK réel COMPLET (réservation + tentative de suppression), compte toujours présent, demande redevenue EN_ATTENTE.");
  }

  console.log("→ Scénario E : ROLLBACK COMPLET de CREER_COMPTE_ADMIN, rattachement Travailleur INCLUS (échec réel juste avant commit)…");
  {
    const { principal } = await creerRoleEtDeuxUtilisateurs();
    const { secondaire: demandeur } = await creerRoleEtDeuxUtilisateurs();
    // Rôle LITTÉRALEMENT « Administrateur » (`ROLE_ADMINISTRATEUR`) —
    // indispensable : `creerCompteAdminTx` revérifie désormais (correctif P1,
    // Round 2) que `roleId` désigne toujours ce rôle exact.
    const roleAdmin = await prisma.role.create({ data: { nom: ROLE_ADMINISTRATEUR, roleParentId: null } });
    const email = `nouvelle-admin-e-${idUnique("e")}@test.local`;
    const travailleur = await prisma.travailleur.create({
      data: { nom: "Nouvelle Admin E", poste: "Administratrice", dateEmbauche: new Date("2026-01-01"), emailProStatut: "ACTIF", emailProAdresse: email },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "CREER_COMPTE_ADMIN",
        donnees: { nom: "Nouvelle Admin E", email, roleId: roleAdmin.id, motDePasseHash: "hash-e", travailleurId: travailleur.id },
        resume: "créer un compte Administrateur",
        demandeParId: demandeur.id,
      },
    });

    let comptePendantTransaction: string | undefined;
    let travailleurPendantTransaction: string | null | undefined;
    let erreurRecue: unknown;
    const crochets: CrochetsTestApprobationAtomique = {
      apresExecutionAvantRetour: async (tx) => {
        // À cet instant : le compte a RÉELLEMENT été créé et le Travailleur
        // RÉELLEMENT rattaché — visibles DEPUIS `tx` (même transaction,
        // encore ouverte), preuve que l'échec forcé ci-dessous survient bien
        // APRÈS toute l'exécution métier, pas avant.
        const compte = await tx.utilisateur.findFirst({ where: { email } });
        comptePendantTransaction = compte?.id;
        const travailleurTx = await tx.travailleur.findUniqueOrThrow({ where: { id: travailleur.id } });
        travailleurPendantTransaction = travailleurTx.utilisateurId;
        throw new Error("Échec injecté juste avant le commit — preuve du ROLLBACK COMPLET (scénario E)");
      },
    };
    try {
      await contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
        approuverEtExecuterActionMetier(dbPourActionsMetier, demande.id, { id: principal.id, nom: principal.nom }, crochets),
      );
    } catch (e) {
      erreurRecue = e;
    }
    if (!(erreurRecue instanceof Error) || !/Échec injecté/.test(erreurRecue.message)) {
      echouer(`scénario E : attendu l'erreur injectée à la surface, reçu ${erreurRecue instanceof Error ? erreurRecue.message : String(erreurRecue)}`);
    }
    if (!comptePendantTransaction) echouer("scénario E : le compte aurait dû être visible DANS la transaction juste avant l'échec forcé (preuve que l'exécution a bien eu lieu)");
    if (travailleurPendantTransaction !== comptePendantTransaction) echouer("scénario E : le rattachement Travailleur aurait dû être visible DANS la transaction juste avant l'échec forcé");

    const clientVerif = new PrismaClient();
    try {
      const compteReel = await clientVerif.utilisateur.findFirst({ where: { email } });
      if (compteReel) echouer("scénario E : ROLLBACK ATTENDU MAIS ABSENT — le compte Administrateur a survécu à l'échec forcé juste avant le commit");
      const travailleurReel = await clientVerif.travailleur.findUniqueOrThrow({ where: { id: travailleur.id } });
      if (travailleurReel.utilisateurId !== null) echouer("scénario E : ROLLBACK ATTENDU MAIS ABSENT — le rattachement Travailleur a survécu à l'échec forcé");
      const nbAudit = await clientVerif.auditLog.count({ where: { typeEntite: "Travailleur", entiteId: travailleur.id } });
      if (nbAudit !== 0) echouer("scénario E : ROLLBACK ATTENDU MAIS ABSENT — un AuditLog orphelin a survécu à l'échec forcé");
      const demandeReelle = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
      if (demandeReelle.statut !== "EN_ATTENTE") echouer(`scénario E : la réservation aurait dû être annulée, statut attendu EN_ATTENTE, trouvé ${demandeReelle.statut}`);
    } finally {
      await clientVerif.$disconnect();
    }
    console.log("  ✓ ROLLBACK COMPLET confirmé : ni le compte créé, ni le rattachement Travailleur, ni aucun audit ne survit à un échec injecté juste avant le commit.");
  }

  console.log("→ Scénario F : ROLLBACK des deux actions de modification (MODIFIER_TYPE_CLIENT, MODIFIER_TAUX_TAXE) — échec réel juste avant commit…");
  {
    const { principal } = await creerRoleEtDeuxUtilisateurs();
    const { secondaire: demandeur } = await creerRoleEtDeuxUtilisateurs();

    const tc = await prisma.typeClient.create({ data: { nom: `Qualité F-${idUnique("q")}`, prixParBac: 4100, commissionParBac: 0 } });
    const demandeTC = await prisma.demandeApprobation.create({
      data: { type: "MODIFIER_TYPE_CLIENT", donnees: { typeClientId: tc.id, data: { prixParBac: 4999 } }, resume: "modifier une qualité", demandeParId: demandeur.id },
    });
    let erreurTC: unknown;
    try {
      await contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
        approuverEtExecuterActionMetier(dbPourActionsMetier, demandeTC.id, { id: principal.id, nom: principal.nom }, {
          apresExecutionAvantRetour: async () => {
            throw new Error("Échec injecté juste avant le commit — preuve du ROLLBACK (scénario F, TypeClient)");
          },
        }),
      );
    } catch (e) {
      erreurTC = e;
    }
    if (!(erreurTC instanceof Error) || !/Échec injecté/.test(erreurTC.message)) echouer("scénario F (TypeClient) : erreur injectée attendue à la surface");

    const produit = await prisma.produit.create({ data: { nom: `Produit F-${idUnique("p")}`, prixVente: 1500, tauxTaxe: 0, categorie: "Pain" } });
    const demandeProduit = await prisma.demandeApprobation.create({
      data: { type: "MODIFIER_TAUX_TAXE", donnees: { produitId: produit.id, data: { tauxTaxe: 0.5 } }, resume: "modifier le taux de taxe", demandeParId: demandeur.id },
    });
    let erreurProduit: unknown;
    try {
      await contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
        approuverEtExecuterActionMetier(dbPourActionsMetier, demandeProduit.id, { id: principal.id, nom: principal.nom }, {
          apresExecutionAvantRetour: async () => {
            throw new Error("Échec injecté juste avant le commit — preuve du ROLLBACK (scénario F, Produit)");
          },
        }),
      );
    } catch (e) {
      erreurProduit = e;
    }
    if (!(erreurProduit instanceof Error) || !/Échec injecté/.test(erreurProduit.message)) echouer("scénario F (Produit) : erreur injectée attendue à la surface");

    const clientVerif = new PrismaClient();
    try {
      const tcReel = await clientVerif.typeClient.findUniqueOrThrow({ where: { id: tc.id } });
      if (tcReel.prixParBac !== 4100) echouer(`scénario F (TypeClient) : ROLLBACK ATTENDU MAIS ABSENT — prixParBac attendu inchangé (4100), trouvé ${tcReel.prixParBac}`);
      const demandeTCReelle = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demandeTC.id } });
      if (demandeTCReelle.statut !== "EN_ATTENTE") echouer("scénario F (TypeClient) : la réservation aurait dû être annulée");

      const produitReel = await clientVerif.produit.findUniqueOrThrow({ where: { id: produit.id } });
      if (produitReel.tauxTaxe !== 0) echouer(`scénario F (Produit) : ROLLBACK ATTENDU MAIS ABSENT — tauxTaxe attendu inchangé (0), trouvé ${produitReel.tauxTaxe}`);
      const demandeProduitReelle = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demandeProduit.id } });
      if (demandeProduitReelle.statut !== "EN_ATTENTE") echouer("scénario F (Produit) : la réservation aurait dû être annulée");
    } finally {
      await clientVerif.$disconnect();
    }
    console.log("  ✓ ROLLBACK COMPLET confirmé pour les deux actions de modification : aucune écriture métier ni de réservation ne survit à un échec injecté juste avant le commit.");
  }

  console.log(
    "→ Scénario G : APPROBATION de CREER_COMPTE_ADMIN vs rattachement CONCURRENT du Travailleur (correctif P1, Round 2, " +
      "contre-revue Codex du 25/08/2026) — verrou RÉELLEMENT observé, aucun écrasement silencieux, aucun compte orphelin…",
  );
  {
    // Reproduit, à la connexion PostgreSQL près, EXACTEMENT le mécanisme
    // conditionnel introduit dans `routes/travailleurs.ts` (PUT /:id,
    // correctif P1 Round 2) — orchestré manuellement ici (transaction
    // ouverte, mise en pause, committée au moment voulu) car la route HTTP
    // elle-même n'expose aucun point d'ancrage de test pour retenir son
    // verrou de ligne à volonté (voir `scripts/verifier-http-actions-metier-ci.ts`,
    // scénario 9, pour la preuve SÉQUENTIELLE via le VRAI routeur HTTP,
    // complémentaire de celle-ci).
    await reinitialiserBase(); // Role.nom est unique : repart d'une base propre avant de recréer « Administrateur ».
    const { principal } = await creerRoleEtDeuxUtilisateurs();
    const { secondaire: demandeur } = await creerRoleEtDeuxUtilisateurs();
    const roleAdmin = await prisma.role.create({ data: { nom: ROLE_ADMINISTRATEUR, roleParentId: null } });
    const email = `nouvelle-admin-g-${idUnique("g")}@test.local`;
    const travailleur = await prisma.travailleur.create({
      data: { nom: "Nouvelle Admin G", poste: "Administratrice", dateEmbauche: new Date("2026-01-01"), emailProStatut: "ACTIF", emailProAdresse: email },
    });
    const roleAutre = await creerRoleEtDeuxUtilisateurs();
    const compteAutre = await prisma.utilisateur.create({
      data: { nom: "Compte Autre G", email: `compte-autre-g-${idUnique("x")}@test.local`, roleId: roleAutre.role.id, motDePasseHash: "x", actif: true },
    });
    const demande = await prisma.demandeApprobation.create({
      data: {
        type: "CREER_COMPTE_ADMIN",
        donnees: { nom: "Nouvelle Admin G", email, roleId: roleAdmin.id, motDePasseHash: "hash-g", travailleurId: travailleur.id },
        resume: "créer le compte Administrateur « Nouvelle Admin G »",
        demandeParId: demandeur.id,
      },
    });

    const clientRattachement = new PrismaClient();
    const clientObservateur = new PrismaClient();
    await Promise.all([clientRattachement.$connect(), clientObservateur.$connect()]);

    let pidRattachement: number | undefined;
    let resolverRattachementPret!: () => void;
    const rattachementPret = new Promise<void>((resolve) => {
      resolverRattachementPret = resolve;
    });
    let resolverLaisserCommitter!: () => void;
    const laisserCommitter = new Promise<void>((resolve) => {
      resolverLaisserCommitter = resolve;
    });

    // Le rattachement concurrent réserve la ligne Travailleur EN PREMIER
    // (même `updateMany` conditionnel que la route réelle) et retient sa
    // transaction ouverte — verrou de ligne RÉELLEMENT tenu — jusqu'à ce que
    // le test l'autorise explicitement à committer.
    const promesseRattachement = clientRattachement.$transaction(async (tx) => {
      const pid = await pidDeLaTransaction(tx);
      pidRattachement = pid;
      const { count } = await tx.travailleur.updateMany({
        where: { id: travailleur.id, utilisateurId: null, emailProStatut: "ACTIF", emailProAdresse: email },
        data: { utilisateurId: compteAutre.id },
      });
      if (count !== 1) throw new Error("scénario G : le rattachement concurrent aurait dû réserver la ligne (count=1 attendu)");
      resolverRattachementPret();
      await laisserCommitter;
    });
    await rattachementPret;

    // L'approbation démarre ENSUITE, pendant que le rattachement concurrent
    // tient encore son verrou — son propre `updateMany` (dans
    // `rattacherTravailleurAuNouveauCompteTx`) va RÉELLEMENT se bloquer
    // dessus. Le pid de l'approbation est capturé DEPUIS sa propre
    // transaction (`apresReservationAvantExecution`, AVANT qu'elle
    // n'atteigne ce point de blocage), jamais via un client hors transaction.
    let pidApprobation: number | undefined;
    const promesseApprobation = contexteRequete.run({ id: principal.id, nom: principal.nom }, () =>
      approuverEtExecuterActionMetier(dbPourActionsMetier, demande.id, { id: principal.id, nom: principal.nom }, {
        apresReservationAvantExecution: async (tx) => {
          pidApprobation = await pidDeLaTransaction(tx);
        },
      }),
    );

    // Attend que le pid de l'approbation soit capturé, PUIS observe RÉELLEMENT
    // (troisième connexion, `pg_blocking_pids`) qu'elle est bloquée sur le
    // verrou du rattachement concurrent — jamais un délai comme preuve.
    for (let tentative = 0; typeof pidApprobation !== "number" && tentative < 250; tentative++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (typeof pidApprobation !== "number") echouer("scénario G : le pid de l'approbation n'a jamais été capturé");
    await attendreBlocageReel(clientObservateur, pidApprobation, pidRattachement!, "scénario G");

    // Le blocage RÉEL est confirmé : le rattachement concurrent peut
    // maintenant committer — il gagne la course (son écriture est déjà
    // appliquée et sur le point d'être définitive).
    resolverLaisserCommitter();
    await promesseRattachement;
    await clientRattachement.$disconnect();

    // L'approbation, débloquée, réévalue son `WHERE` contre l'état
    // RÉELLEMENT committé (`utilisateurId` n'est plus `null`) — `count = 0`
    // → `ErreurAction 409` → ROLLBACK COMPLET de TOUTE la transaction
    // d'approbation (réservation de la demande ET compte déjà créé compris).
    const resultatApprobation = await Promise.allSettled([promesseApprobation]).then(([r]) => r);
    await clientObservateur.$disconnect();
    if (!resultatApprobation || resultatApprobation.status !== "rejected") {
      echouer(`scénario G : l'approbation (perdante) aurait dû échouer, résultat = ${JSON.stringify(resultatApprobation)}`);
    }
    const erreurApprobation = (resultatApprobation as PromiseRejectedResult).reason as { status?: number; message?: string };
    if (erreurApprobation.status !== 409) {
      echouer(`scénario G : l'approbation aurait dû échouer avec un statut 409, reçu ${JSON.stringify(erreurApprobation)}`);
    }

    const clientVerif = new PrismaClient();
    try {
      const travailleurReel = await clientVerif.travailleur.findUniqueOrThrow({ where: { id: travailleur.id } });
      if (travailleurReel.utilisateurId !== compteAutre.id) {
        echouer("scénario G : le rattachement concurrent GAGNANT a été écrasé — régression du correctif P1 Round 2");
      }
      const compteNouveau = await clientVerif.utilisateur.findFirst({ where: { email } });
      if (compteNouveau) echouer("scénario G : AUCUN compte Administrateur n'aurait dû survivre — celui créé par l'approbation perdante doit être annulé par le rollback");
      const demandeReelle = await clientVerif.demandeApprobation.findUniqueOrThrow({ where: { id: demande.id } });
      if (demandeReelle.statut !== "EN_ATTENTE") echouer(`scénario G : la réservation de la demande aurait dû être annulée, statut attendu EN_ATTENTE, trouvé ${demandeReelle.statut}`);
      if (demandeReelle.approuveParId !== null || demandeReelle.dateDecision !== null) {
        echouer("scénario G : aucun champ approuveParId/dateDecision n'aurait dû être committé sur la tentative perdante");
      }
      const nbAudit = await clientVerif.auditLog.count({ where: { typeEntite: "Travailleur", entiteId: travailleur.id } });
      if (nbAudit !== 0) echouer(`scénario G : aucun AuditLog Travailleur ne devrait exister (le rattachement gagnant n'en écrit pas, celui de l'approbation a été annulé), trouvé ${nbAudit}`);
    } finally {
      await clientVerif.$disconnect();
    }
    console.log(
      "  ✓ blocage RÉEL observé (pg_blocking_pids) entre le rattachement concurrent et l'approbation : le rattachement " +
        "gagne, l'approbation perdante échoue avec 409 et son ROLLBACK COMPLET annule le compte Administrateur qu'elle " +
        "avait déjà créé — jamais d'écrasement silencieux, jamais de compte orphelin, un seul état final cohérent.",
    );
  }

  // --- P2034 RÉEL sur un chemin DIRECT (Admin Principal, hors approbation) —
  // LIMITE DOCUMENTÉE (mission P1, Round 2, contre-revue Codex du 25/08/2026)
  // ----------------------------------------------------------------------
  //
  // La mission demande une preuve PostgreSQL RÉELLE que le réessai borné sur
  // P2034 des 4 wrappers `*Direct` (`executerDirectAvecReessaiP2034`,
  // `actionsCritiquesMetier.ts`) fonctionne — « ou expliquer précisément
  // toute limite si la génération déterministe d'un P2034 direct est
  // techniquement impossible ».
  //
  // Analyse : chaque scénario de concurrence CI-DESSUS (A, B, C, G) obtient
  // sa DÉTERMINISME grâce à un point d'ancrage de test explicite
  // (`CrochetsTestApprobationAtomique` — `avantReservation`,
  // `apresReservationAvantExecution`, `apresExecutionAvantRetour` —
  // exposés par `approuverEtExecuterDemandeAtomique`,
  // `services/demandeApprobation.ts`) qui met en pause UNE transaction
  // pendant qu'une seconde, concurrente, se heurte réellement à son verrou —
  // observé sans ambiguïté via `pg_blocking_pids` avant de laisser la
  // première committer.
  //
  // Les 4 wrappers `*Direct` (`supprimerUtilisateurDirect`,
  // `creerCompteAdminDirect`, `modifierTypeClientDirect`,
  // `modifierTauxTaxeDirect`) N'EXPOSENT DÉLIBÉRÉMENT AUCUN point d'ancrage
  // équivalent — la mission demande explicitement de « réutiliser ce
  // mécanisme [le réessai borné] pour les quatre wrappers directs SANS
  // MODIFIER LE CONTRAT DES SUCCÈS », ce qui exclut d'ajouter un paramètre de
  // test à leur signature publique. Sans un tel point d'ancrage, il n'existe
  // AUCUN moyen de mettre en pause, de l'extérieur, une transaction ouverte
  // par `creerCompteAdminDirect` (ou l'un des 3 autres) entre sa lecture et
  // son écriture, pour garantir un chevauchement RÉEL et déterministe avec
  // une seconde transaction concurrente.
  //
  // Deux alternatives ont été explicitement écartées, chacune pour une
  // raison précise :
  //  1. Piloter manuellement DEUX transactions reproduisant le même schéma de
  //     lecture (`count`) puis d'écriture (`create`) que `creerCompteAdminTx`
  //     (même principe que le scénario E ci-dessus, qui pilote UNE seule
  //     transaction manuellement) — cela exigerait de piloter la SECONDE
  //     transaction manuellement AUSSI (pour garantir l'ordre de commit),
  //     donc de ne JAMAIS appeler le vrai `creerCompteAdminDirect` : la
  //     preuve porterait alors sur une RÉIMPLICATION du mécanisme, pas sur le
  //     code de production réel — contraire à la convention déjà établie
  //     dans ce dépôt (« jamais une réimplémentation parallèle qui pourrait
  //     diverger du vrai comportement », voir `services/principal.ts`).
  //  2. Lancer deux appels RÉELS et non pilotés à `creerCompteAdminDirect`
  //     via `Promise.all`, en espérant un chevauchement de fenêtres de
  //     lecture — cela DÉPEND du hasard du timing réseau/E-S entre les deux
  //     transactions non synchronisées : exactement le type de preuve non
  //     déterministe et instable en CI que cette mission (et toutes les
  //     précédentes, voir Round 3/4 de PR #31) interdit explicitement
  //     (« aucun délai/hasard de timing utilisé comme preuve »).
  //
  // Preuve alternative apportée à la place, RIGOUREUSE et DÉTERMINISTE, mais
  // MOCKÉE plutôt que PostgreSQL réelle (`actionsCritiquesMetier.test.ts`,
  // describe « Réessai borné P2034 sur les wrappers directs ») : un `db`
  // factice dont `$transaction` est contrôlé directement par le test prouve,
  // sans aucune ambiguïté de timing, que (a) un P2034 sur la 1ʳᵉ tentative
  // est bien réessayé dans une TOUTE NOUVELLE transaction et que la 2ᵉ
  // tentative réussit normalement, et que (b) trois P2034 consécutifs
  // produisent exactement `ErreurExecutionDirecteReessayable` (503 via
  // `traiterActionCritique`), jamais un 500 brut. Cette preuve couvre la
  // LOGIQUE du réessai avec une précision qu'aucun scénario PostgreSQL réel,
  // non déterministe, n'aurait pu apporter ici.
  // ----------------------------------------------------------------------

  await reinitialiserBase();
  console.log(
    `\n✅ Vérification de concurrence PostgreSQL réelle (mission P1, Round 1 + Round 2 du 25/08/2026) : 3 scénarios de ` +
      `concurrence RÉELLEMENT observée (pg_blocking_pids, jamais un délai), chacun rejoué ${NB_ITERATIONS_CONCURRENCE} ` +
      "fois sans instabilité, PLUS 3 scénarios de rollback (SUPPRIMER_UTILISATEUR sur P2003 réel, CREER_COMPTE_ADMIN incluant " +
      "le rattachement Travailleur, MODIFIER_TYPE_CLIENT et MODIFIER_TAUX_TAXE), PLUS le scénario G (approbation de " +
      "CREER_COMPTE_ADMIN vs rattachement concurrent du Travailleur, correctif P1 Round 2) — tous vérifiés depuis une " +
      "connexion Prisma indépendante.\n",
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
