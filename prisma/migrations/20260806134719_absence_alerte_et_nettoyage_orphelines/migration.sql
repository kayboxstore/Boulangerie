/*
  Warnings:

  - You are about to drop the `ClotureCaisse` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `LigneVente` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Presence` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Vente` table. If the table is not empty, all the data it contains will be lost.

*/

-- Garde de sûreté (nettoyage des tables orphelines, 3.18) : ces 4 tables sont
-- censées être vides (Vente/LigneVente/ClotureCaisse depuis la refonte Caisse
-- 3.1, Presence depuis le passage à Pointage/Absence 3.18) — la base a été
-- réinitialisée entièrement depuis. On le revérifie ici, sur la base réelle,
-- plutôt que de le supposer : si une seule de ces tables contient encore des
-- lignes, toute la migration s'arrête (transaction annulée, aucune donnée
-- perdue) avec un message explicite plutôt que de supprimer à l'aveugle.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM "Vente"; IF n > 0 THEN
    RAISE EXCEPTION 'Migration arrêtée : la table Vente contient encore % ligne(s)', n;
  END IF;
  SELECT count(*) INTO n FROM "LigneVente"; IF n > 0 THEN
    RAISE EXCEPTION 'Migration arrêtée : la table LigneVente contient encore % ligne(s)', n;
  END IF;
  SELECT count(*) INTO n FROM "ClotureCaisse"; IF n > 0 THEN
    RAISE EXCEPTION 'Migration arrêtée : la table ClotureCaisse contient encore % ligne(s)', n;
  END IF;
  SELECT count(*) INTO n FROM "Presence"; IF n > 0 THEN
    RAISE EXCEPTION 'Migration arrêtée : la table Presence contient encore % ligne(s)', n;
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "ClotureCaisse" DROP CONSTRAINT "ClotureCaisse_caissierId_fkey";

-- DropForeignKey
ALTER TABLE "LigneVente" DROP CONSTRAINT "LigneVente_produitId_fkey";

-- DropForeignKey
ALTER TABLE "LigneVente" DROP CONSTRAINT "LigneVente_venteId_fkey";

-- DropForeignKey
ALTER TABLE "Presence" DROP CONSTRAINT "Presence_enregistreParId_fkey";

-- DropForeignKey
ALTER TABLE "Presence" DROP CONSTRAINT "Presence_travailleurId_fkey";

-- DropForeignKey
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_annuleeParId_fkey";

-- DropForeignKey
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_clotureId_fkey";

-- DropForeignKey
ALTER TABLE "Vente" DROP CONSTRAINT "Vente_vendeurId_fkey";

-- AlterTable
ALTER TABLE "Absence" ADD COLUMN     "alerteEnvoyeeLe" TIMESTAMP(3);

-- DropTable
DROP TABLE "ClotureCaisse";

-- DropTable
DROP TABLE "LigneVente";

-- DropTable
DROP TABLE "Presence";

-- DropTable
DROP TABLE "Vente";

-- DropEnum
DROP TYPE "MoyenPaiement";

-- DropEnum
DROP TYPE "StatutPresence";

-- DropEnum
DROP TYPE "StatutVente";
