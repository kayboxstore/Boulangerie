import { describe, expect, it } from "vitest";
import { cheminAutoriseAvecMotDePasseTemporaire } from "./auth.js";

describe("cloisonnement du mot de passe temporaire", () => {
  it("autorise uniquement la lecture de la session et le remplacement du secret", () => {
    expect(cheminAutoriseAvecMotDePasseTemporaire("GET", "/api/auth/me")).toBe(true);
    expect(cheminAutoriseAvecMotDePasseTemporaire("POST", "/api/auth/mot-de-passe")).toBe(true);
    expect(cheminAutoriseAvecMotDePasseTemporaire("POST", "/api/auth/mot-de-passe?source=temporaire")).toBe(true);
  });

  it("refuse les modules métier, le profil et une mauvaise méthode HTTP", () => {
    expect(cheminAutoriseAvecMotDePasseTemporaire("GET", "/api/produits")).toBe(false);
    expect(cheminAutoriseAvecMotDePasseTemporaire("GET", "/api/auth/profil")).toBe(false);
    expect(cheminAutoriseAvecMotDePasseTemporaire("GET", "/api/auth/mot-de-passe")).toBe(false);
    expect(cheminAutoriseAvecMotDePasseTemporaire("POST", "/api/auth/me")).toBe(false);
  });

  it("refuse les préfixes trompeurs", () => {
    expect(cheminAutoriseAvecMotDePasseTemporaire("GET", "/api/auth/me/permissions")).toBe(false);
    expect(cheminAutoriseAvecMotDePasseTemporaire("POST", "/api/auth/mot-de-passe/contourner")).toBe(false);
  });
});
