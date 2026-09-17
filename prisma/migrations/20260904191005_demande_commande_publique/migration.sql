-- CreateEnum
CREATE TYPE "StatutDemandePublique" AS ENUM ('EN_ATTENTE', 'CONFIRMEE', 'REJETEE');

-- CreateTable
CREATE TABLE "DemandeCommandePublique" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "quantiteBacs" INTEGER NOT NULL,
    "dateSouhaitee" TIMESTAMP(3),
    "note" TEXT,
    "statut" "StatutDemandePublique" NOT NULL DEFAULT 'EN_ATTENTE',
    "commandeCreeeId" TEXT,
    "traiteParId" TEXT,
    "traiteLe" TIMESTAMP(3),
    "motifRejet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandeCommandePublique_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DemandeCommandePublique_commandeCreeeId_key" ON "DemandeCommandePublique"("commandeCreeeId");

-- CreateIndex
CREATE INDEX "DemandeCommandePublique_clientId_idx" ON "DemandeCommandePublique"("clientId");

-- CreateIndex
CREATE INDEX "DemandeCommandePublique_statut_idx" ON "DemandeCommandePublique"("statut");

-- AddForeignKey
ALTER TABLE "DemandeCommandePublique" ADD CONSTRAINT "DemandeCommandePublique_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandeCommandePublique" ADD CONSTRAINT "DemandeCommandePublique_commandeCreeeId_fkey" FOREIGN KEY ("commandeCreeeId") REFERENCES "CommandeClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
