import { Prisma } from "@prisma/client";
import { ROLE_ADMINISTRATEUR } from "@lomoto/shared";
import type { prisma as prismaApp } from "../lib/prisma.js";

/**
 * Logique atomique partagée entre `PUT /api/equipe/:id/activation` et
 * `POST /api/equipe/:id/principal` (routes `equipe.ts`) — extraite ici pour
 * une seule raison : permettre à `scripts/verifier-concurrence-equipe-ci.ts`
 * d'exercer EXACTEMENT le code de production sous une vraie concurrence
 * PostgreSQL, plutôt qu'une réimplémentation parallèle qui pourrait diverger
 * du vrai comportement.
 *
 * Correctif P0-01 (round 6, revue Codex, point 1) : les deux fonctions
 * ci-dessous appliquent leurs invariants au niveau de l'ÉCRITURE elle-même
 * (`updateMany` avec la condition requise dans son `where`), jamais au niveau
 * d'une pré-lecture séparée — une pré-lecture laisse toujours une fenêtre de
 * course entre la lecture et l'écriture. PostgreSQL évalue le `where` d'un
 * `UPDATE` de façon atomique avec l'écriture elle-même, sous le verrou de
 * ligne standard : deux écritures concurrentes sur la même ligne se
 * sérialisent, et la seconde réévalue son `where` contre l'état réellement
 * committé par la première.
 */

export type CompteAvecRole = Prisma.UtilisateurGetPayload<{
  include: { role: { select: { id: true; nom: true } } };
}>;

export const INCLUDE_COMPTE = { role: { select: { id: true, nom: true } } } as const;

/**
 * Type structurel minimal, écrit à la main avec des signatures NON
 * génériques (plutôt que `Pick<PrismaClient, "utilisateur">`, essayé
 * d'abord et rejeté par le compilateur pour les méthodes génériques : le
 * client applicatif étendu — `lib/prisma.ts`, `prisma.$extends(...)` —
 * expose des signatures génériques dont le type exact diffère de celui d'un
 * `PrismaClient` nu). Ces signatures concrètes, limitées aux formes
 * réellement appelées ci-dessous, sont satisfaites par les deux clients : le
 * client applicatif étendu (utilisé par les routes `equipe.ts`) ET un
 * `new PrismaClient()` nu (utilisé par
 * `scripts/verifier-concurrence-equipe-ci.ts`) — même convention que
 * `ClientBootstrap` dans `prisma/bootstrap-production.ts`, pour la même
 * raison : permettre à un script de vérification d'appeler exactement le
 * code de production avec son propre client. N'inclut PAS `$transaction` :
 * cette méthode reste surchargée d'une façon que TypeScript ne laisse pas
 * reproduire fidèlement dans une interface à la main (essayé, rejeté) — la
 * seule fonction qui en a besoin (`transfererStatutPrincipal`) est donc
 * typée directement sur `typeof prisma` du client applicatif à la place.
 */
export interface ClientPrincipal {
  utilisateur: {
    updateMany(args: {
      where: { id: string; estAdminPrincipal?: boolean; actif?: boolean; role?: { nom: string } };
      data: { estAdminPrincipal?: boolean; actif?: boolean; sessionActuelleId?: null };
    }): Promise<{ count: number }>;
    findUnique(args: { where: { id: string }; select: { estAdminPrincipal: true } }): Promise<{
      estAdminPrincipal: boolean;
    } | null>;
    findUniqueOrThrow(args: { where: { id: string }; include: typeof INCLUDE_COMPTE }): Promise<CompteAvecRole>;
  };
}

export class ErreurTransfertPrincipalConcurrent extends Error {}

/**
 * Transfère le statut d'Administrateur principal de `idAncienPrincipal` vers
 * `idCible`, dans une seule transaction Prisma :
 *   1) retire le statut de l'ancien Principal — SEULEMENT s'il le porte
 *      encore à cet instant (`estAdminPrincipal: true` dans le `where`) ;
 *   2) attribue le statut à la cible — SEULEMENT si elle est encore active,
 *      encore Administrateur et pas déjà Principal à cet instant.
 * Si l'une des deux `updateMany` n'affecte aucune ligne (`count !== 1`), une
 * `ErreurTransfertPrincipalConcurrent` est levée, ce qui fait annuler
 * (ROLLBACK) la transaction entière — y compris une étape 1 déjà réussie :
 * l'ancien Principal ne perd jamais son statut sans qu'un nouveau l'obtienne
 * réellement.
 */
export interface CrochetsTestTransfert {
  /**
   * Appelé (si fourni) juste après que le retrait a réussi, avant
   * l'attribution — SEUL point d'ancrage de test de toute cette fonction,
   * jamais utilisé par les routes de production (`equipe.ts` ne le passe
   * jamais). Sert uniquement à `scripts/verifier-concurrence-equipe-ci.ts`
   * pour élargir délibérément la fenêtre de course, le temps d'exécuter une
   * écriture concurrente réelle depuis une connexion séparée, et ainsi
   * obtenir un scénario de course déterministe et reproductible plutôt que
   * de dépendre du hasard du timing réseau.
   */
  apresRetraitAvantAttribution?: () => Promise<void>;
}

export async function transfererStatutPrincipal(
  db: typeof prismaApp,
  idAncienPrincipal: string,
  idCible: string,
  crochets?: CrochetsTestTransfert,
): Promise<CompteAvecRole> {
  return db.$transaction(async (tx) => {
    const retire = await tx.utilisateur.updateMany({
      where: { id: idAncienPrincipal, estAdminPrincipal: true },
      data: { estAdminPrincipal: false },
    });
    if (retire.count !== 1) {
      throw new ErreurTransfertPrincipalConcurrent();
    }
    if (crochets?.apresRetraitAvantAttribution) {
      await crochets.apresRetraitAvantAttribution();
    }
    const attribue = await tx.utilisateur.updateMany({
      where: { id: idCible, actif: true, estAdminPrincipal: false, role: { nom: ROLE_ADMINISTRATEUR } },
      data: { estAdminPrincipal: true },
    });
    if (attribue.count !== 1) {
      throw new ErreurTransfertPrincipalConcurrent();
    }
    return tx.utilisateur.findUniqueOrThrow({ where: { id: idCible }, include: INCLUDE_COMPTE });
  });
}

export type ResultatDesactivation =
  | { ok: true; compte: CompteAvecRole }
  | { ok: false; raison: "EST_PRINCIPAL" | "INTROUVABLE" };

/**
 * Désactive un compte de façon atomique : `updateMany` conditionné sur
 * `estAdminPrincipal: false` au moment de l'écriture — un compte qui vient
 * de devenir Principal (transfert concurrent) n'est PAS désactivé, même si
 * une pré-lecture antérieure le montrait encore comme non-Principal.
 * `count === 0` déclenche une relecture, uniquement pour distinguer les deux
 * raisons d'échec possibles dans le message renvoyé à l'appelant — jamais
 * pour décider si l'écriture doit avoir lieu.
 */
export async function desactiverCompteAtomique(db: ClientPrincipal, idCompte: string): Promise<ResultatDesactivation> {
  const { count } = await db.utilisateur.updateMany({
    where: { id: idCompte, estAdminPrincipal: false },
    data: { actif: false, sessionActuelleId: null },
  });
  if (count === 0) {
    const actuel = await db.utilisateur.findUnique({ where: { id: idCompte }, select: { estAdminPrincipal: true } });
    return { ok: false, raison: actuel ? "EST_PRINCIPAL" : "INTROUVABLE" };
  }
  const compte = await db.utilisateur.findUniqueOrThrow({ where: { id: idCompte }, include: INCLUDE_COMPTE });
  return { ok: true, compte };
}
