import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LineChart as LineChartIcon, TrendingDown, TrendingUp } from "lucide-react";
import {
  formatFc,
  formatNombre,
  type ComparaisonJourDTO,
  type GranulariteTendance,
  type ProjectionDashboardDTO,
  type TendancesDashboardDTO,
} from "@lomoto/shared";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const OR = "#DA9F4E";
const TERRACOTTA = "#AD5416";
const MARINE = "#0F1923";
const BEIGE = "#CBAF91";
const PALETTE_PRODUITS = [OR, TERRACOTTA, MARINE, BEIGE];

const GRANULARITES: GranulariteTendance[] = ["jour", "semaine", "mois"];
const FENETRE: Record<GranulariteTendance, number> = { jour: 30, semaine: 12, mois: 12 };

function formatPeriodeLabel(iso: string, granularite: GranulariteTendance): string {
  const d = new Date(`${iso}T00:00:00`);
  if (granularite === "mois") return new Intl.DateTimeFormat("fr-FR", { month: "short", year: "2-digit" }).format(d);
  const court = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" }).format(d);
  return granularite === "semaine" ? `S. ${court}` : court;
}

/** Périodes attendues (30 jours / 12 semaines / 12 mois), pour combler à zéro
 * les périodes sans données — même principe que serieCA dans Dashboard.tsx,
 * calé sur la même convention de troncature que Postgres (date_trunc :
 * semaine = lundi ISO, mois = 1er du mois). */
function periodesAttendues(granularite: GranulariteTendance): string[] {
  const n = FENETRE[granularite];
  const dates: string[] = [];
  if (granularite === "jour") {
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
  } else if (granularite === "semaine") {
    const lundi = new Date();
    lundi.setHours(0, 0, 0, 0);
    lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7));
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(lundi);
      d.setDate(d.getDate() - 7 * i);
      dates.push(d.toISOString().slice(0, 10));
    }
  } else {
    const premierDuMois = new Date();
    premierDuMois.setHours(0, 0, 0, 0);
    premierDuMois.setDate(1);
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(premierDuMois);
      d.setMonth(d.getMonth() - i);
      dates.push(d.toISOString().slice(0, 10));
    }
  }
  return dates;
}

function StatComparaison({ titre, valeurTitre, comparaison, format }: { titre: string; valeurTitre: string; comparaison: ComparaisonJourDTO; format: (n: number) => string }) {
  const { t } = useTranslation();
  const variation = comparaison.variationPourcent;
  const positif = variation !== null && variation >= 0;
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{titre}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-marine dark:text-creme">{valeurTitre}</p>
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        {variation !== null && (
          <span className={cn("flex items-center gap-0.5 font-medium", positif ? "text-succes" : "text-terracotta")}>
            {positif ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {positif ? "+" : ""}
            {formatNombre(variation, { maximumFractionDigits: 1 })}%
          </span>
        )}
        <span>{t("dashboard.analytics.vsLastWeek", { montant: format(comparaison.valeurComparaison) })}</span>
      </p>
    </div>
  );
}

/**
 * Tableau de bord analytique v2 (lecture seule) : tendances historiques
 * réelles (CA, bacs, volume par produit) + une projection simple, présentée
 * explicitement comme une heuristique statistique (moyenne mobile,
 * comparaison au même jour la semaine précédente) — JAMAIS un modèle
 * prédictif.
 */
export function AnalytiqueAvanceSection() {
  const { t } = useTranslation();
  const [granularite, setGranularite] = useState<GranulariteTendance>("jour");

  const { data: tendances } = useQuery({
    queryKey: ["rapports", "tendances", granularite],
    queryFn: () => api<TendancesDashboardDTO>(`/api/rapports/tendances?granularite=${granularite}`),
  });
  const { data: projection } = useQuery({
    queryKey: ["rapports", "projection"],
    queryFn: () => api<ProjectionDashboardDTO>("/api/rapports/projection"),
  });

  const periodes = useMemo(() => periodesAttendues(granularite), [granularite]);

  const serieCA = useMemo(() => {
    if (!tendances) return [];
    const parPeriode = new Map(tendances.ca.map((p) => [p.periode, p.total]));
    return periodes.map((periode) => ({ periode, total: parPeriode.get(periode) ?? 0 }));
  }, [tendances, periodes]);

  const serieBacs = useMemo(() => {
    if (!tendances) return [];
    const parPeriode = new Map(tendances.bacs.map((p) => [p.periode, p.total]));
    return periodes.map((periode) => ({ periode, total: parPeriode.get(periode) ?? 0 }));
  }, [tendances, periodes]);

  const serieVolume = useMemo(() => {
    if (!tendances) return [];
    const parPeriode = new Map(tendances.volumeParProduit.map((p) => [p.periode, p.produits]));
    return periodes.map((periode) => {
      const point: Record<string, string | number> = { periode };
      for (const produit of tendances.produitsCatalogue) {
        const ligne = parPeriode.get(periode)?.find((p) => p.produitId === produit.id);
        point[produit.id] = ligne?.quantite ?? 0;
      }
      return point;
    });
  }, [tendances, periodes]);

  return (
    <Card className="border-or/40">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <LineChartIcon className="h-4 w-4 text-or" />
            {t("dashboard.analytics.title")}
          </CardTitle>
          <CardDescription>{t("dashboard.analytics.desc")}</CardDescription>
        </div>
        <div className="flex gap-1.5">
          {GRANULARITES.map((g) => (
            <Button key={g} type="button" size="sm" variant={granularite === g ? "default" : "outline"} onClick={() => setGranularite(g)}>
              {t(`dashboard.analytics.granularity.${g}`)}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">{t("dashboard.analytics.caTitle")}</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={serieCA} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                  <XAxis dataKey="periode" tickFormatter={(v: string) => formatPeriodeLabel(v, granularite)} tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.6} interval={Math.ceil(periodes.length / 8)} />
                  <YAxis tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.6} width={70} tickFormatter={(v: number) => formatNombre(v, { notation: "compact" })} />
                  <Tooltip formatter={(v) => [formatFc(Number(v)), t("dashboard.analytics.caTitle")]} labelFormatter={(l) => formatPeriodeLabel(String(l), granularite)} />
                  <Line type="monotone" dataKey="total" stroke={OR} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">{t("dashboard.analytics.bacsTitle")}</p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={serieBacs} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                  <XAxis dataKey="periode" tickFormatter={(v: string) => formatPeriodeLabel(v, granularite)} tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.6} interval={Math.ceil(periodes.length / 8)} />
                  <YAxis tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.6} width={50} allowDecimals={false} tickFormatter={(v: number) => formatNombre(v, { notation: "compact" })} />
                  <Tooltip formatter={(v) => [formatNombre(Number(v)), t("dashboard.bacsSuffix")]} labelFormatter={(l) => formatPeriodeLabel(String(l), granularite)} />
                  <Line type="monotone" dataKey="total" stroke={TERRACOTTA} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-muted-foreground">{t("dashboard.analytics.volumeTitle")}</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={serieVolume} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                <XAxis dataKey="periode" tickFormatter={(v: string) => formatPeriodeLabel(v, granularite)} tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.6} interval={Math.ceil(periodes.length / 8)} />
                <YAxis tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.6} width={50} allowDecimals={false} />
                <Tooltip labelFormatter={(l) => formatPeriodeLabel(String(l), granularite)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {(tendances?.produitsCatalogue ?? []).map((produit, i) => (
                  <Line key={produit.id} type="monotone" dataKey={produit.id} name={produit.nom} stroke={PALETTE_PRODUITS[i % PALETTE_PRODUITS.length]} strokeWidth={2} dot={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {projection && (
          <div className="rounded-lg border border-or/30 bg-or/5 p-4">
            <p className="mb-3 text-xs text-muted-foreground">{t("dashboard.analytics.projectionWarning")}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("dashboard.analytics.movingAverageCa")}</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-marine dark:text-creme">{formatFc(projection.moyenneMobile7JoursCa)}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("dashboard.analytics.movingAverageBacs")}</p>
                <p className="mt-1 text-lg font-bold tabular-nums text-marine dark:text-creme">{formatNombre(projection.moyenneMobile7JoursBacs)}</p>
              </div>
              <StatComparaison
                titre={t("dashboard.analytics.comparisonCa")}
                valeurTitre={formatFc(projection.comparaisonCa.valeurReference)}
                comparaison={projection.comparaisonCa}
                format={formatFc}
              />
              <StatComparaison
                titre={t("dashboard.analytics.comparisonBacs")}
                valeurTitre={formatNombre(projection.comparaisonBacs.valeurReference)}
                comparaison={projection.comparaisonBacs}
                format={(n) => formatNombre(n)}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
