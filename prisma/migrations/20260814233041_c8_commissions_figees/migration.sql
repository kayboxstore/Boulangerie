/*
  Warnings:

  - Added the required column `commission` to the `CommandeClient` table without a default value. This is not possible if the table is not empty.

  Backfill : aucune valeur de commission n'a jamais été stockée avant cette
  migration (elle était recalculée à la volée en lecture à partir du taux
  COURANT de TypeClient.commissionParBac — voir Lot 7 pt 6). La seule
  approximation possible pour l'historique est donc ce même taux courant :
  ce backfill reproduit exactement les valeurs affichées jusqu'ici, sans
  changement visible immédiat. C'est à partir de cette migration que la
  commission de chaque commande reste figée pour de bon, comme montantBrut.
*/
-- AlterTable
ALTER TABLE "CommandeClient" ADD COLUMN     "commission" INTEGER;

-- Backfill
UPDATE "CommandeClient" c
SET "commission" = c."quantiteBacs" * tc."commissionParBac"
FROM "Client" cl
JOIN "TypeClient" tc ON tc.id = cl."typeClientId"
WHERE cl.id = c."clientId";

-- AlterTable
ALTER TABLE "CommandeClient" ALTER COLUMN "commission" SET NOT NULL;
