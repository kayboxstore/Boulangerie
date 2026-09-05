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
  selectionnerToastsVisibles,
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

const BORDURE_VARIANTE: Record<VarianteToast, string> = {
  succes: "border-succes/30",
  erreur: "border-terracotta/30",
  avertissement: "border-avertissement/30",
  information: "border-information/30",
};

// Icône "plus affirmée" (revue Codex) : badge circulaire teinté plutôt
// qu'une simple icône nue — plus visible au premier coup d'œil.
const BADGE_VARIANTE: Record<VarianteToast, string> = {
  succes: "bg-succes/15 text-succes",
  erreur: "bg-terracotta/15 text-terracotta",
  avertissement: "bg-avertissement/15 text-avertissement",
  information: "bg-information/15 text-information",
};

// Halo/gradient discret derrière le badge (référence Premium validée).
const HALO_VARIANTE: Record<VarianteToast, string> = {
  succes: "bg-succes",
  erreur: "bg-terracotta",
  avertissement: "bg-avertissement",
  information: "bg-information",
};

type SourcePause = "survol" | "focus";

function ToastItem({ toast, onFermer }: { toast: ToastAffiche; onFermer: (id: number) => void }) {
  const { t } = useTranslation();
  const duree = toast.dureeMs ?? DUREE_TOAST_DEFAUT_MS;
  const [enPause, setEnPause] = useState(false);
  const resteMsRef = useRef(duree);
  const debutRef = useRef<number>(Date.now());
  const minuteurRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Round F1-DOM : un unique booléen `enPause` ne peut pas représenter deux
  // sources de pause indépendantes (survol ET focus clavier) actives en même
  // temps. Un `mouseleave` alors que le focus est toujours présent — ou un
  // `blur` alors que le survol continue — relançait à tort le minuteur.
  // L'ensemble des sources ENCORE actives est la seule source de vérité : le
  // minuteur ne reprend que lorsque la DERNIÈRE source est relâchée.
  const sourcesPauseRef = useRef<Set<SourcePause>>(new Set());

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
  const pauser = useCallback(
    (source: SourcePause) => {
      if (toast.persistant) return;
      const sources = sourcesPauseRef.current;
      const etaitDejaEnPause = sources.size > 0;
      sources.add(source);
      if (etaitDejaEnPause) return; // une autre source maintenait déjà la pause : rien de plus à figer
      const ecoule = Date.now() - debutRef.current;
      resteMsRef.current = Math.max(0, resteMsRef.current - ecoule);
      arreterMinuteur();
      setEnPause(true);
    },
    [arreterMinuteur, toast.persistant],
  );

  const reprendre = useCallback(
    (source: SourcePause) => {
      if (toast.persistant) return;
      const sources = sourcesPauseRef.current;
      sources.delete(source);
      if (sources.size > 0) return; // au moins une autre source maintient encore la pause
      setEnPause(false);
      demarrerMinuteur(resteMsRef.current);
    },
    [demarrerMinuteur, toast.persistant],
  );

  const Icone = ICONES_VARIANTE[toast.variante];

  return (
    <div
      role={toast.variante === "erreur" || toast.variante === "avertissement" ? "alert" : "status"}
      aria-live={toast.variante === "erreur" ? "assertive" : "polite"}
      tabIndex={0}
      onMouseEnter={() => pauser("survol")}
      onMouseLeave={() => reprendre("survol")}
      onFocus={() => pauser("focus")}
      onBlur={() => reprendre("focus")}
      className={cn(
        "pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-xl border bg-card p-3 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        BORDURE_VARIANTE[toast.variante],
      )}
    >
      {/* Halo/gradient discret (référence Premium validée) — purement décoratif. */}
      <span
        aria-hidden
        className={cn("absolute -left-8 -top-8 h-24 w-24 rounded-full opacity-20 blur-2xl", HALO_VARIANTE[toast.variante])}
      />

      <span
        className={cn(
          "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
          BADGE_VARIANTE[toast.variante],
        )}
      >
        <Icone aria-hidden className="h-5 w-5" />
      </span>

      <div className="relative z-10 flex-1 py-1">
        {toast.titre && <p className="font-semibold text-marine dark:text-creme">{toast.titre}</p>}
        <p className="text-sm font-medium text-marine dark:text-creme">{toast.message}</p>
      </div>

      {/* Cible de fermeture ≥ 44×44 px (audit UX-04) — l'icône reste petite,
          la zone cliquable réelle occupe tout le carré. */}
      <button
        type="button"
        onClick={() => onFermer(toast.id)}
        aria-label={t("common.close")}
        className="relative z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" />
      </button>

      {!toast.persistant && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1 origin-left bg-current opacity-40 motion-reduce:hidden"
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

  // Retire un toast de la file COMPLÈTE (visible ou en attente) — s'il était
  // visible, le suivant de la file prend automatiquement sa place au rendu
  // suivant, sans logique supplémentaire.
  const retirerToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  // S'abonne au bus découplé (toastBus.ts) : reçoit aussi bien les appels du
  // contexte `toast()` ci-dessous que ceux émis hors arbre React (lib/socket.tsx).
  //
  // Correction revue Codex : `toasts` est désormais la file COMPLÈTE, jamais
  // plafonnée ici — un toast n'est plus jamais supprimé par la seule arrivée
  // d'un nouveau (l'ancien `limiterToasts` gardait les 3 derniers arrivés et
  // perdait silencieusement les précédents, y compris persistants). Seuls
  // les `MAX_TOASTS_VISIBLES` premiers de la file sont rendus ci-dessous ;
  // les suivants attendent leur tour, qui vient dès qu'une place se libère.
  useEffect(() => {
    return sabonnerAuxToasts((toast) => {
      setToasts((prev) => [...prev, toast]);
    });
  }, []);

  const toastsVisibles = selectionnerToastsVisibles(toasts, MAX_TOASTS_VISIBLES);

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

      {/* Position Premium validée : haut-droite sur ordinateur, centré en
          haut sur mobile (plutôt que bas-droite partout). */}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end sm:px-0">
        {toastsVisibles.map((toastAffiche) => (
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
