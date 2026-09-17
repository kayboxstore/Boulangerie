import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Mail, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StatutEmailPro, TravailleurDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useFeedback } from "@/components/FeedbackProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const BADGE_STATUT_EMAIL_PRO: Record<StatutEmailPro, string> = {
  AUCUNE: "bg-secondary text-muted-foreground border-transparent",
  EN_ATTENTE_VERIFICATION: "bg-beige/60 text-marine dark:bg-beige/20 dark:text-creme border-transparent",
  ACTIF: "bg-or/15 text-terracotta dark:text-or border-transparent",
  ECHEC: "bg-terracotta text-creme border-transparent",
};

// Re-vérification périodique (bouton "Vérifier le statut" en complément) : la
// vérification dépend du clic de l'employé sur le lien reçu, hors du
// contrôle de l'app — un intervalle modéré évite de solliciter l'API pour
// rien pendant que l'écran reste ouvert sans que rien n'ait changé.
const INTERVALLE_VERIF_EMAIL_PRO_MS = 20_000;

interface PanneauEmailProProps {
  travailleurId: string;
  emailDestination: string | null;
  emailProAdresse: string | null;
  emailProStatut: StatutEmailPro;
  emailProErreur: string | null;
  /** Préfixe des routes avant `/:id/email-pro` — `/api/travailleurs` (fiche
   *  normale, authentifié) ou `/api/premier-lancement/travailleur` (assistant
   *  de premier lancement, public). Même mécanisme des deux côtés
   *  (services/emailPro.ts) : ce composant n'est écrit qu'une fois. */
  basePath: string;
  /** Reçoit la fiche mise à jour après une action réussie (création ou vérification) —
   *  le parent décide quoi en faire (invalider un cache, ou la garder telle quelle
   *  en état local, cas de l'Assistant de premier lancement qui n'a pas de cache). */
  onChange: (travailleur: TravailleurDTO) => void;
  /** En-têtes HTTP supplémentaires à joindre aux deux appels ci-dessous —
   *  utilisé uniquement par l'Assistant de premier lancement (P1-A) pour
   *  transmettre le secret de bootstrap ; absent (donc sans effet) sur la
   *  fiche Travailleur normale, déjà authentifiée par jeton. */
  enTetesSupplementaires?: HeadersInit;
}

/** Panneau adresse email professionnelle (section 3.18) — utilisé sur la fiche
 *  Travailleur ET dans l'Assistant de premier lancement (3.7). */
export function PanneauEmailPro({
  travailleurId,
  emailDestination,
  emailProAdresse,
  emailProStatut,
  emailProErreur,
  basePath,
  onChange,
  enTetesSupplementaires,
}: PanneauEmailProProps) {
  const { t } = useTranslation();
  const { toastErreur } = useFeedback();
  const [emailDestinationSaisie, setEmailDestinationSaisie] = useState(emailDestination ?? "");

  const creerEmailPro = useMutation({
    mutationFn: () =>
      api<{ travailleur: TravailleurDTO }>(`${basePath}/${travailleurId}/email-pro`, {
        method: "POST",
        body: JSON.stringify({ emailDestination: emailDestinationSaisie.trim() }),
        headers: enTetesSupplementaires,
      }),
    onSuccess: (r) => onChange(r.travailleur),
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("travailleurs.emailProError")),
  });

  const verifierEmailPro = useMutation({
    mutationFn: () =>
      api<{ travailleur: TravailleurDTO }>(`${basePath}/${travailleurId}/email-pro/verifier`, {
        method: "POST",
        headers: enTetesSupplementaires,
      }),
    onSuccess: (r) => onChange(r.travailleur),
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("travailleurs.emailProError")),
  });

  // Actualisation automatique tant que la vérification est en attente — pas
  // besoin de cliquer "Vérifier le statut" à répétition (la vérification
  // dépend du clic de l'employé, asynchrone et hors du contrôle de l'app).
  useEffect(() => {
    if (emailProStatut !== "EN_ATTENTE_VERIFICATION") return;
    const id = setInterval(() => verifierEmailPro.mutate(), INTERVALLE_VERIF_EMAIL_PRO_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travailleurId, emailProStatut]);

  return (
    <div className="space-y-2.5 rounded-lg border p-3">
      <div>
        <p className="text-sm font-medium text-marine dark:text-creme">{t("travailleurs.emailProTitle")}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("travailleurs.emailProDesc")}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`email-destination-${travailleurId}`}>{t("travailleurs.emailProDestinationLabel")}</Label>
        <Input
          id={`email-destination-${travailleurId}`}
          type="email"
          value={emailDestinationSaisie}
          onChange={(e) => setEmailDestinationSaisie(e.target.value)}
          placeholder="employe@gmail.com"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => creerEmailPro.mutate()}
          disabled={creerEmailPro.isPending || !emailDestinationSaisie.trim()}
        >
          <Mail className="h-3.5 w-3.5" />
          {t("travailleurs.emailProCreateButton")}
        </Button>
        {emailProStatut === "EN_ATTENTE_VERIFICATION" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => verifierEmailPro.mutate()}
            disabled={verifierEmailPro.isPending}
          >
            <RefreshCw className={verifierEmailPro.isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            {t("travailleurs.emailProCheckButton")}
          </Button>
        )}
      </div>
      {emailProStatut !== "AUCUNE" && (
        <div className="space-y-1.5 text-sm">
          {emailProAdresse && (
            <p>
              <span className="text-muted-foreground">{t("travailleurs.emailProAddressLabel")} : </span>
              <span className="font-medium">{emailProAdresse}</span>
            </p>
          )}
          <Badge className={cn(BADGE_STATUT_EMAIL_PRO[emailProStatut])}>{t(`emailProStatut.${emailProStatut}`)}</Badge>
          {emailProStatut === "EN_ATTENTE_VERIFICATION" && (
            <p className="text-xs text-muted-foreground">{t("travailleurs.emailProPendingHelp")}</p>
          )}
          {emailProStatut === "ECHEC" && emailProErreur && (
            <p role="alert" className="rounded-md bg-terracotta/10 px-2.5 py-1.5 text-xs font-medium text-terracotta">
              {emailProErreur}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
