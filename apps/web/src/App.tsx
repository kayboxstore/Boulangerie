import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import { LoginPage } from "@/pages/Login";
import { DashboardPage } from "@/pages/Dashboard";
import { ProduitsPage } from "@/pages/Produits";

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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
