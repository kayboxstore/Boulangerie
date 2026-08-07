-- CreateTable
CREATE TABLE "BonLivraison" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clientId" TEXT NOT NULL,
    "bacsVides" INTEGER NOT NULL DEFAULT 0,
    "livrePar" TEXT,
    "observations" TEXT,
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BonLivraison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonLivraisonLigne" (
    "id" TEXT NOT NULL,
    "bonLivraisonId" TEXT NOT NULL,
    "produitId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,

    CONSTRAINT "BonLivraisonLigne_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BonLivraison_date_idx" ON "BonLivraison"("date");

-- CreateIndex
CREATE UNIQUE INDEX "BonLivraison_date_clientId_key" ON "BonLivraison"("date", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "BonLivraisonLigne_bonLivraisonId_produitId_key" ON "BonLivraisonLigne"("bonLivraisonId", "produitId");

-- AddForeignKey
ALTER TABLE "BonLivraison" ADD CONSTRAINT "BonLivraison_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonLivraison" ADD CONSTRAINT "BonLivraison_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonLivraisonLigne" ADD CONSTRAINT "BonLivraisonLigne_bonLivraisonId_fkey" FOREIGN KEY ("bonLivraisonId") REFERENCES "BonLivraison"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BonLivraisonLigne" ADD CONSTRAINT "BonLivraisonLigne_produitId_fkey" FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
