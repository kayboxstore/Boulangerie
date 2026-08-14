import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ETAPES_CYCLE_LIVRAISON, type EtapeCycleLivraison } from "./cycleLivraisonLogique";

/**
 * Légende visuelle des onze étapes du cycle « prévision J → livraison J+1 »
 * (F4 round 1, corrigée round 2 suite à la revue Codex). Purement
 * présentationnel : aucun appel réseau, aucune donnée réelle par commande —
 * sert à préparer le vocabulaire de l'écran avant la publication du contrat
 * C4, et à rappeler, à l'endroit où une quantité livrée est saisie, qu'elle
 * n'est pas encore une acceptation client.
 *
 * `etapeActive`, optionnel, marque une étape avec `aria-current="step"` —
 * réservé à un écran qui connaît RÉELLEMENT l'étape en cours pour une ligne
 * donnée à partir d'une donnée serveur (round ultérieur, après contrat C4).
 * Ne jamais le renseigner avec une valeur fixe/devinée : afficher un état
 * actif sans donnée serveur laisserait croire à un suivi qui n'existe pas
 * encore (round 2, revue Codex — corrige `etapeActive="depose"` codé en dur
 * dans `BonsLivraison.tsx` au round 1).
 */
export interface EtapesCycleLivraisonProps {
  etapeActive?: EtapeCycleLivraison;
  className?: string;
}

const VARIANTE_PAR_ETAPE: Record<EtapeCycleLivraison, "secondary" | "gold" | "destructive" | "outline"> = {
  prevu: "outline",
  retenuProduction: "outline",
  prepare: "outline",
  remisMagasin: "outline",
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
  // Identifiant de base unique par instance du composant (round 2, revue
  // Codex) : la description de chaque étape doit être accessible via
  // `aria-describedby`, pas seulement via l'attribut `title` — invisible au
  // clavier/tactile et non systématiquement restitué par les lecteurs
  // d'écran. `title` reste en complément pour l'info-bulle à la souris.
  const idBase = useId();

  return (
    <ol
      aria-label={t("previsions.etapesLegende")}
      className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-2", className)}
    >
      {ETAPES_CYCLE_LIVRAISON.map((etape, index) => {
        const active = etape === etapeActive;
        const idDescription = `${idBase}-${etape}`;
        return (
          <li key={etape} className="flex items-center gap-1.5">
            <Badge
              variant={VARIANTE_PAR_ETAPE[etape]}
              aria-current={active ? "step" : undefined}
              aria-describedby={idDescription}
              title={t(`previsions.etapes.${etape}.description`)}
              className={cn(active && "ring-2 ring-or ring-offset-1 ring-offset-background")}
            >
              {t(`previsions.etapes.${etape}.label`)}
            </Badge>
            <span id={idDescription} className="sr-only">
              {t(`previsions.etapes.${etape}.description`)}
            </span>
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
