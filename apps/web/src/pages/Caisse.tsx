import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, CreditCard, Lock, Minus, Plus, Smartphone, Trash2 } from "lucide-react";
import {
  formatFc,
  MOYEN_PAIEMENT_LABELS,
  MOYENS_PAIEMENT,
  type ClotureCaisseDTO,
  type MoyenPaiement,
  type ProduitDTO,
  type VenteDTO,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const ICONES_PAIEMENT: Record<MoyenPaiement, typeof Banknote> = {
  ESPECES: Banknote,
  MOBILE_MONEY: Smartphone,
  CARTE: CreditCard,
};

function formatHeure(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" }).format(new Date(iso));
}

interface LignePanier {
  produit: ProduitDTO;
  quantite: number;
}

export function CaissePage() {
  const { peutEcrire } = useAuth();
  const queryClient = useQueryClient();
  const editable = peutEcrire("CAISSE");

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
  const [moyenPaiement, setMoyenPaiement] = useState<MoyenPaiement>("ESPECES");
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
      setConfirmationVente(`Vente n°${r.vente.numero} encaissée — ${formatFc(r.vente.total)}`);
      queryClient.invalidateQueries({ queryKey: ["ventes"] });
    },
    onError: (e) => setErreur(e instanceof Error ? e.message : "Encaissement impossible"),
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
    onError: (e) => setErreur(e instanceof Error ? e.message : "Clôture impossible"),
  });

  const ventesOuvertes = ventesData?.ventes ?? [];
  const totalJournee = ventesOuvertes.reduce((s, v) => s + v.total, 0);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">Caisse</h1>
          <p className="mt-1 text-muted-foreground">
            Vente au comptoir — le pain est exonéré de TVA, montants en Fc.
          </p>
        </div>
        {editable && (
          <Button
            variant="outline"
            onClick={() => setDialogCloture(true)}
            disabled={ventesOuvertes.length === 0}
          >
            <Lock className="h-4 w-4" />
            Clôturer la caisse
          </Button>
        )}
      </div>

      {editable && (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          {/* Produits */}
          <Card>
            <CardHeader>
              <CardTitle>Produits</CardTitle>
              <CardDescription>Touchez un produit pour l'ajouter au panier.</CardDescription>
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
              <CardTitle>Panier</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {panier.length === 0 && !confirmationVente && (
                <p className="py-6 text-center text-sm text-muted-foreground">Panier vide.</p>
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
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => changerQuantite(l.produit.id, -1)} aria-label="Diminuer">
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-6 text-center text-sm font-semibold">{l.quantite}</span>
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => changerQuantite(l.produit.id, 1)} aria-label="Augmenter">
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-terracotta hover:text-terracotta"
                    onClick={() => changerQuantite(l.produit.id, -l.quantite)}
                    aria-label={`Retirer ${l.produit.nom}`}
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
                        <span>dont taxes (hors pain)</span>
                        <span>{formatFc(totaux.taxe)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-lg font-bold">
                      <span>Total</span>
                      <span className="text-marine dark:text-or">{formatFc(totaux.total)}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    {MOYENS_PAIEMENT.map((m) => {
                      const Icone = ICONES_PAIEMENT[m];
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setMoyenPaiement(m)}
                          className={cn(
                            "flex flex-col items-center gap-1 rounded-lg border p-2 text-xs font-medium transition-colors",
                            moyenPaiement === m
                              ? "border-or bg-or/15 text-terracotta dark:text-or"
                              : "border-input text-muted-foreground hover:bg-secondary",
                          )}
                        >
                          <Icone className="h-4 w-4" />
                          {MOYEN_PAIEMENT_LABELS[m]}
                        </button>
                      );
                    })}
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
                    Encaisser {formatFc(totaux.total)}
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
            <CardTitle>Journée en cours</CardTitle>
            <CardDescription>
              {ventesOuvertes.length} vente(s) non clôturée(s) — total{" "}
              <span className="font-semibold text-foreground">{formatFc(totalJournee)}</span>
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>Heure</TableHead>
                <TableHead>Articles</TableHead>
                <TableHead>Paiement</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ventesOuvertes.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.numero}</TableCell>
                  <TableCell className="text-muted-foreground">{formatHeure(v.date)}</TableCell>
                  <TableCell className="max-w-64 truncate text-sm">
                    {v.lignes.map((l) => `${l.quantite}× ${l.produitNom}`).join(", ")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{MOYEN_PAIEMENT_LABELS[v.moyenPaiement]}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-marine dark:text-or">
                    {formatFc(v.total)}
                  </TableCell>
                </TableRow>
              ))}
              {ventesOuvertes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    Aucune vente depuis la dernière clôture.
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
          <CardTitle>Clôtures de caisse</CardTitle>
          <CardDescription>Totaux journaliers figés, par moyen de paiement.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Caissier(ère)</TableHead>
                <TableHead className="text-right">Ventes</TableHead>
                <TableHead className="text-right">Espèces</TableHead>
                <TableHead className="text-right">Mobile money</TableHead>
                <TableHead className="text-right">Carte</TableHead>
                <TableHead className="text-right">Total</TableHead>
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
                    Aucune clôture enregistrée.
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
            <DialogTitle>Clôturer la caisse ?</DialogTitle>
            <DialogDescription>
              {ventesOuvertes.length} vente(s) pour un total de {formatFc(totalJournee)} seront figées dans
              cette clôture. Cette action est définitive.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogCloture(false)}>
              Annuler
            </Button>
            <Button variant="cta" disabled={cloturer.isPending} onClick={() => cloturer.mutate()}>
              <Lock className="h-4 w-4" />
              Clôturer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
