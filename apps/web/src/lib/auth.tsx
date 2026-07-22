import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Langue, LoginResponse, Module, UtilisateurDTO } from "@lomoto/shared";
import { aAcces, LANGUE_DEFAUT_PAR_DEFAUT, langueEffective } from "@lomoto/shared";
import { api, getToken, setToken } from "./api";
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
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [utilisateur, setUtilisateur] = useState<UtilisateurDTO | null>(null);
  const [langueDefautBoutique, setLangueDefautBoutique] = useState<Langue>(LANGUE_DEFAUT_PAR_DEFAUT);
  const [chargement, setChargement] = useState(true);

  // Applique la langue effective : préférence de l'utilisateur, sinon boutique.
  const appliquer = useCallback((u: UtilisateurDTO | null, defautBoutique: Langue) => {
    appliquerLangue(langueEffective(u?.languePreferee ?? null, defautBoutique));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      // Pré-connexion : la page de connexion suit la langue par défaut boutique.
      api<{ langueDefaut: Langue }>("/api/auth/langue-defaut")
        .then((r) => {
          setLangueDefautBoutique(r.langueDefaut);
          appliquer(null, r.langueDefaut);
        })
        .catch(() => {})
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
      appliquer(r.utilisateur, r.langueDefautBoutique);
    },
    [appliquer],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUtilisateur(null);
    // Retour à la langue par défaut de la boutique après déconnexion.
    appliquer(null, langueDefautBoutique);
  }, [appliquer, langueDefautBoutique]);

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
      value={{ utilisateur, chargement, login, logout, peutLire, peutEcrire, langueDefautBoutique, changerLangue }}
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
