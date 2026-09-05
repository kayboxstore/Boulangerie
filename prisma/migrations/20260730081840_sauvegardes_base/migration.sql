-- CreateEnum
CREATE TYPE "TypeSauvegarde" AS ENUM ('AUTOMATIQUE', 'MANUELLE');

-- CreateEnum
CREATE TYPE "StatutSauvegarde" AS ENUM ('SUCCES', 'ECHEC');

-- CreateTable
CREATE TABLE "SauvegardeBase" (
    "id" TEXT NOT NULL,
    "type" "TypeSauvegarde" NOT NULL,
    "statut" "StatutSauvegarde" NOT NULL,
    "tailleOctets" INTEGER,
    "nomFichier" TEXT,
    "destination" TEXT,
    "idDistant" TEXT,
    "erreur" TEXT,
    "dureeMs" INTEGER,
    "declencheParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SauvegardeBase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SauvegardeBase_createdAt_idx" ON "SauvegardeBase"("createdAt");

-- CreateIndex
CREATE INDEX "SauvegardeBase_type_createdAt_idx" ON "SauvegardeBase"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "SauvegardeBase" ADD CONSTRAINT "SauvegardeBase_declencheParId_fkey" FOREIGN KEY ("declencheParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
