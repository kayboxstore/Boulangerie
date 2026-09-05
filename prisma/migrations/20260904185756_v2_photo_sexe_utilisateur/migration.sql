-- CreateEnum
CREATE TYPE "Sexe" AS ENUM ('HOMME', 'FEMME');

-- AlterTable
ALTER TABLE "Utilisateur" ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "sexe" "Sexe";
