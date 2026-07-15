import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
    onError: (e) => setErreurFormulaire(e instanceof Error ? e.message : "Enregistrement impossible"),
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
    if (!formulaire.nom.trim()) return setErreurFormulaire("Le nom est requis");
    if (!Number.isInteger(prix) || prix < 0) return setErreurFormulaire("Prix invalide (montant en Fc entier)");
    enregistrer.mutate();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">Catalogue produits</h1>
          <p className="mt-1 text-muted-foreground">
            Le pain est exonéré de TVA — prix affichés en Franc Congolais (Fc).
          </p>
        </div>
        {editable && (
          <Button variant="cta" onClick={ouvrirCreation}>
            <Plus className="h-4 w-4" />
            Nouveau produit
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Produits</CardTitle>
          <CardDescription>
            {editable
              ? "Gestion du catalogue (rôle Administrateur)."
              : "Consultation du catalogue — la modification est réservée à l'Administrateur."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="py-8 text-center text-muted-foreground">Chargement…</p>}
          {error && (
            <p className="py-8 text-center font-medium text-terracotta">
              {error instanceof Error ? error.message : "Erreur de chargement"}
            </p>
          )}
          {data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead className="text-right">Prix de vente</TableHead>
                  <TableHead className="text-right">TVA</TableHead>
                  {editable && <TableHead className="w-24 text-right">Actions</TableHead>}
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
                      {p.tauxTaxe === 0 ? "Exonéré" : `${p.tauxTaxe} %`}
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
                      Aucun produit au catalogue.
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
            <DialogTitle>{produitEnEdition ? "Modifier le produit" : "Nouveau produit"}</DialogTitle>
            <DialogDescription>
              Montant en Fc, sans décimales. Le pain reste exonéré de TVA.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nom">Nom</Label>
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
                <Label htmlFor="prixVente">Prix de vente (Fc)</Label>
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
                <Label htmlFor="categorie">Catégorie</Label>
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
                Annuler
              </Button>
              <Button type="submit" variant="cta" disabled={enregistrer.isPending}>
                {produitEnEdition ? "Enregistrer" : "Créer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation de suppression */}
      <Dialog open={!!produitASupprimer} onOpenChange={(o) => !o && setProduitASupprimer(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Supprimer « {produitASupprimer?.nom} » ?</DialogTitle>
            <DialogDescription>Cette action est définitive.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProduitASupprimer(null)}>
              Annuler
            </Button>
            <Button
              variant="destructive"
              disabled={supprimer.isPending}
              onClick={() => produitASupprimer && supprimer.mutate(produitASupprimer.id)}
            >
              Supprimer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
