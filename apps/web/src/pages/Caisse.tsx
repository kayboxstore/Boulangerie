import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  HandCoins,
  Info,
  Lock,
  Plus,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  Unlock,
  Wallet,
  Wheat,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  calculerDepenseFarine,
  formatFc,
  type BlocageFarine,
  type RegistreCaisseDTO,
  type ReglementDeclareDTO,
  type RemiseCaisseDTO,
  type SessionCaisseDTO,
} from "@lomoto/shared";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/FeedbackProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CarteLigne, CarteLigneActions, CarteLigneChamp, CarteLigneTitre } from "@/components/ui/carte-ligne";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { ChargementModule } from "@/components/ChargementModule";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const jourISO = (d: Date) => d.toISOString().slice(0, 10);
const formatHeure = (iso: string) => new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" }).format(new Date(iso));

/**
 * Tuile d'un poste du registre. `alerteSiNegatif` : un solde négatif s'affiche
 * en gras et en rouge vif, pour qu'il saute aux yeux (section 3.1).
 */
function Poste({
  libelle,
  montant,
  icone: Icone,
  accent,
  alerteSiNegatif,
}: {
  libelle: string;
  montant: number;
  icone: typeof Wallet;
  accent?: boolean;
  alerteSiNegatif?: boolean;
}) {
  const { t } = useTranslation();
  const enAlerte = !!alerteSiNegatif && montant < 0;
  return (
    <div
      className={
        enAlerte
          ? "rounded-lg border-2 border-rouge-alerte bg-rouge-alerte/10 p-4"
          : accent
            ? "rounded-lg border border-or bg-or/10 p-4"
            : "rounded-lg border bg-card p-4"
      }
    >
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icone className={enAlerte ? "h-3.5 w-3.5 text-rouge-alerte" : "h-3.5 w-3.5 text-or"} />
        {libelle}
      </p>
      <p
        className={
          enAlerte
            ? "mt-1 text-2xl font-extrabold text-rouge-alerte"
            : "mt-1 text-2xl font-bold text-marine dark:text-creme"
        }
      >
        {formatFc(montant)}
      </p>
      {enAlerte && (
        <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-rouge-alerte">
          <TriangleAlert className="h-3.5 w-3.5" />
          {t("caisse.negativeBalance")}
        </p>
      )}
    </div>
  );
}

export function CaissePage() {
  const { peutEcrire, utilisateur } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { confirmer, toastErreur } = useFeedback();
  // Le DG (et tout rôle en lecture) ne voit AUCUN bouton d'action : depuis la
  // refonte 3.1, il n'a plus la moindre exception d'écriture.
  const editable = peutEcrire("CAISSE");

  const [date, setDate] = useState(jourISO(new Date()));
  const { data, isLoading } = useQuery({
    queryKey: ["registre", date],
    queryFn: () => api<{ registre: RegistreCaisseDTO }>(`/api/caisse/registre?date=${date}`),
  });
  const registre = data?.registre;
  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ["registre"] });
    queryClient.invalidateQueries({ queryKey: ["rapport-caisse"] });
  };

  // --- Taux du jour ---------------------------------------------------------
  const [dialogTaux, setDialogTaux] = useState(false);
  const [valeurTaux, setValeurTaux] = useState("");
  const [erreurTaux, setErreurTaux] = useState<string | null>(null);

  const enregistrerTaux = useMutation({
    mutationFn: () =>
      api("/api/caisse/taux", { method: "PUT", body: JSON.stringify({ date, valeur: Number(valeurTaux) }) }),
    onSuccess: () => {
      setDialogTaux(false);
      rafraichir();
    },
    onError: (e) => setErreurTaux(e instanceof Error ? e.message : t("caisse.saveError")),
  });

  // --- Dépenses -------------------------------------------------------------
  const [dialogDepense, setDialogDepense] = useState(false);
  const [motif, setMotif] = useState("");
  const [montant, setMontant] = useState("");
  const [erreurDepense, setErreurDepense] = useState<string | null>(null);

  const ajouterDepense = useMutation({
    mutationFn: () =>
      api("/api/caisse/depenses", {
        method: "POST",
        body: JSON.stringify({ date, motif: motif.trim(), montant: Number(montant) }),
      }),
    onSuccess: () => {
      setDialogDepense(false);
      rafraichir();
    },
    onError: (e) => setErreurDepense(e instanceof Error ? e.message : t("caisse.saveError")),
  });

  const supprimerDepense = useMutation({
    mutationFn: (id: string) => api(`/api/caisse/depenses/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("caisse.deleteError")),
  });

  const basculerFarine = useMutation({
    mutationFn: (active: boolean) =>
      api("/api/caisse/depenses/farine", { method: "PUT", body: JSON.stringify({ date, active }) }),
    onSuccess: rafraichir,
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("caisse.saveError")),
  });

  // --- f) Session de caisse, remise contradictoire, clôture (Lot 6) ---------
  const estAdminPrincipal = !!utilisateur?.estAdminPrincipal;
  const { data: sessionData } = useQuery({
    queryKey: ["session-caisse", date],
    queryFn: async () => {
      try {
        return await api<{ session: SessionCaisseDTO }>(`/api/caisse/sessions/${date}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
  const session = sessionData?.session ?? null;
  // Une fois la session FERMEE, plus aucune écriture n'est permise sur le
  // registre de cette date (garde miroir de celle du serveur, section 3.1).
  const editableRegistre = editable && session?.statut !== "FERMEE";

  const { data: remisesData } = useQuery({
    queryKey: ["remises-caisse", session?.id],
    queryFn: () => api<{ remises: RemiseCaisseDTO[] }>(`/api/caisse/sessions/${session!.id}/remises`),
    enabled: !!session,
  });
  const remises = remisesData?.remises ?? [];

  const { data: declaresData } = useQuery({
    queryKey: ["reglements-declares"],
    queryFn: () => api<{ reglements: ReglementDeclareDTO[] }>("/api/caisse/reglements-declares"),
  });
  const declares = declaresData?.reglements ?? [];

  const rafraichirSession = () => {
    queryClient.invalidateQueries({ queryKey: ["session-caisse"] });
    queryClient.invalidateQueries({ queryKey: ["remises-caisse"] });
  };

  const [dialogOuverture, setDialogOuverture] = useState(false);
  const [soldeOuverture, setSoldeOuverture] = useState("");
  const [erreurOuverture, setErreurOuverture] = useState<string | null>(null);

  const ouvrirSession = useMutation({
    mutationFn: () =>
      api("/api/caisse/sessions", { method: "POST", body: JSON.stringify({ date, soldeOuverture: Number(soldeOuverture) }) }),
    onSuccess: () => {
      setDialogOuverture(false);
      rafraichirSession();
    },
    onError: (e) => setErreurOuverture(e instanceof Error ? e.message : t("caisse.saveError")),
  });

  const [dialogCloture, setDialogCloture] = useState(false);
  const [soldeCompte, setSoldeCompte] = useState("");
  const [motifEcart, setMotifEcart] = useState("");
  const [erreurCloture, setErreurCloture] = useState<string | null>(null);

  const theoriquePreview = session && registre ? session.soldeOuverture + registre.solde : 0;
  const ecartPreview = soldeCompte.trim() === "" ? 0 : Number(soldeCompte) - theoriquePreview;

  const cloturerSession = useMutation({
    mutationFn: () =>
      api(`/api/caisse/sessions/${session!.id}/cloturer`, {
        method: "POST",
        body: JSON.stringify({ soldeCompteFermeture: Number(soldeCompte), motif: motifEcart.trim() || undefined }),
      }),
    onSuccess: () => {
      setDialogCloture(false);
      rafraichirSession();
    },
    onError: (e) => setErreurCloture(e instanceof Error ? e.message : t("caisse.saveError")),
  });

  const [dialogCorrection, setDialogCorrection] = useState(false);
  const [soldeCorrige, setSoldeCorrige] = useState("");
  const [motifCorrection, setMotifCorrection] = useState("");
  const [erreurCorrection, setErreurCorrection] = useState<string | null>(null);

  const corrigerSession = useMutation({
    mutationFn: () =>
      api(`/api/caisse/sessions/${session!.id}/corriger`, {
        method: "POST",
        body: JSON.stringify({ soldeCompteFermeture: Number(soldeCorrige), motif: motifCorrection.trim() }),
      }),
    onSuccess: () => {
      setDialogCorrection(false);
      rafraichirSession();
    },
    onError: (e) => setErreurCorrection(e instanceof Error ? e.message : t("caisse.saveError")),
  });

  const [dialogRemise, setDialogRemise] = useState(false);
  const [remiseMontant, setRemiseMontant] = useState("");
  const [remiseParNom, setRemiseParNom] = useState("");
  const [remiseReference, setRemiseReference] = useState("");
  const [remiseObservation, setRemiseObservation] = useState("");
  const [erreurRemise, setErreurRemise] = useState<string | null>(null);

  const ajouterRemise = useMutation({
    mutationFn: () =>
      api(`/api/caisse/sessions/${session!.id}/remises`, {
        method: "POST",
        body: JSON.stringify({
          montant: Number(remiseMontant),
          remisParNom: remiseParNom.trim(),
          reference: remiseReference.trim() || undefined,
          observation: remiseObservation.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      setDialogRemise(false);
      rafraichirSession();
    },
    onError: (e) => setErreurRemise(e instanceof Error ? e.message : t("caisse.saveError")),
  });

  // --- Règlements déclarés en attente de confirmation (P0-07) ---------------
  const [dialogConfirmation, setDialogConfirmation] = useState(false);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [confirmParNom, setConfirmParNom] = useState("");
  const [confirmReference, setConfirmReference] = useState("");
  const [confirmObservation, setConfirmObservation] = useState("");
  const [erreurConfirmation, setErreurConfirmation] = useState<string | null>(null);

  const idsSelectionnes = Object.keys(selection).filter((id) => selection[id]);
  const totalSelectionne = declares.filter((r) => selection[r.id]).reduce((s, r) => s + r.montant, 0);

  const confirmerReglements = useMutation({
    mutationFn: () =>
      api(`/api/caisse/sessions/${session!.id}/confirmer-reglements`, {
        method: "POST",
        body: JSON.stringify({
          paiementCommandeIds: idsSelectionnes,
          remisParNom: confirmParNom.trim(),
          reference: confirmReference.trim() || undefined,
          observation: confirmObservation.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      setDialogConfirmation(false);
      setSelection({});
      queryClient.invalidateQueries({ queryKey: ["reglements-declares"] });
      queryClient.invalidateQueries({ queryKey: ["commandes"] });
      rafraichirSession();
      rafraichir();
    },
    onError: (e) => setErreurConfirmation(e instanceof Error ? e.message : t("caisse.saveError")),
  });

  if (isLoading || !registre) return <ChargementModule />;

  const blocage: BlocageFarine | null = registre.farine.blocage;
  const caseFarineDesactivee = !editableRegistre || (!registre.farine.active && blocage !== null);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("caisse.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("caisse.subtitle")}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="date-registre">{t("common.date")}</Label>
          <Input id="date-registre" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      {/* Session de caisse (section 3.1, Lot 6) */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              {session?.statut === "FERMEE" ? (
                <Lock className="h-4 w-4 text-terracotta dark:text-or" />
              ) : (
                <Unlock className="h-4 w-4 text-or" />
              )}
              {t("caisse.sessionTitle")}
              {session ? (
                <Badge variant={session.statut === "FERMEE" ? "gold" : "secondary"}>
                  {t(session.statut === "FERMEE" ? "caisse.sessionClosed" : "caisse.sessionOpen")}
                </Badge>
              ) : (
                <Badge variant="outline">{t("caisse.sessionNone")}</Badge>
              )}
            </CardTitle>
            <CardDescription>
              {!session && t("caisse.sessionNoneDesc")}
              {session?.statut === "OUVERTE" &&
                t("caisse.sessionOpenDesc", { nom: session.ouvertePar?.nom ?? "—", montant: formatFc(session.soldeOuverture) })}
              {session?.statut === "FERMEE" &&
                t("caisse.sessionClosedDesc", {
                  nom: session.fermeePar?.nom ?? "—",
                  theorique: formatFc(session.soldeTheoriqueFermeture ?? 0),
                  compte: formatFc(session.soldeCompteFermeture ?? 0),
                })}
            </CardDescription>
            {session?.statut === "FERMEE" && session.ecartFermeture !== 0 && (
              <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-terracotta dark:text-or">
                <TriangleAlert className="h-3.5 w-3.5" />
                {t("caisse.sessionGap", { ecart: formatFc(session.ecartFermeture ?? 0), motif: session.motifEcart ?? "—" })}
              </p>
            )}
            {session?.derniereCorrectionLe && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldAlert className="h-3.5 w-3.5" />
                {t("caisse.sessionCorrected", {
                  nom: session.derniereCorrectionPar?.nom ?? "—",
                  motif: session.motifCorrection ?? "—",
                })}
              </p>
            )}
          </div>
          {editable && (
            <div className="flex flex-wrap gap-2">
              {!session && (
                <Button
                  variant="cta"
                  onClick={() => {
                    setSoldeOuverture("");
                    setErreurOuverture(null);
                    setDialogOuverture(true);
                  }}
                >
                  <Unlock className="h-4 w-4" />
                  {t("caisse.sessionOpenAction")}
                </Button>
              )}
              {session?.statut === "OUVERTE" && (
                <Button
                  variant="cta"
                  onClick={() => {
                    setSoldeCompte("");
                    setMotifEcart("");
                    setErreurCloture(null);
                    setDialogCloture(true);
                  }}
                >
                  <Lock className="h-4 w-4" />
                  {t("caisse.sessionCloseAction")}
                </Button>
              )}
              {session?.statut === "FERMEE" && estAdminPrincipal && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSoldeCorrige(session.soldeCompteFermeture != null ? String(session.soldeCompteFermeture) : "");
                    setMotifCorrection("");
                    setErreurCorrection(null);
                    setDialogCorrection(true);
                  }}
                >
                  <ShieldAlert className="h-4 w-4" />
                  {t("caisse.sessionCorrectAction")}
                </Button>
              )}
            </div>
          )}
        </CardHeader>
      </Card>

      {/* Taux du jour — première tâche de la journée */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-lg">{t("caisse.rateTitle")}</CardTitle>
            <CardDescription>
              {registre.taux
                ? t("caisse.rateSet", { valeur: registre.taux.valeur, nom: registre.taux.definiPar?.nom ?? "—" })
                : t("caisse.rateMissing")}
            </CardDescription>
          </div>
          {editableRegistre && (
            <Button
              variant={registre.taux ? "outline" : "cta"}
              onClick={() => {
                setValeurTaux(registre.taux ? String(registre.taux.valeur) : "");
                setErreurTaux(null);
                setDialogTaux(true);
              }}
            >
              {registre.taux ? t("caisse.rateEdit") : t("caisse.rateDefine")}
            </Button>
          )}
        </CardHeader>
      </Card>

      {/* Les 4 postes du registre */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Poste libelle={t("caisse.entries")} montant={registre.entrees} icone={ArrowUpCircle} />
        <Poste libelle={t("caisse.debtsPaid")} montant={registre.dettesPayees} icone={ArrowUpCircle} />
        <Poste libelle={t("caisse.expenses")} montant={registre.totalDepenses} icone={ArrowDownCircle} />
        <Poste libelle={t("caisse.balance")} montant={registre.solde} icone={Wallet} accent alerteSiNegatif />
      </div>

      <p className="text-xs text-muted-foreground">{t("caisse.formulaHint")}</p>

      {/* Dettes payées — détail */}
      <Card>
        <CardHeader>
          <CardTitle>{t("caisse.debtsPaidTitle")}</CardTitle>
          <CardDescription>{t("caisse.debtsPaidDesc", { count: registre.detailDettesPayees.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("caisse.colTime")}</TableHead>
                <TableHead>{t("caisse.colClient")}</TableHead>
                <TableHead>{t("caisse.colOrder")}</TableHead>
                <TableHead className="text-right">{t("common.total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {registre.detailDettesPayees.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="text-muted-foreground">{formatHeure(d.date)}</TableCell>
                  <TableCell className="font-medium">{d.clientNom}</TableCell>
                  <TableCell className="text-muted-foreground">n°{d.commandeNumero}</TableCell>
                  <TableCell className="text-right font-semibold">{formatFc(d.montant)}</TableCell>
                </TableRow>
              ))}
              {registre.detailDettesPayees.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                    {t("caisse.noDebtPaid")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="space-y-2 md:hidden">
            {registre.detailDettesPayees.map((d) => (
              <CarteLigne key={d.id}>
                <CarteLigneTitre>
                  <span>{d.clientNom}</span>
                  <span className="font-semibold">{formatFc(d.montant)}</span>
                </CarteLigneTitre>
                <CarteLigneChamp label={t("caisse.colTime")} value={formatHeure(d.date)} />
                <CarteLigneChamp label={t("caisse.colOrder")} value={`n°${d.commandeNumero}`} />
              </CarteLigne>
            ))}
            {registre.detailDettesPayees.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("caisse.noDebtPaid")}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dépenses */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>{t("caisse.expensesTitle")}</CardTitle>
            <CardDescription>{t("caisse.expensesDesc")}</CardDescription>
          </div>
          {editableRegistre && (
            <Button
              variant="outline"
              onClick={() => {
                setMotif("");
                setMontant("");
                setErreurDepense(null);
                setDialogDepense(true);
              }}
            >
              <Plus className="h-4 w-4" />
              {t("caisse.addExpense")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Case à cocher farine */}
          <div className="rounded-lg border bg-muted/30 p-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-[var(--or)]"
                checked={registre.farine.active}
                disabled={caseFarineDesactivee || basculerFarine.isPending}
                onChange={(e) => basculerFarine.mutate(e.target.checked)}
              />
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Wheat className="h-4 w-4 text-or" />
                  {t("caisse.flourExpense")}
                </span>
                {blocage && !registre.farine.active ? (
                  <span className="mt-0.5 flex items-start gap-1.5 text-xs text-terracotta dark:text-or">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {t(`caisse.flourBlocked.${blocage}`)}
                  </span>
                ) : (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {t("caisse.flourFormula", {
                      taux: registre.taux?.valeur ?? "—",
                      sacs: registre.sacsUtilisesJour,
                      montant: formatFc(
                        registre.farine.montantEstime ??
                          (registre.taux
                            ? calculerDepenseFarine(registre.taux.valeur, registre.sacsUtilisesJour)
                            : 0),
                      ),
                    })}
                  </span>
                )}
              </span>
            </label>
          </div>

          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("caisse.colReason")}</TableHead>
                <TableHead>{t("caisse.colRecordedBy")}</TableHead>
                <TableHead className="text-right">{t("common.total")}</TableHead>
                {editableRegistre && <TableHead className="text-right">{t("common.actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {registre.depenses.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">
                    {d.motif}
                    {d.origine === "FARINE" && (
                      <Badge variant="secondary" className="ml-2">
                        {t("caisse.autoBadge")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{d.enregistrePar?.nom ?? "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{formatFc(d.montant)}</TableCell>
                  {editableRegistre && (
                    <TableCell className="text-right">
                      {d.origine === "MANUELLE" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-terracotta hover:text-terracotta"
                          onClick={async () => {
                            if (await confirmer({ description: t("caisse.confirmDeleteExpense"), destructive: true }))
                              supprimerDepense.mutate(d.id);
                          }}
                          aria-label={t("caisse.ariaDeleteExpense")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {registre.depenses.length === 0 && (
                <TableRow>
                  <TableCell colSpan={editableRegistre ? 4 : 3} className="py-6 text-center text-muted-foreground">
                    {t("caisse.noExpense")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="space-y-2 md:hidden">
            {registre.depenses.map((d) => (
              <CarteLigne key={d.id}>
                <CarteLigneTitre>
                  <span>
                    {d.motif}
                    {d.origine === "FARINE" && (
                      <Badge variant="secondary" className="ml-2">
                        {t("caisse.autoBadge")}
                      </Badge>
                    )}
                  </span>
                  <span className="font-semibold">{formatFc(d.montant)}</span>
                </CarteLigneTitre>
                <CarteLigneChamp label={t("caisse.colRecordedBy")} value={d.enregistrePar?.nom ?? "—"} />
                {editableRegistre && d.origine === "MANUELLE" && (
                  <CarteLigneActions>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-terracotta hover:text-terracotta"
                      onClick={async () => {
                            if (await confirmer({ description: t("caisse.confirmDeleteExpense"), destructive: true }))
                              supprimerDepense.mutate(d.id);
                          }}
                      aria-label={t("caisse.ariaDeleteExpense")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </CarteLigneActions>
                )}
              </CarteLigne>
            ))}
            {registre.depenses.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("caisse.noExpense")}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Remise contradictoire (section 3.1, point 3) */}
      {session && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <HandCoins className="h-5 w-5 text-or" />
                {t("caisse.remisesTitle")}
              </CardTitle>
              <CardDescription>{t("caisse.remisesDesc")}</CardDescription>
            </div>
            {editable && session.statut === "OUVERTE" && (
              <Button
                variant="outline"
                onClick={() => {
                  setRemiseMontant("");
                  setRemiseParNom("");
                  setRemiseReference("");
                  setRemiseObservation("");
                  setErreurRemise(null);
                  setDialogRemise(true);
                }}
              >
                <Plus className="h-4 w-4" />
                {t("caisse.addRemise")}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <Table className="hidden md:table">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("caisse.colTime")}</TableHead>
                  <TableHead>{t("caisse.remiseColRemettant")}</TableHead>
                  <TableHead>{t("caisse.remiseColRecu")}</TableHead>
                  <TableHead className="text-right">{t("common.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {remises.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground">{formatHeure(r.dateRemise)}</TableCell>
                    <TableCell className="font-medium">{r.remisParNom}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.recuPar?.nom ?? "—"}</TableCell>
                    <TableCell className="text-right font-semibold">{formatFc(r.montant)}</TableCell>
                  </TableRow>
                ))}
                {remises.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                      {t("caisse.noRemise")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            <div className="space-y-2 md:hidden">
              {remises.map((r) => (
                <CarteLigne key={r.id}>
                  <CarteLigneTitre>
                    <span>{r.remisParNom}</span>
                    <span className="font-semibold">{formatFc(r.montant)}</span>
                  </CarteLigneTitre>
                  <CarteLigneChamp label={t("caisse.colTime")} value={formatHeure(r.dateRemise)} />
                  <CarteLigneChamp label={t("caisse.remiseColRecu")} value={r.recuPar?.nom ?? "—"} />
                </CarteLigne>
              ))}
              {remises.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("caisse.noRemise")}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Règlements déclarés en attente de confirmation (P0-07) */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>{t("caisse.declaresTitle")}</CardTitle>
            <CardDescription>{t("caisse.declaresDesc", { count: declares.length })}</CardDescription>
          </div>
          {editable && session?.statut === "OUVERTE" && idsSelectionnes.length > 0 && (
            <Button
              variant="cta"
              onClick={() => {
                setConfirmParNom("");
                setConfirmReference("");
                setConfirmObservation("");
                setErreurConfirmation(null);
                setDialogConfirmation(true);
              }}
            >
              {t("caisse.confirmSelection", { count: idsSelectionnes.length, montant: formatFc(totalSelectionne) })}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {!editable || session?.statut !== "OUVERTE" ? (
            declares.length > 0 && (
              <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 shrink-0" />
                {t("caisse.declaresNeedsSession")}
              </p>
            )
          ) : null}
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                {editable && session?.statut === "OUVERTE" && <TableHead className="w-8" />}
                <TableHead>{t("caisse.colClient")}</TableHead>
                <TableHead>{t("caisse.colOrder")}</TableHead>
                <TableHead>{t("caisse.colRecordedBy")}</TableHead>
                <TableHead className="text-right">{t("common.total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {declares.map((r) => (
                <TableRow key={r.id}>
                  {editable && session?.statut === "OUVERTE" && (
                    <TableCell>
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--or)]"
                        checked={!!selection[r.id]}
                        onChange={(e) => setSelection((prev) => ({ ...prev, [r.id]: e.target.checked }))}
                        aria-label={t("caisse.selectReglement", { numero: r.commandeNumero })}
                      />
                    </TableCell>
                  )}
                  <TableCell className="font-medium">{r.clientNom}</TableCell>
                  <TableCell className="text-muted-foreground">n°{r.commandeNumero}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.enregistrePar?.nom ?? "—"}</TableCell>
                  <TableCell className="text-right font-semibold">{formatFc(r.montant)}</TableCell>
                </TableRow>
              ))}
              {declares.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    {t("caisse.noDeclare")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="space-y-2 md:hidden">
            {declares.map((r) => (
              <CarteLigne key={r.id}>
                <CarteLigneTitre>
                  <span className="flex items-center gap-2">
                    {editable && session?.statut === "OUVERTE" && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[var(--or)]"
                        checked={!!selection[r.id]}
                        onChange={(e) => setSelection((prev) => ({ ...prev, [r.id]: e.target.checked }))}
                        aria-label={t("caisse.selectReglement", { numero: r.commandeNumero })}
                      />
                    )}
                    {r.clientNom}
                  </span>
                  <span className="font-semibold">{formatFc(r.montant)}</span>
                </CarteLigneTitre>
                <CarteLigneChamp label={t("caisse.colOrder")} value={`n°${r.commandeNumero}`} />
                <CarteLigneChamp label={t("caisse.colRecordedBy")} value={r.enregistrePar?.nom ?? "—"} />
              </CarteLigne>
            ))}
            {declares.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("caisse.noDeclare")}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialog taux */}
      <Dialog open={dialogTaux} onOpenChange={setDialogTaux}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enregistrerTaux.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("caisse.rateDialogTitle")}</DialogTitle>
              <DialogDescription>{t("caisse.rateDialogDesc", { date })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="taux">{t("caisse.rateValue")}</Label>
              <Input
                id="taux"
                type="number"
                min={0}
                step="0.001"
                value={valeurTaux}
                onChange={(e) => setValeurTaux(e.target.value)}
                required
                autoFocus
              />
            </div>
            {erreurTaux && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurTaux}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogTaux(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={enregistrerTaux.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog dépense */}
      <Dialog open={dialogDepense} onOpenChange={setDialogDepense}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ajouterDepense.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("caisse.expenseDialogTitle")}</DialogTitle>
              <DialogDescription>{t("caisse.expenseDialogDesc", { date })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="motif">{t("caisse.colReason")}</Label>
                <Input id="motif" value={motif} onChange={(e) => setMotif(e.target.value)} required autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="montant">{t("caisse.amountFc")}</Label>
                <Input
                  id="montant"
                  type="number"
                  min={1}
                  step="1"
                  value={montant}
                  onChange={(e) => setMontant(e.target.value)}
                  required
                />
              </div>
            </div>
            {erreurDepense && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurDepense}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogDepense(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={ajouterDepense.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog ouverture de session */}
      <Dialog open={dialogOuverture} onOpenChange={setDialogOuverture}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ouvrirSession.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("caisse.sessionOpenDialogTitle")}</DialogTitle>
              <DialogDescription>{t("caisse.sessionOpenDialogDesc", { date })}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="solde-ouverture">{t("caisse.openingBalance")}</Label>
              <Input
                id="solde-ouverture"
                type="number"
                min={0}
                step="1"
                value={soldeOuverture}
                onChange={(e) => setSoldeOuverture(e.target.value)}
                required
                autoFocus
              />
            </div>
            {erreurOuverture && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurOuverture}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOuverture(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={ouvrirSession.isPending}>
                {t("caisse.sessionOpenAction")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog clôture de session */}
      <Dialog open={dialogCloture} onOpenChange={setDialogCloture}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              cloturerSession.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("caisse.sessionCloseDialogTitle")}</DialogTitle>
              <DialogDescription>{t("caisse.sessionCloseDialogDesc")}</DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {t("caisse.theoreticalBalance", { montant: formatFc(theoriquePreview) })}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="solde-compte">{t("caisse.countedBalance")}</Label>
              <Input
                id="solde-compte"
                type="number"
                min={0}
                step="1"
                value={soldeCompte}
                onChange={(e) => setSoldeCompte(e.target.value)}
                required
                autoFocus
              />
            </div>
            {soldeCompte.trim() !== "" && ecartPreview !== 0 && (
              <p className="flex items-start gap-2 rounded-md border border-or/50 bg-or/10 px-3 py-2 text-sm text-marine dark:text-creme">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-terracotta dark:text-or" />
                {t("caisse.gapPreview", { ecart: formatFc(ecartPreview) })}
              </p>
            )}
            {soldeCompte.trim() !== "" && ecartPreview !== 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="motif-ecart">{t("caisse.gapReason")}</Label>
                <AutoTextarea id="motif-ecart" value={motifEcart} onChange={(e) => setMotifEcart(e.target.value)} required />
              </div>
            )}
            {erreurCloture && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurCloture}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogCloture(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={cloturerSession.isPending}>
                {t("caisse.sessionCloseAction")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog correction post-clôture (droit spécial Admin Principal) */}
      <Dialog open={dialogCorrection} onOpenChange={setDialogCorrection}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              corrigerSession.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("caisse.sessionCorrectDialogTitle")}</DialogTitle>
              <DialogDescription>{t("caisse.sessionCorrectDialogDesc")}</DialogDescription>
            </DialogHeader>
            <p className="flex items-start gap-2 rounded-md border border-terracotta/50 bg-terracotta/10 px-3 py-2 text-sm text-marine dark:text-creme">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-terracotta" />
              {t("caisse.sessionCorrectWarning")}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="solde-corrige">{t("caisse.countedBalance")}</Label>
              <Input
                id="solde-corrige"
                type="number"
                min={0}
                step="1"
                value={soldeCorrige}
                onChange={(e) => setSoldeCorrige(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="motif-correction">{t("caisse.correctionReason")}</Label>
              <AutoTextarea id="motif-correction" value={motifCorrection} onChange={(e) => setMotifCorrection(e.target.value)} required />
            </div>
            {erreurCorrection && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurCorrection}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogCorrection(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={corrigerSession.isPending}>
                {t("caisse.sessionCorrectAction")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog remise contradictoire */}
      <Dialog open={dialogRemise} onOpenChange={setDialogRemise}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ajouterRemise.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("caisse.remiseDialogTitle")}</DialogTitle>
              <DialogDescription>{t("caisse.remiseDialogDesc")}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="remise-montant">{t("caisse.amountFc")}</Label>
                <Input
                  id="remise-montant"
                  type="number"
                  min={1}
                  step="1"
                  value={remiseMontant}
                  onChange={(e) => setRemiseMontant(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="remise-nom">{t("caisse.remiseColRemettant")}</Label>
                <Input id="remise-nom" value={remiseParNom} onChange={(e) => setRemiseParNom(e.target.value)} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="remise-reference">{t("caisse.remiseReference")}</Label>
              <Input id="remise-reference" value={remiseReference} onChange={(e) => setRemiseReference(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="remise-observation">{t("caisse.remiseObservation")}</Label>
              <AutoTextarea id="remise-observation" value={remiseObservation} onChange={(e) => setRemiseObservation(e.target.value)} />
            </div>
            {erreurRemise && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurRemise}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogRemise(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={ajouterRemise.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog confirmation des règlements sélectionnés */}
      <Dialog open={dialogConfirmation} onOpenChange={setDialogConfirmation}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              confirmerReglements.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("caisse.confirmDialogTitle")}</DialogTitle>
              <DialogDescription>
                {t("caisse.confirmDialogDesc", { count: idsSelectionnes.length, montant: formatFc(totalSelectionne) })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-nom">{t("caisse.remiseColRemettant")}</Label>
              <Input id="confirm-nom" value={confirmParNom} onChange={(e) => setConfirmParNom(e.target.value)} required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-reference">{t("caisse.remiseReference")}</Label>
              <Input id="confirm-reference" value={confirmReference} onChange={(e) => setConfirmReference(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-observation">{t("caisse.remiseObservation")}</Label>
              <AutoTextarea id="confirm-observation" value={confirmObservation} onChange={(e) => setConfirmObservation(e.target.value)} />
            </div>
            {erreurConfirmation && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurConfirmation}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogConfirmation(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={confirmerReglements.isPending}>
                {t("caisse.confirmAction")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
