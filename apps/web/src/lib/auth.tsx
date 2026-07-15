import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { LoginResponse, Module, UtilisateurDTO } from "@lomoto/shared";
import { aAcces } from "@lomoto/shared";
import { api, getToken, setToken } from "./api";

interface AuthContextValue {
  utilisateur: UtilisateurDTO | null;
  chargement: boolean;
  login: (email: string, motDePasse: string) => Promise<void>;
  logout: () => void;
  peutLire: (module: Module) => boolean;
  peutEcrire: (module: Module) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [utilisateur, setUtilisateur] = useState<UtilisateurDTO | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setChargement(false);
      return;
    }
    api<{ utilisateur: UtilisateurDTO }>("/api/auth/me")
      .then((r) => setUtilisateur(r.utilisateur))
      .catch(() => setToken(null))
      .finally(() => setChargement(false));
  }, []);

  const login = useCallback(async (email: string, motDePasse: string) => {
    const r = await api<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, motDePasse }),
    });
    setToken(r.token);
    setUtilisateur(r.utilisateur);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUtilisateur(null);
  }, []);

  const peutLire = useCallback(
    (module: Module) => !!utilisateur && aAcces(utilisateur.role.permissions, module, "LECTURE"),
    [utilisateur],
  );
  const peutEcrire = useCallback(
    (module: Module) => !!utilisateur && aAcces(utilisateur.role.permissions, module, "ECRITURE"),
    [utilisateur],
  );

  return (
    <AuthContext.Provider value={{ utilisateur, chargement, login, logout, peutLire, peutEcrire }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans <AuthProvider>");
  return ctx;
}
