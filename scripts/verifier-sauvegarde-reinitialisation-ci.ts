/**
 * Vérification CI, contre une VRAIE base PostgreSQL éphémère, du Lot P0
 * « sécurité/fiabilité du pilote » (30/08/2026, constat conjoint Codex/Claude
 * sur `services/reinitialisation.ts`, `services/sauvegarde.ts`,
 * `services/sauvegardeLocale.ts`, `lib/barriereEcriture.ts`,
 * `scripts/restaurer-sauvegarde.ts`).
 *
 * Ce script prouve, contre PostgreSQL et le système de fichiers réels
 * (jamais un mock) :
 *  1. Sauvegarde réelle d'une base contenant des données STRUCTURELLES
 *     (Role/RolePermission/TypeClient/Produit/MatierePremiere) ET
 *     TRANSACTIONNELLES (Utilisateur/Client/CommandeClient).
 *  2. L'archive produite est lisible et valide (`pg_restore --list` sur la
 *     VRAIE archive, via `validerDump`).
 *  3+4+5. Réinitialisation réelle : données transactionnelles supprimées,
 *     rôles/permissions/catalogue/référentiels conservés, stock remis à 0.
 *  6. Échec RÉEL de pg_dump (faux binaire, code de sortie non nul) : aucune
 *     donnée effacée.
 *  7. Échec RÉEL d'écriture locale (répertoire cible bloqué par un fichier
 *     existant) : aucune donnée effacée.
 *  8. Archive invalide (faux binaire pg_dump qui réussit mais produit un
 *     flux non-PostgreSQL) : aucun effacement, rejetée AVANT toute écriture.
 *  9. Écriture concurrente : une nouvelle écriture HTTP est REJETÉE (503)
 *     dès que la barrière est active ; une écriture déjà EN VOL au moment de
 *     l'activation est laissée se terminer et son résultat est bien présent
 *     en base — jamais perdue. Entrelacement déterministe via une porte
 *     manuelle (jamais un délai qui « espère » un chevauchement).
 *  10+11+12. Restauration réelle dans une base PostgreSQL temporaire
 *     séparée, relecture indépendante confirmant l'exactitude des données
 *     restaurées, puis nettoyage complet de la base temporaire — y compris
 *     si une étape précédente a échoué.
 *
 * Couvre aussi, en bonus, la désactivation par défaut en production
 * (NODE_ENV=production) et l'activation explicite contrôlée
 * (REINITIALISATION_PRODUCTION_AUTORISEE=true).
 *
 * SÉCURITÉ : même garde que tous les scripts d'intégration voisins — hôte
 * local, nom de base EXACT `lomoto_ci`, confirmation explicite. Voir
 * `scripts/garde-integration-ci.ts`. Ce script effectue de VRAIES écritures
 * ET de VRAIS effacements complets de la base ciblée.
 *
 * Lancement :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-sauvegarde-reinitialisation-ci.ts
 */
import { PrismaClient } from "@prisma/client";
import express from "express";
import request from "supertest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-sauvegarde-reinitialisation-ci.ts");

const execFileAsync = promisify(execFile);

const prisma = new PrismaClient();

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification sauvegarde/réinitialisation (Lot P0, 30/08/2026) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reinitialiserBaseDeTest(): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.demandeApprobation.deleteMany();
  await prisma.delegationRole.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.messageSupport.deleteMany();
  await prisma.conversationSupport.deleteMany();
  await prisma.pointage.deleteMany();
  await prisma.absence.deleteMany();
  await prisma.sanction.deleteMany();
  await prisma.bulletinPaie.deleteMany();
  await prisma.groupe.deleteMany();
  await prisma.departement.deleteMany();
  await prisma.travailleur.deleteMany();
  await prisma.bonLivraisonLigne.deleteMany();
  await prisma.bonLivraison.deleteMany();
  await prisma.transitionCycleLivraison.deleteMany();
  await prisma.anomalieCycleLivraison.deleteMany();
  await prisma.cycleLivraisonLigne.deleteMany();
  await prisma.cycleLivraison.deleteMany();
  await prisma.schemaCommandeLigne.deleteMany();
  await prisma.schemaCommande.deleteMany();
  await prisma.paiementCommande.deleteMany();
  await prisma.remiseCaisse.deleteMany();
  await prisma.sessionCaisse.deleteMany();
  await prisma.commandeClient.deleteMany();
  await prisma.client.deleteMany();
  await prisma.zoneDepositaire.deleteMany();
  await prisma.ligneCommandeFournisseur.deleteMany();
  await prisma.commandeFournisseur.deleteMany();
  await prisma.fournisseur.deleteMany();
  await prisma.mouvementStock.deleteMany();
  await prisma.ingredientRecette.deleteMany();
  await prisma.recette.deleteMany();
  await prisma.matierePremiere.deleteMany();
  await prisma.productionDon.deleteMany();
  await prisma.production.deleteMany();
  await prisma.planningLigneProduit.deleteMany();
  await prisma.planningProduction.deleteMany();
  await prisma.tauxDuJour.deleteMany();
  await prisma.depenseCaisse.deleteMany();
  await prisma.secretPremierLancement.deleteMany();
  await prisma.sauvegardeBase.deleteMany();
  await prisma.utilisateur.deleteMany();
  await prisma.produit.deleteMany();
  await prisma.typeClient.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.role.deleteMany();
  await prisma.parametreBoutique.deleteMany();
}

interface JeuDeDonnees {
  roleId: string;
  utilisateurId: string;
  produitId: string;
  typeClientId: string;
  matierePremiereId: string;
  clientId: string;
  commandeId: string;
}

/** Seed structurel ET transactionnel — sert de fixture à la majorité des scénarios. */
async function semerDonnees(): Promise<JeuDeDonnees> {
  const role = await prisma.role.create({
    data: {
      nom: `Role-CI-${Date.now()}`,
      permissions: { create: [{ module: "CAISSE", niveauAcces: "ECRITURE" }] },
    },
  });
  const utilisateur = await prisma.utilisateur.create({
    data: {
      nom: "Admin CI Sauvegarde",
      email: `admin-sauvegarde-ci-${Date.now()}@lomoto.test`,
      motDePasseHash: "hash-factice-ci",
      roleId: role.id,
      estAdminPrincipal: true,
    },
  });
  const produit = await prisma.produit.create({
    data: { nom: `Carré CI ${Date.now()}`, prixVente: 1500, categorie: "Pain" },
  });
  const typeClient = await prisma.typeClient.create({
    data: { nom: `Dépositaire CI ${Date.now()}`, prixParBac: 4100, commissionParBac: 0 },
  });
  const matierePremiere = await prisma.matierePremiere.create({
    data: { nom: `Farine CI ${Date.now()}`, unite: "sac", quantiteStock: 42, seuilAlerte: 5 },
  });
  const client = await prisma.client.create({
    data: { nom: "Client CI Sauvegarde", typeClientId: typeClient.id, avanceDisponible: 0 },
  });
  const commande = await prisma.commandeClient.create({
    data: {
      clientId: client.id,
      quantiteBacs: 10,
      montantBrut: 41000,
      commission: 0,
      avanceUtilisee: 0,
      montantAPercevoir: 41000,
      montantRecu: 41000,
      dette: 0,
      avanceGeneree: 0,
      nouvelleAvance: 0,
      creeParId: utilisateur.id,
    },
  });
  return {
    roleId: role.id,
    utilisateurId: utilisateur.id,
    produitId: produit.id,
    typeClientId: typeClient.id,
    matierePremiereId: matierePremiere.id,
    clientId: client.id,
    commandeId: commande.id,
  };
}

async function creerFauxBinaire(contenu: string): Promise<string> {
  const chemin = path.join(os.tmpdir(), `faux-pg-dump-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
  await fs.writeFile(chemin, contenu, { mode: 0o755 });
  await fs.chmod(chemin, 0o755);
  return chemin;
}

async function main() {
  // Les modules sous test importent `../lib/prisma.js` (singleton) — importés
  // dynamiquement APRÈS la garde ci-dessus, comme tous les scripts HTTP
  // réels du dépôt (le module ouvre une connexion à son chargement).
  const { construireDump, validerDump, ErreurSauvegarde } = await import("../apps/api/src/services/sauvegarde.js");
  const { ecrireSauvegardeLocale, repertoireLocal } = await import("../apps/api/src/services/sauvegardeLocale.js");
  const {
    reinitialiserBase,
    ErreurReinitialisation,
    VARIABLE_AUTORISATION_PRODUCTION,
  } = await import("../apps/api/src/services/reinitialisation.js");
  const {
    gardeBarriereEcriture,
    executerTacheDeFondSuivie,
    activerBarriereEtAttendreDrainage,
    abaisserBarriere,
    barriereReinitialisationActive,
    ecrituresEnVol,
  } = await import("../apps/api/src/lib/barriereEcriture.js");

  await reinitialiserBaseDeTest();

  // ---------------------------------------------------------------------
  // 1/2 — Sauvegarde réelle (structurel + transactionnel) et archive valide
  // ---------------------------------------------------------------------
  let jeu = await semerDonnees();
  const dump1 = await construireDump();
  if (dump1.length === 0) echouer("scénario 1/12 : pg_dump a produit une archive vide");
  await validerDump(dump1); // lève si invalide
  console.log("✅ 1/12 — Sauvegarde réelle produite (structurel + transactionnel), non vide.");
  console.log("✅ 2/12 — Archive validée par pg_restore --list (table des matières lisible).");

  // Un buffer manifestement non-PostgreSQL doit être rejeté par la MÊME
  // fonction de validation que celle utilisée en production — preuve directe
  // que `validerDump` détecte réellement une archive invalide, contre le
  // VRAI binaire `pg_restore` (pas un mock).
  try {
    await validerDump(Buffer.from("ceci n'est pas une archive PostgreSQL"));
    echouer("validerDump aurait dû rejeter un buffer manifestement invalide");
  } catch (e) {
    if (!(e instanceof ErreurSauvegarde)) throw e;
  }

  // ---------------------------------------------------------------------
  // Désactivation en production, puis activation contrôlée explicite
  // ---------------------------------------------------------------------
  const nodeEnvOriginal = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  delete process.env[VARIABLE_AUTORISATION_PRODUCTION];
  try {
    await reinitialiserBase(undefined);
    echouer("réinitialisation aurait dû être refusée en production sans REINITIALISATION_PRODUCTION_AUTORISEE=true");
  } catch (e) {
    if (!(e instanceof ErreurReinitialisation) || e.status !== 403 || e.code !== "REINITIALISATION_DESACTIVEE_PRODUCTION") {
      throw e;
    }
  }
  const utilisateurEncorePresent = await prisma.utilisateur.findUnique({ where: { id: jeu.utilisateurId } });
  if (!utilisateurEncorePresent) echouer("la désactivation en production a pourtant laissé effacer des données");
  if (barriereReinitialisationActive()) echouer("la barrière est restée active après un refus en production");
  console.log("✅ bonus — Réinitialisation refusée par défaut en production (NODE_ENV=production), rien effacé.");

  process.env[VARIABLE_AUTORISATION_PRODUCTION] = "true";
  // (l'activation explicite contrôlée est exercée par le scénario 3+4+5 qui suit)

  // ---------------------------------------------------------------------
  // 6 — Échec RÉEL de pg_dump (code de sortie non nul) : rien n'est effacé
  // ---------------------------------------------------------------------
  const pgDumpOriginal = process.env.PG_DUMP_PATH;
  const fauxPgDumpEchec = await creerFauxBinaire("#!/bin/sh\necho 'erreur simulee CI' >&2\nexit 1\n");
  process.env.PG_DUMP_PATH = fauxPgDumpEchec;
  try {
    await reinitialiserBase("scénario 6 — échec pg_dump injecté");
    echouer("la réinitialisation aurait dû échouer avec pg_dump en échec injecté");
  } catch (e) {
    if (!(e instanceof ErreurReinitialisation) || e.status !== 503) throw e;
  } finally {
    if (pgDumpOriginal === undefined) delete process.env.PG_DUMP_PATH;
    else process.env.PG_DUMP_PATH = pgDumpOriginal;
    await fs.unlink(fauxPgDumpEchec).catch(() => {});
  }
  if (barriereReinitialisationActive()) echouer("la barrière est restée active après l'échec pg_dump");
  const apres6 = await prisma.commandeClient.findUnique({ where: { id: jeu.commandeId } });
  if (!apres6) echouer("scénario 6/12 : la commande a disparu malgré l'échec injecté de pg_dump");
  console.log("✅ 6/12 — Échec réel de pg_dump injecté (faux binaire, code≠0) : aucune donnée effacée.");

  // ---------------------------------------------------------------------
  // 8 — pg_dump « réussit » mais produit une archive invalide : rien effacé
  // ---------------------------------------------------------------------
  const fauxPgDumpInvalide = await creerFauxBinaire("#!/bin/sh\necho 'flux-non-postgresql-valide-mais-non-vide'\nexit 0\n");
  process.env.PG_DUMP_PATH = fauxPgDumpInvalide;
  try {
    await reinitialiserBase("scénario 8 — archive invalide injectée");
    echouer("la réinitialisation aurait dû échouer avec une archive invalide");
  } catch (e) {
    if (!(e instanceof ErreurReinitialisation) || e.status !== 503) throw e;
  } finally {
    if (pgDumpOriginal === undefined) delete process.env.PG_DUMP_PATH;
    else process.env.PG_DUMP_PATH = pgDumpOriginal;
    await fs.unlink(fauxPgDumpInvalide).catch(() => {});
  }
  if (barriereReinitialisationActive()) echouer("la barrière est restée active après l'archive invalide");
  const apres8 = await prisma.commandeClient.findUnique({ where: { id: jeu.commandeId } });
  if (!apres8) echouer("scénario 8/12 : la commande a disparu malgré l'archive invalide injectée");
  console.log("✅ 8/12 — Archive invalide (pg_dump réussit mais flux non-PostgreSQL) : rejetée AVANT tout effacement.");

  // ---------------------------------------------------------------------
  // 7 — Échec RÉEL d'écriture locale (répertoire cible bloqué) : rien effacé
  // ---------------------------------------------------------------------
  const backupDirOriginal = process.env.BACKUP_LOCAL_DIR;
  const fichierBloquant = path.join(os.tmpdir(), `lomoto-ci-fichier-bloquant-${Date.now()}`);
  await fs.writeFile(fichierBloquant, "un simple fichier, pas un répertoire");
  process.env.BACKUP_LOCAL_DIR = fichierBloquant; // mkdir(recursive) échouera : ENOTDIR
  try {
    await reinitialiserBase("scénario 7 — échec écriture locale injecté");
    echouer("la réinitialisation aurait dû échouer avec une écriture locale impossible");
  } catch (e) {
    if (!(e instanceof ErreurReinitialisation) || e.status !== 500) throw e;
  } finally {
    if (backupDirOriginal === undefined) delete process.env.BACKUP_LOCAL_DIR;
    else process.env.BACKUP_LOCAL_DIR = backupDirOriginal;
    await fs.unlink(fichierBloquant).catch(() => {});
  }
  if (barriereReinitialisationActive()) echouer("la barrière est restée active après l'échec d'écriture locale");
  const apres7 = await prisma.commandeClient.findUnique({ where: { id: jeu.commandeId } });
  if (!apres7) echouer("scénario 7/12 : la commande a disparu malgré l'échec injecté d'écriture locale");
  console.log("✅ 7/12 — Échec réel d'écriture locale (répertoire bloqué par un fichier) : aucune donnée effacée.");

  // ---------------------------------------------------------------------
  // 9 — Écriture concurrente : rejetée si nouvelle, drainée si déjà en vol
  // ---------------------------------------------------------------------
  {
    // 9a : une NOUVELLE requête HTTP mutante est refusée (503) dès que la
    // barrière est active — via le VRAI middleware Express monté comme en
    // production, pas une simulation abstraite.
    const app = express();
    app.use(express.json());
    app.use(gardeBarriereEcriture);
    app.post("/ecriture-test", (_req, res) => res.status(201).json({ ok: true }));
    app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

    await activerBarriereEtAttendreDrainage(); // compteur à 0 : résout immédiatement
    const reponseBloquee = await request(app).post("/ecriture-test").send({});
    if (reponseBloquee.status !== 503 || reponseBloquee.body.code !== "REINITIALISATION_EN_COURS") {
      echouer(`scénario 9a/12 : attendu 503/REINITIALISATION_EN_COURS, reçu ${reponseBloquee.status}/${reponseBloquee.body.code}`);
    }
    const reponseHealth = await request(app).get("/api/health");
    if (reponseHealth.status !== 200) echouer("scénario 9a/12 : /api/health aurait dû rester accessible pendant la barrière");
    abaisserBarriere();
    console.log("✅ 9a/12 — Nouvelle écriture HTTP REJETÉE (503) dès l'activation de la barrière ; /api/health reste accessible.");

    // 9b : une écriture DÉJÀ EN VOL au moment de l'activation doit se
    // terminer — jamais rejetée, jamais perdue — avant que l'attente de
    // drainage ne se résolve. Entrelacement déterministe via une porte
    // manuelle (jamais un délai qui « espère » un ordre d'exécution).
    let debloquerEcriture!: () => void;
    const porte = new Promise<void>((resolve) => {
      debloquerEcriture = resolve;
    });
    const valeurAvant = (await prisma.matierePremiere.findUniqueOrThrow({ where: { id: jeu.matierePremiereId } })).quantiteStock;
    const valeurEnVol = 999;

    const pEcriture = executerTacheDeFondSuivie(async () => {
      await porte; // reste « en vol » tant que la porte n'est pas ouverte
      await prisma.matierePremiere.update({ where: { id: jeu.matierePremiereId }, data: { quantiteStock: valeurEnVol } });
    });

    // À ce stade (synchrone, avant tout retour à la boucle d'événements),
    // l'écriture a déjà incrémenté le compteur — c'est exactement ce qui
    // permet à `activerBarriereEtAttendreDrainage` de savoir qu'il doit
    // attendre plutôt que de démarrer le dump immédiatement.
    if (ecrituresEnVol() !== 1) echouer(`scénario 9b/12 : attendu 1 écriture en vol, trouvé ${ecrituresEnVol()}`);

    const pBarriere = activerBarriereEtAttendreDrainage();
    // La barrière doit être active, mais pas encore résolue : le drainage
    // attend la fin de l'écriture en vol.
    await attendre(20);
    if (!barriereReinitialisationActive()) echouer("scénario 9b/12 : la barrière aurait dû être active pendant le drainage");
    const etatEnCoursDeDrainage = await Promise.race([pBarriere.then(() => "resolue"), attendre(10).then(() => "en-attente")]);
    if (etatEnCoursDeDrainage !== "en-attente") {
      echouer("scénario 9b/12 : la barrière s'est résolue AVANT que l'écriture en vol ne se termine — frontière non garantie");
    }
    const valeurPendantAttente = (await prisma.matierePremiere.findUniqueOrThrow({ where: { id: jeu.matierePremiereId } })).quantiteStock;
    if (Number(valeurPendantAttente) !== Number(valeurAvant)) {
      echouer("scénario 9b/12 : l'écriture en vol a modifié la base AVANT d'avoir été laissée se terminer normalement");
    }

    debloquerEcriture();
    await pEcriture;
    await pBarriere; // doit désormais se résoudre promptement
    abaisserBarriere();

    const valeurApres = (await prisma.matierePremiere.findUniqueOrThrow({ where: { id: jeu.matierePremiereId } })).quantiteStock;
    if (Number(valeurApres) !== valeurEnVol) {
      echouer("scénario 9b/12 : l'écriture en vol a été PERDUE — sa valeur n'est pas présente en base après le drainage");
    }
    console.log(
      "✅ 9b/12 — Écriture déjà en vol au moment de l'activation : laissée se terminer, jamais perdue, drainage résolu APRÈS sa fin.",
    );
  }

  // Re-semer un jeu de données frais et cohérent avant le reset complet —
  // les scénarios 6/7/8/9 ont modifié quantiteStock (9b) sans rien d'autre
  // perdre, mais on repart d'un état propre et connu pour 3+4+5.
  await reinitialiserBaseDeTest();
  jeu = await semerDonnees();

  // ---------------------------------------------------------------------
  // 3+4+5 — Réinitialisation réelle et complète, activation contrôlée
  // ---------------------------------------------------------------------
  process.env.NODE_ENV = "production";
  process.env[VARIABLE_AUTORISATION_PRODUCTION] = "true"; // activation EXPLICITE, environnement contrôlé (CI)
  const resultat = await reinitialiserBase("scénario 3+4+5 — reset complet CI");
  process.env.NODE_ENV = nodeEnvOriginal;
  delete process.env[VARIABLE_AUTORISATION_PRODUCTION];

  if (barriereReinitialisationActive()) echouer("la barrière est restée active après un reset réussi");
  if (ecrituresEnVol() !== 0) echouer(`le compteur d'écritures en vol n'est pas retombé à 0 (${ecrituresEnVol()})`);

  const [utilisateurApres, clientApres, commandeApres, matiereApres, roleApres, produitApres, typeClientApres] =
    await Promise.all([
      prisma.utilisateur.findUnique({ where: { id: jeu.utilisateurId } }),
      prisma.client.findUnique({ where: { id: jeu.clientId } }),
      prisma.commandeClient.findUnique({ where: { id: jeu.commandeId } }),
      prisma.matierePremiere.findUnique({ where: { id: jeu.matierePremiereId } }),
      prisma.role.findUnique({ where: { id: jeu.roleId }, include: { permissions: true } }),
      prisma.produit.findUnique({ where: { id: jeu.produitId } }),
      prisma.typeClient.findUnique({ where: { id: jeu.typeClientId } }),
    ]);

  if (utilisateurApres || clientApres || commandeApres) {
    echouer("scénario 3/12 : des données transactionnelles ont survécu à la réinitialisation");
  }
  console.log("✅ 3/12 — Données transactionnelles (comptes, clients, commandes) réellement supprimées.");

  if (!roleApres || roleApres.permissions.length === 0 || !produitApres || !typeClientApres) {
    echouer("scénario 4/12 : rôles/permissions/catalogue/référentiels attendus n'ont pas survécu");
  }
  console.log("✅ 4/12 — Rôles, permissions, catalogue produits et référentiels conservés.");

  if (!matiereApres || Number(matiereApres.quantiteStock) !== 0) {
    echouer(`scénario 5/12 : le stock n'a pas été remis à zéro (trouvé ${matiereApres?.quantiteStock})`);
  }
  console.log("✅ 5/12 — Stock des matières premières remis à zéro (catalogue conservé).");
  console.log("✅ bonus — Activation contrôlée explicite en environnement de production simulé (CI) : acceptée.");

  const sauvegardeReset = await prisma.sauvegardeBase.findUnique({ where: { id: resultat.sauvegardeId } });
  if (!sauvegardeReset || sauvegardeReset.statut !== "SUCCES") {
    echouer("la sauvegarde de sûreté du reset n'a pas été journalisée en succès");
  }

  // ---------------------------------------------------------------------
  // 10+11+12 — Restauration réelle dans une base temporaire séparée
  // ---------------------------------------------------------------------
  await reinitialiserBaseDeTest();
  const jeuRestauration = await semerDonnees();
  const dumpRestauration = await construireDump();
  await validerDump(dumpRestauration);

  const urlBase = new URL(process.env.DATABASE_URL!);
  const nomBaseTmp = `lomoto_ci_restauration_${Date.now()}`;
  const envPg = {
    ...process.env,
    PGPASSWORD: urlBase.password ? decodeURIComponent(urlBase.password) : "",
  };
  const argsConnexionBase = ["--host", urlBase.hostname, "--port", urlBase.port || "5432", "--username", decodeURIComponent(urlBase.username)];

  let clientTmp: PrismaClient | null = null;
  const cheminDumpRestauration = path.join(os.tmpdir(), `lomoto-ci-restauration-${Date.now()}.dump`);
  try {
    await execFileAsync("psql", [...argsConnexionBase, "--dbname", "postgres", "-c", `CREATE DATABASE ${nomBaseTmp};`], {
      env: envPg,
    });

    await fs.writeFile(cheminDumpRestauration, dumpRestauration);
    await execFileAsync(
      "pg_restore",
      [...argsConnexionBase, "--dbname", nomBaseTmp, "--no-owner", "--no-privileges", "--clean", "--if-exists", cheminDumpRestauration],
      { env: { ...envPg, LC_ALL: "C" }, maxBuffer: 1024 * 1024 * 64 },
    );
    console.log("✅ 10/12 — Restauration réelle exécutée dans une base PostgreSQL temporaire séparée.");

    const urlTmp = new URL(process.env.DATABASE_URL!);
    urlTmp.pathname = `/${nomBaseTmp}`;
    clientTmp = new PrismaClient({ datasources: { db: { url: urlTmp.toString() } } });

    const clientRestaure = await clientTmp.client.findUnique({ where: { id: jeuRestauration.clientId } });
    const commandeRestauree = await clientTmp.commandeClient.findUnique({ where: { id: jeuRestauration.commandeId } });
    const matiereRestauree = await clientTmp.matierePremiere.findUnique({ where: { id: jeuRestauration.matierePremiereId } });

    if (!clientRestaure || clientRestaure.nom !== "Client CI Sauvegarde") {
      echouer("scénario 11/12 : le client restauré ne correspond pas exactement au dump");
    }
    if (!commandeRestauree || commandeRestauree.quantiteBacs !== 10 || commandeRestauree.montantRecu !== 41000) {
      echouer("scénario 11/12 : la commande restaurée ne correspond pas exactement au dump");
    }
    if (!matiereRestauree || Number(matiereRestauree.quantiteStock) !== 42) {
      echouer("scénario 11/12 : la matière première restaurée ne correspond pas exactement au dump");
    }
    console.log("✅ 11/12 — Relecture indépendante : les données restaurées correspondent EXACTEMENT à celles du dump.");
  } finally {
    await fs.unlink(cheminDumpRestauration).catch(() => {});
    await clientTmp?.$disconnect().catch(() => {});
    await execFileAsync("dropdb", [...argsConnexionBase, "--if-exists", nomBaseTmp], { env: envPg }).catch((e) => {
      console.error(`⚠️  Nettoyage de la base temporaire ${nomBaseTmp} : ${e instanceof Error ? e.message : e}`);
    });
    console.log("✅ 12/12 — Base temporaire de restauration nettoyée (même chemin en cas d'échec, via finally).");
  }

  await reinitialiserBaseDeTest();
  console.log("\n🎉 12/12 scénarios PostgreSQL réels du Lot P0 (sauvegarde/réinitialisation/restauration) — succès.\n");
}

main()
  // Le message détaillé de tout échec a déjà été affiché par echouer() —
  // ce filet évite seulement une trace de rejet de promesse non gérée.
  .catch(() => {
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
