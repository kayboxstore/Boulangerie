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
  "NOUVELLE_COMMANDE",
  "REGLEMENT_COMMANDE",
  "ALERTE_STOCK",
  "MOUVEMENT_STOCK",
  "RECEPTION_FOURNISSEUR",
  "RAPPORT_PRODUCTION",
] as const;
export type TypeEvenement = (typeof TYPES_EVENEMENT)[number];

export interface NotificationDTO {
  id: string;
  type: TypeEvenement;
  module: Module;
  message: string;
  evenementRef: string | null;
  donnees: unknown;
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
