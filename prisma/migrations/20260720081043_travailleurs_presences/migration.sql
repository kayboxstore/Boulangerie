-- CreateEnum
CREATE TYPE "StatutPresence" AS ENUM ('PRESENT', 'ABSENT', 'RETARD');

-- CreateTable
CREATE TABLE "Travailleur" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "poste" TEXT NOT NULL,
    "dateEmbauche" DATE NOT NULL,
    "utilisateurId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Travailleur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Presence" (
    "id" TEXT NOT NULL,
    "travailleurId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "statut" "StatutPresence" NOT NULL,
    "heureArrivee" TEXT,
    "heureDepart" TEXT,
    "enregistreParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Presence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Travailleur_utilisateurId_key" ON "Travailleur"("utilisateurId");

-- CreateIndex
CREATE INDEX "Presence_date_idx" ON "Presence"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Presence_travailleurId_date_key" ON "Presence"("travailleurId", "date");

-- AddForeignKey
ALTER TABLE "Travailleur" ADD CONSTRAINT "Travailleur_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_travailleurId_fkey" FOREIGN KEY ("travailleurId") REFERENCES "Travailleur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_enregistreParId_fkey" FOREIGN KEY ("enregistreParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
