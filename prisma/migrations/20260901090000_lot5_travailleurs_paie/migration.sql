-- Lot 5 Travailleurs / présence / paie.
--
-- 1. Toute fiche Travailleur nouvellement créée conserve son auteur, comme
--    Pointage.enregistrePar, Absence.declarePar, Sanction.enregistrePar et
--    BulletinPaie.generePar.
ALTER TABLE "Travailleur" ADD COLUMN "creeParId" TEXT;

ALTER TABLE "Travailleur"
  ADD CONSTRAINT "Travailleur_creeParId_fkey"
  FOREIGN KEY ("creeParId") REFERENCES "Utilisateur"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. Un bulletin de paie est un document officiel immuable. Il ne doit jamais
--    disparaître par cascade lors de la suppression d'une fiche Travailleur.
ALTER TABLE "BulletinPaie"
  DROP CONSTRAINT "BulletinPaie_travailleurId_fkey";

ALTER TABLE "BulletinPaie"
  ADD CONSTRAINT "BulletinPaie_travailleurId_fkey"
  FOREIGN KEY ("travailleurId") REFERENCES "Travailleur"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
