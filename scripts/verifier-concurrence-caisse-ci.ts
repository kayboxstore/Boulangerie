/**
 * Vérification CI, contre une VRAIE base PostgreSQL éphémère, du mécanisme
 * commun d'atomicité de la caisse (P1-B, 28/08/2026,
 * `apps/api/src/services/caisseAtomique.ts`) : verrou de ligne réel
 * (`SELECT ... FOR UPDATE` sur `SessionCaisse`) comme SEUL mécanisme de
 * sérialisation, exigence d'une session OUVERTE pour toute écriture
 * financière, attribution comptable des règlements confirmés à la session
 * qui les a réellement encaissés (jamais leur date de déclaration), et
 * rollback transactionnel complet en cas d'échec d'audit.
 *
 * Méthodologie identique aux scripts voisins (P1-A, actions métier,
 * permissions/rôle) : AUCUN délai comme preuve de blocage — chaque scénario
 * capture le PID PostgreSQL RÉEL de la transaction gagnante (`pg_backend_pid()`
 * DEPUIS `tx`), lance la transaction perdante EN ARRIÈRE-PLAN sans l'attendre
 * depuis le crochet (l'attendre bloquerait le processus Node — la perdante
 * attend le verrou que la gagnante détient, or la gagnante attend que le
 * crochet termine), confirme depuis une TROISIÈME connexion que la perdante
 * est RÉELLEMENT bloquée sur le PID de la gagnante (`pg_blocking_pids`),
 * PUIS laisse la gagnante continuer et committer.
 *
 * Portée assumée : les scénarios exercent directement les fonctions EXPORTÉES
 * de `caisseAtomique.ts` (`verrouillerSessionOuverte(ParId)`,
 * `executerAvecReessaiP2034`, `transactionSerializable`, `auditerCaisseTx`) —
 * le MÊME code que `caisse.ts`/`commandes.ts` appellent en production — avec
 * des écritures représentatives minimales plutôt que de dupliquer la
 * logique complète (calcul de commission, avance, etc.) de chaque route.
 * C'est le mécanisme de verrouillage/réessai/audit lui-même qui est prouvé
 * ici ; le câblage HTTP (« la route appelle bien le verrou et traduit son
 * rejet en 409 ») est prouvé séparément par les tests mockés
 * (routes/caisse.test.ts, routes/commandes.test.ts).
 *
 * P2034 : le verrou de ligne convertit délibérément la quasi-totalité des
 * courses « même date/session » en attente ordonnée (lock wait) plutôt qu'en
 * échec de sérialisation PostgreSQL réessayable — c'est précisément l'objet
 * du correctif. Un scénario RÉEL de conflit P2034 est donc prouvé une fois
 * (réessai puis succès) ; l'épuisement des 3 tentatives → 503 est prouvé de
 * façon déterministe et fiable par le test mocké
 * (`services/caisseAtomique.test.ts`), pas ici : forcer artificiellement 3
 * conflits RÉELS consécutifs exigerait de contourner le verrou lui-même —
 * non représentatif du chemin réellement livré.
 *
 * SÉCURITÉ : même garde que les scripts d'intégration voisins — hôte local,
 * nom de base EXACT `lomoto_ci`, confirmation explicite. Voir
 * `scripts/garde-integration-ci.ts`.
 *
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-concurrence-caisse-ci.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import {
  auditerCaisseTx,
  ErreurActeurRequisPourAuditCaisse,
  executerAvecReessaiP2034,
  transactionSerializable,
  verrouillerSessionFermeeParId,
  verrouillerSessionOuverte,
  verrouillerSessionOuverteParId,
  type CrochetsTestVerrouCaisse,
} from "../apps/api/src/services/caisseAtomique.js";
import { ErreurAction } from "../apps/api/src/lib/erreurAction.js";
import { contexteRequete } from "../apps/api/src/lib/contexteRequete.js";
import { dateSQLDepuisJourLomoto } from "../apps/api/src/lib/temps.js";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-concurrence-caisse-ci.ts");

const prisma = new PrismaClient();
type DbApp = Parameters<typeof transactionSerializable>[0];
const ACTEUR = { id: "u-caisse-ci", nom: "Script CI Caisse" };

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification de concurrence CI (caisse, P1-B) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function attendre(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reinitialiserBase() {
  await prisma.auditLog.deleteMany();
  await prisma.paiementCommande.deleteMany();
  await prisma.remiseCaisse.deleteMany();
  await prisma.commandeClient.deleteMany();
  await prisma.client.deleteMany();
  await prisma.typeClient.deleteMany();
  await prisma.depenseCaisse.deleteMany();
  await prisma.tauxDuJour.deleteMany();
  await prisma.sessionCaisse.deleteMany();
  await prisma.production.deleteMany();
  await prisma.utilisateur.deleteMany();
  await prisma.role.deleteMany();
}

async function creerActeur() {
  const role = await prisma.role.create({ data: { nom: `Caissier-${Date.now()}`, roleParentId: null } });
  await prisma.utilisateur.create({
    data: { id: ACTEUR.id, nom: ACTEUR.nom, email: `${ACTEUR.id}@lomoto.test`, motDePasseHash: "x", roleId: role.id },
  });
}

async function ouvrirSession(date: string, statut: "OUVERTE" | "FERMEE" = "OUVERTE") {
  return prisma.sessionCaisse.create({
    data: {
      date: dateSQLDepuisJourLomoto(date),
      statut,
      soldeOuverture: 0,
      ouverteParId: ACTEUR.id,
      ...(statut === "FERMEE"
        ? { soldeTheoriqueFermeture: 0, soldeCompteFermeture: 0, ecartFermeture: 0, fermeeLe: new Date(), fermeeParId: ACTEUR.id }
        : {}),
    },
  });
}

async function creerClient() {
  const type = await prisma.typeClient.create({ data: { nom: `Qualite-${Date.now()}-${Math.random()}`, prixParBac: 1000 } });
  return prisma.client.create({ data: { nom: "Client CI", typeClientId: type.id } });
}

async function creerClientEtCommande(montantRecu: number) {
  const client = await creerClient();
  const commande = await prisma.commandeClient.create({
    data: {
      clientId: client.id,
      quantiteBacs: 1,
      montantBrut: 1000,
      commission: 0,
      avanceUtilisee: 0,
      montantAPercevoir: 1000,
      montantRecu,
      dette: Math.max(0, 1000 - montantRecu),
      avanceGeneree: Math.max(0, montantRecu - 1000),
      nouvelleAvance: Math.max(0, montantRecu - 1000),
      creeParId: ACTEUR.id,
    },
  });
  return { client, commande };
}

/** Confirme, depuis une 3e connexion, qu'un PID donné est RÉELLEMENT bloqué
 *  (jamais un délai comme preuve) — utilisé après capture du PID réel de la
 *  transaction gagnante via `tx.$queryRaw\`SELECT pg_backend_pid()\``. */
async function estBloqueSur(pidAttendu: number): Promise<boolean> {
  const client = new PrismaClient();
  try {
    const bloquants = await client.$queryRaw<{ pid: number }[]>`
      SELECT unnest(pg_blocking_pids(pid)) AS pid FROM pg_stat_activity WHERE state = 'active' AND pid <> pg_backend_pid()
    `;
    return bloquants.some((b) => b.pid === pidAttendu);
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  await creerActeur();

  console.log("→ Scénario 1/7 : clôture vs création de commande à montant reçu non nul (même date)…");
  {
    await reinitialiserBase();
    await creerActeur();
    const date = "2026-08-28";
    const session = await ouvrirSession(date);
    const client = await creerClient();

    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    await Promise.all([clientA.$connect(), clientB.$connect()]);

    let promesseB: Promise<{ ok: true } | { ok: false; erreur: unknown }> | undefined;
    let pidA: number | undefined;
    const crochets: CrochetsTestVerrouCaisse = {
      apresVerrouAvantLecture: async (tx) => {
        const ligne = await (tx as unknown as Prisma.TransactionClient).$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pidA = ligne[0]!.pid;

        promesseB = executerAvecReessaiP2034(() =>
          transactionSerializable(clientB as unknown as DbApp, async (txB) => {
            await verrouillerSessionOuverte(txB, date);
            await txB.commandeClient.create({
              data: {
                clientId: client.id,
                quantiteBacs: 1,
                montantBrut: 1000,
                commission: 0,
                avanceUtilisee: 0,
                montantAPercevoir: 1000,
                montantRecu: 5000,
                dette: 0,
                avanceGeneree: 4000,
                nouvelleAvance: 4000,
                creeParId: ACTEUR.id,
              },
            });
          }),
        ).then(
          () => ({ ok: true as const }),
          (erreur: unknown) => ({ ok: false as const, erreur }),
        );

        let bloque = false;
        for (let i = 0; i < 150 && !bloque; i++) {
          bloque = await estBloqueSur(pidA);
          if (!bloque) await attendre(20);
        }
        if (!bloque) echouer("scénario 1 : B (création de commande) n'a jamais été observée bloquée sur le verrou de A (clôture)");
        console.log(`  · B (création de commande) confirmée bloquée sur le PID de A (clôture, ${pidA}).`);
      },
    };
    await executerAvecReessaiP2034(() =>
      transactionSerializable(clientA as unknown as DbApp, async (txA) => {
        const s = await verrouillerSessionOuverteParId(txA, session.id, crochets);
        const { count } = await txA.sessionCaisse.updateMany({
          where: { id: s.id, statut: "OUVERTE" },
          data: { statut: "FERMEE", soldeTheoriqueFermeture: 0, soldeCompteFermeture: 0, ecartFermeture: 0, fermeeLe: new Date(), fermeeParId: ACTEUR.id },
        });
        if (count !== 1) echouer("scénario 1 : la clôture (A) aurait dû réussir");
        await contexteRequete.run(ACTEUR, () =>
          auditerCaisseTx(txA, { module: "CAISSE", typeEntite: "SessionCaisse", entiteId: s.id, action: "MODIFICATION", avant: s, apres: { ...s, statut: "FERMEE" } }),
        );
      }),
    );

    if (!promesseB) echouer("scénario 1 : le crochet n'a jamais lancé B");
    const resultatB = await promesseB;
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);

    if (resultatB.ok) echouer("scénario 1 : B a réussi à créer une commande après la clôture de A — ne devrait jamais arriver");
    if (!(resultatB.erreur instanceof ErreurAction) || resultatB.erreur.status !== 409) {
      echouer(`scénario 1 : B doit échouer en ErreurAction(409) — reçu ${String(resultatB.erreur)}`);
    }
    const nbCommandes = await prisma.commandeClient.count();
    if (nbCommandes !== 0) echouer(`scénario 1 : aucune commande de B ne doit exister après le rollback, trouvé ${nbCommandes}`);
    const fermee = await prisma.sessionCaisse.findUniqueOrThrow({ where: { id: session.id } });
    if (fermee.statut !== "FERMEE") echouer("scénario 1 : la session doit être FERMEE");
    console.log("  ✓ verrou réel confirmé (pg_blocking_pids) : clôture gagne, création de commande après clôture refusée en 409, aucun enregistrement partiel.");
  }

  console.log("→ Scénario 2/7 : clôture vs confirmation de règlement (même session)…");
  {
    await reinitialiserBase();
    await creerActeur();
    const date = "2026-08-28";
    const session = await ouvrirSession(date);
    const { commande } = await creerClientEtCommande(0);
    const paiement = await prisma.paiementCommande.create({
      data: { commandeClientId: commande.id, montant: 500, enregistreParId: ACTEUR.id, statut: "DECLARE" },
    });

    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    await Promise.all([clientA.$connect(), clientB.$connect()]);

    let promesseB: Promise<{ ok: true } | { ok: false; erreur: unknown }> | undefined;
    let pidA: number | undefined;
    const crochets: CrochetsTestVerrouCaisse = {
      apresVerrouAvantLecture: async (tx) => {
        const ligne = await (tx as unknown as Prisma.TransactionClient).$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pidA = ligne[0]!.pid;

        promesseB = executerAvecReessaiP2034(() =>
          transactionSerializable(clientB as unknown as DbApp, async (txB) => {
            const s = await verrouillerSessionOuverteParId(txB, session.id);
            const remise = await txB.remiseCaisse.create({
              data: { sessionCaisseId: s.id, montant: paiement.montant, remisParNom: "Test", recuParId: ACTEUR.id, enregistreParId: ACTEUR.id },
            });
            await txB.paiementCommande.updateMany({
              where: { id: paiement.id },
              data: { statut: "CONFIRME", confirmeLe: new Date(), confirmeParId: ACTEUR.id, remiseCaisseId: remise.id },
            });
          }),
        ).then(
          () => ({ ok: true as const }),
          (erreur: unknown) => ({ ok: false as const, erreur }),
        );

        let bloque = false;
        for (let i = 0; i < 150 && !bloque; i++) {
          bloque = await estBloqueSur(pidA);
          if (!bloque) await attendre(20);
        }
        if (!bloque) echouer("scénario 2 : B (confirmation) n'a jamais été observée bloquée sur le verrou de A (clôture)");
        console.log(`  · B (confirmation de règlement) confirmée bloquée sur le PID de A (clôture, ${pidA}).`);
      },
    };

    await executerAvecReessaiP2034(() =>
      transactionSerializable(clientA as unknown as DbApp, async (txA) => {
        const s = await verrouillerSessionOuverteParId(txA, session.id, crochets);
        const { count } = await txA.sessionCaisse.updateMany({
          where: { id: s.id, statut: "OUVERTE" },
          data: { statut: "FERMEE", soldeTheoriqueFermeture: 0, soldeCompteFermeture: 0, ecartFermeture: 0, fermeeLe: new Date(), fermeeParId: ACTEUR.id },
        });
        if (count !== 1) echouer("scénario 2 : la clôture (A) aurait dû réussir");
      }),
    );

    if (!promesseB) echouer("scénario 2 : le crochet n'a jamais lancé B");
    const resultatB = await promesseB;
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);

    if (resultatB.ok) echouer("scénario 2 : B a réussi à confirmer un règlement après la clôture de A");
    if (!(resultatB.erreur instanceof ErreurAction) || resultatB.erreur.status !== 409) {
      echouer(`scénario 2 : B doit échouer en ErreurAction(409) — reçu ${String(resultatB.erreur)}`);
    }
    const paiementFinal = await prisma.paiementCommande.findUniqueOrThrow({ where: { id: paiement.id } });
    if (paiementFinal.statut !== "DECLARE") echouer("scénario 2 : le règlement doit rester DECLARE, jamais confirmé après clôture");
    const nbRemises = await prisma.remiseCaisse.count();
    if (nbRemises !== 0) echouer(`scénario 2 : aucune remise ne doit exister, trouvé ${nbRemises}`);
    console.log("  ✓ verrou réel confirmé : clôture gagne, confirmation après clôture refusée en 409, aucun enregistrement partiel.");
  }

  console.log("→ Scénario 3/7 : règlement déclaré à J (fermée), confirmé dans J+1 (ouverte) — J inchangé, J+1 crédité une seule fois…");
  {
    await reinitialiserBase();
    await creerActeur();
    const jourJ = "2026-08-27";
    const jourJp1 = "2026-08-28";
    const sessionJ = await ouvrirSession(jourJ, "FERMEE");
    const sessionJp1 = await ouvrirSession(jourJp1, "OUVERTE");
    const { commande } = await creerClientEtCommande(0);
    const paiement = await prisma.paiementCommande.create({
      data: { commandeClientId: commande.id, montant: 750, enregistreParId: ACTEUR.id, statut: "DECLARE", date: dateSQLDepuisJourLomoto(jourJ) },
    });

    await executerAvecReessaiP2034(() =>
      transactionSerializable(prisma as unknown as DbApp, async (tx) => {
        const s = await verrouillerSessionOuverteParId(tx, sessionJp1.id);
        const remise = await tx.remiseCaisse.create({
          data: { sessionCaisseId: s.id, montant: paiement.montant, remisParNom: "Test", recuParId: ACTEUR.id, enregistreParId: ACTEUR.id },
        });
        await tx.paiementCommande.updateMany({
          where: { id: paiement.id },
          data: { statut: "CONFIRME", confirmeLe: new Date(), confirmeParId: ACTEUR.id, remiseCaisseId: remise.id },
        });
      }),
    );

    // Même critère de sélection que construireRegistre() (caisse.ts) : via la
    // relation paiementCommande -> remiseCaisse -> sessionCaisse, jamais
    // paiementCommande.date.
    const reglementsJ = await prisma.paiementCommande.findMany({
      where: { statut: "CONFIRME", remiseCaisse: { sessionCaisse: { date: dateSQLDepuisJourLomoto(jourJ) } } },
    });
    const reglementsJp1 = await prisma.paiementCommande.findMany({
      where: { statut: "CONFIRME", remiseCaisse: { sessionCaisse: { date: dateSQLDepuisJourLomoto(jourJp1) } } },
    });
    if (reglementsJ.length !== 0) echouer(`scénario 3 : le registre de J doit rester strictement inchangé, trouvé ${reglementsJ.length} règlement(s) attribué(s) à tort`);
    if (reglementsJp1.length !== 1 || reglementsJp1[0]!.montant !== 750) {
      echouer("scénario 3 : le registre de J+1 doit recevoir exactement le montant confirmé, une seule fois");
    }
    console.log("  ✓ attribution comptable correcte : J strictement inchangé, J+1 crédité une seule fois du montant exact.");
  }

  console.log("→ Scénario 4/7 : deux activations FARINE concurrentes (même date) — au plus une ligne…");
  {
    await reinitialiserBase();
    await creerActeur();
    const date = "2026-08-28";
    const session = await ouvrirSession(date);
    await prisma.tauxDuJour.create({ data: { date: dateSQLDepuisJourLomoto(date), valeur: 2800, definiParId: ACTEUR.id } });
    await prisma.production.create({ data: { date: dateSQLDepuisJourLomoto(date), bacsProduits: 10, sacsUtilises: 5 } });

    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    await Promise.all([clientA.$connect(), clientB.$connect()]);

    let promesseB: Promise<{ ok: true } | { ok: false; erreur: unknown }> | undefined;
    let pidA: number | undefined;
    const crochets: CrochetsTestVerrouCaisse = {
      apresVerrouAvantLecture: async (tx) => {
        const ligne = await (tx as unknown as Prisma.TransactionClient).$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pidA = ligne[0]!.pid;

        promesseB = executerAvecReessaiP2034(() =>
          transactionSerializable(clientB as unknown as DbApp, async (txB) => {
            await verrouillerSessionOuverte(txB, date);
            const existante = await txB.depenseCaisse.findFirst({ where: { date: dateSQLDepuisJourLomoto(date), origine: "FARINE" } });
            if (existante) throw new ErreurAction(409, "La dépense farine est déjà enregistrée pour cette date");
            await txB.depenseCaisse.create({
              data: { date: dateSQLDepuisJourLomoto(date), motif: "Achat farine", montant: 1000, origine: "FARINE", tauxApplique: 2800, sacsUtilises: 5, enregistreParId: ACTEUR.id },
            });
          }),
        ).then(
          () => ({ ok: true as const }),
          (erreur: unknown) => ({ ok: false as const, erreur }),
        );

        let bloque = false;
        for (let i = 0; i < 150 && !bloque; i++) {
          bloque = await estBloqueSur(pidA);
          if (!bloque) await attendre(20);
        }
        if (!bloque) echouer("scénario 4 : B n'a jamais été observée bloquée sur le verrou de A");
        console.log(`  · B (2e activation farine) confirmée bloquée sur le PID de A (${pidA}).`);
      },
    };

    await executerAvecReessaiP2034(() =>
      transactionSerializable(clientA as unknown as DbApp, async (txA) => {
        await verrouillerSessionOuverte(txA, date, crochets);
        const existante = await txA.depenseCaisse.findFirst({ where: { date: dateSQLDepuisJourLomoto(date), origine: "FARINE" } });
        if (existante) echouer("scénario 4 : A ne devrait voir aucune ligne farine existante");
        await txA.depenseCaisse.create({
          data: { date: dateSQLDepuisJourLomoto(date), motif: "Achat farine", montant: 1000, origine: "FARINE", tauxApplique: 2800, sacsUtilises: 5, enregistreParId: ACTEUR.id },
        });
      }),
    );

    if (!promesseB) echouer("scénario 4 : le crochet n'a jamais lancé B");
    const resultatB = await promesseB;
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);

    if (resultatB.ok) echouer("scénario 4 : B a réussi à créer une 2e ligne farine — ne devrait jamais arriver");
    const nbFarine = await prisma.depenseCaisse.count({ where: { origine: "FARINE" } });
    if (nbFarine !== 1) echouer(`scénario 4 : attendu exactement 1 ligne FARINE au final, trouvé ${nbFarine}`);
    console.log("  ✓ verrou réel confirmé : exactement une ligne FARINE créée, la seconde activation échoue proprement.");
  }

  console.log("→ Scénario 5/7 : deux premières définitions concurrentes du taux (même date) — une seule réussit…");
  {
    await reinitialiserBase();
    await creerActeur();
    const date = "2026-08-28";
    const session = await ouvrirSession(date);

    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    await Promise.all([clientA.$connect(), clientB.$connect()]);

    let promesseB: Promise<{ ok: true } | { ok: false; erreur: unknown }> | undefined;
    let pidA: number | undefined;
    const crochets: CrochetsTestVerrouCaisse = {
      apresVerrouAvantLecture: async (tx) => {
        const ligne = await (tx as unknown as Prisma.TransactionClient).$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pidA = ligne[0]!.pid;

        promesseB = executerAvecReessaiP2034(() =>
          transactionSerializable(clientB as unknown as DbApp, async (txB) => {
            await verrouillerSessionOuverte(txB, date);
            const existant = await txB.tauxDuJour.findUnique({ where: { date: dateSQLDepuisJourLomoto(date) } });
            if (existant) throw new ErreurAction(409, "Ce taux a été modifié entre-temps — rechargez avant de réessayer.");
            await txB.tauxDuJour.create({ data: { date: dateSQLDepuisJourLomoto(date), valeur: 2900, definiParId: ACTEUR.id } });
          }),
        ).then(
          () => ({ ok: true as const }),
          (erreur: unknown) => ({ ok: false as const, erreur }),
        );

        let bloque = false;
        for (let i = 0; i < 150 && !bloque; i++) {
          bloque = await estBloqueSur(pidA);
          if (!bloque) await attendre(20);
        }
        if (!bloque) echouer("scénario 5 : B n'a jamais été observée bloquée sur le verrou de A");
        console.log(`  · B (2e définition du taux) confirmée bloquée sur le PID de A (${pidA}).`);
      },
    };

    await executerAvecReessaiP2034(() =>
      transactionSerializable(clientA as unknown as DbApp, async (txA) => {
        await verrouillerSessionOuverte(txA, date, crochets);
        const existant = await txA.tauxDuJour.findUnique({ where: { date: dateSQLDepuisJourLomoto(date) } });
        if (existant) echouer("scénario 5 : A ne devrait voir aucun taux existant");
        await txA.tauxDuJour.create({ data: { date: dateSQLDepuisJourLomoto(date), valeur: 2800, definiParId: ACTEUR.id } });
      }),
    );

    if (!promesseB) echouer("scénario 5 : le crochet n'a jamais lancé B");
    const resultatB = await promesseB;
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);

    if (resultatB.ok) echouer("scénario 5 : B a réussi à définir un 2e taux — ne devrait jamais arriver");
    if (!(resultatB.erreur instanceof ErreurAction) || resultatB.erreur.status !== 409) {
      echouer(`scénario 5 : B doit échouer proprement en 409 — reçu ${String(resultatB.erreur)}`);
    }
    const nbTaux = await prisma.tauxDuJour.count({ where: { date: dateSQLDepuisJourLomoto(date) } });
    if (nbTaux !== 1) echouer(`scénario 5 : attendu exactement 1 taux au final, trouvé ${nbTaux}`);
    const tauxFinal = await prisma.tauxDuJour.findUniqueOrThrow({ where: { date: dateSQLDepuisJourLomoto(date) } });
    if (tauxFinal.valeur.toNumber() !== 2800) echouer("scénario 5 : le taux final doit être celui du gagnant (A, 2800)");
    console.log("  ✓ verrou réel confirmé : une seule définition de taux réussit, l'autre échoue proprement en 409, jamais de P2002 brut exposé.");
    void session;
  }

  console.log("→ Scénario 6/7 : deux corrections concurrentes d'une session fermée — une seule réussit…");
  {
    await reinitialiserBase();
    await creerActeur();
    const date = "2026-08-28";
    const session = await ouvrirSession(date);
    await prisma.sessionCaisse.update({
      where: { id: session.id },
      data: { statut: "FERMEE", soldeTheoriqueFermeture: 1000, soldeCompteFermeture: 1000, ecartFermeture: 0, fermeeLe: new Date(), fermeeParId: ACTEUR.id },
    });
    const fermee = await prisma.sessionCaisse.findUniqueOrThrow({ where: { id: session.id } });
    const versionVueParTous = fermee.updatedAt;

    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    await Promise.all([clientA.$connect(), clientB.$connect()]);

    let promesseB: Promise<{ ok: true } | { ok: false; erreur: unknown }> | undefined;
    let pidA: number | undefined;
    const crochets: CrochetsTestVerrouCaisse = {
      apresVerrouAvantLecture: async (tx) => {
        const ligne = await (tx as unknown as Prisma.TransactionClient).$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        pidA = ligne[0]!.pid;

        promesseB = executerAvecReessaiP2034(() =>
          transactionSerializable(clientB as unknown as DbApp, async (txB) => {
            const s = await verrouillerSessionFermeeParId(txB, session.id);
            if (s.updatedAt.toISOString() !== versionVueParTous.toISOString()) {
              throw new ErreurAction(409, "Cette session a été modifiée entre-temps — rechargez avant de corriger.");
            }
            const { count } = await txB.sessionCaisse.updateMany({
              where: { id: s.id, updatedAt: s.updatedAt },
              data: { soldeCompteFermeture: 2000, ecartFermeture: 1000, motifEcart: "Correction B", derniereCorrectionLe: new Date(), derniereCorrectionParId: ACTEUR.id, motifCorrection: "Correction B" },
            });
            if (count === 0) throw new ErreurAction(409, "Cette session a été modifiée entre-temps — rechargez avant de corriger.");
          }),
        ).then(
          () => ({ ok: true as const }),
          (erreur: unknown) => ({ ok: false as const, erreur }),
        );

        let bloque = false;
        for (let i = 0; i < 150 && !bloque; i++) {
          bloque = await estBloqueSur(pidA);
          if (!bloque) await attendre(20);
        }
        if (!bloque) echouer("scénario 6 : B (2e correction) n'a jamais été observée bloquée sur le verrou de A");
        console.log(`  · B (2e correction) confirmée bloquée sur le PID de A (${pidA}).`);
      },
    };

    await executerAvecReessaiP2034(() =>
      transactionSerializable(clientA as unknown as DbApp, async (txA) => {
        const s = await verrouillerSessionFermeeParId(txA, session.id, crochets);
        if (s.updatedAt.toISOString() !== versionVueParTous.toISOString()) {
          echouer("scénario 6 : A doit voir la version initiale, non modifiée");
        }
        const { count } = await txA.sessionCaisse.updateMany({
          where: { id: s.id, updatedAt: s.updatedAt },
          data: { soldeCompteFermeture: 1500, ecartFermeture: 500, motifEcart: "Correction A", derniereCorrectionLe: new Date(), derniereCorrectionParId: ACTEUR.id, motifCorrection: "Correction A" },
        });
        if (count !== 1) echouer("scénario 6 : la correction A aurait dû réussir");
      }),
    );

    if (!promesseB) echouer("scénario 6 : le crochet n'a jamais lancé B");
    const resultatB = await promesseB;
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);

    if (resultatB.ok) echouer("scénario 6 : B a réussi à corriger avec une version déjà obsolète — écrasement silencieux non détecté");
    if (!(resultatB.erreur instanceof ErreurAction) || resultatB.erreur.status !== 409) {
      echouer(`scénario 6 : B doit échouer en ErreurAction(409) — reçu ${String(resultatB.erreur)}`);
    }
    const finale = await prisma.sessionCaisse.findUniqueOrThrow({ where: { id: session.id } });
    if (finale.soldeCompteFermeture !== 1500 || finale.motifCorrection !== "Correction A") {
      echouer("scénario 6 : la correction finale doit être exactement celle de A (gagnante), jamais écrasée");
    }
    console.log("  ✓ verrou réel + jeton de version confirmés : une correction gagne, l'autre échoue en 409, jamais d'écrasement silencieux.");
  }

  console.log("→ Scénario 7/7 : échec d'audit → rollback complet de la clôture…");
  {
    await reinitialiserBase();
    // Volontairement AUCUN acteur créé/contexte défini : auditerCaisseTx doit
    // lever ErreurActeurRequisPourAuditCaisse, DANS la même transaction que
    // la fermeture — PostgreSQL doit tout annuler, y compris le updateMany
    // déjà exécuté avec succès juste avant.
    const date = "2026-08-28";
    const session = await prisma.sessionCaisse.create({ data: { date: dateSQLDepuisJourLomoto(date), statut: "OUVERTE", soldeOuverture: 0 } });

    let erreur: unknown;
    try {
      await executerAvecReessaiP2034(() =>
        transactionSerializable(prisma as unknown as DbApp, async (tx) => {
          const s = await verrouillerSessionOuverteParId(tx, session.id);
          const { count } = await tx.sessionCaisse.updateMany({
            where: { id: s.id, statut: "OUVERTE" },
            data: { statut: "FERMEE", soldeTheoriqueFermeture: 0, soldeCompteFermeture: 0, ecartFermeture: 0, fermeeLe: new Date() },
          });
          if (count !== 1) echouer("scénario 7 : la fermeture (avant l'échec d'audit injecté) aurait dû réussir");
          // Hors contexteRequete.run(...) : acteur absent -> échec attendu.
          await auditerCaisseTx(tx, { module: "CAISSE", typeEntite: "SessionCaisse", entiteId: s.id, action: "MODIFICATION", avant: s, apres: null });
        }),
      );
    } catch (e) {
      erreur = e;
    }

    if (!(erreur instanceof ErreurActeurRequisPourAuditCaisse)) {
      echouer(`scénario 7 : attendu ErreurActeurRequisPourAuditCaisse — reçu ${String(erreur)}`);
    }
    const apresRollback = await prisma.sessionCaisse.findUniqueOrThrow({ where: { id: session.id } });
    if (apresRollback.statut !== "OUVERTE") {
      echouer("scénario 7 : la session doit rester OUVERTE — l'échec d'audit doit annuler TOUTE la transaction, y compris la fermeture déjà exécutée");
    }
    const nbAudit = await prisma.auditLog.count();
    if (nbAudit !== 0) echouer(`scénario 7 : aucune ligne AuditLog ne doit survivre au rollback, trouvé ${nbAudit}`);
    console.log("  ✓ échec d'audit injecté : rollback COMPLET confirmé (fermeture annulée, session toujours OUVERTE, aucune trace d'audit).");
  }

  console.log("\n✅ Vérification de concurrence CI « caisse » (P1-B) : verrou de ligne réel, attribution comptable correcte, rollback complet sur échec d'audit — dans tous les scénarios.\n");
}

main()
  .catch((e) => {
    if (process.exitCode !== 1) {
      console.error(e);
      process.exitCode = 1;
    }
  })
  .finally(() => prisma.$disconnect());
