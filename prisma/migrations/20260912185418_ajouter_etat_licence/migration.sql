-- CreateTable
CREATE TABLE "EtatLicence" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "dernierStatutConnu" TEXT NOT NULL,
    "joursRestants" INTEGER,
    "nomClientLicence" TEXT,
    "dernierContactReussi" TIMESTAMP(3),
    "miseAJour" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EtatLicence_pkey" PRIMARY KEY ("id")
);
