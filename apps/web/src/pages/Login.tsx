import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function LoginPage() {
  const { login } = useAuth();
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
    <div className="flex min-h-screen bg-creme">
      {/* Panneau de marque — marine, logo, tagline */}
      <div className="relative hidden flex-1 flex-col items-center justify-center overflow-hidden bg-marine text-creme lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 25% 20%, #DA9F4E 0, transparent 45%), radial-gradient(circle at 80% 80%, #AD5416 0, transparent 40%)",
          }}
        />
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-or via-terracotta to-or" />
        <img
          src="/logo-lomoto.png"
          alt="Logo Boulangerie Lomoto"
          className="relative h-44 w-44 rounded-full object-contain shadow-2xl ring-4 ring-or/60"
        />
        <h1 className="relative mt-8 font-serif text-4xl font-bold tracking-tight text-or">
          Boulangerie Lomoto
        </h1>
        <p className="relative mt-3 text-lg italic text-beige">« Pain Lia o Tonda »</p>
        <div className="relative mt-6 h-px w-24 bg-or/50" />
        <p className="relative mt-6 max-w-sm text-center text-sm leading-relaxed text-creme/60">
          {t("login.tagline")}
        </p>
      </div>

      {/* Formulaire de connexion */}
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Marque visible sur mobile / petits écrans */}
          <div className="mb-8 flex flex-col items-center lg:hidden">
            <img
              src="/logo-lomoto.png"
              alt="Logo Boulangerie Lomoto"
              className="h-24 w-24 rounded-full object-contain ring-4 ring-or/60"
            />
            <h1 className="mt-4 font-serif text-2xl font-bold text-marine">Boulangerie Lomoto</h1>
            <p className="mt-1 text-sm italic text-terracotta">« Pain Lia o Tonda »</p>
          </div>

          <Card className="border-beige/60 shadow-lg">
            <CardHeader>
              <CardTitle className="font-serif text-2xl text-marine dark:text-creme">{t("login.title")}</CardTitle>
              <CardDescription>{t("login.subtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="email">{t("login.email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="vous@lomoto.cd"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="motDePasse">{t("login.password")}</Label>
                  <Input
                    id="motDePasse"
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={motDePasse}
                    onChange={(e) => setMotDePasse(e.target.value)}
                    required
                  />
                </div>

                {erreur && (
                  <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                    {erreur}
                  </p>
                )}

                <Button type="submit" variant="cta" className="w-full" disabled={enCours}>
                  {enCours && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("login.submit")}
                </Button>
              </form>
            </CardContent>
          </Card>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            {t("login.footer")}
          </p>
        </div>
      </div>
    </div>
  );
}
