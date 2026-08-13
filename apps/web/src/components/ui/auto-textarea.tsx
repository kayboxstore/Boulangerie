import * as React from "react";
import { useTranslation } from "react-i18next";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { evaluerCompteurCaracteres } from "./compteurCaracteres";

export interface AutoTextareaProps extends React.ComponentProps<typeof Textarea> {
  /** Hauteur maximale en pixels avant que le contenu ne devienne défilant (évite une zone infinie). */
  hauteurMaxPx?: number;
  /** Affiche un compteur "n / limite" sous le champ, avec avertissement à 90 % puis dépassement en rouge. */
  limiteCaracteres?: number;
}

const AutoTextarea = React.forwardRef<HTMLTextAreaElement, AutoTextareaProps>(
  ({ className, hauteurMaxPx = 320, limiteCaracteres, value, defaultValue, onChange, ...props }, ref) => {
    const { t } = useTranslation();
    const elementRef = React.useRef<HTMLTextAreaElement | null>(null);
    const [longueur, setLongueur] = React.useState(() => String(value ?? defaultValue ?? "").length);

    const combinerRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        elementRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      },
      [ref],
    );

    const redimensionner = React.useCallback(() => {
      const el = elementRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, hauteurMaxPx)}px`;
    }, [hauteurMaxPx]);

    // Redimensionne au montage et à chaque changement de valeur contrôlée
    // (ex. réinitialisation programmatique du formulaire par l'appelant).
    React.useLayoutEffect(() => {
      redimensionner();
    }, [redimensionner, value]);

    const gererChangement = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setLongueur(e.target.value.length);
      redimensionner();
      onChange?.(e);
    };

    const etatCompteur = evaluerCompteurCaracteres(longueur, limiteCaracteres);

    return (
      <div className="w-full">
        <Textarea
          ref={combinerRef}
          value={value}
          defaultValue={defaultValue}
          onChange={gererChangement}
          className={cn("resize-none overflow-y-auto", className)}
          style={{ maxHeight: hauteurMaxPx }}
          {...props}
        />
        {etatCompteur.limite !== undefined && (
          <p
            className={cn(
              "mt-1 text-right text-xs text-muted-foreground",
              etatCompteur.depasse && "font-semibold text-destructive",
              !etatCompteur.depasse && etatCompteur.procheLimite && "text-avertissement",
            )}
            aria-live="polite"
          >
            {t("premium.autoTextarea.compteur", { longueur, limite: etatCompteur.limite })}
          </p>
        )}
      </div>
    );
  },
);
AutoTextarea.displayName = "AutoTextarea";

export { AutoTextarea };
