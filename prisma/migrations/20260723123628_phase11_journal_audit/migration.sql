-- CreateEnum
CREATE TYPE "ActionAudit" AS ENUM ('MODIFICATION', 'SUPPRESSION');

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "utilisateurId" TEXT,
    "utilisateurNom" TEXT NOT NULL,
    "module" "Module" NOT NULL,
    "typeEntite" TEXT NOT NULL,
    "entiteId" TEXT NOT NULL,
    "action" "ActionAudit" NOT NULL,
    "avant" JSONB,
    "apres" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_module_createdAt_idx" ON "AuditLog"("module", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_utilisateurId_createdAt_idx" ON "AuditLog"("utilisateurId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
