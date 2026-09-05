-- AlterTable
ALTER TABLE "Travailleur" ADD COLUMN     "departementId" TEXT,
ADD COLUMN     "groupeId" TEXT;

-- CreateTable
CREATE TABLE "Departement" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "chefTravailleurId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Departement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Groupe" (
    "id" TEXT NOT NULL,
    "departementId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Groupe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Departement_nom_key" ON "Departement"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "Groupe_departementId_nom_key" ON "Groupe"("departementId", "nom");

-- AddForeignKey
ALTER TABLE "Travailleur" ADD CONSTRAINT "Travailleur_departementId_fkey" FOREIGN KEY ("departementId") REFERENCES "Departement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Travailleur" ADD CONSTRAINT "Travailleur_groupeId_fkey" FOREIGN KEY ("groupeId") REFERENCES "Groupe"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Departement" ADD CONSTRAINT "Departement_chefTravailleurId_fkey" FOREIGN KEY ("chefTravailleurId") REFERENCES "Travailleur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Groupe" ADD CONSTRAINT "Groupe_departementId_fkey" FOREIGN KEY ("departementId") REFERENCES "Departement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
