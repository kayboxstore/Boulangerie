-- Refonte du module Production (section 3.3) — les recettes sortent du périmètre.
--
-- PRÉSERVATION DES DONNÉES :
--  * Recette / IngredientRecette : tables CONSERVÉES telles quelles (orphelines,
--    plus référencées par aucune route ni UI). Aucune suppression.
--  * MouvementStock : journal append-only — les lignes sont CONSERVÉES. On se
--    contente de délier `productionId` des anciennes productions ; la référence
--    lisible (« Production n°12 ») reste dans la colonne `reference`.
--  * PlanningProduction / Production : l'ancienne structure (recette × quantité)
--    n'est pas représentable dans le nouveau modèle (bacs + ingrédients saisis).
--    Les anciennes lignes sont donc supprimées AVANT restructuration.

-- 1. Délier le journal de stock des anciennes productions (lignes conservées).
UPDATE "MouvementStock" SET "productionId" = NULL WHERE "productionId" IS NOT NULL;

-- 2. Supprimer les anciennes lignes, non convertibles vers le nouveau modèle.
DELETE FROM "Production";
DELETE FROM "PlanningProduction";

-- CreateEnum
CREATE TYPE "CodeIngredient" AS ENUM ('FARINE', 'LEVURE', 'SEL', 'HUILE');

-- DropForeignKey
ALTER TABLE "PlanningProduction" DROP CONSTRAINT "PlanningProduction_recetteId_fkey";

-- DropForeignKey
ALTER TABLE "Production" DROP CONSTRAINT "Production_planningId_fkey";

-- DropForeignKey
ALTER TABLE "Production" DROP CONSTRAINT "Production_recetteId_fkey";

-- AlterTable
ALTER TABLE "MatierePremiere" ADD COLUMN     "code" "CodeIngredient";

-- AlterTable
ALTER TABLE "PlanningProduction" DROP COLUMN "quantitePrevue",
DROP COLUMN "recetteId",
DROP COLUMN "statut",
ADD COLUMN     "kgSelPrevus" DECIMAL(12,3) NOT NULL DEFAULT 0,
ADD COLUMN     "nombreBacsCommandes" INTEGER NOT NULL,
ADD COLUMN     "observations" TEXT,
ADD COLUMN     "paquetsLevurePrevus" DECIMAL(12,3) NOT NULL DEFAULT 0,
ADD COLUMN     "quantiteHuilePrevue" DECIMAL(12,3) NOT NULL DEFAULT 0,
ADD COLUMN     "sacsFarinePrevus" DECIMAL(12,3) NOT NULL DEFAULT 0,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Production" DROP COLUMN "planningId",
DROP COLUMN "quantiteProduite",
DROP COLUMN "recetteId",
ADD COLUMN     "bacsFoutus" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bacsLivresDepositaires" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bacsLivresMamans" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bacsProduits" INTEGER NOT NULL,
ADD COLUMN     "bacsRestants" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bacsVendusVC" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kgFarineAbimes" DECIMAL(12,3),
ADD COLUMN     "kgSelUtilises" DECIMAL(12,3) NOT NULL DEFAULT 0,
ADD COLUMN     "observations" TEXT,
ADD COLUMN     "paquetsLevureUtilises" DECIMAL(12,3) NOT NULL DEFAULT 0,
ADD COLUMN     "quantiteHuileUtilisee" DECIMAL(12,3) NOT NULL DEFAULT 0,
ADD COLUMN     "sacsUtilises" DECIMAL(12,3) NOT NULL DEFAULT 0;

-- DropEnum
DROP TYPE "StatutPlanning";

-- CreateTable
CREATE TABLE "PlanningLigneProduit" (
    "id" TEXT NOT NULL,
    "planningId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "quantitePrevue" INTEGER NOT NULL,

    CONSTRAINT "PlanningLigneProduit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotifDon" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MotifDon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionDon" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "motifDonId" TEXT NOT NULL,
    "nombreBacs" INTEGER NOT NULL,

    CONSTRAINT "ProductionDon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanningLigneProduit_planningId_produitId_key" ON "PlanningLigneProduit"("planningId", "produitId");

-- CreateIndex
CREATE UNIQUE INDEX "MotifDon_nom_key" ON "MotifDon"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionDon_productionId_motifDonId_key" ON "ProductionDon"("productionId", "motifDonId");

-- CreateIndex
CREATE UNIQUE INDEX "MatierePremiere_code_key" ON "MatierePremiere"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PlanningProduction_datePrevue_key" ON "PlanningProduction"("datePrevue");

-- AddForeignKey
ALTER TABLE "PlanningLigneProduit" ADD CONSTRAINT "PlanningLigneProduit_planningId_fkey" FOREIGN KEY ("planningId") REFERENCES "PlanningProduction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningLigneProduit" ADD CONSTRAINT "PlanningLigneProduit_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionDon" ADD CONSTRAINT "ProductionDon_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionDon" ADD CONSTRAINT "ProductionDon_motifDonId_fkey" FOREIGN KEY ("motifDonId") REFERENCES "MotifDon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

