import { lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import type { Module } from "@lomoto/shared";
import { useAuth } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import { ChargementModule } from "@/components/ChargementModule";
// La page de connexion reste dans le bundle principal : c'est l'écran d'entrée
// (pré-authentification), la charger en lazy ajouterait un délai au tout premier
// affichage. Tous les modules métier sont chargés à la demande via React.lazy —
// leur code (et les grosses libs qu'ils tirent, ex. Recharts pour le Dashboard)
// n'entre pas dans le chunk initial et n'est récupéré qu'à la navigation.
import { LoginPage } from "@/pages/Login";

// `.then(...)` : les pages exportent des composants nommés, pas un export default.
const DashboardPage = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const ProduitsPage = lazy(() => import("@/pages/Produits").then((m) => ({ default: m.ProduitsPage })));
const CommandesPage = lazy(() => import("@/pages/Commandes").then((m) => ({ default: m.CommandesPage })));
const CommissionsPage = lazy(() => import("@/pages/Commissions").then((m) => ({ default: m.CommissionsPage })));
const CaissePage = lazy(() => import("@/pages/Caisse").then((m) => ({ default: m.CaissePage })));
const StocksPage = lazy(() => import("@/pages/Stocks").then((m) => ({ default: m.StocksPage })));
const ProductionPage = lazy(() => import("@/pages/Production").then((m) => ({ default: m.ProductionPage })));
const FournisseursPage = lazy(() => import("@/pages/Fournisseurs").then((m) => ({ default: m.FournisseursPage })));
const EquipePage = lazy(() => import("@/pages/Equipe").then((m) => ({ default: m.EquipePage })));
const ProfilPage = lazy(() => import("@/pages/Profil").then((m) => ({ default: m.ProfilPage })));
const TravailleursPage = lazy(() => import("@/pages/Travailleurs").then((m) => ({ default: m.TravailleursPage })));
const RapportsPersonnelsPage = lazy(() => import("@/pages/RapportsPersonnels").then((m) => ({ default: m.RapportsPersonnelsPage })));
const AProposPage = lazy(() => import("@/pages/APropos").then((m) => ({ default: m.AProposPage })));
const ParametresPage = lazy(() => import("@/pages/Parametres").then((m) => ({ default: m.ParametresPage })));
const EtatSystemePage = lazy(() => import("@/pages/EtatSysteme").then((m) => ({ default: m.EtatSystemePage })));
const ApprobationsPage = lazy(() => import("@/pages/Approbations").then((m) => ({ default: m.ApprobationsPage })));
const AuditPage = lazy(() => import("@/pages/Audit").then((m) => ({ default: m.AuditPage })));

/** Garde d'accès : exige au moins la lecture sur `module`, sinon retour à l'accueil. */
function RequiertLecture({ module, children }: { module: Module; children: ReactNode }) {
  const { peutLire } = useAuth();
  if (!peutLire(module)) return <Navigate to="/" replace />;
  return children;
}

/** Garde d'accès : exige l'écriture sur `module` (réservé aux Admins pour Équipe). */
function RequiertEcriture({ module, children }: { module: Module; children: ReactNode }) {
  const { peutEcrire } = useAuth();
  if (!peutEcrire(module)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { utilisateur, chargement } = useAuth();

  if (chargement) return <ChargementModule plein />;

  if (!utilisateur) {
    return (
      <Routes>
        <Route path="/connexion" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/connexion" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/produits" element={<ProduitsPage />} />
        <Route
          path="/caisse"
          element={
            <RequiertLecture module="CAISSE">
              <CaissePage />
            </RequiertLecture>
          }
        />
        <Route
          path="/commandes"
          element={
            <RequiertLecture module="COMMANDES">
              <CommandesPage />
            </RequiertLecture>
          }
        />
        <Route
          path="/stocks"
          element={
            <RequiertLecture module="STOCKS">
              <StocksPage />
            </RequiertLecture>
          }
        />
        <Route
          path="/production"
          element={
            <RequiertLecture module="PRODUCTION">
              <ProductionPage />
            </RequiertLecture>
          }
        />
        <Route
          path="/fournisseurs"
          element={
            <RequiertLecture module="FOURNISSEURS">
              <FournisseursPage />
            </RequiertLecture>
          }
        />
        <Route
          path="/equipe"
          element={
            <RequiertLecture module="EQUIPE">
              <EquipePage />
            </RequiertLecture>
          }
        />
        <Route path="/profil" element={<ProfilPage />} />
        {/* Rapports personnels (3.13) : accessibles à tous — la portée est résolue côté serveur. */}
        <Route path="/rapports" element={<RapportsPersonnelsPage />} />
        {/* À propos (3.12) : accessible à tous. */}
        <Route path="/a-propos" element={<AProposPage />} />
        <Route
          path="/parametres"
          element={
            <RequiertLecture module="PARAMETRES">
              <ParametresPage />
            </RequiertLecture>
          }
        />
        <Route
          path="/approbations"
          element={
            <RequiertEcriture module="EQUIPE">
              <ApprobationsPage />
            </RequiertEcriture>
          }
        />
        <Route
          path="/etat-systeme"
          element={
            <RequiertEcriture module="EQUIPE">
              <EtatSystemePage />
            </RequiertEcriture>
          }
        />
        {/* Journal d'audit (3.17) : DG (lecture) et Admins — lecture seule. */}
        <Route
          path="/audit"
          element={
            <RequiertLecture module="EQUIPE">
              <AuditPage />
            </RequiertLecture>
          }
        />
        <Route
          path="/travailleurs"
          element={
            <RequiertLecture module="TRAVAILLEURS">
              <TravailleursPage />
            </RequiertLecture>
          }
        />
        <Route
          path="/commissions"
          element={
            <RequiertLecture module="COMMISSIONS">
              <CommissionsPage />
            </RequiertLecture>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
