// @vitest-environment jsdom

import "@/i18n";
import { useState } from "react";
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
    photoUrl: null,
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
  // Capture explicitement le résultat de rafraichirIdentite() — y compris une
  // ÉVENTUELLE exception — pour vérifier depuis les tests qu'un rejet tardif
  // d'une session périmée ne se propage JAMAIS jusqu'à l'appelant (round 3,
  // revue Codex) : seul un rejet appartenant à la session COURANTE doit
  // ressortir comme `erreur:...`.
  const [resultatRafraichir, setResultatRafraichir] = useState("attente");
  async function declencherRafraichir() {
    setResultatRafraichir("attente");
    try {
      const confirmee = await rafraichirIdentite();
      setResultatRafraichir(confirmee ? "true" : "false");
    } catch (err) {
      setResultatRafraichir(`erreur:${err instanceof Error ? err.message : "inconnue"}`);
    }
  }
  return (
    <div>
      <div data-testid="chargement">{String(chargement)}</div>
      <div data-testid="utilisateur">{utilisateur?.nom ?? "aucun"}</div>
      <div data-testid="session-id">{sessionAuthId ?? "aucune"}</div>
      <div data-testid="resultat-rafraichir">{resultatRafraichir}</div>
      <button onClick={() => void login("a@boulangerie-lomoto.com", "peu importe")}>connecter-a</button>
      <button onClick={() => void login("b@boulangerie-lomoto.com", "peu importe")}>connecter-b</button>
      <button onClick={() => logout()}>deconnecter</button>
      <button onClick={() => void declencherRafraichir()}>rafraichir</button>
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

  it("round 3 — déconnexion pendant rafraichirIdentite() en vol, puis REJET tardif : false, aucune restauration, aucune exception propagée", async () => {
    let rejeterMe!: (err: unknown) => void;
    routerApi({
      ...ROUTES_PRE_CONNEXION,
      "/api/auth/login": loginRoute((email) => utilisateurFactice(email, "Chef A")),
      "/api/auth/me": () => new Promise((_r, reject) => (rejeterMe = reject)),
    });
    rendre();
    await waitFor(() => expect(screen.getByTestId("chargement").textContent).toBe("false"));
    fireEvent.click(screen.getByRole("button", { name: "connecter-a" }));
    await waitFor(() => expect(screen.getByTestId("utilisateur").textContent).toBe("Chef A"));

    // rafraichirIdentite() de A part, reste en vol...
    fireEvent.click(screen.getByRole("button", { name: "rafraichir" }));
    // ...puis A se déconnecte AVANT que /me ne rejette.
    fireEvent.click(screen.getByRole("button", { name: "deconnecter" }));
    await waitFor(() => expect(screen.getByTestId("utilisateur").textContent).toBe("aucun"));

    // Le rejet tardif de /me arrive maintenant : il ne doit ni restaurer
    // l'ancien utilisateur, ni ressortir comme une exception (ce qui
    // déclencherait à tort une déconnexion forcée côté appelant, ex.
    // ChangementMotDePasseObligatoirePage).
    rejeterMe(new Error("panne réseau tardive"));
    await waitFor(() => expect(screen.getByTestId("resultat-rafraichir").textContent).toBe("false"));
    expect(screen.getByTestId("utilisateur").textContent).toBe("aucun");
    expect(screen.getByTestId("session-id").textContent).toBe("aucune");
  });

  it("round 3 — déconnexion de A puis connexion de B, ensuite REJET tardif du /me de A : B reste connecté, sessionAuthId inchangé, aucune exception propagée", async () => {
    let rejeterMe!: (err: unknown) => void;
    routerApi({
      ...ROUTES_PRE_CONNEXION,
      "/api/auth/login": loginRoute((email) =>
        email === "a@boulangerie-lomoto.com" ? utilisateurFactice(email, "Chef A") : utilisateurFactice(email, "Chef B"),
      ),
      "/api/auth/me": () => new Promise((_r, reject) => (rejeterMe = reject)),
    });
    rendre();
    await waitFor(() => expect(screen.getByTestId("chargement").textContent).toBe("false"));
    fireEvent.click(screen.getByRole("button", { name: "connecter-a" }));
    await waitFor(() => expect(screen.getByTestId("utilisateur").textContent).toBe("Chef A"));

    // rafraichirIdentite() de A part, reste en vol...
    fireEvent.click(screen.getByRole("button", { name: "rafraichir" }));
    // ...A se déconnecte, puis B se connecte AVANT que /me de A ne rejette.
    fireEvent.click(screen.getByRole("button", { name: "deconnecter" }));
    fireEvent.click(screen.getByRole("button", { name: "connecter-b" }));
    await waitFor(() => expect(screen.getByTestId("utilisateur").textContent).toBe("Chef B"));
    const idSessionB = screen.getByTestId("session-id").textContent;

    // Le rejet tardif de /me (déclenché pour A) arrive maintenant : B doit
    // rester connecté, sans exception propagée (donc aucune déconnexion
    // forcée tardive ni aucun toast qui appartiendrait à la session de A).
    rejeterMe(new Error("panne réseau tardive de la session A"));
    await waitFor(() => expect(screen.getByTestId("resultat-rafraichir").textContent).toBe("false"));
    expect(screen.getByTestId("utilisateur").textContent).toBe("Chef B");
    expect(screen.getByTestId("session-id").textContent).toBe(idSessionB);
  });

  it("round 3 — rejet de /me SANS changement de génération : l'erreur est bien propagée (parcours de reconnexion obligatoire conservé)", async () => {
    routerApi({
      ...ROUTES_PRE_CONNEXION,
      "/api/auth/login": loginRoute((email) => utilisateurFactice(email, "Chef A")),
      "/api/auth/me": () => Promise.reject(new Error("le serveur a refusé /me")),
    });
    rendre();
    await waitFor(() => expect(screen.getByTestId("chargement").textContent).toBe("false"));
    fireEvent.click(screen.getByRole("button", { name: "connecter-a" }));
    await waitFor(() => expect(screen.getByTestId("utilisateur").textContent).toBe("Chef A"));

    // Aucune déconnexion ni nouvelle connexion entre-temps : la génération
    // n'a pas changé, l'échec appartient bien à la session courante — il DOIT
    // ressortir comme une exception pour que l'appelant (ex.
    // ChangementMotDePasseObligatoirePage) puisse déclencher son parcours de
    // reconnexion obligatoire avec le message persistant dédié.
    fireEvent.click(screen.getByRole("button", { name: "rafraichir" }));
    await waitFor(() => expect(screen.getByTestId("resultat-rafraichir").textContent).toBe("erreur:le serveur a refusé /me"));
    // La session A elle-même reste inchangée par cet échec ponctuel.
    expect(screen.getByTestId("utilisateur").textContent).toBe("Chef A");
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
