import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import type { NotificationDTO, ServerToClientEvents, ClientToServerEvents } from "@lomoto/shared";
import { api, getToken } from "./api";
import { useAuth } from "./auth";

export type StatutConnexion = "connecte" | "reconnexion" | "deconnecte";

interface SocketContextValue {
  statut: StatutConnexion;
  notifications: NotificationDTO[];
  nonLues: number;
  marquerLue: (id: string) => Promise<void>;
  toutMarquerLu: () => Promise<void>;
}

const SocketContext = createContext<SocketContextValue | null>(null);

const MAX_FEED = 100;

export function SocketProvider({ children }: { children: ReactNode }) {
  const { utilisateur } = useAuth();
  const [statut, setStatut] = useState<StatutConnexion>("deconnecte");
  const [notifications, setNotifications] = useState<NotificationDTO[]>([]);
  const [nonLues, setNonLues] = useState(0);

  // Connexion Socket.io authentifiée — vit tant que l'utilisateur est connecté.
  // socket.io-client gère la reconnexion automatique ; à chaque reconnexion on
  // recharge l'historique pour rattraper ce qui a été manqué hors ligne.
  useEffect(() => {
    if (!utilisateur) {
      setNotifications([]);
      setNonLues(0);
      setStatut("deconnecte");
      return;
    }

    let actif = true;

    const chargerHistorique = () => {
      api<{ notifications: NotificationDTO[]; nonLues: number }>("/api/notifications")
        .then((r) => {
          if (!actif) return;
          setNotifications(r.notifications);
          setNonLues(r.nonLues);
        })
        .catch(() => {});
    };

    chargerHistorique();

    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
      auth: { token: getToken() },
    });

    socket.on("connect", () => {
      setStatut("connecte");
      chargerHistorique(); // rattrapage après (re)connexion
    });
    socket.io.on("reconnect_attempt", () => setStatut("reconnexion"));
    socket.on("disconnect", () => setStatut("reconnexion"));
    socket.on("connect_error", () => setStatut("reconnexion"));

    socket.on("notification", (notification) => {
      if (!actif) return;
      setNotifications((prev) => [notification, ...prev].slice(0, MAX_FEED));
      setNonLues((prev) => prev + 1);
    });

    return () => {
      actif = false;
      socket.disconnect();
      setStatut("deconnecte");
    };
  }, [utilisateur?.id]);

  const marquerLue = useCallback(async (id: string) => {
    setNotifications((prev) => {
      const cible = prev.find((n) => n.id === id);
      if (!cible || cible.lu) return prev;
      setNonLues((c) => Math.max(0, c - 1));
      return prev.map((n) => (n.id === id ? { ...n, lu: true } : n));
    });
    await api(`/api/notifications/${id}/lu`, { method: "POST" }).catch(() => {});
  }, []);

  const toutMarquerLu = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, lu: true })));
    setNonLues(0);
    await api("/api/notifications/lu", { method: "POST" }).catch(() => {});
  }, []);

  const value = useMemo(
    () => ({ statut, notifications, nonLues, marquerLue, toutMarquerLu }),
    [statut, notifications, nonLues, marquerLue, toutMarquerLu],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket(): SocketContextValue {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error("useSocket doit être utilisé dans <SocketProvider>");
  return ctx;
}
