import { expect, test } from "@playwright/test";

/**
 * Premier scénario E2E du dépôt (setup Playwright — Codex, comble l'écart
 * "Playwright absent" du livre technique, annexes/ecarts-spec-code.md).
 *
 * S'appuie sur le compte de démonstration créé par `npm run db:seed:demo`
 * (voir prisma/seed-demo.ts) — ce script refuse de s'exécuter hors
 * développement/test (garde-environnement-seed-demo.ts), donc ce test ne
 * peut pas être lancé par erreur contre une base de production.
 */

const EMAIL_ADMIN = "admin@boulangerie-lomoto.com";
const MOT_DE_PASSE_DEMO = "Lomoto2026!";

// getByLabel("Mot de passe") seul est ambigu : il matche aussi le bouton
// "Afficher le mot de passe" (aria-label contenant les mêmes mots). Le champ
// lui-même reste ciblable sans ambiguïté via son rôle textbox.
function champMotDePasse(page: import("@playwright/test").Page) {
  return page.getByRole("textbox", { name: "Mot de passe" });
}

test.describe("Connexion", () => {
  test("un identifiant et mot de passe valides mènent au tableau de bord", async ({ page }) => {
    await page.goto("/connexion");

    await page.getByLabel("Adresse e-mail").fill(EMAIL_ADMIN);
    await champMotDePasse(page).fill(MOT_DE_PASSE_DEMO);
    await page.getByRole("button", { name: "Se connecter" }).click();

    // Le tableau de bord affiche "Bonjour, <nom>" (dashboard.greeting) —
    // attendre le rôle heading plutôt qu'une URL : plus proche de ce que
    // verrait réellement l'utilisateur, résiste à un futur changement de
    // route.
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Administrateur", {
      timeout: 10_000,
    });
  });

  test("un mot de passe incorrect affiche une erreur, sans naviguer", async ({ page }) => {
    await page.goto("/connexion");

    await page.getByLabel("Adresse e-mail").fill(EMAIL_ADMIN);
    await champMotDePasse(page).fill("ce-nest-pas-le-bon-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter" }).click();

    await expect(page.getByRole("alert")).toContainText("incorrect");
    // Toujours sur l'écran de connexion — le champ email reste rempli et
    // visible, preuve qu'aucune navigation n'a eu lieu.
    await expect(page.getByLabel("Adresse e-mail")).toHaveValue(EMAIL_ADMIN);
  });

  test("un rôle à accès limité voit le menu grisé hors de son périmètre (section 2)", async ({ page }) => {
    await page.goto("/connexion");
    await page.getByLabel("Adresse e-mail").fill("production@boulangerie-lomoto.com");
    await champMotDePasse(page).fill(MOT_DE_PASSE_DEMO);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 10_000 });

    // Le Responsable de production a l'écriture sur Production uniquement —
    // un module hors périmètre est rendu en <span aria-disabled="true">, pas
    // en lien (voir Layout.tsx) : jamais un rôle "link" pour ces entrées.
    const entreeCaisse = page.getByText("Caisse", { exact: true });
    await expect(entreeCaisse).toBeVisible();
    await expect(entreeCaisse).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("link", { name: "Caisse" })).toHaveCount(0);
  });
});
