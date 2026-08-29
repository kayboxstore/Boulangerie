import { Prisma } from "@prisma/client";
import { ErreurAction } from "../lib/erreurAction.js";
import { contexteRequete } from "../lib/contexteRequete.js";
import type { TxClient, prisma as prismaApp } from "../lib/prisma.js";
import { dateSQLDepuisJourLomoto, jourLomoto } from "../lib/temps.js";

/**
 * Mécanisme commun d'atomicité de la caisse (P1-B, 28/08/2026).
 *
 * Décision métier : toute écriture pouvant modifier ou sceller la journée
 * financière (taux, dépense manuelle ou farine, remise, confirmation de
 * règlement, commande manuelle — création ou modification, clôture,
 * correction) exige une `SessionCaisse` EXISTANTE et OUVERTE pour la date
 * concernée. Deux exceptions confirmées, hors périmètre de ce module : la
 * simple déclaration d'un règlement (aucun effet comptable avant
 * confirmation) et la conversion C4 (montantRecu = 0, aucun impact sur le
 * registre).
 *
 * Mécanisme de sérialisation retenu : un verrou de ligne PostgreSQL réel
 * (`SELECT ... FOR UPDATE`) sur la ligne `SessionCaisse` de la date
 * concernée — jamais un verrou global, jamais une FK nouvelle sur
 * `DepenseCaisse`/`TauxDuJour` (ni l'un ni l'autre n'est nécessaire : la
 * ligne `SessionCaisse` est déjà unique par date). Toute transaction qui lit
 * ou écrit quoi que ce soit lié au registre d'une date doit commencer par
 * `verrouillerSessionOuverte(tx, date)` — avant toute autre lecture
 * pertinente — pour que le verrou soit posé avant que quiconque puisse agir
 * sur des données obsolètes.
 */

const NB_TENTATIVES_MAX_P2034 = 3;

/** Levée après épuisement des réessais P2034 — traduite en HTTP 503. */
export class ErreurEcritureCaisseReessayable extends Error {
  constructor() {
    super("Conflit de concurrence persistant sur la caisse — réessayez. Rien n'a été enregistré si cette erreur survient.");
  }
}

/**
 * Crochets de TEST UNIQUEMENT (jamais appelés par un chemin de production —
 * aucun appelant réel n'en fournit) : même idiome que
 * `CrochetsTestFinalisationPremierLancement` (premierLancement.ts) et
 * `CrochetsTestApprobationAtomique` (demandeApprobation.ts). Appelé juste
 * après l'acquisition RÉELLE du verrou de ligne (le `SELECT ... FOR UPDATE` a
 * déjà été exécuté sur `tx`), avant toute autre lecture ou écriture — permet
 * à `scripts/verifier-concurrence-caisse-ci.ts` de prouver, plutôt que
 * simplement espérer, qu'une vraie transaction concurrente est réellement
 * bloquée sur CE verrou avant de laisser celle-ci continuer.
 */
export interface CrochetsTestVerrouCaisse {
  apresVerrouAvantLecture?: (tx: TxClient) => Promise<void>;
}

/**
 * Verrouille RÉELLEMENT (SELECT ... FOR UPDATE, sur `tx` — jamais le
 * singleton `prisma`) la ligne SessionCaisse de la date donnée, puis vérifie
 * son existence et son statut. Renvoie la session complète (toujours verrouillée
 * pour la durée de la transaction appelante) si elle est OUVERTE ; lève un 409
 * métier explicite sinon — c'est le SEUL point de sérialisation de ce module.
 */
export async function verrouillerSessionOuverte(tx: TxClient, date: string, crochets?: CrochetsTestVerrouCaisse) {
  const lignes = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "SessionCaisse" WHERE date = ${dateSQLDepuisJourLomoto(date)} FOR UPDATE
  `;
  const verrou = lignes[0];
  if (!verrou) {
    throw new ErreurAction(
      409,
      `Aucune session de caisse n'est ouverte pour le ${date} — ouvrez d'abord la caisse pour continuer.`,
    );
  }
  await crochets?.apresVerrouAvantLecture?.(tx);
  // Relecture typée complète, à l'intérieur de la même transaction : la ligne
  // est déjà verrouillée par le SELECT ci-dessus (même connexion), donc cette
  // lecture ne fait qu'obtenir les colonnes sans reposer de verrou ni attendre.
  const session = await tx.sessionCaisse.findUniqueOrThrow({ where: { id: verrou.id } });
  if (session.statut !== "OUVERTE") {
    throw new ErreurAction(409, `La session de caisse du ${date} est clôturée : plus aucune écriture n'est possible.`);
  }
  return session;
}

/**
 * Variante par id de session (routes `/sessions/:id/...`) : l'id seul ne
 * suffit pas pour verrouiller par date, donc une pré-lecture (non
 * protectrice en elle-même) donne la date à verrouiller ; la vérification
 * qui fait foi est celle d'après, sur la ligne réellement verrouillée —
 * l'id retrouvé DOIT correspondre à celui demandé, sinon la session ciblée
 * n'existe pas (jamais un 500 générique).
 */
export async function verrouillerSessionOuverteParId(tx: TxClient, id: string, crochets?: CrochetsTestVerrouCaisse) {
  const apercu = await tx.sessionCaisse.findUnique({ where: { id }, select: { date: true } });
  if (!apercu) throw new ErreurAction(404, "Session de caisse introuvable");
  const session = await verrouillerSessionOuverte(tx, jourLomoto(apercu.date), crochets);
  if (session.id !== id) throw new ErreurAction(404, "Session de caisse introuvable");
  return session;
}

/**
 * Verrou de ligne pour la correction post-clôture (`/sessions/:id/corriger`)
 * — même mécanisme (SELECT ... FOR UPDATE) que `verrouillerSessionOuverte`,
 * précondition INVERSE (FERMEE, pas OUVERTE) : corriger une session est par
 * définition une action sur une session déjà close, jamais sur une session
 * encore ouverte.
 */
export async function verrouillerSessionFermeeParId(tx: TxClient, id: string, crochets?: CrochetsTestVerrouCaisse) {
  const apercu = await tx.sessionCaisse.findUnique({ where: { id }, select: { date: true } });
  if (!apercu) throw new ErreurAction(404, "Session de caisse introuvable");
  const lignes = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "SessionCaisse" WHERE date = ${dateSQLDepuisJourLomoto(jourLomoto(apercu.date))} FOR UPDATE
  `;
  const verrou = lignes[0];
  if (!verrou || verrou.id !== id) throw new ErreurAction(404, "Session de caisse introuvable");
  await crochets?.apresVerrouAvantLecture?.(tx);
  const session = await tx.sessionCaisse.findUniqueOrThrow({ where: { id } });
  if (session.statut !== "FERMEE") {
    throw new ErreurAction(409, "Seule une session déjà clôturée peut être corrigée");
  }
  return session;
}

/**
 * Discipline chronologique (préexistante) : refuse d'agir sur une date tant
 * qu'une session antérieure reste OUVERTE. Appelée à l'intérieur de la même
 * transaction que le verrou ci-dessus, sur `tx`.
 */
export async function verifierAucuneSessionAnterieureOuverte(tx: TxClient, date: string): Promise<void> {
  const anterieure = await tx.sessionCaisse.findFirst({
    where: { statut: "OUVERTE", date: { lt: dateSQLDepuisJourLomoto(date) } },
    orderBy: { date: "asc" },
  });
  if (anterieure) {
    throw new ErreurAction(409, `Clôturez d'abord la session de caisse du ${jourLomoto(anterieure.date)} avant de continuer`);
  }
}

const CLE_SENSIBLE = /hash|motdepasse|password|secret|token/i;

/** Rend un enregistrement sérialisable et expurgé (mêmes règles que lib/audit.ts). */
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

export class ErreurActeurRequisPourAuditCaisse extends Error {
  constructor() {
    super("Journalisation impossible hors contexte de requête authentifiée");
  }
}

/**
 * Écrit UNE ligne AuditLog, manuellement et DANS la transaction (`tx.auditLog.create`)
 * — jamais via le client de base (voir l'en-tête de lib/audit.ts et le
 * commentaire de actionsCritiquesMetier.ts : l'extension d'audit automatique
 * écrit via un client NON transactionnel, ce qui laisserait une trace
 * mensongère en cas de rollback). Toutes les écritures de ce module utilisent
 * donc `updateMany`/`deleteMany`/`create` (jamais `update`/`delete` singuliers
 * sur un modèle audité, qui seraient interceptés par l'extension automatique
 * ET produiraient une double journalisation ou une trace non transactionnelle) —
 * et journalisent manuellement leur équivalent ici, avec le même acteur, la
 * même transaction, le même sort en cas de rollback que l'écriture métier.
 *
 * Réutilisé au-delà du seul module CAISSE (`module: "PRODUCTION"` pour la
 * conversion C4 — CycleLivraison/CycleLivraisonLigne, apps/api/src/routes/cycles-livraison.ts) :
 * le mécanisme (client `tx`, jamais `base`) est générique, seul le module
 * d'affichage de l'AuditLog change.
 */
export async function auditerCaisseTx(
  tx: TxClient,
  params: {
    module: "CAISSE" | "COMMANDES" | "PRODUCTION";
    typeEntite: string;
    entiteId: string;
    action: "MODIFICATION" | "SUPPRESSION";
    avant: Record<string, unknown> | null;
    apres: Record<string, unknown> | null;
  },
): Promise<void> {
  const acteur = contexteRequete.getStore();
  if (!acteur) throw new ErreurActeurRequisPourAuditCaisse();
  await tx.auditLog.create({
    data: {
      utilisateurId: acteur.id,
      utilisateurNom: acteur.nom,
      module: params.module,
      typeEntite: params.typeEntite,
      entiteId: params.entiteId,
      action: params.action,
      avant: params.avant ? (normaliserPourAudit(params.avant) as unknown as Prisma.InputJsonValue) : undefined,
      apres: params.apres ? (normaliserPourAudit(params.apres) as unknown as Prisma.InputJsonValue) : undefined,
    },
  });
}

/**
 * Détecte un VRAI conflit de sérialisation PostgreSQL (SQLSTATE 40001),
 * sous DEUX formes distinctes observées en pratique contre PostgreSQL réel :
 *  - `P2034` : le conflit est détecté par Prisma au niveau de sa propre API
 *    `$transaction` (requêtes ORM classiques) ;
 *  - `P2010` avec `meta.code === "40001"` : le conflit survient DANS une
 *    requête `$queryRaw` (notre `SELECT ... FOR UPDATE` de verrouillage) —
 *    Prisma ne la reconnaît PAS comme `P2034` dans ce cas, seulement comme un
 *    échec de requête brute générique (`P2010`) portant le vrai code
 *    PostgreSQL en `meta`. Confirmé par une course réelle reproduite en
 *    local (deux transactions Serializable, verrou de ligne, la perdante
 *    reçoit exactement cette forme) — sans ce second cas, un conflit de
 *    sérialisation réel sur le verrou de session lui-même remontait en
 *    erreur brute non réessayée, jamais traduite en 503 propre.
 */
function estConflitSerialisationReel(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code === "P2034") return true;
  if (e.code === "P2010" && (e.meta as { code?: string } | undefined)?.code === "40001") return true;
  return false;
}

/**
 * Réessai borné sur un conflit de sérialisation réel PostgreSQL — même
 * idiome que `finaliserPremierLancementDirect` (premierLancement.ts) et
 * `executerDirectAvecReessaiP2034` (actionsCritiquesMetier.ts), répliqué
 * localement plutôt qu'importé pour ne pas coupler des domaines indépendants
 * (même convention déjà suivie par ces deux modules entre eux).
 *
 * `operation` doit représenter UNE tentative complète et indépendante (un
 * appel à `prisma.$transaction(...)` ou à `executerEcritureIdempotente(...)`)
 * : à chaque réessai, `operation()` est rappelée depuis zéro, ouvrant donc une
 * transaction ENTIÈREMENT NOUVELLE — jamais la réutilisation d'une transaction
 * avortée. Toute logique d'idempotence contenue dans `operation` est ainsi
 * rejouée dans la nouvelle transaction, exactement comme le reste.
 */
export async function executerAvecReessaiP2034<T>(operation: () => Promise<T>): Promise<T> {
  for (let tentative = 1; tentative <= NB_TENTATIVES_MAX_P2034; tentative++) {
    try {
      return await operation();
    } catch (e) {
      if (e instanceof ErreurAction) throw e;
      if (!estConflitSerialisationReel(e)) throw e;
      if (tentative < NB_TENTATIVES_MAX_P2034) continue;
      throw new ErreurEcritureCaisseReessayable();
    }
  }
  // Inatteignable : la boucle retourne ou lève à chaque itération.
  throw new ErreurEcritureCaisseReessayable();
}

/** Exécute `executer` dans une transaction Serializable NEUVE (isolationLevel explicite). */
export function transactionSerializable<T>(
  db: typeof prismaApp,
  executer: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(executer, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/** Détecte une violation de contrainte unique (P2002) — pour traduction en 409 propre, jamais un 500 brut. */
export function estViolationContrainteUnique(e: unknown): e is Prisma.PrismaClientKnownRequestError {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}
