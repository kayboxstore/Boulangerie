-- CreateEnum
CREATE TYPE "MoyenPaiement" AS ENUM ('ESPECES', 'MOBILE_MONEY', 'CARTE');

-- CreateEnum
CREATE TYPE "PrioriteNotification" AS ENUM ('NORMALE', 'HAUTE');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "priorite" "PrioriteNotification" NOT NULL DEFAULT 'NORMALE';

-- CreateTable
CREATE TABLE "Vente" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vendeurId" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "totalTaxe" INTEGER NOT NULL DEFAULT 0,
    "moyenPaiement" "MoyenPaiement" NOT NULL,
    "clotureId" TEXT,

    CONSTRAINT "Vente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneVente" (
    "id" TEXT NOT NULL,
    "venteId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,
    "prixUnitaire" INTEGER NOT NULL,
    "tauxTaxe" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "LigneVente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClotureCaisse" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "caissierId" TEXT NOT NULL,
    "nombreVentes" INTEGER NOT NULL,
    "totalVentes" INTEGER NOT NULL,
    "totalEspeces" INTEGER NOT NULL,
    "totalMobileMoney" INTEGER NOT NULL,
    "totalCarte" INTEGER NOT NULL,

    CONSTRAINT "ClotureCaisse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParametreBoutique" (
    "id" TEXT NOT NULL,
    "cle" TEXT NOT NULL,
    "valeur" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParametreBoutique_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vente_numero_key" ON "Vente"("numero");

-- CreateIndex
CREATE INDEX "Vente_date_idx" ON "Vente"("date");

-- CreateIndex
CREATE INDEX "Vente_clotureId_idx" ON "Vente"("clotureId");

-- CreateIndex
CREATE INDEX "ClotureCaisse_date_idx" ON "ClotureCaisse"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ParametreBoutique_cle_key" ON "ParametreBoutique"("cle");

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_vendeurId_fkey" FOREIGN KEY ("vendeurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_clotureId_fkey" FOREIGN KEY ("clotureId") REFERENCES "ClotureCaisse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_venteId_fkey" FOREIGN KEY ("venteId") REFERENCES "Vente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneVente" ADD CONSTRAINT "LigneVente_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClotureCaisse" ADD CONSTRAINT "ClotureCaisse_caissierId_fkey" FOREIGN KEY ("caissierId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
