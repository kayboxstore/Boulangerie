-- DropForeignKey
ALTER TABLE "MessageSupport" DROP CONSTRAINT "MessageSupport_auteurId_fkey";

-- AlterTable
ALTER TABLE "ConversationSupport" ADD COLUMN     "escaladee" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "MessageSupport" ALTER COLUMN "auteurId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "MessageSupport" ADD CONSTRAINT "MessageSupport_auteurId_fkey" FOREIGN KEY ("auteurId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
