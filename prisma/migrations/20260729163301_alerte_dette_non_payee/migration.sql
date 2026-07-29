-- AlterTable
ALTER TABLE "CommandeClient" ADD COLUMN     "alerteDetteEnvoyeeLe" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CommandeClient_alerteDetteEnvoyeeLe_idx" ON "CommandeClient"("alerteDetteEnvoyeeLe");
