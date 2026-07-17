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
