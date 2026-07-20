import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackageCheck, Pencil, Plus, Trash2, Truck } from "lucide-react";
import {
  formatFc,
  formatQuantite,
  STATUT_COMMANDE_FOURNISSEUR_LABELS,
  type CommandeFournisseurDTO,
  type FournisseurDTO,
  type MatierePremiereDTO,
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

interface LigneAchat {
  matierePremiereId: string;
  quantite: string;
  prixUnitaire: string;
}

export function FournisseursPage() {
  const { peutEcrire } = useAuth();
  const queryClient = useQueryClient();
  const editable = peutEcrire("FOURNISSEURS");

  const { data: fournisseursData } = useQuery({
    queryKey: ["fournisseurs"],
    queryFn: () => api<{ fournisseurs: FournisseurDTO[] }>("/api/fournisseurs"),
  });
  const { data: commandesData } = useQuery({
    queryKey: ["commandes-fournisseur"],
    queryFn: () => api<{ commandes: CommandeFournisseurDTO[] }>("/api/fournisseurs/commandes"),
  });
  const { data: matieresData } = useQuery({
    queryKey: ["matieres"],
    queryFn: () => api<{ matieres: MatierePremiereDTO[] }>("/api/stocks/matieres"),
    enabled: editable,
  });

  const fournisseurs = fournisseursData?.fournisseurs ?? [];
  const commandes = commandesData?.commandes ?? [];
  const matieres = matieresData?.matieres ?? [];
  const enAttente = commandes.filter((c) => c.statut === "EN_ATTENTE");

  const rafraichir = () => {
    queryClient.invalidateQueries({ queryKey: ["fournisseurs"] });
    queryClient.invalidateQueries({ queryKey: ["commandes-fournisseur"] });
    queryClient.invalidateQueries({ queryKey: ["matieres"] });
    queryClient.invalidateQueries({ queryKey: ["mouvements"] });
  };

  // --- Dialog fournisseur ----------------------------------------------------
  const [dialogFournisseur, setDialogFournisseur] = useState(false);
  const [fournisseurEdite, setFournisseurEdite] = useState<FournisseurDTO | null>(null);
  const [nom, setNom] = useState("");
  const [contact, setContact] = useState("");
  const [erreurFournisseur, setErreurFournisseur] = useState<string | null>(null);

  function ouvrirFournisseur(f: FournisseurDTO | null) {
    setFournisseurEdite(f);
    setNom(f?.nom ?? "");
    setContact(f?.contact ?? "");
    setErreurFournisseur(null);
    setDialogFournisseur(true);
  }

  const sauverFournisseur = useMutation({
    mutationFn: () => {
      const corps = { nom: nom.trim(), contact: contact.trim() || undefined };
      return fournisseurEdite
        ? api(`/api/fournisseurs/${fournisseurEdite.id}`, { method: "PUT", body: JSON.stringify(corps) })
        : api("/api/fournisseurs", { method: "POST", body: JSON.stringify(corps) });
    },
    onSuccess: () => {
      setDialogFournisseur(false);
      rafraichir();
    },
    onError: (e) => setErreurFournisseur(e instanceof Error ? e.message : "Enregistrement impossible"),
  });

  const supprimerFournisseur = useMutation({
    mutationFn: (id: string) => api(`/api/fournisseurs/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : "Suppression impossible"),
  });

  // --- Dialog bon de commande ------------------------------------------------
  const [dialogCommande, setDialogCommande] = useState(false);
  const [cmdFournisseurId, setCmdFournisseurId] = useState("");
  const [lignes, setLignes] = useState<LigneAchat[]>([]);
  const [erreurCommande, setErreurCommande] = useState<string | null>(null);

  function ouvrirCommande() {
    setCmdFournisseurId(fournisseurs[0]?.id ?? "");
    setLignes([{ matierePremiereId: matieres[0]?.id ?? "", quantite: "", prixUnitaire: "" }]);
    setErreurCommande(null);
    setDialogCommande(true);
  }

  const totalCommande = lignes.reduce(
    (s, l) => s + (Number(l.quantite) || 0) * (Number(l.prixUnitaire) || 0),
    0,
  );

  const creerCommande = useMutation({
    mutationFn: () =>
      api("/api/fournisseurs/commandes", {
        method: "POST",
        body: JSON.stringify({
          fournisseurId: cmdFournisseurId,
          lignes: lignes.map((l) => ({
            matierePremiereId: l.matierePremiereId,
            quantite: Number(l.quantite),
            prixUnitaire: Number(l.prixUnitaire),
          })),
        }),
      }),
    onSuccess: () => {
      setDialogCommande(false);
      rafraichir();
    },
    onError: (e) => setErreurCommande(e instanceof Error ? e.message : "Enregistrement impossible"),
  });

  const supprimerCommande = useMutation({
    mutationFn: (id: string) => api(`/api/fournisseurs/commandes/${id}`, { method: "DELETE" }),
    onSuccess: rafraichir,
    onError: (e) => alert(e instanceof Error ? e.message : "Annulation impossible"),
  });

  // --- Réception -------------------------------------------------------------
  const [commandeAReceptionner, setCommandeAReceptionner] = useState<CommandeFournisseurDTO | null>(null);
  const [erreurReception, setErreurReception] = useState<string | null>(null);
  const receptionner = useMutation({
    mutationFn: (id: string) => api(`/api/fournisseurs/commandes/${id}/reception`, { method: "POST" }),
    onSuccess: () => {
      setCommandeAReceptionner(null);
      setErreurReception(null);
      rafraichir();
    },
    onError: (e) => setErreurReception(e instanceof Error ? e.message : "Réception impossible"),
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">Fournisseurs</h1>
          <p className="mt-1 text-muted-foreground">
            Fiches fournisseurs et bons de commande — la réception met à jour le stock automatiquement.
          </p>
        </div>
        {editable && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => ouvrirFournisseur(null)}>
              <Truck className="h-4 w-4" />
              Fournisseur
            </Button>
            <Button variant="cta" onClick={ouvrirCommande} disabled={fournisseurs.length === 0 || matieres.length === 0}>
              <Plus className="h-4 w-4" />
              Bon de commande
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        {/* Fournisseurs */}
        <Card>
          <CardHeader>
            <CardTitle>Fiches fournisseurs</CardTitle>
            <CardDescription>{fournisseurs.length} fournisseur(s).</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nom</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-right">Commandes</TableHead>
                  {editable && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {fournisseurs.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.nom}</TableCell>
                    <TableCell className="max-w-48 truncate text-sm text-muted-foreground">{f.contact ?? "—"}</TableCell>
                    <TableCell className="text-right">{f.nombreCommandes}</TableCell>
                    {editable && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirFournisseur(f)} aria-label={`Modifier ${f.nom}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-terracotta hover:text-terracotta"
                          onClick={() => confirm(`Supprimer ${f.nom} ?`) && supprimerFournisseur.mutate(f.id)}
                          aria-label={`Supprimer ${f.nom}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {fournisseurs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={editable ? 4 : 3} className="py-8 text-center text-muted-foreground">
                      Aucun fournisseur enregistré.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Commandes en attente */}
        <Card className={enAttente.length > 0 ? "border-or/40" : undefined}>
          <CardHeader>
            <CardTitle>Commandes en attente</CardTitle>
            <CardDescription>
              {enAttente.length} bon(s) de commande à réceptionner — la réception incrémente le stock.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {enAttente.map((c) => (
              <div key={c.id} className="rounded-lg border border-beige/60 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-marine dark:text-creme">
                      Commande n°{c.numero} — {c.fournisseur.nom}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Passée le {formatDateHeure(c.date)}
                      {c.creePar ? ` par ${c.creePar.nom}` : ""}
                    </p>
                  </div>
                  {editable && (
                    <div className="flex shrink-0 gap-1">
                      <Button variant="cta" size="sm" onClick={() => { setErreurReception(null); setCommandeAReceptionner(c); }}>
                        <PackageCheck className="h-3.5 w-3.5" />
                        Marquer reçue
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-terracotta hover:text-terracotta"
                        onClick={() => confirm(`Annuler la commande n°${c.numero} ?`) && supprimerCommande.mutate(c.id)}
                        aria-label={`Annuler la commande n°${c.numero}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {c.lignes.map((l) => (
                    <li key={l.id} className="flex justify-between">
                      <span>
                        {formatQuantite(l.quantite, l.matierePremiere.unite)} {l.matierePremiere.nom} ×{" "}
                        {formatFc(l.prixUnitaire)}
                      </span>
                      <span className="font-medium text-foreground">{formatFc(l.sousTotal)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between border-t pt-1 font-semibold text-foreground">
                    <span>Total</span>
                    <span className="text-marine dark:text-or">{formatFc(c.total)}</span>
                  </li>
                </ul>
              </div>
            ))}
            {enAttente.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">Aucune commande en attente.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Historique */}
      <Card>
        <CardHeader>
          <CardTitle>Historique des commandes</CardTitle>
          <CardDescription>Bons de commande passés et réceptions.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>Fournisseur</TableHead>
                <TableHead>Passée le</TableHead>
                <TableHead>Lignes</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Reçue le</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commandes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.numero}</TableCell>
                  <TableCell className="font-medium">{c.fournisseur.nom}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateHeure(c.date)}</TableCell>
                  <TableCell className="max-w-72 truncate text-sm text-muted-foreground">
                    {c.lignes.map((l) => `${formatQuantite(l.quantite, l.matierePremiere.unite)} ${l.matierePremiere.nom}`).join(", ")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.statut === "RECUE" ? "gold" : "secondary"}>
                      {STATUT_COMMANDE_FOURNISSEUR_LABELS[c.statut]}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {c.dateReception ? formatDateHeure(c.dateReception) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-marine dark:text-or">{formatFc(c.total)}</TableCell>
                </TableRow>
              ))}
              {commandes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Aucune commande fournisseur.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog fournisseur */}
      <Dialog open={dialogFournisseur} onOpenChange={setDialogFournisseur}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sauverFournisseur.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{fournisseurEdite ? `Modifier ${fournisseurEdite.nom}` : "Nouveau fournisseur"}</DialogTitle>
              <DialogDescription>Fiche fournisseur : nom et contact.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="fournisseur-nom">Nom</Label>
                <Input id="fournisseur-nom" value={nom} onChange={(e) => setNom(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fournisseur-contact">Contact (optionnel)</Label>
                <Input
                  id="fournisseur-contact"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Téléphone, e-mail, adresse…"
                />
              </div>
            </div>
            {erreurFournisseur && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurFournisseur}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogFournisseur(false)}>
                Annuler
              </Button>
              <Button type="submit" variant="cta" disabled={sauverFournisseur.isPending}>
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog bon de commande */}
      <Dialog open={dialogCommande} onOpenChange={setDialogCommande}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              creerCommande.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>Nouveau bon de commande</DialogTitle>
              <DialogDescription>La commande reste « En attente » jusqu'à la réception.</DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <Label htmlFor="cmd-fournisseur">Fournisseur</Label>
              <NativeSelect id="cmd-fournisseur" value={cmdFournisseurId} onChange={(e) => setCmdFournisseurId(e.target.value)} required>
                {fournisseurs.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nom}
                  </option>
                ))}
              </NativeSelect>
            </div>

            <div className="space-y-2">
              <Label>Lignes (matière, quantité, prix unitaire en Fc)</Label>
              {lignes.map((l, index) => {
                const matiere = matieres.find((m) => m.id === l.matierePremiereId);
                return (
                  <div key={index} className="flex items-center gap-2">
                    <NativeSelect
                      value={l.matierePremiereId}
                      onChange={(e) =>
                        setLignes((prev) => prev.map((x, i) => (i === index ? { ...x, matierePremiereId: e.target.value } : x)))
                      }
                      required
                      aria-label={`Matière de la ligne ${index + 1}`}
                    >
                      <option value="">— Matière —</option>
                      {matieres.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nom}
                        </option>
                      ))}
                    </NativeSelect>
                    <Input
                      type="number"
                      min="0.001"
                      step="0.001"
                      className="w-24 shrink-0"
                      placeholder={matiere ? matiere.unite : "qté"}
                      value={l.quantite}
                      onChange={(e) =>
                        setLignes((prev) => prev.map((x, i) => (i === index ? { ...x, quantite: e.target.value } : x)))
                      }
                      required
                      aria-label={`Quantité de la ligne ${index + 1}`}
                    />
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      className="w-28 shrink-0"
                      placeholder="Fc/unité"
                      value={l.prixUnitaire}
                      onChange={(e) =>
                        setLignes((prev) => prev.map((x, i) => (i === index ? { ...x, prixUnitaire: e.target.value } : x)))
                      }
                      required
                      aria-label={`Prix unitaire de la ligne ${index + 1}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-terracotta hover:text-terracotta"
                      onClick={() => setLignes((prev) => prev.filter((_, i) => i !== index))}
                      disabled={lignes.length === 1}
                      aria-label={`Retirer la ligne ${index + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              })}
              <div className="flex items-center justify-between">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLignes((prev) => [...prev, { matierePremiereId: "", quantite: "", prixUnitaire: "" }])}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Ajouter une ligne
                </Button>
                <p className="text-sm font-semibold">
                  Total : <span className="text-marine dark:text-or">{formatFc(totalCommande)}</span>
                </p>
              </div>
            </div>

            {erreurCommande && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurCommande}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogCommande(false)}>
                Annuler
              </Button>
              <Button type="submit" variant="cta" disabled={creerCommande.isPending}>
                Passer la commande
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Confirmation de réception */}
      <Dialog open={!!commandeAReceptionner} onOpenChange={(open) => !open && setCommandeAReceptionner(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Réceptionner la commande n°{commandeAReceptionner?.numero} ?</DialogTitle>
            <DialogDescription>
              Le stock des matières premières sera incrémenté (mouvements d'entrée, référence = la commande).
              Cette action est définitive.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {commandeAReceptionner?.lignes.map((l) => (
              <li key={l.id} className="flex justify-between">
                <span>{l.matierePremiere.nom}</span>
                <span className="font-medium text-foreground">
                  +{formatQuantite(l.quantite, l.matierePremiere.unite)}
                </span>
              </li>
            ))}
          </ul>
          {erreurReception && (
            <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
              {erreurReception}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommandeAReceptionner(null)}>
              Annuler
            </Button>
            <Button
              variant="cta"
              disabled={receptionner.isPending}
              onClick={() => commandeAReceptionner && receptionner.mutate(commandeAReceptionner.id)}
            >
              <PackageCheck className="h-4 w-4" />
              Confirmer la réception
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
