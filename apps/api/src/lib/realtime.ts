import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents, UtilisateurDTO } from "@lomoto/shared";
import { verifyToken } from "./jwt.js";
import { chargerUtilisateur } from "../middleware/auth.js";
import { verifierOrigine } from "./origines.js";

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
