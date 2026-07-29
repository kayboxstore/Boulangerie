import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, Info, Plus, Trash2, TriangleAlert, Wallet, Wheat } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  calculerDepenseFarine,
  formatFc,
  type BlocageFarine,
  type RegistreCaisseDTO,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const { peutEcrire } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
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
    onError: (e) => alert(e instanceof Error ? e.message : t("caisse.deleteError")),
  });

  const basculerFarine = useMutation({
    mutationFn: (active: boolean) =>
      api("/api/caisse/depenses/farine", { method: "PUT", body: JSON.stringify({ date, active }) }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : t("caisse.saveError")),
  });

  if (isLoading || !registre) return <ChargementModule />;

  const blocage: BlocageFarine | null = registre.farine.blocage;
  const caseFarineDesactivee = !editable || (!registre.farine.active && blocage !== null);

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
          {editable && (
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
          <Table>
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
        </CardContent>
      </Card>

      {/* Dépenses */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>{t("caisse.expensesTitle")}</CardTitle>
            <CardDescription>{t("caisse.expensesDesc")}</CardDescription>
          </div>
          {editable && (
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

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("caisse.colReason")}</TableHead>
                <TableHead>{t("caisse.colRecordedBy")}</TableHead>
                <TableHead className="text-right">{t("common.total")}</TableHead>
                {editable && <TableHead className="text-right">{t("common.actions")}</TableHead>}
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
                  {editable && (
                    <TableCell className="text-right">
                      {d.origine === "MANUELLE" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-terracotta hover:text-terracotta"
                          onClick={() => confirm(t("caisse.confirmDeleteExpense")) && supprimerDepense.mutate(d.id)}
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
                  <TableCell colSpan={editable ? 4 : 3} className="py-6 text-center text-muted-foreground">
                    {t("caisse.noExpense")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
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
    </div>
  );
}
