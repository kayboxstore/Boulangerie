import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { evaluerRobustesseMotDePasse } from "./robustesseMotDePasse";

export { evaluerRobustesseMotDePasse } from "./robustesseMotDePasse";
export type { CleRobustesse, RobustesseMotDePasse } from "./robustesseMotDePasse";

const COULEUR_PAR_SCORE: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: "bg-destructive",
  1: "bg-destructive",
  2: "bg-avertissement",
  3: "bg-or",
  4: "bg-succes",
};

export interface PasswordFieldProps extends Omit<React.ComponentProps<typeof Input>, "type"> {
  /**
   * Affiche un indicateur de robustesse sous le champ. Désactivé par défaut :
   * pertinent uniquement pour un mot de passe qu'on est en train de CRÉER
   * (compte, réinitialisation) — jamais sur un simple formulaire de connexion
   * (audit UX-20 : « les critères de robustesse s'affichent lors de la
   * création [...] mais pas inutilement sur la connexion »).
   */
  afficherRobustesse?: boolean;
}

const PasswordField = React.forwardRef<HTMLInputElement, PasswordFieldProps>(
  (
    { className, afficherRobustesse = false, value, onChange, "aria-describedby": ariaDescribedbyExterne, ...props },
    ref,
  ) => {
    const { t } = useTranslation();
    const [visible, setVisible] = React.useState(false);
    const [valeurLocale, setValeurLocale] = React.useState("");
    // Identifiant stable pour associer programmatiquement l'indicateur de
    // robustesse au champ (aria-describedby) — sans cela, un lecteur d'écran
    // n'annonce jamais cette aide, uniquement visible à l'œil (défaut révélé
    // par les tests DOM round F1-DOM, corrigé ici).
    const idRobustesseGenere = React.useId();
    const idRobustesse = props.id ? `${props.id}-robustesse` : idRobustesseGenere;

    // Le composant peut être contrôlé (`value` fourni par l'appelant) ou non ;
    // dans les deux cas on garde une copie locale pour calculer la robustesse
    // sans forcer l'appelant à faire ce calcul lui-même.
    const valeurActuelle = value !== undefined ? String(value) : valeurLocale;
    const robustesse = React.useMemo(() => evaluerRobustesseMotDePasse(valeurActuelle), [valeurActuelle]);
    const afficheRobustesseActuellement = afficherRobustesse && valeurActuelle.length > 0;
    // `aria-describedby` externe (fourni par l'appelant, ex. un message
    // d'erreur de formulaire) est PRÉSERVÉ, jamais écrasé — les deux
    // identifiants cohabitent, comme le permet cet attribut (liste séparée
    // par des espaces).
    const ariaDescribedby = afficheRobustesseActuellement
      ? [idRobustesse, ariaDescribedbyExterne].filter(Boolean).join(" ")
      : ariaDescribedbyExterne;

    const gererChangement = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (value === undefined) setValeurLocale(e.target.value);
      onChange?.(e);
    };

    return (
      <div className="w-full">
        <div className="relative">
          <Input
            ref={ref}
            type={visible ? "text" : "password"}
            // h-11 = 44px, en local à ce composant uniquement (correction
            // revue Codex round 3) : Input reste à h-9 (36px) partout
            // ailleurs, inchangé, pour ne pas affecter tous les écrans
            // existants qui l'utilisent déjà.
            className={cn("h-11 pr-12", className)}
            value={value}
            onChange={gererChangement}
            autoComplete={props.autoComplete ?? "current-password"}
            aria-describedby={ariaDescribedby || undefined}
            {...props}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? t("premium.passwordField.masquer") : t("premium.passwordField.afficher")}
            aria-pressed={visible}
            // Cible tactile réellement 44×44 px (correction revue Codex :
            // l'ancienne zone valait 40×36 px, alignée sur la hauteur du
            // champ plutôt que sur la règle d'accessibilité). Centrée
            // verticalement sur le champ quelle que soit sa hauteur.
            className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-muted-foreground transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            disabled={props.disabled}
            tabIndex={0}
          >
            {visible ? <EyeOff aria-hidden className="h-4 w-4" /> : <Eye aria-hidden className="h-4 w-4" />}
          </button>
        </div>

        {afficheRobustesseActuellement && (
          <div id={idRobustesse} className="mt-1.5" aria-live="polite">
            <div className="flex gap-1" aria-hidden>
              {[0, 1, 2, 3].map((index) => (
                <span
                  key={index}
                  className={cn(
                    "h-1 flex-1 rounded-full bg-muted transition-colors",
                    index < robustesse.score && COULEUR_PAR_SCORE[robustesse.score],
                  )}
                />
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(`premium.passwordField.robustesse.${robustesse.cle}`)}
            </p>
          </div>
        )}
      </div>
    );
  },
);
PasswordField.displayName = "PasswordField";

export { PasswordField };
