import { lazy, Suspense, useCallback, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import type { Module } from "@lomoto/shared";
import { useAuth } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import { ChargementModule } from "@/components/ChargementModule";
import { EcranDemarrage, splashDejaVu } from "@/components/EcranDemarrage";
import { ConstellationLomoto } from "@/components/ConstellationLomoto";
// La page de connexion reste dans le bundle principal : c'est l'écran d'entrée
// (pré-authentification), la charger en lazy ajouterait un délai au tout premier
// affichage. Tous les modules métier sont chargés à la demande via React.lazy —
// leur code (et les grosses libs qu'ils tirent, ex. Recharts pour le Dashboard)
// n'entre pas dans le chunk initial et n'est récupéré qu'à la navigation.
import { LoginPage } from "@/pages/Login";
// Assistant de premier lancement (3.7) : lui aussi pré-authentification,
// mais rarement affiché (une seule fois dans la vie de l'app) — lazy est
// approprié ici, contrairement à LoginPage.
const PremierLancementPage = lazy(() =>
  import("@/pages/PremierLancement").then((m) => ({ default: m.PremierLancementPage })),
);
// Récupération de mot de passe (F2, tâche 7-8) : pages pré-authentification,
// rarement visitées — lazy comme PremierLancementPage, contrairement à LoginPage.
const MotDePasseOubliePage = lazy(() =>
  import("@/pages/MotDePasseOublie").then((m) => ({ default: m.MotDePasseOubliePage })),
);
const NouveauMotDePassePage = lazy(() =>
  import("@/pages/NouveauMotDePasse").then((m) => ({ default: m.NouveauMotDePassePage })),
);
// Changement obligatoire du mot de passe temporaire (F3) : rarement affiché
// (seulement juste après qu'un Admin a distribué un mot de passe temporaire),
// lazy comme les autres écrans pré-app ci-dessus.
const ChangementMotDePasseObligatoirePage = lazy(() =>
  import("@/pages/ChangementMotDePasseObligatoire").then((m) => ({ default: m.ChangementMotDePasseObligatoirePage })),
);

// `.then(...)` : les pages exportent des composants nommés, pas un export default.
const DashboardPage = lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.DashboardPage })));
const CommandesPage = lazy(() => import("@/pages/Commandes").then((m) => ({ default: m.CommandesPage })));
// Sous-module de Commandes (3.4) : fiche client, écran à part pour ne pas encombrer /commandes.
const ClientsPage = lazy(() => import("@/pages/Clients").then((m) => ({ default: m.ClientsPage })));
// Sous-module de Commandes (F5B, vague 3) : confirmation d'acceptation du cycle C4.
const AcceptationsLivraisonPage = lazy(() =>
  import("@/pages/AcceptationsLivraison").then((m) => ({ default: m.AcceptationsLivraisonPage })),
);
const CommissionsPage = lazy(() => import("@/pages/Commissions").then((m) => ({ default: m.CommissionsPage })));
const CaissePage = lazy(() => import("@/pages/Caisse").then((m) => ({ default: m.CaissePage })));
const StocksPage = lazy(() => import("@/pages/Stocks").then((m) => ({ default: m.StocksPage })));
const ProductionPage = lazy(() => import("@/pages/Production").then((m) => ({ default: m.ProductionPage })));
// Sous-module de Production (3.3 e) : Bon de livraison, écran à part pour ne pas encombrer /production.
const BonsLivraisonPage = lazy(() => import("@/pages/BonsLivraison").then((m) => ({ default: m.BonsLivraisonPage })));
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
const AssistantPage = lazy(() => import("@/pages/Assistant").then((m) => ({ default: m.AssistantPage })));

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
  const { utilisateur, chargement, premierLancement } = useAuth();

  // Écran de démarrage (3.8) : au PREMIER chargement de la session seulement.
  // Il se superpose à l'app, qui se monte et charge ses données derrière — la
  // transition vers la connexion (ou le tableau de bord) est donc immédiate.
  const [splashFini, setSplashFini] = useState(() => splashDejaVu());
  const terminerSplash = useCallback(() => setSplashFini(true), []);

  const splash = splashFini ? null : <EcranDemarrage onTermine={terminerSplash} />;

  if (chargement) {
    return (
      <>
        {splash}
        <ChargementModule plein />
      </>
    );
  }

  if (!utilisateur) {
    // Assistant de premier lancement (3.7) : base sans aucun compte —
    // remplace entièrement l'écran de connexion, aucune route accessible
    // avant la fin du parcours (finaliser() → login() fait sortir de cette branche).
    if (premierLancement) {
      return (
        <>
          {splash}
          <Suspense fallback={<ChargementModule plein />}>
            <PremierLancementPage />
          </Suspense>
        </>
      );
    }
    return (
      <>
        {splash}
        <Suspense fallback={<ChargementModule plein />}>
          <Routes>
            <Route path="/connexion" element={<LoginPage />} />
            <Route path="/mot-de-passe-oublie" element={<MotDePasseOubliePage />} />
            <Route path="/nouveau-mot-de-passe" element={<NouveauMotDePassePage />} />
            <Route path="*" element={<Navigate to="/connexion" replace />} />
          </Routes>
        </Suspense>
      </>
    );
  }

  // Changement obligatoire du mot de passe temporaire (F3, contrat C3) :
  // remplace ENTIÈREMENT l'application authentifiée — pas de <Layout>, pas de
  // <Routes> métier — quel que soit le chemin déjà présent dans l'URL. Une
  // navigation directe vers une URL métier pendant cet état retombe donc
  // systématiquement sur cet écran bloquant, jamais sur la page visée.
  // Socket.io ne se connecte pas non plus tant que ce drapeau est actif (voir
  // la garde symétrique dans `lib/socket.tsx`).
  if (utilisateur.motDePasseDoitChanger) {
    return (
      <>
        {splash}
        <Suspense fallback={<ChargementModule plein />}>
          <ChangementMotDePasseObligatoirePage />
        </Suspense>
      </>
    );
  }

  return (
    <>
      {splash}
      <AppAuthentifiee />
    </>
  );
}

/** Arbre de routes de l'utilisateur authentifié. */
function AppAuthentifiee() {
  return (
    <>
      {/* Constellation Lomoto (F3) : montée une seule fois par authentification
          réussie (ce composant ne remonte pas à chaque navigation, seulement
          quand on passe de non-authentifié/mot de passe obligatoire à
          authentifié normal) — indépendante des routes, peut se superposer à
          n'importe quel écran. */}
      <ConstellationLomoto />
      <Routes>
        <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        {/* Produits (V2) : fusionné dans Production (ProduitsCard) — l'ancienne
            route reste redirigée pour ne pas casser les liens déjà partagés. */}
        <Route path="/produits" element={<Navigate to="/production" replace />} />
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
          path="/commandes/clients"
          element={
            <RequiertLecture module="COMMANDES">
              <ClientsPage />
            </RequiertLecture>
          }
        />
        <Route
          path="/commandes/acceptations"
          element={
            <RequiertLecture module="COMMANDES">
              <AcceptationsLivraisonPage />
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
          path="/production/bons-livraison"
          element={
            <RequiertLecture module="PRODUCTION">
              <BonsLivraisonPage />
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
        {/* Assistant (3.19) : accessible à tous, sans permission de module. */}
        <Route path="/assistant" element={<AssistantPage />} />
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
    </>
  );
}
