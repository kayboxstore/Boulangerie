import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  STATUT_DEMANDE_LABELS,
  TYPE_ACTION_CRITIQUE_LABELS,
  type DemandeApprobationDTO,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChargementModule } from "@/components/ChargementModule";

function BadgeStatut({ statut }: { statut: DemandeApprobationDTO["statut"] }) {
  const label = STATUT_DEMANDE_LABELS[statut];
  if (statut === "APPROUVEE") return <Badge className="border-transparent bg-or text-marine">{label}</Badge>;
  if (statut === "REJETEE") return <Badge className="border-transparent bg-terracotta text-creme">{label}</Badge>;
  return <Badge variant="secondary">{label}</Badge>;
}

// Approbations (section 3.16) — file d'attente des tâches critiques différées.
// L'Admin Principal décide (approuver/rejeter) ; un Admin secondaire suit l'état
// de ses propres demandes.
export function ApprobationsPage() {
  const { utilisateur } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const estPrincipal = !!utilisateur?.estAdminPrincipal;

  const { data, isLoading } = useQuery({
    queryKey: ["approbations"],
    queryFn: () => api<{ demandes: DemandeApprobationDTO[] }>("/api/approbations"),
    refetchInterval: 20000,
  });

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ["approbations"] });
    // Une décision peut modifier comptes/rôles/qualités/produits : on invalide large.
    queryClient.invalidateQueries({ queryKey: ["equipe"] });
    queryClient.invalidateQueries({ queryKey: ["roles"] });
  };

  const approuver = useMutation({
    mutationFn: (id: string) => api(`/api/approbations/${id}/approuver`, { method: "POST" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : t("approbations.actionError")),
  });
  const rejeter = useMutation({
    mutationFn: (id: string) => api(`/api/approbations/${id}/rejeter`, { method: "POST" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : t("approbations.actionError")),
  });

  if (isLoading) return <ChargementModule />;
  const demandes = data?.demandes ?? [];
  const enAttente = demandes.filter((d) => d.statut === "EN_ATTENTE");
  const traitees = demandes.filter((d) => d.statut !== "EN_ATTENTE");

  const formatDate = (iso: string) => new Date(iso).toLocaleString();

  const carte = (d: DemandeApprobationDTO) => (
    <div key={d.id} className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{TYPE_ACTION_CRITIQUE_LABELS[d.type]}</Badge>
            <BadgeStatut statut={d.statut} />
          </div>
          <p className="font-medium text-marine dark:text-creme">{d.resume}</p>
          <p className="text-xs text-muted-foreground">
            {t("approbations.requestedBy", {
              nom: d.demandePar?.nom ?? t("common.none"),
              date: formatDate(d.dateDemande),
            })}
          </p>
          {d.statut !== "EN_ATTENTE" && d.approuvePar && (
            <p className="text-xs text-muted-foreground">
              {t("approbations.decidedBy", {
                nom: d.approuvePar.nom,
                date: d.dateDecision ? formatDate(d.dateDecision) : "",
              })}
            </p>
          )}
          {d.erreur && (
            <p className="text-xs font-medium text-terracotta">{t("approbations.execError", { erreur: d.erreur })}</p>
          )}
        </div>
        {estPrincipal && d.statut === "EN_ATTENTE" && (
          <div className="flex gap-2">
            <Button
              variant="cta"
              size="sm"
              onClick={() => approuver.mutate(d.id)}
              disabled={approuver.isPending || rejeter.isPending}
            >
              <Check className="h-4 w-4" />
              {t("approbations.approve")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-terracotta hover:text-terracotta"
              onClick={() => confirm(t("approbations.confirmReject")) && rejeter.mutate(d.id)}
              disabled={approuver.isPending || rejeter.isPending}
            >
              <X className="h-4 w-4" />
              {t("approbations.reject")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("approbations.title")}</h1>
        <p className="mt-1 text-muted-foreground">
          {estPrincipal ? t("approbations.subtitlePrincipal") : t("approbations.subtitleSecondary")}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-or" />
            {t("approbations.pending")}
          </CardTitle>
          <CardDescription>{t("approbations.pendingSub", { count: enAttente.length })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {enAttente.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">{t("approbations.emptyPending")}</p>
          ) : (
            enAttente.map(carte)
          )}
        </CardContent>
      </Card>

      {traitees.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("approbations.history")}</CardTitle>
            <CardDescription>{t("approbations.historySub")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">{traitees.map(carte)}</CardContent>
        </Card>
      )}
    </div>
  );
}
