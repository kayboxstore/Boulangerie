/**
 * Lot Fournisseurs P1 — preuves HTTP + PostgreSQL réel, sans mock.
 * Garde obligatoire : hôte local et base exacte lomoto_ci.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-fournisseurs-ci.ts");
const db = new PrismaClient();
const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const traces = {
  role: "",
  user: "",
  fournisseur: "",
  matieres: [] as string[],
};

function ko(message: string): never {
  process.exitCode = 1;
  throw new Error(`❌ Fournisseurs CI : ${message}`);
}
function eqDecimal(recu: Prisma.Decimal, attendu: Prisma.Decimal | number, nom: string) {
  const valeur = attendu instanceof Prisma.Decimal ? attendu : new Prisma.Decimal(attendu);
  if (!recu.equals(valeur)) ko(`${nom}: attendu ${valeur}, reçu ${recu}`);
}
async function triggerAudit(actif: boolean) {
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "ci_rejet_audit_fournisseurs" ON "AuditLog"');
  await db.$executeRawUnsafe("DROP FUNCTION IF EXISTS ci_rejet_audit_fournisseurs()");
  if (!actif) return;
  await db.$executeRawUnsafe(`
    CREATE FUNCTION ci_rejet_audit_fournisseurs() RETURNS trigger AS $$
    BEGIN
      IF NEW.module = 'FOURNISSEURS' THEN
        RAISE EXCEPTION 'rejet audit Fournisseurs injecté par la CI';
      END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql
  `);
  await db.$executeRawUnsafe(`
    CREATE TRIGGER "ci_rejet_audit_fournisseurs" BEFORE INSERT ON "AuditLog"
    FOR EACH ROW EXECUTE FUNCTION ci_rejet_audit_fournisseurs()
  `);
}
async function nouvelleCommande(quantiteA = 2, quantiteB = 3) {
  return db.commandeFournisseur.create({
    data: {
      fournisseurId: traces.fournisseur,
      creeParId: traces.user,
      lignes: {
        create: [
          { matierePremiereId: traces.matieres[1]!, quantite: quantiteB, prixUnitaire: 2000 },
          { matierePremiereId: traces.matieres[0]!, quantite: quantiteA, prixUnitaire: 1000 },
        ],
      },
    },
    include: { lignes: true },
  });
}
async function stocks() {
  const lignes = await db.matierePremiere.findMany({
    where: { id: { in: traces.matieres } },
    orderBy: { id: "asc" },
  });
  return new Map(lignes.map((m) => [m.id, m.quantiteStock]));
}
async function attendreBlocageCommande() {
  const debut = Date.now();
  while (Date.now() - debut < 5000) {
    const lignes = await db.$queryRaw<{ bloqueurs: number[] }[]>`
      SELECT pg_blocking_pids(pid) AS bloqueurs
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND cardinality(pg_blocking_pids(pid)) > 0
        AND query LIKE '%FROM "CommandeFournisseur"%FOR UPDATE%'
    `;
    if (lignes.some((l) => l.bloqueurs.length > 0)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  ko("le verrou concurrent sur CommandeFournisseur n'a jamais été observé");
}
async function nettoyer() {
  await triggerAudit(false).catch(() => undefined);
  if (traces.user) {
    await db.auditLog.deleteMany({ where: { utilisateurId: traces.user } });
    await db.mouvementStock.deleteMany({ where: { auteurId: traces.user } });
  }
  if (traces.fournisseur) {
    await db.commandeFournisseur.deleteMany({ where: { fournisseurId: traces.fournisseur } });
    await db.fournisseur.deleteMany({ where: { id: traces.fournisseur } });
  }
  if (traces.matieres.length) {
    await db.matierePremiere.deleteMany({ where: { id: { in: traces.matieres } } });
  }
  if (traces.user) await db.utilisateur.deleteMany({ where: { id: traces.user } });
  if (traces.role) await db.role.deleteMany({ where: { id: traces.role } });
}

async function main() {
  const { fournisseursRouter } = await import("../apps/api/src/routes/fournisseurs.js");
  const { signToken } = await import("../apps/api/src/lib/jwt.js");
  const app = express();
  app.use(express.json());
  app.use("/api/fournisseurs", fournisseursRouter);
  app.use((_e: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) =>
    res.status(500).json({ erreur: "Erreur interne" }),
  );

  const role = await db.role.create({ data: { nom: `Fournisseurs CI ${tag}`, roleParentId: null } });
  traces.role = role.id;
  const sid = `sid-fournisseurs-${tag}`;
  const user = await db.utilisateur.create({
    data: {
      nom: "Responsable Fournisseurs CI",
      email: `fournisseurs-${tag}@test.local`,
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

  const fournisseur = await db.fournisseur.create({
    data: { nom: `Minoterie CI ${tag}`, contact: "Avant" },
  });
  traces.fournisseur = fournisseur.id;
  const matiereA = await db.matierePremiere.create({
    data: { nom: `Farine Fournisseurs CI ${tag}`, unite: "sac", quantiteStock: 10, seuilAlerte: 1 },
  });
  const matiereB = await db.matierePremiere.create({
    data: { nom: `Levure Fournisseurs CI ${tag}`, unite: "paquet", quantiteStock: 20, seuilAlerte: 1 },
  });
  traces.matieres.push(matiereA.id, matiereB.id);

  console.log("→ 1/7 réception réelle : statut, deux stocks et trois audits…");
  const commande = await nouvelleCommande();
  let r = await request(app).post(`/api/fournisseurs/commandes/${commande.id}/reception`).set(auth);
  if (r.status !== 200) ko(`réception attendue 200, reçue ${r.status} ${JSON.stringify(r.body)}`);
  const recue = await db.commandeFournisseur.findUniqueOrThrow({ where: { id: commande.id } });
  if (recue.statut !== "RECUE" || !recue.dateReception || recue.recueParId !== user.id) ko("statut de réception inexact");
  const apres1 = await stocks();
  eqDecimal(apres1.get(matiereA.id)!, 12, "stock matière A");
  eqDecimal(apres1.get(matiereB.id)!, 23, "stock matière B");
  const mouvements1 = await db.mouvementStock.findMany({ where: { commandeFournisseurId: commande.id } });
  if (mouvements1.length !== 2 || mouvements1.some((m) => m.type !== "ENTREE" || m.auteurId !== user.id)) {
    ko("les deux mouvements ENTREE exacts sont absents");
  }
  const audits1 = await db.auditLog.findMany({
    where: { utilisateurId: user.id, entiteId: { in: [matiereA.id, matiereB.id, commande.id] } },
  });
  const signatures1 = audits1.map((a) => `${a.module}:${a.typeEntite}:${a.action}`).sort();
  const attendues1 = [
    "FOURNISSEURS:CommandeFournisseur:MODIFICATION",
    "STOCKS:MatierePremiere:MODIFICATION",
    "STOCKS:MatierePremiere:MODIFICATION",
  ].sort();
  if (JSON.stringify(signatures1) !== JSON.stringify(attendues1)) {
    ko(`audits de réception inexacts : ${JSON.stringify(signatures1)}`);
  }
  console.log("  ✓ réception et audits atomiques exacts.");

  console.log("→ 2/7 seconde réception refusée sans effet supplémentaire…");
  const avant2 = await stocks();
  const nbMouvements2 = await db.mouvementStock.count({ where: { commandeFournisseurId: commande.id } });
  const nbAudits2 = await db.auditLog.count({ where: { utilisateurId: user.id } });
  r = await request(app).post(`/api/fournisseurs/commandes/${commande.id}/reception`).set(auth);
  if (r.status !== 409) ko(`seconde réception attendue 409, reçue ${r.status}`);
  const apres2 = await stocks();
  for (const id of traces.matieres) eqDecimal(apres2.get(id)!, avant2.get(id)!, `stock inchangé ${id}`);
  if (
    (await db.mouvementStock.count({ where: { commandeFournisseurId: commande.id } })) !== nbMouvements2 ||
    (await db.auditLog.count({ where: { utilisateurId: user.id } })) !== nbAudits2
  ) ko("la seconde réception a laissé un effet");
  console.log("  ✓ zéro double mouvement, zéro double audit.");

  console.log("→ 3/7 double réception concurrente sous verrou PostgreSQL réel…");
  const concurrente = await nouvelleCommande(1, 1);
  const avant3 = await stocks();
  const bloqueur = new PrismaClient();
  await bloqueur.$connect();
  let liberer!: () => void;
  let signaler!: () => void;
  const attente = new Promise<void>((resolve) => { liberer = resolve; });
  const pris = new Promise<void>((resolve) => { signaler = resolve; });
  const txn = bloqueur.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CommandeFournisseur" WHERE id = ${concurrente.id} FOR UPDATE`;
    signaler();
    await attente;
  });
  try {
    await pris;
    const a = request(app).post(`/api/fournisseurs/commandes/${concurrente.id}/reception`).set(auth).then((x) => x);
    const b = request(app).post(`/api/fournisseurs/commandes/${concurrente.id}/reception`).set(auth).then((x) => x);
    await attendreBlocageCommande();
    liberer();
    await txn;
    const codes = [(await a).status, (await b).status].sort((x, y) => x - y);
    if (JSON.stringify(codes) !== JSON.stringify([200, 409])) ko(`double réception : codes ${codes}`);
  } finally {
    liberer();
    await txn.catch(() => undefined);
    await bloqueur.$disconnect();
  }
  const apres3 = await stocks();
  for (const id of traces.matieres) {
    eqDecimal(apres3.get(id)!, avant3.get(id)!.plus(1), `incrément concurrent unique ${id}`);
  }
  if ((await db.mouvementStock.count({ where: { commandeFournisseurId: concurrente.id } })) !== 2) {
    ko("la double réception n'a pas produit exactement un jeu de mouvements");
  }
  console.log("  ✓ une réussite, un 409, blocage observé et un seul jeu de stocks.");

  console.log("→ 4/7 échec d'audit de réception : rollback statut, stocks et mouvements…");
  const rollbackReception = await nouvelleCommande(4, 5);
  const avant4 = await stocks();
  const auditsAvant4 = await db.auditLog.count({ where: { utilisateurId: user.id } });
  await triggerAudit(true);
  try {
    r = await request(app).post(`/api/fournisseurs/commandes/${rollbackReception.id}/reception`).set(auth);
    if (r.status !== 500) ko(`échec audit réception attendu 500, reçu ${r.status}`);
  } finally {
    await triggerAudit(false);
  }
  const commande4 = await db.commandeFournisseur.findUniqueOrThrow({ where: { id: rollbackReception.id } });
  if (commande4.statut !== "EN_ATTENTE" || commande4.dateReception || commande4.recueParId) ko("statut a survécu au rollback");
  const apres4 = await stocks();
  for (const id of traces.matieres) eqDecimal(apres4.get(id)!, avant4.get(id)!, `stock rollback ${id}`);
  if (
    (await db.mouvementStock.count({ where: { commandeFournisseurId: rollbackReception.id } })) !== 0 ||
    (await db.auditLog.count({ where: { utilisateurId: user.id } })) !== auditsAvant4
  ) ko("un mouvement ou audit partiel a survécu au rollback de réception");
  console.log("  ✓ rollback intégral après deux mouvements et leurs audits.");

  console.log("→ 5/7 échec d'audit d'annulation : commande et lignes conservées…");
  const rollbackAnnulation = await nouvelleCommande();
  await triggerAudit(true);
  try {
    r = await request(app).delete(`/api/fournisseurs/commandes/${rollbackAnnulation.id}`).set(auth);
    if (r.status !== 500) ko(`échec audit annulation attendu 500, reçu ${r.status}`);
  } finally {
    await triggerAudit(false);
  }
  const commande5 = await db.commandeFournisseur.findUnique({
    where: { id: rollbackAnnulation.id }, include: { lignes: true },
  });
  if (!commande5 || commande5.lignes.length !== 2 || commande5.statut !== "EN_ATTENTE") {
    ko("la commande annulée a disparu malgré le rollback");
  }
  console.log("  ✓ suppression cascade et audits tous annulés.");

  console.log("→ 6/7 échec d'audit de modification Fournisseur : ancienne valeur conservée…");
  await triggerAudit(true);
  try {
    r = await request(app).put(`/api/fournisseurs/${fournisseur.id}`).set(auth).send({ contact: "Après" });
    if (r.status !== 500) ko(`échec audit modification attendu 500, reçu ${r.status}`);
  } finally {
    await triggerAudit(false);
  }
  const fournisseur6 = await db.fournisseur.findUniqueOrThrow({ where: { id: fournisseur.id } });
  if (fournisseur6.contact !== "Avant") ko("la modification Fournisseur a survécu à l'échec d'audit");
  console.log("  ✓ modification et audit partagent le même rollback.");

  console.log("→ 7/7 échec d'audit de suppression Fournisseur : ligne conservée…");
  const supprimable = await db.fournisseur.create({ data: { nom: `Supprimable CI ${tag}` } });
  await triggerAudit(true);
  try {
    r = await request(app).delete(`/api/fournisseurs/${supprimable.id}`).set(auth);
    if (r.status !== 500) ko(`échec audit suppression attendu 500, reçu ${r.status}`);
  } finally {
    await triggerAudit(false);
  }
  if (!(await db.fournisseur.findUnique({ where: { id: supprimable.id } }))) {
    ko("le Fournisseur a disparu malgré l'échec d'audit");
  }
  await db.fournisseur.delete({ where: { id: supprimable.id } });
  console.log("  ✓ suppression et audit partagent le même rollback.");

  console.log("\n✅ Fournisseurs : 7/7 scénarios HTTP + PostgreSQL réels verts.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await nettoyer().catch((e) => {
      console.error("Nettoyage Fournisseurs CI échoué :", e);
      process.exitCode = 1;
    });
    await db.$disconnect();
  });
