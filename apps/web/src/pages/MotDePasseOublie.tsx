import { useState, type FormEvent } from "react";
import { Info, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFeedback } from "@/components/FeedbackProvider";

const RE_EMAIL_SIMPLE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Page visuelle "Mot de passe oublié" (F2, tâche 7). AUCUN appel réseau :
 * les endpoints de récupération (jetons hachés, anti-énumération, limitation
 * de fréquence) appartiennent à Codex C3, pas encore fusionné. Cette page se
 * limite à son interface et à sa validation LOCALE — une soumission valide
 * n'affiche jamais un message laissant croire qu'un e-mail a été envoyé ;
 * elle affiche explicitement que l'intégration serveur est en attente
 * (tâche 9-10). `docs/coordination/PLAN_COORDINATION_CODEX_CLAUDE_LOMOTO.md`
 * §7 : « La PR F2 peut rester en brouillon tant que les API d'authentification
 * nécessaires ne sont pas fusionnées. »
 */
export function MotDePasseOubliePage() {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [email, setEmail] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enAttenteIntegration, setEnAttenteIntegration] = useState(false);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!RE_EMAIL_SIMPLE.test(email.trim())) {
      setErreur(t("auth.resetRequest.emailInvalid"));
      setEnAttenteIntegration(false);
      return;
    }
    setErreur(null);
    // Volontairement AUCUN appel à api(...) ici : pas de faux jeton, pas de
    // faux succès, pas de message "e-mail envoyé" — voir la note d'en-tête.
    setEnAttenteIntegration(true);
    toast({ variante: "information", message: t("auth.pendingServerIntegration") });
  }

  return (
    <AuthShell>
      <div className="overflow-hidden rounded-2xl border border-beige/60 bg-card shadow-xl dark:border-border">
        <div aria-hidden className="h-1 bg-gradient-to-r from-or via-terracotta to-or" />
        <div className="px-7 py-8">
          <h2 className="font-serif text-2xl font-bold text-marine dark:text-creme">{t("auth.resetRequest.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("auth.resetRequest.subtitle")}</p>

          <form onSubmit={onSubmit} className="mt-7 space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email-recuperation">{t("auth.resetRequest.emailLabel")}</Label>
              <div className="relative">
                <Mail aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email-recuperation"
                  type="email"
                  autoComplete="email"
                  placeholder="prenom.nom@boulangerie-lomoto.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEnAttenteIntegration(false);
                  }}
                  required
                  className="h-11 pl-9"
                  aria-describedby={erreur ? "email-recuperation-erreur" : undefined}
                />
              </div>
              {erreur && (
                <p id="email-recuperation-erreur" role="alert" className="text-sm font-medium text-terracotta">
                  {erreur}
                </p>
              )}
            </div>

            <Button type="submit" variant="cta" size="lg" className="w-full text-base">
              {t("auth.resetRequest.submit")}
            </Button>

            {/* Jamais un message de succès : l'intégration serveur (Codex C3)
                n'existe pas encore — voir la note d'en-tête du fichier. */}
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
