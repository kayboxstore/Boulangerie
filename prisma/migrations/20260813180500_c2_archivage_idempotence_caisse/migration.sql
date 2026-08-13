-- C2 : archivage, idempotence, contraintes et préparation de la caisse.

ALTER TABLE "Produit"
  ADD COLUMN "archiveLe" TIMESTAMP(3),
  ADD COLUMN "archiveParId" TEXT;

UPDATE "Produit"
SET "archiveLe" = COALESCE("updatedAt", CURRENT_TIMESTAMP)
WHERE "actif" = false AND "archiveLe" IS NULL;

ALTER TABLE "Produit"
  ADD CONSTRAINT "Produit_archiveParId_fkey"
  FOREIGN KEY ("archiveParId") REFERENCES "Utilisateur"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Produit_actif_nom_idx" ON "Produit"("actif", "nom");
CREATE INDEX "Produit_archiveLe_idx" ON "Produit"("archiveLe");

CREATE TABLE "OperationIdempotente" (
  "id" TEXT NOT NULL,
  "utilisateurId" TEXT NOT NULL,
  "portee" TEXT NOT NULL,
  "cle" TEXT NOT NULL,
  "empreinte" TEXT NOT NULL,
  "statutHttp" INTEGER NOT NULL,
  "reponse" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationIdempotente_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperationIdempotente_utilisateurId_portee_cle_key"
  ON "OperationIdempotente"("utilisateurId", "portee", "cle");
CREATE INDEX "OperationIdempotente_createdAt_idx"
  ON "OperationIdempotente"("createdAt");
ALTER TABLE "OperationIdempotente"
  ADD CONSTRAINT "OperationIdempotente_utilisateurId_fkey"
  FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "StatutSessionCaisse" AS ENUM ('OUVERTE', 'FERMEE');

CREATE TABLE "SessionCaisse" (
  "id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "statut" "StatutSessionCaisse" NOT NULL DEFAULT 'OUVERTE',
  "soldeOuverture" INTEGER NOT NULL,
  "soldeTheoriqueFermeture" INTEGER,
  "soldeCompteFermeture" INTEGER,
  "ecartFermeture" INTEGER,
  "ouverteParId" TEXT,
  "fermeeParId" TEXT,
  "ouverteLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fermeeLe" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SessionCaisse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionCaisse_date_key" ON "SessionCaisse"("date");
CREATE INDEX "SessionCaisse_statut_date_idx" ON "SessionCaisse"("statut", "date");

CREATE TABLE "RemiseCaisse" (
  "id" TEXT NOT NULL,
  "sessionCaisseId" TEXT NOT NULL,
  "montant" INTEGER NOT NULL,
  "remisParNom" TEXT NOT NULL,
  "recuParId" TEXT,
  "enregistreParId" TEXT,
  "reference" TEXT,
  "observation" TEXT,
  "dateRemise" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RemiseCaisse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RemiseCaisse_reference_key" ON "RemiseCaisse"("reference");
CREATE INDEX "RemiseCaisse_sessionCaisseId_dateRemise_idx"
  ON "RemiseCaisse"("sessionCaisseId", "dateRemise");

ALTER TABLE "SessionCaisse"
  ADD CONSTRAINT "SessionCaisse_ouverteParId_fkey"
  FOREIGN KEY ("ouverteParId") REFERENCES "Utilisateur"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "SessionCaisse_fermeeParId_fkey"
  FOREIGN KEY ("fermeeParId") REFERENCES "Utilisateur"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RemiseCaisse"
  ADD CONSTRAINT "RemiseCaisse_sessionCaisseId_fkey"
  FOREIGN KEY ("sessionCaisseId") REFERENCES "SessionCaisse"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RemiseCaisse_recuParId_fkey"
  FOREIGN KEY ("recuParId") REFERENCES "Utilisateur"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "RemiseCaisse_enregistreParId_fkey"
  FOREIGN KEY ("enregistreParId") REFERENCES "Utilisateur"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Contraintes de cohérence : la validation API ne suffit pas contre les
-- imports, scripts et courses concurrentes.
ALTER TABLE "Produit"
  ADD CONSTRAINT "Produit_prixVente_non_negatif" CHECK ("prixVente" >= 0),
  ADD CONSTRAINT "Produit_tauxTaxe_borne" CHECK ("tauxTaxe" >= 0 AND "tauxTaxe" <= 100),
  ADD CONSTRAINT "Produit_archive_coherente" CHECK (
    ("actif" = true AND "archiveLe" IS NULL)
    OR ("actif" = false AND "archiveLe" IS NOT NULL)
  );

ALTER TABLE "CommandeClient"
  ADD CONSTRAINT "CommandeClient_quantite_positive" CHECK ("quantiteBacs" > 0),
  ADD CONSTRAINT "CommandeClient_montants_non_negatifs" CHECK (
    "montantBrut" >= 0 AND "avanceUtilisee" >= 0 AND
    "montantAPercevoir" >= 0 AND "montantRecu" >= 0 AND
    "dette" >= 0 AND "avanceGeneree" >= 0 AND "nouvelleAvance" >= 0
  );

ALTER TABLE "PaiementCommande"
  ADD CONSTRAINT "PaiementCommande_montant_positif" CHECK ("montant" > 0);

ALTER TABLE "TauxDuJour"
  ADD CONSTRAINT "TauxDuJour_valeur_positive" CHECK ("valeur" > 0);

ALTER TABLE "DepenseCaisse"
  ADD CONSTRAINT "DepenseCaisse_montant_positif" CHECK ("montant" > 0),
  ADD CONSTRAINT "DepenseCaisse_farines_coherentes" CHECK (
    ("origine" = 'MANUELLE' AND "tauxApplique" IS NULL AND "sacsUtilises" IS NULL)
    OR ("origine" = 'FARINE' AND "tauxApplique" > 0 AND "sacsUtilises" > 0)
  );

ALTER TABLE "SessionCaisse"
  ADD CONSTRAINT "SessionCaisse_solde_ouverture_non_negatif" CHECK ("soldeOuverture" >= 0),
  ADD CONSTRAINT "SessionCaisse_fermeture_coherente" CHECK (
    ("statut" = 'OUVERTE' AND "fermeeLe" IS NULL AND
      "soldeTheoriqueFermeture" IS NULL AND "soldeCompteFermeture" IS NULL AND "ecartFermeture" IS NULL)
    OR
    ("statut" = 'FERMEE' AND "fermeeLe" IS NOT NULL AND
      "soldeTheoriqueFermeture" IS NOT NULL AND "soldeCompteFermeture" IS NOT NULL AND "ecartFermeture" IS NOT NULL)
  );

ALTER TABLE "RemiseCaisse"
  ADD CONSTRAINT "RemiseCaisse_montant_positif" CHECK ("montant" > 0),
  ADD CONSTRAINT "RemiseCaisse_remettant_non_vide" CHECK (length(trim("remisParNom")) > 0);

-- Une seule commande par client et jour OPÉRATIONNEL de Kinshasa, y compris
-- sous concurrence. L'index d'expression complète le contrôle applicatif.
CREATE UNIQUE INDEX "CommandeClient_client_jour_lomoto_key"
  ON "CommandeClient" (
    "clientId",
    (("dateCreation" AT TIME ZONE 'Africa/Kinshasa')::date)
  );

-- Une seule dépense farine par date.
CREATE UNIQUE INDEX "DepenseCaisse_date_farinee_key"
  ON "DepenseCaisse"("date")
  WHERE "origine" = 'FARINE';
