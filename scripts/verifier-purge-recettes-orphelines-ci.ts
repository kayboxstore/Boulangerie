/**
 * Vérification d'intégration CI du correctif « suppression de matière
 * bloquée par une recette orpheline » (27/08/2026), contre une VRAIE base
 * PostgreSQL éphémère — le service `postgres` de `.github/workflows/ci.yml`.
 *
 * Constat en production (Augustin, 27/08/2026) : après une réinitialisation
 * complète de la base, impossible de supprimer les matières premières
 * Farine/Levure. Cause confirmée : `IngredientRecette.matierePremiereId`
 * référence `MatierePremiere` sans `onDelete: Cascade` — des lignes
 * résiduelles de `Recette`/`IngredientRecette` (tables mortes depuis la
 * refonte 3.3 de la Production, plus aucune route/service ne les lit ni ne
 * les écrit) bloquaient silencieusement la suppression avec une erreur
 * PostgreSQL P2003 non traduite par `routes/stocks.ts` (500 générique).
 *
 * Ce script prouve, contre une vraie contrainte de clé étrangère
 * PostgreSQL (pas un client Prisma simulé) :
 *  1. la contrainte bloque réellement la suppression d'une matière encore
 *     référencée par une `IngredientRecette`, même sans aucun mouvement de
 *     stock (le seul contrôle applicatif existant) ;
 *  2. purger `Recette` (mécanisme de la migration
 *     `20260827120333_purger_recettes_orphelines`, et de l'ajout à
 *     `reinitialiserBase()`) supprime bien, via `ON DELETE CASCADE`, les
 *     `IngredientRecette` associées ;
 *  3. la matière redevient alors réellement supprimable.
 * Le mocked test `routes/stocks.matieres.test.ts` prouve séparément que la
 * route HTTP traduit ce P2003 en 409 explicite plutôt qu'un 500 générique.
 *
 * SÉCURITÉ : mêmes garanties que les scripts d'intégration voisins — hôte
 * local, nom de base EXACT `lomoto_ci`, confirmation explicite. Voir
 * `scripts/garde-integration-ci.ts`.
 *
 * Usage (CI uniquement — voir .github/workflows/ci.yml) :
 *   CI_INTEGRATION_BOOTSTRAP_CONFIRME=true npx tsx scripts/verifier-purge-recettes-orphelines-ci.ts
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { verifierEnvironnementIntegrationCI } from "./garde-integration-ci.js";

verifierEnvironnementIntegrationCI(process.env, "scripts/verifier-purge-recettes-orphelines-ci.ts");

const prisma = new PrismaClient();

function echouer(message: string): never {
  console.error(`\n❌ ÉCHEC vérification CI (purge recettes orphelines) : ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function main() {
  const matiere = await prisma.matierePremiere.create({
    data: { nom: "Farine — vérification CI", code: "FARINE", unite: "kg", quantiteStock: 0, seuilAlerte: 10 },
  });
  const produit = await prisma.produit.create({
    data: { nom: "Pain — vérification CI", prixVente: 500, categorie: "PAIN" },
  });
  const recette = await prisma.recette.create({ data: { produitId: produit.id } });
  await prisma.ingredientRecette.create({
    data: { recetteId: recette.id, matierePremiereId: matiere.id, quantite: 1 },
  });

  // 1. Aucun mouvement de stock (le seul contrôle du routeur) ; la
  //    contrainte PostgreSQL doit quand même bloquer la suppression.
  const mouvements = await prisma.mouvementStock.count({ where: { matierePremiereId: matiere.id } });
  if (mouvements !== 0) echouer("scénario invalide : la matière a déjà des mouvements de stock");

  let bloqueeParP2003 = false;
  try {
    await prisma.matierePremiere.delete({ where: { id: matiere.id } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      bloqueeParP2003 = true;
    } else {
      throw e;
    }
  }
  if (!bloqueeParP2003) {
    echouer(
      "la suppression a réussi (ou a échoué autrement qu'avec P2003) alors qu'une IngredientRecette référence " +
        "encore la matière — le scénario reproduit en production n'est plus reproductible : vérifier que ce test " +
        "est toujours pertinent avant de le supprimer",
    );
  }
  console.log("✓ reproduit : une matière encore référencée par IngredientRecette résiste bien à la suppression (P2003 réel)");

  // 2. Purger Recette (même geste que la migration et que reinitialiserBase()
  //    désormais) doit faire disparaître l'IngredientRecette via CASCADE.
  await prisma.recette.deleteMany();
  const ingredientsRestants = await prisma.ingredientRecette.count({ where: { matierePremiereId: matiere.id } });
  if (ingredientsRestants !== 0) {
    echouer("IngredientRecette a survécu à la suppression de sa Recette parente — ON DELETE CASCADE ne fonctionne pas comme attendu");
  }
  console.log("✓ supprimer Recette entraîne bien la suppression en cascade de IngredientRecette");

  // 3. La matière redevient réellement supprimable.
  await prisma.matierePremiere.delete({ where: { id: matiere.id } });
  const matiereEncorePresente = await prisma.matierePremiere.findUnique({ where: { id: matiere.id } });
  if (matiereEncorePresente !== null) echouer("la matière existe toujours après la suppression");
  console.log("✓ la matière autrefois bloquée est maintenant réellement supprimable contre PostgreSQL");

  await prisma.produit.delete({ where: { id: produit.id } });

  console.log(
    "\n✅ Vérification CI « purge recettes orphelines » : le correctif débloque réellement la suppression contre une vraie base PostgreSQL.\n",
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
