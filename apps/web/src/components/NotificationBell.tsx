import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, CheckCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSocket, type StatutConnexion } from "@/lib/socket";
import { Button } from "@/components/ui/button";
import { ActivityFeed } from "@/components/ActivityFeed";
import { cn } from "@/lib/utils";

const STATUT_CLE: Record<StatutConnexion, string> = {
  connecte: "notif.statutConnecte",
  reconnexion: "notif.statutReconnexion",
  deconnecte: "notif.statutDeconnecte",
};

/** Pastille de statut de connexion temps réel (or = OK, terracotta = souci). */
export function IndicateurConnexion({ etendu }: { etendu?: boolean }) {
  const { statut } = useSocket();
  const { t } = useTranslation();
  const libelle = t(STATUT_CLE[statut]);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" title={libelle}>
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          statut === "connecte" && "bg-or",
          statut === "reconnexion" && "animate-pulse bg-terracotta",
          statut === "deconnecte" && "bg-beige",
        )}
      />
      {etendu && libelle}
    </span>
  );
}

/** Cloche + badge non-lues + panneau de feed temps réel. */
export function NotificationBell() {
  const { notifications, nonLues, marquerLue, toutMarquerLu } = useSocket();
  const { t } = useTranslation();
  const [ouvert, setOuvert] = useState(false);
  const conteneur = useRef<HTMLDivElement>(null);

  // Fermeture au clic extérieur / Échap.
  useEffect(() => {
    if (!ouvert) return;
    const surClic = (e: MouseEvent) => {
      if (!conteneur.current?.contains(e.target as Node)) setOuvert(false);
    };
    const surTouche = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOuvert(false);
    };
    document.addEventListener("mousedown", surClic);
    document.addEventListener("keydown", surTouche);
    return () => {
      document.removeEventListener("mousedown", surClic);
      document.removeEventListener("keydown", surTouche);
    };
  }, [ouvert]);

  return (
    <div ref={conteneur} className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label={nonLues > 0 ? t("notif.ariaWithCount", { count: nonLues }) : t("notif.aria")}
        aria-expanded={ouvert}
        onClick={() => setOuvert((o) => !o)}
        className="relative"
      >
        <Bell className="h-5 w-5" />
        {nonLues > 0 && (
          <motion.span
            key={nonLues}
            initial={{ scale: 0.6 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 20 }}
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-terracotta px-1 text-[10px] font-bold leading-none text-creme"
          >
            {nonLues > 99 ? "99+" : nonLues}
          </motion.span>
        )}
      </Button>

      <AnimatePresence>
        {ouvert && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-card shadow-xl"
          >
            <div className="flex items-center justify-between border-b px-4 py-2.5">
              <p className="text-sm font-semibold">{t("notif.title")}</p>
              <div className="flex items-center gap-3">
                <IndicateurConnexion etendu />
                {nonLues > 0 && (
                  <Button variant="ghost" size="sm" onClick={toutMarquerLu} className="h-7 gap-1 px-2 text-xs">
                    <CheckCheck className="h-3.5 w-3.5" />
                    {t("notif.markAll")}
                  </Button>
                )}
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto p-2">
              <ActivityFeed
                notifications={notifications.slice(0, 20)}
                onMarquerLue={marquerLue}
                vide={t("notif.empty")}
                compact
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
