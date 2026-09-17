import { defineConfig, devices } from "@playwright/test";

/**
 * Configuration Playwright (setup initial — Codex, section 3.18 du livre
 * technique, écart "Playwright absent" comblé).
 *
 * Réutilise le serveur de dev existant (apps/web sur :5173, proxy déjà en
 * place vers l'API :3001 — voir vite.config.ts) plutôt que de dupliquer une
 * config serveur séparée. `webServer` démarre l'API ET le frontend (`npm run
 * dev` à la racine, script `dev` déjà existant) avant les tests, et les
 * arrête après — sauf en local avec un serveur déjà lancé à la main
 * (`reuseExistingServer`).
 *
 * Prérequis non automatisés par cette config : base de données migrée et
 * seedée (`npx prisma migrate deploy && npm run db:seed:demo`) — comme pour
 * le développement normal, voir DEPLOIEMENT.md.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    cwd: "../..",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
