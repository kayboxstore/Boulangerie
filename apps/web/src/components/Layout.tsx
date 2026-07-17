import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, LogOut, Wheat } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IndicateurConnexion, NotificationBell } from "@/components/NotificationBell";
import { cn } from "@/lib/utils";

const navigation = [
  { to: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/produits", label: "Produits", icon: Wheat },
];

export function Layout() {
  const { utilisateur, logout } = useAuth();

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

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
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
          ))}
        </nav>

        <div className="border-t border-creme/10 px-5 py-4">
          <p className="truncate text-sm font-medium">{utilisateur?.nom}</p>
          <Badge variant="gold" className="mt-1">{utilisateur?.role.nom}</Badge>
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
            <Button variant="ghost" size="icon" onClick={logout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Navigation mobile */}
        <nav className="flex gap-1 border-b bg-card px-2 py-1 md:hidden">
          {navigation.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium",
                  isActive ? "bg-secondary text-foreground" : "text-muted-foreground",
                )
              }
            >
              {label}
            </NavLink>
          ))}
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
