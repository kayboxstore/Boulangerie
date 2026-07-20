import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  CalendarCheck,
  Download,
  Factory,
  FileBarChart,
  HandCoins,
  Package,
  Settings,
  ShoppingBasket,
  Truck,
  UserCog,
} from "lucide-react";
import {
  formatFc,
  formatQuantite,
  STATUT_COMMANDE_FOURNISSEUR_LABELS,
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ActivityFeed } from "@/components/ActivityFeed";
import { IndicateurConnexion } from "@/components/NotificationBell";
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
    const pas = (t: number) => {
      const progression = Math.min(1, (t - debut) / duree);
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
}: {
  titre: string;
  valeur: number;
  format?: (n: number) => string;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow",
        accent && "border-or/50 bg-or/5",
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{titre}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums text-marine dark:text-creme", accent && "text-terracotta dark:text-or")}>
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
  const { notifications, marquerLue } = useSocket();

  const litCaisse = peutLire("CAISSE");
  const litCommandes = peutLire("COMMANDES");
  const litCommissions = peutLire("COMMISSIONS");
  const litStocks = peutLire("STOCKS");
  const litProduction = peutLire("PRODUCTION");
  const litFournisseurs = peutLire("FOURNISSEURS");
  const litTravailleurs = peutLire("TRAVAILLEURS");
  const litRapports = peutLire("RAPPORTS"); // DG uniquement dans la matrice
  const aucunWidget =
    !litCaisse && !litCommandes && !litCommissions && !litStocks && !litProduction && !litFournisseurs && !litTravailleurs;

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

  function exporterCSV() {
    const sections: SectionCSV[] = [];
    if (caisse) {
      sections.push({
        titre: "CA / Caisse",
        entetes: ["Indicateur", "Valeur (Fc)"],
        lignes: [
          ["CA du jour", caisse.caJour],
          ["CA 7 derniers jours", caisse.ca7Jours],
          ["CA 30 derniers jours", caisse.ca30Jours],
          ["Ventes du jour", caisse.nbVentesJour],
        ],
      });
      sections.push({
        titre: "CA par jour (30 jours)",
        entetes: ["Date", "CA (Fc)"],
        lignes: serieCA.map((p) => [p.date, p.total]),
      });
      sections.push({
        titre: "Meilleures ventes (30 jours) — volume et CA (marge non calculable : prix d'achat des matières non systématiques)",
        entetes: ["Produit", "Quantité vendue", "CA (Fc)"],
        lignes: caisse.meilleuresVentes.map((v) => [v.produitNom, v.quantite, v.ca]),
      });
    }
    if (commandes) {
      sections.push({
        titre: "Commandes clients (30 jours)",
        entetes: ["Indicateur", "Valeur"],
        lignes: [
          ["Nombre de commandes", commandes.nbCommandes30Jours],
          ["Montant brut (Fc)", commandes.montantBrut30Jours],
          ["Montant reçu (Fc)", commandes.montantRecu30Jours],
          ["Dettes en cours — nombre", commandes.dettesEnCours.nombre],
          ["Dettes en cours — total (Fc)", commandes.dettesEnCours.total],
        ],
      });
    }
    if (commissions) {
      sections.push({
        titre: "Commissions (30 jours)",
        entetes: ["Indicateur", "Valeur"],
        lignes: [
          ["Total commissions (Fc)", commissions.totalCommissions30Jours],
          ["Commandes à commission", commissions.nbCommandesACommission30Jours],
        ],
      });
    }
    if (stock) {
      sections.push({
        titre: "Alertes stock actives",
        entetes: ["Matière", "En stock", "Seuil", "Unité"],
        lignes: stock.alertes.map((a) => [a.nom, a.quantiteStock, a.seuilAlerte, a.unite]),
      });
    }
    if (production) {
      sections.push({
        titre: "Dernières productions",
        entetes: ["N°", "Produit", "Quantité", "Date"],
        lignes: production.dernieres.map((p) => [p.numero, p.produitNom, p.quantiteProduite, p.date.slice(0, 10)]),
      });
    }
    if (fournisseurs) {
      sections.push({
        titre: "Achats fournisseurs récents",
        entetes: ["N°", "Fournisseur", "Statut", "Total (Fc)", "Date"],
        lignes: fournisseurs.achatsRecents.map((a) => [
          a.numero,
          a.fournisseurNom,
          STATUT_COMMANDE_FOURNISSEUR_LABELS[a.statut],
          a.total,
          a.date.slice(0, 10),
        ]),
      });
    }
    if (travailleurs) {
      sections.push({
        titre: "Présence du jour",
        entetes: ["Indicateur", "Valeur"],
        lignes: [
          ["Attendus", travailleurs.attendus],
          ["Présents", travailleurs.presents],
          ["Retards", travailleurs.retards],
          ["Absents", travailleurs.absents],
          ["Non pointés", travailleurs.nonPointes],
        ],
      });
    }
    telechargerCSV(`rapports-lomoto-${new Date().toISOString().slice(0, 10)}.csv`, sections);
  }

  if (!utilisateur) return null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">Bonjour, {utilisateur.nom}</h1>
          <p className="mt-1 text-muted-foreground">
            Connecté(e) en tant que <span className="font-medium text-foreground">{utilisateur.role.nom}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <IndicateurConnexion etendu />
          {!aucunWidget && (
            <Button variant="outline" onClick={exporterCSV}>
              <Download className="h-4 w-4" />
              Exporter CSV
            </Button>
          )}
        </div>
      </div>

      {/* Admin : aucun widget métier par design — état vide explicite (3.8) */}
      {aucunWidget && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <FileBarChart className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <p className="font-medium">Aucune donnée métier à afficher pour votre rôle.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Les widgets du tableau de bord suivent la matrice de permissions — le rôle Administrateur n'a
                aucune permission métier, par design. Consultez plutôt vos modules :
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild variant="outline">
                <Link to="/equipe">
                  <UserCog className="h-4 w-4" />
                  Équipe
                </Link>
              </Button>
              <Button variant="outline" disabled title="Module à venir">
                <Settings className="h-4 w-4" />
                Paramètres (à venir)
              </Button>
              <Button variant="outline" disabled title="Module à venir (3.15)">
                État système (à venir)
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Résumé de clôture quotidien — DG uniquement (3.8) */}
      {cloture && (
        <Card className="border-or/40">
          <CardHeader>
            <TitreWidget icone={FileBarChart}>Résumé de clôture — {formatDateCourte(cloture.date)}</TitreWidget>
            <CardDescription>Vue de synthèse du jour, en plus des widgets temps réel.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CarteKPI titre="CA du jour" valeur={cloture.caJour} format={formatFc} accent />
            <CarteKPI titre="Ventes du jour" valeur={cloture.nbVentesJour} detail={`${cloture.nbCommandesJour} commande(s) client`} />
            <CarteKPI titre="Dettes en cours" valeur={cloture.dettesEnCours.total} format={formatFc} detail={`${cloture.dettesEnCours.nombre} commande(s) concernée(s)`} />
            <CarteKPI titre="Alertes stock actives" valeur={cloture.alertesStock.length} detail={cloture.alertesStock.map((a) => a.nom).join(", ") || "Aucune"} />
          </CardContent>
        </Card>
      )}

      {/* CA / Caisse */}
      {litCaisse && caisse && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CarteKPI titre="CA du jour" valeur={caisse.caJour} format={formatFc} accent />
            <CarteKPI titre="CA — 7 derniers jours" valeur={caisse.ca7Jours} format={formatFc} />
            <CarteKPI titre="CA — 30 derniers jours" valeur={caisse.ca30Jours} format={formatFc} />
            <CarteKPI titre="Ventes du jour" valeur={caisse.nbVentesJour} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader>
                <TitreWidget icone={Banknote}>Courbe du chiffre d'affaires (30 jours)</TitreWidget>
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
                    <YAxis tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.6} width={70} tickFormatter={(v: number) => new Intl.NumberFormat("fr-FR", { notation: "compact" }).format(v)} />
                    <Tooltip
                      formatter={(v) => [formatFc(Number(v)), "CA"]}
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
                <TitreWidget icone={Banknote}>Meilleures ventes (30 jours)</TitreWidget>
                <CardDescription>
                  Par volume, avec le CA par produit. La marge n'est pas affichée : le coût de revient n'est
                  pas calculable tant que les prix d'achat des matières ne sont pas systématiquement renseignés.
                </CardDescription>
              </CardHeader>
              <CardContent className="h-56">
                {caisse.meilleuresVentes.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Aucune vente sur la période.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={caisse.meilleuresVentes} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.1} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.6} allowDecimals={false} />
                      <YAxis type="category" dataKey="produitNom" tick={{ fontSize: 11 }} stroke="currentColor" opacity={0.8} width={110} />
                      <Tooltip
                        formatter={(v, nom, item) =>
                          nom === "quantite"
                            ? [`${v} vendu(s) — CA ${formatFc(item.payload.ca)}`, item.payload.produitNom]
                            : [String(v), String(nom)]
                        }
                      />
                      <Bar dataKey="quantite" fill={TERRACOTTA} radius={[0, 4, 4, 0]} barSize={16} />
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
              <TitreWidget icone={ShoppingBasket}>Commandes clients (30 jours)</TitreWidget>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <CarteKPI titre="Commandes" valeur={commandes.nbCommandes30Jours} />
                <CarteKPI titre="Montant reçu" valeur={commandes.montantRecu30Jours} format={formatFc} />
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
                      {commandes.dettesEnCours.nombre} dette(s) en cours — {formatFc(commandes.dettesEnCours.total)}
                    </span>{" "}
                    (toutes périodes)
                  </>
                ) : (
                  "Aucune dette en cours."
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {litCommissions && commissions && (
          <Card>
            <CardHeader>
              <TitreWidget icone={HandCoins}>Commissions (30 jours)</TitreWidget>
            </CardHeader>
            <CardContent>
              <CarteKPI
                titre="Total des commissions"
                valeur={commissions.totalCommissions30Jours}
                format={formatFc}
                detail={`${commissions.nbCommandesACommission30Jours} commande(s) Maman`}
                accent
              />
            </CardContent>
          </Card>
        )}

        {litStocks && stock && (
          <Card className={stock.alertes.length > 0 ? "border-terracotta/40" : undefined}>
            <CardHeader>
              <TitreWidget icone={Package}>Alertes stock</TitreWidget>
              <CardDescription>
                {stock.alertes.length} matière(s) sous le seuil sur {stock.nbMatieres}.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {stock.alertes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Tous les stocks sont au-dessus de leur seuil.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {stock.alertes.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 rounded-md bg-terracotta/10 px-3 py-1.5">
                      <span className="flex items-center gap-1.5 font-medium text-terracotta">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {a.nom}
                      </span>
                      <span className="text-muted-foreground">
                        {formatQuantite(a.quantiteStock, a.unite)} / seuil {formatQuantite(a.seuilAlerte, a.unite)}
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
              <TitreWidget icone={Factory}>Dernières productions</TitreWidget>
              <CardDescription>{production.nbProductions30Jours} production(s) sur 30 jours.</CardDescription>
            </CardHeader>
            <CardContent>
              {production.dernieres.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune production enregistrée.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {production.dernieres.map((p) => (
                    <li key={p.numero} className="flex justify-between gap-2">
                      <span>
                        <span className="text-muted-foreground">n°{p.numero}</span>{" "}
                        <span className="font-medium">{p.produitNom}</span> × {p.quantiteProduite}
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
              <TitreWidget icone={Truck}>Achats fournisseurs</TitreWidget>
              <CardDescription>
                {formatFc(fournisseurs.totalRecu30Jours)} reçus sur 30 jours — {fournisseurs.enAttente} commande(s) en attente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {fournisseurs.achatsRecents.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune commande fournisseur.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {fournisseurs.achatsRecents.slice(0, 6).map((a) => (
                    <li key={a.numero} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="text-muted-foreground">n°{a.numero}</span>{" "}
                        <span className="font-medium">{a.fournisseurNom}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge variant={a.statut === "RECUE" ? "gold" : "secondary"}>
                          {STATUT_COMMANDE_FOURNISSEUR_LABELS[a.statut]}
                        </Badge>
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
              <TitreWidget icone={CalendarCheck}>Présence du jour</TitreWidget>
              <CardDescription>
                {travailleurs.presents + travailleurs.retards} présent(s) / {travailleurs.attendus} attendu(s)
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              <CarteKPI titre="Présents" valeur={travailleurs.presents} accent />
              <CarteKPI titre="Retards" valeur={travailleurs.retards} />
              <CarteKPI titre="Absents" valeur={travailleurs.absents} />
              <CarteKPI titre="Non pointés" valeur={travailleurs.nonPointes} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Feed temps réel */}
      <Card>
        <CardHeader>
          <CardTitle>Feed d'activité</CardTitle>
          <CardDescription>Les événements de votre périmètre, en temps réel.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityFeed
            notifications={notifications}
            onMarquerLue={marquerLue}
            vide="Aucun événement pour le moment — ils apparaîtront ici dès qu'ils seront émis."
          />
        </CardContent>
      </Card>
    </div>
  );
}
