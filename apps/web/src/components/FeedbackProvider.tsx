import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  DUREE_TOAST_DEFAUT_MS,
  MAX_TOASTS_VISIBLES,
  emettreToast,
  limiterToasts,
  sabonnerAuxToasts,
  type ToastAffiche,
  type ToastDemande,
  type VarianteToast,
} from "@/components/toast/toastBus";

interface OptionsConfirmation {
  titre?: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action irréversible (suppression…) : bouton de confirmation en rouge. */
  destructive?: boolean;
}

interface FeedbackContextValue {
  /** Remplace window.confirm() par une boîte de dialogue cohérente avec le reste de l'app. */
  confirmer: (options: OptionsConfirmation) => Promise<boolean>;
  /** Toast Premium générique — succès, erreur, avertissement ou information (audit UX-17). */
  toast: (demande: ToastDemande) => number;
  /**
   * Conservé pour compatibilité : ~36 appels existants dans le code utilisent
   * cette signature. Équivalent à `toast({ variante: "erreur", message })`.
   */
  toastErreur: (message: string) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

const ICONES_VARIANTE: Record<VarianteToast, typeof AlertTriangle> = {
  succes: CheckCircle2,
  erreur: AlertTriangle,
  avertissement: AlertTriangle,
  information: Info,
};

// Classes additives uniquement — la couleur de fond/carte reste `bg-card`
// commune, seule la bordure et l'icône changent par variante (cohérent avec
// le style de toast déjà en place avant cette évolution).
const STYLE_VARIANTE: Record<VarianteToast, string> = {
  succes: "border-succes/40 [&_svg]:text-succes",
  erreur: "border-terracotta/30 [&_svg]:text-terracotta",
  avertissement: "border-avertissement/40 [&_svg]:text-avertissement",
  information: "border-information/40 [&_svg]:text-information",
};

function ToastItem({ toast, onFermer }: { toast: ToastAffiche; onFermer: (id: number) => void }) {
  const { t } = useTranslation();
  const duree = toast.dureeMs ?? DUREE_TOAST_DEFAUT_MS;
  const [enPause, setEnPause] = useState(false);
  const resteMsRef = useRef(duree);
  const debutRef = useRef<number>(Date.now());
  const minuteurRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arreterMinuteur = useCallback(() => {
    if (minuteurRef.current !== null) {
      clearTimeout(minuteurRef.current);
      minuteurRef.current = null;
    }
  }, []);

  const demarrerMinuteur = useCallback(
    (ms: number) => {
      arreterMinuteur();
      debutRef.current = Date.now();
      minuteurRef.current = setTimeout(() => onFermer(toast.id), ms);
    },
    [arreterMinuteur, onFermer, toast.id],
  );

  useEffect(() => {
    if (toast.persistant) return;
    demarrerMinuteur(resteMsRef.current);
    return arreterMinuteur;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pause accessible (audit UX-17) : le survol OU le focus clavier suspend la
  // fermeture automatique — sans cela, un lecteur au clavier n'aurait jamais
  // le temps de lire le message avant sa disparition.
  const pauser = useCallback(() => {
    if (toast.persistant || enPause) return;
    const ecoule = Date.now() - debutRef.current;
    resteMsRef.current = Math.max(0, resteMsRef.current - ecoule);
    arreterMinuteur();
    setEnPause(true);
  }, [arreterMinuteur, enPause, toast.persistant]);

  const reprendre = useCallback(() => {
    if (toast.persistant || !enPause) return;
    setEnPause(false);
    demarrerMinuteur(resteMsRef.current);
  }, [demarrerMinuteur, enPause, toast.persistant]);

  const Icone = ICONES_VARIANTE[toast.variante];

  return (
    <div
      role={toast.variante === "erreur" || toast.variante === "avertissement" ? "alert" : "status"}
      aria-live={toast.variante === "erreur" ? "assertive" : "polite"}
      tabIndex={0}
      onMouseEnter={pauser}
      onMouseLeave={reprendre}
      onFocus={pauser}
      onBlur={reprendre}
      className={cn(
        "pointer-events-auto relative flex items-start gap-2 overflow-hidden rounded-lg border bg-card px-4 py-3 text-sm shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        STYLE_VARIANTE[toast.variante],
      )}
    >
      <Icone aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        {toast.titre && <p className="font-semibold text-marine dark:text-creme">{toast.titre}</p>}
        <p className="font-medium text-marine dark:text-creme">{toast.message}</p>
      </div>
      <button
        type="button"
        onClick={() => onFermer(toast.id)}
        aria-label={t("common.close")}
        className="shrink-0 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" />
      </button>
      {!toast.persistant && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-current opacity-30 motion-reduce:hidden"
          style={{
            animation: `lomoto-toast-barre ${duree}ms linear forwards`,
            animationPlayState: enPause ? "paused" : "running",
          }}
        />
      )}
    </div>
  );
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState<OptionsConfirmation | null>(null);
  const resolveRef = useRef<((valeur: boolean) => void) | null>(null);
  const [toasts, setToasts] = useState<ToastAffiche[]>([]);

  const confirmer = useCallback((options: OptionsConfirmation) => {
    setConfirmation(options);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const repondre = useCallback((valeur: boolean) => {
    setConfirmation(null);
    resolveRef.current?.(valeur);
    resolveRef.current = null;
  }, []);

  const retirerToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  // S'abonne au bus découplé (toastBus.ts) : reçoit aussi bien les appels du
  // contexte `toast()` ci-dessous que ceux émis hors arbre React (lib/socket.tsx).
  useEffect(() => {
    return sabonnerAuxToasts((toast) => {
      setToasts((prev) => limiterToasts([...prev, toast], MAX_TOASTS_VISIBLES));
    });
  }, []);

  const toast = useCallback((demande: ToastDemande) => emettreToast(demande), []);

  const toastErreur = useCallback(
    (message: string) => {
      toast({ variante: "erreur", message });
    },
    [toast],
  );

  return (
    <FeedbackContext.Provider value={{ confirmer, toast, toastErreur }}>
      {children}

      <Dialog open={!!confirmation} onOpenChange={(ouvert) => !ouvert && repondre(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmation?.titre ?? t("common.confirm")}</DialogTitle>
            <DialogDescription>{confirmation?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => repondre(false)}>
              {confirmation?.cancelLabel ?? t("common.cancel")}
            </Button>
            <Button variant={confirmation?.destructive ? "destructive" : "cta"} onClick={() => repondre(true)}>
              {confirmation?.confirmLabel ?? t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
        {toasts.map((toastAffiche) => (
          <ToastItem key={toastAffiche.id} toast={toastAffiche} onFermer={retirerToast} />
        ))}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackContextValue {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback doit être utilisé dans <FeedbackProvider>");
  return ctx;
}
