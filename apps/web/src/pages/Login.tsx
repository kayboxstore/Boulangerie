import { useState, type FormEvent } from "react";
import { Info, Lock, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordField } from "@/components/ui/password-field";

export function LoginPage() {
  const { login, messageSessionRemplacee } = useAuth();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      await login(email, motDePasse);
    } catch (err) {
      setErreur(err instanceof Error ? err.message : t("login.error"));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <AuthShell>
      {/* Carte sur-mesure : arête dorée en haut, ombre douce */}
      <div className="overflow-hidden rounded-2xl border border-beige/60 bg-card shadow-xl dark:border-border">
        <div aria-hidden className="h-1 bg-gradient-to-r from-or via-terracotta to-or" />
        <div className="px-7 py-8">
          <h2 className="font-serif text-2xl font-bold text-marine dark:text-creme">{t("login.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("login.subtitle")}</p>

          {messageSessionRemplacee && (
            <p
              role="status"
              className="mt-5 flex items-start gap-2 rounded-md bg-or/10 px-3 py-2 text-sm font-medium text-marine dark:text-or"
            >
              <Info aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              {messageSessionRemplacee}
            </p>
          )}

          <form onSubmit={onSubmit} className="mt-7 space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">{t("login.email")}</Label>
              <div className="relative">
                <Mail aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="prenom.nom@boulangerie-lomoto.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="motDePasse">{t("login.password")}</Label>
                <Link to="/mot-de-passe-oublie" className="text-xs font-medium text-terracotta hover:underline dark:text-or">
                  {t("auth.forgotPasswordLink")}
                </Link>
              </div>
              <div className="relative">
                <Lock aria-hidden className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <PasswordField
                  id="motDePasse"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={motDePasse}
                  onChange={(e) => setMotDePasse(e.target.value)}
                  required
                  className="pl-9"
                />
              </div>
            </div>

            {erreur && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreur}
              </p>
            )}

            <Button type="submit" variant="cta" size="lg" loading={enCours} className="w-full text-base">
              {t("login.submit")}
            </Button>
          </form>
        </div>
      </div>

      <p className="mt-7 text-center text-xs text-muted-foreground">{t("login.footer")}</p>
    </AuthShell>
  );
}
