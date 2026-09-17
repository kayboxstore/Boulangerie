import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

const CLE_THEME = "lomoto_theme";

function preferenceSystemeSombre(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function lireThemeStocke(): "light" | "dark" | null {
  const v = localStorage.getItem(CLE_THEME);
  return v === "light" || v === "dark" ? v : null;
}

function appliquerClasseDark(sombre: boolean) {
  document.documentElement.classList.toggle("dark", sombre);
}

/**
 * Applique le thème AVANT le premier rendu React — appelé au tout début de
 * main.tsx, avant `createRoot(...).render(...)`, pour ne jamais afficher un
 * thème puis basculer sur l'autre au montage (flash).
 */
export function initTheme() {
  const stocke = lireThemeStocke();
  appliquerClasseDark(stocke ? stocke === "dark" : preferenceSystemeSombre());
}

interface ThemeContextValue {
  sombre: boolean;
  basculer: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [sombre, setSombre] = useState(() => {
    const stocke = lireThemeStocke();
    return stocke ? stocke === "dark" : preferenceSystemeSombre();
  });

  useEffect(() => {
    appliquerClasseDark(sombre);
  }, [sombre]);

  // Tant que l'utilisateur n'a jamais choisi explicitement (préférence device,
  // pas de compte), l'app continue de suivre les changements système en direct.
  useEffect(() => {
    if (lireThemeStocke()) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSombre(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const basculer = useCallback(() => {
    setSombre((prev) => {
      const suivant = !prev;
      localStorage.setItem(CLE_THEME, suivant ? "dark" : "light");
      return suivant;
    });
  }, []);

  return <ThemeContext.Provider value={{ sombre, basculer }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme doit être utilisé dans <ThemeProvider>");
  return ctx;
}
