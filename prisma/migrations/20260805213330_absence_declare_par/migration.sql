-- AlterTable
ALTER TABLE "Absence" ADD COLUMN     "declareParId" TEXT;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_declareParId_fkey" FOREIGN KEY ("declareParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
