import { lazy, Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Bell,
  ClipboardCheck,
  Factory,
  HandCoins,
  History,
  Info,
  LayoutDashboard,
  Menu,
  MessageCircle,
  Package,
  ScrollText,
  ServerCog,
  Settings,
  ShoppingBasket,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { TAGLINE, type AlerteAbsenceDTO, type AlerteDetteDTO, type Module } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { IndicateurConnexion } from "@/components/IndicateurConnexion";
import { ChargementModule } from "@/components/ChargementModule";
import { MenuProfil } from "@/components/MenuProfil";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

// La cloche de notifications tire framer-motion : chargée en lazy pour garder
// cette lib hors du chunk initial. Une cloche statique occupe la place le temps
// du chargement (imperceptible, sans à-coup de mise en page).
const NotificationBell = lazy(() => import("@/components/NotificationBell"));

function ClocheStatique() {
  return (
    <span className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground" aria-hidden>
      <Bell className="h-5 w-5" />
    </span>
  );
}
import { cn } from "@/lib/utils";

// Règle d'interface (spec section 2) : TOUS les modules apparaissent dans le
// menu pour tout le monde ; ceux hors du périmètre du rôle connecté (ou pas
// encore construits) restent visibles mais grisés/non cliquables.
interface EntreeNav {
  labelKey: string; // clé i18n (nav.*)
  icon: typeof LayoutDashboard;
  module?: Module; // absent = accessible à tous (Tableau de bord, Rapports personnels…)
  to?: string; // absent = module pas encore construit ("à venir")
  ecriture?: boolean; // exige l'ÉCRITURE sur le module (réservé Admin), pas la simple lecture
}

// Produits (catalogue) n'a plus d'entrée de menu propre depuis la V2 : fusionné
// dans Production (ProduitsCard), visible aux mêmes rôles — voir Production.tsx.
const navigation: EntreeNav[] = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { to: "/caisse", labelKey: "nav.caisse", icon: ShoppingCart, module: "CAISSE" },
  { to: "/commandes", labelKey: "nav.commandes", icon: ShoppingBasket, module: "COMMANDES" },
  { to: "/commissions", labelKey: "nav.commissions", icon: HandCoins, module: "COMMISSIONS" },
  { to: "/stocks", labelKey: "nav.stocks", icon: Package, module: "STOCKS" },
  { to: "/production", labelKey: "nav.production", icon: Factory, module: "PRODUCTION" },
  { to: "/fournisseurs", labelKey: "nav.fournisseurs", icon: Truck, module: "FOURNISSEURS" },
  { to: "/equipe", labelKey: "nav.equipe", icon: UserCog, module: "EQUIPE" },
  // Approbations (3.16) & État système (3.15) : réservés aux Admins (écriture Équipe).
  { to: "/approbations", labelKey: "nav.approbations", icon: ClipboardCheck, module: "EQUIPE", ecriture: true },
  { to: "/etat-systeme", labelKey: "nav.etatSysteme", icon: ServerCog, module: "EQUIPE", ecriture: true },
  // Journal d'audit (3.17) : DG (lecture) et Admins — lecture seule.
  { to: "/audit", labelKey: "nav.audit", icon: History, module: "EQUIPE" },
  { to: "/travailleurs", labelKey: "nav.travailleurs", icon: Users, module: "TRAVAILLEURS" },
  // Rapports personnels (3.13) : accessibles à tous, portée résolue côté serveur.
  { to: "/rapports", labelKey: "nav.rapports", icon: ScrollText },
  { to: "/parametres", labelKey: "nav.parametres", icon: Settings, module: "PARAMETRES" },
  // Assistant (3.19) : accessible à tous, jamais grisé (pas de `module`).
  { to: "/assistant", labelKey: "nav.assistant", icon: MessageCircle },
  // À propos (3.12) : accessible à tous.
  { to: "/a-propos", labelKey: "nav.apropos", icon: Info },
];

type LienNavigation = ReturnType<typeof calculerLiens>[number];

/** Exportée pour test (F2, tâche 11) : navigation basée sur les rôles, dédupliquée entre desktop et mobile. */
export function calculerLiens(
  peutLire: (m: Module) => boolean,
  peutEcrire: (m: Module) => boolean,
  t: (cle: string) => string,
) {
  return navigation.map((n) => {
    const aPermission = !n.module || (n.ecriture ? peutEcrire(n.module) : peutLire(n.module));
    const construit = !!n.to;
    return {
      ...n,
      label: t(n.labelKey),
      actif: aPermission && construit,
      motif: !aPermission ? t("nav.outOfScope") : !construit ? t("nav.moduleComingSoon") : undefined,
    };
  });
}

/**
 * Liste des liens de navigation — un seul rendu, réutilisé par la barre
 * latérale (desktop) ET le tiroir mobile, pour ne jamais les faire diverger.
 */
function ListeNavigation({ liens, t }: { liens: LienNavigation[]; t: (cle: string) => string }) {
  return (
    <>
      {liens.map(({ to, label, icon: Icon, actif, motif }) =>
        actif ? (
          <NavLink
            key={label}
            to={to!}
            end={to === "/"}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-or/15 text-or" : "text-creme/70 hover:bg-creme/5 hover:text-creme",
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
            {motif === t("nav.moduleComingSoon") && (
              <span className="ml-auto rounded bg-creme/10 px-1.5 py-0.5 text-[10px] text-creme/40">{t("nav.comingSoon")}</span>
            )}
          </span>
        ),
      )}
    </>
  );
}

export function Layout() {
  const { peutLire, peutEcrire } = useAuth();
  const location = useLocation();
  const [menuOuvert, setMenuOuvert] = useState(false);

  // Vérification paresseuse des dettes non payées (3.4) : déclenchée au
  // chargement de l'app pour les rôles ayant accès à Commandes — pas de tâche
  // planifiée, comme pour l'expiration des délégations. Le résultat alimente
  // aussi le bandeau du module Commandes (même clé de cache).
  useQuery({
    queryKey: ["alertes-dette"],
    queryFn: () => api<{ alertes: AlerteDetteDTO[] }>("/api/commandes/alertes-dette"),
    enabled: peutLire("COMMANDES"),
    staleTime: 5 * 60 * 1000,
  });

  // Rappel « absence en attente » (3.18) : même mécanisme paresseux, mais
  // réservé aux rôles avec écriture sur Travailleurs (Admin secondaire +
  // Principal) — le DG, lecture seule, n'est pas destinataire de ce rappel.
  useQuery({
    queryKey: ["alertes-absence"],
    queryFn: () => api<{ alertes: AlerteAbsenceDTO[] }>("/api/travailleurs/alertes-absence"),
    enabled: peutEcrire("TRAVAILLEURS"),
    staleTime: 5 * 60 * 1000,
  });
  const { t } = useTranslation();

  // Ferme le tiroir à chaque changement de route — sans ça, naviguer depuis le
  // menu laisserait le tiroir ouvert par-dessus le nouvel écran.
  useEffect(() => setMenuOuvert(false), [location.pathname]);

  const liens = calculerLiens(peutLire, peutEcrire, t);

  return (
    // h-screen + overflow-hidden : la coquille (barre latérale, en-têtes)
    // reste toujours visible, seul <main> défile — plus besoin de remonter en
    // haut de la page pour retrouver la navigation. print:* revient à un flux
    // normal (hauteur libre, pas de recadrage) : aside/header/nav sont de
    // toute façon masqués à l'impression (voir index.css, @media print), seul
    // le contenu de <main> doit s'étaler sur autant de pages que nécessaire.
    <div className="flex h-screen overflow-hidden bg-background print:h-auto print:overflow-visible print:bg-white">
      {/* Barre latérale — marine, logo et navigation, figée sur toute la hauteur */}
      <aside className="hidden w-64 shrink-0 flex-col overflow-y-auto bg-marine text-creme md:flex">
        <NavLink
          to="/"
          end
          className="flex items-center gap-3 border-b border-creme/10 px-5 py-4 transition-colors hover:bg-creme/5"
        >
          <img
            src="/logo-lomoto.png"
            alt="Logo Boulangerie Lomoto"
            className="h-11 w-11 rounded-full object-contain ring-2 ring-or/70"
          />
          <div>
            <p className="font-serif text-lg font-semibold leading-tight text-or">Boulangerie Lomoto</p>
            <p className="text-[11px] tracking-wide text-creme/60">{t("nav.gestionCommerciale")}</p>
          </div>
        </NavLink>

        <nav className="flex-1 space-y-1 px-3 py-4">
          <ListeNavigation liens={liens} t={t} />
        </nav>

        <div className="border-t border-creme/10 px-3 py-4">
          <MenuProfil avecDetails triggerClassName="w-full px-2 py-1.5" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden print:overflow-visible">
        {/* En-tête mobile — la navigation elle-même vit dans le tiroir
            (Sheet) plutôt qu'en rangée horizontale : sur un petit écran, une
            quinzaine de modules ne tient de toute façon pas sur une ligne. */}
        <header className="flex shrink-0 items-center justify-between bg-marine px-4 py-3 text-creme md:hidden">
          <div className="flex items-center gap-1">
            <Sheet open={menuOuvert} onOpenChange={setMenuOuvert}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("nav.openMenu")}
                  className="-ml-2 text-creme/80 hover:bg-creme/10 hover:text-creme"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="flex flex-col p-0">
                <SheetTitle asChild>
                  <div className="border-b border-creme/10">
                    <NavLink
                      to="/"
                      end
                      onClick={() => setMenuOuvert(false)}
                      className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-creme/5"
                    >
                      <img
                        src="/logo-lomoto.png"
                        alt="Logo Boulangerie Lomoto"
                        className="h-11 w-11 rounded-full object-contain ring-2 ring-or/70"
                      />
                      <div>
                        <p className="font-serif text-lg font-semibold leading-tight text-or">Boulangerie Lomoto</p>
                        <p className="text-[11px] tracking-wide text-creme/60">{t("nav.gestionCommerciale")}</p>
                      </div>
                    </NavLink>
                  </div>
                </SheetTitle>
                <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
                  <ListeNavigation liens={liens} t={t} />
                </nav>
                <div className="border-t border-creme/10 px-3 py-4">
                  <MenuProfil avecDetails triggerClassName="w-full px-2 py-1.5" />
                </div>
              </SheetContent>
            </Sheet>
            <NavLink to="/" end className="flex items-center gap-2">
              <img src="/logo-lomoto.png" alt="Logo Boulangerie Lomoto" className="h-9 w-9 rounded-full object-contain" />
              <span className="font-serif font-semibold text-or">Boulangerie Lomoto</span>
            </NavLink>
          </div>
          <div className="flex items-center gap-1 [&_button]:text-creme/80 [&_button:hover]:bg-creme/10 [&_button:hover]:text-creme">
            <Suspense fallback={<ClocheStatique />}>
              <NotificationBell />
            </Suspense>
            <MenuProfil avatarClassName="h-8 w-8" />
          </div>
        </header>

        {/* Barre supérieure (desktop) : statut temps réel + notifications, figée en haut de la zone de contenu */}
        <div className="no-print hidden shrink-0 items-center justify-end gap-3 border-b bg-card px-6 py-2 md:flex">
          <IndicateurConnexion etendu />
          <Suspense fallback={<ClocheStatique />}>
            <NotificationBell />
          </Suspense>
        </div>

        {/* min-w-0 : sans lui, un enfant plus large que l'écran (tableau non
            enroulé, etc.) élargit ce conteneur flex au lieu de défiler dans
            son propre cadre — c'était la cause du débordement horizontal de
            toute la page sur mobile, pas un problème propre à chaque écran.
            overflow-y-auto : seule zone qui défile désormais (voir la
            coquille h-screen/overflow-hidden ci-dessus). */}
        {/* id ciblé par ConstellationLomoto (F3) pour rendre le focus à un
            emplacement logique après la fermeture de la célébration. */}
        <main
          id="contenu-principal"
          className="min-w-0 flex-1 overflow-y-auto p-4 md:p-8 print:overflow-visible"
        >
          {/* Chaque module est chargé à la demande (React.lazy) ; la navigation
              reste affichée, seul le contenu montre le fallback de marque. */}
          <Suspense fallback={<ChargementModule />}>
            <Outlet />
          </Suspense>

          {/* À l'impression, c'est le pied de page dédié ci-dessous qui porte la
              marque — inutile de doubler la mention ici. */}
          <footer className="no-print px-1 pb-1 pt-6 text-center text-xs text-muted-foreground">
            Boulangerie Lomoto — <span className="italic">Pain Lia o Tonda</span>
          </footer>
        </main>

        {/* Pied de page des documents imprimés (section 3.13) : rendu ici, au
            niveau de la coquille, pour ne dépendre d'aucun écran — et donc ne
            jamais hériter d'un conteneur `.no-print`. Pas de crédit
            développeur ici (réservé à la page À propos, 3.12). */}
        <div className="lomoto-print-only lomoto-print-credit">
          Boulangerie Lomoto · {TAGLINE}
        </div>
      </div>
    </div>
  );
}
