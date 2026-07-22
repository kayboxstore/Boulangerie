import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChefHat, Factory, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  formatQuantite,
  type MatierePremiereDTO,
  type PlanningProductionDTO,
  type ProduitDTO,
  type ProductionDTO,
  type RecetteDTO,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
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
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(iso));
}

function aujourdhui(): string {
  return new Date().toISOString().slice(0, 10);
}

interface LigneIngredient {
  matierePremiereId: string;
  quantite: string;
}

export function ProductionPage() {
  const { peutEcrire, peutLire } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editable = peutEcrire("PRODUCTION");
  const voitStocks = peutLire("STOCKS");

  const { data: recettesData } = useQuery({
    queryKey: ["recettes"],
    queryFn: () => api<{ recettes: RecetteDTO[] }>("/api/production/recettes"),
  });
  const { data: planningsData } = useQuery({
    queryKey: ["plannings"],
    queryFn: () => api<{ plannings: PlanningProductionDTO[] }>("/api/production/planning"),
  });
  const { data: productionsData } = useQuery({
    queryKey: ["productions"],
    queryFn: () => api<{ productions: ProductionDTO[] }>("/api/production/productions"),
  });
  const { data: produitsData } = useQuery({
    queryKey: ["produits"],
    queryFn: () => api<{ produits: ProduitDTO[] }>("/api/produits"),
    enabled: editable,
  });
  // La liste des matières sert au formulaire de recette ; réservée aux rôles
  // qui lisent les Stocks (le Responsable de production passe par ses recettes).
  const { data: matieresData } = useQuery({
    queryKey: ["matieres"],
    queryFn: () => api<{ matieres: MatierePremiereDTO[] }>("/api/stocks/matieres"),
    enabled: editable && voitStocks,
  });

  const recettes = recettesData?.recettes ?? [];
  const plannings = planningsData?.plannings ?? [];
  const productions = productionsData?.productions ?? [];

  // Ingrédients référencés par les recettes existantes — utilisable même sans
  // accès au module Stocks.
  const matieresConnues = useMemo(() => {
    if (matieresData) {
      return matieresData.matieres.map((m) => ({ id: m.id, nom: m.nom, unite: m.unite }));
    }
    const parId = new Map<string, { id: string; nom: string; unite: string }>();
    for (const r of recettes) {
      for (const i of r.ingredients) parId.set(i.matierePremiere.id, i.matierePremiere);
    }
    return [...parId.values()].sort((a, b) => a.nom.localeCompare(b.nom));
  }, [matieresData, recettes]);

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ["recettes"] });
    queryClient.invalidateQueries({ queryKey: ["plannings"] });
    queryClient.invalidateQueries({ queryKey: ["productions"] });
    queryClient.invalidateQueries({ queryKey: ["matieres"] });
    queryClient.invalidateQueries({ queryKey: ["mouvements"] });
  };

  // --- Dialog recette --------------------------------------------------------
  const [dialogRecette, setDialogRecette] = useState(false);
  const [recetteEditee, setRecetteEditee] = useState<RecetteDTO | null>(null);
  const [produitId, setProduitId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [lignes, setLignes] = useState<LigneIngredient[]>([]);
  const [erreurRecette, setErreurRecette] = useState<string | null>(null);

  function ouvrirRecette(r: RecetteDTO | null) {
    setRecetteEditee(r);
    setProduitId(r?.produit.id ?? "");
    setInstructions(r?.instructions ?? "");
    setLignes(
      r
        ? r.ingredients.map((i) => ({ matierePremiereId: i.matierePremiere.id, quantite: String(i.quantite) }))
        : [{ matierePremiereId: matieresConnues[0]?.id ?? "", quantite: "" }],
    );
    setErreurRecette(null);
    setDialogRecette(true);
  }

  const sauverRecette = useMutation({
    mutationFn: () => {
      const ingredients = lignes.map((l) => ({
        matierePremiereId: l.matierePremiereId,
        quantite: Number(l.quantite),
      }));
      const corps = { instructions: instructions.trim() || undefined, ingredients };
      return recetteEditee
        ? api(`/api/production/recettes/${recetteEditee.id}`, { method: "PUT", body: JSON.stringify(corps) })
        : api("/api/production/recettes", { method: "POST", body: JSON.stringify({ produitId, ...corps }) });
    },
    onSuccess: () => {
      setDialogRecette(false);
      rafraichir();
    },
    onError: (e) => setErreurRecette(e instanceof Error ? e.message : t("production.saveError")),
  });

  const supprimerRecette = useMutation({
    mutationFn: (id: string) => api(`/api/production/recettes/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : t("production.deleteError")),
  });

  // --- Dialog planning -------------------------------------------------------
  const [dialogPlanning, setDialogPlanning] = useState(false);
  const [planRecetteId, setPlanRecetteId] = useState("");
  const [planQuantite, setPlanQuantite] = useState("");
  const [planDate, setPlanDate] = useState(aujourdhui());
  const [erreurPlanning, setErreurPlanning] = useState<string | null>(null);

  const creerPlanning = useMutation({
    mutationFn: () =>
      api("/api/production/planning", {
        method: "POST",
        body: JSON.stringify({
          recetteId: planRecetteId,
          quantitePrevue: Number(planQuantite),
          datePrevue: planDate,
        }),
      }),
    onSuccess: () => {
      setDialogPlanning(false);
      rafraichir();
    },
    onError: (e) => setErreurPlanning(e instanceof Error ? e.message : t("production.saveError")),
  });

  const supprimerPlanning = useMutation({
    mutationFn: (id: string) => api(`/api/production/planning/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : t("production.deleteError")),
  });

  // --- Dialog production -----------------------------------------------------
  const [dialogProduction, setDialogProduction] = useState(false);
  const [prodRecetteId, setProdRecetteId] = useState("");
  const [prodQuantite, setProdQuantite] = useState("");
  const [prodPlanningId, setProdPlanningId] = useState("");
  const [erreurProduction, setErreurProduction] = useState<string | null>(null);

  function ouvrirProduction(planning?: PlanningProductionDTO) {
    setProdRecetteId(planning?.recette.id ?? recettes[0]?.id ?? "");
    setProdQuantite(planning ? String(planning.quantitePrevue) : "");
    setProdPlanningId(planning?.id ?? "");
    setErreurProduction(null);
    setDialogProduction(true);
  }

  const enregistrerProduction = useMutation({
    mutationFn: () =>
      api<{ production: ProductionDTO }>("/api/production/productions", {
        method: "POST",
        body: JSON.stringify({
          recetteId: prodRecetteId,
          quantiteProduite: Number(prodQuantite),
          planningId: prodPlanningId || undefined,
        }),
      }),
    onSuccess: () => {
      setDialogProduction(false);
      rafraichir();
    },
    onError: (e) => setErreurProduction(e instanceof Error ? e.message : t("production.saveError")),
  });

  const recetteProduction = recettes.find((r) => r.id === prodRecetteId);
  const quantiteProduction = Number(prodQuantite) || 0;
  const planningsOuverts = plannings.filter((p) => p.statut === "PREVU" && p.recette.id === prodRecetteId);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("production.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("production.subtitle")}</p>
        </div>
        {editable && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setDialogPlanning(true)} disabled={recettes.length === 0}>
              <CalendarDays className="h-4 w-4" />
              {t("production.plan")}
            </Button>
            <Button variant="outline" onClick={() => ouvrirRecette(null)}>
              <ChefHat className="h-4 w-4" />
              {t("production.recipe")}
            </Button>
            <Button variant="cta" onClick={() => ouvrirProduction()} disabled={recettes.length === 0}>
              <Factory className="h-4 w-4" />
              {t("production.recordProduction")}
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recettes */}
        <Card>
          <CardHeader>
            <CardTitle>{t("production.recipes")}</CardTitle>
            <CardDescription>{t("production.recipesDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {recettes.map((r) => (
              <div key={r.id} className="rounded-lg border border-beige/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-marine dark:text-creme">{r.produit.nom}</p>
                  {editable && (
                    <div className="flex shrink-0 gap-1">
                      <Button variant="outline" size="sm" onClick={() => ouvrirRecette(r)}>
                        {t("common.edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={() => confirm(t("production.confirmDeleteRecipe", { nom: r.produit.nom })) && supprimerRecette.mutate(r.id)}
                        aria-label={t("production.ariaDeleteRecipe", { nom: r.produit.nom })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {r.ingredients.map((i) => (
                    <li key={i.id} className="flex justify-between">
                      <span>{i.matierePremiere.nom}</span>
                      <span className="font-medium text-foreground">
                        {formatQuantite(i.quantite, i.matierePremiere.unite)}
                      </span>
                    </li>
                  ))}
                </ul>
                {r.instructions && <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">{r.instructions}</p>}
              </div>
            ))}
            {recettes.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("production.noRecipe")}</p>
            )}
          </CardContent>
        </Card>

        {/* Planning */}
        <Card>
          <CardHeader>
            <CardTitle>{t("production.planningTitle")}</CardTitle>
            <CardDescription>{t("production.planningDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("production.colForDate")}</TableHead>
                  <TableHead>{t("production.colProduct")}</TableHead>
                  <TableHead className="text-right">{t("production.colQuantity")}</TableHead>
                  <TableHead>{t("production.colStatus")}</TableHead>
                  {editable && <TableHead className="text-right">{t("common.actions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {plannings.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(p.datePrevue)}</TableCell>
                    <TableCell className="font-medium">{p.recette.produitNom}</TableCell>
                    <TableCell className="text-right">{p.quantitePrevue}</TableCell>
                    <TableCell>
                      {p.statut === "FAIT" ? (
                        <Badge variant="gold">{t("production.statutFait")}</Badge>
                      ) : (
                        <Badge variant="secondary">{t("production.statutPrevu")}</Badge>
                      )}
                    </TableCell>
                    {editable && (
                      <TableCell className="text-right">
                        {p.statut === "PREVU" && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => ouvrirProduction(p)}>
                              {t("production.produce")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="ml-1 h-8 w-8 text-terracotta hover:text-terracotta"
                              onClick={() => supprimerPlanning.mutate(p.id)}
                              aria-label={t("production.ariaDeletePlanning")}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {plannings.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={editable ? 5 : 4} className="py-8 text-center text-muted-foreground">
                      {t("production.nothingPlanned")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Historique des productions */}
      <Card>
        <CardHeader>
          <CardTitle>{t("production.recordedTitle")}</CardTitle>
          <CardDescription>{t("production.recordedDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("production.colProduct")}</TableHead>
                <TableHead className="text-right">{t("production.colQuantity")}</TableHead>
                <TableHead>{t("production.colConsumed")}</TableHead>
                <TableHead>{t("production.colRecordedBy")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productions.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.numero}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(p.date))}
                  </TableCell>
                  <TableCell className="font-medium">{p.recette.produitNom}</TableCell>
                  <TableCell className="text-right font-semibold text-marine dark:text-or">{p.quantiteProduite}</TableCell>
                  <TableCell className="max-w-80 text-sm text-muted-foreground">
                    {p.consommations.map((c) => `${formatQuantite(c.quantite, c.unite)} ${c.matiereNom}`).join(", ")}
                  </TableCell>
                  <TableCell className="text-sm">{p.enregistrePar?.nom ?? "—"}</TableCell>
                </TableRow>
              ))}
              {productions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {t("production.noProduction")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog recette */}
      <Dialog open={dialogRecette} onOpenChange={setDialogRecette}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sauverRecette.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{recetteEditee ? t("production.recipeDialogTitleEdit", { nom: recetteEditee.produit.nom }) : t("production.recipeDialogTitleNew")}</DialogTitle>
              <DialogDescription>{t("production.recipeDialogDesc")}</DialogDescription>
            </DialogHeader>

            {!recetteEditee && (
              <div className="space-y-1.5">
                <Label htmlFor="recette-produit">{t("production.product")}</Label>
                <NativeSelect id="recette-produit" value={produitId} onChange={(e) => setProduitId(e.target.value)} required>
                  <option value="">{t("production.chooseProduct")}</option>
                  {(produitsData?.produits ?? [])
                    .filter((p) => p.actif && !recettes.some((r) => r.produit.id === p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nom}
                      </option>
                    ))}
                </NativeSelect>
              </div>
            )}

            <div className="space-y-2">
              <Label>{t("production.ingredients")}</Label>
              {lignes.map((l, index) => {
                const matiere = matieresConnues.find((m) => m.id === l.matierePremiereId);
                return (
                  <div key={index} className="flex items-center gap-2">
                    <NativeSelect
                      value={l.matierePremiereId}
                      onChange={(e) =>
                        setLignes((prev) => prev.map((x, i) => (i === index ? { ...x, matierePremiereId: e.target.value } : x)))
                      }
                      required
                      aria-label={t("production.ariaIngredient", { n: index + 1 })}
                    >
                      <option value="">{t("production.chooseMatiere")}</option>
                      {matieresConnues.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nom}
                        </option>
                      ))}
                    </NativeSelect>
                    <Input
                      type="number"
                      min="0.001"
                      step="0.001"
                      className="w-28 shrink-0"
                      placeholder={matiere ? matiere.unite : t("production.qtyPlaceholder")}
                      value={l.quantite}
                      onChange={(e) =>
                        setLignes((prev) => prev.map((x, i) => (i === index ? { ...x, quantite: e.target.value } : x)))
                      }
                      required
                      aria-label={t("production.ariaIngredientQty", { n: index + 1 })}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-terracotta hover:text-terracotta"
                      onClick={() => setLignes((prev) => prev.filter((_, i) => i !== index))}
                      disabled={lignes.length === 1}
                      aria-label={t("production.ariaRemoveIngredient", { n: index + 1 })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLignes((prev) => [...prev, { matierePremiereId: "", quantite: "" }])}
              >
                <Plus className="h-3.5 w-3.5" />
                {t("production.addIngredient")}
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="recette-instructions">{t("production.instructionsOptional")}</Label>
              <textarea
                id="recette-instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={3}
                className="flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {erreurRecette && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurRecette}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogRecette(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={sauverRecette.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog planning */}
      <Dialog open={dialogPlanning} onOpenChange={setDialogPlanning}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              creerPlanning.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("production.planDialogTitle")}</DialogTitle>
              <DialogDescription>{t("production.planningDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="plan-recette">{t("production.recipeLabel")}</Label>
                <NativeSelect id="plan-recette" value={planRecetteId} onChange={(e) => setPlanRecetteId(e.target.value)} required>
                  <option value="">{t("production.choose")}</option>
                  {recettes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.produit.nom}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="plan-quantite">{t("production.colQuantity")}</Label>
                  <Input
                    id="plan-quantite"
                    type="number"
                    min="1"
                    step="1"
                    value={planQuantite}
                    onChange={(e) => setPlanQuantite(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="plan-date">{t("production.forDate")}</Label>
                  <Input id="plan-date" type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} required />
                </div>
              </div>
            </div>
            {erreurPlanning && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurPlanning}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogPlanning(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={creerPlanning.isPending}>
                {t("production.planButton")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog production */}
      <Dialog open={dialogProduction} onOpenChange={setDialogProduction}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enregistrerProduction.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{t("production.prodDialogTitle")}</DialogTitle>
              <DialogDescription>{t("production.prodDialogDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="prod-recette">{t("production.recipeLabel")}</Label>
                <NativeSelect
                  id="prod-recette"
                  value={prodRecetteId}
                  onChange={(e) => {
                    setProdRecetteId(e.target.value);
                    setProdPlanningId("");
                  }}
                  required
                >
                  {recettes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.produit.nom}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prod-quantite">{t("production.quantityProduced")}</Label>
                <Input
                  id="prod-quantite"
                  type="number"
                  min="1"
                  step="1"
                  value={prodQuantite}
                  onChange={(e) => setProdQuantite(e.target.value)}
                  required
                />
              </div>
              {planningsOuverts.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="prod-planning">{t("production.attachPlanning")}</Label>
                  <NativeSelect id="prod-planning" value={prodPlanningId} onChange={(e) => setProdPlanningId(e.target.value)}>
                    <option value="">{t("production.none")}</option>
                    {planningsOuverts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {t("production.planningOption", { date: formatDate(p.datePrevue), qty: p.quantitePrevue })}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}

              {recetteProduction && quantiteProduction > 0 && (
                <div className="rounded-md bg-secondary/60 px-3 py-2 text-sm">
                  <p className="font-medium">{t("production.plannedConsumption")}</p>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {recetteProduction.ingredients.map((i) => (
                      <li key={i.id} className="flex justify-between">
                        <span>{i.matierePremiere.nom}</span>
                        <span>
                          {formatQuantite(Math.round(i.quantite * quantiteProduction * 1000) / 1000, i.matierePremiere.unite)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {erreurProduction && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurProduction}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogProduction(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={enregistrerProduction.isPending}>
                <Factory className="h-4 w-4" />
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
