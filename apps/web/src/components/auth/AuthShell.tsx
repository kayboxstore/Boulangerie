import * as React from "react";
import { useTranslation } from "react-i18next";
import { TAGLINE } from "@lomoto/shared";
import { cn } from "@/lib/utils";
import { LampeFicelle } from "./LampeFicelle";
import { usePrefersReducedMotion } from "./prefersReducedMotion";

export interface AuthShellProps {
  /** Contenu de la carte — titre, sous-titre et formulaire, fournis par chaque écran d'authentification. */
  children: React.ReactNode;
  className?: string;
}

/**
 * Enveloppe Premium commune à tous les écrans d'authentification (F2,
 * tâche 6) : connexion, mot de passe oublié, nouveau mot de passe.
 *
 * Principe d'accessibilité non négociable : le FORMULAIRE (`children`) est
 * TOUJOURS pleinement opaque, lisible et utilisable — jamais assombri,
 * jamais `pointer-events: none`, jamais retiré de l'ordre de tabulation.
 * La lampe à ficelle ne pilote qu'un effet décoratif (halo, éclat de
 * l'ampoule) autour de la scène de marque ; elle n'a jamais le pouvoir de
 * bloquer l'usage du formulaire, avec ou sans JavaScript actif, avec ou
 * sans réduction de mouvement. La « révélation progressive » (tâche 4) est
 * une animation d'ENTRÉE au montage (fondu + léger mouvement vers le haut),
 * indépendante de l'état de la lampe — jamais une condition d'accès au
 * contenu.
 *
 * Filigrane du logo : purement décoratif — `pointer-events-none`,
 * `aria-hidden`, `alt=""` — ne bloque aucun clic et n'est jamais annoncé
 * par une technologie d'assistance (tâche 3).
 */
function AuthShell({ children, className }: AuthShellProps) {
  const { t } = useTranslation();
  const reduireMouvement = usePrefersReducedMotion();
  // Sans mouvement : la scène démarre déjà dans son état final (allumée) —
  // rien ne dépend d'une interaction ou d'une animation pour être « complet ».
  const [allumee, setAllumee] = React.useState(reduireMouvement);

  // Si la préférence système change EN COURS d'affichage (rare mais possible
  // via les outils système), on ne force pas déjà-allumé après coup : seul
  // l'état initial en dépend, pour ne jamais interrompre un geste en cours.

  const basculerLampe = React.useCallback(() => setAllumee((v) => !v), []);

  const animEntree = (classe: string) => (reduireMouvement ? undefined : classe);

  return (
    <div className={cn("relative flex min-h-screen flex-col overflow-hidden bg-creme lg:flex-row dark:bg-background", className)}>
      {/* Filigrane du logo Lomoto — décoratif uniquement (tâche 3). */}
      <img
        src="/logo-lomoto.png"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 m-auto h-[65vmin] w-[65vmin] max-w-none select-none object-contain opacity-[0.045] dark:opacity-[0.07]"
      />

      {/* --- Panneau de marque + lampe (desktop) --- */}
      <div className="relative hidden flex-1 flex-col items-center justify-center overflow-hidden bg-marine px-10 text-creme lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 22% 18%, #DA9F4E 0, transparent 45%), radial-gradient(circle at 82% 82%, #AD5416 0, transparent 42%)",
          }}
        />
        {allumee && (
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute h-[30rem] w-[30rem] rounded-full bg-or/10 blur-3xl",
              animEntree("lomoto-authshell-halo"),
            )}
          />
        )}
        <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-or to-transparent" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-or/40 to-transparent" />

        <LampeFicelle allumee={allumee} onBasculer={basculerLampe} reduireMouvement={reduireMouvement} className="relative z-10 mb-6" />

        <div className={cn("relative flex flex-col items-center text-center", animEntree("lomoto-authshell-scene"))}>
          <img
            src="/logo-lomoto.png"
            alt="Logo Boulangerie Lomoto"
            className={cn(
              "h-40 w-40 rounded-full object-contain shadow-2xl ring-4 transition-[box-shadow] duration-500",
              allumee ? "ring-or/60 shadow-or/20" : "ring-or/25",
            )}
          />
          <h1 className="mt-8 font-serif text-4xl font-bold tracking-tight">
            Boulangerie <span className="text-or">Lomoto</span>
          </h1>
          <p className="mt-3 font-serif text-lg italic text-beige">« {TAGLINE} »</p>

          <div aria-hidden className="mt-7 flex items-center gap-3">
            <span className="h-px w-16 bg-or/40" />
            <span className="h-1.5 w-1.5 rotate-45 bg-or/70" />
            <span className="h-px w-16 bg-or/40" />
          </div>

          <p className="mt-7 max-w-sm text-sm leading-relaxed text-creme/60">{t("login.tagline")}</p>
        </div>
      </div>

      {/* --- Formulaire --- */}
      <div className="relative flex flex-1 items-center justify-center px-5 py-12">
        <div className={cn("w-full max-w-md", animEntree("lomoto-authshell-formulaire"))}>
          {/* Marque compacte + lampe, écrans sans panneau latéral (mobile/tablette) */}
          <div className="mb-9 flex flex-col items-center lg:hidden">
            <LampeFicelle allumee={allumee} onBasculer={basculerLampe} reduireMouvement={reduireMouvement} className="mb-3 text-marine dark:text-creme" />
            <img
              src="/logo-lomoto.png"
              alt="Logo Boulangerie Lomoto"
              className="h-24 w-24 rounded-full object-contain ring-4 ring-or/60"
            />
            <h1 className="mt-4 font-serif text-2xl font-bold text-marine dark:text-creme">
              Boulangerie <span className="text-or">Lomoto</span>
            </h1>
            <p className="mt-1 font-serif text-sm italic text-terracotta dark:text-or">« {TAGLINE} »</p>
          </div>

          {/* Le contenu (titre, sous-titre, formulaire) reste toujours pleinement
              opaque et interactif — voir la note d'en-tête du composant. */}
          {children}
        </div>
      </div>
    </div>
  );
}

export { AuthShell };
