import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
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

interface OptionsConfirmation {
  titre?: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Action irréversible (suppression…) : bouton de confirmation en rouge. */
  destructive?: boolean;
}

interface ToastErreur {
  id: number;
  message: string;
}

interface FeedbackContextValue {
  /** Remplace window.confirm() par une boîte de dialogue cohérente avec le reste de l'app. */
  confirmer: (options: OptionsConfirmation) => Promise<boolean>;
  /** Remplace window.alert() pour signaler un échec — bandeau discret, non bloquant. */
  toastErreur: (message: string) => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

let prochainToastId = 0;
const DUREE_TOAST_MS = 7000;

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState<OptionsConfirmation | null>(null);
  const resolveRef = useRef<((valeur: boolean) => void) | null>(null);
  const [toasts, setToasts] = useState<ToastErreur[]>([]);

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

  const toastErreur = useCallback(
    (message: string) => {
      const id = ++prochainToastId;
      setToasts((prev) => [...prev, { id, message }]);
      setTimeout(() => retirerToast(id), DUREE_TOAST_MS);
    },
    [retirerToast],
  );

  return (
    <FeedbackContext.Provider value={{ confirmer, toastErreur }}>
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
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="alert"
            className="pointer-events-auto flex items-start gap-2 rounded-lg border border-terracotta/30 bg-card px-4 py-3 text-sm shadow-lg"
          >
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-terracotta" />
            <p className="flex-1 font-medium text-marine dark:text-creme">{toast.message}</p>
            <button
              type="button"
              onClick={() => retirerToast(toast.id)}
              aria-label={t("common.close")}
              className="shrink-0 text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
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
