import { PrismaClient } from "@prisma/client";
import { extensionAudit } from "./audit.js";

// Client de base (non étendu) : utilisé en interne par l'extension d'audit pour
// lire l'état « avant » et écrire le journal, sans retraverser l'extension.
const base = new PrismaClient();

// Client applicatif : toutes les écritures `update`/`delete` passent par
// l'extension d'audit (section 3.17). Interface identique au client standard,
// donc transparent pour le reste du code.
export const prisma = base.$extends(extensionAudit(base));

// Type du client transactionnel de ce client étendu (le `tx` fourni par
// `prisma.$transaction`). À utiliser à la place de `Prisma.TransactionClient`
// pour les fonctions qui reçoivent un `tx`, car le client étendu expose un type
// distinct du client de base.
export type TxClient = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
