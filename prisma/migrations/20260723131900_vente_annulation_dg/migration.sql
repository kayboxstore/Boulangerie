-- CreateEnum
CREATE TYPE "StatutVente" AS ENUM ('ACTIVE', 'ANNULEE');

-- AlterTable
ALTER TABLE "Vente" ADD COLUMN     "annuleeParId" TEXT,
ADD COLUMN     "dateAnnulation" TIMESTAMP(3),
ADD COLUMN     "motifAnnulation" TEXT,
ADD COLUMN     "statut" "StatutVente" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "Vente_statut_idx" ON "Vente"("statut");

-- AddForeignKey
ALTER TABLE "Vente" ADD CONSTRAINT "Vente_annuleeParId_fkey" FOREIGN KEY ("annuleeParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
