import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  TYPE_SANCTION_LABELS,
  type BulletinPaieDTO,
  type CalculPaieDTO,
  type SanctionDTO,
  type TravailleurDTO,
  type TypeSanction,
} from "@lomoto/shared";
import { api, ApiError, getToken } from "@/lib/api";
import { useFeedback } from "@/components/FeedbackProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CarteLigne, CarteLigneActions, CarteLigneChamp, CarteLigneTitre } from "@/components/ui/carte-ligne";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(`${iso}T00:00:00`));
}

function formatFc(montant: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(montant)} Fc`;
}

function moisCourant(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Sanctions & calcul de paie (section 3.18, nouveau). Card autonome montée
 * sur la page Travailleurs, sur le même modèle que DepartementsCard.
 */
export function PaieCard({ travailleurs, editable }: { travailleurs: TravailleurDTO[]; editable: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { confirmer, toastErreur } = useFeedback();

  // --- Sanctions ---------------------------------------------------------
  const [filtreTravailleurSanction, setFiltreTravailleurSanction] = useState("");

  const { data: sanctionsData } = useQuery({
    queryKey: ["sanctions", filtreTravailleurSanction],
    queryFn: () =>
      api<{ sanctions: SanctionDTO[] }>(
        `/api/travailleurs/sanctions${filtreTravailleurSanction ? `?travailleurId=${filtreTravailleurSanction}` : ""}`,
      ),
  });
  const sanctions = sanctionsData?.sanctions ?? [];

  const [dialogSanction, setDialogSanction] = useState(false);
  const [snTravailleurId, setSnTravailleurId] = useState("");
  const [snType, setSnType] = useState<TypeSanction>("PUNITION");
  const [snMotif, setSnMotif] = useState("");
  const [snDate, setSnDate] = useState(new Date().toISOString().slice(0, 10));
  const [snMontant, setSnMontant] = useState("");
  const [erreurSanction, setErreurSanction] = useState<string | null>(null);

  function ouvrirNouvelleSanction() {
    setSnTravailleurId(travailleurs[0]?.id ?? "");
    setSnType("PUNITION");
    setSnMotif("");
    setSnDate(new Date().toISOString().slice(0, 10));
    setSnMontant("");
    setErreurSanction(null);
    setDialogSanction(true);
  }

  const rafraichirSanctions = () => {
    queryClient.invalidateQueries({ queryKey: ["sanctions"] });
    queryClient.invalidateQueries({ queryKey: ["paie"] });
  };

  const declarerSanction = useMutation({
    mutationFn: () =>
      api("/api/travailleurs/sanctions", {
        method: "POST",
        body: JSON.stringify({
          travailleurId: snTravailleurId,
          type: snType,
          motif: snMotif.trim(),
          date: snDate,
          montant: snType === "RETENUE" ? Number(snMontant) : undefined,
        }),
      }),
    onSuccess: () => {
      setDialogSanction(false);
      rafraichirSanctions();
    },
    onError: (e) => setErreurSanction(e instanceof Error ? e.message : t("travailleurs.saveError")),
  });

  const supprimerSanction = useMutation({
    mutationFn: (id: string) => api(`/api/travailleurs/sanctions/${id}`, { method: "DELETE" }),
    onSuccess: rafraichirSanctions,
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("travailleurs.deleteError")),
  });

  // --- Calcul de paie ------------------------------------------------------
  const [paieTravailleurId, setPaieTravailleurId] = useState("");
  const [paieMois, setPaieMois] = useState(moisCourant());

  const { data: paieData, error: paieErreur } = useQuery({
    queryKey: ["paie", paieTravailleurId, paieMois],
    queryFn: () => api<{ paie: CalculPaieDTO }>(`/api/travailleurs/${paieTravailleurId}/paie?mois=${paieMois}`),
    enabled: !!paieTravailleurId && !!paieMois,
    retry: false,
  });
  const paie = paieData?.paie ?? null;
  const messageErreurPaie = paieErreur instanceof ApiError ? paieErreur.message : null;

  // --- Bulletins de paie (instantané figé, 3.18) ----------------------------
  const { data: bulletinsData } = useQuery({
    queryKey: ["bulletinsPaie", paieTravailleurId],
    queryFn: () => api<{ bulletins: BulletinPaieDTO[] }>(`/api/travailleurs/${paieTravailleurId}/bulletins-paie`),
    enabled: !!paieTravailleurId,
  });
  const bulletins = bulletinsData?.bulletins ?? [];

  const genererBulletin = useMutation({
    mutationFn: () => api(`/api/travailleurs/${paieTravailleurId}/bulletins-paie?mois=${paieMois}`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bulletinsPaie", paieTravailleurId] }),
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("travailleurs.saveError")),
  });

  // Le PDF revient en binaire : fetch direct + Authorization manuel plutôt
  // que le helper JSON (même pattern que BarreExport.tsx).
  const telechargerBulletin = useMutation({
    mutationFn: async (bulletinId: string) => {
      const res = await fetch(`/api/travailleurs/bulletins-paie/${bulletinId}/pdf`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        const corps = await res.json().catch(() => null);
        throw new Error(corps?.erreur ?? t("travailleurs.paiePdfError"));
      }
      const blob = await res.blob();
      const nom = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "bulletin-paie.pdf";
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = nom;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("travailleurs.paiePdfError")),
  });

  return (
    <>
      {/* Sanctions */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>{t("travailleurs.sanctionsTitle")}</CardTitle>
            <CardDescription>{t("travailleurs.sanctionsDesc")}</CardDescription>
          </div>
          {editable && (
            <Button variant="outline" size="sm" onClick={ouvrirNouvelleSanction} disabled={travailleurs.length === 0}>
              <Plus className="h-4 w-4" />
              {t("travailleurs.newSanction")}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="w-full sm:w-56">
            <Label htmlFor="filtre-sanction-travailleur">{t("travailleurs.worker")}</Label>
            <NativeSelect
              id="filtre-sanction-travailleur"
              value={filtreTravailleurSanction}
              onChange={(e) => setFiltreTravailleurSanction(e.target.value)}
            >
              <option value="">{t("travailleurs.filterAll")}</option>
              {travailleurs.map((trav) => (
                <option key={trav.id} value={trav.id}>
                  {trav.nom}
                </option>
              ))}
            </NativeSelect>
          </div>

          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("travailleurs.worker")}</TableHead>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("travailleurs.sanctionType")}</TableHead>
                <TableHead>{t("travailleurs.colMotive")}</TableHead>
                <TableHead>{t("travailleurs.sanctionAmount")}</TableHead>
                <TableHead>{t("travailleurs.colRecordedBy")}</TableHead>
                {editable && <TableHead className="text-right">{t("common.actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sanctions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.travailleur.nom}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(s.date)}</TableCell>
                  <TableCell>
                    <Badge variant={s.type === "RETENUE" ? "outline" : "gold"}>{TYPE_SANCTION_LABELS[s.type]}</Badge>
                  </TableCell>
                  <TableCell className="max-w-xs text-muted-foreground">{s.motif}</TableCell>
                  <TableCell className="whitespace-nowrap">{s.montant != null ? formatFc(s.montant) : "—"}</TableCell>
                  <TableCell className="text-sm">{s.enregistrePar?.nom ?? "—"}</TableCell>
                  {editable && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={async () => {
                          if (await confirmer({ description: t("travailleurs.confirmDeleteSanction"), destructive: true }))
                            supprimerSanction.mutate(s.id);
                        }}
                        aria-label={t("travailleurs.ariaDeleteSanction")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {sanctions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={editable ? 7 : 6} className="py-8 text-center text-muted-foreground">
                    {t("travailleurs.emptySanction")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="space-y-2 md:hidden">
            {sanctions.map((s) => (
              <CarteLigne key={s.id}>
                <CarteLigneTitre>
                  <span>{s.travailleur.nom}</span>
                  <Badge variant={s.type === "RETENUE" ? "outline" : "gold"}>{TYPE_SANCTION_LABELS[s.type]}</Badge>
                </CarteLigneTitre>
                <CarteLigneChamp label={t("common.date")} value={formatDate(s.date)} />
                <CarteLigneChamp label={t("travailleurs.colMotive")} value={s.motif} />
                <CarteLigneChamp label={t("travailleurs.sanctionAmount")} value={s.montant != null ? formatFc(s.montant) : "—"} />
                {editable && (
                  <CarteLigneActions>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-terracotta hover:text-terracotta"
                      onClick={async () => {
                        if (await confirmer({ description: t("travailleurs.confirmDeleteSanction"), destructive: true }))
                          supprimerSanction.mutate(s.id);
                      }}
                      aria-label={t("travailleurs.ariaDeleteSanction")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </CarteLigneActions>
                )}
              </CarteLigne>
            ))}
            {sanctions.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{t("travailleurs.emptySanction")}</p>}
          </div>
        </CardContent>
      </Card>

      {/* Calcul de paie */}
      <Card>
        <CardHeader>
          <CardTitle>{t("travailleurs.paieTitle")}</CardTitle>
          <CardDescription>{t("travailleurs.paieDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-56">
              <Label htmlFor="paie-travailleur">{t("travailleurs.worker")}</Label>
              <NativeSelect id="paie-travailleur" value={paieTravailleurId} onChange={(e) => setPaieTravailleurId(e.target.value)}>
                <option value="">{t("travailleurs.paieSelectWorker")}</option>
                {travailleurs.map((trav) => (
                  <option key={trav.id} value={trav.id}>
                    {trav.nom}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="paie-mois">{t("travailleurs.paieMonth")}</Label>
              <Input id="paie-mois" type="month" value={paieMois} onChange={(e) => setPaieMois(e.target.value)} />
            </div>
          </div>

          {!paieTravailleurId && <p className="text-sm text-muted-foreground">{t("travailleurs.paieSelectWorker")}</p>}

          {paieTravailleurId && messageErreurPaie && (
            <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
              {messageErreurPaie}
            </p>
          )}

          {paie && (
            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{t("travailleurs.paieBase")}</span>
                <span className="font-medium">{formatFc(paie.salaireMensuel)}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{t("travailleurs.paieDailyRate", { jours: paie.joursTravaillesParMois })}</span>
                <span>{formatFc(paie.tauxJournalier)}</span>
              </div>

              <div className="border-t border-border pt-3">
                <p className="text-sm font-medium text-marine dark:text-creme">
                  {t("travailleurs.paieAbsencesTitle", { count: paie.absencesNonJustifiees.length })}
                </p>
                {paie.absencesNonJustifiees.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("travailleurs.paieNoAbsences")}</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                    {paie.absencesNonJustifiees.map((a) => (
                      <li key={a.absenceId} className="flex items-center justify-between gap-2">
                        <span>
                          {formatDate(a.date)} — {a.motif}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span>{t("travailleurs.paieAbsencesRetenue")}</span>
                  <span className="text-terracotta">− {formatFc(paie.retenueAbsences)}</span>
                </div>
              </div>

              <div className="border-t border-border pt-3">
                <p className="text-sm font-medium text-marine dark:text-creme">
                  {t("travailleurs.paieSanctionsTitle", { count: paie.sanctionsRetenues.length })}
                </p>
                {paie.sanctionsRetenues.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("travailleurs.paieNoSanctions")}</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                    {paie.sanctionsRetenues.map((s) => (
                      <li key={s.sanctionId} className="flex items-center justify-between gap-2">
                        <span>
                          {formatDate(s.date)} — {s.motif}
                        </span>
                        <span>{formatFc(s.montant)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-1 flex items-center justify-between text-sm">
                  <span>{t("travailleurs.paieSanctionsRetenue")}</span>
                  <span className="text-terracotta">− {formatFc(paie.totalRetenuesDisciplinaires)}</span>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-or/50 pt-3 text-base font-semibold">
                <span className="text-marine dark:text-creme">{t("travailleurs.paieNet")}</span>
                <span className="text-terracotta dark:text-or">{formatFc(paie.salaireNet)}</span>
              </div>

              {editable && (
                <Button
                  type="button"
                  variant="cta"
                  size="sm"
                  onClick={() => genererBulletin.mutate()}
                  disabled={genererBulletin.isPending}
                >
                  <FileText className="h-4 w-4" />
                  {t("travailleurs.generateBulletin")}
                </Button>
              )}
            </div>
          )}

          {/* Bulletins déjà émis pour le travailleur sélectionné (tous mois confondus) —
              chacun est un instantané figé, jamais modifié par un calcul ultérieur. */}
          {paieTravailleurId && (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm font-medium text-marine dark:text-creme">{t("travailleurs.bulletinsIssued")}</p>
              {bulletins.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("travailleurs.noBulletins")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {bulletins.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                      <span>
                        {b.mois} — {formatFc(b.salaireNet)}{" "}
                        <span className="text-muted-foreground">
                          ({t("travailleurs.generatedOn", { date: formatDate(b.dateGeneration.slice(0, 10)) })})
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => telechargerBulletin.mutate(b.id)}
                        disabled={telechargerBulletin.isPending}
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t("common.download")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog sanction */}
      <Dialog open={dialogSanction} onOpenChange={setDialogSanction}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              declarerSanction.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("travailleurs.newSanction")}</DialogTitle>
              <DialogDescription>{t("travailleurs.sanctionDialogDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sn-travailleur">{t("travailleurs.worker")}</Label>
                  <NativeSelect id="sn-travailleur" value={snTravailleurId} onChange={(e) => setSnTravailleurId(e.target.value)} required>
                    {travailleurs.map((trav) => (
                      <option key={trav.id} value={trav.id}>
                        {trav.nom}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sn-date">{t("common.date")}</Label>
                  <Input id="sn-date" type="date" value={snDate} onChange={(e) => setSnDate(e.target.value)} required />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("travailleurs.sanctionType")}</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["PUNITION", "RETENUE"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setSnType(type)}
                      className={
                        snType === type
                          ? "rounded-lg border border-or bg-or/15 p-2 text-sm font-medium text-terracotta dark:text-or"
                          : "rounded-lg border border-input p-2 text-sm font-medium text-muted-foreground hover:bg-secondary"
                      }
                    >
                      {TYPE_SANCTION_LABELS[type]}
                    </button>
                  ))}
                </div>
              </div>
              {snType === "RETENUE" && (
                <div className="space-y-1.5">
                  <Label htmlFor="sn-montant">{t("travailleurs.sanctionAmount")}</Label>
                  <Input
                    id="sn-montant"
                    type="number"
                    min={1}
                    step={1}
                    value={snMontant}
                    onChange={(e) => setSnMontant(e.target.value)}
                    placeholder="15000"
                    required
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="sn-motif">{t("travailleurs.colMotive")}</Label>
                <Textarea id="sn-motif" value={snMotif} onChange={(e) => setSnMotif(e.target.value)} required maxLength={500} />
              </div>
            </div>
            {erreurSanction && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurSanction}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogSanction(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={declarerSanction.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
