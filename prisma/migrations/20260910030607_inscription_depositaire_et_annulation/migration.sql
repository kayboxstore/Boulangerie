-- AlterEnum
ALTER TYPE "StatutDemandePublique" ADD VALUE 'ANNULEE';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "adresse" TEXT;

-- AlterTable
ALTER TABLE "DemandeCommandePublique" ADD COLUMN     "motifAnnulation" TEXT;

-- CreateTable
CREATE TABLE "DemandeInscriptionDepositaire" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "adresse" TEXT NOT NULL,
    "statut" "StatutDemandePublique" NOT NULL DEFAULT 'EN_ATTENTE',
    "clientCreeId" TEXT,
    "traiteParId" TEXT,
    "traiteLe" TIMESTAMP(3),
    "motifRejet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandeInscriptionDepositaire_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DemandeInscriptionDepositaire_clientCreeId_key" ON "DemandeInscriptionDepositaire"("clientCreeId");

-- CreateIndex
CREATE INDEX "DemandeInscriptionDepositaire_statut_idx" ON "DemandeInscriptionDepositaire"("statut");

-- AddForeignKey
ALTER TABLE "DemandeInscriptionDepositaire" ADD CONSTRAINT "DemandeInscriptionDepositaire_clientCreeId_fkey" FOREIGN KEY ("clientCreeId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
