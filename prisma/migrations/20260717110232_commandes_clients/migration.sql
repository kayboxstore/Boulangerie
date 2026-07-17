-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "typeClientId" TEXT NOT NULL,
    "avanceDisponible" INTEGER NOT NULL DEFAULT 0,
    "pointsFidelite" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandeClient" (
    "id" TEXT NOT NULL,
    "numero" SERIAL NOT NULL,
    "clientId" TEXT NOT NULL,
    "quantiteBacs" INTEGER NOT NULL,
    "montantBrut" INTEGER NOT NULL,
    "avanceUtilisee" INTEGER NOT NULL,
    "montantAPercevoir" INTEGER NOT NULL,
    "montantRecu" INTEGER NOT NULL,
    "dette" INTEGER NOT NULL,
    "avanceGeneree" INTEGER NOT NULL,
    "nouvelleAvance" INTEGER NOT NULL,
    "creeParId" TEXT NOT NULL,
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommandeClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommandeClient_numero_key" ON "CommandeClient"("numero");

-- CreateIndex
CREATE INDEX "CommandeClient_clientId_idx" ON "CommandeClient"("clientId");

-- CreateIndex
CREATE INDEX "CommandeClient_dateCreation_idx" ON "CommandeClient"("dateCreation");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_typeClientId_fkey" FOREIGN KEY ("typeClientId") REFERENCES "TypeClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandeClient" ADD CONSTRAINT "CommandeClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommandeClient" ADD CONSTRAINT "CommandeClient_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
