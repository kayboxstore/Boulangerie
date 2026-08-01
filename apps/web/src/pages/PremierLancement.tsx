import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TravailleurDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/FeedbackProvider";
import { PanneauEmailPro } from "@/components/PanneauEmailPro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const aujourdhui = () => new Date().toISOString().slice(0, 10);

/**
 * Assistant de premier lancement (section 3.7, nouveau) — remplace l'écran de
 * connexion quand la base ne contient aucun compte Utilisateur. Trois étapes :
 * fiche Travailleur du futur Admin Principal → email pro (composant partagé
 * avec la fiche Travailleur normale, PanneauEmailPro) → mot de passe puis
 * création automatique du compte. Rien n'est accessible avant la fin.
 */
export function PremierLancementPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const { toastErreur } = useFeedback();

  const [travailleur, setTravailleur] = useState<TravailleurDTO | null>(null);

  // --- Étape 1 : fiche Travailleur --------------------------------------
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [poste, setPoste] = useState("");
  const [dateEmbauche, setDateEmbauche] = useState(aujourdhui());
  const [erreurFiche, setErreurFiche] = useState<string | null>(null);

  const creerFiche = useMutation({
    mutationFn: () =>
      api<{ travailleur: TravailleurDTO }>("/api/premier-lancement/travailleur", {
        method: "POST",
        body: JSON.stringify({
          nom: nom.trim(),
          telephone: telephone.trim() || undefined,
          poste: poste.trim(),
          dateEmbauche,
        }),
      }),
    onSuccess: (r) => setTravailleur(r.travailleur),
    onError: (e) => setErreurFiche(e instanceof Error ? e.message : t("premierLancement.ficheError")),
  });

  // --- Étape 3 : mot de passe puis création du compte ---------------------
  const [motDePasse, setMotDePasse] = useState("");
  const [motDePasseConfirme, setMotDePasseConfirme] = useState("");
  const [erreurFinal, setErreurFinal] = useState<string | null>(null);

  const finaliser = useMutation({
    mutationFn: () => {
      if (!travailleur) throw new Error(t("premierLancement.ficheError"));
      return api("/api/premier-lancement/finaliser", {
        method: "POST",
        body: JSON.stringify({ travailleurId: travailleur.id, motDePasse }),
      });
    },
    onSuccess: async () => {
      if (!travailleur?.emailProAdresse) return;
      try {
        await login(travailleur.emailProAdresse, motDePasse);
      } catch (e) {
        // Le compte a été créé avec succès (l'appel précédent n'a pas
        // échoué) — seule la connexion automatique a un souci ponctuel.
        toastErreur(e instanceof Error ? e.message : t("premierLancement.loginError"));
      }
    },
    onError: (e) => setErreurFinal(e instanceof Error ? e.message : t("premierLancement.finalizeError")),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-marine p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="font-serif text-2xl text-marine dark:text-creme">{t("premierLancement.title")}</CardTitle>
          <CardDescription>{t("premierLancement.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!travailleur ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                creerFiche.mutate();
              }}
              className="space-y-3"
            >
              <p className="text-sm text-muted-foreground">{t("premierLancement.step1Desc")}</p>
              <div className="space-y-1.5">
                <Label htmlFor="pl-nom">{t("common.name")}</Label>
                <Input id="pl-nom" value={nom} onChange={(e) => setNom(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-poste">{t("travailleurs.post")}</Label>
                <Input
                  id="pl-poste"
                  value={poste}
                  onChange={(e) => setPoste(e.target.value)}
                  placeholder={t("premierLancement.postPlaceholder")}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-tel">{t("travailleurs.phoneOptional")}</Label>
                <Input id="pl-tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-embauche">{t("travailleurs.hireDate")}</Label>
                <Input
                  id="pl-embauche"
                  type="date"
                  value={dateEmbauche}
                  onChange={(e) => setDateEmbauche(e.target.value)}
                  required
                />
              </div>
              {erreurFiche && (
                <p role="alert" className="text-sm font-medium text-terracotta">
                  {erreurFiche}
                </p>
              )}
              <Button type="submit" variant="cta" className="w-full" disabled={creerFiche.isPending}>
                {t("premierLancement.step1Button")}
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("premierLancement.step2Desc", { nom: travailleur.nom })}
              </p>
              <PanneauEmailPro
                travailleurId={travailleur.id}
                emailDestination={travailleur.emailDestination}
                emailProAdresse={travailleur.emailProAdresse}
                emailProStatut={travailleur.emailProStatut}
                emailProErreur={travailleur.emailProErreur}
                basePath="/api/premier-lancement/travailleur"
                onChange={(maj) => setTravailleur(maj)}
              />
              {travailleur.emailProStatut === "ACTIF" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (motDePasse !== motDePasseConfirme) {
                      setErreurFinal(t("premierLancement.passwordMismatch"));
                      return;
                    }
                    setErreurFinal(null);
                    finaliser.mutate();
                  }}
                  className="space-y-3 border-t pt-4"
                >
                  <p className="text-sm font-medium text-marine dark:text-creme">{t("premierLancement.step3Title")}</p>
                  <div className="space-y-1.5">
                    <Label htmlFor="pl-mdp">{t("equipe.initialPassword")}</Label>
                    <Input
                      id="pl-mdp"
                      type="password"
                      value={motDePasse}
                      onChange={(e) => setMotDePasse(e.target.value)}
                      minLength={8}
                      required
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pl-mdp2">{t("premierLancement.passwordConfirmLabel")}</Label>
                    <Input
                      id="pl-mdp2"
                      type="password"
                      value={motDePasseConfirme}
                      onChange={(e) => setMotDePasseConfirme(e.target.value)}
                      minLength={8}
                      required
                      autoComplete="new-password"
                    />
                  </div>
                  {erreurFinal && (
                    <p role="alert" className="text-sm font-medium text-terracotta">
                      {erreurFinal}
                    </p>
                  )}
                  <Button type="submit" variant="cta" className="w-full" disabled={finaliser.isPending}>
                    {t("premierLancement.step3Button")}
                  </Button>
                </form>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
