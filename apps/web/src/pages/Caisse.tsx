import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Banknote, Lock, Minus, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  formatFc,
  ROLE_DIRECTEUR_GENERAL,
  type ClotureCaisseDTO,
  type ProduitDTO,
  type VenteDTO,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

function formatHeure(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" }).format(new Date(iso));
}

interface LignePanier {
  produit: ProduitDTO;
  quantite: number;
}

export function CaissePage() {
  const { peutEcrire, utilisateur } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editable = peutEcrire("CAISSE");
  // Le DG — et lui seul — peut annuler une vente frauduleuse (section 3.1).
  const estDG = utilisateur?.role.nom === ROLE_DIRECTEUR_GENERAL;

  const { data: produitsData } = useQuery({
    queryKey: ["produits"],
    queryFn: () => api<{ produits: ProduitDTO[] }>("/api/produits"),
  });
  const { data: ventesData } = useQuery({
    queryKey: ["ventes", "ouvertes"],
    queryFn: () => api<{ ventes: VenteDTO[] }>("/api/caisse/ventes?ouvertes=1"),
  });
  const { data: cloturesData } = useQuery({
    queryKey: ["clotures"],
    queryFn: () => api<{ clotures: ClotureCaisseDTO[] }>("/api/caisse/clotures"),
  });

  // --- Panier --------------------------------------------------------------
  const [panier, setPanier] = useState<LignePanier[]>([]);
  // Paiement en espèces uniquement (décision métier, 3.1) : plus de mobile
  // money / carte proposés à l'encaissement.
  const moyenPaiement = "ESPECES" as const;
  const [erreur, setErreur] = useState<string | null>(null);
  const [confirmationVente, setConfirmationVente] = useState<string | null>(null);

  const totaux = useMemo(() => {
    const total = panier.reduce((s, l) => s + l.produit.prixVente * l.quantite, 0);
    const taxe = panier.reduce(
      (s, l) => s + Math.round((l.produit.prixVente * l.quantite * l.produit.tauxTaxe) / 100),
      0,
    );
    return { total, taxe };
  }, [panier]);

  function ajouter(produit: ProduitDTO) {
    setConfirmationVente(null);
    setPanier((prev) => {
      const existante = prev.find((l) => l.produit.id === produit.id);
      if (existante) {
        return prev.map((l) => (l.produit.id === produit.id ? { ...l, quantite: l.quantite + 1 } : l));
      }
      return [...prev, { produit, quantite: 1 }];
    });
  }

  function changerQuantite(produitId: string, delta: number) {
    setPanier((prev) =>
      prev
        .map((l) => (l.produit.id === produitId ? { ...l, quantite: l.quantite + delta } : l))
        .filter((l) => l.quantite > 0),
    );
  }

  const encaisser = useMutation({
    mutationFn: () =>
      api<{ vente: VenteDTO }>("/api/caisse/ventes", {
        method: "POST",
        body: JSON.stringify({
          moyenPaiement,
          lignes: panier.map((l) => ({ produitId: l.produit.id, quantite: l.quantite })),
        }),
      }),
    onSuccess: (r) => {
      setPanier([]);
      setErreur(null);
      setConfirmationVente(t("caisse.saleConfirmed", { numero: r.vente.numero, montant: formatFc(r.vente.total) }));
      queryClient.invalidateQueries({ queryKey: ["ventes"] });
    },
    onError: (e) => setErreur(e instanceof Error ? e.message : t("caisse.checkoutError")),
  });

  // --- Clôture -------------------------------------------------------------
  const [dialogCloture, setDialogCloture] = useState(false);
  const cloturer = useMutation({
    mutationFn: () => api<{ cloture: ClotureCaisseDTO }>("/api/caisse/cloture", { method: "POST" }),
    onSuccess: () => {
      setDialogCloture(false);
      queryClient.invalidateQueries({ queryKey: ["ventes"] });
      queryClient.invalidateQueries({ queryKey: ["clotures"] });
    },
    onError: (e) => setErreur(e instanceof Error ? e.message : t("caisse.closeError")),
  });

  // --- Annulation d'une vente par le DG (3.1) ------------------------------
  const [venteAAnnuler, setVenteAAnnuler] = useState<VenteDTO | null>(null);
  const [motifAnnulation, setMotifAnnulation] = useState("");
  const [erreurAnnulation, setErreurAnnulation] = useState<string | null>(null);

  const annuler = useMutation({
    mutationFn: (id: string) =>
      api<{ vente: VenteDTO }>(`/api/caisse/ventes/${id}/annulation`, {
        method: "POST",
        body: JSON.stringify({ motif: motifAnnulation.trim() }),
      }),
    onSuccess: () => {
      setVenteAAnnuler(null);
      setMotifAnnulation("");
      setErreurAnnulation(null);
      queryClient.invalidateQueries({ queryKey: ["ventes"] });
    },
    onError: (e) => setErreurAnnulation(e instanceof Error ? e.message : t("caisse.cancelError")),
  });

  const ventesOuvertes = ventesData?.ventes ?? [];
  // Le CA du jour exclut les ventes annulées (3.1).
  const totalJournee = ventesOuvertes.reduce((s, v) => s + (v.statut === "ANNULEE" ? 0 : v.total), 0);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("caisse.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("caisse.subtitle")}</p>
        </div>
        {editable && (
          <Button
            variant="outline"
            onClick={() => setDialogCloture(true)}
            disabled={ventesOuvertes.length === 0}
          >
            <Lock className="h-4 w-4" />
            {t("caisse.closeRegister")}
          </Button>
        )}
      </div>

      {editable && (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          {/* Produits */}
          <Card>
            <CardHeader>
              <CardTitle>{t("caisse.products")}</CardTitle>
              <CardDescription>{t("caisse.productsHelp")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {produitsData?.produits
                  .filter((p) => p.actif)
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => ajouter(p)}
                      className="rounded-xl border border-beige/60 bg-creme p-3 text-left shadow-sm transition-all hover:border-or hover:shadow dark:bg-secondary"
                    >
                      <p className="text-sm font-semibold leading-tight">{p.nom}</p>
                      <p className="mt-1 text-sm font-bold text-terracotta dark:text-or">{formatFc(p.prixVente)}</p>
                    </button>
                  ))}
              </div>
            </CardContent>
          </Card>

          {/* Panier */}
          <Card className="border-or/40">
            <CardHeader>
              <CardTitle>{t("caisse.cart")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {panier.length === 0 && !confirmationVente && (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("caisse.cartEmpty")}</p>
              )}
              {confirmationVente && panier.length === 0 && (
                <p className="rounded-md bg-or/10 px-3 py-2 text-center text-sm font-medium text-terracotta dark:text-or">
                  ✓ {confirmationVente}
                </p>
              )}
              {panier.map((l) => (
                <div key={l.produit.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.produit.nom}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFc(l.produit.prixVente)} × {l.quantite} = {formatFc(l.produit.prixVente * l.quantite)}
                    </p>
                  </div>
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => changerQuantite(l.produit.id, -1)} aria-label={t("caisse.ariaDecrease")}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-6 text-center text-sm font-semibold">{l.quantite}</span>
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => changerQuantite(l.produit.id, 1)} aria-label={t("caisse.ariaIncrease")}>
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-terracotta hover:text-terracotta"
                    onClick={() => changerQuantite(l.produit.id, -l.quantite)}
                    aria-label={t("caisse.ariaRemove", { nom: l.produit.nom })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}

              {panier.length > 0 && (
                <>
                  <div className="space-y-1 border-t pt-3">
                    {totaux.taxe > 0 && (
                      <div className="flex justify-between text-sm text-muted-foreground">
                        <span>{t("caisse.taxesLabel")}</span>
                        <span>{formatFc(totaux.taxe)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-lg font-bold">
                      <span>{t("common.total")}</span>
                      <span className="text-marine dark:text-or">{formatFc(totaux.total)}</span>
                    </div>
                  </div>

                  {/* Paiement en espèces uniquement (3.1). */}
                  <div className="flex items-center justify-center gap-2 rounded-lg border border-or bg-or/15 p-2 text-sm font-medium text-terracotta dark:text-or">
                    <Banknote className="h-4 w-4" />
                    {t("caisse.cashOnly")}
                  </div>

                  {erreur && (
                    <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                      {erreur}
                    </p>
                  )}

                  <Button
                    variant="cta"
                    size="lg"
                    className="w-full text-base"
                    disabled={encaisser.isPending}
                    onClick={() => encaisser.mutate()}
                  >
                    {t("caisse.checkout", { montant: formatFc(totaux.total) })}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Journée en cours */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle>{t("caisse.currentDay")}</CardTitle>
            <CardDescription>
              {t("caisse.openSales", { count: ventesOuvertes.length })}{" "}
              <span className="font-semibold text-foreground">{formatFc(totalJournee)}</span>
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>{t("caisse.colTime")}</TableHead>
                <TableHead>{t("caisse.colArticles")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="text-right">{t("common.total")}</TableHead>
                {estDG && <TableHead className="text-right">{t("common.actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ventesOuvertes.map((v) => {
                const annulee = v.statut === "ANNULEE";
                return (
                  <TableRow key={v.id} className={annulee ? "opacity-60" : undefined}>
                    <TableCell className="font-medium">{v.numero}</TableCell>
                    <TableCell className="text-muted-foreground">{formatHeure(v.date)}</TableCell>
                    <TableCell className="max-w-64 truncate text-sm">
                      {v.lignes.map((l) => `${l.quantite}× ${l.produitNom}`).join(", ")}
                    </TableCell>
                    <TableCell>
                      {annulee ? (
                        <Badge
                          className="border-transparent bg-terracotta text-creme"
                          title={v.motifAnnulation ?? undefined}
                        >
                          {t("caisse.cancelled")}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">{t("caisse.active")}</Badge>
                      )}
                    </TableCell>
                    <TableCell
                      className={
                        annulee
                          ? "text-right font-semibold text-muted-foreground line-through"
                          : "text-right font-semibold text-marine dark:text-or"
                      }
                    >
                      {formatFc(v.total)}
                    </TableCell>
                    {estDG && (
                      <TableCell className="text-right">
                        {!annulee && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-terracotta hover:text-terracotta"
                            onClick={() => {
                              setVenteAAnnuler(v);
                              setMotifAnnulation("");
                              setErreurAnnulation(null);
                            }}
                          >
                            <Ban className="h-3.5 w-3.5" />
                            {t("caisse.cancelSale")}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {ventesOuvertes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={estDG ? 6 : 5} className="py-8 text-center text-muted-foreground">
                    {t("caisse.noSaleSinceClose")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Clôtures passées */}
      <Card>
        <CardHeader>
          <CardTitle>{t("caisse.closures")}</CardTitle>
          <CardDescription>{t("caisse.closuresDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("caisse.colCashier")}</TableHead>
                <TableHead className="text-right">{t("caisse.colSales")}</TableHead>
                <TableHead className="text-right">{t("caisse.colCash")}</TableHead>
                <TableHead className="text-right">{t("caisse.colMobile")}</TableHead>
                <TableHead className="text-right">{t("caisse.colCard")}</TableHead>
                <TableHead className="text-right">{t("common.total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(cloturesData?.clotures ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(c.date))}
                  </TableCell>
                  <TableCell>{c.caissier?.nom ?? "—"}</TableCell>
                  <TableCell className="text-right">{c.nombreVentes}</TableCell>
                  <TableCell className="text-right">{formatFc(c.totalEspeces)}</TableCell>
                  <TableCell className="text-right">{formatFc(c.totalMobileMoney)}</TableCell>
                  <TableCell className="text-right">{formatFc(c.totalCarte)}</TableCell>
                  <TableCell className="text-right font-semibold text-marine dark:text-or">
                    {formatFc(c.totalVentes)}
                  </TableCell>
                </TableRow>
              ))}
              {(cloturesData?.clotures ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    {t("caisse.noClosure")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Confirmation de clôture */}
      <Dialog open={dialogCloture} onOpenChange={setDialogCloture}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("caisse.closeTitle")}</DialogTitle>
            <DialogDescription>
              {t("caisse.closeConfirmDesc", { count: ventesOuvertes.length, montant: formatFc(totalJournee) })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogCloture(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="cta" disabled={cloturer.isPending} onClick={() => cloturer.mutate()}>
              <Lock className="h-4 w-4" />
              {t("caisse.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Annulation d'une vente par le DG (3.1) — justification obligatoire. */}
      <Dialog open={!!venteAAnnuler} onOpenChange={(o) => !o && setVenteAAnnuler(null)}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (venteAAnnuler) annuler.mutate(venteAAnnuler.id);
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("caisse.cancelTitle", { numero: venteAAnnuler?.numero ?? "" })}</DialogTitle>
              <DialogDescription>
                {t("caisse.cancelDesc", { montant: venteAAnnuler ? formatFc(venteAAnnuler.total) : "" })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="motif-annulation">{t("caisse.cancelReason")}</Label>
              <Input
                id="motif-annulation"
                value={motifAnnulation}
                onChange={(e) => setMotifAnnulation(e.target.value)}
                minLength={3}
                required
                autoFocus
                placeholder={t("caisse.cancelReasonPlaceholder")}
              />
            </div>
            {erreurAnnulation && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurAnnulation}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setVenteAAnnuler(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="cta"
                disabled={annuler.isPending || motifAnnulation.trim().length < 3}
              >
                <Ban className="h-4 w-4" />
                {t("caisse.confirmCancel")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
