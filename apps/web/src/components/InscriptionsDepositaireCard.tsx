import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, UserPlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type DemandeInscriptionDepositaireDTO, type ZoneDepositaireDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useFeedback } from "@/components/FeedbackProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { NativeSelect } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CarteLigne, CarteLigneActions, CarteLigneChamp, CarteLigneTitre } from "@/components/ui/carte-ligne";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Statut → variante de badge, pour l'historique (ANNULEE n'est jamais posé par ce flux). */
const BADGE_STATUT: Record<"CONFIRMEE" | "REJETEE", { variant: "gold" | "destructive" }> = {
  CONFIRMEE: { variant: "gold" },
  REJETEE: { variant: "destructive" },
};

function formaterDateHeureFr(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/**
 * File d'attente des inscriptions publiques « Devenir Dépositaire » (site
 * vitrine) — module Commandes, même emplacement/esprit que
 * DemandesCommandePubliquesCard. Consomme l'API existante
 * (`/api/demandes-inscription-depositaire`, déjà testée) sans y toucher ; ce
 * composant ne fait QUE l'interface.
 *
 * Différence clé avec les demandes de commande : confirmer une inscription
 * CRÉE un nouveau Client, et exige une zone de dépôt — le visiteur ne
 * connaît pas le découpage interne, c'est au Chargé des commandes de la
 * choisir à cet instant précis (jamais une valeur par défaut devinée). D'où
 * un dialogue de confirmation avec sélecteur de zone, plutôt qu'un simple
 * bouton comme sur la carte des demandes de commande.
 */
export function InscriptionsDepositaireCard({ editable }: { editable: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toastErreur } = useFeedback();
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["demandes-inscription-depositaire"],
    queryFn: () => api<{ demandes: DemandeInscriptionDepositaireDTO[] }>("/api/demandes-inscription-depositaire"),
  });

  const { data: zonesData } = useQuery({
    queryKey: ["zones-depositaires"],
    queryFn: () => api<{ zones: ZoneDepositaireDTO[] }>("/api/zones-depositaires"),
  });
  const zones = zonesData?.zones ?? [];

  const demandes = data?.demandes ?? [];
  const enAttente = demandes.filter((d) => d.statut === "EN_ATTENTE");
  const historique = demandes.filter((d) => d.statut !== "EN_ATTENTE");

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ["demandes-inscription-depositaire"] });
    queryClient.invalidateQueries({ queryKey: ["clients"] });
  };

  // --- Confirmer : exige le choix d'une zone, donc un dialogue dédié ---
  const [demandeAConfirmer, setDemandeAConfirmer] = useState<DemandeInscriptionDepositaireDTO | null>(null);
  const [zoneChoisie, setZoneChoisie] = useState("");
  const [erreurConfirmation, setErreurConfirmation] = useState<string | null>(null);

  const confirmer = useMutation({
    mutationFn: () =>
      api(`/api/demandes-inscription-depositaire/${demandeAConfirmer!.id}/confirmer`, {
        method: "POST",
        body: JSON.stringify({ zoneDepositaireId: zoneChoisie }),
      }),
    onSuccess: () => {
      setDemandeAConfirmer(null);
      rafraichir();
    },
    onError: (e) =>
      setErreurConfirmation(e instanceof Error ? e.message : t("inscriptionsDepositaire.confirmError")),
  });

  function ouvrirConfirmation(d: DemandeInscriptionDepositaireDTO) {
    setDemandeAConfirmer(d);
    setZoneChoisie("");
    setErreurConfirmation(null);
  }

  function soumettreConfirmation(e: FormEvent) {
    e.preventDefault();
    setErreurConfirmation(null);
    if (!zoneChoisie) return setErreurConfirmation(t("inscriptionsDepositaire.zoneRequired"));
    confirmer.mutate();
  }

  // --- Rejeter (motif obligatoire) ---
  const [demandeARejeter, setDemandeARejeter] = useState<DemandeInscriptionDepositaireDTO | null>(null);
  const [motifRejet, setMotifRejet] = useState("");
  const [erreurRejet, setErreurRejet] = useState<string | null>(null);

  const rejeter = useMutation({
    mutationFn: () =>
      api(`/api/demandes-inscription-depositaire/${demandeARejeter!.id}/rejeter`, {
        method: "POST",
        body: JSON.stringify({ motif: motifRejet.trim() }),
      }),
    onSuccess: () => {
      setDemandeARejeter(null);
      rafraichir();
    },
    onError: (e) => setErreurRejet(e instanceof Error ? e.message : t("inscriptionsDepositaire.rejectError")),
  });

  function ouvrirRejet(d: DemandeInscriptionDepositaireDTO) {
    setDemandeARejeter(d);
    setMotifRejet("");
    setErreurRejet(null);
  }

  function soumettreRejet(e: FormEvent) {
    e.preventDefault();
    setErreurRejet(null);
    if (!motifRejet.trim()) return setErreurRejet(t("inscriptionsDepositaire.motifRequired"));
    rejeter.mutate();
  }

  const enCours = confirmer.isPending || rejeter.isPending;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-or" />
            {t("inscriptionsDepositaire.title")}
            {enAttente.length > 0 && <Badge variant="destructive">{enAttente.length}</Badge>}
          </CardTitle>
          <CardDescription>{t("inscriptionsDepositaire.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && <p className="py-6 text-center text-muted-foreground">{t("common.loading")}</p>}
          {error && (
            <p className="py-6 text-center font-medium text-terracotta">
              {error instanceof Error ? error.message : t("inscriptionsDepositaire.loadError")}
            </p>
          )}

          {data && (
            <div className="space-y-2">
              {enAttente.length === 0 && (
                <p className="py-6 text-center text-muted-foreground">{t("inscriptionsDepositaire.empty")}</p>
              )}
              {enAttente.map((d) => (
                <CarteLigne key={d.id}>
                  <CarteLigneTitre>
                    <span>{d.nom}</span>
                  </CarteLigneTitre>
                  <CarteLigneChamp label={t("inscriptionsDepositaire.colPhone")} value={d.telephone} />
                  <CarteLigneChamp
                    label={t("inscriptionsDepositaire.colAddress")}
                    value={<span className="italic">{d.adresse}</span>}
                  />
                  <CarteLigneChamp
                    label={t("inscriptionsDepositaire.colSubmittedAt")}
                    value={formaterDateHeureFr(d.createdAt)}
                  />
                  {editable && (
                    <CarteLigneActions>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => ouvrirRejet(d)}
                        disabled={enCours}
                        className="gap-1 border-terracotta/40 text-terracotta hover:bg-terracotta/10 hover:text-terracotta"
                      >
                        <X className="h-3.5 w-3.5" />
                        {t("inscriptionsDepositaire.reject")}
                      </Button>
                      <Button
                        variant="cta"
                        size="sm"
                        onClick={() => ouvrirConfirmation(d)}
                        disabled={enCours}
                        className="gap-1"
                      >
                        <Check className="h-3.5 w-3.5" />
                        {t("inscriptionsDepositaire.confirm")}
                      </Button>
                    </CarteLigneActions>
                  )}
                </CarteLigne>
              ))}
            </div>
          )}

          {data && historique.length > 0 && (
            <div className="border-t pt-3">
              <button
                type="button"
                onClick={() => setHistoriqueOuvert((v) => !v)}
                className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-marine dark:hover:text-creme"
              >
                {t("inscriptionsDepositaire.history", { count: historique.length })}
                <ChevronDown className={`h-4 w-4 transition-transform ${historiqueOuvert ? "rotate-180" : ""}`} />
              </button>
              {historiqueOuvert && (
                <div className="mt-2 space-y-2">
                  {historique.map((d) => (
                    <CarteLigne key={d.id} className="opacity-80">
                      <CarteLigneTitre>
                        <span>{d.nom}</span>
                        <Badge variant={BADGE_STATUT[d.statut as "CONFIRMEE" | "REJETEE"].variant}>
                          {t(`inscriptionsDepositaire.status.${d.statut}`)}
                        </Badge>
                      </CarteLigneTitre>
                      <CarteLigneChamp label={t("inscriptionsDepositaire.colPhone")} value={d.telephone} />
                      <CarteLigneChamp
                        label={t("inscriptionsDepositaire.colAddress")}
                        value={<span className="italic">{d.adresse}</span>}
                      />
                      {d.statut === "REJETEE" && d.motifRejet && (
                        <CarteLigneChamp
                          label={t("inscriptionsDepositaire.colRejectReason")}
                          value={<span className="italic">{d.motifRejet}</span>}
                        />
                      )}
                    </CarteLigne>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmer : la zone de dépôt est obligatoire et choisie ici, jamais devinée */}
      <Dialog open={!!demandeAConfirmer} onOpenChange={(o) => !o && setDemandeAConfirmer(null)}>
        <DialogContent>
          <form onSubmit={soumettreConfirmation} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("inscriptionsDepositaire.confirmTitle", { nom: demandeAConfirmer?.nom })}</DialogTitle>
              <DialogDescription>{t("inscriptionsDepositaire.confirmDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="inscription-zone">{t("inscriptionsDepositaire.zoneLabel")}</Label>
              <NativeSelect
                id="inscription-zone"
                value={zoneChoisie}
                onChange={(e) => setZoneChoisie(e.target.value)}
                required
                autoFocus
              >
                <option value="">{t("inscriptionsDepositaire.zonePlaceholder")}</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.nom}
                  </option>
                ))}
              </NativeSelect>
              {zones.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("inscriptionsDepositaire.zoneHelpEmpty")}</p>
              )}
            </div>
            {erreurConfirmation && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurConfirmation}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDemandeAConfirmer(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={confirmer.isPending}>
                {t("inscriptionsDepositaire.confirmSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rejet : motif obligatoire avant soumission */}
      <Dialog open={!!demandeARejeter} onOpenChange={(o) => !o && setDemandeARejeter(null)}>
        <DialogContent>
          <form onSubmit={soumettreRejet} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("inscriptionsDepositaire.rejectTitle", { nom: demandeARejeter?.nom })}</DialogTitle>
              <DialogDescription>{t("inscriptionsDepositaire.rejectDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="inscription-motif-rejet">{t("inscriptionsDepositaire.motifLabel")}</Label>
              <AutoTextarea
                id="inscription-motif-rejet"
                value={motifRejet}
                onChange={(e) => setMotifRejet(e.target.value)}
                maxLength={500}
                required
                autoFocus
              />
            </div>
            {erreurRejet && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurRejet}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDemandeARejeter(null)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={rejeter.isPending}>
                {t("inscriptionsDepositaire.rejectSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
