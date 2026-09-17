import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { NotificationDTO } from "@lomoto/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** "il y a 3 min", "il y a 2 h", "hier"… (formats de dates : locale fr conservée) */
export function tempsRelatif(dateIso: string, justNow: string): string {
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  const diffSec = Math.round((new Date(dateIso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return justNow;
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}

interface ActivityFeedProps {
  notifications: NotificationDTO[];
  onMarquerLue?: (id: string) => void;
  vide?: string;
  compact?: boolean;
}

/**
 * Feed d'activité temps réel : chaque nouvelle notification apparaît avec une
 * animation d'entrée (Framer Motion). Cliquer sur une notification non lue la
 * marque comme lue.
 */
export function ActivityFeed({ notifications, onMarquerLue, vide, compact }: ActivityFeedProps) {
  const { t } = useTranslation();
  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
        <BellRing className="h-8 w-8 opacity-40" />
        <p className="text-sm">{vide ?? t("feed.noActivity")}</p>
      </div>
    );
  }

  return (
    <ul className={cn("flex flex-col", compact ? "gap-1" : "gap-2")}>
      <AnimatePresence initial={false}>
        {notifications.map((n) => (
          <motion.li
            key={n.id}
            layout
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          >
            <button
              type="button"
              onClick={() => !n.lu && onMarquerLue?.(n.id)}
              className={cn(
                "w-full rounded-lg border p-3 text-left transition-colors",
                n.priorite === "HAUTE"
                  ? n.lu
                    ? "border-terracotta/30 bg-terracotta/5 hover:bg-terracotta/10"
                    : "border-terracotta bg-terracotta/15 shadow-sm hover:bg-terracotta/20"
                  : n.lu
                    ? "border-transparent bg-transparent hover:bg-secondary/40"
                    : "border-or/40 bg-or/10 hover:bg-or/15",
              )}
            >
              <div className="flex items-start gap-2">
                {n.priorite === "HAUTE" ? (
                  <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-terracotta" />
                ) : (
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                      n.lu ? "bg-beige" : "bg-terracotta",
                    )}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm leading-snug",
                      !n.lu && "font-medium",
                      n.priorite === "HAUTE" && "text-terracotta dark:text-creme",
                    )}
                  >
                    {n.message}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {n.priorite === "HAUTE" && <Badge variant="destructive">{t("feed.highPriority")}</Badge>}
                    <Badge variant="secondary" className="font-normal">
                      {t(`module.${n.module}`)}
                    </Badge>
                    {n.emetteur && <span>{t("feed.by", { nom: n.emetteur.nom })}</span>}
                    <span>·</span>
                    <time dateTime={n.dateCreation}>{tempsRelatif(n.dateCreation, t("feed.justNow"))}</time>
                  </div>
                </div>
              </div>
            </button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
