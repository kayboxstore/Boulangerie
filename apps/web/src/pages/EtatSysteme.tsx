import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  CheckCircle2,
  Database,
  Download,
  HardDriveDownload,
  KeyRound,
  Loader2,
  RefreshCw,
  Server,
  Trash2,
  Usb,
  Users,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  formatOctets,
  MOT_CONFIRMATION_REINITIALISATION,
  type EtatSystemeDTO,
  type SauvegardeDTO,
} from "@lomoto/shared";
import { api, getToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChargementModule } from "@/components/ChargementModule";
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

  // Téléchargement d'un fichier binaire, factorisé pour les deux boutons
  // (fresh dump manuel, ou fichier local déjà produit par l'automatique).
  async function telechargerDepuis(chemin: string, methode: "GET" | "POST", messageErreurDefaut: string) {
    const res = await fetch(chemin, {
      method: methode,
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      const corps = await res.json().catch(() => null);
      throw new Error(corps?.erreur ?? messageErreurDefaut);
    }
    const blob = await res.blob();
    const nom = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "sauvegarde.dump";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nom;
    a.click();
    URL.revokeObjectURL(url);
  }

  const sauvegarder = useMutation({
    mutationFn: () => telechargerDepuis("/api/etat-systeme/sauvegarde", "POST", t("etatSysteme.downloadError")),
    // Réussie ou non, la tentative entre dans l'historique : on le recharge.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["etat-systeme"] }),
    onError: (e) => setErreurSauvegarde(e instanceof Error ? e.message : t("etatSysteme.downloadError")),
    onSuccess: () => setErreurSauvegarde(null),
  });

  // Récupère le fichier déjà produit par la dernière sauvegarde automatique —
  // pas de nouveau pg_dump, juste une copie rapide vers un support externe.
  const [erreurLocale, setErreurLocale] = useState<string | null>(null);
  const telechargerLocale = useMutation({
    mutationFn: () =>
      telechargerDepuis("/api/etat-systeme/sauvegarde/derniere-locale", "GET", t("etatSysteme.downloadLatestLocalError")),
    onError: (e) => setErreurLocale(e instanceof Error ? e.message : t("etatSysteme.downloadLatestLocalError")),
    onSuccess: () => setErreurLocale(null),
  });

  // Diagnostic Assistant IA (section 3.19) : appel Gemini réel à la demande —
  // évite de tester à chaque chargement de l'écran (coût, latence).
  const diagnosticIA = useMutation({
    mutationFn: () =>
      api<{ modele: string; cleConfiguree: boolean; ok: boolean; details: string }>("/api/assistant/diagnostic-ia"),
  });

  // --- Réinitialisation de la base (section 3.15, nouveau) -------------------
  // Irréversible : confirmation par saisie EXACTE du mot (pas un simple clic).
  const [dialogReinit, setDialogReinit] = useState(false);
  const [motReinit, setMotReinit] = useState("");
  const [raisonReinit, setRaisonReinit] = useState("");
  const [erreurReinit, setErreurReinit] = useState<string | null>(null);

  const reinitialiser = useMutation({
    mutationFn: () =>
      api("/api/etat-systeme/reinitialiser", {
        method: "POST",
        body: JSON.stringify({ motConfirmation: motReinit, raison: raisonReinit.trim() || undefined }),
      }),
    onError: (e) => setErreurReinit(e instanceof Error ? e.message : t("etatSysteme.resetError")),
    // Pas de onSuccess : la déconnexion (tous les comptes viennent de
    // disparaître) est déjà déclenchée par l'événement Socket.io
    // `sessionInvalidee`, reçu par ce même onglet comme par tout autre.
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
          {/* Le disque local du serveur n'est pas garanti persistant (ex. un
              redéploiement peut le réinitialiser) : rappel permanent, pas
              conditionnel — c'est une caractéristique du mécanisme, pas une
              anomalie ponctuelle à corriger. */}
          <p className="flex items-start gap-2 rounded-md border border-or/50 bg-or/10 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-or" />
            {t("etatSysteme.localWarning")}
          </p>
          {sauv && (
            <p className="text-xs text-muted-foreground">
              {t("etatSysteme.localStorageInfo", { repertoire: sauv.repertoireLocal, retention: sauv.retentionLocale })}
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

          {/* Actions de sauvegarde — Admin Principal uniquement (section 3.15).
              Le serveur revérifie : masquer les boutons ne protège rien. */}
          <div className="border-t pt-4">
            {utilisateur?.estAdminPrincipal ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => telechargerLocale.mutate()}
                    disabled={telechargerLocale.isPending || !sauv?.dernierSucces}
                  >
                    {telechargerLocale.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Usb className="h-4 w-4" />
                    )}
                    {telechargerLocale.isPending
                      ? t("etatSysteme.downloading")
                      : t("etatSysteme.downloadLatestLocal")}
                  </Button>
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
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("etatSysteme.downloadLatestLocalHelp")} {t("etatSysteme.downloadHelp")}
                </p>
                {erreurLocale && (
                  <p
                    role="alert"
                    className="mt-2 rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta"
                  >
                    {erreurLocale}
                  </p>
                )}
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

      {/* --- Diagnostic Assistant IA (section 3.19) --------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4 text-or" />
            {t("etatSysteme.iaTitle")}
          </CardTitle>
          <CardDescription>{t("etatSysteme.iaDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Badge
            variant="secondary"
            className={etat?.assistantIaActif ? "border-transparent bg-or text-marine" : undefined}
          >
            {etat?.assistantIaActif ? t("etatSysteme.iaFlagActive") : t("etatSysteme.iaFlagInactive")}
          </Badge>

          <Button variant="outline" onClick={() => diagnosticIA.mutate()} disabled={diagnosticIA.isPending}>
            {diagnosticIA.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
            {diagnosticIA.isPending ? t("etatSysteme.iaTesting") : t("etatSysteme.iaTest")}
          </Button>

          {diagnosticIA.data && (
            <div
              className={
                diagnosticIA.data.ok
                  ? "rounded-md border border-or/50 bg-or/10 px-3 py-2.5 text-sm"
                  : "rounded-md border border-terracotta/40 bg-terracotta/10 px-3 py-2.5 text-sm"
              }
            >
              <p className="flex items-center gap-2 font-medium">
                {diagnosticIA.data.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-or" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-terracotta" />
                )}
                {diagnosticIA.data.ok ? t("etatSysteme.iaSuccess") : t("etatSysteme.iaFailure")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("etatSysteme.iaModel", { modele: diagnosticIA.data.modele })} ·{" "}
                {diagnosticIA.data.cleConfiguree ? t("etatSysteme.iaKeyConfigured") : t("etatSysteme.iaKeyMissing")}
              </p>
              <p className="mt-1.5 whitespace-pre-wrap font-mono text-xs">{diagnosticIA.data.details}</p>
            </div>
          )}

          {diagnosticIA.isError && (
            <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
              {diagnosticIA.error instanceof Error ? diagnosticIA.error.message : t("etatSysteme.iaFailure")}
            </p>
          )}
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

      {/* --- Réinitialisation de la base (section 3.15, nouveau) — Admin Principal uniquement */}
      {utilisateur?.estAdminPrincipal && (
        <Card className="border-terracotta/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-terracotta">
              <Trash2 className="h-4 w-4" />
              {t("etatSysteme.resetTitle")}
            </CardTitle>
            <CardDescription>{t("etatSysteme.resetDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* P0 (30/08/2026) : état RÉEL renvoyé par le serveur, jamais une
                supposition côté écran — une simple désactivation visuelle du
                bouton ne remplacerait pas la garde serveur, mais elle ne doit
                pas non plus la CONTREDIRE en laissant croire que l'action est
                possible alors qu'elle serait refusée. */}
            {etat && !etat.reinitialisation.autorisee && (
              <p
                role="status"
                className="rounded-md border border-terracotta/40 bg-terracotta/10 px-3 py-2 text-sm text-terracotta"
              >
                {etat.reinitialisation.motifIndisponibilite ?? t("etatSysteme.resetUnavailable")}
              </p>
            )}
            <Button
              variant="outline"
              className="border-terracotta text-terracotta hover:bg-terracotta/10 hover:text-terracotta"
              disabled={!etat || !etat.reinitialisation.autorisee}
              onClick={() => {
                setMotReinit("");
                setRaisonReinit("");
                setErreurReinit(null);
                setDialogReinit(true);
              }}
            >
              <Trash2 className="h-4 w-4" />
              {t("etatSysteme.resetButton")}
            </Button>
          </CardContent>
        </Card>
      )}

      {etat && (
        <p className="text-center text-xs text-muted-foreground">
          {t("etatSysteme.measuredAt", {
            time: new Date(dataUpdatedAt || etat.horodatage).toLocaleTimeString(),
          })}
        </p>
      )}

      {/* Dialog réinitialisation — confirmation par saisie exacte du mot, pas un simple clic. */}
      <Dialog open={dialogReinit} onOpenChange={setDialogReinit}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              reinitialiser.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle className="text-terracotta">{t("etatSysteme.resetDialogTitle")}</DialogTitle>
              <DialogDescription>{t("etatSysteme.resetDialogDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <p className="rounded-md border border-terracotta/40 bg-terracotta/10 px-3 py-2 text-sm text-terracotta">
                {t("etatSysteme.resetWarning")}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="reinit-raison">{t("etatSysteme.resetReasonLabel")}</Label>
                <Input id="reinit-raison" value={raisonReinit} onChange={(e) => setRaisonReinit(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reinit-mot">
                  {t("etatSysteme.resetConfirmLabel", { mot: MOT_CONFIRMATION_REINITIALISATION })}
                </Label>
                <Input
                  id="reinit-mot"
                  value={motReinit}
                  onChange={(e) => setMotReinit(e.target.value)}
                  placeholder={MOT_CONFIRMATION_REINITIALISATION}
                  autoComplete="off"
                  required
                />
              </div>
            </div>
            {erreurReinit && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurReinit}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogReinit(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="cta"
                className="bg-terracotta hover:bg-terracotta/90"
                disabled={reinitialiser.isPending || motReinit !== MOT_CONFIRMATION_REINITIALISATION}
              >
                {reinitialiser.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {t("etatSysteme.resetConfirmButton")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
