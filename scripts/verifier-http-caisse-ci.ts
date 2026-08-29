/**
 * Preuve CI de POST /api/caisse/sessions/:id/confirmer-reglements avec le
 * vrai routeur Express, une authentification JWT réelle et PostgreSQL réel.
 * Aucun mock de Prisma, d'authentification, d'idempotence ou d'audit.
 *
 * Scénario 1 : succès puis rejeu idempotent. La RemiseCaisse, la commande,
 * le client, le paiement et les trois AuditLog sont relus par une connexion
 * Prisma indépendante.
 * Scénario 2 : lot mixte valide/introuvable. La réponse 409 ne laisse aucune
 * remise, aucune confirmation partielle et aucun audit.
 */
import { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-http-caisse-ci.ts");

const prisma = new PrismaClient();

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification HTTP réelle de la caisse : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function reinitialiserBase() {
  await prisma.auditLog.deleteMany();
  await prisma.operationIdempotente.deleteMany();
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

type Signer = (payload: { sub: string; roleId: string; sid: string }) => string;
type DateMetier = (jour: string) => Date;

async function creerJeu(
  signToken: Signer,
  dateSQLDepuisJourLomoto: DateMetier,
  suffixe: string,
  montantReglement: number,
) {
  const role = await prisma.role.create({ data: { nom: `Caissier HTTP réel ${suffixe}`, roleParentId: null } });
  await prisma.rolePermission.create({
    data: { roleId: role.id, module: "CAISSE", niveauAcces: "ECRITURE" },
  });
  const sessionActuelleId = `session-http-caisse-${suffixe}`;
  const utilisateur = await prisma.utilisateur.create({
    data: {
      nom: `Caissier HTTP ${suffixe}`,
      email: `caissier-http-${suffixe}@lomoto.test`,
      motDePasseHash: "x",
      roleId: role.id,
      actif: true,
      sessionActuelleId,
    },
  });
  const jeton = signToken({ sub: utilisateur.id, roleId: role.id, sid: sessionActuelleId });
  const typeClient = await prisma.typeClient.create({
    data: { nom: `Dépositaire HTTP ${suffixe}`, prixParBac: 4100, commissionParBac: 0 },
  });
  const client = await prisma.client.create({
    data: { nom: `Client HTTP ${suffixe}`, typeClientId: typeClient.id, avanceDisponible: 0 },
  });
  const commande = await prisma.commandeClient.create({
    data: {
      clientId: client.id,
      quantiteBacs: 5,
      montantBrut: 20_500,
      commission: 0,
      avanceUtilisee: 0,
      montantAPercevoir: 20_500,
      montantRecu: 10_000,
      dette: 10_500,
      avanceGeneree: 0,
      nouvelleAvance: 0,
      creeParId: utilisateur.id,
      dateOperationnelle: dateSQLDepuisJourLomoto("2026-08-28"),
    },
  });
  const paiement = await prisma.paiementCommande.create({
    data: {
      commandeClientId: commande.id,
      montant: montantReglement,
      date: new Date("2026-08-28T10:00:00.000Z"),
      enregistreParId: utilisateur.id,
      statut: "DECLARE",
    },
  });
  const session = await prisma.sessionCaisse.create({
    data: {
      date: dateSQLDepuisJourLomoto("2026-08-29"),
      statut: "OUVERTE",
      soldeOuverture: 0,
      ouverteParId: utilisateur.id,
    },
  });
  return { utilisateur, jeton, client, commande, paiement, session };
}

function objetJson(valeur: unknown): Record<string, unknown> {
  if (!valeur || typeof valeur !== "object" || Array.isArray(valeur)) return {};
  return valeur as Record<string, unknown>;
}

async function main() {
  // Imports dynamiques après la garde : caisseRouter charge le PrismaClient
  // applicatif dès son import.
  const { caisseRouter } = await import("../apps/api/src/routes/caisse.js");
  const { signToken } = await import("../apps/api/src/lib/jwt.js");
  const { dateSQLDepuisJourLomoto } = await import("../apps/api/src/lib/temps.js");

  const app = express();
  app.use(express.json());
  app.use("/api/caisse", caisseRouter);

  console.log("→ Scénario 1/2 : confirmation HTTP réelle, audit transactionnel et rejeu idempotent…");
  {
    await reinitialiserBase();
    const jeu = await creerJeu(signToken, dateSQLDepuisJourLomoto, "s1", 11_000);
    const corps = {
      paiementCommandeIds: [jeu.paiement.id],
      remisParNom: "Livreur HTTP réel",
      reference: "HTTP-CAISSE-S1",
    };
    const appeler = () =>
      request(app)
        .post(`/api/caisse/sessions/${jeu.session.id}/confirmer-reglements`)
        .set("Authorization", `Bearer ${jeu.jeton}`)
        .set("Idempotency-Key", "http-caisse-s1")
        .send(corps);

    const res = await appeler();
    if (res.status !== 201) {
      echouer(`scénario 1 : attendu 201, reçu ${res.status} (corps : ${JSON.stringify(res.body)})`);
    }

    const verification = new PrismaClient();
    try {
      const remise = await verification.remiseCaisse.findUniqueOrThrow({
        where: { reference: "HTTP-CAISSE-S1" },
      });
      const paiement = await verification.paiementCommande.findUniqueOrThrow({ where: { id: jeu.paiement.id } });
      const commande = await verification.commandeClient.findUniqueOrThrow({ where: { id: jeu.commande.id } });
      const client = await verification.client.findUniqueOrThrow({ where: { id: jeu.client.id } });
      const audits = await verification.auditLog.findMany({
        where: {
          entiteId: { in: [jeu.commande.id, jeu.client.id, jeu.paiement.id] },
          utilisateurId: jeu.utilisateur.id,
        },
      });

      if (remise.sessionCaisseId !== jeu.session.id || remise.montant !== 11_000) {
        echouer("scénario 1 : RemiseCaisse réelle mal rattachée ou montant inexact");
      }
      if (
        paiement.statut !== "CONFIRME" ||
        paiement.remiseCaisseId !== remise.id ||
        paiement.confirmeParId !== jeu.utilisateur.id
      ) {
        echouer("scénario 1 : PaiementCommande réel non confirmé ou mal rattaché");
      }
      if (
        commande.montantRecu !== 21_000 ||
        commande.dette !== 0 ||
        commande.avanceGeneree !== 500 ||
        commande.nouvelleAvance !== 500
      ) {
        echouer(`scénario 1 : CommandeClient réelle inexacte : ${JSON.stringify(commande)}`);
      }
      if (client.avanceDisponible !== 500) {
        echouer(`scénario 1 : avance client réelle attendue 500, trouvée ${client.avanceDisponible}`);
      }
      if (audits.length !== 3) {
        echouer(`scénario 1 : exactement 3 AuditLog réels attendus, trouvé ${audits.length}`);
      }
      const parType = new Map(audits.map((audit) => [audit.typeEntite, audit]));
      const auditCommande = parType.get("CommandeClient");
      const auditClient = parType.get("Client");
      const auditPaiement = parType.get("PaiementCommande");
      if (!auditCommande || !auditClient || !auditPaiement) {
        echouer(`scénario 1 : types d'audit incomplets : ${[...parType.keys()].join(", ")}`);
      }
      if (
        objetJson(auditCommande.avant).montantRecu !== 10_000 ||
        objetJson(auditCommande.apres).montantRecu !== 21_000
      ) {
        echouer("scénario 1 : audit CommandeClient avant/après inexact");
      }
      if (
        objetJson(auditClient.avant).avanceDisponible !== 0 ||
        objetJson(auditClient.apres).avanceDisponible !== 500
      ) {
        echouer("scénario 1 : audit Client avant/après inexact");
      }
      if (
        objetJson(auditPaiement.avant).statut !== "DECLARE" ||
        objetJson(auditPaiement.apres).statut !== "CONFIRME" ||
        objetJson(auditPaiement.apres).remiseCaisseId !== remise.id
      ) {
        echouer("scénario 1 : audit PaiementCommande avant/après inexact");
      }
    } finally {
      await verification.$disconnect();
    }

    const rejeu = await appeler();
    if (rejeu.status !== 201 || rejeu.headers["idempotency-replayed"] !== "true") {
      echouer(`scénario 1 : rejeu attendu 201 + Idempotency-Replayed=true, reçu ${rejeu.status}`);
    }
    const [nbRemises, nbAudits, nbOperations] = await Promise.all([
      prisma.remiseCaisse.count(),
      prisma.auditLog.count(),
      prisma.operationIdempotente.count(),
    ]);
    if (nbRemises !== 1 || nbAudits !== 3 || nbOperations !== 1) {
      echouer(
        `scénario 1 : le rejeu a dupliqué un effet (remises=${nbRemises}, audits=${nbAudits}, opérations=${nbOperations})`,
      );
    }
    console.log("  ✓ succès et rejeu vérifiés par relecture indépendante : 1 remise, 3 audits exacts, aucun doublon.");
  }

  console.log("→ Scénario 2/2 : lot mixte valide/introuvable → 409 sans confirmation partielle…");
  {
    await reinitialiserBase();
    const jeu = await creerJeu(signToken, dateSQLDepuisJourLomoto, "s2", 500);
    const res = await request(app)
      .post(`/api/caisse/sessions/${jeu.session.id}/confirmer-reglements`)
      .set("Authorization", `Bearer ${jeu.jeton}`)
      .send({
        paiementCommandeIds: [jeu.paiement.id, "paiement-introuvable"],
        remisParNom: "Livreur HTTP réel",
      });
    if (res.status !== 409 || res.body.code !== "REGLEMENT_INVALIDE") {
      echouer(`scénario 2 : attendu 409 REGLEMENT_INVALIDE, reçu ${res.status} ${JSON.stringify(res.body)}`);
    }

    const verification = new PrismaClient();
    try {
      const paiement = await verification.paiementCommande.findUniqueOrThrow({ where: { id: jeu.paiement.id } });
      const commande = await verification.commandeClient.findUniqueOrThrow({ where: { id: jeu.commande.id } });
      const client = await verification.client.findUniqueOrThrow({ where: { id: jeu.client.id } });
      const [nbRemises, nbAudits] = await Promise.all([
        verification.remiseCaisse.count(),
        verification.auditLog.count(),
      ]);
      if (paiement.statut !== "DECLARE" || paiement.remiseCaisseId !== null) {
        echouer("scénario 2 : le paiement valide a été confirmé partiellement");
      }
      if (commande.montantRecu !== 10_000 || commande.dette !== 10_500) {
        echouer("scénario 2 : la commande a été modifiée malgré le lot invalide");
      }
      if (client.avanceDisponible !== 0 || nbRemises !== 0 || nbAudits !== 0) {
        echouer(
          `scénario 2 : état partiel détecté (avance=${client.avanceDisponible}, remises=${nbRemises}, audits=${nbAudits})`,
        );
      }
    } finally {
      await verification.$disconnect();
    }
    console.log("  ✓ 409 réel : paiement, commande, client, remises et audits strictement inchangés/absents.");
  }

  await reinitialiserBase();
  console.log(
    "\n✅ Vérification HTTP réelle de /confirmer-reglements : 2 scénarios Express + JWT + PostgreSQL, aucun mock.\n",
  );
}

main()
  .catch((e) => {
    if (process.exitCode !== 1) {
      console.error(e);
      process.exitCode = 1;
    }
  })
  .finally(() => prisma.$disconnect());
