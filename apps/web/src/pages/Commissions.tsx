import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HandCoins, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatFc, type CommissionLigneDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CarteLigne, CarteLigneChamp, CarteLigneTitre } from "@/components/ui/carte-ligne";
import { BarreExport } from "@/components/BarreExport";
import type { SectionCSV } from "@/lib/csv";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export function CommissionsPage() {
  const { t } = useTranslation();
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");

  const params = new URLSearchParams();
  if (du) params.set("du", du);
  if (au) params.set("au", au);

  const { data, isLoading, error } = useQuery({
    queryKey: ["commissions", { du, au }],
    queryFn: () =>
      api<{ commissions: CommissionLigneDTO[]; totalCommissions: number }>(`/api/commissions?${params}`),
  });

  /** Sections du document exporté (impression, PDF, email). */
  function construireSections(): SectionCSV[] {
    const lignes = data?.commissions ?? [];
    return [
      {
        titre: t("commissions.mamanOrders"),
        entetes: [
          t("commissions.colNum"),
          t("common.date"),
          t("commissions.colClient"),
          t("commissions.colBacs"),
          t("commissions.colTotalPaid"),
          t("commissions.colCommission"),
        ],
        lignes: lignes.map((l) => [
          l.numero,
          l.dateCreation.slice(0, 10),
          l.clientNom,
          l.quantiteBacs,
          formatFc(l.montantTotalPaye),
          formatFc(l.commission),
        ]),
      },
      {
        titre: t("commissions.totalLabel"),
        entetes: [t("commissions.totalLabel")],
        lignes: [[formatFc(data?.totalCommissions ?? 0)]],
      },
    ];
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("commissions.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("commissions.subtitle")}</p>
          {/* La carte de filtres ne s'imprime pas : on rappelle ici la période
              retenue, sinon le papier ne dirait pas sur quoi porte le total. */}
          {(du || au) && (
            <p className="lomoto-print-only mt-1 text-sm">
              {t("common.from")} {du || "…"} {t("common.to").toLowerCase()} {au || "…"}
            </p>
          )}
        </div>
        <BarreExport
          titre={t("commissions.title")}
          sousTitre={du || au ? `${du || "…"} → ${au || "…"}` : undefined}
          modules={["COMMISSIONS"]}
          construireSections={construireSections}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
        {/* Filtres — contrôles d'écran : à l'impression, la période retenue est
            portée par le sous-titre du document, pas par des champs vides. */}
        <Card className="no-print">
          <CardContent className="flex flex-wrap items-end gap-3 pt-6">
            <div className="space-y-1.5">
              <Label htmlFor="commissions-du">{t("common.from")}</Label>
              <Input id="commissions-du" type="date" value={du} onChange={(e) => setDu(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="commissions-au">{t("common.to")}</Label>
              <Input id="commissions-au" type="date" value={au} onChange={(e) => setAu(e.target.value)} />
            </div>
            <Button
              variant="outline"
              onClick={() => {
                setDu("");
                setAu("");
              }}
            >
              <RotateCcw className="h-4 w-4" />
              {t("common.showAll")}
            </Button>
          </CardContent>
        </Card>

        {/* Total période */}
        <Card className="border-or/50 bg-or/5">
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-or/15 text-terracotta">
              <HandCoins className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("commissions.totalLabel")} {du || au ? t("commissions.period") : ""}</p>
              <p className="text-xl font-bold text-marine dark:text-or">
                {formatFc(data?.totalCommissions ?? 0)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("commissions.mamanOrders")}</CardTitle>
          <CardDescription>{t("commissions.commissionDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="py-8 text-center text-muted-foreground">{t("common.loading")}</p>}
          {error && (
            <p className="py-8 text-center font-medium text-terracotta">
              {error instanceof Error ? error.message : t("commissions.loadError")}
            </p>
          )}
          {data && (
            <>
              <Table className="hidden md:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("commissions.colNum")}</TableHead>
                    <TableHead>{t("common.date")}</TableHead>
                    <TableHead>{t("commissions.colClient")}</TableHead>
                    <TableHead className="text-right">{t("commissions.colBacs")}</TableHead>
                    <TableHead className="text-right">{t("commissions.colTotalPaid")}</TableHead>
                    <TableHead className="text-right">{t("commissions.colCommission")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.commissions.map((l) => (
                    <TableRow key={l.commandeId}>
                      <TableCell className="font-medium">{l.numero}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(l.dateCreation)}
                      </TableCell>
                      <TableCell className="font-medium">{l.clientNom}</TableCell>
                      <TableCell className="text-right">{l.quantiteBacs}</TableCell>
                      <TableCell className="text-right">{formatFc(l.montantTotalPaye)}</TableCell>
                      <TableCell className="text-right font-semibold text-terracotta dark:text-or">
                        {formatFc(l.commission)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.commissions.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        {t("commissions.empty")}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

              <div className="space-y-2 md:hidden">
                {data.commissions.map((l) => (
                  <CarteLigne key={l.commandeId}>
                    <CarteLigneTitre>
                      <span>
                        n°{l.numero} — {l.clientNom}
                      </span>
                    </CarteLigneTitre>
                    <CarteLigneChamp label={t("common.date")} value={formatDate(l.dateCreation)} />
                    <CarteLigneChamp label={t("commissions.colBacs")} value={l.quantiteBacs} />
                    <CarteLigneChamp label={t("commissions.colTotalPaid")} value={formatFc(l.montantTotalPaye)} />
                    <CarteLigneChamp
                      label={t("commissions.colCommission")}
                      value={<span className="font-semibold text-terracotta dark:text-or">{formatFc(l.commission)}</span>}
                    />
                  </CarteLigne>
                ))}
                {data.commissions.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t("commissions.empty")}</p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
