-- CreateEnum
CREATE TYPE "TypeMouvementStock" AS ENUM ('ENTREE', 'SORTIE');

-- CreateEnum
CREATE TYPE "StatutPlanning" AS ENUM ('PREVU', 'FAIT');

-- CreateTable
CREATE TABLE "MatierePremiere" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "unite" TEXT NOT NULL,
    "quantiteStock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "seuilAlerte" DECIMAL(12,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatierePremiere_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MouvementStock" (
    "id" TEXT NOT NULL,
    "matierePremiereId" TEXT NOT NULL,
    "type" "TypeMouvementStock" NOT NULL,
    "quantite" DECIMAL(12,3) NOT NULL,
    "reference" TEXT,
    "productionId" TEXT,
    "auteurId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MouvementStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recette" (
    "id" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "instructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recette_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngredientRecette" (
    "id" TEXT NOT NULL,
    "recetteId" TEXT NOT NULL,
    "matierePremiereId" TEXT NOT NULL,
    "quantite" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "IngredientRecette_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanningProduction" (
    "id" TEXT NOT NULL,
    "datePrevue" DATE NOT NULL,
    "recetteId" TEXT NOT NULL,
    "quantitePrevue" INTEGER NOT NULL,
    "statut" "StatutPlanning" NOT NULL DEFAULT 'PREVU',
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanningProduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Production" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "recetteId" TEXT NOT NULL,
    "quantiteProduite" INTEGER NOT NULL,
    "planningId" TEXT,
    "enregistreParId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Production_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatierePremiere_nom_key" ON "MatierePremiere"("nom");

-- CreateIndex
CREATE INDEX "MouvementStock_matierePremiereId_date_idx" ON "MouvementStock"("matierePremiereId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Recette_produitId_key" ON "Recette"("produitId");

-- CreateIndex
CREATE UNIQUE INDEX "IngredientRecette_recetteId_matierePremiereId_key" ON "IngredientRecette"("recetteId", "matierePremiereId");

-- CreateIndex
CREATE INDEX "PlanningProduction_datePrevue_idx" ON "PlanningProduction"("datePrevue");

-- CreateIndex
CREATE UNIQUE INDEX "Production_numero_key" ON "Production"("numero");

-- CreateIndex
CREATE INDEX "Production_date_idx" ON "Production"("date");

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_matierePremiereId_fkey" FOREIGN KEY ("matierePremiereId") REFERENCES "MatierePremiere"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MouvementStock" ADD CONSTRAINT "MouvementStock_auteurId_fkey" FOREIGN KEY ("auteurId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recette" ADD CONSTRAINT "Recette_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientRecette" ADD CONSTRAINT "IngredientRecette_recetteId_fkey" FOREIGN KEY ("recetteId") REFERENCES "Recette"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngredientRecette" ADD CONSTRAINT "IngredientRecette_matierePremiereId_fkey" FOREIGN KEY ("matierePremiereId") REFERENCES "MatierePremiere"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningProduction" ADD CONSTRAINT "PlanningProduction_recetteId_fkey" FOREIGN KEY ("recetteId") REFERENCES "Recette"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanningProduction" ADD CONSTRAINT "PlanningProduction_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_recetteId_fkey" FOREIGN KEY ("recetteId") REFERENCES "Recette"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_planningId_fkey" FOREIGN KEY ("planningId") REFERENCES "PlanningProduction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_enregistreParId_fkey" FOREIGN KEY ("enregistreParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
