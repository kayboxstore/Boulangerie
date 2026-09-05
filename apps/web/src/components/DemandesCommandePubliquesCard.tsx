import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Globe, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type DemandeCommandePubliqueDTO, type StrategieDoublon } from "@lomoto/shared";
import { api, ApiError } from "@/lib/api";
import { useCleIdempotence } from "@/lib/idempotence";
import { useFeedback } from "@/components/FeedbackProvider";
import { formaterDateFr } from "@/components/ui/dateHeureFr";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { AutoTextarea } from "@/components/ui/auto-textarea";
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

interface CorpsConflit {
  conflit?: boolean;
  erreur?: string;
}

/** Statut → variante de badge + libellé, pour l'historique. */
const BADGE_STATUT: Record<"CONFIRMEE" | "REJETEE", { variant: "gold" | "destructive" }> = {
  CONFIRMEE: { variant: "gold" },
  REJETEE: { variant: "destructive" },
};

/**
 * File d'attente des demandes de commande publiques (V2, canal site vitrine) —
 * module Commandes. Consomme l'API existante (`/api/demandes-commande-
 * publiques`, déjà testée) sans y toucher ; ce composant ne fait QUE
 * l'interface. Confirmer délègue au même cœur transactionnel que la création
 * manuelle (`executerCreationOuMiseAJourCommande` côté serveur) — un doublon
 * (client déjà commandé aujourd'hui) renvoie donc le même 409 { conflit: true }
 * que le flux manuel, traité ici avec le même choix Modifier/Remplacer
 * (mêmes clés i18n `commandes.strategy.*`), pas un mécanisme réinventé.
 */
export function DemandesCommandePubliquesCard({ editable }: { editable: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toastErreur } = useFeedback();
  const [historiqueOuvert, setHistoriqueOuvert] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["demandes-commande-publiques"],
    queryFn: () => api<{ demandes: DemandeCommandePubliqueDTO[] }>("/api/demandes-commande-publiques"),
  });

  const demandes = data?.demandes ?? [];
  const enAttente = demandes.filter((d) => d.statut === "EN_ATTENTE");
  const historique = demandes.filter((d) => d.statut !== "EN_ATTENTE");

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ["demandes-commande-publiques"] });
    queryClient.invalidateQueries({ queryKey: ["commandes"] });
    queryClient.invalidateQueries({ queryKey: ["commandes-resume-jour"] });
    queryClient.invalidateQueries({ queryKey: ["clients"] });
    queryClient.invalidateQueries({ queryKey: ["commissions"] });
  };

  // --- Confirmer (+ conflit Modifier/Remplacer, même 409 que la création manuelle) ---
  const [demandeEnConflit, setDemandeEnConflit] = useState<DemandeCommandePubliqueDTO | null>(null);
  const [messageConflit, setMessageConflit] = useState<string | null>(null);

  const cleIdempotenceConfirmer = useCleIdempotence();
  const confirmer = useMutation({
    mutationFn: ({ demande, strategie }: { demande: DemandeCommandePubliqueDTO; strategie?: StrategieDoublon }) => {
      const corps = strategie ? { strategie } : {};
      const empreinte = JSON.stringify({ demandeId: demande.id, ...corps });
      return api<{ commandeId: string }>(`/api/demandes-commande-publiques/${demande.id}/confirmer`, {
        method: "POST",
        headers: { "Idempotency-Key": cleIdempotenceConfirmer(empreinte) },
        body: JSON.stringify(corps),
      });
    },
    onSuccess: () => {
      setDemandeEnConflit(null);
      rafraichir();
    },
    onError: (e, variables) => {
      if (e instanceof ApiError && e.status === 409) {
        const corps = e.corps as CorpsConflit | undefined;
        if (corps?.conflit) {
          setDemandeEnConflit(variables.demande);
          setMessageConflit(corps.erreur ?? null);
          return;
        }
      }
      toastErreur(e instanceof Error ? e.message : t("demandesPubliques.confirmError"));
    },
  });

  // --- Rejeter (motif obligatoire) ---
  const [demandeARejeter, setDemandeARejeter] = useState<DemandeCommandePubliqueDTO | null>(null);
  const [motifRejet, setMotifRejet] = useState("");
  const [erreurRejet, setErreurRejet] = useState<string | null>(null);

  const rejeter = useMutation({
    mutationFn: () =>
      api(`/api/demandes-commande-publiques/${demandeARejeter!.id}/rejeter`, {
        method: "POST",
        body: JSON.stringify({ motif: motifRejet.trim() }),
      }),
    onSuccess: () => {
      setDemandeARejeter(null);
      rafraichir();
    },
    onError: (e) => setErreurRejet(e instanceof Error ? e.message : t("demandesPubliques.rejectError")),
  });

  function ouvrirRejet(d: DemandeCommandePubliqueDTO) {
    setDemandeARejeter(d);
    setMotifRejet("");
    setErreurRejet(null);
  }

  function soumettreRejet(e: FormEvent) {
    e.preventDefault();
    setErreurRejet(null);
    if (!motifRejet.trim()) return setErreurRejet(t("demandesPubliques.motifRequired"));
    rejeter.mutate();
  }

  const enCours = confirmer.isPending || rejeter.isPending;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-or" />
            {t("demandesPubliques.title")}
            {enAttente.length > 0 && <Badge variant="destructive">{enAttente.length}</Badge>}
          </CardTitle>
          <CardDescription>{t("demandesPubliques.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading && <p className="py-6 text-center text-muted-foreground">{t("common.loading")}</p>}
          {error && (
            <p className="py-6 text-center font-medium text-terracotta">
              {error instanceof Error ? error.message : t("demandesPubliques.loadError")}
            </p>
          )}

          {data && (
            <div className="space-y-2">
              {enAttente.length === 0 && (
                <p className="py-6 text-center text-muted-foreground">{t("demandesPubliques.empty")}</p>
              )}
              {enAttente.map((d) => (
                <CarteLigne key={d.id}>
                  <CarteLigneTitre>
                    <span>{d.client.nom}</span>
                    <Badge variant="secondary">{d.client.typeClient}</Badge>
                  </CarteLigneTitre>
                  <CarteLigneChamp label={t("demandesPubliques.colBacs")} value={d.totalBacs} />
                  <CarteLigneChamp
                    label={t("demandesPubliques.colDetail")}
                    value={
                      <span className="italic">
                        {d.lignes.map((l) => `${l.quantite} ${l.produitNom}`).join(", ")}
                      </span>
                    }
                  />
                  <CarteLigneChamp
                    label={t("demandesPubliques.colWantedDate")}
                    value={formaterDateFr(d.dateSouhaitee)}
                  />
                  {d.note && (
                    <CarteLigneChamp
                      label={t("demandesPubliques.colNote")}
                      value={<span className="italic">{d.note}</span>}
                    />
                  )}
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
                        {t("demandesPubliques.reject")}
                      </Button>
                      <Button
                        variant="cta"
                        size="sm"
                        onClick={() => confirmer.mutate({ demande: d })}
                        disabled={enCours}
                        className="gap-1"
                      >
                        <Check className="h-3.5 w-3.5" />
                        {t("demandesPubliques.confirm")}
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
                {t("demandesPubliques.history", { count: historique.length })}
                <ChevronDown className={`h-4 w-4 transition-transform ${historiqueOuvert ? "rotate-180" : ""}`} />
              </button>
              {historiqueOuvert && (
                <div className="mt-2 space-y-2">
                  {historique.map((d) => (
                    <CarteLigne key={d.id} className="opacity-80">
                      <CarteLigneTitre>
                        <span>{d.client.nom}</span>
                        <Badge variant={BADGE_STATUT[d.statut as "CONFIRMEE" | "REJETEE"].variant}>
                          {t(`demandesPubliques.status.${d.statut}`)}
                        </Badge>
                      </CarteLigneTitre>
                      <CarteLigneChamp label={t("demandesPubliques.colBacs")} value={d.totalBacs} />
                      <CarteLigneChamp
                        label={t("demandesPubliques.colDetail")}
                        value={
                          <span className="italic">
                            {d.lignes.map((l) => `${l.quantite} ${l.produitNom}`).join(", ")}
                          </span>
                        }
                      />
                      {d.statut === "REJETEE" && d.motifRejet && (
                        <CarteLigneChamp
                          label={t("demandesPubliques.colRejectReason")}
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

      {/* Conflit (client déjà commandé aujourd'hui) : Modifier ou Remplacer —
          même choix, mêmes libellés que le doublon détecté à la création manuelle. */}
      <Dialog open={!!demandeEnConflit} onOpenChange={(o) => !o && setDemandeEnConflit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-terracotta dark:text-or" />
              {t("commandes.duplicateTitle")}
            </DialogTitle>
            <DialogDescription>{messageConflit}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {(["MODIFIER", "REMPLACER"] as StrategieDoublon[]).map((s) => (
              <button
                key={s}
                type="button"
                disabled={confirmer.isPending}
                onClick={() => demandeEnConflit && confirmer.mutate({ demande: demandeEnConflit, strategie: s })}
                className="w-full rounded-lg border border-input px-3 py-2.5 text-left transition-colors hover:border-or hover:bg-or/10 disabled:opacity-50"
              >
                <p className="font-semibold text-marine dark:text-creme">{t(`commandes.strategy.${s}`)}</p>
                <p className="text-xs text-muted-foreground">{t(`commandes.strategyHelp.${s}`)}</p>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDemandeEnConflit(null)}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rejet : motif obligatoire avant soumission */}
      <Dialog open={!!demandeARejeter} onOpenChange={(o) => !o && setDemandeARejeter(null)}>
        <DialogContent>
          <form onSubmit={soumettreRejet} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("demandesPubliques.rejectTitle", { nom: demandeARejeter?.client.nom })}</DialogTitle>
              <DialogDescription>{t("demandesPubliques.rejectDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="demande-motif-rejet">{t("demandesPubliques.motifLabel")}</Label>
              <AutoTextarea
                id="demande-motif-rejet"
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
                {t("demandesPubliques.rejectSubmit")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
