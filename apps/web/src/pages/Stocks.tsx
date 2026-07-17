import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Pencil, Plus, Trash2 } from "lucide-react";
import {
  formatQuantite,
  TYPE_MOUVEMENT_LABELS,
  type MatierePremiereDTO,
  type MouvementStockDTO,
  type TypeMouvementStock,
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

function formatDateHeure(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

export function StocksPage() {
  const { peutEcrire } = useAuth();
  const queryClient = useQueryClient();
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
    onError: (e) => setErreurMatiere(e instanceof Error ? e.message : "Enregistrement impossible"),
  });

  const supprimerMatiere = useMutation({
    mutationFn: (id: string) => api(`/api/stocks/matieres/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : "Suppression impossible"),
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
    onError: (e) => setErreurMouvement(e instanceof Error ? e.message : "Enregistrement impossible"),
  });

  const matiereMouvement = matieres.find((m) => m.id === mvtMatiereId);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">Stocks</h1>
          <p className="mt-1 text-muted-foreground">
            Matières premières, mouvements et seuils d'alerte — l'historique n'est jamais modifié.
          </p>
        </div>
        {editable && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => ouvrirMouvement("ENTREE")} disabled={matieres.length === 0}>
              <ArrowDownToLine className="h-4 w-4" />
              Entrée
            </Button>
            <Button variant="outline" onClick={() => ouvrirMouvement("SORTIE")} disabled={matieres.length === 0}>
              <ArrowUpFromLine className="h-4 w-4" />
              Sortie
            </Button>
            <Button variant="cta" onClick={() => ouvrirMatiere(null)}>
              <Plus className="h-4 w-4" />
              Matière première
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
            <span className="font-semibold text-terracotta">Stock critique :</span>{" "}
            {sousSeuil
              .map((m) => `${m.nom} (${formatQuantite(m.quantiteStock, m.unite)} / seuil ${formatQuantite(m.seuilAlerte, m.unite)})`)
              .join(", ")}{" "}
            — commande fournisseur à anticiper.
          </p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Matières premières</CardTitle>
          <CardDescription>{matieres.length} matière(s) suivie(s).</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Matière</TableHead>
                <TableHead>Unité</TableHead>
                <TableHead className="text-right">En stock</TableHead>
                <TableHead className="text-right">Seuil d'alerte</TableHead>
                <TableHead>État</TableHead>
                {editable && <TableHead className="text-right">Actions</TableHead>}
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
                      <Badge className="border-transparent bg-terracotta text-creme">Sous le seuil</Badge>
                    ) : (
                      <Badge variant="secondary">OK</Badge>
                    )}
                  </TableCell>
                  {editable && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirMatiere(m)} aria-label={`Modifier ${m.nom}`}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={() => confirm(`Supprimer ${m.nom} ?`) && supprimerMatiere.mutate(m.id)}
                        aria-label={`Supprimer ${m.nom}`}
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
                    Aucune matière première enregistrée.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-end justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Historique des mouvements</CardTitle>
            <CardDescription>Journal chronologique — entrées et sorties, jamais modifiées.</CardDescription>
          </div>
          <div className="w-56">
            <Label htmlFor="filtre-matiere">Matière</Label>
            <NativeSelect id="filtre-matiere" value={filtreMatiere} onChange={(e) => setFiltreMatiere(e.target.value)}>
              <option value="">Toutes</option>
              {matieres.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nom}
                </option>
              ))}
            </NativeSelect>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Matière</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Quantité</TableHead>
                <TableHead>Référence</TableHead>
                <TableHead>Auteur</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(mouvementsData?.mouvements ?? []).map((mv) => (
                <TableRow key={mv.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateHeure(mv.date)}</TableCell>
                  <TableCell className="font-medium">{mv.matierePremiere.nom}</TableCell>
                  <TableCell>
                    <Badge variant={mv.type === "ENTREE" ? "secondary" : "gold"}>
                      {TYPE_MOUVEMENT_LABELS[mv.type]}
                    </Badge>
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
                    Aucun mouvement enregistré.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
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
              <DialogTitle>{matiereEditee ? `Modifier ${matiereEditee.nom}` : "Nouvelle matière première"}</DialogTitle>
              <DialogDescription>
                {matiereEditee
                  ? "Le stock ne se modifie pas ici : utilisez les mouvements d'entrée/sortie."
                  : "Le stock de départ sera journalisé comme mouvement « Stock initial »."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="matiere-nom">Nom</Label>
                <Input id="matiere-nom" value={nom} onChange={(e) => setNom(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="matiere-unite">Unité</Label>
                <Input id="matiere-unite" value={unite} onChange={(e) => setUnite(e.target.value)} placeholder="kg, L…" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="matiere-seuil">Seuil d'alerte</Label>
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
                  <Label htmlFor="matiere-initiale">Stock de départ (optionnel)</Label>
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
                Annuler
              </Button>
              <Button type="submit" variant="cta" disabled={sauverMatiere.isPending}>
                Enregistrer
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
              <DialogTitle>{mvtType === "ENTREE" ? "Entrée de stock" : "Sortie de stock"}</DialogTitle>
              <DialogDescription>
                {matiereMouvement
                  ? `Stock actuel : ${formatQuantite(matiereMouvement.quantiteStock, matiereMouvement.unite)}`
                  : "Choisissez une matière première."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="mvt-matiere">Matière première</Label>
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
                  <Label htmlFor="mvt-type">Type</Label>
                  <NativeSelect id="mvt-type" value={mvtType} onChange={(e) => setMvtType(e.target.value as TypeMouvementStock)}>
                    <option value="ENTREE">Entrée</option>
                    <option value="SORTIE">Sortie</option>
                  </NativeSelect>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mvt-quantite">Quantité{matiereMouvement ? ` (${matiereMouvement.unite})` : ""}</Label>
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
                <Label htmlFor="mvt-reference">Référence (optionnel)</Label>
                <Input
                  id="mvt-reference"
                  value={mvtReference}
                  onChange={(e) => setMvtReference(e.target.value)}
                  placeholder="Bon de livraison, casse, inventaire…"
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
                Annuler
              </Button>
              <Button type="submit" variant="cta" disabled={enregistrerMouvement.isPending}>
                Enregistrer le mouvement
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
