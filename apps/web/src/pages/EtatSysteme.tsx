import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  Database,
  Download,
  HardDriveDownload,
  KeyRound,
  Loader2,
  RefreshCw,
  Server,
  Users,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatOctets, type EtatSystemeDTO, type SauvegardeDTO } from "@lomoto/shared";
import { api, getToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChargementModule } from "@/components/ChargementModule";

const formatDate = (iso: string) => new Date(iso).toLocaleString();

/** Petite carte d'information, réutilisée pour les champs d'identité du système. */
function CarteInfo({
  icone: Icone,
  libelle,
  children,
}: {
  icone: typeof Server;
  libelle: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">
          <Icone className="h-4 w-4 text-or" />
          {libelle}
        </CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function BadgeStatut({ statut }: { statut: SauvegardeDTO["statut"] }) {
  const { t } = useTranslation();
  return statut === "SUCCES" ? (
    <Badge className="border-transparent bg-or text-marine">{t("etatSysteme.statusSUCCES")}</Badge>
  ) : (
    <Badge className="border-transparent bg-terracotta text-creme">{t("etatSysteme.statusECHEC")}</Badge>
  );
}

// État système (section 3.15) — réservé aux Administrateurs. Les deux niveaux
// lisent l'écran ; seul le Principal peut déclencher une sauvegarde.
export function EtatSystemePage() {
  const { t } = useTranslation();
  const { utilisateur } = useAuth();
  const queryClient = useQueryClient();
  const [erreurSauvegarde, setErreurSauvegarde] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["etat-systeme"],
    queryFn: () => api<{ etat: EtatSystemeDTO }>("/api/etat-systeme"),
    // Testé en direct à chaque appel : on rafraîchit périodiquement pour refléter
    // l'état réel plutôt qu'une valeur figée.
    refetchInterval: 15000,
  });

  // Le dump revient en binaire : fetch direct plutôt que le helper JSON.
  const sauvegarder = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/etat-systeme/sauvegarde", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const corps = await res.json().catch(() => null);
        throw new Error(corps?.erreur ?? t("etatSysteme.downloadError"));
      }
      const blob = await res.blob();
      const nom =
        res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "sauvegarde.dump";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nom;
      a.click();
      URL.revokeObjectURL(url);
    },
    // Réussie ou non, la tentative entre dans l'historique : on le recharge.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["etat-systeme"] }),
    onError: (e) => setErreurSauvegarde(e instanceof Error ? e.message : t("etatSysteme.downloadError")),
    onSuccess: () => setErreurSauvegarde(null),
  });

  if (isLoading) return <ChargementModule />;
  const etat = data?.etat;
  const sauv = etat?.sauvegardes;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("etatSysteme.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("etatSysteme.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          {t("etatSysteme.refresh")}
        </Button>
      </div>

      {/* Sans pg_dump sur l'hôte, aucune sauvegarde n'est possible : l'Admin doit
          le savoir avant d'en avoir besoin, pas au moment de restaurer. */}
      {sauv && !sauv.outilDisponible && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-md border border-terracotta/40 bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {t("etatSysteme.toolMissing")}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <CarteInfo icone={Server} libelle={t("etatSysteme.appName")}>
          <p className="text-xl font-semibold text-marine dark:text-creme">{etat?.nomApplication}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t("etatSysteme.version")} : v{etat?.version}
          </p>
        </CarteInfo>

        {/* Licence : pas de système de licence avant la version White label. */}
        <CarteInfo icone={KeyRound} libelle={t("etatSysteme.licence")}>
          <Badge variant="secondary">{t("etatSysteme.licenceNotConfigured")}</Badge>
          <p className="mt-2 text-xs text-muted-foreground">{t("etatSysteme.licenceHelp")}</p>
        </CarteInfo>

        {/* Base de données : connexion testée en direct (SELECT 1), hôte et nom
            seulement — jamais les identifiants de connexion. */}
        <CarteInfo icone={Database} libelle={t("etatSysteme.database")}>
          <div className="flex items-center gap-3">
            {etat?.baseDeDonnees.connectee ? (
              <>
                <Badge className="border-transparent bg-or text-marine">{t("etatSysteme.connected")}</Badge>
                {etat.baseDeDonnees.latenceMs !== null && (
                  <span className="text-sm text-muted-foreground">
                    {t("etatSysteme.latency", { ms: etat.baseDeDonnees.latenceMs })}
                  </span>
                )}
              </>
            ) : (
              <Badge className="border-transparent bg-terracotta text-creme">{t("etatSysteme.disconnected")}</Badge>
            )}
          </div>
          <dl className="mt-3 space-y-0.5 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t("etatSysteme.dbHost")} :</dt>
              <dd className="font-medium">
                {etat?.baseDeDonnees.hote ?? "—"}
                {etat?.baseDeDonnees.port ? `:${etat.baseDeDonnees.port}` : ""}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">{t("etatSysteme.dbName")} :</dt>
              <dd className="font-medium">{etat?.baseDeDonnees.base ?? "—"}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">{t("etatSysteme.dbCredentialsNote")}</p>
        </CarteInfo>

        <CarteInfo icone={Users} libelle={t("etatSysteme.activeUsers")}>
          <p className="text-2xl font-semibold text-marine dark:text-creme">{etat?.utilisateursActifs ?? 0}</p>
        </CarteInfo>
      </div>

      {/* --- Tableau de bord de maintenance (section 3.15) ------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HardDriveDownload className="h-4 w-4 text-or" />
            {t("etatSysteme.maintenance")}
          </CardTitle>
          <CardDescription>{t("etatSysteme.maintenanceDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Drive absent : les sauvegardes automatiques ne peuvent pas être
              archivées, mais le téléchargement manuel reste opérationnel. */}
          {sauv && !sauv.driveConfigure && (
            <p className="rounded-md border border-or/50 bg-or/10 px-3 py-2 text-sm">
              {t("etatSysteme.driveNotConfigured")}
            </p>
          )}
          {sauv?.emailCompteService && (
            <p className="text-xs text-muted-foreground">
              {t("etatSysteme.serviceAccount", { email: sauv.emailCompteService })}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("etatSysteme.lastBackup")}</p>
              {sauv?.dernierSucces ? (
                <>
                  <p className="mt-1 font-medium text-marine dark:text-creme">{formatDate(sauv.dernierSucces.date)}</p>
                  <p className="text-sm text-muted-foreground">
                    {t(`etatSysteme.type${sauv.dernierSucces.type}`)}
                    {sauv.dernierSucces.tailleOctets !== null &&
                      ` · ${formatOctets(sauv.dernierSucces.tailleOctets)}`}
                  </p>
                </>
              ) : (
                <p className="mt-1 font-medium text-terracotta">{t("etatSysteme.neverBackedUp")}</p>
              )}
            </div>

            {/* Dernière TENTATIVE, distincte du dernier succès : c'est ainsi
                qu'un échec répété devient visible. */}
            <div>
              <p className="text-xs text-muted-foreground">{t("etatSysteme.lastAttempt")}</p>
              {sauv?.derniere ? (
                <>
                  <p className="mt-1 flex items-center gap-2">
                    <BadgeStatut statut={sauv.derniere.statut} />
                    <span className="text-sm">{formatDate(sauv.derniere.date)}</span>
                  </p>
                  {sauv.derniere.erreur && <p className="mt-1 text-xs text-terracotta">{sauv.derniere.erreur}</p>}
                </>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">—</p>
              )}
            </div>

            <div>
              <p className="text-xs text-muted-foreground">{t("etatSysteme.nextBackup")}</p>
              {sauv?.prochainePrevue ? (
                <>
                  <p className="mt-1 flex items-center gap-2 font-medium text-marine dark:text-creme">
                    <CalendarClock className="h-4 w-4 text-or" />
                    {formatDate(sauv.prochainePrevue)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("etatSysteme.scheduleAt", { expression: sauv.expressionCron, fuseau: sauv.fuseau })}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-terracotta">{t("etatSysteme.scheduleInactive")}</p>
              )}
            </div>
          </div>

          {/* Sauvegarde manuelle — Admin Principal uniquement (section 3.15).
              Le serveur revérifie : masquer le bouton ne protège rien. */}
          <div className="border-t pt-4">
            {utilisateur?.estAdminPrincipal ? (
              <>
                <Button
                  variant="cta"
                  onClick={() => sauvegarder.mutate()}
                  disabled={sauvegarder.isPending || !sauv?.outilDisponible}
                >
                  {sauvegarder.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {sauvegarder.isPending ? t("etatSysteme.downloading") : t("etatSysteme.download")}
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">{t("etatSysteme.downloadHelp")}</p>
                {erreurSauvegarde && (
                  <p
                    role="alert"
                    className="mt-2 rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta"
                  >
                    {erreurSauvegarde}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("etatSysteme.principalOnly")}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* --- Historique ----------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("etatSysteme.history")}</CardTitle>
        </CardHeader>
        <CardContent>
          {!sauv?.historique.length ? (
            <p className="text-sm text-muted-foreground">{t("etatSysteme.historyEmpty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">{t("etatSysteme.colDate")}</th>
                    <th className="py-2 pr-4 font-medium">{t("etatSysteme.colType")}</th>
                    <th className="py-2 pr-4 font-medium">{t("etatSysteme.colStatus")}</th>
                    <th className="py-2 pr-4 text-right font-medium">{t("etatSysteme.colSize")}</th>
                    <th className="py-2 font-medium">{t("etatSysteme.colDestination")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sauv.historique.map((s) => (
                    <tr key={s.id} className="border-b align-top last:border-0">
                      <td className="py-2 pr-4 whitespace-nowrap">{formatDate(s.date)}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        {t(`etatSysteme.type${s.type}`)}
                        {s.declencheParNom && (
                          <span className="block text-xs text-muted-foreground">{s.declencheParNom}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <BadgeStatut statut={s.statut} />
                        {s.erreur && <p className="mt-1 max-w-md text-xs text-terracotta">{s.erreur}</p>}
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">
                        {s.tailleOctets !== null ? formatOctets(s.tailleOctets) : "—"}
                      </td>
                      <td className="py-2 whitespace-nowrap text-muted-foreground">
                        {s.destination
                          ? t(`etatSysteme.dest${s.destination}`, { defaultValue: s.destination })
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {etat && (
        <p className="text-center text-xs text-muted-foreground">
          {t("etatSysteme.measuredAt", {
            time: new Date(dataUpdatedAt || etat.horodatage).toLocaleTimeString(),
          })}
        </p>
      )}
    </div>
  );
}
