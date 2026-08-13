// @vitest-environment jsdom

import "@/i18n";
import type { UtilisateurDTO } from "@lomoto/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./auth";

const apiMock = vi.fn();

// Le jeton interne (getToken/setToken) vit DANS la factory (et non comme une
// variable référencée depuis l'extérieur) pour éviter le piège de hoisting de
// `vi.mock` déjà rencontré ailleurs dans ce projet (voir
// ChangementMotDePasseObligatoire.dom.test.tsx) : toute variable simple
// déclarée hors factory et référencée à l'intérieur lève une
// `ReferenceError` (TDZ), sauf pour les `const x = vi.fn()` reconnus par
// Vitest. `__definirJetonPourTest` est une extension réservée aux tests, sans
// équivalent en production, qui permet de positionner le jeton AVANT le
// montage de `<AuthProvider>` (scénario « restauration initiale »).
vi.mock("@/lib/api", () => {
  let jetonInterne: string | null = null;
  return {
    api: (...args: unknown[]) => apiMock(...args),
    getToken: () => jetonInterne,
    setToken: (t: string | null) => {
      jetonInterne = t;
    },
    surSessionRemplacee: () => {},
    __definirJetonPourTest: (t: string | null) => {
      jetonInterne = t;
    },
  };
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  apiMock.mockReset();
  // `jetonInterne` vit dans la closure de la factory `vi.mock` (une seule
  // instance pour tout le fichier) : sans ce reset, un `login()` d'un test
  // laisserait un jeton non nul traîner pour le test suivant, qui basculerait
  // alors involontairement sur la branche « restauration via /me » au montage.
  const apiModule = (await import("@/lib/api")) as unknown as { __definirJetonPourTest: (t: string | null) => void };
  apiModule.__definirJetonPourTest(null);
});

function utilisateurFactice(id: string, nom: string): UtilisateurDTO {
  return {
    id,
    nom,
    email: `${id}@boulangerie-lomoto.com`,
    estAdminPrincipal: false,
    role: { id: "r1", nom: "Production", roleParentId: null, permissions: [] },
    languePreferee: "FR",
  } as UtilisateurDTO;
}

/** Route les appels `api(path, options)` du mock vers un gestionnaire par chemin. */
function routerApi(gestionnaires: Record<string, (options?: { body?: string }) => unknown>) {
  apiMock.mockImplementation((path: string, options?: { body?: string }) => {
    const gestionnaire = gestionnaires[path];
    if (!gestionnaire) return Promise.reject(new Error(`route non simulée dans ce test : ${path}`));
    return Promise.resolve(gestionnaire(options));
  });
}

const ROUTES_PRE_CONNEXION = {
  "/api/auth/langue-defaut": () => ({ langueDefaut: "FR" }),
  "/api/auth/etat-initial": () => ({ premierLancement: false }),
};

/** Sonde exposant l'état de useAuth() dans le DOM, pour piloter login/logout/rafraichirIdentite depuis les tests. */
function SondeAuth() {
  const { utilisateur, sessionAuthId, chargement, login, logout, rafraichirIdentite } = useAuth();
  return (
    <div>
      <div data-testid="chargement">{String(chargement)}</div>
      <div data-testid="utilisateur">{utilisateur?.nom ?? "aucun"}</div>
      <div data-testid="session-id">{sessionAuthId ?? "aucune"}</div>
      <button onClick={() => void login("a@boulangerie-lomoto.com", "peu importe")}>connecter-a</button>
      <button onClick={() => void login("b@boulangerie-lomoto.com", "peu importe")}>connecter-b</button>
      <button onClick={() => logout()}>deconnecter</button>
      <button onClick={() => void rafraichirIdentite()}>rafraichir</button>
    </div>
  );
}

function rendre() {
  return render(
    <AuthProvider>
      <SondeAuth />
    </AuthProvider>,
  );
}

function loginRoute(getUtilisateur: (email: string) => UtilisateurDTO) {
  return (options?: { body?: string }) => {
    const { email } = JSON.parse(options?.body ?? "{}") as { email: string };
    return { token: `jeton-${email}`, utilisateur: getUtilisateur(email), langueDefautBoutique: "FR" };
  };
}

describe("AuthProvider — rafraichirIdentite() et sessionAuthId (F3, revue Codex)", () => {
  it("login() attribue un sessionAuthId opaque ; rafraichirIdentite() réussi ne le change jamais", async () => {
    routerApi({
      ...ROUTES_PRE_CONNEXION,
      "/api/auth/login": loginRoute((email) => utilisateurFactice(email, "Chef A")),
    });
    rendre();
    await waitFor(() => expect(screen.getByTestId("chargement").textContent).toBe("false"));

    fireEvent.click(screen.getByRole("button", { name: "connecter-a" }));
    await waitFor(() => expect(screen.getByTestId("utilisateur").textContent).toBe("Chef A"));
    const idApresLogin = screen.getByTestId("session-id").textContent;
    expect(idApresLogin).not.toBe("aucune");
    // Jamais le jeton JWT brut : le jeton renvoyé par /api/auth/login vaut
    // "jeton-a@boulangerie-lomoto.com" (voir loginRoute) et ne doit apparaître nulle part.
    expect(idApresLogin).not.toContain("jeton-");

    routerApi({
      ...ROUTES_PRE_CONNEXION,
      "/api/auth/login": loginRoute((email) => utilisateurFactice(email, "Chef A")),
      "/api/auth/me": () => ({ utilisateur: utilisateurFactice("a@boulangerie-lomoto.com", "Chef A (mis à jour)"), langueDefautBoutique: "FR" }),
    });
    fireEvent.click(screen.getByRole("button", { name: "rafraichir" }));
    await waitFor(() => expect(screen.getByTestId("utilisateur").textContent).toBe("Chef A (mis à jour)"));

    // Simple mise à jour d'identité dans la même session : sessionAuthId inchangé.
    expect(screen.getByTestId("session-id").textContent).toBe(idApresLogin);
  });

  it("déconnexion pendant rafraichirIdentite() en vol : la réponse tardive ne restaure jamais l'ancien utilisateur", async () => {
    let resoudreMe!: (v: unknown) => void;
    routerApi({
      ...ROUTES_PRE_CONNEXION,
      "/api/auth/login": loginRoute((email) => utilisateurFactice(email, "Chef A")),
      "/api/auth/me": () => new Promise((r) => (resoudreMe = r)),
    });
    rendre();
    await waitFor(() => expect(screen.getByTestId("chargement").textContent).toBe("false"));
    fireEvent.click(screen.getByRole("button", { name: "connecter-a" }));
    await waitFor(() => expect(screen.getByTestId("utilisateur").textContent).toBe("Chef A"));

    // rafraichirIdentite() part, reste en vol...
    fireEvent.click(screen.getByRole("button", { name: "rafraichir" }));
    // ...puis une déconnexion survient AVANT que /me ne réponde.
    fireEvent.click(screen.getByRole("button", { name: "deconnecter" }));
    await waitFor(() => expect(screen.getByTestId("utilisateur").textContent).toBe("aucun"));
    expect(screen.getByTestId("session-id").textContent).toBe("aucune");

    // La réponse tardive de /me arrive maintenant : elle ne doit RIEN restaurer.
    resoudreMe({ utilisateur: utilisateurFactice("a@boulangerie-lomoto.com", "Chef A"), langueDefautBoutique: "FR" });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId("utilisateur").textContent).toBe("aucun");
    expect(screen.getByTestId("session-id").textContent).toBe("aucune");
  });

  it("connexion d'un autre utilisateur pendant rafraichirIdentite() en vol : le nouvel utilisateur est conservé, jamais écrasé", async () => {
    let resoudreMe!: (v: unknown) => void;
    routerApi({
      ...ROUTES_PRE_CONNEXION,
      "/api/auth/login": loginRoute((email) =>
        email === "a@boulangerie-lomoto.com" ? utilisateurFactice(email, "Chef A") : utilisateurFactice(email, "Chef B"),
      ),
      "/api/auth/me": () => new Promise((r) => (resoudreMe = r)),
    });
    rendre();
    await waitFor(() => expect(screen.getByTestId("chargement").textContent).toBe("false"));
    fireEvent.click(screen.getByRole("button", { name: "connecter-a" }));
    await waitFor(() => expect(screen.getByTestId("utilisateur").textContent).toBe("Chef A"));

    // rafraichirIdentite() de la session A part, reste en vol...
    fireEvent.click(screen.getByRole("button", { name: "rafraichir" }));
    // ...A se déconnecte, puis B se connecte AVANT que la réponse /me de A n'arrive.
    fireEvent.click(screen.getByRole("button", { name: "deconnecter" }));
    fireEvent.click(screen.getByRole("button", { name: "connecter-b" }));
    await waitFor(() => expect(screen.getByTestId("utilisateur").textContent).toBe("Chef B"));
    const idSessionB = screen.getByTestId("session-id").textContent;

    // La réponse tardive de /me (déclenchée pour A) arrive maintenant : B doit rester affiché.
    resoudreMe({ utilisateur: utilisateurFactice("a@boulangerie-lomoto.com", "Chef A"), langueDefautBoutique: "FR" });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.getByTestId("utilisateur").textContent).toBe("Chef B");
    expect(screen.getByTestId("session-id").textContent).toBe(idSessionB);
  });

  it("restauration initiale réussie via /api/auth/me attribue aussi un sessionAuthId, sans jamais exposer le jeton", async () => {
    const apiModule = (await import("@/lib/api")) as unknown as { __definirJetonPourTest: (t: string | null) => void };
    apiModule.__definirJetonPourTest("jeton-stocke-avant-montage");
    routerApi({
      "/api/auth/me": () => ({ utilisateur: utilisateurFactice("a@boulangerie-lomoto.com", "Chef A"), langueDefautBoutique: "FR" }),
    });
    rendre();

    await waitFor(() => expect(screen.getByTestId("utilisateur").textContent).toBe("Chef A"));
    const id = screen.getByTestId("session-id").textContent;
    expect(id).not.toBe("aucune");
    expect(id).not.toContain("jeton-stocke-avant-montage");
  });
});
