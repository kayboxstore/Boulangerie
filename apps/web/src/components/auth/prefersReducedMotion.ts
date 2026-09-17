import { useEffect, useState } from "react";

const REQUETE = "(prefers-reduced-motion: reduce)";

function lireLaPreference(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REQUETE).matches;
}

/**
 * Reflète `prefers-reduced-motion` en direct (même modèle que
 * `lib/theme.tsx` pour `prefers-color-scheme`) : un changement de
 * préférence système pendant que l'app est ouverte est immédiatement pris
 * en compte, pas seulement au premier rendu.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduit, setReduit] = useState(lireLaPreference);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(REQUETE);
    const onChange = (e: MediaQueryListEvent) => setReduit(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduit;
}
