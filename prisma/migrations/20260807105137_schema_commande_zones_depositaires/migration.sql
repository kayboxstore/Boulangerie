-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "zoneDepositaireId" TEXT;

-- CreateTable
CREATE TABLE "ZoneDepositaire" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZoneDepositaire_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchemaCommande" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clientId" TEXT NOT NULL,
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchemaCommande_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchemaCommandeLigne" (
    "id" TEXT NOT NULL,
    "schemaCommandeId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,

    CONSTRAINT "SchemaCommandeLigne_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZoneDepositaire_nom_key" ON "ZoneDepositaire"("nom");

-- CreateIndex
CREATE INDEX "SchemaCommande_date_idx" ON "SchemaCommande"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SchemaCommande_date_clientId_key" ON "SchemaCommande"("date", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "SchemaCommandeLigne_schemaCommandeId_produitId_key" ON "SchemaCommandeLigne"("schemaCommandeId", "produitId");

-- CreateIndex
CREATE INDEX "Client_zoneDepositaireId_idx" ON "Client"("zoneDepositaireId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_zoneDepositaireId_fkey" FOREIGN KEY ("zoneDepositaireId") REFERENCES "ZoneDepositaire"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchemaCommande" ADD CONSTRAINT "SchemaCommande_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchemaCommande" ADD CONSTRAINT "SchemaCommande_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchemaCommandeLigne" ADD CONSTRAINT "SchemaCommandeLigne_schemaCommandeId_fkey" FOREIGN KEY ("schemaCommandeId") REFERENCES "SchemaCommande"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchemaCommandeLigne" ADD CONSTRAINT "SchemaCommandeLigne_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
