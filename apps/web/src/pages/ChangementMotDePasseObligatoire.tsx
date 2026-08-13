import { useState, type FormEvent } from "react";
import { LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordField } from "@/components/ui/password-field";
import { useFeedback } from "@/components/FeedbackProvider";

const LONGUEUR_MIN = 8;

/**
 * Parcours bloquant de changement du mot de passe temporaire (F3, contrat
 * C3 §« Session et mot de passe temporaire »). Affiché à la place de
 * l'application authentifiée entière tant que `utilisateur.motDePasseDoitChanger`
 * vaut `true` (voir `App.tsx`) : aucune route métier n'est montée, donc
 * aucune requête métier ne part et Socket.io ne se connecte pas non plus
 * (garde symétrique dans `lib/socket.tsx`) — cohérent avec le serveur, qui
 * refuse déjà tout sauf `GET /api/auth/me` et `POST /api/auth/mot-de-passe`
 * pour ce compte (403 `MOT_DE_PASSE_A_CHANGER`, `middleware/auth.ts`).
 *
 * Après un `POST /api/auth/mot-de-passe` réussi (204), `rafraichirIdentite()`
 * recharge `GET /api/auth/me` : l'application normale ne revient QU'après
 * cette confirmation serveur, jamais en anticipant localement le succès.
 */
export function ChangementMotDePasseObligatoirePage() {
  const { t } = useTranslation();
  const { logout, rafraichirIdentite } = useAuth();
  const { toast } = useFeedback();
  const [motDePasseActuel, setMotDePasseActuel] = useState("");
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (enCours) return; // empêche une double soumission (double-clic, Entrée répétée)

    if (nouveauMotDePasse.length < LONGUEUR_MIN) {
      setErreur(t("auth.mandatoryChange.passwordTooShort"));
      return;
    }
    if (nouveauMotDePasse !== confirmation) {
      setErreur(t("auth.mandatoryChange.passwordMismatch"));
      return;
    }

    setErreur(null);
    setEnCours(true);
    try {
      await api("/api/auth/mot-de-passe", {
        method: "POST",
        body: JSON.stringify({ motDePasseActuel, nouveauMotDePasse }),
      });
      // Toast Premium (transitoire) : cet écran disparaît dès que
      // `rafraichirIdentite()` confirme le nouvel état — pas de message
      // persistant nécessaire ici, contrairement aux pages de récupération.
      toast({ variante: "succes", message: t("auth.mandatoryChange.success") });
      await rafraichirIdentite();
    } catch (err) {
      setErreur(err instanceof ApiError ? err.message : t("auth.mandatoryChange.genericError"));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <AuthShell>
      <div className="overflow-hidden rounded-2xl border border-beige/60 bg-card shadow-xl dark:border-border">
        <div aria-hidden className="h-1 bg-gradient-to-r from-or via-terracotta to-or" />
        <div className="px-7 py-8">
          <h2 className="font-serif text-2xl font-bold text-marine dark:text-creme">{t("auth.mandatoryChange.title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("auth.mandatoryChange.subtitle")}</p>

          <form onSubmit={onSubmit} className="mt-7 space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="mdp-temporaire-actuel">{t("auth.mandatoryChange.currentPasswordLabel")}</Label>
              <PasswordField
                id="mdp-temporaire-actuel"
                autoComplete="current-password"
                value={motDePasseActuel}
                onChange={(e) => {
                  setMotDePasseActuel(e.target.value);
                  setErreur(null);
                }}
                required
                aria-describedby={erreur ? "mdp-temporaire-erreur" : undefined}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mdp-temporaire-nouveau">{t("auth.mandatoryChange.newPasswordLabel")}</Label>
              <PasswordField
                id="mdp-temporaire-nouveau"
                autoComplete="new-password"
                value={nouveauMotDePasse}
                onChange={(e) => {
                  setNouveauMotDePasse(e.target.value);
                  setErreur(null);
                }}
                required
                afficherRobustesse
                aria-describedby={erreur ? "mdp-temporaire-erreur" : undefined}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mdp-temporaire-confirmation">{t("auth.mandatoryChange.confirmPasswordLabel")}</Label>
              <PasswordField
                id="mdp-temporaire-confirmation"
                autoComplete="new-password"
                value={confirmation}
                onChange={(e) => {
                  setConfirmation(e.target.value);
                  setErreur(null);
                }}
                required
                aria-describedby={erreur ? "mdp-temporaire-erreur" : undefined}
              />
            </div>

            {erreur && (
              <p id="mdp-temporaire-erreur" role="alert" className="text-sm font-medium text-terracotta">
                {erreur}
              </p>
            )}

            <Button type="submit" variant="cta" size="lg" loading={enCours} className="w-full text-base">
              {t("auth.mandatoryChange.submit")}
            </Button>
          </form>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={logout}
            className="mt-6 flex min-h-11 w-full items-center justify-center gap-2 text-muted-foreground"
          >
            <LogOut aria-hidden className="h-4 w-4" />
            {t("nav.logout")}
          </Button>
        </div>
      </div>
    </AuthShell>
  );
}
