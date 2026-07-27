import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ClipboardList, Factory, Scale, Trash2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  totalDestinationsBacs,
  type EcartsProductionDTO,
  type MotifDonDTO,
  type PlanningProductionDTO,
  type ProduitDTO,
  type ProductionDTO,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const jourISO = (d: Date) => d.toISOString().slice(0, 10);
const demain = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return jourISO(d);
};
const nombre = (v: string) => (v.trim() === "" ? 0 : Number(v));

/** Champ numérique compact, réutilisé par les deux formulaires. */
function ChampNombre({
  id,
  label,
  valeur,
  onChange,
  step,
}: {
  id: string;
  label: string;
  valeur: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min={0} step={step ?? "1"} value={valeur} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function ProductionPage() {
  const { peutEcrire } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editable = peutEcrire("PRODUCTION");

  const { data: produitsData } = useQuery({
    queryKey: ["produits"],
    queryFn: () => api<{ produits: ProduitDTO[] }>("/api/produits"),
  });
  const { data: planningsData } = useQuery({
    queryKey: ["plannings"],
    queryFn: () => api<{ plannings: PlanningProductionDTO[] }>("/api/production/planning"),
  });
  const { data: productionsData } = useQuery({
    queryKey: ["productions"],
    queryFn: () => api<{ productions: ProductionDTO[] }>("/api/production/productions"),
  });
  const { data: motifsData } = useQuery({
    queryKey: ["motifs-don"],
    queryFn: () => api<{ motifs: MotifDonDTO[] }>("/api/production/motifs-don"),
  });

  const produits = useMemo(() => (produitsData?.produits ?? []).filter((p) => p.actif), [produitsData]);
  const plannings = planningsData?.plannings ?? [];
  const productions = productionsData?.productions ?? [];
  const motifs = motifsData?.motifs ?? [];

  // --- a) Planning ----------------------------------------------------------
  const [dialogPlanning, setDialogPlanning] = useState(false);
  const [pDate, setPDate] = useState(demain());
  const [pBacs, setPBacs] = useState("");
  const [pLignes, setPLignes] = useState<Record<string, string>>({});
  const [pSacs, setPSacs] = useState("");
  const [pLevure, setPLevure] = useState("");
  const [pHuile, setPHuile] = useState("");
  const [pSel, setPSel] = useState("");
  const [pObs, setPObs] = useState("");
  const [erreurPlanning, setErreurPlanning] = useState<string | null>(null);

  function ouvrirPlanning() {
    setPDate(demain());
    setPBacs("");
    setPLignes({});
    setPSacs("");
    setPLevure("");
    setPHuile("");
    setPSel("");
    setPObs("");
    setErreurPlanning(null);
    setDialogPlanning(true);
  }

  const enregistrerPlanning = useMutation({
    mutationFn: () =>
      api("/api/production/planning", {
        method: "POST",
        body: JSON.stringify({
          datePrevue: pDate,
          nombreBacsCommandes: nombre(pBacs),
          lignes: produits
            .filter((p) => nombre(pLignes[p.id] ?? "") > 0)
            .map((p) => ({ produitId: p.id, quantitePrevue: nombre(pLignes[p.id]) })),
          sacsFarinePrevus: nombre(pSacs),
          paquetsLevurePrevus: nombre(pLevure),
          quantiteHuilePrevue: nombre(pHuile),
          kgSelPrevus: nombre(pSel),
          observations: pObs.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      setDialogPlanning(false);
      queryClient.invalidateQueries({ queryKey: ["plannings"] });
      queryClient.invalidateQueries({ queryKey: ["ecarts"] });
    },
    onError: (e) => setErreurPlanning(e instanceof Error ? e.message : t("production.saveError")),
  });

  const supprimerPlanning = useMutation({
    mutationFn: (id: string) => api(`/api/production/planning/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["plannings"] });
      queryClient.invalidateQueries({ queryKey: ["ecarts"] });
    },
    onError: (e) => alert(e instanceof Error ? e.message : t("production.deleteError")),
  });

  // --- b + c) Production ----------------------------------------------------
  const [dialogProduction, setDialogProduction] = useState(false);
  const [bacsProduits, setBacsProduits] = useState("");
  const [bacsDepositaires, setBacsDepositaires] = useState("");
  const [bacsMamans, setBacsMamans] = useState("");
  const [bacsVC, setBacsVC] = useState("");
  const [bacsRestants, setBacsRestants] = useState("");
  const [bacsFoutus, setBacsFoutus] = useState("");
  const [dons, setDons] = useState<Record<string, string>>({});
  const [farineAbimee, setFarineAbimee] = useState("");
  const [sacsUtilises, setSacsUtilises] = useState("");
  const [levureUtilisee, setLevureUtilisee] = useState("");
  const [selUtilise, setSelUtilise] = useState("");
  const [huileUtilisee, setHuileUtilisee] = useState("");
  const [prodObs, setProdObs] = useState("");
  const [erreurProduction, setErreurProduction] = useState<string | null>(null);
  const [avertissements, setAvertissements] = useState<string[]>([]);

  function ouvrirProduction() {
    setBacsProduits("");
    setBacsDepositaires("");
    setBacsMamans("");
    setBacsVC("");
    setBacsRestants("");
    setBacsFoutus("");
    setDons({});
    setFarineAbimee("");
    setSacsUtilises("");
    setLevureUtilisee("");
    setSelUtilise("");
    setHuileUtilisee("");
    setProdObs("");
    setErreurProduction(null);
    setDialogProduction(true);
  }

  // Réconciliation en direct — même calcul que le serveur (fonction partagée).
  const reconciliation = useMemo(() => {
    const total = totalDestinationsBacs({
      bacsLivresDepositaires: nombre(bacsDepositaires),
      bacsLivresMamans: nombre(bacsMamans),
      bacsVendusVC: nombre(bacsVC),
      bacsRestants: nombre(bacsRestants),
      bacsFoutus: nombre(bacsFoutus),
      dons: motifs.map((m) => ({ nombreBacs: nombre(dons[m.id] ?? "") })),
    });
    return { total, ecart: total - nombre(bacsProduits) };
  }, [bacsProduits, bacsDepositaires, bacsMamans, bacsVC, bacsRestants, bacsFoutus, dons, motifs]);

  const enregistrerProduction = useMutation({
    mutationFn: () =>
      api<{ production: ProductionDTO; avertissements: string[] }>("/api/production/productions", {
        method: "POST",
        body: JSON.stringify({
          bacsProduits: nombre(bacsProduits),
          bacsLivresDepositaires: nombre(bacsDepositaires),
          bacsLivresMamans: nombre(bacsMamans),
          bacsVendusVC: nombre(bacsVC),
          bacsRestants: nombre(bacsRestants),
          bacsFoutus: nombre(bacsFoutus),
          dons: motifs
            .filter((m) => nombre(dons[m.id] ?? "") > 0)
            .map((m) => ({ motifDonId: m.id, nombreBacs: nombre(dons[m.id]) })),
          kgFarineAbimes: farineAbimee.trim() === "" ? undefined : nombre(farineAbimee),
          sacsUtilises: nombre(sacsUtilises),
          paquetsLevureUtilises: nombre(levureUtilisee),
          kgSelUtilises: nombre(selUtilise),
          quantiteHuileUtilisee: nombre(huileUtilisee),
          observations: prodObs.trim() || undefined,
        }),
      }),
    onSuccess: (r) => {
      setDialogProduction(false);
      setAvertissements(r.avertissements ?? []);
      queryClient.invalidateQueries({ queryKey: ["productions"] });
      queryClient.invalidateQueries({ queryKey: ["matieres"] });
      queryClient.invalidateQueries({ queryKey: ["ecarts"] });
    },
    onError: (e) => setErreurProduction(e instanceof Error ? e.message : t("production.saveError")),
  });

  // --- Écarts ---------------------------------------------------------------
  const [dateEcarts, setDateEcarts] = useState(jourISO(new Date()));
  const { data: ecarts } = useQuery({
    queryKey: ["ecarts", dateEcarts],
    queryFn: () => api<EcartsProductionDTO>(`/api/production/ecarts?date=${dateEcarts}`),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("production.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("production.subtitle")}</p>
        </div>
        {editable && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={ouvrirPlanning}>
              <CalendarDays className="h-4 w-4" />
              {t("production.plan")}
            </Button>
            <Button variant="cta" onClick={ouvrirProduction}>
              <Factory className="h-4 w-4" />
              {t("production.recordProduction")}
            </Button>
          </div>
        )}
      </div>

      {avertissements.length > 0 && (
        <div role="status" className="space-y-1 rounded-md border border-or/50 bg-or/10 px-4 py-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-marine dark:text-creme">
            <TriangleAlert className="h-4 w-4 text-terracotta dark:text-or" />
            {t("production.savedWithWarnings")}
          </p>
          <ul className="ml-6 list-disc text-muted-foreground">
            {avertissements.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {/* --- Écarts prévu / réalisé --- */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-or" />
              {t("production.gapsTitle")}
            </CardTitle>
            <CardDescription>{t("production.gapsDesc")}</CardDescription>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date-ecarts">{t("common.date")}</Label>
            <Input id="date-ecarts" type="date" value={dateEcarts} onChange={(e) => setDateEcarts(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          {!ecarts?.planning && ecarts?.nbProductions === 0 ? (
            <p className="py-6 text-center text-muted-foreground">{t("production.gapsEmpty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("production.gapsMetric")}</TableHead>
                  <TableHead className="text-right">{t("production.planned")}</TableHead>
                  <TableHead className="text-right">{t("production.actual")}</TableHead>
                  <TableHead className="text-right">{t("production.gap")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(ecarts?.lignes ?? []).map((l) => (
                  <TableRow key={l.cle}>
                    <TableCell className="font-medium">{t(`production.metric.${l.cle}`)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{l.prevu}</TableCell>
                    <TableCell className="text-right">{l.realise}</TableCell>
                    <TableCell
                      className={
                        l.ecart === 0
                          ? "text-right text-muted-foreground"
                          : "text-right font-semibold text-terracotta dark:text-or"
                      }
                    >
                      {l.ecart > 0 ? `+${l.ecart}` : l.ecart}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* --- a) Plannings --- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-or" />
            {t("production.planningTitle")}
          </CardTitle>
          <CardDescription>{t("production.planningDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead className="text-right">{t("production.colBacsOrdered")}</TableHead>
                <TableHead>{t("production.colDetail")}</TableHead>
                <TableHead>{t("production.colForecast")}</TableHead>
                {editable && <TableHead className="text-right">{t("common.actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {plannings.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap font-medium">{p.datePrevue}</TableCell>
                  <TableCell className="text-right">{p.nombreBacsCommandes}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {p.lignes.length === 0
                      ? "—"
                      : p.lignes.map((l) => `${l.quantitePrevue} × ${l.produitNom}`).join(", ")}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {t("production.forecastSummary", {
                      sacs: p.sacsFarinePrevus,
                      levure: p.paquetsLevurePrevus,
                      huile: p.quantiteHuilePrevue,
                      sel: p.kgSelPrevus,
                    })}
                  </TableCell>
                  {editable && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={() => confirm(t("production.confirmDeletePlanning")) && supprimerPlanning.mutate(p.id)}
                        aria-label={t("production.ariaDeletePlanning")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {plannings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={editable ? 5 : 4} className="py-8 text-center text-muted-foreground">
                    {t("production.nothingPlanned")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* --- b) Productions enregistrées --- */}
      <Card>
        <CardHeader>
          <CardTitle>{t("production.recordedTitle")}</CardTitle>
          <CardDescription>{t("production.recordedDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead className="text-right">{t("production.colProduced")}</TableHead>
                <TableHead>{t("production.colDestinations")}</TableHead>
                <TableHead>{t("production.colConsumed")}</TableHead>
                <TableHead>{t("production.colRecordedBy")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productions.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.numero}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Date(p.date).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {p.bacsProduits}
                    {p.ecartReconciliation !== 0 && (
                      <Badge
                        className="ml-2 border-transparent bg-terracotta text-creme"
                        title={t("production.reconcileTooltip", {
                          total: p.totalDestinations,
                          produits: p.bacsProduits,
                        })}
                      >
                        {p.ecartReconciliation > 0 ? `+${p.ecartReconciliation}` : p.ecartReconciliation}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-72 text-xs text-muted-foreground">
                    {t("production.destinationsSummary", {
                      dep: p.bacsLivresDepositaires,
                      mamans: p.bacsLivresMamans,
                      vc: p.bacsVendusVC,
                      dons: p.totalDonnes,
                      restants: p.bacsRestants,
                      foutus: p.bacsFoutus,
                    })}
                    {p.dons.length > 0 && (
                      <span className="block italic">
                        {p.dons.map((d) => `${d.nombreBacs} ${d.motifNom}`).join(", ")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-56 text-xs text-muted-foreground">
                    {p.consommations.length === 0
                      ? "—"
                      : p.consommations.map((c) => `${c.quantite} ${c.unite} ${c.matiereNom}`).join(", ")}
                  </TableCell>
                  <TableCell className="text-sm">{p.enregistrePar?.nom ?? "—"}</TableCell>
                </TableRow>
              ))}
              {productions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {t("production.noProduction")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* --- Dialog planning --- */}
      <Dialog open={dialogPlanning} onOpenChange={setDialogPlanning}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enregistrerPlanning.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("production.planDialogTitle")}</DialogTitle>
              <DialogDescription>{t("production.planDialogDesc")}</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="p-date">{t("production.forDate")}</Label>
                <Input id="p-date" type="date" value={pDate} onChange={(e) => setPDate(e.target.value)} required />
              </div>
              <ChampNombre id="p-bacs" label={t("production.bacsOrdered")} valeur={pBacs} onChange={setPBacs} />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("production.detailByProduct")}</p>
              <div className="grid grid-cols-2 gap-3">
                {produits.map((p) => (
                  <ChampNombre
                    key={p.id}
                    id={`p-prod-${p.id}`}
                    label={p.nom}
                    valeur={pLignes[p.id] ?? ""}
                    onChange={(v) => setPLignes((prev) => ({ ...prev, [p.id]: v }))}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("production.forecastIngredients")}</p>
              <div className="grid grid-cols-2 gap-3">
                <ChampNombre id="p-sacs" label={t("production.sacksFlour")} valeur={pSacs} onChange={setPSacs} step="0.001" />
                <ChampNombre id="p-levure" label={t("production.packsYeast")} valeur={pLevure} onChange={setPLevure} step="0.001" />
                <ChampNombre id="p-huile" label={t("production.oil")} valeur={pHuile} onChange={setPHuile} step="0.001" />
                <ChampNombre id="p-sel" label={t("production.saltKg")} valeur={pSel} onChange={setPSel} step="0.001" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="p-obs">{t("production.observations")}</Label>
              <Input id="p-obs" value={pObs} onChange={(e) => setPObs(e.target.value)} />
            </div>

            {erreurPlanning && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurPlanning}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogPlanning(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={enregistrerPlanning.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* --- Dialog production --- */}
      <Dialog open={dialogProduction} onOpenChange={setDialogProduction}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enregistrerProduction.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("production.prodDialogTitle")}</DialogTitle>
              <DialogDescription>{t("production.prodDialogDesc")}</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3">
              <ChampNombre id="b-produits" label={t("production.bacsProduced")} valeur={bacsProduits} onChange={setBacsProduits} />
              <ChampNombre id="b-dep" label={t("production.bacsDepositaires")} valeur={bacsDepositaires} onChange={setBacsDepositaires} />
              <ChampNombre id="b-mamans" label={t("production.bacsMamans")} valeur={bacsMamans} onChange={setBacsMamans} />
              <ChampNombre id="b-vc" label={t("production.bacsVC")} valeur={bacsVC} onChange={setBacsVC} />
              <ChampNombre id="b-restants" label={t("production.bacsRemaining")} valeur={bacsRestants} onChange={setBacsRestants} />
              <ChampNombre id="b-foutus" label={t("production.bacsSpoiled")} valeur={bacsFoutus} onChange={setBacsFoutus} />
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("production.bacsGiven")}</p>
              <div className="grid grid-cols-2 gap-3">
                {motifs.map((m) => (
                  <ChampNombre
                    key={m.id}
                    id={`don-${m.id}`}
                    label={m.nom}
                    valeur={dons[m.id] ?? ""}
                    onChange={(v) => setDons((prev) => ({ ...prev, [m.id]: v }))}
                  />
                ))}
              </div>
            </div>

            {/* Réconciliation : avertissement visible, jamais bloquant. */}
            {reconciliation.ecart !== 0 && nombre(bacsProduits) > 0 && (
              <p className="flex items-start gap-2 rounded-md border border-or/50 bg-or/10 px-3 py-2 text-sm text-marine dark:text-creme">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-terracotta dark:text-or" />
                <span>
                  {t("production.reconcileWarning", {
                    total: reconciliation.total,
                    produits: nombre(bacsProduits),
                    ecart: reconciliation.ecart > 0 ? `+${reconciliation.ecart}` : reconciliation.ecart,
                  })}
                </span>
              </p>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("production.usedIngredients")}</p>
              <p className="text-xs text-muted-foreground">{t("production.usedIngredientsHelp")}</p>
              <div className="grid grid-cols-2 gap-3">
                <ChampNombre id="u-sacs" label={t("production.sacksFlour")} valeur={sacsUtilises} onChange={setSacsUtilises} step="0.001" />
                <ChampNombre id="u-levure" label={t("production.packsYeast")} valeur={levureUtilisee} onChange={setLevureUtilisee} step="0.001" />
                <ChampNombre id="u-sel" label={t("production.saltKg")} valeur={selUtilise} onChange={setSelUtilise} step="0.001" />
                <ChampNombre id="u-huile" label={t("production.oil")} valeur={huileUtilisee} onChange={setHuileUtilisee} step="0.001" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <ChampNombre id="u-abimee" label={t("production.flourSpoiled")} valeur={farineAbimee} onChange={setFarineAbimee} step="0.001" />
              <div className="space-y-1.5">
                <Label htmlFor="prod-obs">{t("production.observations")}</Label>
                <Input id="prod-obs" value={prodObs} onChange={(e) => setProdObs(e.target.value)} />
              </div>
            </div>

            {erreurProduction && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurProduction}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogProduction(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={enregistrerProduction.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
