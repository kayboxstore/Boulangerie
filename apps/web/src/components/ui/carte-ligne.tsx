import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Carte compacte représentant UNE ligne de données sur mobile — remplace une
 * ligne de tableau quand ses colonnes ne tiennent pas sur un petit écran
 * (audit d'affichage mobile, section 3.8). Empilées dans un conteneur
 * `space-y-2 md:hidden`, en regard d'un `<Table>` classique visible à partir
 * de `md:`.
 */
const CarteLigne = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("rounded-lg border bg-card p-3 text-sm", className)} {...props} />
  ),
);
CarteLigne.displayName = "CarteLigne";

/** Titre / identifiant principal — équivalent de la première colonne. */
const CarteLigneTitre = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex items-start justify-between gap-3 font-medium text-marine dark:text-creme", className)}
      {...props}
    />
  ),
);
CarteLigneTitre.displayName = "CarteLigneTitre";

/** Une paire libellé/valeur — équivalent d'une cellule secondaire. */
function CarteLigneChamp({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 py-1", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/** Rangée d'actions (boutons), séparée du contenu par une ligne. */
const CarteLigneActions = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("mt-2 flex items-center justify-end gap-1 border-t pt-2", className)} {...props} />
  ),
);
CarteLigneActions.displayName = "CarteLigneActions";

export { CarteLigne, CarteLigneTitre, CarteLigneChamp, CarteLigneActions };
