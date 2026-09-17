-- CreateEnum
CREATE TYPE "OrigineDepense" AS ENUM ('MANUELLE', 'FARINE');

-- CreateTable
CREATE TABLE "TauxDuJour" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "valeur" DECIMAL(12,3) NOT NULL,
    "definiParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TauxDuJour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DepenseCaisse" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "motif" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "origine" "OrigineDepense" NOT NULL DEFAULT 'MANUELLE',
    "tauxApplique" DECIMAL(12,3),
    "sacsUtilises" DECIMAL(12,3),
    "enregistreParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepenseCaisse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TauxDuJour_date_key" ON "TauxDuJour"("date");

-- CreateIndex
CREATE INDEX "DepenseCaisse_date_idx" ON "DepenseCaisse"("date");

-- AddForeignKey
ALTER TABLE "TauxDuJour" ADD CONSTRAINT "TauxDuJour_definiParId_fkey" FOREIGN KEY ("definiParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DepenseCaisse" ADD CONSTRAINT "DepenseCaisse_enregistreParId_fkey" FOREIGN KEY ("enregistreParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
