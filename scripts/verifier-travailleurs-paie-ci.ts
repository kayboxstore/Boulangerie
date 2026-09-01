/**
 * Lot 5 Travailleurs / présence / paie — preuves HTTP + PostgreSQL réel.
 * Garde obligatoire : hôte local et base exacte lomoto_ci.
 */
import { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-travailleurs-paie-ci.ts");
const db = new PrismaClient();
const controle = new PrismaClient();
const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const traces = { role: "", user: "", departement: "", travailleurs: [] as string[] };

function ko(message: string): never {
  process.exitCode = 1;
  throw new Error(`❌ Travailleurs CI : ${message}`);
}

async function triggerAudit(actif: boolean) {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "ci_rejet_audit_travailleurs" ON "AuditLog"');
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS ci_rejet_audit_travailleurs()");
  if (!actif) return;
  await db.$executeRawUnsafe(`
    CREATE FUNCTION ci_rejet_audit_travailleurs() RETURNS trigger AS $$
    BEGIN
      IF NEW.module = 'TRAVAILLEURS' AND NEW."utilisateurId" = '${traces.user}' THEN
        RAISE EXCEPTION 'rejet audit Travailleurs injecté par la CI';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql
  `);
  await db.$executeRawUnsafe(`
    CREATE TRIGGER "ci_rejet_audit_travailleurs" BEFORE INSERT ON "AuditLog"
    FOR EACH ROW EXECUTE FUNCTION ci_rejet_audit_travailleurs()
  `);
}

async function nettoyer() {
  await triggerAudit(false).catch(() => undefined);
  if (traces.travailleurs.length) {
    await db.bulletinPaie.deleteMany({ where: { travailleurId: { in: traces.travailleurs } } });
    await db.pointage.deleteMany({ where: { travailleurId: { in: traces.travailleurs } } });
    await db.absence.deleteMany({ where: { travailleurId: { in: traces.travailleurs } } });
    await db.sanction.deleteMany({ where: { travailleurId: { in: traces.travailleurs } } });
    await db.travailleur.deleteMany({ where: { id: { in: traces.travailleurs } } });
  }
  if (traces.user) {
    await db.auditLog.deleteMany({ where: { utilisateurId: traces.user } });
    await db.utilisateur.deleteMany({ where: { id: traces.user } });
  }
  if (traces.departement) await db.departement.deleteMany({ where: { id: traces.departement } });
  if (traces.role) await db.role.deleteMany({ where: { id: traces.role } });
}

async function attendreBlocageTravailleur(): Promise<boolean> {
  for (let i = 0; i < 80; i += 1) {
    const lignes = await controle.$queryRaw<Array<{ bloqueurs: number[] }>>`
      SELECT pg_blocking_pids(pid) AS bloqueurs
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND query LIKE '%FROM "Travailleur"%FOR UPDATE%'
        AND cardinality(pg_blocking_pids(pid)) > 0
    `;
    if (lignes.some((ligne) => ligne.bloqueurs.length > 0)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function main() {
  const [{ travailleursRouter }, { signToken }] = await Promise.all([
    import("../apps/api/src/routes/travailleurs.js"),
    import("../apps/api/src/lib/jwt.js"),
  ]);

  const app = express();
  app.use(express.json());
  app.use("/api/travailleurs", travailleursRouter);
  app.use((e: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("Erreur route Travailleurs CI :", e);
    res.status(500).json({ erreur: "Erreur interne" });
  });

  const role = await db.role.create({ data: { nom: `Travailleurs CI ${tag}`, roleParentId: null } });
  traces.role = role.id;
  await db.rolePermission.create({ data: { roleId: role.id, module: "TRAVAILLEURS", niveauAcces: "ECRITURE" } });
  const sid = `sid-travailleurs-${tag}`;
  const user = await db.utilisateur.create({
    data: {
      nom: "Chargé du personnel CI",
      email: `travailleurs-${tag}@test.local`,
      motDePasseHash: "x",
      roleId: role.id,
      actif: true,
      estAdminPrincipal: true,
      sessionActuelleId: sid,
    },
  });
  traces.user = user.id;
  const auth = { Authorization: `Bearer ${signToken({ sub: user.id, roleId: role.id, sid })}` };
  const departement = await db.departement.create({ data: { nom: `Production Travailleurs CI ${tag}` } });
  traces.departement = departement.id;

  console.log("→ 1/7 création HTTP : fiche complète et auteur authentifié persisté…");
  let r = await request(app).post("/api/travailleurs").set(auth).send({
    nom: `Boulanger CI ${tag}`,
    poste: "Boulanger",
    dateEmbauche: "2097-01-01",
    departementId: departement.id,
    salaireMensuel: 260_000,
    joursTravaillesParMois: 26,
  });
  if (r.status !== 201) ko(`création attendue 201, reçue ${r.status} ${JSON.stringify(r.body)}`);
  const travailleurId = r.body.travailleur?.id as string;
  traces.travailleurs.push(travailleurId);
  const travailleurCree = await db.travailleur.findUniqueOrThrow({ where: { id: travailleurId } });
  if ((travailleurCree as typeof travailleurCree & { creeParId: string | null }).creeParId !== user.id) {
    ko("l'auteur de la fiche n'est pas l'utilisateur HTTP authentifié");
  }
  console.log("  ✓ identité, salaire, département et auteur exacts.");

  console.log("→ 2/7 pointages : chevauchement refusé et concurrence sérialisée…");
  r = await request(app).post("/api/travailleurs/pointages").set(auth).send({
    travailleurId,
    horodatageEntree: "2097-09-01T06:00:00.000Z",
    horodatageSortie: "2097-09-01T14:00:00.000Z",
  });
  if (r.status !== 201) ko(`premier pointage attendu 201, reçu ${r.status}`);
  const pointageId = r.body.pointage?.id as string;
  r = await request(app).post("/api/travailleurs/pointages").set(auth).send({
    travailleurId,
    horodatageEntree: "2097-09-01T13:00:00.000Z",
    horodatageSortie: "2097-09-01T15:00:00.000Z",
  });
  if (r.status !== 409) ko(`chevauchement attendu 409, reçu ${r.status}`);
  const concurrents = await Promise.all([
    request(app).post("/api/travailleurs/pointages").set(auth).send({ travailleurId, horodatageEntree: "2097-09-01T15:00:00.000Z" }),
    request(app).post("/api/travailleurs/pointages").set(auth).send({ travailleurId, horodatageEntree: "2097-09-01T16:00:00.000Z" }),
  ]);
  const statutsPointage = concurrents.map((x) => x.status).sort();
  if (statutsPointage[0] !== 201 || statutsPointage[1] !== 409) {
    ko(`concurrence pointage attendue 201/409, reçue ${statutsPointage.join("/")}`);
  }
  if ((await db.pointage.count({ where: { travailleurId } })) !== 2) ko("nombre de pointages incohérent après concurrence");
  console.log("  ✓ une seule présence ouverte, aucun intervalle chevauchant.");

  console.log("→ 3/7 absences : doublon concurrent refusé et décision non rejouable…");
  const absencesConcurrentes = await Promise.all([
    request(app).post("/api/travailleurs/absences").set(auth).send({ travailleurId, date: "2097-09-03", motif: "Maladie" }),
    request(app).post("/api/travailleurs/absences").set(auth).send({ travailleurId, date: "2097-09-03", motif: "Maladie" }),
  ]);
  const statutsAbsence = absencesConcurrentes.map((x) => x.status).sort();
  if (statutsAbsence[0] !== 201 || statutsAbsence[1] !== 409) {
    ko(`concurrence absence attendue 201/409, reçue ${statutsAbsence.join("/")}`);
  }
  const absence = await db.absence.findFirstOrThrow({ where: { travailleurId, date: new Date("2097-09-03") } });
  const decisions = await Promise.all([
    request(app).put(`/api/travailleurs/absences/${absence.id}/decision`).set(auth).send({ decisionStatut: "NON_JUSTIFIEE" }),
    request(app).put(`/api/travailleurs/absences/${absence.id}/decision`).set(auth).send({ decisionStatut: "NON_JUSTIFIEE" }),
  ]);
  const statutsDecision = decisions.map((x) => x.status).sort();
  if (statutsDecision[0] !== 200 || statutsDecision[1] !== 409) {
    ko(`décision concurrente attendue 200/409, reçue ${statutsDecision.join("/")}`);
  }
  const absenceDecidee = await db.absence.findUniqueOrThrow({ where: { id: absence.id } });
  const auditsAbsence = await db.auditLog.count({ where: { utilisateurId: user.id, typeEntite: "Absence", entiteId: absence.id } });
  if (absenceDecidee.decisionStatut !== "NON_JUSTIFIEE" || absenceDecidee.decideParId !== user.id || auditsAbsence !== 1) {
    ko("décision finale ou audit unique de l'absence incorrect");
  }
  console.log("  ✓ une absence, une décision et un audit exacts.");

  console.log("→ 4/7 échec d'audit : trois rollbacks PostgreSQL réels…");
  const sanction = await db.sanction.create({
    data: { travailleurId, type: "RETENUE", motif: "Retard", montant: 15_000, date: new Date("2097-09-04"), enregistreParId: user.id },
  });
  await triggerAudit(true);
  try {
    r = await request(app).put(`/api/travailleurs/${travailleurId}`).set(auth).send({ salaireMensuel: 999_000 });
    if (r.status !== 500) ko(`échec audit fiche attendu 500, reçu ${r.status}`);
    r = await request(app).put(`/api/travailleurs/pointages/${pointageId}`).set(auth).send({ horodatageSortie: "2097-09-01T13:00:00.000Z" });
    if (r.status !== 500) ko(`échec audit pointage attendu 500, reçu ${r.status}`);
    r = await request(app).delete(`/api/travailleurs/sanctions/${sanction.id}`).set(auth);
    if (r.status !== 500) ko(`échec audit sanction attendu 500, reçu ${r.status}`);
  } finally {
    await triggerAudit(false);
  }
  const [ficheRollback, pointageRollback, sanctionRollback] = await Promise.all([
    db.travailleur.findUniqueOrThrow({ where: { id: travailleurId } }),
    db.pointage.findUniqueOrThrow({ where: { id: pointageId } }),
    db.sanction.findUnique({ where: { id: sanction.id } }),
  ]);
  if (ficheRollback.salaireMensuel !== 260_000 || pointageRollback.horodatageSortie?.toISOString() !== "2097-09-01T14:00:00.000Z" || !sanctionRollback) {
    ko("une écriture métier a survécu à l'échec de son audit");
  }
  console.log("  ✓ fiche, pointage et sanction strictement restaurés.");

  console.log("→ 5/7 bulletin : snapshot cohérent, exact et immuable…");
  r = await request(app).post(`/api/travailleurs/${travailleurId}/bulletins-paie?mois=2097-09`).set(auth);
  if (r.status !== 201) ko(`bulletin attendu 201, reçu ${r.status} ${JSON.stringify(r.body)}`);
  const premierBulletinId = r.body.bulletin?.id as string;
  const premier = await db.bulletinPaie.findUniqueOrThrow({ where: { id: premierBulletinId } });
  if (premier.salaireMensuel !== 260_000 || premier.retenueAbsences !== 10_000 || premier.totalRetenuesDisciplinaires !== 15_000 || premier.salaireNet !== 235_000 || premier.genereParId !== user.id) {
    ko("le premier snapshot de paie est inexact");
  }
  r = await request(app).put(`/api/travailleurs/${travailleurId}`).set(auth).send({ salaireMensuel: 300_000 });
  if (r.status !== 200) ko(`mise à jour salaire attendue 200, reçue ${r.status}`);
  await db.sanction.create({
    data: { travailleurId, type: "RETENUE", motif: "Matériel", montant: 5_000, date: new Date("2097-09-05"), enregistreParId: user.id },
  });
  r = await request(app).post(`/api/travailleurs/${travailleurId}/bulletins-paie?mois=2097-09`).set(auth);
  if (r.status !== 201) ko(`second bulletin attendu 201, reçu ${r.status}`);
  const premierInchange = await db.bulletinPaie.findUniqueOrThrow({ where: { id: premierBulletinId } });
  if (premierInchange.salaireMensuel !== 260_000 || premierInchange.salaireNet !== 235_000) ko("le premier bulletin a été recalculé rétroactivement");
  console.log("  ✓ salaire et retenues figés sans altération rétroactive.");

  console.log("→ 6/7 concurrence : génération réellement bloquée sur le verrou Travailleur…");
  let liberer!: () => void;
  let verrouPris!: () => void;
  const porte = new Promise<void>((resolve) => { liberer = resolve; });
  const pris = new Promise<void>((resolve) => { verrouPris = resolve; });
  const verrou = controle.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Travailleur" WHERE "id" = ${travailleurId} FOR UPDATE`;
    verrouPris();
    await porte;
  }, { timeout: 15_000 });
  await pris;
  // Supertest est un thenable paresseux : sans `.then`, la requête ne démarre
  // qu'au premier `await`, donc après notre observation de pg_blocking_pids.
  const bulletinBloque = request(app)
    .post(`/api/travailleurs/${travailleurId}/bulletins-paie?mois=2097-09`)
    .set(auth)
    .then((reponse) => reponse);
  const observation = await attendreBlocageTravailleur();
  liberer();
  await verrou;
  r = await bulletinBloque;
  if (!observation || r.status !== 201) ko(`blocage réel non observé ou bulletin final incorrect (${observation}/${r.status})`);
  console.log("  ✓ pg_blocking_pids a observé le verrou avant la génération.");

  console.log("→ 7/7 suppression : route et clé étrangère protègent les bulletins…");
  r = await request(app).delete(`/api/travailleurs/${travailleurId}`).set(auth);
  if (r.status !== 409) ko(`suppression avec bulletin attendue 409, reçue ${r.status}`);
  let suppressionSQLRefusee = false;
  try {
    await db.$executeRaw`DELETE FROM "Travailleur" WHERE "id" = ${travailleurId}`;
  } catch {
    suppressionSQLRefusee = true;
  }
  const [fichePreservee, bulletinsPreserves] = await Promise.all([
    db.travailleur.findUnique({ where: { id: travailleurId } }),
    db.bulletinPaie.count({ where: { travailleurId } }),
  ]);
  if (!suppressionSQLRefusee || !fichePreservee || bulletinsPreserves < 3) ko("la protection RESTRICT des bulletins n'est pas effective");
  console.log("  ✓ aucun chemin API ou SQL ne supprime un bulletin par cascade.");

  console.log("\n✅ Travailleurs / présence / paie : 7/7 scénarios HTTP + PostgreSQL réels verts.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await nettoyer().catch((e) => {
      console.error("Nettoyage Travailleurs CI échoué :", e);
      process.exitCode = 1;
    });
    await Promise.all([db.$disconnect(), controle.$disconnect()]);
  });
