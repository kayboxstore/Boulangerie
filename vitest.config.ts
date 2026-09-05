import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    // apps/web/e2e/** : scénarios Playwright (test.describe de
    // @playwright/test, pas vitest) — même extension .spec.ts que les
    // conventions vitest existantes, à exclure explicitement pour éviter
    // que les deux runners ne se marchent dessus. On étend la liste par
    // défaut de vitest (configDefaults.exclude) plutôt que de la remplacer,
    // pour ne pas perdre ses exclusions habituelles (dist, node_modules...).
    exclude: [...configDefaults.exclude, "**/e2e/**"],
  },
});
