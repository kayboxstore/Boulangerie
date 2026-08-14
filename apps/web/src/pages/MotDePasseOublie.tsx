import { useState, type FormEvent } from "react";
import { CheckCircle2, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";

const RE_EMAIL_SIMPLE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Page "Mot de passe oublié" (F3) — connectée à `POST
 * /api/auth/mot-de-passe-oublie` (contrat C3,
 * `docs/api-contracts/C3_SERVICES_PREMIUM.md`).
 *
 * Anti-énumération PRÉSERVÉE côté client : le serveur répond `202` avec un
 * message IDENTIQUE que l'adresse existe, soit inactive, en temporisation ou
 * que l'envoi échoue — cette page affiche donc TOUJOURS le même message de
 * succès générique sur `202`, sans jamais tenter de distinguer les cas.
 * Une seule annonce accessible : le message persistant ci-dessous, jamais un
 * toast en plus (même règle que la double annonce de la revue Codex F2
 * round 2, désormais appliquée aux vraies réponses serveur).
 */
export function MotDePasseOubliePage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoye, setEnvoye] = useState(false);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (enCours) return; // empêche une double soumission (double-clic, Entrée répétée)

    if (!RE_EMAIL_SIMPLE.test(email.trim())) {
      setErreur(t("auth.resetRequest.emailInvalid"));
      setEnvoye(false);
      return;
    }
    setErreur(null);
    setEnCours(true);
    try {
      // Réponse `202` toujours identique (anti-énumération, cf. note d'en-tête) :
      // le corps n'est volontairement jamais lu ni affiché, seul le succès HTTP compte.
      await api("/api/auth/mot-de-passe-oublie", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setEnvoye(true);
    } catch (err) {
      // 400 (format rejeté côté serveur), 429 (limitation de fréquence) ou panne
      // réseau : le message vient déjà de `ApiError`/`api()`, en français, jamais
      // affiché tel quel pour du texte technique brut (voir lib/api.ts).
      setErreur(err instanceof ApiError ? err.message : t("auth.resetRequest.genericError"));
      setEnvoye(false);
    } finally {
      setEnCours(false);
    }
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
                    setErreur(null);
                    setEnvoye(false);
                  }}
                  required
                  disabled={enCours}
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

            <Button type="submit" variant="cta" size="lg" loading={enCours} className="w-full text-base">
              {t("auth.resetRequest.submit")}
            </Button>

            {/* Message persistant (jamais un toast en plus, voir note d'en-tête) :
                cette confirmation reste lisible tant que l'utilisateur ne quitte
                pas la page, elle ne doit jamais s'effacer automatiquement. */}
            {envoye && (
              <p role="status" className="flex items-start gap-2 rounded-md bg-succes/10 px-3 py-2 text-sm font-medium text-succes">
                <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                {t("auth.resetRequest.success")}
              </p>
            )}
          </form>

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
