import { z } from "zod";

// ---------------------------------------------------------------------------
// Modules & niveaux d'accès (matrice de permissions — section 2 de la spec)
// ---------------------------------------------------------------------------

export const MODULES = [
  "CAISSE",
  "COMMANDES",
  "STOCKS",
  "PRODUCTION",
  "FOURNISSEURS",
  "COMMISSIONS",
  "PARAMETRES",
  "EQUIPE",
  "RAPPORTS",
  "TRAVAILLEURS",
] as const;

export type Module = (typeof MODULES)[number];

export const MODULE_LABELS: Record<Module, string> = {
  CAISSE: "Caisse / Ventes",
  COMMANDES: "Commandes clients",
  STOCKS: "Stocks",
  PRODUCTION: "Production & recettes",
  FOURNISSEURS: "Fournisseurs & achats",
  COMMISSIONS: "Commissions",
  PARAMETRES: "Paramètres",
  EQUIPE: "Équipe & droits d'accès",
  RAPPORTS: "Tableau de bord & rapports",
  TRAVAILLEURS: "Travailleurs",
};

export const NIVEAUX_ACCES = ["AUCUN", "LECTURE", "ECRITURE"] as const;
export type NiveauAcces = (typeof NIVEAUX_ACCES)[number];

// ---------------------------------------------------------------------------
// Schémas de validation (Zod) partagés front/back
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().email("Adresse e-mail invalide"),
  motDePasse: z.string().min(1, "Le mot de passe est requis"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const produitCreateSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(120),
  prixVente: z.number().int("Montant en Fc entier").min(0, "Le prix doit être positif"),
  // Le pain est exonéré de TVA — 0 par défaut ; taux configurable pour d'autres articles.
  tauxTaxe: z.number().min(0).max(100).default(0),
  categorie: z.string().trim().min(1, "La catégorie est requise").max(60),
  actif: z.boolean().default(true),
});
export type ProduitCreateInput = z.infer<typeof produitCreateSchema>;

export const produitUpdateSchema = produitCreateSchema.partial();
export type ProduitUpdateInput = z.infer<typeof produitUpdateSchema>;

// ---------------------------------------------------------------------------
// DTO renvoyés par l'API
// ---------------------------------------------------------------------------

export interface PermissionDTO {
  module: Module;
  niveauAcces: NiveauAcces;
}

export interface RoleDTO {
  id: string;
  nom: string;
  roleParentId: string | null;
  permissions: PermissionDTO[];
}

export interface UtilisateurDTO {
  id: string;
  nom: string;
  email: string;
  role: RoleDTO;
}

export interface ProduitDTO {
  id: string;
  nom: string;
  prixVente: number;
  tauxTaxe: number;
  categorie: string;
  actif: boolean;
}

export interface LoginResponse {
  token: string;
  utilisateur: UtilisateurDTO;
}

// ---------------------------------------------------------------------------
// Notifications temps réel (section 3.10)
// ---------------------------------------------------------------------------

/** Types d'événements métier — la liste s'étoffera avec les phases suivantes. */
export const TYPES_EVENEMENT = [
  "TEST",
  "NOUVELLE_VENTE",
  "CLOTURE_CAISSE",
  "TRANSACTION_INHABITUELLE",
  "NOUVELLE_COMMANDE",
  "REGLEMENT_COMMANDE",
  "ALERTE_STOCK",
  "MOUVEMENT_STOCK",
  "RECEPTION_FOURNISSEUR",
  "PRODUCTION_ENREGISTREE",
  "RAPPORT_PRODUCTION",
] as const;
export type TypeEvenement = (typeof TYPES_EVENEMENT)[number];

export type PrioriteNotification = "NORMALE" | "HAUTE";

export interface NotificationDTO {
  id: string;
  type: TypeEvenement;
  module: Module;
  message: string;
  evenementRef: string | null;
  donnees: unknown;
  priorite: PrioriteNotification;
  lu: boolean;
  dateCreation: string;
  emetteur: { id: string; nom: string; roleNom: string } | null;
}

/** Événements Socket.io serveur -> client. */
export interface ServerToClientEvents {
  notification: (notification: NotificationDTO) => void;
}
// Aucun événement client -> serveur pour l'instant (les actions passent par l'API REST).
export interface ClientToServerEvents {}

// ---------------------------------------------------------------------------
// Commandes clients & avances (section 3.4)
// ---------------------------------------------------------------------------

export const clientCreateSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(120),
  telephone: z.string().trim().max(30).optional(),
  typeClientId: z.string().min(1, "La qualité est requise"),
});
export type ClientCreateInput = z.infer<typeof clientCreateSchema>;

export const commandeCreateSchema = z.object({
  clientId: z.string().min(1, "Le client est requis"),
  quantiteBacs: z.number().int("Nombre de bacs entier").min(1, "Au moins 1 bac"),
  montantRecu: z.number().int("Montant en Fc entier").min(0, "Le montant reçu doit être positif"),
});
export type CommandeCreateInput = z.infer<typeof commandeCreateSchema>;

export interface CalculCommande {
  montantBrut: number;
  avanceUtilisee: number;
  montantAPercevoir: number;
  dette: number;
  avanceGeneree: number;
  nouvelleAvance: number;
}

/**
 * Calcul automatique d'une commande (champs 6, 8, 9, 10, 11 de la section 3.4).
 * L'avance existante du client est déduite AVANT affichage du montant à
 * percevoir ; le trop-perçu devient une nouvelle avance portée par le client.
 */
export function calculerCommande(params: {
  quantiteBacs: number;
  prixParBac: number;
  avanceExistante: number;
  montantRecu: number;
}): CalculCommande {
  const { quantiteBacs, prixParBac, avanceExistante, montantRecu } = params;
  const montantBrut = quantiteBacs * prixParBac;
  const avanceUtilisee = Math.min(avanceExistante, montantBrut);
  const montantAPercevoir = montantBrut - avanceUtilisee;
  const dette = Math.max(0, montantAPercevoir - montantRecu);
  const avanceGeneree = Math.max(0, montantRecu - montantAPercevoir);
  const nouvelleAvance = avanceExistante - avanceUtilisee + avanceGeneree;
  return { montantBrut, avanceUtilisee, montantAPercevoir, dette, avanceGeneree, nouvelleAvance };
}

export interface TypeClientDTO {
  id: string;
  nom: string;
  prixParBac: number;
  commissionParBac: number;
}

export interface ClientDTO {
  id: string;
  nom: string;
  telephone: string | null;
  typeClient: TypeClientDTO;
  avanceDisponible: number;
}

export interface ReglementDTO {
  id: string;
  montant: number;
  date: string;
  enregistrePar: { id: string; nom: string } | null;
}

export interface CommandeDTO {
  id: string;
  numero: number;
  dateCreation: string;
  client: { id: string; nom: string };
  qualite: string;
  quantiteBacs: number;
  montantBrut: number;
  avanceUtilisee: number;
  montantAPercevoir: number;
  montantRecu: number;
  dette: number;
  avanceGeneree: number;
  nouvelleAvance: number;
  creePar: { id: string; nom: string } | null;
  reglements: ReglementDTO[];
}

// Règlement ultérieur d'une dette (section 3.4) : le montant s'ajoute au
// montant reçu, dette et avances recalculées via calculerCommande().
export const reglementCreateSchema = z.object({
  montant: z.number().int("Montant en Fc entier").min(1, "Le montant doit être positif"),
});
export type ReglementCreateInput = z.infer<typeof reglementCreateSchema>;

/** Ligne du module Commissions (section 3.11) — vue dérivée des commandes Maman. */
export interface CommissionLigneDTO {
  commandeId: string;
  numero: number;
  dateCreation: string;
  clientNom: string;
  quantiteBacs: number;
  montantTotalPaye: number;
  commission: number;
}

/**
 * « Montant total payé » du module Commissions : si la commande est soldée
 * (dette = 0), on affiche le brut — payé à 100 % même si une partie vient de
 * l'avance ; sinon le montant partiel effectivement remis.
 */
export function montantTotalPaye(commande: { dette: number; montantBrut: number; montantRecu: number }): number {
  return commande.dette === 0 ? commande.montantBrut : commande.montantRecu;
}

// ---------------------------------------------------------------------------
// Caisse (section 3.1)
// ---------------------------------------------------------------------------

export const MOYENS_PAIEMENT = ["ESPECES", "MOBILE_MONEY", "CARTE"] as const;
export type MoyenPaiement = (typeof MOYENS_PAIEMENT)[number];

export const MOYEN_PAIEMENT_LABELS: Record<MoyenPaiement, string> = {
  ESPECES: "Espèces",
  MOBILE_MONEY: "Mobile money",
  CARTE: "Carte bancaire",
};

// Clé du seuil (en Fc) déclenchant l'alerte transaction inhabituelle (3.10).
// Stocké dans ParametreBoutique — valeur par défaut 100 000 Fc, modifiable
// plus tard par l'Admin dans les Paramètres.
export const CLE_SEUIL_ALERTE_TRANSACTION = "seuil_alerte_transaction";

export const venteCreateSchema = z.object({
  moyenPaiement: z.enum(MOYENS_PAIEMENT),
  lignes: z
    .array(
      z.object({
        produitId: z.string().min(1),
        quantite: z.number().int().min(1, "Quantité invalide"),
      }),
    )
    .min(1, "Le panier est vide"),
});
export type VenteCreateInput = z.infer<typeof venteCreateSchema>;

export interface LigneVenteDTO {
  id: string;
  produitId: string;
  produitNom: string;
  quantite: number;
  prixUnitaire: number;
  tauxTaxe: number;
}

export interface VenteDTO {
  id: string;
  numero: number;
  date: string;
  vendeur: { id: string; nom: string } | null;
  total: number;
  totalTaxe: number;
  moyenPaiement: MoyenPaiement;
  clotureId: string | null;
  lignes: LigneVenteDTO[];
}

export interface ClotureCaisseDTO {
  id: string;
  date: string;
  caissier: { id: string; nom: string } | null;
  nombreVentes: number;
  totalVentes: number;
  totalEspeces: number;
  totalMobileMoney: number;
  totalCarte: number;
}

// ---------------------------------------------------------------------------
// Stocks & matières premières (section 3.2)
// ---------------------------------------------------------------------------

export const TYPES_MOUVEMENT_STOCK = ["ENTREE", "SORTIE"] as const;
export type TypeMouvementStock = (typeof TYPES_MOUVEMENT_STOCK)[number];

export const TYPE_MOUVEMENT_LABELS: Record<TypeMouvementStock, string> = {
  ENTREE: "Entrée",
  SORTIE: "Sortie",
};

// Quantités de matières (kg, L…) : positives, au plus 3 décimales.
const quantiteMatiere = z
  .number()
  .refine((q) => Number.isFinite(q) && Math.round(q * 1000) === q * 1000, "Au plus 3 décimales");

export const matiereCreateSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(120),
  unite: z.string().trim().min(1, "L'unité est requise").max(20),
  seuilAlerte: quantiteMatiere.refine((q) => q >= 0, "Le seuil doit être positif"),
  // Stock de départ (optionnel) : enregistré comme mouvement ENTREE « Stock initial ».
  quantiteInitiale: quantiteMatiere.refine((q) => q >= 0, "La quantité doit être positive").default(0),
});
export type MatiereCreateInput = z.infer<typeof matiereCreateSchema>;

export const matiereUpdateSchema = matiereCreateSchema.omit({ quantiteInitiale: true }).partial();
export type MatiereUpdateInput = z.infer<typeof matiereUpdateSchema>;

export const mouvementCreateSchema = z.object({
  matierePremiereId: z.string().min(1, "La matière première est requise"),
  type: z.enum(TYPES_MOUVEMENT_STOCK),
  quantite: quantiteMatiere.refine((q) => q > 0, "La quantité doit être strictement positive"),
  reference: z.string().trim().max(160).optional(),
});
export type MouvementCreateInput = z.infer<typeof mouvementCreateSchema>;

export interface MatierePremiereDTO {
  id: string;
  nom: string;
  unite: string;
  quantiteStock: number;
  seuilAlerte: number;
  /** true si le stock est strictement sous le seuil d'alerte. */
  sousSeuil: boolean;
}

export interface MouvementStockDTO {
  id: string;
  matierePremiere: { id: string; nom: string; unite: string };
  type: TypeMouvementStock;
  quantite: number;
  reference: string | null;
  auteur: { id: string; nom: string } | null;
  date: string;
}

// ---------------------------------------------------------------------------
// Production & recettes (section 3.3)
// ---------------------------------------------------------------------------

export const recetteCreateSchema = z.object({
  produitId: z.string().min(1, "Le produit est requis"),
  instructions: z.string().trim().max(4000).optional(),
  // Quantités nécessaires POUR UNE UNITÉ produite.
  ingredients: z
    .array(
      z.object({
        matierePremiereId: z.string().min(1),
        quantite: quantiteMatiere.refine((q) => q > 0, "Quantité d'ingrédient invalide"),
      }),
    )
    .min(1, "Au moins un ingrédient"),
});
export type RecetteCreateInput = z.infer<typeof recetteCreateSchema>;

export const recetteUpdateSchema = recetteCreateSchema.omit({ produitId: true });
export type RecetteUpdateInput = z.infer<typeof recetteUpdateSchema>;

export const planningCreateSchema = z.object({
  recetteId: z.string().min(1, "La recette est requise"),
  quantitePrevue: z.number().int("Quantité entière").min(1, "Au moins 1"),
  datePrevue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide (AAAA-MM-JJ)"),
});
export type PlanningCreateInput = z.infer<typeof planningCreateSchema>;

export const productionCreateSchema = z.object({
  recetteId: z.string().min(1, "La recette est requise"),
  quantiteProduite: z.number().int("Quantité entière").min(1, "Au moins 1"),
  planningId: z.string().optional(),
});
export type ProductionCreateInput = z.infer<typeof productionCreateSchema>;

export interface IngredientRecetteDTO {
  id: string;
  matierePremiere: { id: string; nom: string; unite: string; quantiteStock: number };
  quantite: number;
}

export interface RecetteDTO {
  id: string;
  produit: { id: string; nom: string };
  instructions: string | null;
  ingredients: IngredientRecetteDTO[];
}

export type StatutPlanning = "PREVU" | "FAIT";

export interface PlanningProductionDTO {
  id: string;
  datePrevue: string;
  recette: { id: string; produitNom: string };
  quantitePrevue: number;
  statut: StatutPlanning;
  creePar: { id: string; nom: string } | null;
}

export interface ProductionDTO {
  id: string;
  numero: number;
  date: string;
  recette: { id: string; produitNom: string };
  quantiteProduite: number;
  enregistrePar: { id: string; nom: string } | null;
  /** Matières consommées par la décrémentation automatique. */
  consommations: { matiereNom: string; unite: string; quantite: number }[];
}

/** Formate une quantité de matière : 12.5 + "kg" -> "12,5 kg" */
export function formatQuantite(quantite: number, unite: string): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(quantite)} ${unite}`;
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/** Formate un montant en Franc Congolais : 4100 -> "4 100 Fc" */
export function formatFc(montant: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(montant)} Fc`;
}

/** Vérifie qu'un ensemble de permissions accorde au moins `niveau` sur `module`. */
export function aAcces(
  permissions: PermissionDTO[],
  module: Module,
  niveau: Exclude<NiveauAcces, "AUCUN">,
): boolean {
  const p = permissions.find((x) => x.module === module);
  if (!p || p.niveauAcces === "AUCUN") return false;
  if (niveau === "LECTURE") return true; // ECRITURE implique LECTURE
  return p.niveauAcces === "ECRITURE";
}
