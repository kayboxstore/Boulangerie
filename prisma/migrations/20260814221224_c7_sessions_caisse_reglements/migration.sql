-- CreateEnum
CREATE TYPE "StatutPaiement" AS ENUM ('DECLARE', 'CONFIRME');

-- AlterTable
ALTER TABLE "PaiementCommande" ADD COLUMN     "confirmeLe" TIMESTAMP(3),
ADD COLUMN     "confirmeParId" TEXT,
ADD COLUMN     "remiseCaisseId" TEXT,
ADD COLUMN     "statut" "StatutPaiement" NOT NULL DEFAULT 'DECLARE';

-- AlterTable
ALTER TABLE "SessionCaisse" ADD COLUMN     "derniereCorrectionLe" TIMESTAMP(3),
ADD COLUMN     "derniereCorrectionParId" TEXT,
ADD COLUMN     "motifCorrection" TEXT,
ADD COLUMN     "motifEcart" TEXT;

-- CreateIndex
CREATE INDEX "PaiementCommande_statut_idx" ON "PaiementCommande"("statut");

-- AddForeignKey
ALTER TABLE "PaiementCommande" ADD CONSTRAINT "PaiementCommande_remiseCaisseId_fkey" FOREIGN KEY ("remiseCaisseId") REFERENCES "RemiseCaisse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaiementCommande" ADD CONSTRAINT "PaiementCommande_confirmeParId_fkey" FOREIGN KEY ("confirmeParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionCaisse" ADD CONSTRAINT "SessionCaisse_derniereCorrectionParId_fkey" FOREIGN KEY ("derniereCorrectionParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Étend la contrainte de cohérence de clôture (migration C2) pour exiger un
-- motif dès que l'écart de clôture est non nul.
ALTER TABLE "SessionCaisse" DROP CONSTRAINT "SessionCaisse_fermeture_coherente";

ALTER TABLE "SessionCaisse"
  ADD CONSTRAINT "SessionCaisse_fermeture_coherente" CHECK (
    ("statut" = 'OUVERTE' AND "fermeeLe" IS NULL AND
      "soldeTheoriqueFermeture" IS NULL AND "soldeCompteFermeture" IS NULL AND "ecartFermeture" IS NULL)
    OR
    ("statut" = 'FERMEE' AND "fermeeLe" IS NOT NULL AND
      "soldeTheoriqueFermeture" IS NOT NULL AND "soldeCompteFermeture" IS NOT NULL AND "ecartFermeture" IS NOT NULL AND
      ("ecartFermeture" = 0 OR "motifEcart" IS NOT NULL))
  );
