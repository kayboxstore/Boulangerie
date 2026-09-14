import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { LicenceActiverReponseDTO, TravailleurDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/FeedbackProvider";
import { PanneauEmailPro } from "@/components/PanneauEmailPro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const EN_TETE_SECRET = "X-Secret-Premier-Lancement";

/**
 * Assistant de premier lancement (section 3.7, corrigé P1-A le 28/08/2026)
 * — remplace l'écran de connexion quand la base ne contient aucun compte
 * Utilisateur. Trois étapes : fiche Travailleur du futur Admin Principal →
 * email pro (composant partagé avec la fiche Travailleur normale,
 * PanneauEmailPro) → mot de passe puis création automatique du compte. Rien
 * n'est accessible avant la fin.
 *
 * Un secret de bootstrap (généré hors dépôt, voir
 * `scripts/generer-secret-premier-lancement.ts` côté serveur) est désormais
 * requis dès la première étape — sans lui, le serveur refuse tout (401),
 * même si la base est vide. Sans ce secret, n'importe quel visiteur
 * découvrant l'écran avant l'administrateur légitime pouvait auparavant
 * devenir Administrateur Principal.
 */
export function PremierLancementPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const { toastErreur } = useFeedback();

  const [travailleur, setTravailleur] = useState<TravailleurDTO | null>(null);

  // --- Secret de bootstrap, requis dès l'étape fiche Travailleur ----------
  const [secret, setSecret] = useState("");
  const enTetesSecret = { [EN_TETE_SECRET]: secret };

  // --- Nouvelle étape 1 : licence + identité de l'établissement -----------
  // POST /api/licence/activer est public (voir routes/licence.ts côté API) :
  // pas besoin du secret de premier lancement ici, contrairement aux étapes
  // suivantes. Ne bloque jamais la suite du parcours (voir erreurActivation
  // ci-dessous) — une instance sans licence valide reste utilisable pendant
  // sa période d'essai.
  const [etapeLicenceTerminee, setEtapeLicenceTerminee] = useState(false);
  const [cleLicence, setCleLicence] = useState("");
  const [nomEtablissement, setNomEtablissement] = useState("");
  const [nomEtablissementVerrouille, setNomEtablissementVerrouille] = useState(false);
  const [messageLicence, setMessageLicence] = useState<{ texte: string; succes: boolean } | null>(null);

  const verifierLicence = useMutation({
    mutationFn: () =>
      api<LicenceActiverReponseDTO>("/api/licence/activer", {
        method: "POST",
        body: JSON.stringify({ cleLicence: cleLicence.trim() }),
      }),
    onSuccess: (r) => {
      if (r.erreurActivation) {
        setMessageLicence({ texte: r.erreurActivation, succes: false });
        return;
      }
      setMessageLicence({ texte: t("premierLancement.licenceValide", { nom: r.nomClient ?? "" }), succes: true });
      if (r.nomClient) {
        setNomEtablissement(r.nomClient);
        setNomEtablissementVerrouille(true);
      }
    },
    onError: (e) =>
      setMessageLicence({
        texte: e instanceof Error ? e.message : t("premierLancement.licenceErreurGenerique"),
        succes: false,
      }),
  });

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
        headers: enTetesSecret,
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
        body: JSON.stringify({ travailleurId: travailleur.id, motDePasse, nomEtablissement: nomEtablissement.trim() }),
        headers: enTetesSecret,
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
          {!etapeLicenceTerminee ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setEtapeLicenceTerminee(true);
              }}
              className="space-y-3"
            >
              <p className="text-sm text-muted-foreground">{t("premierLancement.licenceDesc")}</p>
              <div className="space-y-1.5">
                <Label htmlFor="pl-licence">{t("premierLancement.licenceLabel")}</Label>
                <div className="flex gap-2">
                  <Input
                    id="pl-licence"
                    value={cleLicence}
                    onChange={(e) => setCleLicence(e.target.value)}
                    placeholder={t("licence.champClePlaceholder")}
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => verifierLicence.mutate()}
                    disabled={!cleLicence.trim() || verifierLicence.isPending}
                  >
                    {t("premierLancement.licenceVerifierBouton")}
                  </Button>
                </div>
                {messageLicence && (
                  <p className={`text-sm ${messageLicence.succes ? "text-succes" : "text-terracotta"}`}>
                    {messageLicence.texte}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl-etablissement">{t("premierLancement.etablissementLabel")}</Label>
                <Input
                  id="pl-etablissement"
                  value={nomEtablissement}
                  onChange={(e) => setNomEtablissement(e.target.value)}
                  disabled={nomEtablissementVerrouille}
                  required
                />
                {nomEtablissementVerrouille && (
                  <p className="text-xs text-muted-foreground">{t("premierLancement.etablissementVerrouille")}</p>
                )}
              </div>
              <Button type="submit" variant="cta" className="w-full" disabled={!nomEtablissement.trim()}>
                {t("premierLancement.licenceContinuerBouton")}
              </Button>
            </form>
          ) : !travailleur ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                creerFiche.mutate();
              }}
              className="space-y-3"
            >
              <p className="text-sm text-muted-foreground">{t("premierLancement.step1Desc")}</p>
              <div className="space-y-1.5">
                <Label htmlFor="pl-secret">{t("premierLancement.secretLabel")}</Label>
                <Input
                  id="pl-secret"
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  autoComplete="off"
                  required
                />
              </div>
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
                enTetesSupplementaires={enTetesSecret}
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
