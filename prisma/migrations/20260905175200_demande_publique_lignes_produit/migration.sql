/*
  Warnings:

  - You are about to drop the column `commandeCreeeId` on the `DemandeCommandePublique` table. All the data in the column will be lost.
  - You are about to drop the column `quantiteBacs` on the `DemandeCommandePublique` table. All the data in the column will be lost.
  - Made the column `dateSouhaitee` on table `DemandeCommandePublique` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "DemandeCommandePublique" DROP CONSTRAINT "DemandeCommandePublique_commandeCreeeId_fkey";

-- DropIndex
DROP INDEX "DemandeCommandePublique_commandeCreeeId_key";

-- AlterTable
ALTER TABLE "DemandeCommandePublique" DROP COLUMN "commandeCreeeId",
DROP COLUMN "quantiteBacs",
ALTER COLUMN "dateSouhaitee" SET NOT NULL,
ALTER COLUMN "dateSouhaitee" SET DATA TYPE DATE;

-- CreateTable
CREATE TABLE "DemandeCommandePubliqueLigne" (
    "id" TEXT NOT NULL,
    "demandeId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,

    CONSTRAINT "DemandeCommandePubliqueLigne_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DemandeCommandePubliqueLigne_demandeId_produitId_key" ON "DemandeCommandePubliqueLigne"("demandeId", "produitId");

-- AddForeignKey
ALTER TABLE "DemandeCommandePubliqueLigne" ADD CONSTRAINT "DemandeCommandePubliqueLigne_demandeId_fkey" FOREIGN KEY ("demandeId") REFERENCES "DemandeCommandePublique"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandeCommandePubliqueLigne" ADD CONSTRAINT "DemandeCommandePubliqueLigne_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
