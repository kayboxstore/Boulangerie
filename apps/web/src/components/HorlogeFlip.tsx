import * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { dateTimeAttribut, decomposerHeureKinshasa } from "./horlogeLogique";

export interface HorlogeFlipProps {
  className?: string;
}

/**
 * Horloge « flip » compacte de l'en-tête (F2, tâche 12). Composant isolé :
 * son propre `setInterval`, nettoyé au démontage — jamais de rafraîchissement
 * de tout l'arbre applicatif, seul CE composant se re-rend chaque seconde
 * (React ne propage un `setState` qu'au sous-arbre du composant qui le
 * déclenche). Toujours affichée dans le fuseau Africa/Kinshasa
 * (`horlogeLogique.ts`), indépendamment du fuseau du navigateur.
 */
function HorlogeFlip({ className }: HorlogeFlipProps) {
  const { t } = useTranslation();
  const [heure, setHeure] = React.useState(() => decomposerHeureKinshasa(new Date()));

  React.useEffect(() => {
    const id = setInterval(() => {
      setHeure(decomposerHeureKinshasa(new Date()));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // `role="timer"` + `aria-live="off"` (jamais "status") : le libellé change
  // chaque seconde, une région bavarde interromprait continuellement les
  // lecteurs d'écran. L'heure reste consultable à la demande (aria-label,
  // `dateTime`), simplement pas annoncée automatiquement.
  return (
    <time
      role="timer"
      aria-live="off"
      dateTime={dateTimeAttribut(heure)}
      aria-label={t("auth.clock.ariaLabel", { heures: heure.heures, minutes: heure.minutes, secondes: heure.secondes })}
      className={cn("flex items-center gap-0.5 font-mono text-xs tabular-nums", className)}
    >
      <ChiffreFlip valeur={heure.heures} />
      <span aria-hidden className="opacity-60">
        :
      </span>
      <ChiffreFlip valeur={heure.minutes} />
      <span aria-hidden className="hidden opacity-60 sm:inline">
        :
      </span>
      <ChiffreFlip valeur={heure.secondes} className="hidden sm:inline-flex" />
    </time>
  );
}

/** Une paire de chiffres (ex. "14"), rendue dans un petit cadre "flip" — purement visuel, aria-hidden (le libellé complet vit sur le conteneur). */
function ChiffreFlip({ valeur, className }: { valeur: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex min-w-[1.6em] items-center justify-center rounded bg-current/10 px-1 py-0.5 text-current",
        className,
      )}
    >
      {valeur}
    </span>
  );
}

export { HorlogeFlip };
