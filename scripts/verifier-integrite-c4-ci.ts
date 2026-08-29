/**
 * Vérification CI, contre une VRAIE base PostgreSQL éphémère, de l'intégrité
 * transactionnelle de la conversion C4 (round correctif Codex, 29/08/2026,
 * `apps/api/src/routes/cycles-livraison.ts`, action `CONFIRMER_ACCEPTATION`).
 *
 * Contexte du correctif : la PR #38 affirmait à tort que C4 est « sans impact
 * comptable » parce que la commande créée porte `montantRecu = 0`. C'est
 * inexact — C4 reste neutre pour les ESPÈCES et le SOLDE du registre de
 * caisse, mais modifie bien l'avance et la dette du CLIENT (`avanceDisponible`),
 * via des `update()` autrefois singuliers sur des modèles audités
 * (`Client`, `CycleLivraison`, `CycleLivraisonLigne` — voir lib/audit.ts,
 * MODELE_MODULE), donc interceptés par l'extension d'audit automatique NON
 * transactionnelle (services/caisseAtomique.ts) : un rollback aurait laissé
 * un AuditLog mensonger. Corrigé en `updateMany` + `auditerCaisseTx` manuel
 * (même mécanisme que caisse.ts/commandes.ts), sans imposer silencieusement
 * de session de caisse ouverte à C4 (décision métier explicitement hors de
 * ce lot — voir cycles-livraison.ts).
 *
 * Ce script prouve, contre PostgreSQL réel :
 *  1. Rollback complet d'une écriture C4 en cas d'échec d'audit injecté —
 *     même méthodologie que scripts/verifier-concurrence-caisse-ci.ts
 *     (scénario 7) : acteur de contexte de requête absent, la PREMIÈRE
 *     écriture auditée du chemin (CycleLivraisonLigne) lève
 *     `ErreurActeurRequisPourAuditCaisse` DANS la transaction — PostgreSQL
 *     annule tout, y compris l'écriture déjà exécutée avec succès juste
 *     avant. Aucune commande, aucune modification d'avance, aucune
 *     transition, aucun AuditLog ne doit subsister ; ce que la transaction
 *     n'a pas encore écrit au moment de l'échec ne peut par construction pas
 *     non plus survivre — la garantie ACID ne dépend pas du point précis où
 *     l'échec survient.
 *  2. Conflit de sérialisation RÉEL entre C4 et une autre écriture touchant
 *     le MÊME client (représentative du chemin manuel de commandes.ts, sans
 *     dupliquer sa logique complète) — jamais d'écrasement silencieux de
 *     l'avance, jamais d'état partiel, jamais un 500 Prisma brut : la
 *     transaction perdante lève proprement `PrismaClientKnownRequestError`
 *     P2034 (jamais retentée par C4 — POST /transitions traduit un P2034 en
 *     409 VERSION_OBSOLETE, voir repondreErreur dans cycles-livraison.ts).
 *     Entrelacement déterministe via le crochet de test
 *     `CrochetsTestTransitionCycle.apresLectureAvantEcriture` — jamais un
 *     délai comme synchronisation.
 *  3. Neutralité comptable de C4 sur une caisse déjà figée : une conversion
 *     C4 à `montantRecu = 0` livrée un jour déjà CLÔTURÉ ne modifie ni les
 *     `entrées`, ni `dettesPayees`, ni le `solde` du registre reconstruit
 *     pour ce jour (`construireRegistre`, caisse.ts) — exactement la
 *     formulation corrigée : « aucun mouvement d'espèces et aucun impact sur
 *     le solde du registre de caisse, mais modification possible de
 *     l'avance et de la dette du client ».
 *
 * SÉCURITÉ : même garde que les scripts d'intégration voisins — hôte local,
 * nom de base EXACT `lomoto_ci`, confirmation explicite. Voir
 * `scripts/garde-integration-ci.ts`.
 *
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-integrite-c4-ci.ts
 */
import { PrismaClient, Prisma } from "@prisma/client";
import {
  appliquerTransition,
  type CrochetsTestTransitionCycle,
} from "../apps/api/src/routes/cycles-livraison.js";
import { construireRegistre } from "../apps/api/src/routes/caisse.js";
import { ErreurActeurRequisPourAuditCaisse, transactionSerializable } from "../apps/api/src/services/caisseAtomique.js";
import { contexteRequete } from "../apps/api/src/lib/contexteRequete.js";
import { dateSQLDepuisJourLomoto } from "../apps/api/src/lib/temps.js";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-integrite-c4-ci.ts");

const prisma = new PrismaClient();
type DbApp = Parameters<typeof transactionSerializable>[0];
const ACTEUR = { id: "u-c4-ci", nom: "Script CI C4" };

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification d'intégrité CI (C4, round correctif Codex) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function reinitialiserBase() {
  await prisma.auditLog.deleteMany();
  await prisma.transitionCycleLivraison.deleteMany();
  await prisma.anomalieCycleLivraison.deleteMany();
  await prisma.cycleLivraisonLigne.deleteMany();
  await prisma.cycleLivraison.deleteMany();
  await prisma.schemaCommandeLigne.deleteMany();
  await prisma.schemaCommande.deleteMany();
  await prisma.paiementCommande.deleteMany();
  await prisma.remiseCaisse.deleteMany();
  await prisma.commandeClient.deleteMany();
  await prisma.client.deleteMany();
  await prisma.typeClient.deleteMany();
  await prisma.produit.deleteMany();
  await prisma.depenseCaisse.deleteMany();
  await prisma.tauxDuJour.deleteMany();
  await prisma.sessionCaisse.deleteMany();
  await prisma.production.deleteMany();
  await prisma.utilisateur.deleteMany();
  await prisma.role.deleteMany();
}

async function creerActeur() {
  const role = await prisma.role.create({ data: { nom: `Commandes-${Date.now()}-${Math.random()}`, roleParentId: null } });
  await prisma.utilisateur.create({
    data: { id: ACTEUR.id, nom: ACTEUR.nom, email: `${ACTEUR.id}@lomoto.test`, motDePasseHash: "x", roleId: role.id },
  });
}

async function creerProduit() {
  return prisma.produit.create({ data: { nom: `Carré-${Date.now()}-${Math.random()}`, prixVente: 1500, categorie: "Pain" } });
}

async function creerClient(avanceDisponible: number) {
  const type = await prisma.typeClient.create({
    data: { nom: `Qualite-${Date.now()}-${Math.random()}`, prixParBac: 4100, commissionParBac: 0 },
  });
  return prisma.client.create({ data: { nom: "Dépôt CI", typeClientId: type.id, avanceDisponible } });
}

/**
 * Construit un cycle EN_ATTENTE_CONFIRMATION prêt pour CONFIRMER_ACCEPTATION
 * (dépôt déjà confirmé : quantiteChargee=45, quantiteDeposee=43) — équivalent
 * de l'état laissé par le parcours réel des 6 transitions précédentes
 * (RETENIR_PRODUCTION → ... → SIGNALER_DEPOT), construit directement pour ne
 * pas dupliquer ce parcours déjà prouvé ailleurs
 * (routes/cyclesLivraison.parcoursComplet.test.ts).
 */
async function creerCyclePretPourAcceptation(clientId: string, produitId: string, date: string) {
  const schema = await prisma.schemaCommande.create({
    data: {
      date: dateSQLDepuisJourLomoto(date),
      clientId,
      lignes: { create: [{ produitId, quantite: 50 }] },
      cycle: {
        create: {
          statut: "EN_ATTENTE_CONFIRMATION",
          version: 7,
          lignes: { create: [{ produitId, quantiteChargee: 45, quantiteDeposee: 43 }] },
        },
      },
    },
    include: { cycle: { include: { lignes: true } } },
  });
  return { cycle: schema.cycle! };
}

async function main() {
  console.log("→ Scénario 1/3 : échec d'audit injecté → rollback COMPLET de la conversion C4…");
  {
    await reinitialiserBase();
    // Volontairement AUCUN acteur créé/contexte défini : auditerCaisseTx doit
    // lever ErreurActeurRequisPourAuditCaisse DANS la même transaction que
    // l'acceptation — PostgreSQL doit tout annuler, y compris l'updateMany
    // de la ligne déjà exécuté avec succès juste avant (même méthodologie
    // que scripts/verifier-concurrence-caisse-ci.ts, scénario 7).
    const type = await prisma.typeClient.create({ data: { nom: `Qualite-${Date.now()}`, prixParBac: 4100, commissionParBac: 0 } });
    const client = await prisma.client.create({ data: { nom: "Dépôt CI", typeClientId: type.id, avanceDisponible: 1000 } });
    const produit = await creerProduit();
    const { cycle } = await creerCyclePretPourAcceptation(client.id, produit.id, "2026-08-28");

    let erreur: unknown;
    try {
      await transactionSerializable(prisma as unknown as DbApp, (tx) =>
        appliquerTransition(
          tx,
          cycle.id,
          { action: "CONFIRMER_ACCEPTATION", version: 7, lignes: [{ produitId: produit.id, quantiteAcceptee: 40, quantiteRetournee: 3 }], bonRetourne: false },
          ACTEUR.id,
        ),
      );
    } catch (e) {
      erreur = e;
    }

    if (!(erreur instanceof ErreurActeurRequisPourAuditCaisse)) {
      echouer(`scénario 1 : attendu ErreurActeurRequisPourAuditCaisse — reçu ${String(erreur)}`);
    }
    const cycleApres = await prisma.cycleLivraison.findUniqueOrThrow({ where: { id: cycle.id } });
    if (cycleApres.statut !== "EN_ATTENTE_CONFIRMATION" || cycleApres.version !== 7 || cycleApres.commandeId !== null) {
      echouer("scénario 1 : le cycle doit rester strictement inchangé (statut, version, commandeId) après le rollback");
    }
    const ligneApres = await prisma.cycleLivraisonLigne.findFirstOrThrow({ where: { cycleId: cycle.id } });
    if (ligneApres.quantiteAcceptee !== null || ligneApres.quantiteRetournee !== null) {
      echouer("scénario 1 : la ligne du cycle ne doit porter aucune trace de l'acceptation annulée");
    }
    const clientApres = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    if (clientApres.avanceDisponible !== 1000) echouer("scénario 1 : l'avance du client ne doit pas avoir bougé");
    const nbCommandes = await prisma.commandeClient.count();
    if (nbCommandes !== 0) echouer(`scénario 1 : aucune commande ne doit exister après le rollback, trouvé ${nbCommandes}`);
    const nbTransitions = await prisma.transitionCycleLivraison.count();
    if (nbTransitions !== 0) echouer(`scénario 1 : aucune transition ne doit être journalisée après le rollback, trouvé ${nbTransitions}`);
    const nbAudit = await prisma.auditLog.count();
    if (nbAudit !== 0) echouer(`scénario 1 : aucune ligne AuditLog ne doit survivre au rollback, trouvé ${nbAudit}`);
    console.log("  ✓ échec d'audit injecté : rollback COMPLET confirmé (cycle, ligne, avance client, commande, transition, audit — tous inchangés/absents).");
  }

  console.log("→ Scénario 2/3 : conflit de sérialisation réel entre C4 et une autre écriture sur le MÊME client…");
  {
    await reinitialiserBase();
    await creerActeur();
    const client = await creerClient(1000);
    const produit = await creerProduit();
    const { cycle } = await creerCyclePretPourAcceptation(client.id, produit.id, "2026-08-28");

    const clientA = new PrismaClient();
    const clientB = new PrismaClient();
    await Promise.all([clientA.$connect(), clientB.$connect()]);

    let bEstTerminee = false;
    const crochets: CrochetsTestTransitionCycle = {
      apresLectureAvantEcriture: async () => {
        // B représente une autre écriture touchant le même Client (chemin
        // manuel de commandes.ts, écriture minimale représentative — sans
        // dupliquer sa logique complète, même convention que
        // verifier-concurrence-caisse-ci.ts). Exécutée et COMMITTÉE
        // entièrement AVANT que A ne reprenne, alors que l'instantané
        // SERIALIZABLE de A est déjà fixé (première requête de A :
        // chargerCycle, avant ce crochet) — entrelacement déterministe,
        // jamais un délai.
        await transactionSerializable(clientB as unknown as DbApp, async (txB) => {
          const c = await txB.client.findUniqueOrThrow({ where: { id: client.id } });
          const { count } = await txB.client.updateMany({ where: { id: c.id }, data: { avanceDisponible: c.avanceDisponible + 500 } });
          if (count !== 1) echouer("scénario 2 : B (écriture concurrente sur le client) aurait dû réussir");
        });
        bEstTerminee = true;
      },
    };

    let erreurA: unknown;
    await contexteRequete.run(ACTEUR, async () => {
      try {
        await transactionSerializable(clientA as unknown as DbApp, (tx) =>
          appliquerTransition(
            tx,
            cycle.id,
            { action: "CONFIRMER_ACCEPTATION", version: 7, lignes: [{ produitId: produit.id, quantiteAcceptee: 40, quantiteRetournee: 3 }], bonRetourne: true },
            ACTEUR.id,
            crochets,
          ),
        );
      } catch (e) {
        erreurA = e;
      }
    });
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);

    if (!bEstTerminee) echouer("scénario 2 : le crochet n'a jamais exécuté B jusqu'au bout");
    if (!erreurA) echouer("scénario 2 : A aurait dû échouer sur un conflit de sérialisation réel — a réussi à tort");
    if (!(erreurA instanceof Prisma.PrismaClientKnownRequestError) || erreurA.code !== "P2034") {
      echouer(`scénario 2 : A doit échouer en PrismaClientKnownRequestError P2034 (jamais un 500 brut) — reçu ${String(erreurA)}`);
    }
    const clientFinal = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    if (clientFinal.avanceDisponible !== 1500) {
      echouer(`scénario 2 : l'avance finale du client doit être EXACTEMENT celle de B (1500, jamais un mélange ni un écrasement) — trouvé ${clientFinal.avanceDisponible}`);
    }
    const nbCommandes = await prisma.commandeClient.count();
    if (nbCommandes !== 0) echouer(`scénario 2 : la commande de A (perdante) ne doit jamais exister, trouvé ${nbCommandes}`);
    const cycleFinal = await prisma.cycleLivraison.findUniqueOrThrow({ where: { id: cycle.id } });
    if (cycleFinal.statut !== "EN_ATTENTE_CONFIRMATION" || cycleFinal.version !== 7 || cycleFinal.commandeId !== null) {
      echouer("scénario 2 : le cycle de A (perdante) doit rester strictement inchangé — aucun état partiel");
    }
    console.log("  ✓ conflit de sérialisation réel confirmé (P2034, jamais un 500 brut) : B gagne sans écrasement, A échoue proprement sans aucun état partiel.");
  }

  console.log("→ Scénario 3/3 : conversion C4 (montantRecu=0) sur une caisse déjà figée — registre strictement inchangé…");
  {
    await reinitialiserBase();
    await creerActeur();
    const date = "2026-08-28";
    // Avance initiale positive : la conversion C4 doit la consommer
    // (avanceUtilisee), exactement le point du correctif — C4 modifie bien
    // l'avance/la dette du client, jamais « aucun impact comptable ».
    const client = await creerClient(1000);
    const produit = await creerProduit();

    // Baseline : une commande manuelle réglée le même jour pour un AUTRE
    // client, pour que le registre porte déjà des `entrées` non nulles
    // avant la conversion C4 — un client différent pour ne pas déclencher
    // à tort le garde-fou « une commande existe déjà pour ce client et ce
    // jour » (contrôle applicatif de appliquerTransition, sans rapport avec
    // ce scénario).
    const clientBaseline = await creerClient(0);
    await prisma.commandeClient.create({
      data: {
        clientId: clientBaseline.id,
        quantiteBacs: 2,
        montantBrut: 8200,
        commission: 0,
        avanceUtilisee: 0,
        montantAPercevoir: 8200,
        montantRecu: 8200,
        dette: 0,
        avanceGeneree: 0,
        nouvelleAvance: 0,
        creeParId: ACTEUR.id,
        dateOperationnelle: dateSQLDepuisJourLomoto(date),
      },
    });
    const session = await prisma.sessionCaisse.create({
      data: {
        date: dateSQLDepuisJourLomoto(date),
        statut: "FERMEE",
        soldeOuverture: 0,
        soldeTheoriqueFermeture: 8200,
        soldeCompteFermeture: 8200,
        ecartFermeture: 0,
        fermeeLe: new Date(),
      },
    });

    const registreAvant = await construireRegistre(prisma, date);

    const { cycle } = await creerCyclePretPourAcceptation(client.id, produit.id, date);
    await contexteRequete.run(ACTEUR, () =>
      transactionSerializable(prisma as unknown as DbApp, (tx) =>
        appliquerTransition(
          tx,
          cycle.id,
          { action: "CONFIRMER_ACCEPTATION", version: 7, lignes: [{ produitId: produit.id, quantiteAcceptee: 40, quantiteRetournee: 3 }], bonRetourne: true },
          ACTEUR.id,
        ),
      ),
    );

    const commandeC4 = await prisma.commandeClient.findFirstOrThrow({ where: { clientId: client.id, montantRecu: 0 } });
    if (commandeC4.dateOperationnelle?.toISOString().slice(0, 10) !== date) {
      echouer("scénario 3 : la commande C4 doit être rattachée au jour de livraison déjà figé");
    }

    const registreApres = await construireRegistre(prisma, date);
    if (registreApres.entrees !== registreAvant.entrees) {
      echouer(`scénario 3 : entrées doivent rester inchangées (${registreAvant.entrees}), trouvé ${registreApres.entrees}`);
    }
    if (registreApres.dettesPayees !== registreAvant.dettesPayees) {
      echouer("scénario 3 : dettesPayees doivent rester inchangées");
    }
    if (registreApres.solde !== registreAvant.solde) {
      echouer(`scénario 3 : le solde théorique doit rester strictement inchangé (${registreAvant.solde}), trouvé ${registreApres.solde}`);
    }
    const sessionApres = await prisma.sessionCaisse.findUniqueOrThrow({ where: { id: session.id } });
    if (sessionApres.soldeTheoriqueFermeture !== 8200 || sessionApres.soldeCompteFermeture !== 8200) {
      echouer("scénario 3 : la session déjà clôturée doit rester strictement inchangée");
    }
    // Mais le client, lui, a bien été modifié — c'est exactement le point du
    // correctif : C4 n'est PAS « sans impact comptable », seulement neutre
    // pour les espèces et le solde de caisse. Avance initiale 1000,
    // intégralement consommée (avanceUtilisee=1000) par la commande C4 à
    // montantRecu=0 : nouvelleAvance doit tomber à 0, et une dette apparaît.
    const clientApres = await prisma.client.findUniqueOrThrow({ where: { id: client.id } });
    if (clientApres.avanceDisponible !== 0) {
      echouer(`scénario 3 : l'avance du client aurait dû être intégralement consommée (1000 → 0), trouvé ${clientApres.avanceDisponible}`);
    }
    if (commandeC4.dette <= 0) {
      echouer("scénario 3 : la commande C4 aurait dû générer une dette (montantRecu=0 face à un montantAPercevoir positif)");
    }
    console.log("  ✓ neutralité comptable confirmée : registre et session déjà figés strictement inchangés ; avance/dette du client bien modifiées (jamais « aucun impact comptable »).");
  }

  console.log("\n✅ Vérification d'intégrité CI « C4 » (round correctif Codex) : rollback complet, conflit de sérialisation propre, neutralité de caisse — dans les 3 scénarios.\n");
}

main()
  .catch((e) => {
    if (process.exitCode !== 1) {
      console.error(e);
      process.exitCode = 1;
    }
  })
  .finally(() => prisma.$disconnect());
