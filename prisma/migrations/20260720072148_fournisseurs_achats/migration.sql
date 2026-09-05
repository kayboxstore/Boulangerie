-- CreateEnum
CREATE TYPE "StatutCommandeFournisseur" AS ENUM ('EN_ATTENTE', 'RECUE');

-- AlterTable
ALTER TABLE "MouvementStock" ADD COLUMN     "commandeFournisseurId" TEXT;

-- CreateTable
CREATE TABLE "Fournisseur" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "contact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandeFournisseur" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "fournisseurId" TEXT NOT NULL,
    "statut" "StatutCommandeFournisseur" NOT NULL DEFAULT 'EN_ATTENTE',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateReception" TIMESTAMP(3),
    "creeParId" TEXT,
    "recueParId" TEXT,

    CONSTRAINT "CommandeFournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LigneCommandeFournisseur" (
    "id" TEXT NOT NULL,
    "commandeFournisseurId" TEXT NOT NULL,
    "matierePremiereId" TEXT NOT NULL,
    "quantite" DECIMAL(12,3) NOT NULL,
    "prixUnitaire" INTEGER NOT NULL,

    CONSTRAINT "LigneCommandeFournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Fournisseur_nom_key" ON "Fournisseur"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "CommandeFournisseur_numero_key" ON "CommandeFournisseur"("numero");

-- CreateIndex
CREATE INDEX "CommandeFournisseur_statut_idx" ON "CommandeFournisseur"("statut");

-- CreateIndex
CREATE INDEX "CommandeFournisseur_date_idx" ON "CommandeFournisseur"("date");

-- CreateIndex
CREATE UNIQUE INDEX "LigneCommandeFournisseur_commandeFournisseurId_matierePremi_key" ON "LigneCommandeFournisseur"("commandeFournisseurId", "matierePremiereId");

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_commandeFournisseurId_fkey" FOREIGN KEY ("commandeFournisseurId") REFERENCES "CommandeFournisseur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandeFournisseur" ADD CONSTRAINT "CommandeFournisseur_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "Fournisseur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandeFournisseur" ADD CONSTRAINT "CommandeFournisseur_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandeFournisseur" ADD CONSTRAINT "CommandeFournisseur_recueParId_fkey" FOREIGN KEY ("recueParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneCommandeFournisseur" ADD CONSTRAINT "LigneCommandeFournisseur_commandeFournisseurId_fkey" FOREIGN KEY ("commandeFournisseurId") REFERENCES "CommandeFournisseur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LigneCommandeFournisseur" ADD CONSTRAINT "LigneCommandeFournisseur_matierePremiereId_fkey" FOREIGN KEY ("matierePremiereId") REFERENCES "MatierePremiere"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
