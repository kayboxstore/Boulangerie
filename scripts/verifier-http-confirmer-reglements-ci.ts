/**
 * Vérification CI, contre une VRAIE base PostgreSQL éphémère ET un VRAI
 * serveur HTTP Express (`supertest`), du parcours complet de
 * `POST /api/caisse/sessions/:id/confirmer-reglements` (round correctif
 * Codex, 29/08/2026, point 3).
 *
 * Défaut visé : les 12 tests HTTP de `routes/caisse.test.ts` pour cette route
 * (et `/remises`) exercent bien le VRAI routeur Express via `supertest`, mais
 * avec une transaction Prisma MOCKÉE (`services/caisseAtomique.js` et
 * `lib/idempotence.js` interceptés) — ils prouvent le CÂBLAGE de la route
 * (verrou avant écriture, traduction d'erreur, contrat HTTP), pas la
 * PERSISTANCE réelle : ni que `CommandeClient`/`Client`/`PaiementCommande`
 * sont VRAIMENT écrits en base, ni que les trois `AuditLog` portent VRAIMENT
 * l'acteur exact de la requête HTTP (identité qui transite par
 * `contexteRequete`, peuplé par le VRAI `requireAuth`).
 *
 * Ce script-ci exerce le VRAI routeur (`caisseRouter`, importé tel quel
 * depuis le code de production, jamais réimplémenté), servi par un VRAI
 * serveur `supertest`, avec une VRAIE authentification JWT (même convention
 * que `verifier-http-permissions-role-ci.ts`) et une VRAIE base PostgreSQL —
 * aucun mock de service, d'authentification ou de Prisma.
 *
 * Scénario unique (le minimum explicitement demandé) : confirmation réussie,
 * relue depuis une connexion Prisma INDÉPENDANTE après la réponse HTTP —
 * rattachement du paiement à la `RemiseCaisse` de la session d'encaissement,
 * mises à jour réelles de `CommandeClient`/`Client`/`PaiementCommande`, et
 * les trois `AuditLog` réellement écrits DANS la même transaction avec
 * l'acteur exact.
 *
 * Limite assumée (documentée plutôt que simulée) : ce script ne rejoue PAS
 * un rollback réel pour cette route précise — construire un échec injecté
 * représentatif (pas une donnée absurde comme `quantiteBacs = 0`) aurait
 * exigé un point d'injection dédié que cette route ne expose pas. La
 * garantie de rollback n'est cependant pas propre à cette route : elle vient
 * du même mécanisme partagé (transaction Prisma interactive +
 * `auditerCaisseTx`, `services/caisseAtomique.ts`) déjà prouvé contre
 * PostgreSQL réel par `scripts/verifier-concurrence-caisse-ci.ts` (scénario
 * 7, écriture SessionCaisse + audit) et `scripts/verifier-integrite-c4-ci.ts`
 * (scénarios 1 et 4, écritures CycleLivraison(Ligne)/Client + audit) — la route
 * `/confirmer-reglements` appelle exactement les mêmes primitives, aucune
 * logique de commit/rollback qui lui soit propre. Le test mocké
 * correspondant dans `routes/caisse.test.ts` prouve uniquement que la route
 * PROPAGE un échec d'audit (pas de confirmation partielle silencieuse côté
 * réponse HTTP), pas qu'un vrai ROLLBACK PostgreSQL a eu lieu.
 *
 * SÉCURITÉ : même garde que les scripts d'intégration voisins — hôte local,
 * nom de base EXACT `lomoto_ci`, confirmation explicite. Voir
 * `scripts/garde-integration-ci.ts`.
 *
 * IMPORTANT — imports DYNAMIQUES, APRÈS la garde (même raison que
 * `verifier-http-permissions-role-ci.ts` : `lib/prisma.js` ouvre sa connexion
 * dès son chargement).
 *
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-http-confirmer-reglements-ci.ts
 */
import { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { dateSQLDepuisJourLomoto, jourLomoto } from "../apps/api/src/lib/temps.js";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-http-confirmer-reglements-ci.ts");

const prisma = new PrismaClient();

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification HTTP réelle « confirmer-reglements » (round correctif Codex) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

// Nettoie aussi les tables C4 (CycleLivraison*, SchemaCommande*) : en CI,
// ce script s'exécute APRÈS scripts/verifier-integrite-c4-ci.ts dans le MÊME
// job, sur la MÊME base PostgreSQL persistante (aucune base fraîche entre
// les étapes) — un CommandeClient/Client laissé référencé par un
// SchemaCommande de ce script précédent ferait échouer client.deleteMany()
// (P2003) sans ce nettoyage. Découvert en rejouant la séquence CI complète
// en local avant de pousser.
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

async function main() {
  // --- Imports dynamiques, APRÈS la garde — voir l'en-tête. ---
  const { caisseRouter } = await import("../apps/api/src/routes/caisse.js");
  const { signToken } = await import("../apps/api/src/lib/jwt.js");

  const app = express();
  app.use(express.json());
  app.use("/api/caisse", caisseRouter);

  await reinitialiserBase();

  console.log("→ Scénario unique : POST /sessions/:id/confirmer-reglements, parcours HTTP + PostgreSQL entièrement réel…");
  {
    // Admin Principal réel (écriture sur tous les modules, y compris CAISSE)
    // — même convention que verifier-http-permissions-role-ci.ts.
    const role = await prisma.role.create({ data: { nom: `Admin-${Date.now()}`, roleParentId: null } });
    const sessionActuelleId = `session-${Math.random().toString(36).slice(2)}`;
    const admin = await prisma.utilisateur.create({
      data: {
        nom: "Caissière HTTP",
        email: `caissiere-http-${Date.now()}@test.local`,
        roleId: role.id,
        motDePasseHash: "x",
        actif: true,
        estAdminPrincipal: true,
        sessionActuelleId,
      },
    });
    const jeton = signToken({ sub: admin.id, roleId: role.id, sid: sessionActuelleId });

    const date = jourLomoto();
    const session = await prisma.sessionCaisse.create({
      data: { date: dateSQLDepuisJourLomoto(date), statut: "OUVERTE", soldeOuverture: 0 },
    });

    const type = await prisma.typeClient.create({ data: { nom: `Qualite-${Date.now()}`, prixParBac: 4100, commissionParBac: 0 } });
    const client = await prisma.client.create({ data: { nom: "Client HTTP CI", typeClientId: type.id, avanceDisponible: 0 } });
    const commande = await prisma.commandeClient.create({
      data: {
        clientId: client.id,
        quantiteBacs: 5,
        montantBrut: 20_500,
        commission: 0,
        avanceUtilisee: 0,
        montantAPercevoir: 20_500,
        montantRecu: 20_000,
        dette: 500,
        avanceGeneree: 0,
        nouvelleAvance: 0,
        creeParId: admin.id,
      },
    });
    const paiement = await prisma.paiementCommande.create({
      data: { commandeClientId: commande.id, montant: 5000, enregistreParId: admin.id, statut: "DECLARE" },
    });

    const res = await request(app)
      .post(`/api/caisse/sessions/${session.id}/confirmer-reglements`)
      .set("Authorization", `Bearer ${jeton}`)
      .send({ paiementCommandeIds: [paiement.id], remisParNom: "Jean Livreur" });

    if (res.status !== 201) echouer(`attendu 201, reçu ${res.status} (corps : ${JSON.stringify(res.body)})`);
    if (res.body.remise?.montant !== 5000) echouer(`montant de la remise attendu 5000 dans la réponse, reçu ${JSON.stringify(res.body.remise)}`);

    // Relecture Prisma INDÉPENDANTE de la réponse HTTP — connexion séparée.
    const verif = new PrismaClient();
    try {
      const remiseReelle = await verif.remiseCaisse.findFirstOrThrow({ where: { sessionCaisseId: session.id } });
      if (remiseReelle.montant !== 5000 || remiseReelle.remisParNom !== "Jean Livreur") {
        echouer(`RemiseCaisse réelle inattendue : ${JSON.stringify(remiseReelle)}`);
      }

      const paiementReel = await verif.paiementCommande.findUniqueOrThrow({ where: { id: paiement.id } });
      if (paiementReel.statut !== "CONFIRME" || paiementReel.remiseCaisseId !== remiseReelle.id || paiementReel.confirmeParId !== admin.id) {
        echouer(`PaiementCommande réel inattendu (rattachement à la RemiseCaisse de la session d'encaissement) : ${JSON.stringify(paiementReel)}`);
      }

      // 20000 (initial) + 5000 (paiement) = 25000 > montantAPercevoir (20500)
      // → dette soldée, avanceGeneree = 4500.
      const commandeReelle = await verif.commandeClient.findUniqueOrThrow({ where: { id: commande.id } });
      if (commandeReelle.montantRecu !== 25_000 || commandeReelle.dette !== 0 || commandeReelle.avanceGeneree !== 4500) {
        echouer(`CommandeClient réelle inattendue : ${JSON.stringify(commandeReelle)}`);
      }

      const clientReel = await verif.client.findUniqueOrThrow({ where: { id: client.id } });
      if (clientReel.avanceDisponible !== 4500) {
        echouer(`Client.avanceDisponible réel attendu 4500 (avance générée par le règlement), reçu ${clientReel.avanceDisponible}`);
      }

      const audits = await verif.auditLog.findMany({ where: { module: "COMMANDES" }, orderBy: { createdAt: "asc" } });
      if (audits.length !== 3) echouer(`attendu exactement 3 AuditLog (CommandeClient, Client, PaiementCommande), trouvé ${audits.length}`);
      const parType = new Map(audits.map((a) => [a.typeEntite, a]));
      for (const typeEntite of ["CommandeClient", "Client", "PaiementCommande"]) {
        const ligne = parType.get(typeEntite);
        if (!ligne) echouer(`AuditLog manquant pour ${typeEntite}`);
        if (ligne!.utilisateurId !== admin.id) echouer(`AuditLog ${typeEntite} : acteur attendu l'admin authentifié (${admin.id}), trouvé ${ligne!.utilisateurId}`);
        if (ligne!.action !== "MODIFICATION") echouer(`AuditLog ${typeEntite} : action attendue MODIFICATION, trouvé ${ligne!.action}`);
      }
    } finally {
      await verif.$disconnect();
    }

    console.log(
      "  ✓ parcours HTTP + PostgreSQL entièrement réel (JWT réel, requireAuth réel, routeur réel, Prisma réel) : " +
        "confirmation réussie, rattachement à la RemiseCaisse, CommandeClient/Client/PaiementCommande réellement écrits, " +
        "3 AuditLog réellement persistés DANS la transaction avec l'acteur exact.",
    );
  }

  console.log("\n✅ Vérification HTTP réelle « confirmer-reglements » (round correctif Codex) : parcours complet passe contre un VRAI serveur Express + VRAIE base PostgreSQL.\n");
}

main()
  .catch((e) => {
    if (process.exitCode !== 1) {
      console.error(e);
      process.exitCode = 1;
    }
  })
  .finally(() => prisma.$disconnect());
