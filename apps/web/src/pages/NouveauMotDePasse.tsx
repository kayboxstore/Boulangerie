import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordField } from "@/components/ui/password-field";
import { api, ApiError } from "@/lib/api";

const LONGUEUR_MIN = 8;
const CODE_JETON_INVALIDE = "JETON_INVALIDE_OU_EXPIRE";

type EtatJeton = "verification" | "valide" | "invalide" | "succes";

/**
 * Page "Nouveau mot de passe" (F3) — connectée aux contrats C3
 * `POST /api/auth/reinitialisation/verifier` et `POST /api/auth/reinitialisation`
 * (`docs/api-contracts/C3_SERVICES_PREMIUM.md`).
 *
 * Le jeton n'est JAMAIS lu ailleurs que dans l'URL (`?jeton=…`, format exact
 * posé par `apps/api/src/services/email.ts`), jamais journalisé, jamais
 * affiché dans un toast, jamais persisté dans `localStorage` — il ne vit que
 * dans l'état React de ce composant, reconstruit à chaque lecture de l'URL.
 *
 * Vérifié au CHARGEMENT, avant d'autoriser le formulaire (§ contrat F3) :
 * un jeton absent, mal formé, inconnu, expiré ou déjà utilisé aboutit tous
 * au même état `invalide`, avec un lien clair pour faire une nouvelle
 * demande — jamais de formulaire affiché sur un jeton qu'on sait déjà
 * inutilisable.
 */
export function NouveauMotDePassePage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const jeton = searchParams.get("jeton");

  const [etat, setEtat] = useState<EtatJeton>("verification");
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!jeton) {
      setEtat("invalide");
      return;
    }
    let actif = true;
    setEtat("verification");
    api<{ valide: boolean }>("/api/auth/reinitialisation/verifier", {
      method: "POST",
      body: JSON.stringify({ jeton }),
    })
      .then((r) => {
        if (actif) setEtat(r.valide ? "valide" : "invalide");
      })
      .catch(() => {
        // Panne réseau ou réponse inattendue : traité comme un jeton
        // inutilisable — choix conservateur, jamais de formulaire affiché
        // sur une vérification qui n'a pas pu confirmer sa validité.
        if (actif) setEtat("invalide");
      });
    return () => {
      actif = false;
    };
  }, [jeton]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (enCours || !jeton) return; // empêche une double soumission (double-clic, Entrée répétée)

    if (motDePasse.length < LONGUEUR_MIN) {
      setErreur(t("auth.resetPassword.passwordTooShort"));
      return;
    }
    if (motDePasse !== confirmation) {
      setErreur(t("auth.resetPassword.passwordMismatch"));
      return;
    }

    setErreur(null);
    setEnCours(true);
    try {
      await api("/api/auth/reinitialisation", {
        method: "POST",
        body: JSON.stringify({ jeton, nouveauMotDePasse: motDePasse }),
      });
      setEtat("succes");
    } catch (err) {
      // Le jeton a pu être consommé entre la vérification au chargement et
      // cette soumission (ex. utilisé dans un autre onglet) : même état
      // `invalide` que si la vérification initiale avait déjà échoué.
      if (err instanceof ApiError && err.status === 400 && (err.corps as { code?: string } | undefined)?.code === CODE_JETON_INVALIDE) {
        setEtat("invalide");
      } else {
        setErreur(err instanceof ApiError ? err.message : t("auth.resetPassword.genericError"));
      }
    } finally {
      setEnCours(false);
    }
  }

  return (
    <AuthShell>
      <div className="overflow-hidden rounded-2xl border border-beige/60 bg-card shadow-xl dark:border-border">
        <div aria-hidden className="h-1 bg-gradient-to-r from-or via-terracotta to-or" />
        <div className="px-7 py-8">
          {etat === "verification" && (
            <p role="status" className="text-sm text-muted-foreground">
              {t("auth.resetPassword.verifying")}
            </p>
          )}

          {etat === "invalide" && (
            <>
              <h2 className="flex items-center gap-2 font-serif text-2xl font-bold text-marine dark:text-creme">
                <XCircle aria-hidden className="h-6 w-6 shrink-0 text-terracotta" />
                {t("auth.resetPassword.invalidTitle")}
              </h2>
              <p role="status" className="mt-3 text-sm text-muted-foreground">
                {t("auth.resetPassword.invalidBody")}
              </p>
              <Button asChild variant="cta" size="lg" className="mt-6 w-full text-base">
                <Link to="/mot-de-passe-oublie">{t("auth.resetPassword.requestNewLink")}</Link>
              </Button>
            </>
          )}

          {etat === "succes" && (
            <>
              <h2 className="flex items-center gap-2 font-serif text-2xl font-bold text-marine dark:text-creme">
                <CheckCircle2 aria-hidden className="h-6 w-6 shrink-0 text-succes" />
                {t("auth.resetPassword.successTitle")}
              </h2>
              <p role="status" className="mt-3 text-sm text-muted-foreground">
                {t("auth.resetPassword.success")}
              </p>
              <Button asChild variant="cta" size="lg" className="mt-6 w-full text-base">
                <Link to="/connexion">{t("auth.resetPassword.goToLogin")}</Link>
              </Button>
            </>
          )}

          {etat === "valide" && (
            <>
              <h2 className="font-serif text-2xl font-bold text-marine dark:text-creme">{t("auth.resetPassword.title")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("auth.resetPassword.subtitle")}</p>

              <form onSubmit={onSubmit} className="mt-7 space-y-5" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="nouveau-mdp">{t("auth.resetPassword.newPasswordLabel")}</Label>
                  <PasswordField
                    id="nouveau-mdp"
                    autoComplete="new-password"
                    value={motDePasse}
                    onChange={(e) => {
                      setMotDePasse(e.target.value);
                      setErreur(null);
                    }}
                    required
                    disabled={enCours}
                    afficherRobustesse
                    aria-describedby={erreur ? "nouveau-mdp-erreur" : undefined}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmation-mdp">{t("auth.resetPassword.confirmPasswordLabel")}</Label>
                  <PasswordField
                    id="confirmation-mdp"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(e) => {
                      setConfirmation(e.target.value);
                      setErreur(null);
                    }}
                    required
                    disabled={enCours}
                    aria-describedby={erreur ? "nouveau-mdp-erreur" : undefined}
                  />
                </div>

                {erreur && (
                  <p id="nouveau-mdp-erreur" role="alert" className="text-sm font-medium text-terracotta">
                    {erreur}
                  </p>
                )}

                <Button type="submit" variant="cta" size="lg" loading={enCours} className="w-full text-base">
                  {t("auth.resetPassword.submit")}
                </Button>
              </form>
            </>
          )}

          <Link
            to="/connexion"
            className="mt-6 flex min-h-11 items-center justify-center text-center text-sm font-medium text-terracotta hover:underline dark:text-or"
          >
            {t("auth.backToLogin")}
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
