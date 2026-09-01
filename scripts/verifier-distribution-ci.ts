/**
 * Lot Distribution P1 — preuves HTTP + PostgreSQL réel, sans mock.
 * Garde obligatoire : hôte local et base exacte lomoto_ci.
 */
import { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { dateSQLDepuisJourLomoto, jourLomoto } from "../apps/api/src/lib/temps.js";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-distribution-ci.ts");
const db = new PrismaClient();
const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const traces = {
  role: "",
  user: "",
  clients: [] as string[],
  schemas: [] as string[],
  commandes: [] as string[],
  remises: [] as string[],
  sessionCreee: "",
  produitCree: "",
  typeCree: "",
};

function ko(message: string): never {
  process.exitCode = 1;
  throw new Error(`❌ Distribution CI : ${message}`);
}

async function triggerAudit(actif: boolean) {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "ci_rejet_audit_distribution" ON "AuditLog"');
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS ci_rejet_audit_distribution()");
  if (!actif) return;
  await db.$executeRawUnsafe(`
    CREATE FUNCTION ci_rejet_audit_distribution() RETURNS trigger AS $$
    BEGIN
      IF NEW.module = 'PRODUCTION' AND NEW."utilisateurId" = '${traces.user}' THEN
        RAISE EXCEPTION 'rejet audit Distribution injecté par la CI';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql
  `);
  await db.$executeRawUnsafe(`
    CREATE TRIGGER "ci_rejet_audit_distribution" BEFORE INSERT ON "AuditLog"
    FOR EACH ROW EXECUTE FUNCTION ci_rejet_audit_distribution()
  `);
}

async function nettoyer() {
  await triggerAudit(false).catch(() => undefined);
  if (traces.user) {
    await db.operationIdempotente.deleteMany({ where: { utilisateurId: traces.user } });
    await db.auditLog.deleteMany({ where: { utilisateurId: traces.user } });
  }
  if (traces.schemas.length) {
    const cycles = await db.cycleLivraison.findMany({
      where: { schemaCommandeId: { in: traces.schemas } },
      select: { id: true },
    });
    const cycleIds = cycles.map((cycle) => cycle.id);
    if (cycleIds.length) {
      await db.transitionCycleLivraison.deleteMany({ where: { cycleId: { in: cycleIds } } });
      await db.anomalieCycleLivraison.deleteMany({ where: { cycleId: { in: cycleIds } } });
      await db.cycleLivraisonLigne.deleteMany({ where: { cycleId: { in: cycleIds } } });
      await db.cycleLivraison.deleteMany({ where: { id: { in: cycleIds } } });
    }
    await db.schemaCommandeLigne.deleteMany({ where: { schemaCommandeId: { in: traces.schemas } } });
    await db.schemaCommande.deleteMany({ where: { id: { in: traces.schemas } } });
  }
  if (traces.commandes.length) {
    await db.paiementCommande.deleteMany({ where: { commandeClientId: { in: traces.commandes } } });
  }
  if (traces.remises.length) {
    await db.remiseCaisse.deleteMany({ where: { id: { in: traces.remises } } });
  }
  if (traces.commandes.length) {
    await db.commandeClient.deleteMany({ where: { id: { in: traces.commandes } } });
  }
  if (traces.clients.length) {
    await db.bonLivraison.deleteMany({ where: { clientId: { in: traces.clients } } });
    await db.client.deleteMany({ where: { id: { in: traces.clients } } });
  }
  if (traces.sessionCreee) {
    await db.sessionCaisse.deleteMany({ where: { id: traces.sessionCreee } });
  }
  if (traces.user) await db.utilisateur.deleteMany({ where: { id: traces.user } });
  if (traces.role) await db.role.deleteMany({ where: { id: traces.role } });
  if (traces.produitCree) await db.produit.deleteMany({ where: { id: traces.produitCree } });
  if (traces.typeCree) await db.typeClient.deleteMany({ where: { id: traces.typeCree } });
}

async function main() {
  const [
    { productionRouter },
    { cyclesLivraisonRouter },
    { commandesRouter },
    { caisseRouter },
    { signToken },
  ] = await Promise.all([
    import("../apps/api/src/routes/production.js"),
    import("../apps/api/src/routes/cycles-livraison.js"),
    import("../apps/api/src/routes/commandes.js"),
    import("../apps/api/src/routes/caisse.js"),
    import("../apps/api/src/lib/jwt.js"),
  ]);

  const app = express();
  app.use(express.json());
  app.use("/api/production", productionRouter);
  app.use("/api/production", cyclesLivraisonRouter);
  app.use("/api/commandes", commandesRouter);
  app.use("/api/caisse", caisseRouter);
  app.use((e: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Erreur route Distribution CI :", e);
    res.status(500).json({ erreur: "Erreur interne" });
  });

  const role = await db.role.create({ data: { nom: `Distribution CI ${tag}`, roleParentId: null } });
  traces.role = role.id;
  await db.rolePermission.createMany({
    data: [
      { roleId: role.id, module: "PRODUCTION", niveauAcces: "ECRITURE" },
      { roleId: role.id, module: "COMMANDES", niveauAcces: "ECRITURE" },
      { roleId: role.id, module: "CAISSE", niveauAcces: "ECRITURE" },
    ],
  });
  const sid = `sid-distribution-${tag}`;
  const user = await db.utilisateur.create({
    data: {
      nom: "Responsable Distribution CI",
      email: `distribution-${tag}@test.local`,
      motDePasseHash: "x",
      roleId: role.id,
      actif: true,
      estAdminPrincipal: true,
      sessionActuelleId: sid,
    },
  });
  traces.user = user.id;
  const auth = { Authorization: `Bearer ${signToken({ sub: user.id, roleId: role.id, sid })}` };

  let type = await db.typeClient.findUnique({ where: { nom: "Dépositaire" } });
  if (!type) {
    type = await db.typeClient.create({
      data: { nom: "Dépositaire", prixParBac: 4100, commissionParBac: 0 },
    });
    traces.typeCree = type.id;
  }
  let produit = await db.produit.findUnique({ where: { nom: "Carré 1.500 Fc" } });
  if (!produit) {
    produit = await db.produit.create({
      data: { nom: "Carré 1.500 Fc", prixVente: 1500, categorie: "Pain" },
    });
    traces.produitCree = produit.id;
  }
  const client = await db.client.create({
    data: { nom: `Dépôt Distribution CI ${tag}`, typeClientId: type.id, avanceDisponible: 0 },
  });
  traces.clients.push(client.id);
  const date = "2098-01-02";
  const schema = await db.schemaCommande.create({
    data: {
      date: dateSQLDepuisJourLomoto(date),
      clientId: client.id,
      lignes: { create: [{ produitId: produit.id, quantite: 50 }] },
      cycle: { create: { lignes: { create: [{ produitId: produit.id }] } } },
    },
    include: { cycle: true },
  });
  traces.schemas.push(schema.id);
  const cycleId = schema.cycle!.id;

  console.log("→ 1/6 bon, bacs vides et parcours C4 complet par les vraies routes HTTP…");
  let r = await request(app)
    .put("/api/production/bons-livraison")
    .set(auth)
    .send({
      date,
      clients: [{
        clientId: client.id,
        lignes: [{ produitId: produit.id, quantite: 45 }],
        bacsVides: 3,
        livrePar: "Moussa Livreur",
        observations: "Bon physique Distribution CI",
      }],
    });
  if (r.status !== 200) ko(`bon initial attendu 200, reçu ${r.status} ${JSON.stringify(r.body)}`);
  const bon = await db.bonLivraison.findFirstOrThrow({
    where: { date: dateSQLDepuisJourLomoto(date), clientId: client.id },
    include: { lignes: true },
  });
  if (bon.bacsVides !== 3 || bon.livrePar !== "Moussa Livreur" || bon.lignes[0]?.quantite !== 45) {
    ko("le bon initial, ses bacs vides ou sa ligne ne sont pas persistés exactement");
  }

  const transitions: Array<Record<string, unknown>> = [
    { action: "RETENIR_PRODUCTION", version: 1, lignes: [{ produitId: produit.id, quantite: 50 }] },
    { action: "CONFIRMER_PREPARATION", version: 2, lignes: [{ produitId: produit.id, quantite: 48 }] },
    { action: "CONFIRMER_REMISE_MAGASIN", version: 3, lignes: [{ produitId: produit.id, quantite: 47 }] },
    { action: "CONFIRMER_CHARGEMENT", version: 4, livrePar: "Moussa Livreur", lignes: [{ produitId: produit.id, quantite: 45 }] },
    { action: "CONFIRMER_DEPART", version: 5 },
    { action: "SIGNALER_DEPOT", version: 6, lignes: [{ produitId: produit.id, quantite: 43 }] },
    {
      action: "CONFIRMER_ACCEPTATION",
      version: 7,
      lignes: [{ produitId: produit.id, quantiteAcceptee: 40, quantiteRetournee: 3 }],
      bonRetourne: false,
    },
  ];
  for (const [index, transition] of transitions.entries()) {
    let requete = request(app)
      .post(`/api/production/cycles-livraison/${cycleId}/transitions`)
      .set(auth)
      .send(transition);
    if (transition.action === "CONFIRMER_ACCEPTATION") {
      requete = requete.set("Idempotency-Key", `distribution-acceptation-${tag}`);
    }
    r = await requete;
    const attendu = transition.action === "CONFIRMER_ACCEPTATION" ? 201 : 200;
    if (r.status !== attendu) ko(`transition ${index + 1} attendue ${attendu}, reçue ${r.status} ${JSON.stringify(r.body)}`);
  }
  const cycle = await db.cycleLivraison.findUniqueOrThrow({
    where: { id: cycleId },
    include: { lignes: true, commande: true, anomalies: true, transitions: true },
  });
  const ligne = cycle.lignes[0]!;
  if (
    cycle.statut !== "PARTIELLEMENT_ACCEPTEE" ||
    cycle.version !== 8 ||
    ligne.quantiteChargee !== 45 ||
    ligne.quantiteDeposee !== 43 ||
    ligne.quantiteAcceptee !== 40 ||
    ligne.quantiteRetournee !== 3 ||
    ligne.quantiteManquante !== 2 ||
    cycle.transitions.length !== 7 ||
    !cycle.commande
  ) ko("l'état C4 final, les manquants/retours ou la commande sont inexacts");
  traces.commandes.push(cycle.commande.id);
  if (!cycle.anomalies.some((anomalie) => anomalie.type === "BON_NON_RETOURNE" && !anomalie.resolueLe)) {
    ko("l'anomalie BON_NON_RETOURNE n'a pas été créée");
  }
  const auditsCycles = await db.auditLog.count({
    where: { utilisateurId: user.id, typeEntite: "CycleLivraison", entiteId: cycleId },
  });
  if (auditsCycles !== 7) ko(`sept audits CycleLivraison attendus, trouvé ${auditsCycles}`);
  console.log("  ✓ chargement, dépôt, accepté/retourné/manquant, bon et bacs vides exacts.");

  console.log("→ 2/6 retour tardif du bon : anomalie résolue, audits exacts et journée figée…");
  r = await request(app)
    .post(`/api/production/cycles-livraison/${cycleId}/bon-retourne`)
    .set(auth)
    .send({ version: 8 });
  if (r.status !== 200 || r.body.cycle?.version !== 9 || !r.body.cycle?.bonRetourne) {
    ko(`retour du bon attendu 200/version 9, reçu ${r.status} ${JSON.stringify(r.body)}`);
  }
  const anomalieBon = await db.anomalieCycleLivraison.findFirstOrThrow({
    where: { cycleId, type: "BON_NON_RETOURNE" },
  });
  if (!anomalieBon.resolueLe || anomalieBon.resolueParId !== user.id) ko("l'anomalie du bon n'est pas résolue/attribuée");
  r = await request(app)
    .put("/api/production/bons-livraison")
    .set(auth)
    .send({ date, clients: [] });
  if (r.status !== 409 || r.body.code !== "BON_PHYSIQUE_DEJA_RETOURNE") {
    ko(`réécriture après retour attendue 409, reçue ${r.status} ${JSON.stringify(r.body)}`);
  }
  if (!(await db.bonLivraison.findUnique({ where: { id: bon.id } }))) ko("le bon figé a été supprimé");
  console.log("  ✓ retour physique et gel du bon prouvés.");

  console.log("→ 3/6 anomalie manuelle : création, résolution, versions et audits transactionnels…");
  r = await request(app)
    .post(`/api/production/cycles-livraison/${cycleId}/anomalies`)
    .set(auth)
    .send({ version: 9, type: "PRODUIT_ENDOMMAGE", description: "Deux bacs endommagés" });
  if (r.status !== 201 || r.body.cycle?.version !== 10) ko(`création anomalie attendue 201/version 10, reçue ${r.status}`);
  const anomalieId = r.body.anomalie?.id as string;
  r = await request(app)
    .post(`/api/production/cycles-livraison/${cycleId}/anomalies/${anomalieId}/resoudre`)
    .set(auth)
    .send({ version: 10, commentaire: "Constat signé par le dépôt" });
  if (r.status !== 200 || r.body.cycle?.version !== 11) ko(`résolution attendue 200/version 11, reçue ${r.status}`);
  const anomalieResolue = await db.anomalieCycleLivraison.findUniqueOrThrow({ where: { id: anomalieId } });
  if (!anomalieResolue.resolueLe || anomalieResolue.commentaireResolution !== "Constat signé par le dépôt") {
    ko("la résolution d'anomalie n'est pas persistée exactement");
  }
  const auditAnomalie = await db.auditLog.findFirst({
    where: { utilisateurId: user.id, typeEntite: "AnomalieCycleLivraison", entiteId: anomalieId },
  });
  if (!auditAnomalie) ko("l'audit transactionnel de résolution d'anomalie manque");
  console.log("  ✓ anomalie et version du cycle atomiques.");

  console.log("→ 4/6 échec d'audit après deleteMany : ancien bon et lignes restaurés par PostgreSQL…");
  const dateRollbackBon = "2098-01-03";
  const ancienBon = await db.bonLivraison.create({
    data: {
      date: dateSQLDepuisJourLomoto(dateRollbackBon),
      clientId: client.id,
      bacsVides: 7,
      livrePar: "Ancien livreur",
      observations: "État témoin",
      creeParId: user.id,
      lignes: { create: [{ produitId: produit.id, quantite: 12 }] },
    },
    include: { lignes: true },
  });
  await triggerAudit(true);
  try {
    r = await request(app)
      .put("/api/production/bons-livraison")
      .set(auth)
      .send({
        date: dateRollbackBon,
        clients: [{
          clientId: client.id,
          lignes: [{ produitId: produit.id, quantite: 99 }],
          bacsVides: 0,
          livrePar: "Nouveau",
        }],
      });
    if (r.status !== 500) ko(`échec audit bon attendu 500, reçu ${r.status}`);
  } finally {
    await triggerAudit(false);
  }
  const bonRestaure = await db.bonLivraison.findUniqueOrThrow({
    where: { id: ancienBon.id },
    include: { lignes: true },
  });
  if (
    bonRestaure.bacsVides !== 7 ||
    bonRestaure.livrePar !== "Ancien livreur" ||
    bonRestaure.observations !== "État témoin" ||
    bonRestaure.lignes.length !== 1 ||
    bonRestaure.lignes[0]!.id !== ancienBon.lignes[0]!.id ||
    bonRestaure.lignes[0]!.quantite !== 12
  ) ko("l'ancien bon n'a pas été restauré exactement après l'échec d'audit");
  console.log("  ✓ rollback réel après suppression destructive.");

  console.log("→ 5/6 échec d'audit du retour : cycle et anomalie strictement inchangés…");
  const clientRollback = await db.client.create({
    data: { nom: `Dépôt retour rollback ${tag}`, typeClientId: type.id, avanceDisponible: 0 },
  });
  traces.clients.push(clientRollback.id);
  const schemaRollback = await db.schemaCommande.create({
    data: {
      date: dateSQLDepuisJourLomoto("2098-01-04"),
      clientId: clientRollback.id,
      lignes: { create: [{ produitId: produit.id, quantite: 10 }] },
      cycle: {
        create: {
          statut: "ACCEPTEE",
          version: 8,
          lignes: {
            create: [{
              produitId: produit.id,
              quantiteRetenueProduction: 10,
              quantitePreparee: 10,
              quantiteRemiseMagasin: 10,
              quantiteChargee: 10,
              quantiteDeposee: 10,
              quantiteAcceptee: 10,
              quantiteRetournee: 0,
              quantiteManquante: 0,
            }],
          },
          anomalies: {
            create: {
              type: "BON_NON_RETOURNE",
              description: "Bon témoin non retourné",
              signaleeParId: user.id,
            },
          },
        },
      },
    },
    include: { cycle: { include: { anomalies: true } } },
  });
  traces.schemas.push(schemaRollback.id);
  const cycleRollback = schemaRollback.cycle!;
  const anomalieRollback = cycleRollback.anomalies[0]!;
  await triggerAudit(true);
  try {
    r = await request(app)
      .post(`/api/production/cycles-livraison/${cycleRollback.id}/bon-retourne`)
      .set(auth)
      .send({ version: 8 });
    if (r.status !== 500) ko(`échec audit retour attendu 500, reçu ${r.status}`);
  } finally {
    await triggerAudit(false);
  }
  const cycleApresRollback = await db.cycleLivraison.findUniqueOrThrow({ where: { id: cycleRollback.id } });
  const anomalieApresRollback = await db.anomalieCycleLivraison.findUniqueOrThrow({ where: { id: anomalieRollback.id } });
  if (
    cycleApresRollback.version !== 8 ||
    cycleApresRollback.bonRetourne ||
    cycleApresRollback.bonRetourneLe ||
    anomalieApresRollback.resolueLe ||
    anomalieApresRollback.resolueParId
  ) ko("le retour du bon ou sa résolution ont survécu au rollback");
  console.log("  ✓ rollback conjoint CycleLivraison + AnomalieCycleLivraison.");

  console.log("→ 6/6 preuve espèces : commande C4 → déclaration → remise contradictoire Caisse…");
  const commandeAvant = await db.commandeClient.findUniqueOrThrow({ where: { id: cycle.commande.id } });
  const montant = Math.min(5_000, commandeAvant.dette);
  r = await request(app)
    .post(`/api/commandes/${commandeAvant.id}/reglements`)
    .set(auth)
    .set("Idempotency-Key", `distribution-reglement-${tag}`)
    .send({ montant });
  if (r.status !== 201) ko(`déclaration règlement attendue 201, reçue ${r.status} ${JSON.stringify(r.body)}`);
  const paiement = await db.paiementCommande.findFirstOrThrow({
    where: { commandeClientId: commandeAvant.id, statut: "DECLARE" },
    orderBy: { date: "desc" },
  });

  let session = await db.sessionCaisse.findFirst({
    where: { statut: "OUVERTE" },
    orderBy: { date: "asc" },
  });
  if (!session) {
    let dateSession = jourLomoto();
    const existante = await db.sessionCaisse.findUnique({ where: { date: dateSQLDepuisJourLomoto(dateSession) } });
    if (existante) {
      const demain = new Date(existante.date);
      demain.setUTCDate(demain.getUTCDate() + 1);
      dateSession = demain.toISOString().slice(0, 10);
    }
    session = await db.sessionCaisse.create({
      data: { date: dateSQLDepuisJourLomoto(dateSession), statut: "OUVERTE", soldeOuverture: 0, ouverteParId: user.id },
    });
    traces.sessionCreee = session.id;
  }
  const reference = `C4:${cycleId}`;
  r = await request(app)
    .post(`/api/caisse/sessions/${session.id}/confirmer-reglements`)
    .set(auth)
    .set("Idempotency-Key", `distribution-remise-${tag}`)
    .send({
      paiementCommandeIds: [paiement.id],
      remisParNom: "Moussa Livreur",
      reference,
      observation: "Espèces issues de la tournée Distribution CI",
    });
  if (r.status !== 201) ko(`confirmation caisse attendue 201, reçue ${r.status} ${JSON.stringify(r.body)}`);
  const remise = await db.remiseCaisse.findFirstOrThrow({
    where: { sessionCaisseId: session.id, reference },
  });
  traces.remises.push(remise.id);
  const paiementConfirme = await db.paiementCommande.findUniqueOrThrow({ where: { id: paiement.id } });
  const commandeApres = await db.commandeClient.findUniqueOrThrow({
    where: { id: commandeAvant.id },
    include: { cycleLivraison: true },
  });
  if (
    remise.montant !== montant ||
    remise.remisParNom !== "Moussa Livreur" ||
    remise.recuParId !== user.id ||
    paiementConfirme.statut !== "CONFIRME" ||
    paiementConfirme.remiseCaisseId !== remise.id ||
    commandeApres.cycleLivraison?.id !== cycleId ||
    commandeApres.montantRecu !== commandeAvant.montantRecu + montant ||
    commandeApres.dette !== commandeAvant.dette - montant
  ) ko("la chaîne physique C4 → paiement → remise → réception Caisse est incohérente");
  console.log("  ✓ remise reliée au cycle, livreur, caissier, paiement et dette exacts.");

  console.log("\n✅ Distribution : 6/6 scénarios HTTP + PostgreSQL réels verts.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await nettoyer().catch((e) => {
      console.error("Nettoyage Distribution CI échoué :", e);
      process.exitCode = 1;
    });
    await db.$disconnect();
  });
