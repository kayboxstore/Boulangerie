import { useTranslation } from "react-i18next";
import { useSocket, type StatutConnexion } from "@/lib/socket";
import { cn } from "@/lib/utils";

const STATUT_CLE: Record<StatutConnexion, string> = {
  connecte: "notif.statutConnecte",
  reconnexion: "notif.statutReconnexion",
  deconnecte: "notif.statutDeconnecte",
};

/**
 * Pastille de statut de connexion temps réel (or = OK, terracotta = souci).
 * Séparée de NotificationBell : elle n'utilise pas framer-motion et reste donc
 * dans le bundle principal, tandis que la cloche (animée) est chargée en lazy.
 */
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
