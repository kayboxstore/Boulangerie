-- CreateEnum
CREATE TYPE "StatutConversation" AS ENUM ('OUVERTE', 'FERMEE');

-- CreateTable
CREATE TABLE "ConversationSupport" (
    "id" TEXT NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "statut" "StatutConversation" NOT NULL DEFAULT 'OUVERTE',
    "fermeeParId" TEXT,
    "dateFermeture" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationSupport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageSupport" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "auteurType" TEXT NOT NULL,
    "auteurId" TEXT NOT NULL,
    "contenu" TEXT,
    "captureEcran" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageSupport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationSupport_utilisateurId_statut_idx" ON "ConversationSupport"("utilisateurId", "statut");

-- CreateIndex
CREATE INDEX "ConversationSupport_statut_updatedAt_idx" ON "ConversationSupport"("statut", "updatedAt");

-- CreateIndex
CREATE INDEX "MessageSupport_conversationId_createdAt_idx" ON "MessageSupport"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConversationSupport" ADD CONSTRAINT "ConversationSupport_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationSupport" ADD CONSTRAINT "ConversationSupport_fermeeParId_fkey" FOREIGN KEY ("fermeeParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageSupport" ADD CONSTRAINT "MessageSupport_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ConversationSupport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageSupport" ADD CONSTRAINT "MessageSupport_auteurId_fkey" FOREIGN KEY ("auteurId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
