import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { ROLE_ADMINISTRATEUR } from "@lomoto/shared";
import { ErreurAction } from "../lib/erreurAction.js";
import type { prisma as prismaApp, TxClient } from "../lib/prisma.js";

/**
 * Secret de bootstrap du premier lancement (P1-A, 28/08/2026).
 *
 * Avant ce correctif, la seule autorisation d'accès à
 * `routes/premierLancement.ts` était l'absence de compte Utilisateur — sur
 * une base neuve ou réinitialisée, n'importe quel visiteur découvrant
 * l'écran avant l'administrateur légitime pouvait devenir Administrateur
 * Principal. Ce module ajoute un secret à haute entropie, généré hors dépôt
 * (`scripts/generer-secret-premier-lancement.ts`, exécuté manuellement),
 * expirant, et consommé atomiquement à la finalisation — jamais stocké ni
 * journalisé en clair, seule son empreinte SHA-256 l'est. Un hachage rapide
 * et non salé est correct ici (contrairement à un mot de passe humain) :
 * l'entropie du secret lui-même (32 octets aléatoires) rend une table
 * arc-en-ciel infaisable, et l'égalité directe est nécessaire pour la
 * consommation conditionnelle (`updateMany` sur `secretHash`) — bcrypt, salé
 * et non déterministe, ne permettrait pas ce lookup.
 *
 * Toutes les fonctions ci-dessous prennent leur client Prisma (`db`) en
 * paramètre plutôt que de capturer le singleton importé — même convention
 * que `actionsCritiquesMetier.ts` (`*Direct(db, ...)`), qui rend ces
 * fonctions triviales à tester avec un client factice, sans mock de module.
 */

const OCTETS_SECRET = 32;
const NB_TENTATIVES_MAX_P2034 = 3;

export class ErreurFinalisationReessayable extends Error {
  constructor() {
    super(
      "Conflit de concurrence persistant lors de la finalisation du premier lancement — réessayez. " +
        "Le secret n'a pas été consommé si cette erreur survient.",
    );
  }
}

function hacherSecret(secretClair: string): string {
  return crypto.createHash("sha256").update(secretClair, "utf8").digest("hex");
}

/**
 * Génère un nouveau secret de bootstrap et l'insère (empreinte uniquement).
 * Appelée uniquement par `scripts/generer-secret-premier-lancement.ts` —
 * jamais depuis une route HTTP. Retourne le secret EN CLAIR une seule fois ;
 * l'appelant est responsable de ne jamais le journaliser.
 */
export async function genererSecretPremierLancement(
  db: PrismaClient,
  dureeMs: number,
): Promise<{ secretClair: string; expiresAt: Date }> {
  const secretClair = crypto.randomBytes(OCTETS_SECRET).toString("base64url");
  const expiresAt = new Date(Date.now() + dureeMs);
  await db.secretPremierLancement.create({
    data: { secretHash: hacherSecret(secretClair), expiresAt },
  });
  return { secretClair, expiresAt };
}

/**
 * Vérification LÉGÈRE (lecture seule), utilisée par les étapes 1 à 3 du
 * parcours pour un rejet rapide et honnête — JAMAIS la garantie de sécurité
 * réelle, qui appartient exclusivement à la réservation atomique de
 * `finaliserPremierLancementDirect` ci-dessous (même distinction que le
 * reste du dépôt : cf. `routes/approbations.ts`, aperçu léger vs écriture
 * conditionnelle atomique).
 */
export async function secretPremierLancementValide(
  db: typeof prismaApp,
  secretFourni: string | undefined,
): Promise<boolean> {
  if (!secretFourni) return false;
  const enregistrement = await db.secretPremierLancement.findUnique({
    where: { secretHash: hacherSecret(secretFourni) },
    select: { consommeLe: true, expiresAt: true },
  });
  return enregistrement !== null && enregistrement.consommeLe === null && enregistrement.expiresAt > new Date();
}

export interface FinaliserPremierLancementDonnees {
  secretFourni: string | undefined;
  travailleurId: string;
  motDePasse: string;
}

/**
 * Crochets de TEST UNIQUEMENT (jamais appelés en production — aucun
 * appelant réel n'en fournit) : élargissent délibérément la fenêtre de
 * course entre la réservation du secret et l'écriture finale, pour que
 * `scripts/verifier-concurrence-premier-lancement-ci.ts` puisse garantir
 * — plutôt que simplement espérer — qu'une vraie transaction concurrente
 * chevauche celle-ci avant de la laisser continuer. Même idiome que
 * `CrochetsTestApprobationAtomique` (demandeApprobation.ts) et les crochets
 * de `verifier-concurrence-equipe-ci.ts`.
 */
export interface CrochetsTestFinalisationPremierLancement {
  /** Reçoit `tx` (même connexion/session que la transaction en cours, donc
   *  ex. `tx.$queryRaw\`SELECT pg_backend_pid()\`` reflète réellement le PID
   *  qui tiendra les verrous) — jamais un `PrismaClient` séparé, qui piocherait
   *  une connexion différente du pool. */
  apresReservationAvantEcriture?: (tx: TxClient) => Promise<void>;
}

/**
 * Cœur transactionnel : réservation atomique du secret + revérification de
 * la base vide + création du compte Administrateur Principal + rattachement
 * de la fiche Travailleur — DANS la même transaction Serializable. Résistant
 * à la concurrence de deux façons distinctes, toutes deux prouvées contre
 * PostgreSQL réel (voir `scripts/verifier-concurrence-premier-lancement-ci.ts`) :
 *  1. Deux finalisations concurrentes utilisant le MÊME secret : l'une des
 *     deux `updateMany` conditionnelles (`consommeLe IS NULL`) affecte 0
 *     ligne — rejet immédiat et honnête, aucun rejeu possible ensuite.
 *  2. Deux finalisations concurrentes utilisant CHACUNE son propre secret
 *     valide (deux administrateurs légitimes agissant au même instant, ou
 *     un secret réutilisé après une fuite) : la relecture de
 *     `tx.utilisateur.count()` DANS la transaction Serializable détecte
 *     le conflit — PostgreSQL fait échouer l'une des deux transactions en
 *     P2034 plutôt que de laisser deux Administrateurs Principaux coexister.
 */
async function finaliserPremierLancementTx(
  tx: TxClient,
  donnees: FinaliserPremierLancementDonnees,
  crochets?: CrochetsTestFinalisationPremierLancement,
) {
  const { secretFourni, travailleurId, motDePasse } = donnees;
  if (!secretFourni) throw new ErreurAction(401, "Secret de premier lancement requis");

  const reservation = await tx.secretPremierLancement.updateMany({
    where: { secretHash: hacherSecret(secretFourni), consommeLe: null, expiresAt: { gt: new Date() } },
    data: { consommeLe: new Date() },
  });
  if (reservation.count === 0) {
    throw new ErreurAction(401, "Secret de premier lancement invalide, expiré ou déjà utilisé");
  }

  await crochets?.apresReservationAvantEcriture?.(tx);

  // Revérification DANS la transaction — voir point 2 ci-dessus. Redondant
  // avec le contrôle déjà fait par chaque route avant d'appeler cette
  // fonction (rejet honnête et rapide), mais celui-ci est le seul qui
  // compte réellement sous Serializable.
  const nombreComptes = await tx.utilisateur.count();
  if (nombreComptes > 0) {
    throw new ErreurAction(409, "La configuration initiale est déjà terminée — connectez-vous normalement.");
  }

  const travailleur = await tx.travailleur.findUnique({ where: { id: travailleurId } });
  if (!travailleur) throw new ErreurAction(404, "Fiche introuvable");
  if (travailleur.utilisateurId) {
    throw new ErreurAction(409, "Cette fiche a déjà un compte de connexion");
  }
  if (travailleur.emailProStatut !== "ACTIF" || !travailleur.emailProAdresse) {
    throw new ErreurAction(409, "L'adresse email professionnelle n'est pas encore active");
  }

  const role = await tx.role.findUnique({ where: { nom: ROLE_ADMINISTRATEUR } });
  if (!role) throw new ErreurAction(500, "Rôle Administrateur introuvable — configuration incomplète");

  const motDePasseHash = await bcrypt.hash(motDePasse, 10);
  const compte = await tx.utilisateur.create({
    data: {
      nom: travailleur.nom,
      email: travailleur.emailProAdresse,
      roleId: role.id,
      motDePasseHash,
      estAdminPrincipal: true,
    },
  });
  await tx.travailleur.update({ where: { id: travailleur.id }, data: { utilisateurId: compte.id } });
}

/**
 * Point d'entrée appelé par la route — même idiome de réessai borné sur
 * P2034 que `executerDirectAvecReessaiP2034` (actionsCritiquesMetier.ts,
 * non exporté, non réutilisé ici pour ne pas coupler deux domaines
 * indépendants). Non réessayée : `ErreurAction` (rejet honnête,
 * ne dépend pas d'un conflit de sérialisation).
 */
export async function finaliserPremierLancementDirect(
  db: typeof prismaApp,
  donnees: FinaliserPremierLancementDonnees,
  crochets?: CrochetsTestFinalisationPremierLancement,
): Promise<void> {
  for (let tentative = 1; tentative <= NB_TENTATIVES_MAX_P2034; tentative++) {
    try {
      await db.$transaction((tx) => finaliserPremierLancementTx(tx, donnees, crochets), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      return;
    } catch (e) {
      if (e instanceof ErreurAction) throw e;
      const estP2034 = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";
      if (!estP2034) throw e;
      if (tentative < NB_TENTATIVES_MAX_P2034) continue;
      throw new ErreurFinalisationReessayable();
    }
  }
  // Inatteignable : la boucle retourne ou lève à chaque itération.
  throw new ErreurFinalisationReessayable();
}
