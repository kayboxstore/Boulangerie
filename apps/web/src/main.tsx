import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/lib/auth";
import { SocketProvider } from "@/lib/socket";
import { ThemeProvider, initTheme } from "@/lib/theme";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import App from "@/App";
import "@/i18n"; // initialise react-i18next avant le rendu
import "@/index.css";

// Avant le premier rendu : pose (ou non) la classe `.dark` sur <html> selon la
// préférence déjà choisie (localStorage) ou, à défaut, celle du système —
// sinon l'app afficherait le thème clair une frame avant de basculer.
initTheme();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <SocketProvider>
              <FeedbackProvider>
                <App />
              </FeedbackProvider>
            </SocketProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
