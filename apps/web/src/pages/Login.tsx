import { useState, type FormEvent } from "react";
import { Eye, EyeOff, Info, Loader2, Lock, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TAGLINE } from "@lomoto/shared";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginPage() {
  const { login, messageSessionRemplacee } = useAuth();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [motDePasseVisible, setMotDePasseVisible] = useState(false);
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
    <div className="flex min-h-screen flex-col bg-creme lg:flex-row dark:bg-background">
      {/* --- Panneau de marque (desktop) --- */}
      <div className="relative hidden flex-1 flex-col items-center justify-center overflow-hidden bg-marine px-10 text-creme lg:flex">
        {/* Profondeur : dégradés superposés + halo doré animé */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 22% 18%, #DA9F4E 0, transparent 45%), radial-gradient(circle at 82% 82%, #AD5416 0, transparent 42%)",
          }}
        />
        <div
          aria-hidden
          className="lomoto-splash-halo pointer-events-none absolute h-[30rem] w-[30rem] rounded-full bg-or/10 blur-3xl"
        />
        {/* Liseré doré haut et bas */}
        <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-or to-transparent" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-or/40 to-transparent" />

        <div className="lomoto-splash relative flex flex-col items-center text-center">
          <img
            src="/logo-lomoto.png"
            alt="Logo Boulangerie Lomoto"
            className="h-40 w-40 rounded-full object-contain shadow-2xl ring-4 ring-or/60"
          />
          <h1 className="mt-8 font-serif text-4xl font-bold tracking-tight">
            Boulangerie <span className="text-or">Lomoto</span>
          </h1>
          <p className="mt-3 font-serif text-lg italic text-beige">« {TAGLINE} »</p>

          {/* Filet décoratif avec pastille centrale */}
          <div aria-hidden className="mt-7 flex items-center gap-3">
            <span className="h-px w-16 bg-or/40" />
            <span className="h-1.5 w-1.5 rotate-45 bg-or/70" />
            <span className="h-px w-16 bg-or/40" />
          </div>

          <p className="mt-7 max-w-sm text-sm leading-relaxed text-creme/60">{t("login.tagline")}</p>
        </div>
      </div>

      {/* --- Formulaire --- */}
      <div className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="lomoto-splash w-full max-w-md">
          {/* Marque compacte, écrans sans panneau latéral */}
          <div className="mb-9 flex flex-col items-center lg:hidden">
            <img
              src="/logo-lomoto.png"
              alt="Logo Boulangerie Lomoto"
              className="h-24 w-24 rounded-full object-contain ring-4 ring-or/60"
            />
            <h1 className="mt-4 font-serif text-2xl font-bold text-marine dark:text-creme">
              Boulangerie <span className="text-or">Lomoto</span>
            </h1>
            <p className="mt-1 font-serif text-sm italic text-terracotta dark:text-or">« {TAGLINE} »</p>
          </div>

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
                  <Label htmlFor="motDePasse">{t("login.password")}</Label>
                  <div className="relative">
                    <Lock aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="motDePasse"
                      type={motDePasseVisible ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={motDePasse}
                      onChange={(e) => setMotDePasse(e.target.value)}
                      required
                      className="px-9"
                    />
                    <button
                      type="button"
                      onClick={() => setMotDePasseVisible((v) => !v)}
                      aria-label={motDePasseVisible ? t("login.hidePassword") : t("login.showPassword")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {motDePasseVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {erreur && (
                  <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                    {erreur}
                  </p>
                )}

                <Button type="submit" variant="cta" size="lg" className="w-full text-base" disabled={enCours}>
                  {enCours && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("login.submit")}
                </Button>
              </form>
            </div>
          </div>

          <p className="mt-7 text-center text-xs text-muted-foreground">{t("login.footer")}</p>
        </div>
      </div>
    </div>
  );
}
