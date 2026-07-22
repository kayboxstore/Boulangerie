import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatFc, type ProduitDTO } from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface FormulaireProduit {
  nom: string;
  prixVente: string;
  categorie: string;
}

const FORMULAIRE_VIDE: FormulaireProduit = { nom: "", prixVente: "", categorie: "Pain" };

export function ProduitsPage() {
  const { peutEcrire } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const editable = peutEcrire("PARAMETRES");

  const { data, isLoading, error } = useQuery({
    queryKey: ["produits"],
    queryFn: () => api<{ produits: ProduitDTO[] }>("/api/produits"),
  });

  const [dialogOuvert, setDialogOuvert] = useState(false);
  const [produitEnEdition, setProduitEnEdition] = useState<ProduitDTO | null>(null);
  const [formulaire, setFormulaire] = useState<FormulaireProduit>(FORMULAIRE_VIDE);
  const [erreurFormulaire, setErreurFormulaire] = useState<string | null>(null);
  const [produitASupprimer, setProduitASupprimer] = useState<ProduitDTO | null>(null);

  const invalider = () => queryClient.invalidateQueries({ queryKey: ["produits"] });

  const enregistrer = useMutation({
    mutationFn: async () => {
      const corps = {
        nom: formulaire.nom.trim(),
        prixVente: Number(formulaire.prixVente),
        categorie: formulaire.categorie.trim(),
        tauxTaxe: produitEnEdition?.tauxTaxe ?? 0,
      };
      if (produitEnEdition) {
        return api(`/api/produits/${produitEnEdition.id}`, { method: "PUT", body: JSON.stringify(corps) });
      }
      return api("/api/produits", { method: "POST", body: JSON.stringify(corps) });
    },
    onSuccess: () => {
      setDialogOuvert(false);
      invalider();
    },
    onError: (e) => setErreurFormulaire(e instanceof Error ? e.message : t("produits.saveError")),
  });

  const supprimer = useMutation({
    mutationFn: (id: string) => api(`/api/produits/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      setProduitASupprimer(null);
      invalider();
    },
  });

  function ouvrirCreation() {
    setProduitEnEdition(null);
    setFormulaire(FORMULAIRE_VIDE);
    setErreurFormulaire(null);
    setDialogOuvert(true);
  }

  function ouvrirEdition(p: ProduitDTO) {
    setProduitEnEdition(p);
    setFormulaire({ nom: p.nom, prixVente: String(p.prixVente), categorie: p.categorie });
    setErreurFormulaire(null);
    setDialogOuvert(true);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErreurFormulaire(null);
    const prix = Number(formulaire.prixVente);
    if (!formulaire.nom.trim()) return setErreurFormulaire(t("produits.errNameRequired"));
    if (!Number.isInteger(prix) || prix < 0) return setErreurFormulaire(t("produits.errPrice"));
    enregistrer.mutate();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">{t("produits.title")}</h1>
          <p className="mt-1 text-muted-foreground">{t("produits.subtitle")}</p>
        </div>
        {editable && (
          <Button variant="cta" onClick={ouvrirCreation}>
            <Plus className="h-4 w-4" />
            {t("produits.newProduct")}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("produits.cardTitle")}</CardTitle>
          <CardDescription>
            {editable ? t("produits.descManage") : t("produits.descView")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="py-8 text-center text-muted-foreground">{t("common.loading")}</p>}
          {error && (
            <p className="py-8 text-center font-medium text-terracotta">
              {error instanceof Error ? error.message : t("produits.loadError")}
            </p>
          )}
          {data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("produits.colCategory")}</TableHead>
                  <TableHead className="text-right">{t("produits.colPrice")}</TableHead>
                  <TableHead className="text-right">{t("produits.colTax")}</TableHead>
                  {editable && <TableHead className="w-24 text-right">{t("common.actions")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.produits.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.nom}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{p.categorie}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-marine dark:text-or">
                      {formatFc(p.prixVente)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {p.tauxTaxe === 0 ? t("produits.exonere") : `${p.tauxTaxe} %`}
                    </TableCell>
                    {editable && (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => ouvrirEdition(p)} aria-label={`Modifier ${p.nom}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setProduitASupprimer(p)}
                            aria-label={`Supprimer ${p.nom}`}
                            className="text-terracotta hover:text-terracotta"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {data.produits.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={editable ? 5 : 4} className="py-8 text-center text-muted-foreground">
                      {t("produits.empty")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialogue création / édition */}
      <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{produitEnEdition ? t("produits.editTitle") : t("produits.newProduct")}</DialogTitle>
            <DialogDescription>{t("produits.dialogDesc")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nom">{t("common.name")}</Label>
              <Input
                id="nom"
                value={formulaire.nom}
                onChange={(e) => setFormulaire({ ...formulaire, nom: e.target.value })}
                placeholder="Ex. : Baguette"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="prixVente">{t("produits.fieldPrice")}</Label>
                <Input
                  id="prixVente"
                  type="number"
                  min={0}
                  step={1}
                  value={formulaire.prixVente}
                  onChange={(e) => setFormulaire({ ...formulaire, prixVente: e.target.value })}
                  placeholder="500"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="categorie">{t("produits.fieldCategory")}</Label>
                <Input
                  id="categorie"
                  value={formulaire.categorie}
                  onChange={(e) => setFormulaire({ ...formulaire, categorie: e.target.value })}
                  placeholder="Pain"
                  required
                />
              </div>
            </div>

            {erreurFormulaire && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurFormulaire}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOuvert(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" variant="cta" disabled={enregistrer.isPending}>
                {produitEnEdition ? t("common.save") : t("produits.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation de suppression */}
      <Dialog open={!!produitASupprimer} onOpenChange={(o) => !o && setProduitASupprimer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("produits.deleteTitle", { nom: produitASupprimer?.nom })}</DialogTitle>
            <DialogDescription>{t("produits.deleteDesc")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProduitASupprimer(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={supprimer.isPending}
              onClick={() => produitASupprimer && supprimer.mutate(produitASupprimer.id)}
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
