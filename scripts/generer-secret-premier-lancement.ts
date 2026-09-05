/**
 * Génère un secret de bootstrap pour l'Assistant de premier lancement
 * (P1-A, 28/08/2026) — À EXÉCUTER MANUELLEMENT par un administrateur ayant
 * déjà accès à l'infrastructure (ex. console Render), jamais automatiquement,
 * jamais par cette session Claude contre la production.
 *
 * Sans ce secret, `routes/premierLancement.ts` refuse toute requête (401) —
 * même si la base est vide. C'est l'« ouverture explicite » : générer un
 * secret est l'action volontaire qui autorise, pour une fenêtre de temps
 * bornée, la création du premier compte Administrateur Principal.
 *
 * Le secret est affiché EN CLAIR une seule fois, ici, sur cette sortie
 * standard — jamais journalisé ni stocké ailleurs. Seule son empreinte
 * SHA-256 est conservée en base (voir services/premierLancement.ts).
 *
 * Usage :
 *   npx tsx scripts/generer-secret-premier-lancement.ts [duréeMinutes]
 *   (durée par défaut : 60 minutes)
 */
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { genererSecretPremierLancement } from "../apps/api/src/services/premierLancement.js";

const DUREE_MINUTES_DEFAUT = 60;

async function main(db: PrismaClient) {
  const argDuree = process.argv[2];
  const dureeMinutes = argDuree ? Number(argDuree) : DUREE_MINUTES_DEFAUT;
  if (!Number.isFinite(dureeMinutes) || dureeMinutes <= 0) {
    throw new Error(`Durée invalide : "${argDuree}" — attendu un nombre de minutes strictement positif`);
  }

  const { secretClair, expiresAt } = await genererSecretPremierLancement(db, dureeMinutes * 60 * 1000);

  console.log("\n=== Secret de premier lancement généré ===\n");
  console.log(`Secret (à usage unique, ne sera plus jamais affiché) :\n\n  ${secretClair}\n`);
  console.log(`Expire le : ${expiresAt.toISOString()} (dans ${dureeMinutes} minute(s))`);
  console.log(
    "\nCollez ce secret dans le champ dédié de l'Assistant de premier lancement. " +
      "Il est consommé automatiquement dès la création réussie du compte Administrateur Principal " +
      "— relancez ce script pour en générer un nouveau si besoin.\n",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prisma = new PrismaClient();
  main(prisma)
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
