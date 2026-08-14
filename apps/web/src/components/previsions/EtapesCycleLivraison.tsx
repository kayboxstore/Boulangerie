import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ETAPES_CYCLE_LIVRAISON, type EtapeCycleLivraison } from "./cycleLivraisonLogique";

/**
 * Légende visuelle des dix étapes du cycle « prévision J → livraison J+1 »
 * (F4 round 1). Purement présentationnel : aucun appel réseau, aucune donnée
 * réelle par commande — sert à préparer le vocabulaire de l'écran avant la
 * publication du contrat C4, et à rappeler, à l'endroit où une quantité
 * livrée est saisie, qu'elle n'est pas encore une acceptation client.
 *
 * `etapeActive`, optionnel, marque une étape avec `aria-current="step"` —
 * utile une fois qu'un écran connaît réellement l'étape en cours pour une
 * ligne donnée (round ultérieur, après contrat C4).
 */
export interface EtapesCycleLivraisonProps {
  etapeActive?: EtapeCycleLivraison;
  className?: string;
}

const VARIANTE_PAR_ETAPE: Record<EtapeCycleLivraison, "secondary" | "gold" | "destructive" | "outline"> = {
  prevu: "outline",
  retenuProduction: "outline",
  prepare: "outline",
  charge: "secondary",
  depose: "secondary",
  enAttenteConfirmation: "gold",
  accepte: "secondary",
  retourne: "destructive",
  manquant: "destructive",
  facturable: "gold",
};

export function EtapesCycleLivraison({ etapeActive, className }: EtapesCycleLivraisonProps) {
  const { t } = useTranslation();

  return (
    <ol
      aria-label={t("previsions.etapesLegende")}
      className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-2", className)}
    >
      {ETAPES_CYCLE_LIVRAISON.map((etape, index) => {
        const active = etape === etapeActive;
        return (
          <li key={etape} className="flex items-center gap-1.5">
            <Badge
              variant={VARIANTE_PAR_ETAPE[etape]}
              aria-current={active ? "step" : undefined}
              title={t(`previsions.etapes.${etape}.description`)}
              className={cn(active && "ring-2 ring-or ring-offset-1 ring-offset-background")}
            >
              {t(`previsions.etapes.${etape}.label`)}
            </Badge>
            {index < ETAPES_CYCLE_LIVRAISON.length - 1 && (
              <span aria-hidden className="text-muted-foreground">
                →
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
