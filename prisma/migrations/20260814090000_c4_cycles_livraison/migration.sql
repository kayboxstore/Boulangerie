-- C4 : la prévision reste dans SchemaCommande ; ces tables ajoutent le cycle
-- logistique, ses quantités aval et son historique append-only.
CREATE TYPE "StatutCycleLivraison" AS ENUM (
  'PREVISION',
  'RETENUE_PRODUCTION',
  'PREPAREE',
  'REMISE_MAGASIN',
  'CHARGEE',
  'EN_TOURNEE',
  'EN_ATTENTE_CONFIRMATION',
  'PARTIELLEMENT_ACCEPTEE',
  'ACCEPTEE',
  'RETOUR_TOTAL',
  'ANNULEE'
);

CREATE TYPE "ActionCycleLivraison" AS ENUM (
  'RETENIR_PRODUCTION',
  'CONFIRMER_PREPARATION',
  'CONFIRMER_REMISE_MAGASIN',
  'CONFIRMER_CHARGEMENT',
  'CONFIRMER_DEPART',
  'SIGNALER_DEPOT',
  'CONFIRMER_ACCEPTATION'
);

CREATE TYPE "TypeAnomalieCycle" AS ENUM (
  'BON_NON_RETOURNE',
  'ECART_QUANTITE',
  'PRODUIT_ENDOMMAGE',
  'RETOUR_QUALITE',
  'CASH_TRANSPORTE_NON_RECU',
  'AUTRE'
);

ALTER TABLE "CommandeClient" ADD COLUMN "dateOperationnelle" DATE;
CREATE INDEX "CommandeClient_dateOperationnelle_idx" ON "CommandeClient"("dateOperationnelle");
CREATE UNIQUE INDEX "CommandeClient_clientId_dateOperationnelle_key"
  ON "CommandeClient"("clientId", "dateOperationnelle");

CREATE TABLE "CycleLivraison" (
  "id" TEXT NOT NULL,
  "schemaCommandeId" TEXT NOT NULL,
  "statut" "StatutCycleLivraison" NOT NULL DEFAULT 'PREVISION',
  "version" INTEGER NOT NULL DEFAULT 1,
  "livrePar" TEXT,
  "bonRetourne" BOOLEAN NOT NULL DEFAULT false,
  "bonRetourneLe" TIMESTAMP(3),
  "bonRetourneParId" TEXT,
  "commandeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CycleLivraison_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CycleLivraisonLigne" (
  "id" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "produitId" TEXT NOT NULL,
  "quantiteRetenueProduction" INTEGER,
  "quantitePreparee" INTEGER,
  "quantiteRemiseMagasin" INTEGER,
  "quantiteChargee" INTEGER,
  "quantiteDeposee" INTEGER,
  "quantiteAcceptee" INTEGER,
  "quantiteRetournee" INTEGER,
  "quantiteManquante" INTEGER,
  CONSTRAINT "CycleLivraisonLigne_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransitionCycleLivraison" (
  "id" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "action" "ActionCycleLivraison" NOT NULL,
  "versionAvant" INTEGER NOT NULL,
  "versionApres" INTEGER NOT NULL,
  "utilisateurId" TEXT,
  "observations" TEXT,
  "donnees" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TransitionCycleLivraison_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnomalieCycleLivraison" (
  "id" TEXT NOT NULL,
  "cycleId" TEXT NOT NULL,
  "type" "TypeAnomalieCycle" NOT NULL,
  "description" TEXT NOT NULL,
  "signaleeParId" TEXT,
  "signaleeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolueParId" TEXT,
  "resolueLe" TIMESTAMP(3),
  "commentaireResolution" TEXT,
  CONSTRAINT "AnomalieCycleLivraison_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CycleLivraison_schemaCommandeId_key" ON "CycleLivraison"("schemaCommandeId");
CREATE UNIQUE INDEX "CycleLivraison_commandeId_key" ON "CycleLivraison"("commandeId");
CREATE INDEX "CycleLivraison_statut_idx" ON "CycleLivraison"("statut");
CREATE INDEX "CycleLivraison_bonRetourne_statut_idx" ON "CycleLivraison"("bonRetourne", "statut");
CREATE UNIQUE INDEX "CycleLivraisonLigne_cycleId_produitId_key" ON "CycleLivraisonLigne"("cycleId", "produitId");
CREATE INDEX "CycleLivraisonLigne_produitId_idx" ON "CycleLivraisonLigne"("produitId");
CREATE INDEX "TransitionCycleLivraison_cycleId_createdAt_idx" ON "TransitionCycleLivraison"("cycleId", "createdAt");
CREATE INDEX "AnomalieCycleLivraison_cycleId_resolueLe_idx" ON "AnomalieCycleLivraison"("cycleId", "resolueLe");
CREATE INDEX "AnomalieCycleLivraison_type_resolueLe_idx" ON "AnomalieCycleLivraison"("type", "resolueLe");

ALTER TABLE "CycleLivraison" ADD CONSTRAINT "CycleLivraison_schemaCommandeId_fkey"
  FOREIGN KEY ("schemaCommandeId") REFERENCES "SchemaCommande"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CycleLivraison" ADD CONSTRAINT "CycleLivraison_bonRetourneParId_fkey"
  FOREIGN KEY ("bonRetourneParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CycleLivraison" ADD CONSTRAINT "CycleLivraison_commandeId_fkey"
  FOREIGN KEY ("commandeId") REFERENCES "CommandeClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CycleLivraisonLigne" ADD CONSTRAINT "CycleLivraisonLigne_cycleId_fkey"
  FOREIGN KEY ("cycleId") REFERENCES "CycleLivraison"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CycleLivraisonLigne" ADD CONSTRAINT "CycleLivraisonLigne_produitId_fkey"
  FOREIGN KEY ("produitId") REFERENCES "Produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransitionCycleLivraison" ADD CONSTRAINT "TransitionCycleLivraison_cycleId_fkey"
  FOREIGN KEY ("cycleId") REFERENCES "CycleLivraison"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransitionCycleLivraison" ADD CONSTRAINT "TransitionCycleLivraison_utilisateurId_fkey"
  FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnomalieCycleLivraison" ADD CONSTRAINT "AnomalieCycleLivraison_cycleId_fkey"
  FOREIGN KEY ("cycleId") REFERENCES "CycleLivraison"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnomalieCycleLivraison" ADD CONSTRAINT "AnomalieCycleLivraison_signaleeParId_fkey"
  FOREIGN KEY ("signaleeParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnomalieCycleLivraison" ADD CONSTRAINT "AnomalieCycleLivraison_resolueParId_fkey"
  FOREIGN KEY ("resolueParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Chaque prévision existante reçoit une enveloppe C4 stable sans être copiée.
INSERT INTO "CycleLivraison" ("id", "schemaCommandeId", "updatedAt")
SELECT CONCAT('c4_', md5("id")), "id", CURRENT_TIMESTAMP
FROM "SchemaCommande";

INSERT INTO "CycleLivraisonLigne" ("id", "cycleId", "produitId")
SELECT CONCAT('c4l_', md5(ligne."id")), cycle."id", ligne."produitId"
FROM "SchemaCommandeLigne" AS ligne
JOIN "CycleLivraison" AS cycle ON cycle."schemaCommandeId" = ligne."schemaCommandeId";
