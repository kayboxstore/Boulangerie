import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Socket } from "socket.io-client";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { NotificationDTO, ServerToClientEvents, ClientToServerEvents } from "@lomoto/shared";
import { MESSAGE_SESSION_REMPLACEE } from "@lomoto/shared";
import { api, getToken } from "./api";
import { useAuth } from "./auth";
import { emettreToast } from "@/components/toast/toastBus";
import {
  annulerApresEchec,
  compterNonLues,
  confirmerSucces,
  creerRegistreDePropriete,
  demarrerMarquerLue,
  demarrerToutMarquerLu,
  type EtatNotifications,
} from "./notificationsRollback";

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
  const { t } = useTranslation();
  const [statut, setStatut] = useState<StatutConnexion>("deconnecte");
  const [notifications, setNotifications] = useState<NotificationDTO[]>([]);
  const [nonLues, setNonLues] = useState(0);

  // Source canonique SYNCHRONE (correction revue Codex, round 3) : React ne
  // garantit pas qu'un setter s'exécute avant la ligne suivante — capturer
  // une variable dans `setNotifications(prev => ...)` puis la relire juste
  // après (versions précédentes) n'est donc pas fiable. `etatRef` est la
  // vérité immédiate ; `appliquerEtat` est l'UNIQUE façon de la modifier,
  // et synchronise systématiquement la ref et l'état React exposé au
  // contexte dans le même geste. `nonLues` exposé au contexte est toujours
  // DÉRIVÉ via `compterNonLues` (voir notificationsRollback.ts) — jamais un
  // compteur suivi indépendamment.
  const etatRef = useRef<EtatNotifications<NotificationDTO>>({ notifications: [], resteNonLues: 0 });

  const appliquerEtat = useCallback((etat: EtatNotifications<NotificationDTO>) => {
    etatRef.current = etat;
    setNotifications(etat.notifications);
    setNonLues(compterNonLues(etat));
  }, []);

  // Registre de propriété par identifiant (voir lib/notificationsRollback.ts) :
  // survit aux re-rendus (useRef) pour que marquerLue et toutMarquerLu, même
  // concurrents, sachent lequel des deux a le droit d'annuler quoi en cas
  // d'échec réseau.
  const registrePropriete = useRef(creerRegistreDePropriete<symbol>());

  // Connexion Socket.io authentifiée — vit tant que l'utilisateur est connecté.
  // socket.io-client gère la reconnexion automatique ; à chaque reconnexion on
  // recharge l'historique pour rattraper ce qui a été manqué hors ligne.
  useEffect(() => {
    if (!utilisateur) {
      appliquerEtat({ notifications: [], resteNonLues: 0 });
      setStatut("deconnecte");
      return;
    }

    let actif = true;

    const chargerHistorique = () => {
      api<{ notifications: NotificationDTO[]; nonLues: number }>("/api/notifications")
        .then((r) => {
          if (!actif) return;
          // Décompose le total autoritatif du serveur en "reste non chargé"
          // + décompte du tableau reçu — voir compterNonLues, qui recombine
          // les deux à l'affichage.
          const nonLuesDansLeTableau = r.notifications.filter((n) => !n.lu).length;
          appliquerEtat({
            notifications: r.notifications,
            resteNonLues: Math.max(0, r.nonLues - nonLuesDansLeTableau),
          });
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
        // Une arrivée temps réel ne touche jamais `resteNonLues` : la
        // nouvelle notification est directement ajoutée au tableau chargé,
        // et `compterNonLues` la comptabilise automatiquement (non lue).
        appliquerEtat({
          notifications: [notification, ...etatRef.current.notifications].slice(0, MAX_FEED),
          resteNonLues: etatRef.current.resteNonLues,
        });
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
    // `appliquerEtat` est stable (useCallback à dépendances vides) ; `queryClient`
    // et `deconnexionForcee` le sont également dans ce projet (contexte React
    // stable) — dépendances inchangées par rapport à l'original pour ne pas
    // risquer une reconnexion Socket.io à chaque rendu.
  }, [utilisateur?.id]);

  // marquerLue et toutMarquerLu délèguent l'intégralité de la décision
  // (optimiste, propriété, restauration) aux orchestrateurs purs de
  // notificationsRollback.ts — les MÊMES fonctions que celles exercées par
  // notificationsRollback.test.ts, sans aucune logique parallèle ici.
  const marquerLue = useCallback(
    async (id: string) => {
      const demarrage = demarrerMarquerLue(etatRef.current, id, registrePropriete.current);
      if (!demarrage.aDemarre) return; // déjà lue ou introuvable : rien à faire, rien à annuler

      appliquerEtat(demarrage.etat);

      try {
        await api(`/api/notifications/${id}/lu`, { method: "POST" });
        appliquerEtat(confirmerSucces(etatRef.current, demarrage.idsReclames, registrePropriete.current));
      } catch {
        const resultat = annulerApresEchec(
          etatRef.current,
          demarrage.idsReclames,
          demarrage.jeton,
          demarrage.resteNonLuesAvant,
          registrePropriete.current,
        );
        if (resultat === null) return; // une action plus récente (ex. toutMarquerLu) a repris la main entre-temps
        appliquerEtat(resultat);
        emettreToast({ variante: "erreur", message: t("premium.socket.echecMarquerLue") });
      }
    },
    [t, appliquerEtat],
  );

  const toutMarquerLu = useCallback(async () => {
    const demarrage = demarrerToutMarquerLu(etatRef.current, registrePropriete.current);
    if (!demarrage.aDemarre) return;

    appliquerEtat(demarrage.etat);

    try {
      await api("/api/notifications/lu", { method: "POST" });
      appliquerEtat(confirmerSucces(etatRef.current, demarrage.idsReclames, registrePropriete.current));
    } catch {
      const resultat = annulerApresEchec(
        etatRef.current,
        demarrage.idsReclames,
        demarrage.jeton,
        demarrage.resteNonLuesAvant,
        registrePropriete.current,
      );
      if (resultat === null) return;
      appliquerEtat(resultat);
      emettreToast({ variante: "erreur", message: t("premium.socket.echecToutMarquerLu") });
    }
  }, [t, appliquerEtat]);

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
