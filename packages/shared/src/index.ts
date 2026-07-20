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

// ---------------------------------------------------------------------------
// Équipe & droits d'accès (section 3.7) — gestion des comptes
// ---------------------------------------------------------------------------

/** Jusqu'à 3 comptes Administrateur : 1 Principal + 2 secondaires (section 3.7). */
export const MAX_COMPTES_ADMIN = 3;
export const ROLE_ADMINISTRATEUR = "Administrateur";

export const compteCreateSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(120),
  email: z.string().email("Adresse e-mail invalide").max(160),
  roleId: z.string().min(1, "Le rôle est requis"),
  // Mot de passe initial défini par l'Admin, changé ensuite par l'employé
  // depuis « Mon profil ».
  motDePasse: z.string().min(8, "Le mot de passe initial doit faire au moins 8 caractères").max(100),
});
export type CompteCreateInput = z.infer<typeof compteCreateSchema>;

export const compteUpdateSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(120).optional(),
  email: z.string().email("Adresse e-mail invalide").max(160).optional(),
  roleId: z.string().min(1).optional(),
});
export type CompteUpdateInput = z.infer<typeof compteUpdateSchema>;

export const motDePasseUpdateSchema = z.object({
  motDePasseActuel: z.string().min(1, "Le mot de passe actuel est requis"),
  nouveauMotDePasse: z
    .string()
    .min(8, "Le nouveau mot de passe doit faire au moins 8 caractères")
    .max(100),
});
export type MotDePasseUpdateInput = z.infer<typeof motDePasseUpdateSchema>;

/** Ligne du roster Équipe (liste des comptes, section 3.7). */
export interface CompteDTO {
  id: string;
  nom: string;
  email: string;
  actif: boolean;
  estAdminPrincipal: boolean;
  role: { id: string; nom: string };
  dateCreation: string;
}

// ---------------------------------------------------------------------------
// Fournisseurs & achats (section 3.6)
// ---------------------------------------------------------------------------

export const STATUTS_COMMANDE_FOURNISSEUR = ["EN_ATTENTE", "RECUE"] as const;
export type StatutCommandeFournisseur = (typeof STATUTS_COMMANDE_FOURNISSEUR)[number];

export const STATUT_COMMANDE_FOURNISSEUR_LABELS: Record<StatutCommandeFournisseur, string> = {
  EN_ATTENTE: "En attente",
  RECUE: "Reçue",
};

export const fournisseurCreateSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(120),
  contact: z.string().trim().max(300).optional(),
});
export type FournisseurCreateInput = z.infer<typeof fournisseurCreateSchema>;

export const fournisseurUpdateSchema = fournisseurCreateSchema.partial();
export type FournisseurUpdateInput = z.infer<typeof fournisseurUpdateSchema>;

export const commandeFournisseurCreateSchema = z.object({
  fournisseurId: z.string().min(1, "Le fournisseur est requis"),
  lignes: z
    .array(
      z.object({
        matierePremiereId: z.string().min(1),
        quantite: z
          .number()
          .refine((q) => Number.isFinite(q) && Math.round(q * 1000) === q * 1000, "Au plus 3 décimales")
          .refine((q) => q > 0, "La quantité doit être strictement positive"),
        prixUnitaire: z.number().int("Montant en Fc entier").min(0, "Le prix doit être positif"),
      }),
    )
    .min(1, "Au moins une ligne"),
});
export type CommandeFournisseurCreateInput = z.infer<typeof commandeFournisseurCreateSchema>;

export interface FournisseurDTO {
  id: string;
  nom: string;
  contact: string | null;
  /** Nombre de commandes passées à ce fournisseur (tous statuts). */
  nombreCommandes: number;
}

export interface LigneCommandeFournisseurDTO {
  id: string;
  matierePremiere: { id: string; nom: string; unite: string };
  quantite: number;
  prixUnitaire: number;
  /** quantite × prixUnitaire, arrondi au Fc. */
  sousTotal: number;
}

export interface CommandeFournisseurDTO {
  id: string;
  numero: number;
  fournisseur: { id: string; nom: string };
  statut: StatutCommandeFournisseur;
  date: string;
  dateReception: string | null;
  creePar: { id: string; nom: string } | null;
  recuePar: { id: string; nom: string } | null;
  lignes: LigneCommandeFournisseurDTO[];
  total: number;
}

/** Formate une quantité de matière : 12.5 + "kg" -> "12,5 kg" */
export function formatQuantite(quantite: number, unite: string): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(quantite)} ${unite}`;
}

// ---------------------------------------------------------------------------
// Travailleurs & présence (section 3.18)
// ---------------------------------------------------------------------------

export const STATUTS_PRESENCE = ["PRESENT", "ABSENT", "RETARD"] as const;
export type StatutPresence = (typeof STATUTS_PRESENCE)[number];

export const STATUT_PRESENCE_LABELS: Record<StatutPresence, string> = {
  PRESENT: "Présent",
  ABSENT: "Absent",
  RETARD: "Retard",
};

const dateISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide (AAAA-MM-JJ)");
const heureHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Heure invalide (HH:MM)");

export const travailleurCreateSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(120),
  telephone: z.string().trim().max(30).optional(),
  poste: z.string().trim().min(1, "Le poste est requis").max(80),
  dateEmbauche: dateISO,
  // Lien optionnel vers un compte Utilisateur (si la personne a un accès à l'app).
  utilisateurId: z.string().optional(),
});
export type TravailleurCreateInput = z.infer<typeof travailleurCreateSchema>;

export const travailleurUpdateSchema = travailleurCreateSchema.partial().extend({
  // null = délier explicitement le compte.
  utilisateurId: z.string().nullable().optional(),
});
export type TravailleurUpdateInput = z.infer<typeof travailleurUpdateSchema>;

// Pointage quotidien : re-pointer le même jour corrige la ligne existante.
export const presencePointageSchema = z.object({
  travailleurId: z.string().min(1, "Le travailleur est requis"),
  date: dateISO,
  statut: z.enum(STATUTS_PRESENCE),
  heureArrivee: heureHHMM.optional(),
  heureDepart: heureHHMM.optional(),
});
export type PresencePointageInput = z.infer<typeof presencePointageSchema>;

export interface TravailleurDTO {
  id: string;
  nom: string;
  telephone: string | null;
  poste: string;
  dateEmbauche: string;
  compte: { id: string; nom: string; email: string } | null;
}

export interface PresenceDTO {
  id: string;
  travailleur: { id: string; nom: string; poste: string };
  date: string;
  statut: StatutPresence;
  heureArrivee: string | null;
  heureDepart: string | null;
  enregistrePar: { id: string; nom: string } | null;
}

// ---------------------------------------------------------------------------
// Tableau de bord & rapports (section 3.8) — un DTO par widget, chaque widget
// étant conditionné à la lecture du module correspondant.
// ---------------------------------------------------------------------------

export interface RapportCaisseDTO {
  caJour: number;
  ca7Jours: number;
  ca30Jours: number;
  nbVentesJour: number;
  /** CA par jour sur 30 jours, pour la courbe (dates AAAA-MM-JJ, total en Fc). */
  serie30Jours: { date: string; total: number }[];
  /**
   * Meilleures ventes (30 jours) par volume, avec le CA encaissé par produit.
   * Pas de marge : le coût de revient n'est pas calculable tant que les prix
   * d'achat des matières ne sont pas systématiquement renseignés.
   */
  meilleuresVentes: { produitNom: string; quantite: number; ca: number }[];
}

export interface RapportCommandesDTO {
  nbCommandes30Jours: number;
  montantBrut30Jours: number;
  montantRecu30Jours: number;
  /** Agrégat de toutes les CommandeClient.dette > 0 (toutes périodes). */
  dettesEnCours: { nombre: number; total: number };
}

export interface RapportCommissionsDTO {
  totalCommissions30Jours: number;
  nbCommandesACommission30Jours: number;
}

export interface RapportStockDTO {
  /** Matières strictement sous leur seuil d'alerte. */
  alertes: { id: string; nom: string; unite: string; quantiteStock: number; seuilAlerte: number }[];
  nbMatieres: number;
}

export interface RapportProductionDTO {
  nbProductions30Jours: number;
  dernieres: { numero: number; produitNom: string; quantiteProduite: number; date: string }[];
}

export interface RapportFournisseursDTO {
  totalRecu30Jours: number;
  enAttente: number;
  achatsRecents: { numero: number; fournisseurNom: string; statut: StatutCommandeFournisseur; total: number; date: string }[];
}

export interface RapportTravailleursDTO {
  attendus: number;
  presents: number;
  retards: number;
  absents: number;
  nonPointes: number;
}

/** Résumé de clôture quotidien (3.8) — DG uniquement via la matrice (RAPPORTS). */
export interface ResumeClotureDTO {
  date: string;
  caJour: number;
  nbVentesJour: number;
  nbCommandesJour: number;
  dettesEnCours: { nombre: number; total: number };
  alertesStock: { nom: string; unite: string; quantiteStock: number; seuilAlerte: number }[];
}

// ---------------------------------------------------------------------------
// À propos (section 3.12) & Rapports personnels (section 3.13)
// ---------------------------------------------------------------------------

export const VERSION_APP = "0.1.0";
export const TAGLINE = "Pain Lia o Tonda";

/** Types d'action du journal d'activité personnel (3.13). */
export const TYPES_ACTIVITE = [
  "COMMANDE_CLIENT",
  "REGLEMENT",
  "VENTE",
  "CLOTURE_CAISSE",
  "PRODUCTION",
  "MOUVEMENT_STOCK",
  "COMMANDE_FOURNISSEUR",
  "RECEPTION_FOURNISSEUR",
  "POINTAGE",
] as const;
export type TypeActivite = (typeof TYPES_ACTIVITE)[number];

export const TYPE_ACTIVITE_LABELS: Record<TypeActivite, string> = {
  COMMANDE_CLIENT: "Commande client",
  REGLEMENT: "Règlement de dette",
  VENTE: "Vente",
  CLOTURE_CAISSE: "Clôture de caisse",
  PRODUCTION: "Production",
  MOUVEMENT_STOCK: "Mouvement de stock",
  COMMANDE_FOURNISSEUR: "Commande fournisseur",
  RECEPTION_FOURNISSEUR: "Réception fournisseur",
  POINTAGE: "Pointage",
};

export interface ActiviteDTO {
  id: string;
  type: TypeActivite;
  date: string;
  resume: string;
  utilisateur: { id: string; nom: string; roleNom: string };
}

/**
 * Portée du journal (3.13) — mécanisme dédié, PAS la matrice de permissions :
 * `tous` = portée globale (DG, Admins) ; sinon `utilisateurs` liste les
 * personnes visibles (soi-même + exceptions nommées, ex. Caissier(ère) →
 * Chargé des commandes).
 */
export interface PorteeRapportsDTO {
  tous: boolean;
  utilisateurs: { id: string; nom: string; roleNom: string }[];
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
