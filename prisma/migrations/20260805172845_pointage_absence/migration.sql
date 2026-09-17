-- CreateEnum
CREATE TYPE "StatutDecisionAbsence" AS ENUM ('EN_ATTENTE', 'JUSTIFIEE', 'NON_JUSTIFIEE');

-- CreateTable
CREATE TABLE "Pointage" (
    "id" TEXT NOT NULL,
    "travailleurId" TEXT NOT NULL,
    "horodatageEntree" TIMESTAMP(3) NOT NULL,
    "horodatageSortie" TIMESTAMP(3),
    "enregistreParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Pointage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Absence" (
    "id" TEXT NOT NULL,
    "travailleurId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "motif" TEXT NOT NULL,
    "decisionStatut" "StatutDecisionAbsence" NOT NULL DEFAULT 'EN_ATTENTE',
    "decideParId" TEXT,
    "dateDecision" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Absence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pointage_travailleurId_horodatageEntree_idx" ON "Pointage"("travailleurId", "horodatageEntree");

-- CreateIndex
CREATE INDEX "Absence_travailleurId_date_idx" ON "Absence"("travailleurId", "date");

-- AddForeignKey
ALTER TABLE "Pointage" ADD CONSTRAINT "Pointage_travailleurId_fkey" FOREIGN KEY ("travailleurId") REFERENCES "Travailleur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pointage" ADD CONSTRAINT "Pointage_enregistreParId_fkey" FOREIGN KEY ("enregistreParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_travailleurId_fkey" FOREIGN KEY ("travailleurId") REFERENCES "Travailleur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Absence" ADD CONSTRAINT "Absence_decideParId_fkey" FOREIGN KEY ("decideParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Conversion des données historiques Presence -> Pointage/Absence (3.18).
-- La table Presence elle-même N'EST PAS supprimée (même politique que
-- Vente/LigneVente/ClotureCaisse après la refonte 3.1) : tout ce qui n'est
-- pas proprement convertible reste consultable telle quelle plutôt que
-- d'être deviné ou perdu.
DO $$
DECLARE
  compte_absences INT;
  compte_pointages INT;
  compte_non_convertibles INT;
BEGIN
  -- Absent -> Absence. L'ancien modèle ne portait ni motif ni décision : on
  -- pose un motif de repli explicite et un statut EN_ATTENTE (jamais une
  -- décision devinée).
  INSERT INTO "Absence" (id, "travailleurId", date, motif, "decisionStatut", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, "travailleurId", date,
         'Motif non renseigné — migré automatiquement depuis l''ancien pointage (statut Absent)',
         'EN_ATTENTE', "createdAt", "updatedAt"
  FROM "Presence"
  WHERE statut = 'ABSENT';
  GET DIAGNOSTICS compte_absences = ROW_COUNT;

  -- Présent/Retard AVEC heure d'arrivée renseignée -> horodatage réel
  -- reconstitué (date + heure). Sans heure de départ, horodatageSortie
  -- reste nul (comportement identique à un pointage encore ouvert).
  INSERT INTO "Pointage" (id, "travailleurId", "horodatageEntree", "horodatageSortie", "enregistreParId", "createdAt", "updatedAt")
  SELECT gen_random_uuid()::text, "travailleurId",
         (date + "heureArrivee"::time),
         CASE WHEN "heureDepart" IS NOT NULL THEN (date + "heureDepart"::time) ELSE NULL END,
         "enregistreParId", "createdAt", "updatedAt"
  FROM "Presence"
  WHERE statut IN ('PRESENT', 'RETARD') AND "heureArrivee" IS NOT NULL;
  GET DIAGNOSTICS compte_pointages = ROW_COUNT;

  -- Présent/Retard SANS heure d'arrivée : aucun horodatage réel n'est
  -- reconstituable sans deviner une heure — ces lignes ne sont PAS migrées.
  SELECT count(*) INTO compte_non_convertibles
  FROM "Presence"
  WHERE statut IN ('PRESENT', 'RETARD') AND "heureArrivee" IS NULL;

  RAISE NOTICE 'Migration Presence -> Pointage/Absence : % absence(s) migree(s), % pointage(s) migre(s), % ligne(s) NON convertible(s) (Present/Retard sans heure d''arrivee - consultez la table Presence, conservee intacte)',
    compte_absences, compte_pointages, compte_non_convertibles;
END $$;
