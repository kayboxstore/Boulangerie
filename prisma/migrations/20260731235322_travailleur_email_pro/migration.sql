-- CreateEnum
CREATE TYPE "StatutEmailPro" AS ENUM ('AUCUNE', 'EN_ATTENTE_VERIFICATION', 'ACTIF', 'ECHEC');

-- AlterTable
ALTER TABLE "Travailleur" ADD COLUMN     "cloudflareAdresseId" TEXT,
ADD COLUMN     "cloudflareRegleId" TEXT,
ADD COLUMN     "emailDestination" TEXT,
ADD COLUMN     "emailProAdresse" TEXT,
ADD COLUMN     "emailProErreur" TEXT,
ADD COLUMN     "emailProStatut" "StatutEmailPro" NOT NULL DEFAULT 'AUCUNE';

-- CreateIndex
CREATE UNIQUE INDEX "Travailleur_emailProAdresse_key" ON "Travailleur"("emailProAdresse");

