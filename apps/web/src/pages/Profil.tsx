import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Globe, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LANGUE_LABELS, LANGUES, type Langue } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";

export function ProfilPage() {
  const { utilisateur, langueDefautBoutique, changerLangue } = useAuth();
  const { t } = useTranslation();

  const [motDePasseActuel, setMotDePasseActuel] = useState("");
  const [nouveauMotDePasse, setNouveauMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState(false);

  // Sélecteur de langue : "" = suivre la boutique (languePreferee null).
  const [langueMaj, setLangueMaj] = useState(false);
  const changerLangueMut = useMutation({
    mutationFn: (valeur: string) => changerLangue(valeur === "" ? null : (valeur as Langue)),
    onSuccess: () => {
      setLangueMaj(true);
      setTimeout(() => setLangueMaj(false), 2500);
    },
  });

  const changerMotDePasse = useMutation({
    mutationFn: () =>
      api("/api/auth/mot-de-passe", {
        method: "POST",
        body: JSON.stringify({ motDePasseActuel, nouveauMotDePasse }),
      }),
    onSuccess: () => {
      setMotDePasseActuel("");
      setNouveauMotDePasse("");
      setConfirmation("");
      setErreur(null);
      setSucces(true);
    },
    onError: (e) => {
      setSucces(false);
      setErreur(e instanceof Error ? e.message : t("profil.changeImpossible"));
    },
  });

  function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setSucces(false);
    if (nouveauMotDePasse !== confirmation) {
      setErreur(t("profil.passwordMismatch"));
      return;
    }
    setErreur(null);
    changerMotDePasse.mutate();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("profil.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("profil.subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("profil.infos")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">{t("common.name")} : </span>
            <span className="font-medium">{utilisateur?.nom}</span>
          </p>
          <p>
            <span className="text-muted-foreground">{t("common.email")} : </span>
            <span className="font-medium">{utilisateur?.email}</span>
          </p>
          <p className="flex items-center gap-2">
            <span className="text-muted-foreground">{t("common.role")} :</span>
            <Badge variant="gold">{utilisateur?.role.nom}</Badge>
          </p>
          <p className="text-xs text-muted-foreground">{t("profil.managedByAdmin")}</p>
        </CardContent>
      </Card>

      {/* Sélecteur de langue (section 3.9) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-or" />
            {t("profil.language")}
          </CardTitle>
          <CardDescription>{t("profil.languageHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <NativeSelect
            aria-label={t("profil.language")}
            value={utilisateur?.languePreferee ?? ""}
            onChange={(e) => changerLangueMut.mutate(e.target.value)}
            disabled={changerLangueMut.isPending}
            className="max-w-xs"
          >
            <option value="">{t("profil.languageDefault", { langue: LANGUE_LABELS[langueDefautBoutique] })}</option>
            {LANGUES.map((l) => (
              <option key={l} value={l}>
                {LANGUE_LABELS[l]}
              </option>
            ))}
          </NativeSelect>
          {langueMaj && (
            <p className="text-sm font-medium text-terracotta dark:text-or">✓ {t("profil.languageSaved")}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("profil.changePassword")}</CardTitle>
          <CardDescription>{t("profil.changePasswordHelp")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={soumettre} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mdp-actuel">{t("profil.currentPassword")}</Label>
              <Input
                id="mdp-actuel"
                type="password"
                value={motDePasseActuel}
                onChange={(e) => setMotDePasseActuel(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mdp-nouveau">{t("profil.newPassword")}</Label>
                <Input
                  id="mdp-nouveau"
                  type="password"
                  value={nouveauMotDePasse}
                  onChange={(e) => setNouveauMotDePasse(e.target.value)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mdp-confirmation">{t("profil.confirmPassword")}</Label>
                <Input
                  id="mdp-confirmation"
                  type="password"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  minLength={8}
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>
            {erreur && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreur}
              </p>
            )}
            {succes && (
              <p className="rounded-md bg-or/10 px-3 py-2 text-sm font-medium text-terracotta dark:text-or">
                ✓ {t("profil.passwordChanged")}
              </p>
            )}
            <Button type="submit" variant="cta" disabled={changerMotDePasse.isPending}>
              <KeyRound className="h-4 w-4" />
              {t("profil.changePasswordButton")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
