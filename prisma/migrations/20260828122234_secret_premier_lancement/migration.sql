-- CreateTable
CREATE TABLE "SecretPremierLancement" (
    "id" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consommeLe" TIMESTAMP(3),
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecretPremierLancement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecretPremierLancement_secretHash_key" ON "SecretPremierLancement"("secretHash");

-- CreateIndex
CREATE INDEX "SecretPremierLancement_consommeLe_expiresAt_idx" ON "SecretPremierLancement"("consommeLe", "expiresAt");
