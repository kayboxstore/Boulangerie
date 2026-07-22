import { NavLink, Outlet } from "react-router-dom";
import {
  CircleUserRound,
  Factory,
  HandCoins,
  Info,
  LayoutDashboard,
  LogOut,
  Package,
  ScrollText,
  Settings,
  ShoppingBasket,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  Wheat,
} from "lucide-react";
import type { Module } from "@lomoto/shared";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IndicateurConnexion, NotificationBell } from "@/components/NotificationBell";
import { cn } from "@/lib/utils";

// Règle d'interface (spec section 2) : TOUS les modules apparaissent dans le
// menu pour tout le monde ; ceux hors du périmètre du rôle connecté (ou pas
// encore construits) restent visibles mais grisés/non cliquables.
interface EntreeNav {
  label: string;
  icon: typeof LayoutDashboard;
  module?: Module; // absent = accessible à tous (Tableau de bord, catalogue Produits)
  to?: string; // absent = module pas encore construit ("à venir")
}

const navigation: EntreeNav[] = [
  { to: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/caisse", label: "Caisse", icon: ShoppingCart, module: "CAISSE" },
  { to: "/commandes", label: "Commandes", icon: ShoppingBasket, module: "COMMANDES" },
  { to: "/commissions", label: "Commissions", icon: HandCoins, module: "COMMISSIONS" },
  { to: "/stocks", label: "Stocks", icon: Package, module: "STOCKS" },
  { to: "/production", label: "Production", icon: Factory, module: "PRODUCTION" },
  { to: "/fournisseurs", label: "Fournisseurs", icon: Truck, module: "FOURNISSEURS" },
  { to: "/produits", label: "Produits", icon: Wheat },
  { to: "/equipe", label: "Équipe", icon: UserCog, module: "EQUIPE" },
  { to: "/travailleurs", label: "Travailleurs", icon: Users, module: "TRAVAILLEURS" },
  // Rapports personnels (3.13) : accessibles à tous, portée résolue côté serveur.
  { to: "/rapports", label: "Rapports", icon: ScrollText },
  { to: "/parametres", label: "Paramètres", icon: Settings, module: "PARAMETRES" },
  // À propos (3.12) : accessible à tous.
  { to: "/a-propos", label: "À propos", icon: Info },
];

export function Layout() {
  const { utilisateur, logout, peutLire } = useAuth();

  const liens = navigation.map((n) => {
    const aPermission = !n.module || peutLire(n.module);
    const construit = !!n.to;
    return {
      ...n,
      actif: aPermission && construit,
      motif: !aPermission ? "Hors de votre périmètre" : !construit ? "Module à venir" : undefined,
    };
  });

  return (
    <div className="flex min-h-screen bg-background">
      {/* Barre latérale — marine, logo et navigation */}
      <aside className="hidden w-64 flex-col bg-marine text-creme md:flex">
        <div className="flex items-center gap-3 border-b border-creme/10 px-5 py-4">
          <img
            src="/logo-lomoto.png"
            alt="Logo Boulangerie Lomoto"
            className="h-11 w-11 rounded-full object-contain ring-2 ring-or/70"
          />
          <div>
            <p className="font-serif text-lg font-semibold leading-tight text-or">Boulangerie Lomoto</p>
            <p className="text-[11px] tracking-wide text-creme/60">Gestion commerciale</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {liens.map(({ to, label, icon: Icon, actif, motif }) =>
            actif ? (
              <NavLink
                key={label}
                to={to!}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-or/15 text-or"
                      : "text-creme/70 hover:bg-creme/5 hover:text-creme",
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ) : (
              <span
                key={label}
                aria-disabled="true"
                title={motif}
                className="flex cursor-not-allowed items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-creme/25"
              >
                <Icon className="h-4 w-4" />
                {label}
                {motif === "Module à venir" && (
                  <span className="ml-auto rounded bg-creme/10 px-1.5 py-0.5 text-[10px] text-creme/40">à venir</span>
                )}
              </span>
            ),
          )}
        </nav>

        <div className="border-t border-creme/10 px-5 py-4">
          <NavLink
            to="/profil"
            className={({ isActive }) =>
              cn(
                "-mx-2 block rounded-md px-2 py-1 transition-colors hover:bg-creme/5",
                isActive && "bg-creme/5",
              )
            }
            title="Mon profil"
          >
            <p className="flex items-center gap-1.5 truncate text-sm font-medium">
              <CircleUserRound className="h-4 w-4 shrink-0 text-creme/60" />
              {utilisateur?.nom}
            </p>
            <Badge variant="gold" className="mt-1">{utilisateur?.role.nom}</Badge>
          </NavLink>
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="mt-3 w-full justify-start gap-2 text-creme/70 hover:bg-creme/5 hover:text-creme"
          >
            <LogOut className="h-4 w-4" />
            Se déconnecter
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        {/* En-tête mobile */}
        <header className="flex items-center justify-between bg-marine px-4 py-3 text-creme md:hidden">
          <div className="flex items-center gap-2">
            <img src="/logo-lomoto.png" alt="Logo Boulangerie Lomoto" className="h-9 w-9 rounded-full object-contain" />
            <span className="font-serif font-semibold text-or">Boulangerie Lomoto</span>
          </div>
          <div className="flex items-center gap-1 [&_button]:text-creme/80 [&_button:hover]:bg-creme/10 [&_button:hover]:text-creme">
            <NotificationBell />
            <NavLink to="/profil" aria-label="Mon profil" className="rounded-md p-2 text-creme/80 hover:bg-creme/10 hover:text-creme">
              <CircleUserRound className="h-4 w-4" />
            </NavLink>
            <Button variant="ghost" size="icon" onClick={logout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Navigation mobile */}
        <nav className="flex gap-1 overflow-x-auto border-b bg-card px-2 py-1 md:hidden">
          {liens.map(({ to, label, actif, motif }) =>
            actif ? (
              <NavLink
                key={label}
                to={to!}
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium",
                    isActive ? "bg-secondary text-foreground" : "text-muted-foreground",
                  )
                }
              >
                {label}
              </NavLink>
            ) : (
              <span
                key={label}
                aria-disabled="true"
                title={motif}
                className="cursor-not-allowed whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground/40"
              >
                {label}
              </span>
            ),
          )}
        </nav>

        {/* Barre supérieure (desktop) : statut temps réel + notifications */}
        <div className="hidden items-center justify-end gap-3 border-b bg-card px-6 py-2 md:flex">
          <IndicateurConnexion etendu />
          <NotificationBell />
        </div>

        <main className="flex-1 p-4 md:p-8">
          <Outlet />
        </main>

        <footer className="px-4 pb-4 text-center text-xs text-muted-foreground">
          Boulangerie Lomoto — <span className="italic">Pain Lia o Tonda</span>
        </footer>
      </div>
    </div>
  );
}
