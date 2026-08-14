import { z } from "zod";

export const STATUTS_CYCLE_LIVRAISON = [
  "PREVISION",
  "RETENUE_PRODUCTION",
  "PREPAREE",
  "REMISE_MAGASIN",
  "CHARGEE",
  "EN_TOURNEE",
  "EN_ATTENTE_CONFIRMATION",
  "PARTIELLEMENT_ACCEPTEE",
  "ACCEPTEE",
  "RETOUR_TOTAL",
  "ANNULEE",
] as const;
export type StatutCycleLivraison = (typeof STATUTS_CYCLE_LIVRAISON)[number];

export const ACTIONS_CYCLE_LIVRAISON = [
  "RETENIR_PRODUCTION",
  "CONFIRMER_PREPARATION",
  "CONFIRMER_REMISE_MAGASIN",
  "CONFIRMER_CHARGEMENT",
  "CONFIRMER_DEPART",
  "SIGNALER_DEPOT",
  "CONFIRMER_ACCEPTATION",
] as const;
export type ActionCycleLivraison = (typeof ACTIONS_CYCLE_LIVRAISON)[number];

export const TYPES_ANOMALIE_CYCLE = [
  "BON_NON_RETOURNE",
  "ECART_QUANTITE",
  "PRODUIT_ENDOMMAGE",
  "RETOUR_QUALITE",
  "CASH_TRANSPORTE_NON_RECU",
  "AUTRE",
] as const;
export type TypeAnomalieCycle = (typeof TYPES_ANOMALIE_CYCLE)[number];

export const TYPES_EVENEMENT_CYCLE_LIVRAISON = [
  "PREVISION_TRANSMISE",
  "LIVRAISON_EN_ATTENTE_CONFIRMATION",
  "ANOMALIE_LIVRAISON",
  "ACCEPTATION_CONVERTIE",
  "BON_NON_RETOURNE",
] as const;
export type TypeEvenementCycleLivraison =
  (typeof TYPES_EVENEMENT_CYCLE_LIVRAISON)[number];

const nbBacs = z
  .number()
  .finite("Le nombre doit être fini")
  .int("Nombre entier de bacs")
  .min(0, "Nombre de bacs négatif impossible");
const versionCycleSchema = z.number().int().min(1);
const observationsCycleSchema = z.string().trim().max(2000).optional();
const lignesQuantiteCycleSchema = z
  .array(z.object({ produitId: z.string().min(1), quantite: nbBacs }))
  .min(1)
  .max(20);

export const transitionCycleLivraisonSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("RETENIR_PRODUCTION"),
    version: versionCycleSchema,
    lignes: lignesQuantiteCycleSchema,
    observations: observationsCycleSchema,
  }),
  z.object({
    action: z.literal("CONFIRMER_PREPARATION"),
    version: versionCycleSchema,
    lignes: lignesQuantiteCycleSchema,
    observations: observationsCycleSchema,
  }),
  z.object({
    action: z.literal("CONFIRMER_REMISE_MAGASIN"),
    version: versionCycleSchema,
    lignes: lignesQuantiteCycleSchema,
    observations: observationsCycleSchema,
  }),
  z.object({
    action: z.literal("CONFIRMER_CHARGEMENT"),
    version: versionCycleSchema,
    livrePar: z.string().trim().min(1).max(120),
    lignes: lignesQuantiteCycleSchema,
    observations: observationsCycleSchema,
  }),
  z.object({
    action: z.literal("CONFIRMER_DEPART"),
    version: versionCycleSchema,
    observations: observationsCycleSchema,
  }),
  z.object({
    action: z.literal("SIGNALER_DEPOT"),
    version: versionCycleSchema,
    lignes: lignesQuantiteCycleSchema,
    observations: observationsCycleSchema,
  }),
  z.object({
    action: z.literal("CONFIRMER_ACCEPTATION"),
    version: versionCycleSchema,
    lignes: z
      .array(
        z.object({
          produitId: z.string().min(1),
          quantiteAcceptee: nbBacs,
          quantiteRetournee: nbBacs,
        }),
      )
      .min(1)
      .max(20),
    bonRetourne: z.boolean(),
    observations: observationsCycleSchema,
  }),
]);
export type TransitionCycleLivraisonInput = z.infer<typeof transitionCycleLivraisonSchema>;

export const bonRetourneCycleSchema = z.object({ version: versionCycleSchema });
export type BonRetourneCycleInput = z.infer<typeof bonRetourneCycleSchema>;

export const anomalieCycleCreateSchema = z.object({
  version: versionCycleSchema,
  type: z.enum(TYPES_ANOMALIE_CYCLE),
  description: z.string().trim().min(1).max(2000),
});
export type AnomalieCycleCreateInput = z.infer<typeof anomalieCycleCreateSchema>;

export const anomalieCycleResoudreSchema = z.object({
  version: versionCycleSchema,
  commentaire: z.string().trim().min(1).max(2000),
});
export type AnomalieCycleResoudreInput = z.infer<typeof anomalieCycleResoudreSchema>;

export interface CycleLivraisonLigneDTO {
  produitId: string;
  produitNom: string;
  quantitePrevue: number;
  quantiteRetenueProduction: number | null;
  quantitePreparee: number | null;
  quantiteRemiseMagasin: number | null;
  quantiteChargee: number | null;
  quantiteDeposee: number | null;
  quantiteAcceptee: number | null;
  quantiteRetournee: number | null;
  quantiteManquante: number | null;
}

export interface CycleLivraisonDTO {
  id: string;
  dateLivraison: string;
  client: {
    id: string;
    nom: string;
    typeClientNom: string;
    zoneDepositaireId: string | null;
    zoneDepositaireNom: string | null;
  };
  statut: StatutCycleLivraison;
  version: number;
  lignes: CycleLivraisonLigneDTO[];
  totaux: {
    prevu: number;
    retenuProduction: number | null;
    prepare: number | null;
    remisMagasin: number | null;
    charge: number | null;
    depose: number | null;
    accepte: number | null;
    retourne: number | null;
    manquant: number | null;
  };
  livrePar: string | null;
  bonRetourne: boolean;
  anomalieOuverte: boolean;
  typesAnomalie: TypeAnomalieCycle[];
  estFacturable: boolean;
  commande: { id: string; numero: number; quantiteBacs: number } | null;
  derniereTransitionLe: string | null;
}

export interface TransitionCycleLivraisonDTO {
  id: string;
  action: ActionCycleLivraison;
  versionAvant: number;
  versionApres: number;
  utilisateur: { id: string; nom: string } | null;
  date: string;
  observations: string | null;
  donnees: unknown;
}

export interface AnomalieCycleDTO {
  id: string;
  type: TypeAnomalieCycle;
  description: string;
  signaleeLe: string;
  signaleePar: { id: string; nom: string } | null;
  resolueLe: string | null;
  resoluePar: { id: string; nom: string } | null;
  commentaireResolution: string | null;
}
