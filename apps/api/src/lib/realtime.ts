import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents, UtilisateurDTO } from "@lomoto/shared";
import { MESSAGE_SESSION_REMPLACEE } from "@lomoto/shared";
import { verifyToken } from "./jwt.js";
import { chargerUtilisateur } from "../middleware/auth.js";
import { verifierOrigine } from "./origines.js";
import { prisma } from "./prisma.js";

interface InterServerEvents {}
interface SocketData {
  utilisateur: UtilisateurDTO;
}

export type IoServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

let io: IoServer | null = null;

export const roomUtilisateur = (utilisateurId: string) => `user:${utilisateurId}`;
export const roomRole = (roleId: string) => `role:${roleId}`;

/**
 * Attache Socket.io au serveur HTTP. Chaque connexion est authentifiée par le
 * JWT transmis dans `auth.token` au handshake ; le socket rejoint la room de
 * son utilisateur (user:{id}) et celle de son rôle (role:{id}).
 */
export function initRealtime(httpServer: HttpServer): IoServer {
  // Config CORS SÉPARÉE de celle d'Express (piège classique : Socket.io a la
  // sienne, ce n'est pas app.use(cors()) qui la couvre) — même liste
  // d'origines que l'API, importée depuis lib/origines.ts pour ne jamais
  // diverger.
  io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    cors: { origin: verifierOrigine, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== "string" || !token) {
        return next(new Error("Authentification requise"));
      }
      const payload = verifyToken(token);

      // Session unique (section 3.7) : même contrôle que requireAuth côté HTTP —
      // un socket ouvert avec un sid périmé n'est pas admis.
      const session = await prisma.utilisateur.findUnique({
        where: { id: payload.sub },
        select: { sessionActuelleId: true },
      });
      if (!session) return next(new Error("Compte introuvable ou désactivé"));
      if (!payload.sid || payload.sid !== session.sessionActuelleId) {
        return next(new Error(MESSAGE_SESSION_REMPLACEE));
      }

      const utilisateur = await chargerUtilisateur(payload.sub);
      if (!utilisateur) return next(new Error("Compte introuvable ou désactivé"));
      socket.data.utilisateur = utilisateur;
      next();
    } catch {
      next(new Error("Jeton invalide ou expiré"));
    }
  });

  io.on("connection", (socket) => {
    const u = socket.data.utilisateur;
    socket.join(roomUtilisateur(u.id));
    socket.join(roomRole(u.role.id));
  });

  return io;
}

export function getIo(): IoServer {
  if (!io) throw new Error("Socket.io n'est pas initialisé (initRealtime manquant)");
  return io;
}

/**
 * Session unique (section 3.7) : appelée juste après qu'une connexion a
 * remplacé le sid d'un utilisateur. Si un socket de cet utilisateur tourne
 * encore ailleurs, on le prévient en temps réel avant de le déconnecter —
 * plutôt que de le laisser découvrir l'invalidation à sa prochaine requête
 * HTTP. `io` peut être `null` (initRealtime pas encore appelé, ex. tests) :
 * no-op silencieux, la vérification côté requireAuth reste le filet de sécurité.
 */
export function invaliderSessionUtilisateur(utilisateurId: string): void {
  if (!io) return;
  const room = roomUtilisateur(utilisateurId);
  io.to(room).emit("sessionInvalidee", { message: MESSAGE_SESSION_REMPLACEE });
  io.in(room).disconnectSockets(true);
}
