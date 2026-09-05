import { createHash } from "node:crypto";
import type { Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma, type TxClient } from "./prisma.js";

const CLE_REGEX = /^[A-Za-z0-9._:-]{8,128}$/;

export class ErreurIdempotence extends Error {
  constructor(
    message: string,
    readonly statutHttp: 400 | 409,
    readonly code: "CLE_IDEMPOTENCE_INVALIDE" | "CLE_IDEMPOTENCE_REUTILISEE",
  ) {
    super(message);
  }
}

function canonique(valeur: unknown): unknown {
  if (valeur === null || typeof valeur !== "object") return valeur;
  if (Array.isArray(valeur)) return valeur.map(canonique);
  const objet = valeur as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(objet)
      .filter((cle) => objet[cle] !== undefined)
      .sort()
      .map((cle) => [cle, canonique(objet[cle])]),
  );
}

/** Empreinte stable : l'ordre des propriétés JSON ne change pas le résultat. */
export function empreinteIdempotence(portee: string, donnees: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify({ portee, donnees: canonique(donnees) }))
    .digest("hex");
}

export function lireCleIdempotence(req: Pick<Request, "get">): string | null {
  const cle = req.get("Idempotency-Key");
  if (cle === undefined) return null;
  if (!CLE_REGEX.test(cle)) {
    throw new ErreurIdempotence(
      "L'en-tête Idempotency-Key doit contenir 8 à 128 caractères alphanumériques ou . _ : -",
      400,
      "CLE_IDEMPOTENCE_INVALIDE",
    );
  }
  return cle;
}

export interface ReponseEcriture<TCorps> {
  statutHttp: number;
  corps: TCorps;
}

export interface ResultatEcriture<TValeur, TCorps> extends ReponseEcriture<TCorps> {
  rejoue: boolean;
  /** Présent uniquement lors de la première exécution, jamais lors d'un rejeu. */
  valeur?: TValeur;
}

async function retrouver<TCorps>(
  utilisateurId: string,
  portee: string,
  cle: string,
  empreinte: string,
): Promise<ResultatEcriture<never, TCorps> | null> {
  const operation = await prisma.operationIdempotente.findUnique({
    where: { utilisateurId_portee_cle: { utilisateurId, portee, cle } },
  });
  if (!operation) return null;
  if (operation.empreinte !== empreinte) {
    throw new ErreurIdempotence(
      "Cette Idempotency-Key a déjà été utilisée avec des données différentes",
      409,
      "CLE_IDEMPOTENCE_REUTILISEE",
    );
  }
  return {
    statutHttp: operation.statutHttp,
    corps: operation.reponse as TCorps,
    rejoue: true,
  };
}

/**
 * Exécute et mémorise une écriture sensible dans LA MÊME transaction.
 * Deux requêtes concurrentes ne peuvent donc jamais appliquer deux fois
 * l'effet métier : l'unicité en base élit un seul propriétaire de la clé.
 */
export async function executerEcritureIdempotente<TValeur, TCorps>(
  req: Request,
  portee: string,
  donnees: unknown,
  executer: (tx: TxClient) => Promise<TValeur>,
  versReponse: (valeur: TValeur) => ReponseEcriture<TCorps>,
): Promise<ResultatEcriture<TValeur, TCorps>> {
  const utilisateurId = req.utilisateur!.id;
  const cle = lireCleIdempotence(req);

  if (!cle) {
    const valeur = await prisma.$transaction(executer, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    return { ...versReponse(valeur), valeur, rejoue: false };
  }

  const empreinte = empreinteIdempotence(portee, donnees);
  const dejaFaite = await retrouver<TCorps>(utilisateurId, portee, cle, empreinte);
  if (dejaFaite) return dejaFaite;

  try {
    return await prisma.$transaction(
      async (tx) => {
        const operation = await tx.operationIdempotente.create({
          data: {
            utilisateurId,
            portee,
            cle,
            empreinte,
            statutHttp: 0,
            reponse: {},
          },
        });
        const valeur = await executer(tx);
        const reponse = versReponse(valeur);
        await tx.operationIdempotente.update({
          where: { id: operation.id },
          data: {
            statutHttp: reponse.statutHttp,
            reponse: JSON.parse(JSON.stringify(reponse.corps)) as Prisma.InputJsonValue,
          },
        });
        return { ...reponse, valeur, rejoue: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (erreur) {
    if (erreur instanceof Prisma.PrismaClientKnownRequestError && erreur.code === "P2002") {
      const concurrente = await retrouver<TCorps>(utilisateurId, portee, cle, empreinte);
      if (concurrente) return concurrente;
    }
    throw erreur;
  }
}

export function ajouterEnteteRejeu(res: { setHeader(nom: string, valeur: string): unknown }, rejoue: boolean) {
  if (rejoue) res.setHeader("Idempotency-Replayed", "true");
}
