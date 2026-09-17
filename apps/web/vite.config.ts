import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // On isole en chunks stables (cache long) uniquement les vendors
        // nécessaires dès l'initial. Recharts et framer-motion ne sont PAS
        // listés ici volontairement : les nommer en chunk manuel les ferait
        // précharger (modulepreload) au démarrage. Laissés au découpage
        // automatique, ils suivent leurs consommateurs lazy (recharts →
        // Dashboard, framer-motion → cloche/feed) et ne sont récupérés qu'au besoin.
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "query-vendor": ["@tanstack/react-query"],
          "i18n-vendor": ["i18next", "react-i18next"],
        },
      },
    },
  },
  server: {
    // host: true -> écoute sur 0.0.0.0 (toutes les interfaces), pas seulement
    // localhost, pour permettre l'accès depuis un autre appareil du réseau Wi-Fi
    // (téléphone). Le frontend appelle l'API en relatif (/api, /socket.io) et
    // Vite proxifie vers l'API : l'appareil n'a donc besoin d'atteindre QUE ce
    // serveur (port 5173), pas directement l'API (3001).
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:3001",
        ws: true,
      },
    },
  },
  preview: {
    host: true,
    port: 4173,
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/socket.io": { target: "http://localhost:3001", ws: true },
    },
  },
});
