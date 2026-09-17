-- CreateEnum
CREATE TYPE "StatutDemande" AS ENUM ('EN_ATTENTE', 'APPROUVEE', 'REJETEE');

-- CreateEnum
CREATE TYPE "TypeActionCritique" AS ENUM ('SUPPRIMER_UTILISATEUR', 'CREER_COMPTE_ADMIN', 'MODIFIER_TYPE_CLIENT', 'MODIFIER_TAUX_TAXE', 'MODIFIER_PERMISSIONS_ROLE');

-- CreateTable
CREATE TABLE "DemandeApprobation" (
    "id" TEXT NOT NULL,
    "type" "TypeActionCritique" NOT NULL,
    "donnees" JSONB NOT NULL,
    "resume" TEXT NOT NULL,
    "statut" "StatutDemande" NOT NULL DEFAULT 'EN_ATTENTE',
    "demandeParId" TEXT NOT NULL,
    "approuveParId" TEXT,
    "erreur" TEXT,
    "dateDemande" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dateDecision" TIMESTAMP(3),

    CONSTRAINT "DemandeApprobation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DelegationRole" (
    "id" TEXT NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "module" "Module" NOT NULL,
    "dateDebut" DATE NOT NULL,
    "dateFin" DATE NOT NULL,
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DelegationRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemandeApprobation_statut_dateDemande_idx" ON "DemandeApprobation"("statut", "dateDemande");

-- CreateIndex
CREATE INDEX "DelegationRole_utilisateurId_dateFin_idx" ON "DelegationRole"("utilisateurId", "dateFin");

-- AddForeignKey
ALTER TABLE "DemandeApprobation" ADD CONSTRAINT "DemandeApprobation_demandeParId_fkey" FOREIGN KEY ("demandeParId") REFERENCES "Utilisateur"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandeApprobation" ADD CONSTRAINT "DemandeApprobation_approuveParId_fkey" FOREIGN KEY ("approuveParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelegationRole" ADD CONSTRAINT "DelegationRole_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DelegationRole" ADD CONSTRAINT "DelegationRole_creeParId_fkey" FOREIGN KEY ("creeParId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
