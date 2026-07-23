import { useQuery } from "@tanstack/react-query";
import { Activity, Database, RefreshCw, Server, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EtatSystemeDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChargementModule } from "@/components/ChargementModule";

// État système (section 3.15) — réservé à l'Administrateur.
export function EtatSystemePage() {
  const { t } = useTranslation();
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["etat-systeme"],
    queryFn: () => api<{ etat: EtatSystemeDTO }>("/api/etat-systeme"),
    // Testé en direct à chaque appel : on rafraîchit périodiquement pour refléter
    // l'état réel plutôt qu'une valeur figée.
    refetchInterval: 15000,
  });

  if (isLoading) return <ChargementModule />;
  const etat = data?.etat;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
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

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Connexion base de données — testée en direct (SELECT 1). */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Database className="h-4 w-4 text-or" />
              {t("etatSysteme.database")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {etat?.baseDeDonnees.connectee ? (
              <div className="flex items-center gap-3">
                <Badge className="border-transparent bg-or text-marine">{t("etatSysteme.connected")}</Badge>
                {etat.baseDeDonnees.latenceMs !== null && (
                  <span className="text-sm text-muted-foreground">
                    {t("etatSysteme.latency", { ms: etat.baseDeDonnees.latenceMs })}
                  </span>
                )}
              </div>
            ) : (
              <Badge className="border-transparent bg-terracotta text-creme">{t("etatSysteme.disconnected")}</Badge>
            )}
          </CardContent>
        </Card>

        {/* Version applicative. */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Server className="h-4 w-4 text-or" />
              {t("etatSysteme.version")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-marine dark:text-creme">v{etat?.version}</p>
          </CardContent>
        </Card>

        {/* Utilisateurs actifs. */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Users className="h-4 w-4 text-or" />
              {t("etatSysteme.activeUsers")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-marine dark:text-creme">{etat?.utilisateursActifs ?? 0}</p>
          </CardContent>
        </Card>

        {/* Sauvegarde : aucun mécanisme dans le projet → clairement « non configuré »
            (jamais une fausse date rassurante). */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-or" />
              {t("etatSysteme.backup")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">{t("etatSysteme.backupNotConfigured")}</Badge>
            <p className="mt-2 text-xs text-muted-foreground">{t("etatSysteme.backupHelp")}</p>
          </CardContent>
        </Card>
      </div>

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
