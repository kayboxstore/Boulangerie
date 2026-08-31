/**
 * Lot Production P1 — preuve HTTP + PostgreSQL réel, sans mock.
 * Garde obligatoire : hôte local et base exacte lomoto_ci.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-production-ci.ts");
const db = new PrismaClient();
const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const traces = {
  role: "",
  user: "",
  produit: "",
  matieres: [] as string[],
  matieresCreees: [] as string[],
  matieresAvant: [] as {
    id: string;
    quantiteStock: Prisma.Decimal;
    seuilAlerte: Prisma.Decimal;
    alerteSeuilEnvoyeeLe: Date | null;
  }[],
  pertes: [] as string[],
  nc: "",
};

function ko(message: string): never {
  process.exitCode = 1;
  throw new Error(`❌ Production CI : ${message}`);
}
function eqDecimal(recu: Prisma.Decimal, attendu: number, nom: string) {
  if (!recu.equals(new Prisma.Decimal(attendu))) ko(`${nom}: attendu ${attendu}, reçu ${recu}`);
}
async function triggerAudit(actif: boolean) {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "ci_rejet_audit_production" ON "AuditLog"');
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS ci_rejet_audit_production()");
  if (!actif) return;
  await db.$executeRawUnsafe(`
    CREATE FUNCTION ci_rejet_audit_production() RETURNS trigger AS $$
    BEGIN
      IF NEW.module = 'PRODUCTION' THEN
        RAISE EXCEPTION 'rejet audit Production injecté par la CI';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql
  `);
  await db.$executeRawUnsafe(`
    CREATE TRIGGER "ci_rejet_audit_production" BEFORE INSERT ON "AuditLog"
    FOR EACH ROW EXECUTE FUNCTION ci_rejet_audit_production()
  `);
}
async function nouvelleProduction(userId: string, motifPerteId?: string, controle = false, bacsFoutus = 2) {
  return db.production.create({
    data: {
      bacsProduits: 10,
      bacsLivresDepositaires: 10 - bacsFoutus,
      bacsFoutus,
      enregistreParId: userId,
      pertes: motifPerteId ? { create: [{ motifPerteId, nombreBacs: bacsFoutus }] } : undefined,
      controleQualite: controle
        ? { create: { verdict: "CONFORME", observations: "Avant", controleParId: userId } }
        : undefined,
    },
  });
}
async function attendreBlocageProduction() {
  const debut = Date.now();
  while (Date.now() - debut < 5000) {
    const lignes = await db.$queryRaw<{ bloqueurs: number[] }[]>`
      SELECT pg_blocking_pids(pid) AS bloqueurs
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND cardinality(pg_blocking_pids(pid)) > 0
        AND query LIKE '%FROM "Production"%FOR UPDATE%'
    `;
    if (lignes[0]?.bloqueurs.length) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  ko("le SELECT Production FOR UPDATE concurrent n'a jamais été observé bloqué");
}
async function nettoyer() {
  await triggerAudit(false).catch(() => undefined);
  if (traces.user) {
    await db.auditLog.deleteMany({ where: { utilisateurId: traces.user } });
    await db.mouvementStock.deleteMany({ where: { auteurId: traces.user } });
    await db.production.deleteMany({ where: { enregistreParId: traces.user } });
    await db.planningProduction.deleteMany({ where: { creeParId: traces.user } });
    await db.utilisateur.deleteMany({ where: { id: traces.user } });
  }
  for (const avant of traces.matieresAvant) {
    await db.matierePremiere.update({
      where: { id: avant.id },
      data: {
        quantiteStock: avant.quantiteStock,
        seuilAlerte: avant.seuilAlerte,
        alerteSeuilEnvoyeeLe: avant.alerteSeuilEnvoyeeLe,
      },
    });
  }
  if (traces.produit) await db.produit.deleteMany({ where: { id: traces.produit } });
  if (traces.matieresCreees.length) {
    await db.matierePremiere.deleteMany({ where: { id: { in: traces.matieresCreees } } });
  }
  if (traces.pertes.length) await db.motifPerte.deleteMany({ where: { id: { in: traces.pertes } } });
  if (traces.nc) await db.motifNonConformite.deleteMany({ where: { id: traces.nc } });
  if (traces.role) await db.role.deleteMany({ where: { id: traces.role } });
}

async function main() {
  // Import dynamique après la garde : lib/prisma.js ouvre sa connexion à l'import.
  const { productionRouter } = await import("../apps/api/src/routes/production.js");
  const { signToken } = await import("../apps/api/src/lib/jwt.js");
  const app = express();
  app.use(express.json());
  app.use("/api/production", productionRouter);
  app.use((_e: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
    res.status(500).json({ erreur: "Erreur interne" }),
  );

  const role = await db.role.create({ data: { nom: `Production CI ${tag}`, roleParentId: null } });
  traces.role = role.id;
  const sid = `sid-production-${tag}`;
  const user = await db.utilisateur.create({
    data: {
      nom: "Responsable Production CI",
      email: `production-${tag}@test.local`,
      motDePasseHash: "x",
      roleId: role.id,
      actif: true,
      estAdminPrincipal: true,
      sessionActuelleId: sid,
    },
  });
  traces.user = user.id;
  const token = signToken({ sub: user.id, roleId: role.id, sid });
  const auth = { Authorization: `Bearer ${token}` };

  const matieres = [
    { nom: `Farine ${tag}`, code: "FARINE" as const, unite: "sac", quantiteStock: 100, seuilAlerte: 10 },
    { nom: `Levure ${tag}`, code: "LEVURE" as const, unite: "paquet", quantiteStock: 100, seuilAlerte: 10 },
    { nom: `Sel ${tag}`, code: "SEL" as const, unite: "kg", quantiteStock: 100, seuilAlerte: 10 },
    { nom: `Huile ${tag}`, code: "HUILE" as const, unite: "L", quantiteStock: 100, seuilAlerte: 10 },
  ];
  for (const data of matieres) {
    const existante = await db.matierePremiere.findUnique({ where: { code: data.code } });
    if (existante) {
      traces.matieresAvant.push({
        id: existante.id,
        quantiteStock: existante.quantiteStock,
        seuilAlerte: existante.seuilAlerte,
        alerteSeuilEnvoyeeLe: existante.alerteSeuilEnvoyeeLe,
      });
      await db.matierePremiere.update({
        where: { id: existante.id },
        data: { quantiteStock: 100, seuilAlerte: 10, alerteSeuilEnvoyeeLe: null },
      });
      traces.matieres.push(existante.id);
    } else {
      const creee = await db.matierePremiere.create({ data });
      traces.matieres.push(creee.id);
      traces.matieresCreees.push(creee.id);
    }
  }
  const produit = await db.produit.create({
    data: { nom: `Carré Production CI ${tag}`, prixVente: 1500, categorie: "Pain" },
  });
  traces.produit = produit.id;
  const motifA = await db.motifPerte.create({ data: { nom: `Brûlé ${tag}` } });
  const motifB = await db.motifPerte.create({ data: { nom: `Tombé ${tag}` } });
  traces.pertes.push(motifA.id, motifB.id);
  const motifNC = await db.motifNonConformite.create({ data: { nom: `Cuisson ${tag}` } });
  traces.nc = motifNC.id;

  console.log("→ 1/6 création Production + quatre sorties de stock…");
  const creee = await request(app)
    .post("/api/production/productions").set(auth)
    .send({
      bacsProduits: 10, bacsLivresDepositaires: 8, bacsFoutus: 2,
      sacsUtilises: 2, paquetsLevureUtilises: 3, kgSelUtilises: 1.5, quantiteHuileUtilisee: 4,
    });
  if (creee.status !== 201) ko(`création: attendu 201, reçu ${creee.status} ${JSON.stringify(creee.body)}`);
  const productionId = creee.body.production?.id as string;
  const attendus = new Map([["FARINE", 98], ["LEVURE", 97], ["SEL", 98.5], ["HUILE", 96]]);
  const stocks = await db.matierePremiere.findMany({ where: { id: { in: traces.matieres } } });
  for (const m of stocks) eqDecimal(m.quantiteStock, attendus.get(m.code!)!, `stock ${m.code}`);
  const mouvements = await db.mouvementStock.findMany({ where: { productionId } });
  if (mouvements.length !== 4 || mouvements.some((m) => m.type !== "SORTIE" || m.auteurId !== user.id)) {
    ko("les quatre mouvements SORTIE réels et reliés à la Production sont absents");
  }
  console.log("  ✓ Production, stocks et mouvements réellement persistés.");

  console.log("→ 2/6 stock insuffisant : rollback total…");
  const compteP = await db.production.count({ where: { enregistreParId: user.id } });
  const compteM = await db.mouvementStock.count({ where: { auteurId: user.id } });
  const farineAvant = await db.matierePremiere.findUniqueOrThrow({ where: { code: "FARINE" } });
  const levureAvant = await db.matierePremiere.findUniqueOrThrow({ where: { code: "LEVURE" } });
  const compteAudits = await db.auditLog.count({ where: { utilisateurId: user.id } });
  const rejetStock = await request(app)
    .post("/api/production/productions").set(auth)
    // La farine réussit d’abord (écriture + audit), puis la levure échoue :
    // le rollback doit donc retirer aussi la trace STOCKS déjà écrite.
    .send({ bacsProduits: 1, sacsUtilises: 1, paquetsLevureUtilises: 10000 });
  if (rejetStock.status !== 400) {
    ko(`stock insuffisant: attendu 400, reçu ${rejetStock.status} ${JSON.stringify(rejetStock.body)}`);
  }
  if (
    (await db.production.count({ where: { enregistreParId: user.id } })) !== compteP ||
    (await db.mouvementStock.count({ where: { auteurId: user.id } })) !== compteM ||
    (await db.auditLog.count({ where: { utilisateurId: user.id } })) !== compteAudits
  ) ko("une écriture ou une trace d’audit partielle a survécu au rejet de stock");
  const farineApres = await db.matierePremiere.findUniqueOrThrow({ where: { id: farineAvant.id } });
  const levureApres = await db.matierePremiere.findUniqueOrThrow({ where: { id: levureAvant.id } });
  eqDecimal(farineApres.quantiteStock, farineAvant.quantiteStock.toNumber(), "farine après rollback");
  eqDecimal(levureApres.quantiteStock, levureAvant.quantiteStock.toNumber(), "levure après rollback");
  console.log("  ✓ Production, mouvement, stocks et AuditLog partiels tous annulés.");

  console.log("→ 3/6 pertes, qualité, clôture et audits exacts…");
  let r = await request(app).put(`/api/production/productions/${productionId}/pertes`).set(auth)
    .send({ pertes: [{ motifPerteId: motifA.id, nombreBacs: 2 }] });
  if (r.status !== 200) ko(`création pertes: ${r.status}`);
  r = await request(app).put(`/api/production/productions/${productionId}/pertes`).set(auth)
    .send({ pertes: [{ motifPerteId: motifB.id, nombreBacs: 2 }] });
  if (r.status !== 200) ko(`remplacement pertes: ${r.status}`);
  r = await request(app).put(`/api/production/productions/${productionId}/controle-qualite`).set(auth)
    .send({ verdict: "CONFORME", observations: "Premier" });
  if (r.status !== 200) ko(`création contrôle: ${r.status}`);
  r = await request(app).put(`/api/production/productions/${productionId}/controle-qualite`).set(auth)
    .send({ verdict: "NON_CONFORME", motifId: motifNC.id, observations: "Corrigé" });
  if (r.status !== 200) ko(`correction contrôle: ${r.status}`);
  r = await request(app).post(`/api/production/productions/${productionId}/cloturer`).set(auth);
  if (r.status !== 200) ko(`clôture: ${r.status} ${JSON.stringify(r.body)}`);
  const audits = await db.auditLog.findMany({
    where: { utilisateurId: user.id, module: "PRODUCTION" }, orderBy: { createdAt: "asc" },
  });
  const signatures = audits.map((a) => `${a.typeEntite}:${a.action}`);
  const exact = ["ProductionPerte:SUPPRESSION", "ControleQualite:MODIFICATION", "Production:MODIFICATION"];
  if (JSON.stringify(signatures) !== JSON.stringify(exact) || audits.some((a) => a.utilisateurNom !== user.nom)) {
    ko(`audits attendus ${JSON.stringify(exact)}, reçus ${JSON.stringify(signatures)}`);
  }
  console.log("  ✓ trois AuditLog transactionnels avec l'acteur HTTP exact.");

  console.log("→ 4/6 verrou définitif après clôture…");
  const p409 = await request(app).put(`/api/production/productions/${productionId}/pertes`).set(auth).send({ pertes: [] });
  const q409 = await request(app).put(`/api/production/productions/${productionId}/controle-qualite`).set(auth)
    .send({ verdict: "CONFORME" });
  if (p409.status !== 409 || q409.status !== 409) ko(`attendu 409/409 après clôture, reçu ${p409.status}/${q409.status}`);
  console.log("  ✓ pertes et qualité sont définitivement figées.");

  console.log("→ 5/6 échec d'audit après écriture : quatre rollbacks réels…");
  const pp = await nouvelleProduction(user.id, motifA.id);
  const pq = await nouvelleProduction(user.id, undefined, true, 0);
  const pc = await nouvelleProduction(user.id, motifA.id, true);
  const datePlanning = "2099-01-31";
  const planningAvant = await db.planningProduction.create({
    data: {
      datePrevue: new Date(datePlanning),
      nombreBacsCommandes: 10,
      creeParId: user.id,
      lignes: { create: [{ produitId: produit.id, quantitePrevue: 10 }] },
    },
  });
  await triggerAudit(true);
  try {
    r = await request(app).put(`/api/production/productions/${pp.id}/pertes`).set(auth)
      .send({ pertes: [{ motifPerteId: motifB.id, nombreBacs: 2 }] });
    if (r.status !== 500) ko(`rollback pertes attendu 500, reçu ${r.status}`);
    const lp = await db.productionPerte.findMany({ where: { productionId: pp.id } });
    if (lp.length !== 1 || lp[0]!.motifPerteId !== motifA.id) ko("le remplacement de pertes a survécu");

    r = await request(app).put(`/api/production/productions/${pq.id}/controle-qualite`).set(auth)
      .send({ verdict: "NON_CONFORME", motifId: motifNC.id, observations: "Après" });
    if (r.status !== 500) ko(`rollback qualité attendu 500, reçu ${r.status}`);
    const cq = await db.controleQualite.findUniqueOrThrow({ where: { productionId: pq.id } });
    if (cq.verdict !== "CONFORME" || cq.motifId !== null || cq.observations !== "Avant") ko("la correction qualité a survécu");

    r = await request(app).post(`/api/production/productions/${pc.id}/cloturer`).set(auth);
    if (r.status !== 500) ko(`rollback clôture attendu 500, reçu ${r.status}`);
    const cp = await db.production.findUniqueOrThrow({ where: { id: pc.id } });
    if (cp.statut !== "OUVERTE" || cp.clotureeLe !== null || cp.clotureeParId !== null) ko("la clôture a survécu");

    r = await request(app).post("/api/production/planning").set(auth).send({
      datePrevue: datePlanning,
      nombreBacsCommandes: 12,
      lignes: [{ produitId: produit.id, quantitePrevue: 12 }],
    });
    if (r.status !== 500) ko(`rollback planning attendu 500, reçu ${r.status}`);
    const planningReel = await db.planningProduction.findUniqueOrThrow({
      where: { id: planningAvant.id },
      include: { lignes: true },
    });
    if (
      planningReel.nombreBacsCommandes !== 10 ||
      planningReel.lignes.length !== 1 ||
      planningReel.lignes[0]!.quantitePrevue !== 10
    ) ko("le remplacement du planning a survécu");
  } finally {
    await triggerAudit(false);
  }
  console.log("  ✓ planning, pertes, qualité et clôture tous annulés par PostgreSQL.");

  console.log("→ 6/6 verrou concurrent observé par pg_blocking_pids…");
  const concurrente = await nouvelleProduction(user.id, motifA.id, true);
  const bloqueur = new PrismaClient();
  await bloqueur.$connect();
  let liberer!: () => void;
  let signaler!: () => void;
  const attente = new Promise<void>((resolve) => { liberer = resolve; });
  const pris = new Promise<void>((resolve) => { signaler = resolve; });
  const txn = bloqueur.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Production" WHERE id = ${concurrente.id} FOR UPDATE`;
    signaler();
    await attente;
  });
  try {
    await pris;
    const enCours = request(app).post(`/api/production/productions/${concurrente.id}/cloturer`).set(auth).then((x) => x);
    await attendreBlocageProduction();
    liberer();
    await txn;
    r = await enCours;
    if (r.status !== 200) ko(`clôture libérée attendue 200, reçu ${r.status} ${JSON.stringify(r.body)}`);
  } finally {
    liberer();
    await txn.catch(() => undefined);
    await bloqueur.$disconnect();
  }
  console.log("  ✓ le routeur a réellement attendu le verrou PostgreSQL.");

  console.log("→ 7/7 verrou du Planning observé avant toute suppression…");
  const datePlanningConcurrent = "2099-02-01";
  const planningConcurrent = await db.planningProduction.create({
    data: {
      datePrevue: new Date(datePlanningConcurrent),
      nombreBacsCommandes: 10,
      creeParId: user.id,
      lignes: { create: [{ produitId: produit.id, quantitePrevue: 10 }] },
    },
  });
  const bloqueurPlanning = new PrismaClient();
  await bloqueurPlanning.$connect();
  let libererPlanning!: () => void;
  let signalerPlanning!: () => void;
  const attentePlanning = new Promise<void>((resolve) => { libererPlanning = resolve; });
  const prisPlanning = new Promise<void>((resolve) => { signalerPlanning = resolve; });
  const txnPlanning = bloqueurPlanning.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "PlanningProduction" WHERE id = ${planningConcurrent.id} FOR UPDATE`;
    signalerPlanning();
    await attentePlanning;
  });
  try {
    await prisPlanning;
    const enCours = request(app).post("/api/production/planning").set(auth).send({
      datePrevue: datePlanningConcurrent,
      nombreBacsCommandes: 14,
      lignes: [{ produitId: produit.id, quantitePrevue: 14 }],
    }).then((x) => x);
    const debut = Date.now();
    let verrouObserve = false;
    while (Date.now() - debut < 5000) {
      const blocages = await db.$queryRaw<{ bloqueurs: number[] }[]>`
        SELECT pg_blocking_pids(pid) AS bloqueurs
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND cardinality(pg_blocking_pids(pid)) > 0
          AND query LIKE '%FROM "PlanningProduction"%FOR UPDATE%'
      `;
      if (blocages[0]?.bloqueurs.length) { verrouObserve = true; break; }
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    if (!verrouObserve) ko("le verrou Planning FOR UPDATE n’a jamais été observé");
    const pendant = await db.planningProduction.findUniqueOrThrow({
      where: { id: planningConcurrent.id }, include: { lignes: true },
    });
    if (pendant.nombreBacsCommandes !== 10 || pendant.lignes[0]?.quantitePrevue !== 10) {
      ko("le Planning a été écrit avant l’obtention du verrou");
    }
    libererPlanning();
    await txnPlanning;
    const reponse = await enCours;
    if (reponse.status !== 201) ko(`Planning libéré attendu 201, reçu ${reponse.status} ${JSON.stringify(reponse.body)}`);
    const apresPlanning = await db.planningProduction.findUniqueOrThrow({
      where: { id: planningConcurrent.id }, include: { lignes: true },
    });
    if (
      apresPlanning.nombreBacsCommandes !== 14 ||
      apresPlanning.lignes.length !== 1 ||
      apresPlanning.lignes[0]?.quantitePrevue !== 14
    ) ko("le remplacement Planning final n’est pas exact");
  } finally {
    libererPlanning();
    await txnPlanning.catch(() => undefined);
    await bloqueurPlanning.$disconnect();
  }
  console.log("  ✓ aucune ligne supprimée avant le verrou, remplacement final exact.");

  console.log("\n✅ Production : 7/7 scénarios HTTP + PostgreSQL réels verts.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await nettoyer().catch((e) => {
      console.error("Nettoyage Production CI échoué :", e);
      process.exitCode = 1;
    });
    await db.$disconnect();
  });
