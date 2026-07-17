-- AlterEnum
ALTER TYPE "Module" ADD VALUE 'TRAVAILLEURS';

-- AlterTable
ALTER TABLE "Utilisateur" ADD COLUMN     "estAdminPrincipal" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PaiementCommande" (
    "id" TEXT NOT NULL,
    "commandeClientId" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enregistreParId" TEXT NOT NULL,

    CONSTRAINT "PaiementCommande_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaiementCommande_commandeClientId_idx" ON "PaiementCommande"("commandeClientId");

-- AddForeignKey
ALTER TABLE "PaiementCommande" ADD CONSTRAINT "PaiementCommande_commandeClientId_fkey" FOREIGN KEY ("commandeClientId") REFERENCES "CommandeClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaiementCommande" ADD CONSTRAINT "PaiementCommande_enregistreParId_fkey" FOREIGN KEY ("enregistreParId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un seul compte Administrateur principal à la fois (index unique partiel).
CREATE UNIQUE INDEX "Utilisateur_admin_principal_unique" ON "Utilisateur" ("estAdminPrincipal") WHERE "estAdminPrincipal" = true;
