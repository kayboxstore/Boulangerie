import { z } from "zod";

// Ton des textes (section 3.8) : filet de sécurité pour les rares champs de
// schéma sans message personnalisé (ex. champs internes des id de ligne) — au
// lieu du message par défaut de Zod, en anglais et technique ("Expected
// string, received number"), un message générique mais clair et en français.
// Les schémas ci-dessous continuent de définir un message dédié partout où un
// utilisateur peut réellement déclencher l'erreur en tapant une valeur.
z.setErrorMap((issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === "undefined" ? "Ce champ est requis." : "Valeur invalide." };
    case z.ZodIssueCode.too_small:
      return { message: "Cette valeur est trop courte ou trop petite." };
    case z.ZodIssueCode.too_big:
      return { message: "Cette valeur est trop longue ou trop grande." };
    case z.ZodIssueCode.invalid_string:
      return { message: "Format invalide." };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: "Valeur non reconnue." };
    default:
      return { message: ctx.defaultError };
  }
});


// ---------------------------------------------------------------------------
// Validation primitive commune — C2
// ---------------------------------------------------------------------------

export const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Valide le format ET l'existence calendaire (2026-02-31 est refusé). */
export function estDateISOValide(valeur: string): boolean {
  if (!DATE_ISO_REGEX.test(valeur)) return false;
  const date = new Date(`${valeur}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === valeur;
}

export const dateISOSchema = z
  .string()
  .regex(DATE_ISO_REGEX, "Date invalide (AAAA-MM-JJ)")
  .refine(estDateISOValide, "Cette date n'existe pas dans le calendrier");

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
  CAISSE: "Caisse",
  COMMANDES: "Commandes clients",
  STOCKS: "Stocks",
  PRODUCTION: "Production",
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
  prixVente: z.number().finite("Le nombre doit être fini").int("Montant en Fc entier").min(0, "Le prix doit être positif"),
  // Le pain est exonéré de TVA — 0 par défaut ; taux configurable pour d'autres articles.
  tauxTaxe: z.number().finite("Le nombre doit être fini").min(0).max(100).default(0),
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
  // Compte Administrateur principal (section 2) — décide de l'exécution directe
  // vs différée des tâches critiques, et de l'accès aux approbations.
  estAdminPrincipal: boolean;
  // Langue d'interface préférée (section 3.9) ; null = suivre la langue par
  // défaut de la boutique. `Langue` est défini plus bas dans ce fichier.
  languePreferee: Langue | null;
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
  // Langue par défaut de la boutique — sert de repli quand l'utilisateur n'a
  // pas de préférence (languePreferee = null).
  langueDefautBoutique: Langue;
}

// ---------------------------------------------------------------------------
// Assistant de premier lancement (section 3.7, nouveau) — DTO ici, schémas de
// saisie plus bas (dans la section Travailleurs).
// ---------------------------------------------------------------------------

export interface EtatInitialDTO {
  premierLancement: boolean;
}

// ---------------------------------------------------------------------------
// Notifications temps réel (section 3.10)
// ---------------------------------------------------------------------------

/** Types d'événements métier — la liste s'étoffera avec les phases suivantes. */
export const TYPES_EVENEMENT = [
  "TEST",
  "NOUVELLE_COMMANDE",
  "REGLEMENT_COMMANDE",
  "ALERTE_STOCK",
  "MOUVEMENT_STOCK",
  "RECEPTION_FOURNISSEUR",
  "PRODUCTION_ENREGISTREE",
  "RAPPORT_PRODUCTION",
  "DEMANDE_APPROBATION",
  // Registre de caisse (3.1) : taux du jour défini, dépense ajoutée/supprimée.
  "REGISTRE_CAISSE",
  // Dette non payée (3.4) : émis par le SYSTÈME (aucun émetteur humain).
  "DETTE_NON_PAYEE",
  // Garde-fou (section 2) : l'Admin Principal a écrit dans un module métier
  // hors de son périmètre d'origine — le rôle propriétaire et le DG sont alertés.
  "INTERVENTION_ADMIN",
  // Assistant (section 3.19) : nouveau message dans une conversation support.
  "MESSAGE_SUPPORT",
  // Assistant : une conversation vient d'être escaladée à un humain (bouton
  // "Parler à un Admin", ou automatiquement si l'IA échoue).
  "ESCALADE_SUPPORT",
  // Réaffectation d'équipe (section 3.7) : le rôle/équipe d'un compte change —
  // notification au titulaire du compte concerné.
  "REAFFECTATION_EQUIPE",
  // Absence tranchée non justifiée (section 3.18) : notifie le travailleur
  // concerné (s'il a un compte) et les autres Admins.
  "ABSENCE_NON_JUSTIFIEE",
  // Rappel absence en attente (3.18, nouveau) : émis par le SYSTÈME, même
  // mécanisme que DETTE_NON_PAYEE — le jour suivant une absence encore
  // EN_ATTENTE, jamais renvoyé une fois parti (alerteEnvoyeeLe).
  "ABSENCE_EN_ATTENTE",
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
  sessionInvalidee: (payload: { message: string }) => void;
  // Assistant (section 3.19) : mise à jour temps réel du fil d'une conversation
  // (message ajouté, conversation fermée) — en plus de la notification générique
  // ci-dessus qui prévient les Admins/l'utilisateur même si la vue n'est pas ouverte.
  messageSupport: (message: MessageSupportDTO) => void;
  conversationSupportFermee: (payload: { conversationId: string }) => void;
  conversationSupportEscaladee: (payload: { conversationId: string }) => void;
}
// Aucun événement client -> serveur pour l'instant (les actions passent par l'API REST).
export interface ClientToServerEvents {}

// Session unique (section 3.7) : code d'erreur HTTP 401 et message partagés
// entre le middleware d'auth, le canal Socket.io et le frontend, pour que les
// deux voies (requête suivante / déconnexion temps réel) affichent le même texte.
export const CODE_SESSION_REMPLACEE = "SESSION_REMPLACEE" as const;
export const MESSAGE_SESSION_REMPLACEE =
  "Vous avez été déconnecté(e) car votre compte a été utilisé sur un autre appareil";

// Réinitialisation de la base (section 3.15) : tous les comptes disparaissent
// d'un coup — même canal `sessionInvalidee` que la session unique, message dédié.
export const MESSAGE_BASE_REINITIALISEE = "La base de données vient d'être réinitialisée par un administrateur.";

// ---------------------------------------------------------------------------
// Commandes clients & avances (section 3.4)
// ---------------------------------------------------------------------------

export const clientCreateSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(120),
  telephone: z.string().trim().max(30).optional(),
  typeClientId: z.string().min(1, "La qualité est requise"),
  // Zone de dépôt (section 3.3 d) — n'a de sens que pour la Qualité
  // Dépositaire ; ignorée côté API pour les autres Qualités.
  zoneDepositaireId: z.string().min(1).optional(),
});
export type ClientCreateInput = z.infer<typeof clientCreateSchema>;

/**
 * Résolution d'un doublon (section 3.4) : un client ne peut pas avoir deux
 * commandes le même jour. À la deuxième saisie, l'utilisateur choisit — et le
 * choix s'applique TOUJOURS sur la commande existante (même numéro) :
 *  - MODIFIER  : la nouvelle saisie s'additionne à l'existante ;
 *  - REMPLACER : la nouvelle saisie écrase l'ancienne, qui est oubliée.
 */
export const STRATEGIES_DOUBLON = ["MODIFIER", "REMPLACER"] as const;
export type StrategieDoublon = (typeof STRATEGIES_DOUBLON)[number];

export const STRATEGIE_DOUBLON_LABELS: Record<StrategieDoublon, string> = {
  MODIFIER: "Modifier (additionner)",
  REMPLACER: "Remplacer (écraser)",
};

export const commandeCreateSchema = z.object({
  clientId: z.string().min(1, "Le client est requis"),
  quantiteBacs: z.number().finite("Le nombre doit être fini").int("Nombre de bacs entier").min(1, "Au moins 1 bac"),
  montantRecu: z.number().finite("Le nombre doit être fini").int("Montant en Fc entier").min(0, "Le montant reçu doit être positif"),
  /**
   * Absent = saisie normale ; si un doublon existe, l'API répond 409 avec la
   * commande en conflit pour que l'UI propose le choix. Présent = le choix a
   * été fait, on l'applique sur la commande existante.
   */
  strategie: z.enum(STRATEGIES_DOUBLON).optional(),
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

/**
 * Avance dont disposait le client AVANT la commande visée (section 3.4).
 * Nécessaire pour recalculer une commande mise à jour sans compter deux fois
 * son propre effet sur le solde : on inverse ce que la commande a appliqué.
 */
export function avanceAvantCommande(params: {
  avanceDisponibleClient: number;
  avanceUtilisee: number;
  avanceGeneree: number;
}): number {
  return params.avanceDisponibleClient + params.avanceUtilisee - params.avanceGeneree;
}

export interface TypeClientDTO {
  id: string;
  nom: string;
  prixParBac: number;
  commissionParBac: number;
}

// Types de clients (« Qualité ») — édités dans les Paramètres (section 3.9),
// écriture réservée à l'Administrateur. Les montants sont en Fc.
export const typeClientCreateSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(60),
  prixParBac: z.number().finite("Le nombre doit être fini").int("Montant en Fc entier").min(0, "Le prix doit être positif"),
  commissionParBac: z.number().finite("Le nombre doit être fini").int("Montant en Fc entier").min(0, "La commission doit être positive").default(0),
});
export type TypeClientCreateInput = z.infer<typeof typeClientCreateSchema>;

export const typeClientUpdateSchema = typeClientCreateSchema.partial();
export type TypeClientUpdateInput = z.infer<typeof typeClientUpdateSchema>;

export const clientUpdateSchema = clientCreateSchema.partial().extend({
  zoneDepositaireId: z.string().min(1).nullable().optional(),
});
export type ClientUpdateInput = z.infer<typeof clientUpdateSchema>;

export interface ZoneDepositaireDTO {
  id: string;
  nom: string;
  ordre: number;
}

export const zoneDepositaireCreateSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(80),
  ordre: z.number().finite("Le nombre doit être fini").int().min(0).max(10_000).default(0),
});
export type ZoneDepositaireCreateInput = z.infer<typeof zoneDepositaireCreateSchema>;

export const zoneDepositaireUpdateSchema = zoneDepositaireCreateSchema.partial();
export type ZoneDepositaireUpdateInput = z.infer<typeof zoneDepositaireUpdateSchema>;

export interface ClientDTO {
  id: string;
  nom: string;
  telephone: string | null;
  typeClient: TypeClientDTO;
  avanceDisponible: number;
  zoneDepositaireId: string | null;
  zoneDepositaireNom: string | null;
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

/**
 * Réponse 409 à une saisie en doublon : porte la commande déjà enregistrée ce
 * jour-là pour ce client, plus l'aperçu de ce que donnerait chaque choix — afin
 * que l'utilisateur décide en connaissance de cause.
 */
export interface ConflitCommandeDTO {
  erreur: string;
  conflit: true;
  commandeExistante: CommandeDTO;
  apercu: Record<StrategieDoublon, { quantiteBacs: number; montantRecu: number }>;
}

/**
 * Alerte « dette non payée » (section 3.4) : commande antérieure à aujourd'hui
 * dont la dette reste ouverte. La notification n'est envoyée qu'UNE fois par
 * commande (`alerteEnvoyeeLe`) ; le module continue d'afficher la liste tant que
 * la dette n'est pas soldée.
 */
export interface AlerteDetteDTO {
  commandeId: string;
  numero: number;
  clientNom: string;
  dette: number;
  dateCreation: string;
  /** Jours écoulés depuis la création de la commande. */
  joursDepuis: number;
  alerteEnvoyeeLe: string | null;
}

/**
 * Totaux livrés du jour, par client (Bon de livraison — module Production),
 * utilisés pour pré-remplir « Nombre de bacs reçus » à la création d'une
 * commande, sans lier rigidement les deux modules.
 */
export interface LivraisonsDuJourDTO {
  date: string;
  totauxParClientId: Record<string, number>;
}

/** Résumé du jour du module Commandes (section 3.4). */
export interface ResumeCommandesJourDTO {
  date: string;
  nombreCommandes: number;
  totalBacs: number;
  totalAPercevoir: number;
  totalRecu: number;
  nbSoldees: number;
  nbAvecDette: number;
  totalDettes: number;
}

// Règlement ultérieur d'une dette (section 3.4) : le montant s'ajoute au
// montant reçu, dette et avances recalculées via calculerCommande().
export const reglementCreateSchema = z.object({
  montant: z.number().finite("Le nombre doit être fini").int("Montant en Fc entier").min(1, "Le montant doit être positif"),
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

// Clés du magasin clé/valeur ParametreBoutique (section 3.9), éditées par l'Admin.
export const CLE_BOUTIQUE_NOM = "boutique_nom";
export const CLE_BOUTIQUE_ADRESSE = "boutique_adresse";
export const CLE_BOUTIQUE_CONTACT = "boutique_contact";
export const CLE_LANGUE_DEFAUT = "langue_defaut";
// Nouveaux champs éditables depuis À propos (section 3.12) — même magasin
// clé/valeur, aucune duplication. reseaux_sociaux est un JSON sérialisé
// (ReseauSocial[]) : liste extensible, pas de plateformes fixes prédéfinies.
export const CLE_BOUTIQUE_PRESENTATION = "boutique_presentation";
export const CLE_BOUTIQUE_HORAIRES = "boutique_horaires";
export const CLE_BOUTIQUE_RESEAUX_SOCIAUX = "boutique_reseaux_sociaux";

// ---------------------------------------------------------------------------
// Caisse — registre journalier (section 3.1)
// ---------------------------------------------------------------------------
// La vente au comptoir est retirée : plus de MOYENS_PAIEMENT, plus de VenteDTO,
// plus d'alerte transaction inhabituelle ni de seuil configurable.

/** Constantes du calcul de la dépense farine : [(33,5 × taux) + 500] × sacs. */
export const FARINE_COEFFICIENT_TAUX = 33.5;
export const FARINE_SUPPLEMENT_FC = 500;

/** Montant de la depense farine, arrondi au Franc. Partage front/back. */
export function calculerDepenseFarine(taux: number, sacsUtilises: number): number {
  return Math.round((FARINE_COEFFICIENT_TAUX * taux + FARINE_SUPPLEMENT_FC) * sacsUtilises);
}

export const tauxDuJourSchema = z.object({
  date: dateISOSchema,
  valeur: z.number().finite("Le nombre doit être fini").positive("Le taux doit etre strictement positif").max(1_000_000),
});
export type TauxDuJourInput = z.infer<typeof tauxDuJourSchema>;

export interface TauxDuJourDTO {
  id: string;
  date: string;
  valeur: number;
  definiPar: { id: string; nom: string } | null;
}

export const ORIGINES_DEPENSE = ["MANUELLE", "FARINE"] as const;
export type OrigineDepense = (typeof ORIGINES_DEPENSE)[number];

/** Motif fige de la ligne de depense farine (section 3.1). */
export const MOTIF_DEPENSE_FARINE = "Achat farine";

export const depenseCreateSchema = z.object({
  date: dateISOSchema,
  motif: z.string().trim().min(1, "Le motif est requis").max(200),
  montant: z.number().finite("Le nombre doit être fini").int("Montant en Fc entier").min(1, "Le montant doit etre positif"),
});
export type DepenseCreateInput = z.infer<typeof depenseCreateSchema>;

/** Case a cocher de la depense farine : activer ou retirer la ligne du jour. */
export const depenseFarineSchema = z.object({
  date: dateISOSchema,
  active: z.boolean(),
});
export type DepenseFarineInput = z.infer<typeof depenseFarineSchema>;

export interface DepenseCaisseDTO {
  id: string;
  date: string;
  motif: string;
  montant: number;
  origine: OrigineDepense;
  /** Entrees du calcul, conservees pour que la ligne farine reste verifiable. */
  tauxApplique: number | null;
  sacsUtilises: number | null;
  enregistrePar: { id: string; nom: string } | null;
}

/** Raison pour laquelle la case farine est indisponible (null = disponible). */
export type BlocageFarine = "TAUX_MANQUANT" | "PRODUCTION_MANQUANTE";

export interface RegistreCaisseDTO {
  date: string;
  /** Argent recu a la CREATION des commandes du jour (hors reglements). */
  entrees: number;
  /** Reglements dates du jour - jamais comptes dans les entrees. */
  dettesPayees: number;
  detailDettesPayees: {
    id: string;
    clientNom: string;
    commandeNumero: number;
    montant: number;
    date: string;
  }[];
  depenses: DepenseCaisseDTO[];
  totalDepenses: number;
  /** (Entrees + Dettes payees) - Depenses */
  solde: number;
  taux: TauxDuJourDTO | null;
  /** Sacs consommes en production ce jour-la (source du calcul farine). */
  sacsUtilisesJour: number;
  farine: {
    /** Ligne farine deja presente dans les depenses du jour ? */
    active: boolean;
    /** null si la case est utilisable ; sinon la raison du blocage. */
    blocage: BlocageFarine | null;
    /** Montant qu'ajouterait la case, si elle est utilisable. */
    montantEstime: number | null;
  };
}



// Préparation C2 — session et remise de caisse. Ces contrats enveloppent le
// registre journalier actuel sans modifier son calcul.
export const STATUTS_SESSION_CAISSE = ["OUVERTE", "FERMEE"] as const;
export type StatutSessionCaisse = (typeof STATUTS_SESSION_CAISSE)[number];

export const sessionCaisseOuvertureSchema = z.object({
  date: dateISOSchema,
  soldeOuverture: z.number().finite("Le nombre doit être fini").int("Montant en Fc entier").min(0),
});
export type SessionCaisseOuvertureInput = z.infer<typeof sessionCaisseOuvertureSchema>;

export const sessionCaisseFermetureSchema = z.object({
  soldeTheoriqueFermeture: z.number().finite("Le nombre doit être fini").int("Montant en Fc entier").min(0),
  soldeCompteFermeture: z.number().finite("Le nombre doit être fini").int("Montant en Fc entier").min(0),
});
export type SessionCaisseFermetureInput = z.infer<typeof sessionCaisseFermetureSchema>;

export const remiseCaisseCreateSchema = z.object({
  montant: z.number().finite("Le nombre doit être fini").int("Montant en Fc entier").positive("Le montant doit être positif"),
  remisParNom: z.string().trim().min(1, "Le remettant est requis").max(120),
  reference: z.string().trim().min(1).max(120).optional(),
  observation: z.string().trim().max(500).optional(),
});
export type RemiseCaisseCreateInput = z.infer<typeof remiseCaisseCreateSchema>;

export interface SessionCaisseDTO {
  id: string;
  date: string;
  statut: StatutSessionCaisse;
  soldeOuverture: number;
  soldeTheoriqueFermeture: number | null;
  soldeCompteFermeture: number | null;
  ecartFermeture: number | null;
  ouverteLe: string;
  fermeeLe: string | null;
}

export interface RemiseCaisseDTO {
  id: string;
  sessionCaisseId: string;
  montant: number;
  remisParNom: string;
  recuPar: { id: string; nom: string } | null;
  reference: string | null;
  observation: string | null;
  dateRemise: string;
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
// Production (section 3.3 — refonte : plus de recettes)
// ---------------------------------------------------------------------------

/**
 * Les 4 ingrédients suivis à la production. Le `code` relie la quantité saisie
 * à la MatierePremiere correspondante, pour la décrémentation automatique du
 * stock (pas de correspondance par nom, trop fragile).
 */
export const CODES_INGREDIENT = ["FARINE", "LEVURE", "SEL", "HUILE"] as const;
export type CodeIngredient = (typeof CODES_INGREDIENT)[number];

export const CODE_INGREDIENT_LABELS: Record<CodeIngredient, string> = {
  FARINE: "Farine (sacs)",
  LEVURE: "Levure (paquets)",
  SEL: "Sel (kg)",
  HUILE: "Huile",
};

const quantiteIngredient = z
  .number()
  .min(0, "Quantité négative impossible")
  .max(1_000_000, "Quantité trop élevée");
const nbBacs = z.number().finite("Le nombre doit être fini").int("Nombre entier de bacs").min(0, "Nombre de bacs négatif impossible");

// --- a) Planning de production ---------------------------------------------

export const planningCreateSchema = z.object({
  datePrevue: dateISOSchema,
  nombreBacsCommandes: nbBacs,
  /** Détail par produit du catalogue (Carré, Baguette…). */
  lignes: z
    .array(
      z.object({
        produitId: z.string().min(1),
        quantitePrevue: nbBacs,
      }),
    )
    .max(50)
    .default([]),
  sacsFarinePrevus: quantiteIngredient.default(0),
  paquetsLevurePrevus: quantiteIngredient.default(0),
  quantiteHuilePrevue: quantiteIngredient.default(0),
  kgSelPrevus: quantiteIngredient.default(0),
  observations: z.string().trim().max(2000).optional(),
});
export type PlanningCreateInput = z.infer<typeof planningCreateSchema>;

export interface PlanningProductionDTO {
  id: string;
  datePrevue: string;
  nombreBacsCommandes: number;
  lignes: { produitId: string; produitNom: string; quantitePrevue: number }[];
  sacsFarinePrevus: number;
  paquetsLevurePrevus: number;
  quantiteHuilePrevue: number;
  kgSelPrevus: number;
  observations: string | null;
  creePar: { id: string; nom: string } | null;
}

// --- d) Schéma de commande ---------------------------------------------------

/**
 * Les 4 variantes suivies par le Schéma de commande — reprises telles quelles
 * de la fiche papier historique. Rattachées au catalogue Produit existant par
 * leur nom (pas d'ID en dur, différents selon l'environnement) : ajouter une
 * variante au Schéma se fait en complétant cette liste, sans migration.
 */
export const NOMS_PRODUITS_SCHEMA_COMMANDE = [
  "Carré 1.500 Fc",
  "Carré 1.000 Fc",
  "Baguette 500 Fc",
  "Baguette 1.000 Fc",
] as const;

/**
 * Une ligne du Schéma pour un client donné : la commande d'un Dépositaire ou
 * d'une Maman pour une date, détaillée par produit. `total` est dérivé
 * (somme des lignes) mais renvoyé pré-calculé pour éviter de le refaire à
 * l'identique dans chaque écran.
 */
export const schemaCommandeLigneClientSchema = z.object({
  clientId: z.string().min(1),
  lignes: z
    .array(z.object({ produitId: z.string().min(1), quantite: nbBacs }))
    .max(20)
    .default([]),
});
export type SchemaCommandeLigneClientInput = z.infer<typeof schemaCommandeLigneClientSchema>;

/** Remplace, pour une date donnée, l'ensemble des commandes clients du Schéma. */
export const schemaCommandeJourSchema = z.object({
  date: dateISOSchema,
  clients: z.array(schemaCommandeLigneClientSchema).max(200).default([]),
});
export type SchemaCommandeJourInput = z.infer<typeof schemaCommandeJourSchema>;

export interface SchemaCommandeClientDTO {
  clientId: string;
  clientNom: string;
  typeClientNom: string;
  zoneDepositaireId: string | null;
  zoneDepositaireNom: string | null;
  lignes: { produitId: string; produitNom: string; quantite: number }[];
  total: number;
}

/** Vue du Schéma pour une date : les clients déjà saisis + le total par produit (celui qui alimente le Planning). */
export interface SchemaCommandeJourDTO {
  date: string;
  clients: SchemaCommandeClientDTO[];
  totauxParProduit: { produitId: string; produitNom: string; quantite: number }[];
  totalGeneral: number;
}

// --- e) Bon de livraison ------------------------------------------------------

/**
 * Une ligne du Bon de livraison pour un Dépositaire donné : le détail livré
 * par produit (mêmes variantes que le Schéma), les bacs vides repris et les
 * observations relevées à la livraison. Volontairement indépendant du Schéma
 * de commande — aucune alimentation automatique dans un sens ni dans
 * l'autre, la quantité livrée pouvant différer de la quantité commandée.
 */
export const bonLivraisonLigneClientSchema = z.object({
  clientId: z.string().min(1),
  lignes: z
    .array(z.object({ produitId: z.string().min(1), quantite: nbBacs }))
    .max(20)
    .default([]),
  bacsVides: nbBacs.default(0),
  livrePar: z.string().trim().max(120).optional(),
  observations: z.string().trim().max(500).optional(),
});
export type BonLivraisonLigneClientInput = z.infer<typeof bonLivraisonLigneClientSchema>;

/** Remplace, pour une date donnée, l'ensemble des bons de livraison. */
export const bonLivraisonJourSchema = z.object({
  date: dateISOSchema,
  clients: z.array(bonLivraisonLigneClientSchema).max(200).default([]),
});
export type BonLivraisonJourInput = z.infer<typeof bonLivraisonJourSchema>;

export interface BonLivraisonClientDTO {
  clientId: string;
  clientNom: string;
  zoneDepositaireId: string | null;
  zoneDepositaireNom: string | null;
  lignes: { produitId: string; produitNom: string; quantite: number }[];
  bacsVides: number;
  livrePar: string | null;
  observations: string | null;
  total: number;
  /**
   * Total commandé (Schéma de commande, module Production) pour ce client à
   * cette même date — simple indice visuel en cas d'écart, aucun lien rigide
   * ni blocage entre les deux écrans, saisis volontairement indépendamment.
   */
  totalCommande: number;
}

/** Vue du Bon de livraison pour une date : un Dépositaire par ligne (tous les Dépositaires, saisis ou non). */
export interface BonLivraisonJourDTO {
  date: string;
  clients: BonLivraisonClientDTO[];
  totauxParProduit: { produitId: string; produitNom: string; quantite: number }[];
  totalGeneral: number;
  totalBacsVides: number;
}

// --- b + c) Production enregistrée -----------------------------------------

export const productionCreateSchema = z.object({
  bacsProduits: nbBacs,
  bacsLivresDepositaires: nbBacs.default(0),
  bacsLivresMamans: nbBacs.default(0),
  bacsVendusVC: nbBacs.default(0),
  bacsRestants: nbBacs.default(0),
  bacsFoutus: nbBacs.default(0),
  /** Bacs donnés, répartis par motif (Police, Baraka…). */
  dons: z
    .array(z.object({ motifDonId: z.string().min(1), nombreBacs: nbBacs }))
    .max(20)
    .default([]),
  kgFarineAbimes: quantiteIngredient.optional(),
  // Ingrédients utilisés — déclenchent la décrémentation du stock.
  sacsUtilises: quantiteIngredient.default(0),
  paquetsLevureUtilises: quantiteIngredient.default(0),
  kgSelUtilises: quantiteIngredient.default(0),
  quantiteHuileUtilisee: quantiteIngredient.default(0),
  observations: z.string().trim().max(2000).optional(),
});
export type ProductionCreateInput = z.infer<typeof productionCreateSchema>;

export interface MotifDonDTO {
  id: string;
  nom: string;
}

export interface ProductionDTO {
  id: string;
  numero: number;
  date: string;
  bacsProduits: number;
  bacsLivresDepositaires: number;
  bacsLivresMamans: number;
  bacsVendusVC: number;
  bacsRestants: number;
  bacsFoutus: number;
  dons: { motifDonId: string; motifNom: string; nombreBacs: number }[];
  totalDonnes: number;
  kgFarineAbimes: number | null;
  sacsUtilises: number;
  paquetsLevureUtilises: number;
  kgSelUtilises: number;
  quantiteHuileUtilisee: number;
  observations: string | null;
  enregistrePar: { id: string; nom: string } | null;
  /** Matières consommées par la décrémentation automatique. */
  consommations: { matiereNom: string; unite: string; quantite: number }[];
  /** Réconciliation : somme des destinations et écart vs bacs produits. */
  totalDestinations: number;
  ecartReconciliation: number;
}

/**
 * Réconciliation des bacs (section 3.3 b) : un écart est signalé mais
 * n'empêche JAMAIS l'enregistrement. Fonction partagée pour que le front
 * affiche l'avertissement avec exactement le même calcul que le back.
 */
export function totalDestinationsBacs(p: {
  bacsLivresDepositaires: number;
  bacsLivresMamans: number;
  bacsVendusVC: number;
  bacsRestants: number;
  bacsFoutus: number;
  dons: { nombreBacs: number }[];
}): number {
  return (
    p.bacsLivresDepositaires +
    p.bacsLivresMamans +
    p.bacsVendusVC +
    p.bacsRestants +
    p.bacsFoutus +
    p.dons.reduce((s, d) => s + d.nombreBacs, 0)
  );
}

// --- Écarts prévu / réalisé -------------------------------------------------

export interface LigneEcartDTO {
  cle: "bacs" | "sacsFarine" | "paquetsLevure" | "quantiteHuile" | "kgSel";
  prevu: number;
  realise: number;
  /** réalisé − prévu */
  ecart: number;
}

export interface EcartsProductionDTO {
  date: string;
  planning: PlanningProductionDTO | null;
  nbProductions: number;
  lignes: LigneEcartDTO[];
}


// ---------------------------------------------------------------------------
// Équipe & droits d'accès (section 3.7) — gestion des comptes
// ---------------------------------------------------------------------------

/** Jusqu'à 3 comptes Administrateur : 1 Principal + 2 secondaires (section 3.7). */
export const MAX_COMPTES_ADMIN = 3;
export const ROLE_ADMINISTRATEUR = "Administrateur";
export const ROLE_DIRECTEUR_GENERAL = "Directeur Général";

// Identifiant de connexion issu de Travailleurs (section 3.7, nouveau) : créer
// un compte ne se fait plus en saisissant un email librement — on sélectionne
// une fiche Travailleur dont l'email professionnel est actif (3.18). L'email
// du compte est celui de cette fiche, non modifiable à la création.
export const compteCreateSchema = z.object({
  travailleurId: z.string().min(1, "La fiche Travailleur est requise"),
  roleId: z.string().min(1, "L'équipe est requise"),
  // Mot de passe initial défini par l'Admin, changé ensuite par l'employé
  // depuis « Mon profil ».
  motDePasse: z.string().min(8, "Le mot de passe initial doit faire au moins 8 caractères").max(100),
});
export type CompteCreateInput = z.infer<typeof compteCreateSchema>;

// L'email n'est plus modifiable ici non plus : il resterait sinon possible de
// le désynchroniser de la fiche Travailleur dont il provient.
export const compteUpdateSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(120).optional(),
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
        prixUnitaire: z.number().finite("Le nombre doit être fini").int("Montant en Fc entier").min(0, "Le prix doit être positif"),
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
  return `${formatNombre(quantite, { maximumFractionDigits: 3 })} ${unite}`;
}

// ---------------------------------------------------------------------------
// Travailleurs (section 3.18)
// ---------------------------------------------------------------------------

export const travailleurCreateSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(120),
  telephone: z.string().trim().max(30).optional(),
  poste: z.string().trim().min(1, "Le poste est requis").max(80),
  dateEmbauche: dateISOSchema,
  // Lien optionnel vers un compte Utilisateur (si la personne a un accès à l'app).
  utilisateurId: z.string().optional(),
  // Départements & Groupes (3.18, nouveau) : obligatoire pour toute nouvelle
  // fiche — nullable en base uniquement pour ne pas casser les fiches
  // existantes créées avant cette fonctionnalité. Groupe reste optionnel.
  departementId: z.string().min(1, "Le département est requis"),
  groupeId: z.string().optional(),
  // Salaire & paie (3.18, nouveau) : obligatoires pour toute nouvelle fiche,
  // même raison que departementId. joursTravaillesParMois est individuel par
  // agent (26 jours, 13 jours…) — jamais une valeur fixe pour tous, sert de
  // diviseur du taux journalier dans le calcul de paie.
  salaireMensuel: z.number().finite("Le nombre doit être fini").int().positive("Le salaire doit être un montant positif"),
  joursTravaillesParMois: z.number().finite("Le nombre doit être fini").int().min(1, "Au moins 1 jour").max(31, "Au plus 31 jours"),
});
export type TravailleurCreateInput = z.infer<typeof travailleurCreateSchema>;

// Assistant de premier lancement (section 3.7, nouveau) — endpoints publics
// (aucune authentification possible tant qu'aucun compte n'existe), mais
// chaque appel revérifie côté serveur que la base est bien encore vide.
// Sous-ensemble volontairement minimal de travailleurCreateSchema : ne crée
// que la fiche du futur Admin Principal.
export const premierLancementTravailleurSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(120),
  telephone: z.string().trim().max(30).optional(),
  poste: z.string().trim().min(1, "Le poste est requis").max(80),
  dateEmbauche: dateISOSchema,
});
export type PremierLancementTravailleurInput = z.infer<typeof premierLancementTravailleurSchema>;

export const premierLancementFinaliserSchema = z.object({
  travailleurId: z.string().min(1, "La fiche Travailleur est requise"),
  motDePasse: z.string().min(8, "Le mot de passe initial doit faire au moins 8 caractères").max(100),
});
export type PremierLancementFinaliserInput = z.infer<typeof premierLancementFinaliserSchema>;

export const travailleurUpdateSchema = travailleurCreateSchema.partial().extend({
  // null = délier explicitement le compte.
  utilisateurId: z.string().nullable().optional(),
  // null = retirer explicitement le département/groupe (fiche existante sans
  // département, ou réaffectation). undefined = laisser intact.
  departementId: z.string().nullable().optional(),
  groupeId: z.string().nullable().optional(),
  // null = retirer explicitement (fiche revient à l'état "salaire non
  // renseigné" — le calcul de paie sera alors bloqué pour ce Travailleur).
  salaireMensuel: z.number().finite("Le nombre doit être fini").int().positive().nullable().optional(),
  joursTravaillesParMois: z.number().finite("Le nombre doit être fini").int().min(1).max(31).nullable().optional(),
});
export type TravailleurUpdateInput = z.infer<typeof travailleurUpdateSchema>;

// ---------------------------------------------------------------------------
// Départements & Groupes (section 3.18, nouveau) — purement organisationnel,
// aucune permission propre : géré via le module TRAVAILLEURS.
// ---------------------------------------------------------------------------

export const departementCreateSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(120),
  chefTravailleurId: z.string().optional(),
});
export type DepartementCreateInput = z.infer<typeof departementCreateSchema>;

export const departementUpdateSchema = departementCreateSchema.partial().extend({
  // null = retirer explicitement le chef désigné.
  chefTravailleurId: z.string().nullable().optional(),
});
export type DepartementUpdateInput = z.infer<typeof departementUpdateSchema>;

export const groupeCreateSchema = z.object({
  departementId: z.string().min(1, "Le département est requis"),
  nom: z.string().trim().min(1, "Le nom est requis").max(120),
});
export type GroupeCreateInput = z.infer<typeof groupeCreateSchema>;

export const groupeUpdateSchema = z.object({
  nom: z.string().trim().min(1, "Le nom est requis").max(120),
});
export type GroupeUpdateInput = z.infer<typeof groupeUpdateSchema>;

export interface GroupeDTO {
  id: string;
  departementId: string;
  nom: string;
  nombreTravailleurs: number;
}

export interface DepartementDTO {
  id: string;
  nom: string;
  chef: { id: string; nom: string } | null;
  groupes: GroupeDTO[];
  nombreTravailleurs: number;
}

// Adresse email professionnelle (section 3.18, nouveau) — Cloudflare Email
// Routing. La vérification finale (clic employé sur le lien reçu) est hors
// du contrôle de l'app : le statut "en attente" peut rester affiché un moment.
export const STATUTS_EMAIL_PRO = ["AUCUNE", "EN_ATTENTE_VERIFICATION", "ACTIF", "ECHEC"] as const;
export type StatutEmailPro = (typeof STATUTS_EMAIL_PRO)[number];

export const STATUT_EMAIL_PRO_LABELS: Record<StatutEmailPro, string> = {
  AUCUNE: "Aucune",
  EN_ATTENTE_VERIFICATION: "En attente de vérification",
  ACTIF: "Active",
  ECHEC: "Échec",
};

export const emailProCreerSchema = z.object({
  emailDestination: z.string().trim().email("Adresse email invalide").max(160),
});
export type EmailProCreerInput = z.infer<typeof emailProCreerSchema>;

// ---------------------------------------------------------------------------
// Pointage & Absence (section 3.18, remplace Presence) — horodatage réel
// d'entrée/sortie (gère les équipes de nuit à cheval sur deux jours) et
// absence en entité séparée (motif + décision), voir plus bas.
// ---------------------------------------------------------------------------

// Format ISO 8601 complet avec offset (ex. via Date.toISOString() côté
// client) — jamais un "datetime-local" brut sans fuseau, qui serait
// interprété différemment selon le fuseau du navigateur vs du serveur.
const horodatageISO = z.string().datetime({ message: "Horodatage invalide" });

export const pointageCreerSchema = z.object({
  travailleurId: z.string().min(1, "Le travailleur est requis"),
  horodatageEntree: horodatageISO,
  // Optionnel : un pointage peut être créé "ouvert" (personne encore en
  // poste) ou complet d'emblée (saisie a posteriori).
  horodatageSortie: horodatageISO.optional(),
});
export type PointageCreerInput = z.infer<typeof pointageCreerSchema>;

export const pointageModifierSchema = z.object({
  horodatageEntree: horodatageISO.optional(),
  // null = rouvrir le pointage (retire la sortie) ; string = clôturer/corriger.
  horodatageSortie: horodatageISO.nullable().optional(),
});
export type PointageModifierInput = z.infer<typeof pointageModifierSchema>;

export interface PointageDTO {
  id: string;
  travailleur: { id: string; nom: string; poste: string };
  horodatageEntree: string;
  horodatageSortie: string | null;
  enregistrePar: { id: string; nom: string } | null;
}

export const STATUTS_DECISION_ABSENCE = ["EN_ATTENTE", "JUSTIFIEE", "NON_JUSTIFIEE"] as const;
export type StatutDecisionAbsence = (typeof STATUTS_DECISION_ABSENCE)[number];

export const STATUT_DECISION_ABSENCE_LABELS: Record<StatutDecisionAbsence, string> = {
  EN_ATTENTE: "En attente",
  JUSTIFIEE: "Justifiée",
  NON_JUSTIFIEE: "Non justifiée",
};

// Déclaration initiale (motif) — le decisionStatut démarre toujours à
// EN_ATTENTE côté serveur, jamais choisi à la déclaration.
export const absenceDeclarerSchema = z.object({
  travailleurId: z.string().min(1, "Le travailleur est requis"),
  date: dateISOSchema,
  motif: z.string().trim().min(1, "Le motif est requis").max(500),
});
export type AbsenceDeclarerInput = z.infer<typeof absenceDeclarerSchema>;

// Décision — acte distinct de la déclaration (3.18) : jamais EN_ATTENTE ici,
// c'est l'état initial automatique, pas une décision qu'on choisit.
export const absenceDecisionSchema = z.object({
  decisionStatut: z.enum(["JUSTIFIEE", "NON_JUSTIFIEE"]),
});
export type AbsenceDecisionInput = z.infer<typeof absenceDecisionSchema>;

export interface AbsenceDTO {
  id: string;
  travailleur: { id: string; nom: string; poste: string };
  date: string;
  motif: string;
  declarePar: { id: string; nom: string } | null;
  decisionStatut: StatutDecisionAbsence;
  decidePar: { id: string; nom: string } | null;
  dateDecision: string | null;
  /** Rappel "absence en attente" (3.18, nouveau) : non-null dès que l'alerte est partie, jamais renvoyée. */
  alerteEnvoyeeLe: string | null;
}

/** Rappel « absence en attente » (3.18, nouveau) — même forme que AlerteDetteDTO (3.4). */
export interface AlerteAbsenceDTO {
  absenceId: string;
  travailleurNom: string;
  motif: string;
  date: string;
  /** Jours écoulés depuis la date de l'absence. */
  joursDepuis: number;
  alerteEnvoyeeLe: string | null;
}

export interface TravailleurDTO {
  id: string;
  nom: string;
  telephone: string | null;
  poste: string;
  dateEmbauche: string;
  compte: { id: string; nom: string; email: string } | null;
  emailDestination: string | null;
  emailProAdresse: string | null;
  emailProStatut: StatutEmailPro;
  /** Détail exploitable en cas d'échec (ex. jeton invalide, zone incorrecte) — jamais un échec silencieux. */
  emailProErreur: string | null;
  departement: { id: string; nom: string } | null;
  groupe: { id: string; nom: string } | null;
  salaireMensuel: number | null;
  joursTravaillesParMois: number | null;
}

// ---------------------------------------------------------------------------
// Sanction & calcul de paie (section 3.18, nouveau)
// ---------------------------------------------------------------------------

export const TYPES_SANCTION = ["PUNITION", "RETENUE"] as const;
export type TypeSanction = (typeof TYPES_SANCTION)[number];

export const TYPE_SANCTION_LABELS: Record<TypeSanction, string> = {
  PUNITION: "Punition",
  RETENUE: "Retenue",
};

// montant : requis pour une RETENUE (déduite de la paie), interdit pour une
// PUNITION (jamais financière) — cf. spec 3.18.
export const sanctionCreateSchema = z
  .object({
    travailleurId: z.string().min(1, "Le travailleur est requis"),
    type: z.enum(TYPES_SANCTION),
    motif: z.string().trim().min(1, "Le motif est requis").max(500),
    date: dateISOSchema,
    montant: z.number().finite("Le nombre doit être fini").int().positive().optional(),
  })
  .refine((d) => d.type !== "RETENUE" || d.montant !== undefined, {
    message: "Le montant est requis pour une retenue",
    path: ["montant"],
  })
  .refine((d) => d.type !== "PUNITION" || d.montant === undefined, {
    message: "Une punition n'a jamais de montant — c'est une retenue qu'il vous faut pour déduire un montant",
    path: ["montant"],
  });
export type SanctionCreerInput = z.infer<typeof sanctionCreateSchema>;

export interface SanctionDTO {
  id: string;
  travailleur: { id: string; nom: string; poste: string };
  type: TypeSanction;
  motif: string;
  montant: number | null;
  date: string;
  enregistrePar: { id: string; nom: string } | null;
}

/** "AAAA-MM" — mois calendaire, utilisé pour filtrer le calcul de paie. */
export const moisISO = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mois invalide (AAAA-MM)");

/**
 * Calcul de paie (3.18) : AUCUN arrondi intermédiaire — tauxJournalier et
 * retenueAbsences restent en précision complète (décimales) pour que la
 * somme des lignes affichées corresponde exactement au détail. Seul
 * salaireNet est arrondi (au Fc le plus proche), une fois, à la fin.
 */
export interface CalculPaieDTO {
  travailleurId: string;
  travailleurNom: string;
  mois: string;
  salaireMensuel: number;
  joursTravaillesParMois: number;
  tauxJournalier: number;
  absencesNonJustifiees: { absenceId: string; date: string; motif: string }[];
  retenueAbsences: number;
  sanctionsRetenues: { sanctionId: string; date: string; motif: string; montant: number }[];
  totalRetenuesDisciplinaires: number;
  salaireNet: number;
}

/**
 * Bulletin de paie (3.18, nouveau) : document PDF par Travailleur/mois,
 * généré à partir du calcul de paie. UNE FOIS ÉMIS, c'est un instantané
 * FIGÉ — jamais recalculé depuis Absence/Sanction après coup.
 */
export const bulletinPaieGenererSchema = z.object({ mois: moisISO });
export type BulletinPaieGenererInput = z.infer<typeof bulletinPaieGenererSchema>;

export interface BulletinPaieDTO {
  id: string;
  travailleur: { id: string; nom: string; poste: string };
  mois: string;
  salaireMensuel: number;
  joursTravaillesParMois: number;
  tauxJournalier: number;
  absencesNonJustifiees: { date: string; motif: string }[];
  retenueAbsences: number;
  sanctionsRetenues: { date: string; motif: string; montant: number }[];
  totalRetenuesDisciplinaires: number;
  salaireNet: number;
  generePar: { id: string; nom: string } | null;
  dateGeneration: string;
}

// ---------------------------------------------------------------------------
// Tableau de bord & rapports (section 3.8) — un DTO par widget, chaque widget
// étant conditionné à la lecture du module correspondant.
// ---------------------------------------------------------------------------

/**
 * Widget Caisse du tableau de bord (3.8) — depuis la refonte 3.1, il reflète le
 * REGISTRE journalier (entrées / dettes payées / dépenses / solde) et non plus
 * une somme de ventes, qui n'existent plus.
 */
export interface RapportCaisseDTO {
  /** Registre du jour. */
  entreesJour: number;
  dettesPayeesJour: number;
  depensesJour: number;
  soldeJour: number;
  /** Cumuls encaissés (entrées + dettes payées) − dépenses. */
  solde7Jours: number;
  solde30Jours: number;
  /** Solde par jour sur 30 jours, pour la courbe (dates AAAA-MM-JJ, en Fc). */
  serie30Jours: { date: string; total: number }[];
  /** Postes de dépense les plus lourds sur 30 jours. */
  principalesDepenses: { motif: string; total: number }[];
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
  dernieres: { numero: number; bacsProduits: number; date: string }[];
}

export interface RapportFournisseursDTO {
  totalRecu30Jours: number;
  enAttente: number;
  achatsRecents: { numero: number; fournisseurNom: string; statut: StatutCommandeFournisseur; total: number; date: string }[];
}

export interface RapportTravailleursDTO {
  attendus: number;
  /** Pointage horodaté actif aujourd'hui (entré aujourd'hui, ou équipe de nuit encore en poste). */
  presents: number;
  /** Absence déclarée pour aujourd'hui, quel que soit le statut de décision. */
  absents: number;
  nonPointes: number;
  /** Masse salariale (3.8, nouveau) : somme des salaireMensuel de tous les Travailleurs enregistrés. */
  masseSalariale: number;
}

/** Résumé de clôture quotidien (3.8) — DG uniquement via la matrice (RAPPORTS). */
export interface ResumeClotureDTO {
  date: string;
  /** Registre du jour (3.1) — remplace l'ancien CA issu des ventes. */
  entreesJour: number;
  dettesPayeesJour: number;
  depensesJour: number;
  soldeJour: number;
  nbCommandesJour: number;
  dettesEnCours: { nombre: number; total: number };
  alertesStock: { nom: string; unite: string; quantiteStock: number; seuilAlerte: number }[];
}

// ---------------------------------------------------------------------------
// À propos (section 3.12) & Rapports personnels (section 3.13)
// ---------------------------------------------------------------------------

export const NOM_APP = "Boulangerie Lomoto";
export const VERSION_APP = "0.1.0";
export const TAGLINE = "Pain Lia o Tonda";

/**
 * Crédit développeur (section 3.12) — affiché sur À propos et destiné au pied de
 * page des rapports exportés (l'export PDF arrivera dans un lot suivant).
 */
// ---------------------------------------------------------------------------
// Export & partage des rapports (section 3.13 — vaut aussi pour 3.8 et 3.11)
// ---------------------------------------------------------------------------

/**
 * Modèle de document commun à l'impression, au PDF et à l'email : une suite de
 * sections « titre + en-têtes + lignes ». C'est exactement la forme que l'export
 * CSV construit déjà côté écran, ce qui garantit que le PDF montre la même chose
 * que ce que l'utilisateur a sous les yeux — et évite de dupliquer, côté serveur,
 * les requêtes de chaque écran.
 */
export interface SectionDocument {
  titre: string;
  entetes: string[];
  lignes: (string | number)[][];
}

const sectionSchema = z.object({
  titre: z.string().max(200),
  entetes: z.array(z.string().max(120)).max(20),
  lignes: z.array(z.array(z.union([z.string().max(400), z.number().finite("Le nombre doit être fini")])).max(20)).max(2000),
});

export const documentExportSchema = z.object({
  titre: z.string().trim().min(1).max(200),
  sousTitre: z.string().trim().max(300).optional(),
  sections: z.array(sectionSchema).min(1).max(30),
  /**
   * Modules dont le document tire ses données. Le serveur exige la LECTURE sur
   * chacun avant de produire quoi que ce soit : un utilisateur sans accès à
   * Commissions ne peut pas en demander l'export. Vide pour les Rapports
   * personnels (3.13), accessibles à tous, dont la portée est déjà résolue
   * côté serveur.
   */
  modules: z.array(z.enum(MODULES)).max(MODULES.length).default([]),
});
export type DocumentExportInput = z.infer<typeof documentExportSchema>;

export const envoiEmailSchema = documentExportSchema.extend({
  destinataire: z.string().email("Adresse e-mail invalide").max(160),
  message: z.string().trim().max(2000).optional(),
});
export type EnvoiEmailInput = z.infer<typeof envoiEmailSchema>;

export const CREDIT_DEVELOPPEUR = {
  mention: "Application créée par Augustin Kayembe",
  telephone: "+243 980 240 000",
} as const;

/** Types d'action du journal d'activité personnel (3.13). */
export const TYPES_ACTIVITE = [
  "COMMANDE_CLIENT",
  "REGLEMENT",
  "DEPENSE_CAISSE",
  "PRODUCTION",
  "MOUVEMENT_STOCK",
  "COMMANDE_FOURNISSEUR",
  "RECEPTION_FOURNISSEUR",
  "POINTAGE",
  "ABSENCE",
] as const;
export type TypeActivite = (typeof TYPES_ACTIVITE)[number];

export const TYPE_ACTIVITE_LABELS: Record<TypeActivite, string> = {
  COMMANDE_CLIENT: "Commande client",
  REGLEMENT: "Règlement de dette",
  DEPENSE_CAISSE: "Dépense de caisse",
  PRODUCTION: "Production",
  MOUVEMENT_STOCK: "Mouvement de stock",
  COMMANDE_FOURNISSEUR: "Commande fournisseur",
  RECEPTION_FOURNISSEUR: "Réception fournisseur",
  POINTAGE: "Pointage",
  ABSENCE: "Décision d'absence",
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
// Paramètres de la boutique (section 3.9) — Administrateur uniquement
// ---------------------------------------------------------------------------

// Langue de l'interface (section 3.8) : 4 langues, sélecteur affichant le nom
// natif de chacune (Français/Lingala/English/Kiswahili).
export const LANGUES = ["FR", "LN", "EN", "SW"] as const;
export type Langue = (typeof LANGUES)[number];

export const LANGUE_LABELS: Record<Langue, string> = {
  FR: "Français",
  LN: "Lingala",
  EN: "English",
  SW: "Kiswahili",
};

export const LANGUE_DEFAUT_PAR_DEFAUT: Langue = "FR";

// Changement de sa propre langue d'interface (« Mon profil ») : une des langues
// ou null pour revenir à la langue par défaut de la boutique.
export const languePrefereeSchema = z.object({
  languePreferee: z.enum(LANGUES).nullable(),
});
export type LanguePrefereeInput = z.infer<typeof languePrefereeSchema>;

/** Langue effective : la préférence de l'utilisateur, sinon celle de la boutique. */
export function langueEffective(preferee: Langue | null, defautBoutique: Langue): Langue {
  return preferee ?? defautBoutique;
}

// Le seuil d'alerte transaction a été retiré avec l'alerte correspondante
// (refonte 3.1) : plus de notification de ce type, plus de réglage associé.
export const parametresBoutiqueSchema = z.object({
  boutiqueNom: z.string().trim().max(120).default(""),
  boutiqueAdresse: z.string().trim().max(300).default(""),
  boutiqueContact: z.string().trim().max(200).default(""),
  langueDefaut: z.enum(LANGUES),
});
export type ParametresBoutiqueInput = z.infer<typeof parametresBoutiqueSchema>;

export interface ParametresBoutiqueDTO {
  boutiqueNom: string;
  boutiqueAdresse: string;
  boutiqueContact: string;
  langueDefaut: Langue;
}

// ---------------------------------------------------------------------------
// À propos (section 3.12) — nom/adresse/contact partagés avec Paramètres
// (même magasin clé/valeur ParametreBoutique, jamais une copie séparée),
// plus présentation/horaires/réseaux sociaux, propres à cette page.
// ---------------------------------------------------------------------------

export interface ReseauSocial {
  plateforme: string;
  lien: string;
}

const reseauSocialSchema = z.object({
  plateforme: z.string().trim().min(1, "Le nom du réseau est requis").max(60),
  // Le lien est rendu tel quel en `href` sur la page À propos (accessible à
  // tous les rôles) : un schéma non http(s) (ex. javascript:) y exécuterait
  // du code au clic. On restreint donc explicitement le schéma accepté.
  lien: z
    .string()
    .trim()
    .min(1, "Le lien est requis")
    .max(300)
    .regex(/^https?:\/\//i, "Le lien doit commencer par http:// ou https://"),
});

export const aProposEditSchema = z.object({
  boutiqueNom: z.string().trim().max(120).default(""),
  boutiqueAdresse: z.string().trim().max(300).default(""),
  boutiqueContact: z.string().trim().max(200).default(""),
  presentation: z.string().trim().max(2000).default(""),
  horaires: z.string().trim().max(500).default(""),
  reseauxSociaux: z.array(reseauSocialSchema).max(20, "20 réseaux sociaux maximum").default([]),
});
export type AProposEditInput = z.infer<typeof aProposEditSchema>;

export interface AProposDTO {
  boutiqueNom: string;
  boutiqueAdresse: string;
  boutiqueContact: string;
  presentation: string;
  horaires: string;
  reseauxSociaux: ReseauSocial[];
}

// ---------------------------------------------------------------------------
// Phase 10 — Activation (3.14), État système (3.15), Approbations (3.16),
// Délégation temporaire (3.7)
// ---------------------------------------------------------------------------

export const activationSchema = z.object({ actif: z.boolean() });
export type ActivationInput = z.infer<typeof activationSchema>;

// Modification des permissions d'un rôle (tâche critique). Liste complète des
// entrées module→niveau qui REMPLACE la matrice du rôle.
export const rolePermissionsSchema = z.object({
  permissions: z
    .array(z.object({ module: z.enum(MODULES), niveauAcces: z.enum(NIVEAUX_ACCES) }))
    .max(MODULES.length),
});
export type RolePermissionsInput = z.infer<typeof rolePermissionsSchema>;

export const STATUTS_DEMANDE = ["EN_ATTENTE", "APPROUVEE", "REJETEE"] as const;
export type StatutDemande = (typeof STATUTS_DEMANDE)[number];

export const STATUT_DEMANDE_LABELS: Record<StatutDemande, string> = {
  EN_ATTENTE: "En attente",
  APPROUVEE: "Approuvée",
  REJETEE: "Rejetée",
};

export const TYPES_ACTION_CRITIQUE = [
  "SUPPRIMER_UTILISATEUR",
  "CREER_COMPTE_ADMIN",
  "MODIFIER_TYPE_CLIENT",
  "MODIFIER_TAUX_TAXE",
  "MODIFIER_PERMISSIONS_ROLE",
] as const;
export type TypeActionCritique = (typeof TYPES_ACTION_CRITIQUE)[number];

export const TYPE_ACTION_CRITIQUE_LABELS: Record<TypeActionCritique, string> = {
  SUPPRIMER_UTILISATEUR: "Supprimer un utilisateur",
  CREER_COMPTE_ADMIN: "Créer un compte Administrateur",
  MODIFIER_TYPE_CLIENT: "Modifier une qualité (prix / commission)",
  MODIFIER_TAUX_TAXE: "Modifier le taux de taxe d'un produit",
  MODIFIER_PERMISSIONS_ROLE: "Modifier les permissions d'un rôle",
};

export interface DemandeApprobationDTO {
  id: string;
  type: TypeActionCritique;
  resume: string;
  statut: StatutDemande;
  demandePar: { id: string; nom: string } | null;
  approuvePar: { id: string; nom: string } | null;
  erreur: string | null;
  dateDemande: string;
  dateDecision: string | null;
}

/**
 * Réponse d'une action critique : soit exécutée directement (Admin Principal),
 * soit différée en demande d'approbation (Admin secondaire).
 */
export interface ResultatActionCritique {
  statut: "execute" | "en_attente_approbation";
  message: string;
}

export const delegationCreateSchema = z
  .object({
    utilisateurId: z.string().min(1, "L'utilisateur est requis"),
    module: z.enum(MODULES),
    dateDebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date de début invalide (AAAA-MM-JJ)"),
    dateFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date de fin invalide (AAAA-MM-JJ)"),
  })
  .refine((d) => d.dateFin >= d.dateDebut, {
    message: "La date de fin doit être postérieure ou égale à la date de début",
    path: ["dateFin"],
  });
export type DelegationCreateInput = z.infer<typeof delegationCreateSchema>;

export interface DelegationDTO {
  id: string;
  utilisateur: { id: string; nom: string; roleNom: string };
  module: Module;
  dateDebut: string;
  dateFin: string;
  active: boolean;
  creePar: { id: string; nom: string } | null;
}

export const TYPES_SAUVEGARDE = ["AUTOMATIQUE", "MANUELLE"] as const;
export type TypeSauvegarde = (typeof TYPES_SAUVEGARDE)[number];

export const STATUTS_SAUVEGARDE = ["SUCCES", "ECHEC"] as const;
export type StatutSauvegarde = (typeof STATUTS_SAUVEGARDE)[number];

export interface SauvegardeDTO {
  id: string;
  type: TypeSauvegarde;
  statut: StatutSauvegarde;
  tailleOctets: number | null;
  nomFichier: string | null;
  destination: string | null;
  erreur: string | null;
  dureeMs: number | null;
  declencheParNom: string | null;
  date: string;
}

export interface EtatSystemeDTO {
  nomApplication: string;
  version: string;
  /**
   * Licence : aucun système de licence n'existe encore (section 3.15) — il
   * viendra avec la version White label. Le champ dit « non configuré » plutôt
   * que d'afficher une licence factice.
   */
  licence: { configuree: false };
  /**
   * Base de données : hôte, port et nom SEULEMENT. Jamais l'utilisateur, jamais
   * le mot de passe, jamais l'URL complète (section 3.15).
   */
  baseDeDonnees: {
    connectee: boolean;
    latenceMs: number | null;
    hote: string | null;
    port: number | null;
    base: string | null;
  };
  utilisateursActifs: number;
  sauvegardes: {
    /** Dernière tentative, réussie ou non — un échec est ce qu'il faut voir. */
    derniere: SauvegardeDTO | null;
    /** Dernière tentative RÉUSSIE : c'est elle qui dit jusqu'où on est protégé. */
    dernierSucces: SauvegardeDTO | null;
    prochainePrevue: string | null;
    planificationActive: boolean;
    expressionCron: string;
    fuseau: string;
    /**
     * Répertoire de stockage local des sauvegardes automatiques. Ce disque
     * n'est pas garanti persistant selon l'hébergeur (ex. redéploiement sur
     * Render) — d'où le rappel, côté écran, de copier régulièrement vers un
     * support externe.
     */
    repertoireLocal: string;
    /** Nombre de sauvegardes locales conservées avant purge des plus anciennes. */
    retentionLocale: number;
    /** pg_dump présent sur l'hôte ? Sans lui, aucune sauvegarde n'est possible. */
    outilDisponible: boolean;
    outilVersion: string | null;
    historique: SauvegardeDTO[];
  };
  /**
   * Assistant IA (section 3.19) : l'Assistant repasse temporairement en mode
   * humain seul tant que la facturation Google Cloud n'est pas réglée. La
   * couche Gemini reste codée (lib/ia.ts côté API) — ce booléen reflète juste
   * la variable d'environnement ASSISTANT_IA_ACTIF.
   */
  assistantIaActif: boolean;
  horodatage: string;
}

// ---------------------------------------------------------------------------
// Réinitialisation de la base (section 3.15, nouveau) — Admin Principal
// uniquement, irréversible. Confirmation par saisie exacte d'un mot plutôt
// qu'un simple clic.
// ---------------------------------------------------------------------------

export const MOT_CONFIRMATION_REINITIALISATION = "LOMOTO";

export const reinitialisationSchema = z.object({
  motConfirmation: z.string().refine((v) => v === MOT_CONFIRMATION_REINITIALISATION, {
    message: `Tapez exactement « ${MOT_CONFIRMATION_REINITIALISATION} » pour confirmer`,
  }),
  raison: z.string().trim().max(500).optional(),
});
export type ReinitialisationInput = z.infer<typeof reinitialisationSchema>;

// ---------------------------------------------------------------------------
// Phase 11 — Journal d'audit (section 3.17)
// ---------------------------------------------------------------------------

// Uniquement les actions RÉUSSIES de modification/suppression (les créations sont
// déjà tracées via créePar/enregistrePar ; les 403 ne sont pas journalisés).
export const ACTIONS_AUDIT = ["MODIFICATION", "SUPPRESSION"] as const;
export type ActionAudit = (typeof ACTIONS_AUDIT)[number];

export const ACTION_AUDIT_LABELS: Record<ActionAudit, string> = {
  MODIFICATION: "Modification",
  SUPPRESSION: "Suppression",
};

/** Libellés lisibles des types d'entité (modèles) journalisés. */
export const TYPE_ENTITE_LABELS: Record<string, string> = {
  Utilisateur: "Compte utilisateur",
  Role: "Rôle",
  RolePermission: "Permission de rôle",
  DemandeApprobation: "Demande d'approbation",
  DelegationRole: "Délégation de rôle",
  Produit: "Produit",
  TypeClient: "Qualité (type de client)",
  ParametreBoutique: "Paramètre de la boutique",
  Client: "Client",
  CommandeClient: "Commande client",
  PaiementCommande: "Règlement de commande",
  TauxDuJour: "Taux du jour",
  DepenseCaisse: "Dépense de caisse",
  MatierePremiere: "Matière première",
  MouvementStock: "Mouvement de stock",
  PlanningProduction: "Planning de production",
  PlanningLigneProduit: "Ligne de planning (produit)",
  Production: "Production",
  ProductionDon: "Don de bacs",
  MotifDon: "Motif de don",
  Fournisseur: "Fournisseur",
  CommandeFournisseur: "Commande fournisseur",
  LigneCommandeFournisseur: "Ligne de commande fournisseur",
  Travailleur: "Travailleur",
  Presence: "Pointage",
};

export interface AuditLogDTO {
  id: string;
  utilisateur: { id: string | null; nom: string };
  module: Module;
  typeEntite: string;
  entiteId: string;
  action: ActionAudit;
  /** Instantanés des champs scalaires (secrets expurgés). */
  avant: Record<string, unknown> | null;
  apres: Record<string, unknown> | null;
  date: string;
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

/** Séparateur de milliers de l'application (section 3.8) : le point. */
export const SEPARATEUR_MILLIERS = ".";

/**
 * Formateur de nombres CENTRAL — tout affichage numérique passe par ici, pour
 * que le séparateur de milliers reste homogène dans toute l'application.
 * On part du format français (virgule décimale) et on remplace explicitement le
 * séparateur de groupes par un point : plus robuste qu'un `replace` sur la
 * chaîne finale, l'espace utilisé par `fr-FR` variant selon les versions d'ICU.
 */
export function formatNombre(valeur: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat("fr-FR", options)
    .formatToParts(valeur)
    .map((p) => (p.type === "group" ? SEPARATEUR_MILLIERS : p.value))
    .join("");
}

/** Formate un montant en Franc Congolais : 4100 -> "4.100 Fc" */
export function formatFc(montant: number): string {
  return `${formatNombre(montant)} Fc`;
}

/**
 * Taille de fichier lisible (section 3.15, sauvegardes) : 109887 -> "107,3 Ko".
 * Passe par formatNombre pour garder le séparateur décimal de l'application.
 */
export function formatOctets(octets: number): string {
  if (octets < 1024) return `${formatNombre(octets)} o`;
  const unites = ["Ko", "Mo", "Go", "To"];
  let valeur = octets / 1024;
  let i = 0;
  while (valeur >= 1024 && i < unites.length - 1) {
    valeur /= 1024;
    i++;
  }
  return `${formatNombre(valeur, { maximumFractionDigits: 1 })} ${unites[i]}`;
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

// ---------------------------------------------------------------------------
// Assistant (section 3.19) — messagerie humaine directe utilisateur ↔ Admin.
// ---------------------------------------------------------------------------

export const STATUTS_CONVERSATION_SUPPORT = ["OUVERTE", "FERMEE"] as const;
export type StatutConversationSupport = (typeof STATUTS_CONVERSATION_SUPPORT)[number];

// "IA" (section 3.19, premier niveau) : réponse automatique tant que la
// conversation n'est pas escaladée. Le champ en base (MessageSupport.auteurType)
// reste une simple chaîne, ce qui a permis d'ajouter cette valeur sans migration.
export const AUTEUR_TYPES_SUPPORT = ["UTILISATEUR", "ADMIN", "IA"] as const;
export type AuteurTypeSupport = (typeof AUTEUR_TYPES_SUPPORT)[number];

export interface MessageSupportDTO {
  id: string;
  conversationId: string;
  auteurType: string;
  // null pour un message IA (pas d'auteur humain).
  auteur: { id: string; nom: string } | null;
  contenu: string | null;
  captureEcran: string | null;
  dateCreation: string;
}

export interface ConversationSupportDTO {
  id: string;
  utilisateur: { id: string; nom: string; roleNom: string };
  statut: StatutConversationSupport;
  // true dès que l'utilisateur (ou l'IA elle-même en cas d'échec, voir
  // apps/api/src/lib/ia.ts) a demandé un humain : l'IA ne répond plus sur ce
  // cycle, seul un Admin peut désormais écrire.
  escaladee: boolean;
  dateFermeture: string | null;
  fermeePar: { id: string; nom: string } | null;
  createdAt: string;
  updatedAt: string;
  messages: MessageSupportDTO[];
}

// Limite volontairement généreuse mais bornée (3.19 : stockage direct en base,
// pas de fichier) — ~2,9 Mo une fois décodée. Le corps JSON global (voir
// apps/api/src/app.ts) est dimensionné en conséquence.
export const TAILLE_MAX_CAPTURE_BASE64 = 4_000_000;

export const envoyerMessageSupportSchema = z
  .object({
    contenu: z.string().trim().max(4000, "Message trop long").optional(),
    captureEcran: z
      .string()
      .max(TAILLE_MAX_CAPTURE_BASE64, "La capture d'écran est trop volumineuse")
      .optional(),
  })
  .refine((d) => !!d.contenu?.trim() || !!d.captureEcran, {
    message: "Le message doit contenir du texte ou une capture d'écran",
  });
export type EnvoyerMessageSupportInput = z.infer<typeof envoyerMessageSupportSchema>;
