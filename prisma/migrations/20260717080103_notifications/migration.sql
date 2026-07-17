-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "destinataireId" TEXT NOT NULL,
    "emetteurId" TEXT,
    "type" TEXT NOT NULL,
    "module" "Module" NOT NULL,
    "evenementRef" TEXT,
    "message" TEXT NOT NULL,
    "donnees" JSONB,
    "lu" BOOLEAN NOT NULL DEFAULT false,
    "dateCreation" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_destinataireId_lu_idx" ON "Notification"("destinataireId", "lu");

-- CreateIndex
CREATE INDEX "Notification_destinataireId_dateCreation_idx" ON "Notification"("destinataireId", "dateCreation");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_destinataireId_fkey" FOREIGN KEY ("destinataireId") REFERENCES "Utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_emetteurId_fkey" FOREIGN KEY ("emetteurId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
