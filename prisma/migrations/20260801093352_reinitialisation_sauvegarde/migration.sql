-- AlterEnum
ALTER TYPE "TypeSauvegarde" ADD VALUE 'REINITIALISATION';

-- AlterTable
ALTER TABLE "SauvegardeBase" ADD COLUMN     "raisonReinitialisation" TEXT;

