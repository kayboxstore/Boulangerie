import { Prisma } from "@prisma/client";
import type { Sexe } from "@lomoto/shared";
import type { prisma as prismaApp, TxClient } from "../lib/prisma.js";
import { contexteRequete } from "../lib/contexteRequete.js";
import { ErreurAction } from "../lib/erreurAction.js";
import {
  approuverEtExecuterDemandeAtomique,
  type CrochetsTestApprobationAtomique,
  type IdentiteDecideur,
} from "./demandeApprobation.js";

/**
 * Exécution « tx-aware » des 4 tâches critiques SUPPRIMER_UTILISATEUR,
 * CREER_COMPTE_ADMIN, MODIFIER_TYPE_CLIENT, MODIFIER_TAUX_TAXE (mission P1
 * « atomicité exécution métier + décision », 25/08/2026).
 *
 * P1 corrigé ici (documenté dans `permissionsRoleAudit.ts` depuis le Round 2
 * comme non traité pour ces 4 types) : jusqu'ici, l'approbation d'une
 * demande de ce type (`routes/approbations.ts`) lisait le statut
 * `EN_ATTENTE`, exécutait l'action métier via `EXECUTEURS` (chaque exécuteur
 * ouvrant sa propre transaction indépendante, voire aucune transaction du
 * tout), PUIS transitionnait la demande vers `APPROUVEE` séparément — trois
 * étapes non atomiques entre elles. Une décision de rejet concurrente pouvait
 * gagner la transition finale APRÈS que l'action métier ait RÉELLEMENT été
 * exécutée (compte supprimé, compte Administrateur créé…), laissant une
 * demande `REJETEE` correspondant pourtant à une action bel et bien
 * appliquée — incohérence désormais rendue impossible.
 *
 * Mécanisme (identique dans son principe à
 * `permissionsRoleAudit.ts`/`appliquerModificationPermissionsRoleTx`, et
 * réutilisant directement le mécanisme générique introduit par PR #31 dans
 * `demandeApprobation.ts`) :
 *  - Chacune des 4 fonctions ci-dessous (`supprimerUtilisateurTx`,
 *    `creerCompteAdminTx`, `modifierTypeClientTx`, `modifierTauxTaxeTx`) est
 *    une fonction INTERNE acceptant un client transactionnel DÉJÀ OUVERT
 *    (`TxClient`) — elle n'ouvre jamais elle-même de transaction (aucune
 *    transaction imbriquée).
 *  - `approuverEtExecuterActionMetier` (approbation) délègue à
 *    `approuverEtExecuterDemandeAtomique` (`demandeApprobation.ts`) : la
 *    réservation conditionnelle de la demande (`WHERE statut =
 *    'EN_ATTENTE'`), le dispatch vers la bonne fonction tx-aware selon le
 *    type, et la transition finale vers `APPROUVEE` sont ainsi, ENSEMBLE,
 *    dans une seule transaction PostgreSQL Serializable, avec le même
 *    réessai borné sur P2034 (409 honnête si une autre décision a
 *    réellement gagné, 503 réessayable si le conflit est réel mais que
 *    personne n'a encore gagné).
 *  - `supprimerUtilisateurDirect`, `creerCompteAdminDirect`,
 *    `modifierTypeClientDirect`, `modifierTauxTaxeDirect` (exécution
 *    DIRECTE par l'Admin Principal, sans workflow d'approbation) ouvrent
 *    chacune leur propre transaction Serializable et délèguent tout le
 *    travail à la même fonction tx-aware — donc le chemin direct et le
 *    chemin d'approbation exécutent EXACTEMENT le même code métier.
 *
 * Piste d'audit — piège évité : l'extension Prisma générale d'audit
 * (`lib/audit.ts`) intercepte `update`/`delete` SINGULIERS, mais lit l'état
 * « avant » et écrit le journal via le client de BASE non étendu — PAS via
 * le client transactionnel `tx` — même quand l'opération interceptée a lieu
 * DANS un `$transaction`. Utiliser `tx.utilisateur.delete(...)` (ou
 * `tx.typeClient.update(...)`, `tx.produit.update(...)`) à l'intérieur d'une
 * des fonctions ci-dessous romprait donc l'atomicité que cette mission exige
 * : l'écriture d'audit commiterait IMMÉDIATEMENT sur une connexion séparée,
 * indépendamment du sort de la transaction englobante — un rollback (P2034,
 * échec métier plus loin dans la même transaction) laisserait alors une
 * ligne AuditLog mensongère (« ceci a été supprimé/modifié ») alors que
 * l'écriture réelle, elle, a bien été annulée. C'est précisément le défaut
 * que `permissionsRoleAudit.ts` documente avoir déjà corrigé pour
 * `RolePermission` (Round 1) en utilisant `upsert`/`deleteMany` (jamais
 * interceptés) plus une écriture MANUELLE de `tx.auditLog.create` — même
 * principe repris ici, systématiquement : toutes les écritures métier
 * ci-dessous utilisent `updateMany`/`deleteMany`/`create` (jamais `update`ou
 * `delete` singuliers sur un modèle audité), et la traçabilité équivalente à
 * celle que l'extension aurait produite est écrite manuellement via
 * `tx.auditLog.create` — donc transactionnellement sûre, annulée avec le
 * reste en cas de rollback.
 */

export const ROLE_ADMINISTRATEUR = "Administrateur";
export const MAX_COMPTES_ADMIN = 3;

type Donnees = Record<string, unknown>;

/**
 * Levée quand une des 4 actions ci-dessous s'exécute hors contexte de
 * requête authentifiée (`contexteRequete` vide) — même garde que
 * `permissionsRoleAudit.ts`/`ErreurActeurRequisPourAudit`, dupliquée
 * localement plutôt que partagée pour ne pas élargir la surface exportée de
 * `permissionsRoleAudit.ts` à quelque chose qui n'est plus spécifique aux
 * permissions de rôle.
 */
export class ErreurActeurRequisPourAudit extends Error {
  constructor() {
    super(
      "Action refusée : aucun acteur authentifié dans le contexte de requête — impossible de produire une piste " +
        "d'audit fiable pour cette action critique.",
    );
  }
}

/**
 * Levée quand l'exécution DIRECTE (Admin Principal, hors workflow
 * d'approbation) d'une des 4 actions ci-dessous épuise ses tentatives de
 * réessai sur un conflit de sérialisation PostgreSQL (P2034) persistant —
 * correctif P2 (Round 2, contre-revue Codex du 25/08/2026). Contrairement au
 * chemin d'approbation (`ErreurApprobationConcurrente`/
 * `ErreurConflitApprobationReessayable`, `demandeApprobation.ts`), il
 * n'existe ici aucune `DemandeApprobation` dont l'état pourrait distinguer
 * « quelqu'un d'autre a déjà gagné » d'un « conflit réel mais personne n'a
 * gagné » — l'exécution directe ne réserve rien, chaque tentative rejoue
 * simplement la MÊME action métier dans une TOUTE NOUVELLE transaction. Un
 * P2034 persistant ici signifie donc toujours une contention réelle et
 * temporaire (ex. deux actions directes concurrentes sur la même ressource,
 * ou une action directe et une approbation concurrentes) — jamais une
 * décision déjà prise par quelqu'un d'autre. Mappée en 503 (réessayable) par
 * l'appelant HTTP (`traiterActionCritique`, `actionsCritiques.ts`) — jamais
 * un 500 brut, jamais une affirmation de succès ou de conflit déjà décidé.
 */
export class ErreurExecutionDirecteReessayable extends Error {
  constructor() {
    super(
      "Conflit de sérialisation PostgreSQL persistant après plusieurs tentatives — réessayez.",
    );
  }
}

const NB_TENTATIVES_MAX_P2034_DIRECT = 3;

/**
 * Ouvre une TOUTE NOUVELLE transaction Serializable à chaque tentative (une
 * transaction avortée par PostgreSQL ne peut pas être « reprise » — voir
 * `demandeApprobation.ts`, même principe) et réessaie un P2034 jusqu'à
 * `NB_TENTATIVES_MAX_P2034_DIRECT` fois — utilisée par les 4 wrappers
 * `*Direct` ci-dessous, qui n'ouvraient jusqu'ici leur transaction
 * Serializable qu'une seule fois : un P2034 y remontait donc en erreur
 * Prisma brute (500 via le handler générique Express) plutôt qu'en 503
 * honnête, alors même que le chemin d'approbation des mêmes 4 types
 * bénéficiait déjà de ce réessai via `approuverEtExecuterDemandeAtomique`.
 */
async function executerDirectAvecReessaiP2034<T>(
  db: typeof prismaApp,
  executer: (tx: TxClient) => Promise<T>,
): Promise<T> {
  for (let tentative = 1; tentative <= NB_TENTATIVES_MAX_P2034_DIRECT; tentative++) {
    try {
      return await db.$transaction(executer, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (e) {
      const estP2034 = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";
      if (!estP2034) throw e;
      if (tentative < NB_TENTATIVES_MAX_P2034_DIRECT) continue;
      throw new ErreurExecutionDirecteReessayable();
    }
  }
  // Inatteignable : la boucle retourne ou lève à chaque itération, et
  // `NB_TENTATIVES_MAX_P2034_DIRECT >= 1`. Présent uniquement pour satisfaire
  // le vérificateur de type.
  throw new ErreurExecutionDirecteReessayable();
}

const CLE_SENSIBLE = /hash|motdepasse|password|secret|token/i;

/**
 * Rend un enregistrement Prisma sérialisable et sûr pour l'audit (Decimal →
 * nombre/chaîne, Date → ISO, secrets expurgés) — même logique que
 * `normaliser()` dans `lib/audit.ts` (fonction privée, non exportée, donc
 * reproduite ici à l'identique plutôt que dupliquée par une dépendance
 * fragile sur un détail d'implémentation interne d'un autre module).
 */
function normaliserPourAudit(valeur: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(valeur, (_cle, v) => (typeof v === "bigint" ? v.toString() : v));
  const obj = JSON.parse(json) as Record<string, unknown>;
  const propre: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (CLE_SENSIBLE.test(k)) continue;
    if (v !== null && typeof v === "object") continue;
    propre[k] = v;
  }
  return propre;
}

/**
 * Écrit UNE ligne `AuditLog`, manuellement et DANS la transaction (`tx`) —
 * jamais via le client de base (voir l'en-tête du fichier). Exige un acteur
 * authentifié (voir `ErreurActeurRequisPourAudit`) : en production, ces 4
 * actions ne s'exécutent jamais hors d'une requête authentifiée
 * (`requireAuth` peuple `contexteRequete` avant que la route n'atteigne ce
 * code) ; les scripts de vérification doivent explicitement envelopper leurs
 * appels dans `contexteRequete.run(...)`, comme déjà pratiqué par
 * `scripts/verifier-audit-permissions-role-ci.ts`.
 */
async function auditerTx(
  tx: TxClient,
  params: {
    module: Prisma.AuditLogCreateInput["module"];
    typeEntite: string;
    entiteId: string;
    action: "MODIFICATION" | "SUPPRESSION";
    avant: Record<string, unknown>;
    apres: Record<string, unknown> | null;
  },
): Promise<void> {
  const acteur = contexteRequete.getStore();
  if (!acteur) throw new ErreurActeurRequisPourAudit();
  await tx.auditLog.create({
    data: {
      utilisateurId: acteur.id,
      utilisateurNom: acteur.nom,
      module: params.module,
      typeEntite: params.typeEntite,
      entiteId: params.entiteId,
      action: params.action,
      avant: normaliserPourAudit(params.avant) as unknown as Prisma.InputJsonValue,
      apres: params.apres ? (normaliserPourAudit(params.apres) as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
}

// ---------------------------------------------------------------------------
// SUPPRIMER_UTILISATEUR
// ---------------------------------------------------------------------------

export async function supprimerUtilisateurTx(tx: TxClient, utilisateurId: string): Promise<{ message: string }> {
  const compte = await tx.utilisateur.findUnique({ where: { id: utilisateurId } });
  if (!compte) throw new ErreurAction(404, "Compte introuvable");
  if (compte.estAdminPrincipal) {
    throw new ErreurAction(409, "Transférez d'abord le statut d'Administrateur principal");
  }
  try {
    // `deleteMany` (jamais `delete` singulier) : voir l'en-tête du fichier —
    // évite le piège de l'audit automatique non transactionnel. `count` est
    // vérifié par défense ; il ne peut être différent de 1 que si la ligne a
    // disparu entre le `findUnique` ci-dessus et cette écriture, impossible
    // au sein de la MÊME transaction (verrouillage de ligne PostgreSQL).
    const { count } = await tx.utilisateur.deleteMany({ where: { id: compte.id } });
    if (count !== 1) throw new ErreurAction(404, "Compte introuvable");
  } catch (e) {
    if (e instanceof ErreurAction) throw e;
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
      throw new ErreurAction(409, "Suppression impossible : ce compte a de l'activité enregistrée (ventes, commandes…).");
    }
    throw e;
  }
  await auditerTx(tx, {
    module: "EQUIPE",
    typeEntite: "Utilisateur",
    entiteId: compte.id,
    action: "SUPPRESSION",
    avant: compte,
    apres: null,
  });
  return { message: `Compte « ${compte.nom} » supprimé` };
}

export async function supprimerUtilisateurDirect(db: typeof prismaApp, utilisateurId: string): Promise<{ message: string }> {
  return executerDirectAvecReessaiP2034(db, (tx) => supprimerUtilisateurTx(tx, utilisateurId));
}

// ---------------------------------------------------------------------------
// CREER_COMPTE_ADMIN
// ---------------------------------------------------------------------------

export interface DonneesCreerCompteAdmin {
  nom: string;
  email: string;
  roleId: string;
  motDePasseHash: string;
  travailleurId?: string | null;
  sexe?: Sexe | null;
  photoUrl?: string | null;
}

export interface RattachementTravailleurAttendu {
  travailleurId: string;
  compteId: string;
  /** Email professionnel figé au moment où le rattachement a été décidé (soumission de la demande, ou requête directe) — doit encore correspondre EXACTEMENT à celui de la fiche au moment de l'écriture. */
  emailAttendu: string;
}

/**
 * Rattache un Travailleur à un compte Utilisateur nouvellement créé — par une
 * écriture CONDITIONNELLE (`updateMany` avec l'état attendu dans son
 * `where`), jamais un `update` inconditionnel — correctif P1 (Round 2,
 * contre-revue Codex du 25/08/2026) : l'ancienne version
 * (`where: { id: travailleurId }` seul) permettait à une demande
 * `CREER_COMPTE_ADMIN` devenue obsolète d'écraser SILENCIEUSEMENT un
 * rattachement plus récent fait entre-temps par un autre chemin (l'API
 * Travailleurs, ou une autre création de compte) — scénario : demande créée
 * pour un Travailleur encore libre → ce Travailleur est légitimement
 * rattaché à un autre compte via `PUT /api/travailleurs/:id` → l'ancienne
 * demande est approuvée → l'ancien code remplaçait `utilisateurId` sans
 * condition, laissant potentiellement l'autre compte orphelin.
 *
 * Utilisée par `creerCompteAdminTx` (chemin `CREER_COMPTE_ADMIN`, direct et
 * approbation) ET par la création directe d'un compte NON-Administrateur
 * (`routes/equipe.ts`, `POST /api/equipe`) — les deux chemins qui créent un
 * `Utilisateur` puis l'attachent à une fiche `Travailleur` déjà existante
 * partagent donc EXACTEMENT la même garantie, plutôt que de dupliquer (et
 * risquer de faire diverger) la même logique de garde.
 *
 * La garantie porte sur l'écriture elle-même (`where`), pas seulement sur la
 * prélecture qui précède (qui ne sert qu'à produire un message d'erreur
 * clair) : `count !== 1` après l'`updateMany` signifie que l'état a changé
 * entre la prélecture et cette écriture, DANS LA MÊME transaction — sous
 * Serializable, soit PostgreSQL a bloqué cette transaction sur le verrou de
 * la ligne (puis son `WHERE` ne matche plus une fois débloquée → `count = 0`
 * → 409 propre), soit il l'abandonne avec un P2034 si la ligne a déjà été
 * committée par une autre transaction depuis l'ouverture de la nôtre
 * (rattrapé par le réessai borné de l'appelant, qui rejouera alors la
 * prélecture avec l'état RÉELLEMENT à jour). Dans tous les cas, jamais
 * d'écrasement silencieux.
 */
export async function rattacherTravailleurAuNouveauCompteTx(
  tx: TxClient,
  { travailleurId, compteId, emailAttendu }: RattachementTravailleurAttendu,
): Promise<void> {
  const travailleurAvant = await tx.travailleur.findUnique({ where: { id: travailleurId } });
  if (!travailleurAvant) throw new ErreurAction(404, "Fiche Travailleur introuvable");
  if (travailleurAvant.utilisateurId !== null) {
    throw new ErreurAction(409, "Rattachement impossible : cette fiche a déjà été liée à un autre compte entre-temps — réessayez.");
  }
  if (travailleurAvant.emailProStatut !== "ACTIF" || travailleurAvant.emailProAdresse !== emailAttendu) {
    throw new ErreurAction(
      409,
      "Rattachement impossible : l'adresse professionnelle de cette fiche a changé entre-temps — réessayez.",
    );
  }
  const { count } = await tx.travailleur.updateMany({
    where: { id: travailleurId, utilisateurId: null, emailProStatut: "ACTIF", emailProAdresse: emailAttendu },
    data: { utilisateurId: compteId },
  });
  if (count !== 1) {
    throw new ErreurAction(
      409,
      "Rattachement impossible : la fiche Travailleur a été modifiée entre-temps (déjà liée à un autre compte, ou son adresse professionnelle a changé) — réessayez.",
    );
  }
  const travailleurApres = await tx.travailleur.findUniqueOrThrow({ where: { id: travailleurId } });
  await auditerTx(tx, {
    module: "TRAVAILLEURS",
    typeEntite: "Travailleur",
    entiteId: travailleurId,
    action: "MODIFICATION",
    avant: travailleurAvant,
    apres: travailleurApres,
  });
}

export async function creerCompteAdminTx(tx: TxClient, donnees: DonneesCreerCompteAdmin): Promise<{ message: string }> {
  const { nom, email, roleId, motDePasseHash, travailleurId, sexe, photoUrl } = donnees;

  const existant = await tx.utilisateur.findUnique({ where: { email } });
  if (existant) throw new ErreurAction(409, "Un compte utilise déjà cette adresse e-mail");

  // Correctif P1 (Round 2, contre-revue Codex du 25/08/2026) : une demande
  // d'approbation différée fige `roleId` à la soumission — si le rôle visé a
  // depuis été renommé (n'est plus « Administrateur »), le rejouer telle
  // quelle créerait un compte hors de la logique métier CREER_COMPTE_ADMIN
  // (quota, notifications…) sans que rien ne le signale. Revérifié DANS la
  // transaction, avant toute écriture.
  const role = await tx.role.findUnique({ where: { id: roleId } });
  if (!role) throw new ErreurAction(404, "Rôle introuvable");
  if (role.nom !== ROLE_ADMINISTRATEUR) {
    throw new ErreurAction(409, "Le rôle visé n'est plus « Administrateur » — cette demande n'est plus applicable telle quelle.");
  }

  // Vérifié DANS la transaction Serializable : deux approbations concurrentes
  // de création de compte Administrateur, lisant toutes deux un compte sous
  // la limite, ne peuvent plus toutes deux aboutir — PostgreSQL détecte cette
  // anomalie d'écriture (write skew) et avorte l'une des deux avec P2034,
  // rattrapé par le réessai borné de l'appelant.
  const nbAdmins = await tx.utilisateur.count({ where: { role: { nom: ROLE_ADMINISTRATEUR } } });
  if (nbAdmins >= MAX_COMPTES_ADMIN) {
    throw new ErreurAction(409, `Limite atteinte : au plus ${MAX_COMPTES_ADMIN} comptes Administrateur`);
  }

  // `create` n'est jamais intercepté par l'extension d'audit générique (voir
  // `lib/audit.ts`) — comportement inchangé : aucune ligne AuditLog pour la
  // création elle-même.
  const compte = await tx.utilisateur.create({
    data: { nom, email, roleId, motDePasseHash, motDePasseDoitChanger: true, sexe: sexe ?? null, photoUrl: photoUrl ?? null },
  });

  // Identifiant de connexion issu de Travailleurs (section 3.7) : la fiche
  // d'origine reste liée au compte qu'elle vient de générer — rattachement
  // ATOMIQUE avec la création (même transaction).
  if (travailleurId) {
    await rattacherTravailleurAuNouveauCompteTx(tx, { travailleurId, compteId: compte.id, emailAttendu: email });
  }

  return { message: `Compte Administrateur « ${compte.nom} » créé` };
}

export async function creerCompteAdminDirect(
  db: typeof prismaApp,
  donnees: DonneesCreerCompteAdmin,
): Promise<{ message: string }> {
  return executerDirectAvecReessaiP2034(db, (tx) => creerCompteAdminTx(tx, donnees));
}

// ---------------------------------------------------------------------------
// MODIFIER_TYPE_CLIENT
// ---------------------------------------------------------------------------

export interface DonneesModifierTypeClient {
  nom?: string;
  prixParBac?: number;
  commissionParBac?: number;
}

export async function modifierTypeClientTx(
  tx: TxClient,
  typeClientId: string,
  data: DonneesModifierTypeClient,
): Promise<{ message: string }> {
  const existant = await tx.typeClient.findUnique({ where: { id: typeClientId } });
  if (!existant) throw new ErreurAction(404, "Qualité introuvable");
  if (data.nom && data.nom !== existant.nom) {
    const doublon = await tx.typeClient.findUnique({ where: { nom: data.nom } });
    if (doublon) throw new ErreurAction(409, "Une qualité porte déjà ce nom");
  }
  const { count } = await tx.typeClient.updateMany({ where: { id: existant.id }, data });
  if (count !== 1) throw new ErreurAction(404, "Qualité introuvable");
  const tc = await tx.typeClient.findUniqueOrThrow({ where: { id: existant.id } });
  await auditerTx(tx, {
    module: "PARAMETRES",
    typeEntite: "TypeClient",
    entiteId: tc.id,
    action: "MODIFICATION",
    avant: existant,
    apres: tc,
  });
  return { message: `Qualité « ${tc.nom} » mise à jour` };
}

export async function modifierTypeClientDirect(
  db: typeof prismaApp,
  typeClientId: string,
  data: DonneesModifierTypeClient,
): Promise<{ message: string }> {
  return executerDirectAvecReessaiP2034(db, (tx) => modifierTypeClientTx(tx, typeClientId, data));
}

// ---------------------------------------------------------------------------
// MODIFIER_TAUX_TAXE
// ---------------------------------------------------------------------------

export async function modifierTauxTaxeTx(
  tx: TxClient,
  produitId: string,
  data: Prisma.ProduitUpdateManyMutationInput,
): Promise<{ message: string }> {
  const existant = await tx.produit.findUnique({ where: { id: produitId } });
  if (!existant) throw new ErreurAction(404, "Produit introuvable");
  const { count } = await tx.produit.updateMany({ where: { id: existant.id }, data });
  if (count !== 1) throw new ErreurAction(404, "Produit introuvable");
  const produit = await tx.produit.findUniqueOrThrow({ where: { id: existant.id } });
  await auditerTx(tx, {
    module: "PARAMETRES",
    typeEntite: "Produit",
    entiteId: produit.id,
    action: "MODIFICATION",
    avant: existant,
    apres: produit,
  });
  return { message: `Produit « ${produit.nom} » — taux de taxe fixé à ${produit.tauxTaxe} %` };
}

export async function modifierTauxTaxeDirect(
  db: typeof prismaApp,
  produitId: string,
  data: Prisma.ProduitUpdateManyMutationInput,
): Promise<{ message: string }> {
  return executerDirectAvecReessaiP2034(db, (tx) => modifierTauxTaxeTx(tx, produitId, data));
}

// ---------------------------------------------------------------------------
// Approbation atomique générique des 4 types ci-dessus
// ---------------------------------------------------------------------------

export type TypeActionMetier = "SUPPRIMER_UTILISATEUR" | "CREER_COMPTE_ADMIN" | "MODIFIER_TYPE_CLIENT" | "MODIFIER_TAUX_TAXE";

export interface ResultatApprobationActionMetier {
  message: string;
  demandeStatut: "APPROUVEE";
  demandeApprouveParId: string;
  demandeDateDecision: Date;
}

/**
 * Réservation atomique + dispatch vers la bonne fonction tx-aware +
 * transition `APPROUVEE`, LE TOUT dans une seule transaction PostgreSQL
 * Serializable avec réessai borné sur P2034 — délègue entièrement au
 * mécanisme générique `approuverEtExecuterDemandeAtomique`
 * (`services/demandeApprobation.ts`), réutilisé tel quel (mission P1,
 * exigence de réutilisation du mécanisme générique introduit par PR #31).
 * Appelée par `routes/approbations.ts` pour les 4 types listés dans
 * `TypeActionMetier` — jamais pour `MODIFIER_PERMISSIONS_ROLE`, qui a son
 * propre appelant (`approuverEtAppliquerModificationPermissionsRole`,
 * `permissionsRoleAudit.ts`) fournissant un callback différent au même
 * mécanisme générique.
 */
export async function approuverEtExecuterActionMetier(
  db: typeof prismaApp,
  demandeApprobationId: string,
  approbateur: IdentiteDecideur,
  crochets?: CrochetsTestApprobationAtomique,
): Promise<ResultatApprobationActionMetier> {
  return approuverEtExecuterDemandeAtomique(db, demandeApprobationId, approbateur, async (tx, demande, dateDecision) => {
    const donnees = demande.donnees as Donnees;
    let resultat: { message: string };
    switch (demande.type as TypeActionMetier) {
      case "SUPPRIMER_UTILISATEUR":
        resultat = await supprimerUtilisateurTx(tx, donnees.utilisateurId as string);
        break;
      case "CREER_COMPTE_ADMIN":
        resultat = await creerCompteAdminTx(tx, donnees as unknown as DonneesCreerCompteAdmin);
        break;
      case "MODIFIER_TYPE_CLIENT":
        resultat = await modifierTypeClientTx(tx, donnees.typeClientId as string, donnees.data as DonneesModifierTypeClient);
        break;
      case "MODIFIER_TAUX_TAXE":
        resultat = await modifierTauxTaxeTx(
          tx,
          donnees.produitId as string,
          donnees.data as Prisma.ProduitUpdateManyMutationInput,
        );
        break;
      default:
        // Ne devrait jamais se produire : l'appelant (routes/approbations.ts)
        // n'aiguille vers cette fonction que pour ces 4 types précis. Garde
        // défensive plutôt qu'une hypothèse silencieuse.
        throw new Error(`approuverEtExecuterActionMetier appelée pour un type d'action inattendu : ${demande.type}`);
    }
    return {
      message: resultat.message,
      demandeStatut: "APPROUVEE" as const,
      demandeApprouveParId: approbateur.id,
      demandeDateDecision: dateDecision,
    };
  }, crochets);
}
