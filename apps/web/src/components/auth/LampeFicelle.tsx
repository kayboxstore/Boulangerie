import * as React from "react";
import { Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { demarrerGlissement, glissementDepasseSeuil, type EtatGlissementFicelle } from "./lampeLogique";

export interface LampeFicelleProps {
  allumee: boolean;
  onBasculer: () => void;
  /** Variante sans mouvement (prefers-reduced-motion) : pas de balancement ni de tirage animé, juste un changement d'état instantané. */
  reduireMouvement: boolean;
  className?: string;
}

/**
 * Lampe à ficelle décorative ET interactive de la scène de connexion (F2,
 * tâche 1-2). Un vrai `<button>` porte toute la zone cliquable : le clavier
 * (Entrée/Espace) fonctionne donc nativement, sans code dédié. Le clic
 * simple bascule l'état ; un glissement (souris ou tactile, via les
 * Pointer Events qui unifient les deux) vers le bas au-delà d'un seuil
 * (`lampeLogique.ts`) bascule l'état de la même façon, sans déclencher
 * aussi le `click` de fin de geste (`aBasculeParGlissement`).
 *
 * Propriété du geste (revue Codex round 2) : un seul pointeur — primaire, au
 * bouton principal — peut démarrer et poursuivre le glissement à la fois ;
 * `pointerIdActif` mémorise lequel, et tout événement d'un autre pointeur
 * (doigt secondaire, pointeur inconnu) est ignoré tant que celui-là est en
 * cours. Un clic droit ne démarre jamais le geste (et ne bascule jamais via
 * `onClick` non plus, filet de sécurité indépendant). `pointercancel`
 * nettoie l'état du geste ET remet `aBasculeParGlissement` à zéro : aucun
 * `click` de synthèse ne suit un `pointercancel`, donc rien ne doit rester
 * en attente pour « avaler » la prochaine activation clavier ou le prochain
 * clic normal.
 */
function LampeFicelle({ allumee, onBasculer, reduireMouvement, className }: LampeFicelleProps) {
  const { t } = useTranslation();
  const glissementRef = React.useRef<EtatGlissementFicelle | null>(null);
  const aBasculeParGlissement = React.useRef(false);
  const pointerIdActifRef = React.useRef<number | null>(null);

  const gererPointerDown = React.useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    // Un geste actif exclut tout autre pointeur ; seul un pointeur primaire
    // (pas un doigt secondaire multi-touch) au bouton principal (jamais un
    // clic droit, `button` 0 = principal) peut en démarrer un nouveau.
    if (pointerIdActifRef.current !== null) return;
    if (!e.isPrimary || e.button !== 0) return;

    pointerIdActifRef.current = e.pointerId;
    glissementRef.current = demarrerGlissement(e.clientY);
    aBasculeParGlissement.current = false;
    // Absent de certains environnements (anciens navigateurs, jsdom en test) :
    // sans capture, le geste reste fonctionnel, juste moins robuste si le
    // pointeur quitte la zone du bouton en cours de glissement.
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const gererPointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      // Seul le pointeur propriétaire du geste (celui du `pointerDown`
      // accepté) peut le poursuivre — un pointeur étranger ou secondaire est
      // ignoré sans effet de bord.
      if (pointerIdActifRef.current !== e.pointerId) return;
      if (!glissementRef.current || aBasculeParGlissement.current) return;
      if (glissementDepasseSeuil(glissementRef.current, e.clientY)) {
        aBasculeParGlissement.current = true;
        onBasculer();
      }
    },
    [onBasculer],
  );

  const gererFinGlissement = React.useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdActifRef.current !== e.pointerId) return;
    pointerIdActifRef.current = null;
    glissementRef.current = null;
    // `aBasculeParGlissement` n'est PAS remis à zéro ici : le `click` de
    // synthèse qui suit normalement ce `pointerup` doit encore être avalé
    // une seule fois par `gererClic` ci-dessous.
  }, []);

  const gererAnnulation = React.useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdActifRef.current !== e.pointerId) return;
    pointerIdActifRef.current = null;
    glissementRef.current = null;
    // Contrairement à `pointerup`, aucun `click` de synthèse ne suit un
    // `pointercancel` : rien ne viendra jamais consommer ce drapeau, donc on
    // le nettoie ici pour ne jamais neutraliser la prochaine activation
    // (clavier ou clic normal, sans rapport avec ce geste annulé).
    aBasculeParGlissement.current = false;
  }, []);

  const gererClic = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // Filet de sécurité indépendant du suivi par pointeur : un clic droit
      // ne bascule jamais la lampe (en pratique déjà exclu par les
      // navigateurs, qui n'émettent pas de `click` sur clic droit).
      if (e.button !== 0) return;
      // Le `click` qui suit un geste de glissement ne doit pas redéclencher un
      // second basculement — celui-ci a déjà eu lieu pendant le déplacement.
      if (aBasculeParGlissement.current) {
        aBasculeParGlissement.current = false;
        return;
      }
      onBasculer();
    },
    [onBasculer],
  );

  const libelle = t(allumee ? "auth.lamp.turnOff" : "auth.lamp.turnOn");

  return (
    <button
      type="button"
      onClick={gererClic}
      onPointerDown={gererPointerDown}
      onPointerMove={gererPointerMove}
      onPointerUp={gererFinGlissement}
      onPointerCancel={gererAnnulation}
      aria-pressed={allumee}
      aria-label={libelle}
      title={libelle}
      className={cn(
        // min-w-11/min-h-11 = 44×44 px réels (même convention que
        // `PasswordField`) : l'icône seule (36 px) ne suffisait pas comme
        // cible tactile, `justify-center` garde la composition visuelle
        // centrée dans la zone élargie.
        "group relative flex min-h-11 min-w-11 touch-none select-none flex-col items-center justify-center gap-0.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-marine",
        className,
      )}
    >
      <Lightbulb
        aria-hidden
        className={cn(
          "h-9 w-9 transition-colors",
          // État éteint : `text-current/40` hérite la couleur de base posée par
          // l'appelant (crème sur le panneau marine du bureau, marine/crème
          // selon le thème dans l'en-tête compact mobile) — un ton fixe casserait
          // le contraste sur l'un des deux fonds (défaut révélé par les
          // captures d'écran F2).
          allumee ? "fill-or/90 text-or drop-shadow-[0_0_10px_rgba(218,159,78,0.65)]" : "fill-transparent text-current/40",
          !reduireMouvement && "duration-500",
        )}
      />
      {/* Cordon + poignée : purement décoratifs (aria-hidden), le libellé
          accessible est déjà porté par le bouton lui-même. */}
      <span
        aria-hidden
        className={cn(
          "h-10 w-px origin-top bg-current/40",
          !reduireMouvement && "lomoto-cordon transition-transform duration-300 group-active:scale-y-110",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "h-2.5 w-2.5 rounded-full bg-or shadow-sm transition-transform",
          !reduireMouvement && "duration-300 group-hover:translate-y-0.5 group-active:translate-y-1.5",
        )}
      />
    </button>
  );
}

export { LampeFicelle };
