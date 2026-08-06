-- CreateTable
CREATE TABLE "BulletinPaie" (
    "id" TEXT NOT NULL,
    "travailleurId" TEXT NOT NULL,
    "mois" TEXT NOT NULL,
    "salaireMensuel" INTEGER NOT NULL,
    "joursTravaillesParMois" INTEGER NOT NULL,
    "tauxJournalier" DOUBLE PRECISION NOT NULL,
    "absencesNonJustifiees" JSONB NOT NULL,
    "retenueAbsences" DOUBLE PRECISION NOT NULL,
    "sanctionsRetenues" JSONB NOT NULL,
    "totalRetenuesDisciplinaires" INTEGER NOT NULL,
    "salaireNet" INTEGER NOT NULL,
    "genereParId" TEXT,
    "dateGeneration" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BulletinPaie_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BulletinPaie_travailleurId_mois_idx" ON "BulletinPaie"("travailleurId", "mois");

-- AddForeignKey
ALTER TABLE "BulletinPaie" ADD CONSTRAINT "BulletinPaie_travailleurId_fkey" FOREIGN KEY ("travailleurId") REFERENCES "Travailleur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BulletinPaie" ADD CONSTRAINT "BulletinPaie_genereParId_fkey" FOREIGN KEY ("genereParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
