import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  formatQuantite,
  type MatierePremiereDTO,
  type MouvementStockDTO,
  type TypeMouvementStock,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useFeedback } from "@/components/FeedbackProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CarteLigne, CarteLigneActions, CarteLigneChamp, CarteLigneTitre } from "@/components/ui/carte-ligne";
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

function formatDateHeure(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export function StocksPage() {
  const { peutEcrire } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { confirmer, toastErreur } = useFeedback();
  const editable = peutEcrire("STOCKS");

  const { data: matieresData } = useQuery({
    queryKey: ["matieres"],
    queryFn: () => api<{ matieres: MatierePremiereDTO[] }>("/api/stocks/matieres"),
  });
  const [filtreMatiere, setFiltreMatiere] = useState("");
  const { data: mouvementsData } = useQuery({
    queryKey: ["mouvements", filtreMatiere],
    queryFn: () =>
      api<{ mouvements: MouvementStockDTO[] }>(
        `/api/stocks/mouvements${filtreMatiere ? `?matiereId=${filtreMatiere}` : ""}`,
      ),
  });

  const matieres = matieresData?.matieres ?? [];
  const sousSeuil = matieres.filter((m) => m.sousSeuil);

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ["matieres"] });
    queryClient.invalidateQueries({ queryKey: ["mouvements"] });
  };

  // --- Dialog matière (création / édition) ---------------------------------
  const [dialogMatiere, setDialogMatiere] = useState(false);
  const [matiereEditee, setMatiereEditee] = useState<MatierePremiereDTO | null>(null);
  const [nom, setNom] = useState("");
  const [unite, setUnite] = useState("kg");
  const [seuilAlerte, setSeuilAlerte] = useState("");
  const [quantiteInitiale, setQuantiteInitiale] = useState("");
  const [erreurMatiere, setErreurMatiere] = useState<string | null>(null);

  function ouvrirMatiere(m: MatierePremiereDTO | null) {
    setMatiereEditee(m);
    setNom(m?.nom ?? "");
    setUnite(m?.unite ?? "kg");
    setSeuilAlerte(m ? String(m.seuilAlerte) : "");
    setQuantiteInitiale("");
    setErreurMatiere(null);
    setDialogMatiere(true);
  }

  const sauverMatiere = useMutation({
    mutationFn: () => {
      const commun = { nom: nom.trim(), unite: unite.trim(), seuilAlerte: Number(seuilAlerte) };
      return matiereEditee
        ? api(`/api/stocks/matieres/${matiereEditee.id}`, { method: "PUT", body: JSON.stringify(commun) })
        : api("/api/stocks/matieres", {
            method: "POST",
            body: JSON.stringify({ ...commun, quantiteInitiale: Number(quantiteInitiale || 0) }),
          });
    },
    onSuccess: () => {
      setDialogMatiere(false);
      rafraichir();
    },
    onError: (e) => setErreurMatiere(e instanceof Error ? e.message : t("stocks.saveError")),
  });

  const supprimerMatiere = useMutation({
    mutationFn: (id: string) => api(`/api/stocks/matieres/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => toastErreur(e instanceof Error ? e.message : t("stocks.deleteError")),
  });

  // --- Dialog mouvement ------------------------------------------------------
  const [dialogMouvement, setDialogMouvement] = useState(false);
  const [mvtMatiereId, setMvtMatiereId] = useState("");
  const [mvtType, setMvtType] = useState<TypeMouvementStock>("ENTREE");
  const [mvtQuantite, setMvtQuantite] = useState("");
  const [mvtReference, setMvtReference] = useState("");
  const [erreurMouvement, setErreurMouvement] = useState<string | null>(null);

  function ouvrirMouvement(type: TypeMouvementStock, matiereId?: string) {
    setMvtType(type);
    setMvtMatiereId(matiereId ?? matieres[0]?.id ?? "");
    setMvtQuantite("");
    setMvtReference("");
    setErreurMouvement(null);
    setDialogMouvement(true);
  }

  const enregistrerMouvement = useMutation({
    mutationFn: () =>
      api("/api/stocks/mouvements", {
        method: "POST",
        body: JSON.stringify({
          matierePremiereId: mvtMatiereId,
          type: mvtType,
          quantite: Number(mvtQuantite),
          reference: mvtReference.trim() || undefined,
        }),
      }),
    onSuccess: () => {
      setDialogMouvement(false);
      rafraichir();
    },
    onError: (e) => setErreurMouvement(e instanceof Error ? e.message : t("stocks.saveError")),
  });

  const matiereMouvement = matieres.find((m) => m.id === mvtMatiereId);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("stocks.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("stocks.subtitle")}</p>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => ouvrirMouvement("ENTREE")} disabled={matieres.length === 0}>
              <ArrowDownToLine className="h-4 w-4" />
              {t("mouvement.ENTREE")}
            </Button>
            <Button variant="outline" onClick={() => ouvrirMouvement("SORTIE")} disabled={matieres.length === 0}>
              <ArrowUpFromLine className="h-4 w-4" />
              {t("mouvement.SORTIE")}
            </Button>
            <Button variant="cta" onClick={() => ouvrirMatiere(null)}>
              <Plus className="h-4 w-4" />
              {t("stocks.matiere")}
            </Button>
          </div>
        )}
      </div>

      {sousSeuil.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-terracotta/40 bg-terracotta/10 px-4 py-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-terracotta" />
          <p>
            <span className="font-semibold text-terracotta">{t("stocks.criticalStock")}</span>{" "}
            {sousSeuil
              .map((m) =>
                t("stocks.criticalItem", {
                  nom: m.nom,
                  stock: formatQuantite(m.quantiteStock, m.unite),
                  seuil: formatQuantite(m.seuilAlerte, m.unite),
                }),
              )
              .join(", ")}{" "}
            {t("stocks.anticipate")}
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("stocks.matieresTitle")}</CardTitle>
          <CardDescription>{t("stocks.matieresDesc", { count: matieres.length })}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Bureau : tableau classique. Mobile : cartes empilées — 6 colonnes
              (dont actions) ne tiennent pas sur un écran de 375-414px sans
              couper les données essentielles (état, actions). */}
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("stocks.colMatiere")}</TableHead>
                <TableHead>{t("stocks.colUnit")}</TableHead>
                <TableHead className="text-right">{t("stocks.colInStock")}</TableHead>
                <TableHead className="text-right">{t("stocks.colThreshold")}</TableHead>
                <TableHead>{t("stocks.colState")}</TableHead>
                {editable && <TableHead className="text-right">{t("common.actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {matieres.map((m) => (
                <TableRow key={m.id} className={m.sousSeuil ? "bg-terracotta/5" : undefined}>
                  <TableCell className="font-medium">{m.nom}</TableCell>
                  <TableCell className="text-muted-foreground">{m.unite}</TableCell>
                  <TableCell className="text-right font-semibold text-marine dark:text-or">
                    {formatQuantite(m.quantiteStock, m.unite)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatQuantite(m.seuilAlerte, m.unite)}
                  </TableCell>
                  <TableCell>
                    {m.sousSeuil ? (
                      <Badge className="border-transparent bg-terracotta text-creme">{t("stocks.belowThreshold")}</Badge>
                    ) : (
                      <Badge variant="secondary">{t("stocks.ok")}</Badge>
                    )}
                  </TableCell>
                  {editable && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirMatiere(m)} aria-label={t("stocks.ariaEdit", { nom: m.nom })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={async () => {
                          if (await confirmer({ description: t("stocks.confirmDelete", { nom: m.nom }), destructive: true }))
                            supprimerMatiere.mutate(m.id);
                        }}
                        aria-label={t("stocks.ariaDelete", { nom: m.nom })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
              {matieres.length === 0 && (
                <TableRow>
                  <TableCell colSpan={editable ? 6 : 5} className="py-8 text-center text-muted-foreground">
                    {t("stocks.noMatiere")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="space-y-2 md:hidden">
            {matieres.map((m) => (
              <CarteLigne key={m.id} className={m.sousSeuil ? "border-terracotta/40 bg-terracotta/5" : undefined}>
                <CarteLigneTitre>
                  <span>{m.nom}</span>
                  {m.sousSeuil ? (
                    <Badge className="border-transparent bg-terracotta text-creme">{t("stocks.belowThreshold")}</Badge>
                  ) : (
                    <Badge variant="secondary">{t("stocks.ok")}</Badge>
                  )}
                </CarteLigneTitre>
                <CarteLigneChamp
                  label={t("stocks.colInStock")}
                  value={<span className="font-semibold text-marine dark:text-or">{formatQuantite(m.quantiteStock, m.unite)}</span>}
                />
                <CarteLigneChamp label={t("stocks.colThreshold")} value={formatQuantite(m.seuilAlerte, m.unite)} />
                <CarteLigneChamp label={t("stocks.colUnit")} value={m.unite} />
                {editable && (
                  <CarteLigneActions>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirMatiere(m)} aria-label={t("stocks.ariaEdit", { nom: m.nom })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-terracotta hover:text-terracotta"
                      onClick={async () => {
                          if (await confirmer({ description: t("stocks.confirmDelete", { nom: m.nom }), destructive: true }))
                            supprimerMatiere.mutate(m.id);
                        }}
                      aria-label={t("stocks.ariaDelete", { nom: m.nom })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </CarteLigneActions>
                )}
              </CarteLigne>
            ))}
            {matieres.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">{t("stocks.noMatiere")}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-col items-start gap-3 space-y-0 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1.5">
            <CardTitle>{t("stocks.historyTitle")}</CardTitle>
            <CardDescription>{t("stocks.historyDesc")}</CardDescription>
          </div>
          <div className="w-full md:w-56">
            <Label htmlFor="filtre-matiere">{t("stocks.colMatiere")}</Label>
            <NativeSelect id="filtre-matiere" value={filtreMatiere} onChange={(e) => setFiltreMatiere(e.target.value)}>
              <option value="">{t("stocks.filterAll")}</option>
              {matieres.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nom}
                </option>
              ))}
            </NativeSelect>
          </div>
        </CardHeader>
        <CardContent>
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.date")}</TableHead>
                <TableHead>{t("stocks.colMatiere")}</TableHead>
                <TableHead>{t("stocks.colType")}</TableHead>
                <TableHead className="text-right">{t("stocks.colQuantity")}</TableHead>
                <TableHead>{t("stocks.colReference")}</TableHead>
                <TableHead>{t("stocks.colAuthor")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(mouvementsData?.mouvements ?? []).map((mv) => (
                <TableRow key={mv.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateHeure(mv.date)}</TableCell>
                  <TableCell className="font-medium">{mv.matierePremiere.nom}</TableCell>
                  <TableCell>
                    <Badge variant={mv.type === "ENTREE" ? "secondary" : "gold"}>{t(`mouvement.${mv.type}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {mv.type === "ENTREE" ? "+" : "−"}
                    {formatQuantite(mv.quantite, mv.matierePremiere.unite)}
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-sm text-muted-foreground">{mv.reference ?? "—"}</TableCell>
                  <TableCell className="text-sm">{mv.auteur?.nom ?? "—"}</TableCell>
                </TableRow>
              ))}
              {(mouvementsData?.mouvements ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {t("stocks.noMovement")}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="space-y-2 md:hidden">
            {(mouvementsData?.mouvements ?? []).map((mv) => (
              <CarteLigne key={mv.id}>
                <CarteLigneTitre>
                  <span>{mv.matierePremiere.nom}</span>
                  <Badge variant={mv.type === "ENTREE" ? "secondary" : "gold"}>{t(`mouvement.${mv.type}`)}</Badge>
                </CarteLigneTitre>
                <CarteLigneChamp label={t("common.date")} value={formatDateHeure(mv.date)} />
                <CarteLigneChamp
                  label={t("stocks.colQuantity")}
                  value={
                    <span className="font-semibold">
                      {mv.type === "ENTREE" ? "+" : "−"}
                      {formatQuantite(mv.quantite, mv.matierePremiere.unite)}
                    </span>
                  }
                />
                <CarteLigneChamp label={t("stocks.colReference")} value={mv.reference ?? "—"} />
                <CarteLigneChamp label={t("stocks.colAuthor")} value={mv.auteur?.nom ?? "—"} />
              </CarteLigne>
            ))}
            {(mouvementsData?.mouvements ?? []).length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">{t("stocks.noMovement")}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dialog matière première */}
      <Dialog open={dialogMatiere} onOpenChange={setDialogMatiere}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sauverMatiere.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{matiereEditee ? t("stocks.matiereDialogEdit", { nom: matiereEditee.nom }) : t("stocks.matiereDialogNew")}</DialogTitle>
              <DialogDescription>
                {matiereEditee ? t("stocks.matiereEditDesc") : t("stocks.matiereNewDesc")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="matiere-nom">{t("common.name")}</Label>
                <Input id="matiere-nom" value={nom} onChange={(e) => setNom(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="matiere-unite">{t("stocks.unit")}</Label>
                <Input id="matiere-unite" value={unite} onChange={(e) => setUnite(e.target.value)} placeholder={t("stocks.unitPlaceholder")} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="matiere-seuil">{t("stocks.threshold")}</Label>
                <Input
                  id="matiere-seuil"
                  type="number"
                  min="0"
                  step="0.001"
                  value={seuilAlerte}
                  onChange={(e) => setSeuilAlerte(e.target.value)}
                  required
                />
              </div>
              {!matiereEditee && (
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="matiere-initiale">{t("stocks.initialStock")}</Label>
                  <Input
                    id="matiere-initiale"
                    type="number"
                    min="0"
                    step="0.001"
                    value={quantiteInitiale}
                    onChange={(e) => setQuantiteInitiale(e.target.value)}
                  />
                </div>
              )}
            </div>
            {erreurMatiere && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurMatiere}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogMatiere(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={sauverMatiere.isPending}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog mouvement */}
      <Dialog open={dialogMouvement} onOpenChange={setDialogMouvement}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              enregistrerMouvement.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{mvtType === "ENTREE" ? t("stocks.mvtEntryTitle") : t("stocks.mvtExitTitle")}</DialogTitle>
              <DialogDescription>
                {matiereMouvement
                  ? t("stocks.currentStock", { stock: formatQuantite(matiereMouvement.quantiteStock, matiereMouvement.unite) })
                  : t("stocks.chooseMatiere")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="mvt-matiere">{t("stocks.matiereLabel")}</Label>
                <NativeSelect id="mvt-matiere" value={mvtMatiereId} onChange={(e) => setMvtMatiereId(e.target.value)} required>
                  {matieres.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nom}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="mvt-type">{t("stocks.type")}</Label>
                  <NativeSelect id="mvt-type" value={mvtType} onChange={(e) => setMvtType(e.target.value as TypeMouvementStock)}>
                    <option value="ENTREE">{t("mouvement.ENTREE")}</option>
                    <option value="SORTIE">{t("mouvement.SORTIE")}</option>
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mvt-quantite">
                    {matiereMouvement ? t("stocks.quantityWithUnit", { unite: matiereMouvement.unite }) : t("stocks.quantity")}
                  </Label>
                  <Input
                    id="mvt-quantite"
                    type="number"
                    min="0.001"
                    step="0.001"
                    value={mvtQuantite}
                    onChange={(e) => setMvtQuantite(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mvt-reference">{t("stocks.referenceOptional")}</Label>
                <Input
                  id="mvt-reference"
                  value={mvtReference}
                  onChange={(e) => setMvtReference(e.target.value)}
                  placeholder={t("stocks.referencePlaceholder")}
                />
              </div>
            </div>
            {erreurMouvement && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurMouvement}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogMouvement(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={enregistrerMouvement.isPending}>
                {t("stocks.saveMovement")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
