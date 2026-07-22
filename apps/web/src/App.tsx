import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import type { Module } from "@lomoto/shared";
import { useAuth } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import { LoginPage } from "@/pages/Login";
import { DashboardPage } from "@/pages/Dashboard";
import { ProduitsPage } from "@/pages/Produits";
import { CommandesPage } from "@/pages/Commandes";
import { CommissionsPage } from "@/pages/Commissions";
import { CaissePage } from "@/pages/Caisse";
import { StocksPage } from "@/pages/Stocks";
import { ProductionPage } from "@/pages/Production";
import { FournisseursPage } from "@/pages/Fournisseurs";
import { EquipePage } from "@/pages/Equipe";
import { ProfilPage } from "@/pages/Profil";
import { TravailleursPage } from "@/pages/Travailleurs";
import { RapportsPersonnelsPage } from "@/pages/RapportsPersonnels";
import { AProposPage } from "@/pages/APropos";
import { ParametresPage } from "@/pages/Parametres";

/** Garde d'accès : exige au moins la lecture sur `module`, sinon retour à l'accueil. */
function RequiertLecture({ module, children }: { module: Module; children: ReactNode }) {
  const { peutLire } = useAuth();
  if (!peutLire(module)) return <Navigate to="/" replace />;
  return children;
}

function EcranChargement() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-creme">
      <img src="/logo-lomoto.png" alt="Boulangerie Lomoto" className="h-24 w-24 animate-pulse rounded-full object-contain" />
    </div>
  );
}

export default function App() {
  const { utilisateur, chargement } = useAuth();

  if (chargement) return <EcranChargement />;

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
