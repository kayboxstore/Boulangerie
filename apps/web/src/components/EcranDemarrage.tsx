import { useEffect, useState } from "react";
import { TAGLINE } from "@lomoto/shared";

/** Durée d'affichage (section 3.8 : 6 à 8 secondes) puis fondu de sortie. */
const DUREE_MS = 7000;
const FONDU_MS = 600;
const CLE_SESSION = "lomoto_splash_vu";

/** L'écran n'apparaît qu'au PREMIER chargement de la session, pas à chaque
 *  navigation interne. `sessionStorage` survit à un rafraîchissement d'onglet,
 *  ce qui est exactement le comportement voulu. */
export function splashDejaVu(): boolean {
  try {
    return sessionStorage.getItem(CLE_SESSION) === "1";
  } catch {
    return true; // navigation privée verrouillée : on n'insiste pas
  }
}

function marquerVu() {
  try {
    sessionStorage.setItem(CLE_SESSION, "1");
  } catch {
    /* sans stockage, l'écran ne réapparaîtra de toute façon pas dans ce rendu */
  }
}

/**
 * Écran de démarrage (section 3.8) — logo animé sur fond marine, accents or,
 * jauge de progression calée sur la durée d'affichage. Animations en CSS pur
 * (voir index.css) : c'est le premier rendu de l'app, il ne doit pas alourdir
 * le chunk initial.
 */
export function EcranDemarrage({ onTermine }: { onTermine: () => void }) {
  const [sortie, setSortie] = useState(false);

  useEffect(() => {
    const versSortie = setTimeout(() => setSortie(true), DUREE_MS - FONDU_MS);
    const fin = setTimeout(() => {
      marquerVu();
      onTermine();
    }, DUREE_MS);
    return () => {
      clearTimeout(versSortie);
      clearTimeout(fin);
    };
  }, [onTermine]);

  return (
    <div
      role="status"
      aria-label="Chargement de Boulangerie Lomoto"
      style={{ ["--duree-splash" as string]: `${DUREE_MS}ms` }}
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-marine ${
        sortie ? "lomoto-splash-sortie" : ""
      }`}
    >
      {/* Halo doré derrière le logo + quelques grains de blé qui s'élèvent */}
      <div
        aria-hidden
        className="lomoto-splash-halo pointer-events-none absolute h-[26rem] w-[26rem] rounded-full bg-or/20 blur-3xl"
      />
      {[
        { gauche: "18%", delai: "0s" },
        { gauche: "34%", delai: "1.1s" },
        { gauche: "62%", delai: "0.5s" },
        { gauche: "79%", delai: "1.7s" },
      ].map((g) => (
        <span
          key={g.gauche}
          aria-hidden
          className="lomoto-grain pointer-events-none absolute bottom-1/3 h-1.5 w-1.5 rounded-full bg-or/60"
          style={{ left: g.gauche, animationDelay: g.delai }}
        />
      ))}

      <div className="lomoto-splash relative flex flex-col items-center px-6 text-center">
        <img
          src="/logo-lomoto.png"
          alt="Logo Boulangerie Lomoto"
          className="lomoto-splash-logo h-32 w-32 rounded-full object-contain ring-4 ring-or/70 sm:h-40 sm:w-40"
        />

        <h1 className="lomoto-splash-titre mt-7 font-serif text-3xl font-bold tracking-tight text-creme sm:text-4xl">
          Boulangerie <span className="text-or">Lomoto</span>
        </h1>

        <p className="lomoto-splash-tagline mt-2 font-serif text-lg italic text-or/90">« {TAGLINE} »</p>

        {/* Jauge de progression : sa durée suit exactement celle de l'écran */}
        <div aria-hidden className="mt-9 h-0.5 w-52 overflow-hidden rounded-full bg-creme/15">
          <div className="lomoto-splash-jauge h-full w-full bg-gradient-to-r from-or/50 to-or" />
        </div>

        <p className="lomoto-splash-credit mt-8 text-[11px] uppercase tracking-[0.2em] text-creme/40">
          Gestion commerciale
        </p>
      </div>
    </div>
  );
}
