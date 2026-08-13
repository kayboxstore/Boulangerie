import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { EtatInitialDTO, Langue, LoginResponse, Module, UtilisateurDTO } from "@lomoto/shared";
import { aAcces, LANGUE_DEFAUT_PAR_DEFAUT, langueEffective } from "@lomoto/shared";
import { api, getToken, setToken, surSessionRemplacee } from "./api";
import { appliquerLangue } from "@/i18n";

interface AuthContextValue {
  utilisateur: UtilisateurDTO | null;
  chargement: boolean;
  login: (email: string, motDePasse: string) => Promise<void>;
  logout: () => void;
  peutLire: (module: Module) => boolean;
  peutEcrire: (module: Module) => boolean;
  /** Langue par défaut de la boutique (repli quand l'utilisateur n'a pas de préférence). */
  langueDefautBoutique: Langue;
  /** Change sa propre préférence de langue (null = suivre la boutique). */
  changerLangue: (langue: Langue | null) => Promise<void>;
  /** Session unique (section 3.7) : message à afficher sur /connexion après une
   *  déconnexion forcée (autre appareil), distinct d'une erreur de connexion. */
  messageSessionRemplacee: string | null;
  /** Déconnecte immédiatement avec un message dédié (401 SESSION_REMPLACEE ou
   *  événement Socket.io `sessionInvalidee`). */
  deconnexionForcee: (message: string) => void;
  /** Assistant de premier lancement (3.7) : true si la base ne contient aucun
   *  compte Utilisateur (premier démarrage, ou juste après une réinitialisation). */
  premierLancement: boolean;
  /**
   * Recharge l'identité depuis `GET /api/auth/me` sans repasser par `login()`
   * (F3, changement de mot de passe obligatoire) : après un `POST
   * /api/auth/mot-de-passe` réussi, `motDePasseDoitChanger` doit repasser à
   * `false` UNIQUEMENT une fois confirmé par le serveur — jamais en local en
   * anticipant la réponse.
   */
  rafraichirIdentite: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [utilisateur, setUtilisateur] = useState<UtilisateurDTO | null>(null);
  const [langueDefautBoutique, setLangueDefautBoutique] = useState<Langue>(LANGUE_DEFAUT_PAR_DEFAUT);
  const [chargement, setChargement] = useState(true);
  const [messageSessionRemplacee, setMessageSessionRemplacee] = useState<string | null>(null);
  const [premierLancement, setPremierLancement] = useState(false);

  // Applique la langue effective : préférence de l'utilisateur, sinon boutique.
  const appliquer = useCallback((u: UtilisateurDTO | null, defautBoutique: Langue) => {
    appliquerLangue(langueEffective(u?.languePreferee ?? null, defautBoutique));
  }, []);

  // Assistant de premier lancement (3.7) : revérifié après toute déconnexion
  // forcée (ex. réinitialisation de la base, section 3.15) — le premier
  // chargement seul ne suffit pas, l'état peut changer en cours de session.
  const rafraichirEtatInitial = useCallback(async () => {
    try {
      const r = await api<EtatInitialDTO>("/api/auth/etat-initial");
      setPremierLancement(r.premierLancement);
    } catch {
      // Au pire, l'écran de connexion normal reste affiché.
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      // Pré-connexion : la page de connexion suit la langue par défaut boutique.
      Promise.all([
        api<{ langueDefaut: Langue }>("/api/auth/langue-defaut").catch(() => null),
        api<EtatInitialDTO>("/api/auth/etat-initial").catch(() => null),
      ])
        .then(([langueRes, etatRes]) => {
          if (langueRes) {
            setLangueDefautBoutique(langueRes.langueDefaut);
            appliquer(null, langueRes.langueDefaut);
          }
          if (etatRes) setPremierLancement(etatRes.premierLancement);
        })
        .finally(() => setChargement(false));
      return;
    }
    api<{ utilisateur: UtilisateurDTO; langueDefautBoutique: Langue }>("/api/auth/me")
      .then((r) => {
        setUtilisateur(r.utilisateur);
        setLangueDefautBoutique(r.langueDefautBoutique);
        appliquer(r.utilisateur, r.langueDefautBoutique);
      })
      .catch(() => setToken(null))
      .finally(() => setChargement(false));
  }, [appliquer]);

  const login = useCallback(
    async (email: string, motDePasse: string) => {
      const r = await api<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, motDePasse }),
      });
      setToken(r.token);
      setUtilisateur(r.utilisateur);
      setLangueDefautBoutique(r.langueDefautBoutique);
      setMessageSessionRemplacee(null);
      appliquer(r.utilisateur, r.langueDefautBoutique);
    },
    [appliquer],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUtilisateur(null);
    setMessageSessionRemplacee(null);
    // Retour à la langue par défaut de la boutique après déconnexion.
    appliquer(null, langueDefautBoutique);
  }, [appliquer, langueDefautBoutique]);

  const deconnexionForcee = useCallback(
    (message: string) => {
      setToken(null);
      setUtilisateur(null);
      setMessageSessionRemplacee(message);
      appliquer(null, langueDefautBoutique);
      // Couvre le cas réinitialisation (3.15) : plus aucun compte n'existe,
      // l'écran de connexion doit céder la place à l'assistant de premier lancement.
      rafraichirEtatInitial();
    },
    [appliquer, langueDefautBoutique, rafraichirEtatInitial],
  );

  // Enregistre l'écouteur de session-remplacée auprès de lib/api.ts (401
  // SESSION_REMPLACEE sur n'importe quelle requête) ; socket.tsx appelle
  // deconnexionForcee directement pour le cas temps réel.
  useEffect(() => {
    surSessionRemplacee(deconnexionForcee);
    return () => surSessionRemplacee(null);
  }, [deconnexionForcee]);

  const rafraichirIdentite = useCallback(async () => {
    const r = await api<{ utilisateur: UtilisateurDTO; langueDefautBoutique: Langue }>("/api/auth/me");
    setUtilisateur(r.utilisateur);
    setLangueDefautBoutique(r.langueDefautBoutique);
    appliquer(r.utilisateur, r.langueDefautBoutique);
  }, [appliquer]);

  const changerLangue = useCallback(
    async (langue: Langue | null) => {
      const r = await api<{ utilisateur: UtilisateurDTO; langueDefautBoutique: Langue }>("/api/auth/langue", {
        method: "PUT",
        body: JSON.stringify({ languePreferee: langue }),
      });
      setUtilisateur(r.utilisateur);
      setLangueDefautBoutique(r.langueDefautBoutique);
      appliquer(r.utilisateur, r.langueDefautBoutique);
    },
    [appliquer],
  );

  const peutLire = useCallback(
    (module: Module) => !!utilisateur && aAcces(utilisateur.role.permissions, module, "LECTURE"),
    [utilisateur],
  );
  const peutEcrire = useCallback(
    (module: Module) => !!utilisateur && aAcces(utilisateur.role.permissions, module, "ECRITURE"),
    [utilisateur],
  );

  return (
    <AuthContext.Provider
      value={{
        utilisateur,
        chargement,
        login,
        logout,
        peutLire,
        peutEcrire,
        langueDefautBoutique,
        changerLangue,
        messageSessionRemplacee,
        deconnexionForcee,
        premierLancement,
        rafraichirIdentite,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans <AuthProvider>");
  return ctx;
}
