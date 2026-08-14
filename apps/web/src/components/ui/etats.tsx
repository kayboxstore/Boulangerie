import * as React from "react";
import { AlertTriangle, Inbox, Loader2, RefreshCw, WifiOff, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Quatre états d'affichage communs (audit UX-07 : « composant commun pour
 * succès, erreur actionnable, vide, chargement et connexion perdue »).
 * Purement présentationnels — aucune règle métier, aucun accès réseau :
 * chaque écran reste responsable de décider QUAND les afficher et de
 * fournir le callback `onReessayer` le cas échéant.
 */

interface ConteneurEtatProps {
  icone: LucideIcon;
  titre: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

function ConteneurEtat({ icone: Icone, titre, description, action, className }: ConteneurEtatProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center",
        className,
      )}
    >
      <Icone aria-hidden className="h-8 w-8 text-muted-foreground" />
      <p className="font-medium text-marine dark:text-creme">{titre}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}

export interface EtatVideProps {
  titre?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

function EtatVide({ titre, description, action, className }: EtatVideProps) {
  const { t } = useTranslation();
  return (
    <ConteneurEtat
      icone={Inbox}
      titre={titre ?? t("premium.etats.videTitre")}
      description={description}
      action={action}
      className={className}
    />
  );
}

export interface EtatChargementProps {
  message?: string;
  className?: string;
}

function EtatChargement({ message, className }: EtatChargementProps) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col items-center justify-center gap-2 p-8 text-center", className)}
    >
      <Loader2 aria-hidden className="h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none" />
      <p className="text-sm text-muted-foreground">{message ?? t("common.loading")}</p>
    </div>
  );
}

function BoutonReessayer({ onReessayer }: { onReessayer: () => void }) {
  const { t } = useTranslation();
  return (
    <Button type="button" variant="outline" size="touch" onClick={onReessayer}>
      <RefreshCw aria-hidden />
      {t("premium.etats.reessayer")}
    </Button>
  );
}

export interface EtatHorsLigneProps {
  onReessayer?: () => void;
  className?: string;
}

function EtatHorsLigne({ onReessayer, className }: EtatHorsLigneProps) {
  const { t } = useTranslation();
  return (
    <ConteneurEtat
      icone={WifiOff}
      titre={t("premium.etats.horsLigneTitre")}
      description={t("premium.etats.horsLigneDescription")}
      action={onReessayer && <BoutonReessayer onReessayer={onReessayer} />}
      className={className}
    />
  );
}

export interface EtatErreurProps {
  message?: string;
  onReessayer?: () => void;
  className?: string;
}

function EtatErreur({ message, onReessayer, className }: EtatErreurProps) {
  const { t } = useTranslation();
  return (
    <ConteneurEtat
      icone={AlertTriangle}
      titre={t("premium.etats.erreurTitre")}
      description={message}
      action={onReessayer && <BoutonReessayer onReessayer={onReessayer} />}
      className={className}
    />
  );
}

/**
 * Reflète `navigator.onLine`, mis à jour en direct par les évènements
 * `online`/`offline` du navigateur. Ne fait aucun appel réseau lui-même :
 * un `navigator.onLine` à `true` signifie seulement qu'une interface réseau
 * est active, pas que l'API du projet est joignable — à combiner avec la
 * gestion d'erreur normale des requêtes, pas comme unique garde-fou.
 */
function useEnLigne(): boolean {
  const [enLigne, setEnLigne] = React.useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  React.useEffect(() => {
    const surEnLigne = () => setEnLigne(true);
    const surHorsLigne = () => setEnLigne(false);
    window.addEventListener("online", surEnLigne);
    window.addEventListener("offline", surHorsLigne);
    return () => {
      window.removeEventListener("online", surEnLigne);
      window.removeEventListener("offline", surHorsLigne);
    };
  }, []);

  return enLigne;
}

export { EtatVide, EtatChargement, EtatHorsLigne, EtatErreur, useEnLigne };
