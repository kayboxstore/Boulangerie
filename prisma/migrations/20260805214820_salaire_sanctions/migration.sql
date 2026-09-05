-- CreateEnum
CREATE TYPE "TypeSanction" AS ENUM ('PUNITION', 'RETENUE');

-- AlterTable
ALTER TABLE "Travailleur" ADD COLUMN     "joursTravaillesParMois" INTEGER,
ADD COLUMN     "salaireMensuel" INTEGER;

-- CreateTable
CREATE TABLE "Sanction" (
    "id" TEXT NOT NULL,
    "travailleurId" TEXT NOT NULL,
    "type" "TypeSanction" NOT NULL,
    "motif" TEXT NOT NULL,
    "montant" INTEGER,
    "date" DATE NOT NULL,
    "enregistreParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sanction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sanction_travailleurId_date_idx" ON "Sanction"("travailleurId", "date");

-- AddForeignKey
ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_travailleurId_fkey" FOREIGN KEY ("travailleurId") REFERENCES "Travailleur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sanction" ADD CONSTRAINT "Sanction_enregistreParId_fkey" FOREIGN KEY ("enregistreParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
