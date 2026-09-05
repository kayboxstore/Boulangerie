-- CreateEnum
CREATE TYPE "StatutProduction" AS ENUM ('OUVERTE', 'CLOTUREE');

-- CreateEnum
CREATE TYPE "VerdictQualite" AS ENUM ('CONFORME', 'NON_CONFORME');

-- AlterTable
ALTER TABLE "Production" ADD COLUMN     "clotureeLe" TIMESTAMP(3),
ADD COLUMN     "clotureeParId" TEXT,
ADD COLUMN     "statut" "StatutProduction" NOT NULL DEFAULT 'OUVERTE';

-- CreateTable
CREATE TABLE "MotifPerte" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MotifPerte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionPerte" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "motifPerteId" TEXT NOT NULL,
    "nombreBacs" INTEGER NOT NULL,

    CONSTRAINT "ProductionPerte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MotifNonConformite" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MotifNonConformite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControleQualite" (
    "id" TEXT NOT NULL,
    "productionId" TEXT NOT NULL,
    "verdict" "VerdictQualite" NOT NULL,
    "motifId" TEXT,
    "observations" TEXT,
    "controleParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControleQualite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MotifPerte_nom_key" ON "MotifPerte"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionPerte_productionId_motifPerteId_key" ON "ProductionPerte"("productionId", "motifPerteId");

-- CreateIndex
CREATE UNIQUE INDEX "MotifNonConformite_nom_key" ON "MotifNonConformite"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "ControleQualite_productionId_key" ON "ControleQualite"("productionId");

-- CreateIndex
CREATE INDEX "Production_statut_idx" ON "Production"("statut");

-- AddForeignKey
ALTER TABLE "ProductionPerte" ADD CONSTRAINT "ProductionPerte_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPerte" ADD CONSTRAINT "ProductionPerte_motifPerteId_fkey" FOREIGN KEY ("motifPerteId") REFERENCES "MotifPerte"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControleQualite" ADD CONSTRAINT "ControleQualite_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControleQualite" ADD CONSTRAINT "ControleQualite_motifId_fkey" FOREIGN KEY ("motifId") REFERENCES "MotifNonConformite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControleQualite" ADD CONSTRAINT "ControleQualite_controleParId_fkey" FOREIGN KEY ("controleParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_clotureeParId_fkey" FOREIGN KEY ("clotureeParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
