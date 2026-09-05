import { CircleUserRound, LogOut, Moon, Sun, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNavigate } from "react-router-dom";

/** Avatar rond : la photo de profil (V2) si définie, sinon une icône neutre. */
function Avatar({ photoUrl, className }: { photoUrl: string | null | undefined; className: string }) {
  if (photoUrl) {
    return <img src={photoUrl} alt="" className={`${className} rounded-full object-cover`} />;
  }
  return <CircleUserRound className={className} aria-hidden />;
}

/**
 * Menu déclenché par la photo de profil (V2) : Mon profil / Mode sombre-clair
 * / Se déconnecter — remplace les boutons séparés qui occupaient auparavant
 * la barre latérale, le tiroir mobile et l'en-tête mobile. Un seul composant
 * réutilisé aux trois endroits pour ne jamais les faire diverger.
 */
export function MenuProfil({
  avecDetails = false,
  avatarClassName = "h-9 w-9",
  triggerClassName = "",
}: {
  /** Affiche le nom et le rôle à côté de l'avatar (barre latérale desktop / tiroir mobile). */
  avecDetails?: boolean;
  avatarClassName?: string;
  triggerClassName?: string;
}) {
  const { utilisateur, logout } = useAuth();
  const { sombre, basculer } = useTheme();
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("nav.myAccountMenu")}
          className={`flex items-center gap-2 rounded-md text-left transition-colors hover:bg-creme/5 ${triggerClassName}`}
        >
          <Avatar photoUrl={utilisateur?.photoUrl} className={`${avatarClassName} shrink-0 ring-2 ring-or/50`} />
          {avecDetails && (
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{utilisateur?.nom}</span>
              <Badge variant="gold" className="mt-0.5">{utilisateur?.role.nom}</Badge>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => navigate("/profil")}>
          <UserRound className="h-4 w-4" />
          {t("nav.myProfile")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => { e.preventDefault(); basculer(); }}>
          {sombre ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {t(sombre ? "nav.enableLightMode" : "nav.enableDarkMode")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout} className="text-terracotta focus:text-terracotta">
          <LogOut className="h-4 w-4" />
          {t("nav.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
