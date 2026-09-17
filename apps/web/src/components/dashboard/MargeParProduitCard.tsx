import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import { formatFc, formatNombre, type MargeParProduitDTO } from "@lomoto/shared";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const TERRACOTTA = "#AD5416";

/**
 * Widget « Marge par produit » (3.8, resté en suspens depuis l'audit). PAS une
 * vraie marge — la spec est explicite : aucun coût par matière première
 * systématique, ingrédients consommés globalement depuis la refonte 3.3.
 * Affiche volume livré + CA ESTIMÉ (prix catalogue courant), avec la
 * limitation visible en permanence, jamais présentée comme une marge réelle.
 */
export function MargeParProduitCard() {
  const { t } = useTranslation();
  const [jours, setJours] = useState<7 | 30>(30);

  const { data } = useQuery({
    queryKey: ["rapports", "marge-produit", jours],
    queryFn: () => api<MargeParProduitDTO>(`/api/rapports/marge-produit?jours=${jours}`),
  });

  const totalCaEstime = data?.produits.reduce((s, p) => s + p.caEstime, 0) ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Layers className="h-4 w-4 text-or" />
            {t("dashboard.margin.title")}
          </CardTitle>
          <CardDescription>{t("dashboard.margin.desc")}</CardDescription>
        </div>
        <div className="flex gap-1.5">
          <Button type="button" size="sm" variant={jours === 7 ? "default" : "outline"} onClick={() => setJours(7)}>
            {t("dashboard.margin.period7")}
          </Button>
          <Button type="button" size="sm" variant={jours === 30 ? "default" : "outline"} onClick={() => setJours(30)}>
            {t("dashboard.margin.period30")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="rounded-md bg-terracotta/10 px-3 py-2 text-xs text-terracotta">{t("dashboard.margin.warning")}</p>

        {!data || data.produits.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("dashboard.margin.empty")}</p>
        ) : (
          <>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.produits} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    stroke="currentColor"
                    opacity={0.6}
                    tickFormatter={(v: number) => formatNombre(v, { notation: "compact" })}
                  />
                  <YAxis type="category" dataKey="nom" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.8} width={110} />
                  <Tooltip
                    formatter={(v, _n, item) => [
                      `${formatFc(Number(v))} (${formatNombre(item.payload.quantiteLivree)} ${t("dashboard.bacsSuffix")})`,
                      t("dashboard.margin.caEstimeTooltip"),
                    ]}
                  />
                  <Bar dataKey="caEstime" fill={TERRACOTTA} radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-right text-sm text-muted-foreground">
              {t("dashboard.margin.totalCa", { montant: formatFc(totalCaEstime) })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
