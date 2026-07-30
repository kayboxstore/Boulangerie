import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Banknote,
  CalendarCheck,
  Download,
  Factory,
  FileBarChart,
  HandCoins,
  Package,
  ShoppingBasket,
  Truck,
} from "lucide-react";
import {
  formatFc,
  formatNombre,
  formatQuantite,
  type Module,
  type RapportCaisseDTO,
  type RapportCommandesDTO,
  type RapportCommissionsDTO,
  type RapportFournisseursDTO,
  type RapportProductionDTO,
  type RapportStockDTO,
  type RapportTravailleursDTO,
  type ResumeClotureDTO,
} from "@lomoto/shared";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useSocket } from "@/lib/socket";
import { telechargerCSV, type SectionCSV } from "@/lib/csv";
import { BarreExport } from "@/components/BarreExport";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityFeed } from "@/components/ActivityFeed";
import { IndicateurConnexion } from "@/components/IndicateurConnexion";
import { cn } from "@/lib/utils";

// Couleurs de marque (section 3.8) utilisées par les graphiques Recharts.
const OR = "#DA9F4E";
const TERRACOTTA = "#AD5416";

function formatDateCourte(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit" }).format(new Date(`${iso}T00:00:00`));
}

/** Compteur animé (micro-animation des cartes KPI, section 3.8). */
function Compteur({ valeur, format }: { valeur: number; format: (n: number) => string }) {
  const [affiche, setAffiche] = useState(0);
  const precedent = useRef(0);

  useEffect(() => {
    const depart = precedent.current;
    precedent.current = valeur;
    if (depart === valeur) return setAffiche(valeur);
    const duree = 600;
    const debut = performance.now();
    let anim: number;
    const pas = (maintenant: number) => {
      const progression = Math.min(1, (maintenant - debut) / duree);
      const facteur = 1 - Math.pow(1 - progression, 3); // ease-out cubic
      setAffiche(Math.round(depart + (valeur - depart) * facteur));
      if (progression < 1) anim = requestAnimationFrame(pas);
    };
    anim = requestAnimationFrame(pas);
    return () => cancelAnimationFrame(anim);
  }, [valeur]);

  return <>{format(affiche)}</>;
}

function CarteKPI({
  titre,
  valeur,
  format = (n: number) => String(n),
  detail,
  accent,
  alerteSiNegatif,
}: {
  titre: string;
  valeur: number;
  format?: (n: number) => string;
  detail?: string;
  accent?: boolean;
  /** Un solde négatif s'affiche en gras et en rouge vif (section 3.1). */
  alerteSiNegatif?: boolean;
}) {
  const enAlerte = !!alerteSiNegatif && valeur < 0;
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow",
        accent && "border-or/50 bg-or/5",
        enAlerte && "border-2 border-rouge-alerte bg-rouge-alerte/10",
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{titre}</p>
      <p
        className={cn(
          "mt-1 text-2xl font-bold tabular-nums text-marine dark:text-creme",
          accent && "text-terracotta dark:text-or",
          enAlerte && "font-extrabold text-rouge-alerte dark:text-rouge-alerte",
        )}
      >
        <Compteur valeur={valeur} format={format} />
      </p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function TitreWidget({ icone: Icone, children }: { icone: typeof Banknote; children: React.ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-2 text-base">
      <Icone className="h-4 w-4 text-or" />
      {children}
    </CardTitle>
  );
}

export function DashboardPage() {
  const { utilisateur, peutLire } = useAuth();
  const { t } = useTranslation();
  const { notifications, marquerLue } = useSocket();

  const litCaisse = peutLire("CAISSE");
  const litCommandes = peutLire("COMMANDES");
  const litCommissions = peutLire("COMMISSIONS");
  const litStocks = peutLire("STOCKS");
  const litProduction = peutLire("PRODUCTION");
  const litFournisseurs = peutLire("FOURNISSEURS");
  const litTravailleurs = peutLire("TRAVAILLEURS");
  // RAPPORTS : DG + les deux niveaux d'Admin depuis la refonte de la section 2.
  const litRapports = peutLire("RAPPORTS");

  const { data: caisse } = useQuery({
    queryKey: ["rapports", "caisse"],
    queryFn: () => api<RapportCaisseDTO>("/api/rapports/caisse"),
    enabled: litCaisse,
  });
  const { data: commandes } = useQuery({
    queryKey: ["rapports", "commandes"],
    queryFn: () => api<RapportCommandesDTO>("/api/rapports/commandes"),
    enabled: litCommandes,
  });
  const { data: commissions } = useQuery({
    queryKey: ["rapports", "commissions"],
    queryFn: () => api<RapportCommissionsDTO>("/api/rapports/commissions"),
    enabled: litCommissions,
  });
  const { data: stock } = useQuery({
    queryKey: ["rapports", "stock"],
    queryFn: () => api<RapportStockDTO>("/api/rapports/stock"),
    enabled: litStocks,
  });
  const { data: production } = useQuery({
    queryKey: ["rapports", "production"],
    queryFn: () => api<RapportProductionDTO>("/api/rapports/production"),
    enabled: litProduction,
  });
  const { data: fournisseurs } = useQuery({
    queryKey: ["rapports", "fournisseurs"],
    queryFn: () => api<RapportFournisseursDTO>("/api/rapports/fournisseurs"),
    enabled: litFournisseurs,
  });
  const { data: travailleurs } = useQuery({
    queryKey: ["rapports", "travailleurs"],
    queryFn: () => api<RapportTravailleursDTO>("/api/rapports/travailleurs"),
    enabled: litTravailleurs,
  });
  const { data: cloture } = useQuery({
    queryKey: ["rapports", "cloture"],
    queryFn: () => api<ResumeClotureDTO>("/api/rapports/cloture-quotidienne"),
    enabled: litRapports,
  });

  // Courbe CA : combler à zéro les jours sans vente sur les 30 derniers jours.
  const serieCA = useMemo(() => {
    if (!caisse) return [];
    const parDate = new Map(caisse.serie30Jours.map((p) => [p.date, p.total]));
    const points: { date: string; total: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const cle = d.toISOString().slice(0, 10);
      points.push({ date: cle, total: parDate.get(cle) ?? 0 });
    }
    return points;
  }, [caisse]);

  /** Sections du document — partagées par l'export CSV et l'export PDF/email. */
  function construireSections(): SectionCSV[] {
    const c = (k: string) => t(`dashboard.csv.${k}`);
    const sections: SectionCSV[] = [];
    if (caisse) {
      sections.push({
        titre: c("caTitle"),
        entetes: [c("indicator"), c("valueFc")],
        lignes: [
          [c("entriesDay"), caisse.entreesJour],
          [c("debtsPaidDay"), caisse.dettesPayeesJour],
          [c("expensesDay"), caisse.depensesJour],
          [c("balanceDay"), caisse.soldeJour],
          [c("balance7"), caisse.solde7Jours],
          [c("balance30"), caisse.solde30Jours],
        ],
      });
      sections.push({
        titre: c("caPerDayTitle"),
        entetes: [c("colDate"), c("caFc")],
        lignes: serieCA.map((p) => [p.date, p.total]),
      });
      sections.push({
        titre: c("topExpensesTitle"),
        entetes: [c("colReason"), c("caFc")],
        lignes: caisse.principalesDepenses.map((d) => [d.motif, d.total]),
      });
    }
    if (commandes) {
      sections.push({
        titre: c("ordersTitle"),
        entetes: [c("indicator"), c("value")],
        lignes: [
          [c("nbOrders"), commandes.nbCommandes30Jours],
          [c("grossFc"), commandes.montantBrut30Jours],
          [c("receivedFc"), commandes.montantRecu30Jours],
          [c("debtsNb"), commandes.dettesEnCours.nombre],
          [c("debtsTotalFc"), commandes.dettesEnCours.total],
        ],
      });
    }
    if (commissions) {
      sections.push({
        titre: c("commissionsTitle"),
        entetes: [c("indicator"), c("value")],
        lignes: [
          [c("totalCommissionsFc"), commissions.totalCommissions30Jours],
          [c("ordersWithCommission"), commissions.nbCommandesACommission30Jours],
        ],
      });
    }
    if (stock) {
      sections.push({
        titre: c("stockAlertsTitle"),
        entetes: [c("colMatiere"), c("colInStock"), c("colThreshold"), c("colUnit")],
        lignes: stock.alertes.map((a) => [a.nom, a.quantiteStock, a.seuilAlerte, a.unite]),
      });
    }
    if (production) {
      sections.push({
        titre: c("lastProductionsTitle"),
        entetes: ["N°", c("colBacs"), c("colDate")],
        lignes: production.dernieres.map((p) => [p.numero, p.bacsProduits, p.date.slice(0, 10)]),
      });
    }
    if (fournisseurs) {
      sections.push({
        titre: c("suppliersTitle"),
        entetes: ["N°", c("colSupplier"), t("common.status"), c("colTotalFc"), c("colDate")],
        lignes: fournisseurs.achatsRecents.map((a) => [
          a.numero,
          a.fournisseurNom,
          t(`statutFournisseur.${a.statut}`),
          a.total,
          a.date.slice(0, 10),
        ]),
      });
    }
    if (travailleurs) {
      sections.push({
        titre: c("presenceTitle"),
        entetes: [c("indicator"), c("value")],
        lignes: [
          [c("expected"), travailleurs.attendus],
          [c("present"), travailleurs.presents],
          [c("late"), travailleurs.retards],
          [c("absent"), travailleurs.absents],
          [c("notClocked"), travailleurs.nonPointes],
        ],
      });
    }
    return sections;
  }

  function exporterCSV() {
    telechargerCSV(`rapports-lomoto-${new Date().toISOString().slice(0, 10)}.csv`, construireSections());
  }

  /** Modules effectivement présents dans le document (vérifiés côté serveur). */
  const modulesDocument = (
    [
      litCaisse && "CAISSE",
      litCommandes && "COMMANDES",
      litCommissions && "COMMISSIONS",
      litStocks && "STOCKS",
      litProduction && "PRODUCTION",
      litFournisseurs && "FOURNISSEURS",
      litTravailleurs && "TRAVAILLEURS",
    ].filter(Boolean) as Module[]
  );

  if (!utilisateur) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("dashboard.greeting", { nom: utilisateur.nom })}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("dashboard.connectedAs")} <span className="font-medium text-foreground">{utilisateur.role.nom}</span>
          </p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-3">
          <IndicateurConnexion etendu />
          <BarreExport
            titre={t("dashboard.reportTitle")}
            sousTitre={t("dashboard.connectedAs") + " " + utilisateur.role.nom}
            modules={modulesDocument}
            construireSections={construireSections}
          />
          <Button variant="outline" onClick={exporterCSV}>
            <Download className="h-4 w-4" />
            {t("dashboard.exportCSV")}
          </Button>
        </div>
      </div>

      {/* Résumé de clôture quotidien — DG et les deux niveaux d'Admin (3.8) */}
      {cloture && (
        <Card className="border-or/40">
          <CardHeader>
            <TitreWidget icone={FileBarChart}>{t("dashboard.closureSummary", { date: formatDateCourte(cloture.date) })}</TitreWidget>
            <CardDescription>{t("dashboard.closureSummaryDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CarteKPI titre={t("dashboard.kpiBalanceDay")} valeur={cloture.soldeJour} format={formatFc} accent alerteSiNegatif />
            <CarteKPI
              titre={t("dashboard.kpiCollectedDay")}
              valeur={cloture.entreesJour + cloture.dettesPayeesJour}
              format={formatFc}
              detail={t("dashboard.ordersClientDetail", { count: cloture.nbCommandesJour })}
            />
            <CarteKPI titre={t("dashboard.kpiDebts")} valeur={cloture.dettesEnCours.total} format={formatFc} detail={t("dashboard.debtsDetail", { count: cloture.dettesEnCours.nombre })} />
            <CarteKPI titre={t("dashboard.kpiStockAlerts")} valeur={cloture.alertesStock.length} detail={cloture.alertesStock.map((a) => a.nom).join(", ") || t("dashboard.none")} />
          </CardContent>
        </Card>
      )}

      {/* CA / Caisse */}
      {litCaisse && caisse && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CarteKPI titre={t("dashboard.kpiBalanceDay")} valeur={caisse.soldeJour} format={formatFc} accent alerteSiNegatif />
            <CarteKPI titre={t("dashboard.kpiEntriesDay")} valeur={caisse.entreesJour} format={formatFc} detail={t("dashboard.debtsPaidDetail", { montant: formatFc(caisse.dettesPayeesJour) })} />
            <CarteKPI titre={t("dashboard.kpiExpensesDay")} valeur={caisse.depensesJour} format={formatFc} />
            <CarteKPI titre={t("dashboard.kpiBalance30")} valeur={caisse.solde30Jours} format={formatFc} detail={t("dashboard.balance7Detail", { montant: formatFc(caisse.solde7Jours) })} alerteSiNegatif />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader>
                <TitreWidget icone={Banknote}>{t("dashboard.caCurveTitle")}</TitreWidget>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={serieCA} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="degradeCA" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={OR} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={OR} stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} />
                    <XAxis dataKey="date" tickFormatter={formatDateCourte} tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.6} interval={6} />
                    <YAxis tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.6} width={70} tickFormatter={(v: number) => formatNombre(v, { notation: "compact" })} />
                    <Tooltip
                      formatter={(v) => [formatFc(Number(v)), t("dashboard.caTooltip")]}
                      labelFormatter={(l) => formatDateCourte(String(l))}
                      contentStyle={{ borderRadius: 8, border: "1px solid rgba(0,0,0,0.1)" }}
                    />
                    <Area type="monotone" dataKey="total" stroke={OR} strokeWidth={2} fill="url(#degradeCA)" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <TitreWidget icone={Banknote}>{t("dashboard.topExpensesTitle")}</TitreWidget>
                <CardDescription>{t("dashboard.topExpensesDesc")}</CardDescription>
              </CardHeader>
              <CardContent className="h-56">
                {caisse.principalesDepenses.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">{t("dashboard.noExpensePeriod")}</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={caisse.principalesDepenses} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.6} allowDecimals={false} tickFormatter={(v: number) => formatNombre(v, { notation: "compact" })} />
                      <YAxis type="category" dataKey="motif" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.8} width={110} />
                      <Tooltip formatter={(v) => [formatFc(Number(v)), t("dashboard.expenseTooltip")]} />
                      <Bar dataKey="total" fill={TERRACOTTA} radius={[0, 4, 4, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Widgets secondaires — chacun conditionné à la lecture du module */}
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {litCommandes && commandes && (
          <Card>
            <CardHeader>
              <TitreWidget icone={ShoppingBasket}>{t("dashboard.ordersTitle")}</TitreWidget>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <CarteKPI titre={t("dashboard.kpiOrders")} valeur={commandes.nbCommandes30Jours} />
                <CarteKPI titre={t("dashboard.kpiReceived")} valeur={commandes.montantRecu30Jours} format={formatFc} />
              </div>
              <div
                className={cn(
                  "rounded-md px-3 py-2 text-sm",
                  commandes.dettesEnCours.nombre > 0 ? "bg-terracotta/10 text-terracotta" : "bg-secondary text-muted-foreground",
                )}
              >
                {commandes.dettesEnCours.nombre > 0 ? (
                  <>
                    <span className="font-semibold">
                      {t("dashboard.debtsInProgress", { count: commandes.dettesEnCours.nombre, montant: formatFc(commandes.dettesEnCours.total) })}
                    </span>{" "}
                    {t("dashboard.allPeriods")}
                  </>
                ) : (
                  t("dashboard.noDebt")
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {litCommissions && commissions && (
          <Card>
            <CardHeader>
              <TitreWidget icone={HandCoins}>{t("dashboard.commissionsTitle")}</TitreWidget>
            </CardHeader>
            <CardContent>
              <CarteKPI
                titre={t("dashboard.kpiTotalCommissions")}
                valeur={commissions.totalCommissions30Jours}
                format={formatFc}
                detail={t("dashboard.commissionsDetail", { count: commissions.nbCommandesACommission30Jours })}
                accent
              />
            </CardContent>
          </Card>
        )}

        {litStocks && stock && (
          <Card className={stock.alertes.length > 0 ? "border-terracotta/40" : undefined}>
            <CardHeader>
              <TitreWidget icone={Package}>{t("dashboard.stockAlertsTitle")}</TitreWidget>
              <CardDescription>{t("dashboard.stockAlertsDesc", { count: stock.alertes.length, total: stock.nbMatieres })}</CardDescription>
            </CardHeader>
            <CardContent>
              {stock.alertes.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("dashboard.allStocksOk")}</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {stock.alertes.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 rounded-md bg-terracotta/10 px-3 py-1.5">
                      <span className="flex items-center gap-1.5 font-medium text-terracotta">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {a.nom}
                      </span>
                      <span className="text-muted-foreground">
                        {t("dashboard.stockThreshold", { stock: formatQuantite(a.quantiteStock, a.unite), seuil: formatQuantite(a.seuilAlerte, a.unite) })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {litProduction && production && (
          <Card>
            <CardHeader>
              <TitreWidget icone={Factory}>{t("dashboard.lastProductionsTitle")}</TitreWidget>
              <CardDescription>{t("dashboard.productionsDesc", { count: production.nbProductions30Jours })}</CardDescription>
            </CardHeader>
            <CardContent>
              {production.dernieres.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("dashboard.noProduction")}</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {production.dernieres.map((p) => (
                    <li key={p.numero} className="flex justify-between gap-2">
                      <span>
                        <span className="text-muted-foreground">n°{p.numero}</span>{" "}
                        <span className="font-medium">{p.bacsProduits}</span> {t("dashboard.bacsSuffix")}
                      </span>
                      <span className="whitespace-nowrap text-muted-foreground">{formatDateCourte(p.date.slice(0, 10))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {litFournisseurs && fournisseurs && (
          <Card>
            <CardHeader>
              <TitreWidget icone={Truck}>{t("dashboard.suppliersTitle")}</TitreWidget>
              <CardDescription>{t("dashboard.suppliersDesc", { montant: formatFc(fournisseurs.totalRecu30Jours), count: fournisseurs.enAttente })}</CardDescription>
            </CardHeader>
            <CardContent>
              {fournisseurs.achatsRecents.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("dashboard.noSupplierOrder")}</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {fournisseurs.achatsRecents.slice(0, 6).map((a) => (
                    <li key={a.numero} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="text-muted-foreground">n°{a.numero}</span>{" "}
                        <span className="font-medium">{a.fournisseurNom}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge variant={a.statut === "RECUE" ? "gold" : "secondary"}>{t(`statutFournisseur.${a.statut}`)}</Badge>
                        <span className="whitespace-nowrap font-medium">{formatFc(a.total)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {litTravailleurs && travailleurs && (
          <Card>
            <CardHeader>
              <TitreWidget icone={CalendarCheck}>{t("dashboard.presenceTitle")}</TitreWidget>
              <CardDescription>{t("dashboard.presenceDesc", { count: travailleurs.presents + travailleurs.retards, total: travailleurs.attendus })}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <CarteKPI titre={t("dashboard.kpiPresent")} valeur={travailleurs.presents} accent />
              <CarteKPI titre={t("dashboard.kpiLate")} valeur={travailleurs.retards} />
              <CarteKPI titre={t("dashboard.kpiAbsent")} valeur={travailleurs.absents} />
              <CarteKPI titre={t("dashboard.kpiNotClocked")} valeur={travailleurs.nonPointes} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Feed temps réel */}
      <Card>
        <CardHeader>
          <CardTitle>{t("activity.title")}</CardTitle>
          <CardDescription>{t("activity.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityFeed notifications={notifications} onMarquerLue={marquerLue} vide={t("activity.empty")} />
        </CardContent>
      </Card>
    </div>
  );
}
