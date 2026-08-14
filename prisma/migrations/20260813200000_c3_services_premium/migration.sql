-- C3 : récupération sécurisée, changement obligatoire et anniversaires.

ALTER TABLE "Utilisateur"
  ADD COLUMN "motDePasseDoitChanger" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Travailleur"
  ADD COLUMN "dateNaissance" DATE;

CREATE TABLE "JetonReinitialisationMotDePasse" (
  "id" TEXT NOT NULL,
  "utilisateurId" TEXT NOT NULL,
  "jetonHash" TEXT NOT NULL,
  "expireLe" TIMESTAMP(3) NOT NULL,
  "utiliseLe" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JetonReinitialisationMotDePasse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JetonReinitialisationMotDePasse_jetonHash_key"
  ON "JetonReinitialisationMotDePasse"("jetonHash");
CREATE INDEX "JetonReinitialisationMotDePasse_utilisateurId_createdAt_idx"
  ON "JetonReinitialisationMotDePasse"("utilisateurId", "createdAt");
CREATE INDEX "JetonReinitialisationMotDePasse_expireLe_idx"
  ON "JetonReinitialisationMotDePasse"("expireLe");

ALTER TABLE "JetonReinitialisationMotDePasse"
  ADD CONSTRAINT "JetonReinitialisationMotDePasse_utilisateurId_fkey"
  FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AffichageAnniversaire" (
  "id" TEXT NOT NULL,
  "utilisateurId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AffichageAnniversaire_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AffichageAnniversaire_utilisateurId_date_key"
  ON "AffichageAnniversaire"("utilisateurId", "date");
CREATE INDEX "AffichageAnniversaire_date_idx"
  ON "AffichageAnniversaire"("date");

ALTER TABLE "AffichageAnniversaire"
  ADD CONSTRAINT "AffichageAnniversaire_utilisateurId_fkey"
  FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
