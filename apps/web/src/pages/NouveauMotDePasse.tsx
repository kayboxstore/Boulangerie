import { useState, type FormEvent } from "react";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordField } from "@/components/ui/password-field";
import { useFeedback } from "@/components/FeedbackProvider";

const LONGUEUR_MIN = 8;

/**
 * Page visuelle "Nouveau mot de passe" (F2, tâche 7). Comme
 * MotDePasseOublie.tsx : AUCUN appel réseau, aucune modification de mot de
 * passe réelle ni locale — les jetons de réinitialisation (hachés,
 * expirables, à usage unique) appartiennent à Codex C3. Seule la validation
 * LOCALE (longueur minimale, confirmation identique) est effectuée ici ; une
 * soumission valide affiche explicitement l'attente d'intégration serveur,
 * jamais un message de succès.
 */
export function NouveauMotDePassePage() {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enAttenteIntegration, setEnAttenteIntegration] = useState(false);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (motDePasse.length < LONGUEUR_MIN) {
      setErreur(t("auth.resetPassword.passwordTooShort"));
      setEnAttenteIntegration(false);
      return;
    }
    if (motDePasse !== confirmation) {
      setErreur(t("auth.resetPassword.passwordMismatch"));
      setEnAttenteIntegration(false);
      return;
    }
    setErreur(null);
    // Volontairement AUCUN appel à api(...) ici — voir la note d'en-tête.
    setEnAttenteIntegration(true);
    toast({ variante: "information", message: t("auth.pendingServerIntegration") });
  }

  return (
    <AuthShell>
      <div className="overflow-hidden rounded-2xl border border-beige/60 bg-card shadow-xl dark:border-border">
        <div aria-hidden className="h-1 bg-gradient-to-r from-or via-terracotta to-or" />
        <div className="px-7 py-8">
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
                  setEnAttenteIntegration(false);
                }}
                required
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
                  setEnAttenteIntegration(false);
                }}
                required
                aria-describedby={erreur ? "nouveau-mdp-erreur" : undefined}
              />
            </div>

            {erreur && (
              <p id="nouveau-mdp-erreur" role="alert" className="text-sm font-medium text-terracotta">
                {erreur}
              </p>
            )}

            <Button type="submit" variant="cta" size="lg" className="w-full text-base">
              {t("auth.resetPassword.submit")}
            </Button>

            {enAttenteIntegration && (
              <p role="status" className="flex items-start gap-2 rounded-md bg-or/10 px-3 py-2 text-sm font-medium text-marine dark:text-or">
                <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                {t("auth.pendingServerIntegration")}
              </p>
            )}
          </form>

          <Link to="/connexion" className="mt-6 block text-center text-sm font-medium text-terracotta hover:underline dark:text-or">
            {t("auth.backToLogin")}
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
