import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Printer, Save, Truck } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { BonLivraisonClientDTO, BonLivraisonJourDTO, SchemaCommandeJourDTO, ZoneDepositaireDTO } from "@lomoto/shared";
import { api, getToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useFeedback } from "@/components/FeedbackProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CarteLigne, CarteLigneChamp, CarteLigneTitre } from "@/components/ui/carte-ligne";
import { EtatChargement, EtatErreur, EtatVide } from "@/components/ui/etats";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EtapesCycleLivraison } from "@/components/previsions/EtapesCycleLivraison";
import { calculerEcartQuantite } from "@/components/previsions/cycleLivraisonLogique";

const jourISO = (d: Date) => d.toISOString().slice(0, 10);
const nombre = (v: string) => (v.trim() === "" ? 0 : Number(v));

const cleChamp = (clientId: string, champ: string) => `${clientId}:${champ}`;

/** Valeur affichée dans une cellule : l'édition locale si présente, sinon la valeur serveur. */
function valeurChamp(editions: Record<string, string>, clientId: string, champ: string, valeurServeur: string): string {
  const cle = cleChamp(clientId, champ);
  return cle in editions ? editions[cle] : valeurServeur;
}

/**
 * Écart par produit (F4 round 1) : rend l'écart lisible client PAR client ET
 * PAR produit, en plus du total déjà fourni par le serveur. `prevu` vient du
 * Schéma de commande de la même date (lecture seule, aucun auto-remplissage).
 * N'affiche rien tant que le Schéma n'est pas chargé, pour ne jamais laisser
 * croire à un écart nul par défaut de données.
 */
function EcartProduit({ prevu, livre, schemaChargee, t }: { prevu: number; livre: number; schemaChargee: boolean; t: (k: string, o?: Record<string, unknown>) => string }) {
  if (!schemaChargee) return null;
  const ecart = calculerEcartQuantite({ quantitePrevue: prevu, quantiteConstatee: livre });
  if (ecart === 0) return null;
  return (
    <span
      className={cn(
        "ml-1 inline-block text-[10px] font-semibold",
        ecart > 0 ? "text-or dark:text-or" : "text-terracotta",
      )}
      title={t("bonsLivraison.gapProductTooltip", { prevu, livre })}
      aria-label={t("bonsLivraison.gapProductTooltip", { prevu, livre })}
    >
      {ecart > 0 ? `+${ecart}` : ecart}
    </span>
  );
}

/**
 * Sous-module de Production (3.3 e) : digitalise le Bon de livraison papier —
 * quantités livrées par produit, bacs vides repris, observations, pour
 * chaque Dépositaire. Saisie volontairement indépendante du Schéma de
 * commande (pas d'auto-remplissage) : la quantité livrée peut différer de la
 * quantité commandée. Écran à part pour ne pas encombrer /production.
 */
export function BonsLivraisonPage() {
  const { peutEcrire } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toastErreur } = useFeedback();
  const editable = peutEcrire("PRODUCTION");

  const [date, setDate] = useState(jourISO(new Date()));
  const {
    data: jourData,
    isLoading: chargementJour,
    isError: erreurJourQuery,
    error: erreurJourDetail,
    refetch: rechargerJour,
  } = useQuery({
    queryKey: ["bons-livraison", date],
    queryFn: () => api<BonLivraisonJourDTO>(`/api/production/bons-livraison?date=${date}`),
  });
  const { data: zonesData } = useQuery({
    queryKey: ["zones-depositaires"],
    queryFn: () => api<{ zones: ZoneDepositaireDTO[] }>("/api/zones-depositaires"),
  });
  const zones = zonesData?.zones ?? [];

  // Réutilise le Schéma de commande (même endpoint que Production.tsx, F4
  // round 1 — aucune route inventée) pour rendre l'écart lisible PAR CLIENT
  // ET PAR PRODUIT, en plus de l'écart total déjà fourni par le serveur
  // (`c.totalCommande`). Saisie du Bon de livraison volontairement
  // indépendante malgré cette lecture : rien n'est jamais pré-rempli à partir
  // du Schéma ici.
  const { data: schemaData } = useQuery({
    queryKey: ["schema-commande", date],
    queryFn: () => api<SchemaCommandeJourDTO>(`/api/production/schema-commande?date=${date}`),
  });
  const prevuParClientProduit = useMemo(() => {
    const carte = new Map<string, number>();
    for (const c of schemaData?.clients ?? []) {
      for (const l of c.lignes) {
        carte.set(`${c.clientId}:${l.produitId}`, l.quantite);
      }
    }
    return carte;
  }, [schemaData]);

  const [editions, setEditions] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    setEditions({});
    setErreur(null);
  }, [date]);

  const produitsLivraison = jourData?.totauxParProduit ?? [];
  const clients = jourData?.clients ?? [];

  const groupesZones = useMemo(() => {
    const parZone = new Map<string, BonLivraisonClientDTO[]>();
    for (const c of clients) {
      const cle = c.zoneDepositaireId ?? "__sans_zone__";
      if (!parZone.has(cle)) parZone.set(cle, []);
      parZone.get(cle)!.push(c);
    }
    const groupes = zones
      .filter((z) => parZone.has(z.id))
      .map((z) => ({ id: z.id, nom: z.nom, clients: parZone.get(z.id)! }));
    const sansZone = parZone.get("__sans_zone__");
    if (sansZone) groupes.push({ id: "__sans_zone__", nom: t("bonsLivraison.noZone"), clients: sansZone });
    return groupes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, zones, t]);

  const totalGeneralLive = useMemo(
    () =>
      clients.reduce(
        (s, c) =>
          s +
          c.lignes.reduce((sl, l) => sl + nombre(valeurChamp(editions, c.clientId, l.produitId, String(l.quantite || ""))), 0),
        0,
      ),
    [clients, editions],
  );
  const totalBacsVidesLive = useMemo(
    () =>
      clients.reduce((s, c) => s + nombre(valeurChamp(editions, c.clientId, "bacsVides", String(c.bacsVides || ""))), 0),
    [clients, editions],
  );

  const enregistrer = useMutation({
    mutationFn: () => {
      const corpsClients = clients.map((c) => ({
        clientId: c.clientId,
        lignes: c.lignes.map((l) => ({
          produitId: l.produitId,
          quantite: nombre(valeurChamp(editions, c.clientId, l.produitId, String(l.quantite || ""))),
        })),
        bacsVides: nombre(valeurChamp(editions, c.clientId, "bacsVides", String(c.bacsVides || ""))),
        livrePar: valeurChamp(editions, c.clientId, "livrePar", c.livrePar ?? "").trim() || undefined,
        observations: valeurChamp(editions, c.clientId, "observations", c.observations ?? "").trim() || undefined,
      }));
      return api<BonLivraisonJourDTO>("/api/production/bons-livraison", {
        method: "PUT",
        body: JSON.stringify({ date, clients: corpsClients }),
      });
    },
    onSuccess: (r) => {
      queryClient.setQueryData(["bons-livraison", date], r);
      setEditions({});
    },
    onError: (e) => setErreur(e instanceof Error ? e.message : t("bonsLivraison.saveError")),
  });

  const imprimer = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/production/bons-livraison/pdf?date=${date}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const corps = await res.json().catch(() => null);
        throw new Error(corps?.erreur ?? t("bonsLivraison.printError"));
      }
      const blob = await res.blob();
      const nom = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "bons-de-livraison.pdf";
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = nom;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("bonsLivraison.printError")),
  });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link
          to="/production"
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-marine dark:hover:text-creme"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("bonsLivraison.backToProduction")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-serif text-3xl font-bold text-marine dark:text-creme">
              <Truck className="h-7 w-7 text-or" />
              {t("bonsLivraison.title")}
            </h1>
            <p className="mt-1 text-muted-foreground">{t("bonsLivraison.desc")}</p>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <Label htmlFor="date-livraison">{t("common.date")}</Label>
            <Input id="date-livraison" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => imprimer.mutate()} disabled={imprimer.isPending}>
              <Printer className="h-4 w-4" />
              {t("bonsLivraison.print")}
            </Button>
            {editable && (
              <Button variant="cta" onClick={() => enregistrer.mutate()} disabled={enregistrer.isPending}>
                <Save className="h-4 w-4" />
                {t("common.save")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Légende du cycle (F4 round 1) : rappelle que la quantité saisie ici
              correspond à l'étape « Déposé », pas encore à une acceptation
              client — les étapes suivantes attendent le contrat serveur C4. */}
          <div className="rounded-lg border border-dashed p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("bonsLivraison.cycleLegendTitle")}
            </p>
            <EtapesCycleLivraison etapeActive="depose" className="mb-2" />
            <p className="text-xs text-muted-foreground">{t("bonsLivraison.cyclePendingNote")}</p>
          </div>

          {chargementJour ? (
            <EtatChargement message={t("bonsLivraison.loading")} />
          ) : erreurJourQuery ? (
            <EtatErreur
              message={erreurJourDetail instanceof Error ? erreurJourDetail.message : undefined}
              onReessayer={() => rechargerJour()}
            />
          ) : produitsLivraison.length === 0 ? (
            <EtatVide description={t("bonsLivraison.noProducts")} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table className="hidden md:table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("bonsLivraison.colDepositaire")}</TableHead>
                      {produitsLivraison.map((p) => (
                        <TableHead key={p.produitId} className="text-right">
                          {p.produitNom}
                        </TableHead>
                      ))}
                      <TableHead className="text-right">{t("bonsLivraison.colTotal")}</TableHead>
                      <TableHead className="text-right">{t("bonsLivraison.colEmptyCrates")}</TableHead>
                      <TableHead>{t("bonsLivraison.colDeliveredBy")}</TableHead>
                      <TableHead>{t("bonsLivraison.colObs")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {groupesZones.map((groupe) => (
                      <Fragment key={groupe.id}>
                        <TableRow className="bg-secondary/50 hover:bg-secondary/50">
                          <TableCell
                            colSpan={produitsLivraison.length + 4}
                            className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            {groupe.nom}
                          </TableCell>
                        </TableRow>
                        {groupe.clients.map((c) => {
                          const total = c.lignes.reduce(
                            (s, l) => s + nombre(valeurChamp(editions, c.clientId, l.produitId, String(l.quantite || ""))),
                            0,
                          );
                          return (
                            <TableRow key={c.clientId}>
                              <TableCell className="whitespace-nowrap font-medium">{c.clientNom}</TableCell>
                              {c.lignes.map((l) => {
                                const livreProduit = nombre(
                                  valeurChamp(editions, c.clientId, l.produitId, String(l.quantite || "")),
                                );
                                const prevuProduit = prevuParClientProduit.get(`${c.clientId}:${l.produitId}`) ?? 0;
                                return (
                                  <TableCell key={l.produitId} className="text-right">
                                    <Input
                                      type="number"
                                      min={0}
                                      disabled={!editable}
                                      value={valeurChamp(editions, c.clientId, l.produitId, String(l.quantite || ""))}
                                      onChange={(e) =>
                                        setEditions((prev) => ({
                                          ...prev,
                                          [cleChamp(c.clientId, l.produitId)]: e.target.value,
                                        }))
                                      }
                                      className="ml-auto w-16 text-right"
                                    />
                                    <EcartProduit
                                      prevu={prevuProduit}
                                      livre={livreProduit}
                                      schemaChargee={schemaData !== undefined}
                                      t={t}
                                    />
                                  </TableCell>
                                );
                              })}
                              <TableCell className="text-right font-semibold">
                                {total}
                                {total !== c.totalCommande && (
                                  <Badge
                                    className="ml-2 border-transparent bg-terracotta text-creme"
                                    title={t("bonsLivraison.gapTooltip", { commande: c.totalCommande, livre: total })}
                                  >
                                    {total - c.totalCommande > 0 ? `+${total - c.totalCommande}` : total - c.totalCommande}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  min={0}
                                  disabled={!editable}
                                  value={valeurChamp(editions, c.clientId, "bacsVides", String(c.bacsVides || ""))}
                                  onChange={(e) =>
                                    setEditions((prev) => ({ ...prev, [cleChamp(c.clientId, "bacsVides")]: e.target.value }))
                                  }
                                  className="ml-auto w-16 text-right"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  disabled={!editable}
                                  value={valeurChamp(editions, c.clientId, "livrePar", c.livrePar ?? "")}
                                  onChange={(e) =>
                                    setEditions((prev) => ({ ...prev, [cleChamp(c.clientId, "livrePar")]: e.target.value }))
                                  }
                                  className="w-32"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  disabled={!editable}
                                  value={valeurChamp(editions, c.clientId, "observations", c.observations ?? "")}
                                  onChange={(e) =>
                                    setEditions((prev) => ({ ...prev, [cleChamp(c.clientId, "observations")]: e.target.value }))
                                  }
                                  className="w-40"
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </Fragment>
                    ))}
                    {groupesZones.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={produitsLivraison.length + 4} className="py-6 text-center text-muted-foreground">
                          {t("bonsLivraison.noDepositaires")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Vue mobile (F4 round 1) : ce sous-module en manquait, à la
                  différence des autres écrans de Production/Commandes. */}
              <div className="space-y-4 md:hidden">
                {groupesZones.map((groupe) => (
                  <div key={groupe.id} className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{groupe.nom}</p>
                    {groupe.clients.map((c) => {
                      const total = c.lignes.reduce(
                        (s, l) => s + nombre(valeurChamp(editions, c.clientId, l.produitId, String(l.quantite || ""))),
                        0,
                      );
                      return (
                        <CarteLigne key={c.clientId}>
                          <CarteLigneTitre>
                            <span>{c.clientNom}</span>
                            <span className="flex items-center gap-1 font-semibold">
                              {t("bonsLivraison.colTotal")} : {total}
                              {total !== c.totalCommande && (
                                <Badge
                                  className="border-transparent bg-terracotta text-creme"
                                  title={t("bonsLivraison.gapTooltip", { commande: c.totalCommande, livre: total })}
                                >
                                  {total - c.totalCommande > 0 ? `+${total - c.totalCommande}` : total - c.totalCommande}
                                </Badge>
                              )}
                            </span>
                          </CarteLigneTitre>
                          {c.lignes.map((l) => {
                            const livreProduit = nombre(valeurChamp(editions, c.clientId, l.produitId, String(l.quantite || "")));
                            const prevuProduit = prevuParClientProduit.get(`${c.clientId}:${l.produitId}`) ?? 0;
                            return (
                              <CarteLigneChamp
                                key={l.produitId}
                                label={l.produitNom}
                                value={
                                  <span className="inline-flex items-center">
                                    <Input
                                      type="number"
                                      min={0}
                                      disabled={!editable}
                                      value={valeurChamp(editions, c.clientId, l.produitId, String(l.quantite || ""))}
                                      onChange={(e) =>
                                        setEditions((prev) => ({
                                          ...prev,
                                          [cleChamp(c.clientId, l.produitId)]: e.target.value,
                                        }))
                                      }
                                      className="w-16 text-right"
                                    />
                                    <EcartProduit
                                      prevu={prevuProduit}
                                      livre={livreProduit}
                                      schemaChargee={schemaData !== undefined}
                                      t={t}
                                    />
                                  </span>
                                }
                              />
                            );
                          })}
                          <CarteLigneChamp
                            label={t("bonsLivraison.colEmptyCrates")}
                            value={
                              <Input
                                type="number"
                                min={0}
                                disabled={!editable}
                                value={valeurChamp(editions, c.clientId, "bacsVides", String(c.bacsVides || ""))}
                                onChange={(e) =>
                                  setEditions((prev) => ({ ...prev, [cleChamp(c.clientId, "bacsVides")]: e.target.value }))
                                }
                                className="w-16 text-right"
                              />
                            }
                          />
                          <CarteLigneChamp
                            label={t("bonsLivraison.colDeliveredBy")}
                            value={
                              <Input
                                disabled={!editable}
                                value={valeurChamp(editions, c.clientId, "livrePar", c.livrePar ?? "")}
                                onChange={(e) =>
                                  setEditions((prev) => ({ ...prev, [cleChamp(c.clientId, "livrePar")]: e.target.value }))
                                }
                                className="w-32"
                              />
                            }
                          />
                          <CarteLigneChamp
                            label={t("bonsLivraison.colObs")}
                            value={
                              <Input
                                disabled={!editable}
                                value={valeurChamp(editions, c.clientId, "observations", c.observations ?? "")}
                                onChange={(e) =>
                                  setEditions((prev) => ({ ...prev, [cleChamp(c.clientId, "observations")]: e.target.value }))
                                }
                                className="w-40"
                              />
                            }
                          />
                        </CarteLigne>
                      );
                    })}
                  </div>
                ))}
                {groupesZones.length === 0 && (
                  <p className="py-6 text-center text-sm text-muted-foreground">{t("bonsLivraison.noDepositaires")}</p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 border-t pt-4 text-sm">
                <span className="font-semibold text-marine dark:text-creme">
                  {t("bonsLivraison.totalGeneral", { total: totalGeneralLive })}
                </span>
                <span className="text-muted-foreground">
                  {t("bonsLivraison.totalEmptyCrates", { total: totalBacsVidesLive })}
                </span>
              </div>
              {erreur && (
                <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                  {erreur}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
