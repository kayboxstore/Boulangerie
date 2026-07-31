import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import type { NotificationDTO, ServerToClientEvents, ClientToServerEvents } from "@lomoto/shared";
import { MESSAGE_SESSION_REMPLACEE } from "@lomoto/shared";
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
  const { utilisateur, deconnexionForcee } = useAuth();
  const queryClient = useQueryClient();
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

    // socket.io-client est chargé en import dynamique : la lib (~volumineuse)
    // n'entre pas dans le chunk initial et n'est récupérée qu'une fois
    // l'utilisateur connecté — jamais sur l'écran de connexion.
    let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;
    void import("socket.io-client").then(({ io }) => {
      if (!actif) return;
      socket = io({ auth: { token: getToken() } });

      socket.on("connect", () => {
        setStatut("connecte");
        chargerHistorique(); // rattrapage après (re)connexion
      });
      socket.io.on("reconnect_attempt", () => setStatut("reconnexion"));
      socket.on("disconnect", () => setStatut("reconnexion"));
      socket.on("connect_error", (err) => {
        // Session unique (section 3.7) : une tentative de (re)connexion peut
        // porter un sid déjà périmé (ex. onglet resté ouvert) — le handshake
        // middleware la rejette alors avec ce message précis. Filet de sécurité
        // en plus de l'événement `sessionInvalidee` (cas d'un socket déjà ouvert).
        if (err.message === MESSAGE_SESSION_REMPLACEE) {
          deconnexionForcee(err.message);
          return;
        }
        setStatut("reconnexion");
      });

      socket.on("sessionInvalidee", (payload) => {
        deconnexionForcee(payload.message);
      });

      socket.on("notification", (notification) => {
        if (!actif) return;
        setNotifications((prev) => [notification, ...prev].slice(0, MAX_FEED));
        setNonLues((prev) => prev + 1);
        // Rafraîchit les listes concernées par l'événement, sans rechargement.
        if (notification.module === "COMMANDES") {
          queryClient.invalidateQueries({ queryKey: ["commandes"] });
          queryClient.invalidateQueries({ queryKey: ["commissions"] });
          queryClient.invalidateQueries({ queryKey: ["clients"] });
        }
        if (notification.module === "CAISSE") {
          queryClient.invalidateQueries({ queryKey: ["ventes"] });
          queryClient.invalidateQueries({ queryKey: ["clotures"] });
        }
      });

      // Assistant (section 3.19) : mise à jour temps réel du fil ouvert (côté
      // utilisateur comme côté file Admin) — en plus du badge de notification
      // générique ci-dessus, qui prévient même si la vue n'est pas ouverte.
      socket.on("messageSupport", () => {
        if (!actif) return;
        queryClient.invalidateQueries({ queryKey: ["assistant-ma-conversation"] });
        queryClient.invalidateQueries({ queryKey: ["assistant-conversations"] });
      });
      socket.on("conversationSupportFermee", () => {
        if (!actif) return;
        queryClient.invalidateQueries({ queryKey: ["assistant-ma-conversation"] });
        queryClient.invalidateQueries({ queryKey: ["assistant-conversations"] });
      });
      socket.on("conversationSupportEscaladee", () => {
        if (!actif) return;
        queryClient.invalidateQueries({ queryKey: ["assistant-ma-conversation"] });
        queryClient.invalidateQueries({ queryKey: ["assistant-conversations"] });
      });
    });

    return () => {
      actif = false;
      socket?.disconnect();
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
