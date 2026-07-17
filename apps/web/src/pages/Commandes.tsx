import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RotateCcw, UserPlus } from "lucide-react";
import {
  calculerCommande,
  formatFc,
  type ClientDTO,
  type CommandeDTO,
  type TypeClientDTO,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/select";
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

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

interface Filtres {
  typeClientId: string;
  du: string;
  au: string;
}

const FILTRES_VIDES: Filtres = { typeClientId: "", du: "", au: "" };

export function CommandesPage() {
  const { peutEcrire } = useAuth();
  const queryClient = useQueryClient();
  const editable = peutEcrire("COMMANDES");

  const [filtres, setFiltres] = useState<Filtres>(FILTRES_VIDES);

  const { data: typesData } = useQuery({
    queryKey: ["type-clients"],
    queryFn: () => api<{ typeClients: TypeClientDTO[] }>("/api/type-clients"),
  });
  const { data: clientsData } = useQuery({
    queryKey: ["clients"],
    queryFn: () => api<{ clients: ClientDTO[] }>("/api/clients"),
    enabled: editable,
  });

  const paramsListe = new URLSearchParams();
  if (filtres.typeClientId) paramsListe.set("typeClientId", filtres.typeClientId);
  if (filtres.du) paramsListe.set("du", filtres.du);
  if (filtres.au) paramsListe.set("au", filtres.au);
  const { data, isLoading, error } = useQuery({
    queryKey: ["commandes", filtres],
    queryFn: () => api<{ commandes: CommandeDTO[] }>(`/api/commandes?${paramsListe}`),
  });

  // --- Dialogue nouvelle commande -----------------------------------------
  const [dialogCommande, setDialogCommande] = useState(false);
  const [clientId, setClientId] = useState("");
  const [bacs, setBacs] = useState("");
  const [recu, setRecu] = useState("");
  const [erreurCommande, setErreurCommande] = useState<string | null>(null);

  const clientChoisi = clientsData?.clients.find((c) => c.id === clientId);
  const apercu = useMemo(() => {
    const nbBacs = Number(bacs);
    if (!clientChoisi || !Number.isInteger(nbBacs) || nbBacs < 1) return null;
    return calculerCommande({
      quantiteBacs: nbBacs,
      prixParBac: clientChoisi.typeClient.prixParBac,
      avanceExistante: clientChoisi.avanceDisponible,
      montantRecu: Number(recu) >= 0 ? Number(recu) || 0 : 0,
    });
  }, [clientChoisi, bacs, recu]);

  const creerCommande = useMutation({
    mutationFn: () =>
      api("/api/commandes", {
        method: "POST",
        body: JSON.stringify({ clientId, quantiteBacs: Number(bacs), montantRecu: Number(recu) || 0 }),
      }),
    onSuccess: () => {
      setDialogCommande(false);
      queryClient.invalidateQueries({ queryKey: ["commandes"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["commissions"] });
    },
    onError: (e) => setErreurCommande(e instanceof Error ? e.message : "Enregistrement impossible"),
  });

  function ouvrirDialogCommande() {
    setClientId("");
    setBacs("");
    setRecu("");
    setErreurCommande(null);
    setDialogCommande(true);
  }

  function soumettreCommande(e: FormEvent) {
    e.preventDefault();
    setErreurCommande(null);
    if (!clientId) return setErreurCommande("Choisissez un client");
    const nbBacs = Number(bacs);
    if (!Number.isInteger(nbBacs) || nbBacs < 1) return setErreurCommande("Nombre de bacs invalide");
    const montantRecu = Number(recu) || 0;
    if (!Number.isInteger(montantRecu) || montantRecu < 0) return setErreurCommande("Montant reçu invalide");
    creerCommande.mutate();
  }

  // --- Dialogue nouveau client --------------------------------------------
  const [dialogClient, setDialogClient] = useState(false);
  const [nomClient, setNomClient] = useState("");
  const [telClient, setTelClient] = useState("");
  const [qualiteClient, setQualiteClient] = useState("");
  const [erreurClient, setErreurClient] = useState<string | null>(null);

  const creerClient = useMutation({
    mutationFn: () =>
      api<{ client: ClientDTO }>("/api/clients", {
        method: "POST",
        body: JSON.stringify({
          nom: nomClient.trim(),
          telephone: telClient.trim() || undefined,
          typeClientId: qualiteClient,
        }),
      }),
    onSuccess: (r) => {
      setDialogClient(false);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setClientId(r.client.id); // pré-sélectionne le client créé dans le formulaire de commande
    },
    onError: (e) => setErreurClient(e instanceof Error ? e.message : "Création impossible"),
  });

  function soumettreClient(e: FormEvent) {
    e.preventDefault();
    setErreurClient(null);
    if (!nomClient.trim()) return setErreurClient("Le nom est requis");
    if (!qualiteClient) return setErreurClient("Choisissez une qualité");
    creerClient.mutate();
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">Commandes clients</h1>
          <p className="mt-1 text-muted-foreground">
            Prix, avances et dettes calculés automatiquement selon la qualité du client.
          </p>
        </div>
        {editable && (
          <Button variant="cta" onClick={ouvrirDialogCommande}>
            <Plus className="h-4 w-4" />
            Nouvelle commande
          </Button>
        )}
      </div>

      {/* Filtres : Qualité, dates, Tout afficher */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="w-44 space-y-1.5">
            <Label htmlFor="filtre-qualite">Qualité</Label>
            <NativeSelect
              id="filtre-qualite"
              value={filtres.typeClientId}
              onChange={(e) => setFiltres({ ...filtres, typeClientId: e.target.value })}
            >
              <option value="">Toutes</option>
              {typesData?.typeClients.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nom}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filtre-du">Du</Label>
            <Input
              id="filtre-du"
              type="date"
              value={filtres.du}
              onChange={(e) => setFiltres({ ...filtres, du: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="filtre-au">Au</Label>
            <Input
              id="filtre-au"
              type="date"
              value={filtres.au}
              onChange={(e) => setFiltres({ ...filtres, au: e.target.value })}
            />
          </div>
          <Button variant="outline" onClick={() => setFiltres(FILTRES_VIDES)}>
            <RotateCcw className="h-4 w-4" />
            Tout afficher
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Commandes</CardTitle>
          <CardDescription>
            {editable
              ? "Enregistrement réservé au Chargé des commandes — montants en Fc."
              : "Consultation en lecture seule — montants en Fc."}
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
                  <TableHead>N°</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Qualité</TableHead>
                  <TableHead className="text-right">Bacs</TableHead>
                  <TableHead className="text-right">Brut</TableHead>
                  <TableHead className="text-right">Avance utilisée</TableHead>
                  <TableHead className="text-right">À percevoir</TableHead>
                  <TableHead className="text-right">Reçu</TableHead>
                  <TableHead className="text-right">Dette</TableHead>
                  <TableHead className="text-right">Avance générée</TableHead>
                  <TableHead className="text-right">Nouvelle avance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.commandes.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.numero}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(c.dateCreation)}
                    </TableCell>
                    <TableCell className="font-medium">{c.client.nom}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{c.qualite}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{c.quantiteBacs}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatFc(c.montantBrut)}</TableCell>
                    <TableCell className="text-right">
                      {c.avanceUtilisee > 0 ? (
                        <span className="font-medium text-terracotta">− {formatFc(c.avanceUtilisee)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-marine dark:text-or">
                      {formatFc(c.montantAPercevoir)}
                    </TableCell>
                    <TableCell className="text-right">{formatFc(c.montantRecu)}</TableCell>
                    <TableCell className="text-right">
                      {c.dette > 0 ? (
                        <Badge variant="destructive">{formatFc(c.dette)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.avanceGeneree > 0 ? (
                        <Badge variant="gold">+ {formatFc(c.avanceGeneree)}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatFc(c.nouvelleAvance)}</TableCell>
                  </TableRow>
                ))}
                {data.commandes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={12} className="py-8 text-center text-muted-foreground">
                      Aucune commande pour ces critères.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dialogue nouvelle commande */}
      <Dialog open={dialogCommande} onOpenChange={setDialogCommande}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouvelle commande</DialogTitle>
            <DialogDescription>
              Le montant à percevoir, la dette et les avances sont calculés automatiquement.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={soumettreCommande} className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="commande-client">Client</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setNomClient("");
                    setTelClient("");
                    setQualiteClient("");
                    setErreurClient(null);
                    setDialogClient(true);
                  }}
                  className="h-7 gap-1 px-2 text-xs"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Nouveau client
                </Button>
              </div>
              <NativeSelect id="commande-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">— Choisir un client —</option>
                {clientsData?.clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom} · {c.typeClient.nom}
                    {c.avanceDisponible > 0 ? ` · avance ${formatFc(c.avanceDisponible)}` : ""}
                  </option>
                ))}
              </NativeSelect>
              {clientChoisi && (
                <p className="text-xs text-muted-foreground">
                  {clientChoisi.typeClient.nom} — {formatFc(clientChoisi.typeClient.prixParBac)}/bac
                  {clientChoisi.avanceDisponible > 0 && (
                    <> · avance disponible <span className="font-medium text-terracotta">{formatFc(clientChoisi.avanceDisponible)}</span> (déduite automatiquement)</>
                  )}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="commande-bacs">Nombre de bacs reçus</Label>
                <Input
                  id="commande-bacs"
                  type="number"
                  min={1}
                  step={1}
                  value={bacs}
                  onChange={(e) => setBacs(e.target.value)}
                  placeholder="3"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="commande-recu">Montant reçu (Fc)</Label>
                <Input
                  id="commande-recu"
                  type="number"
                  min={0}
                  step={1}
                  value={recu}
                  onChange={(e) => setRecu(e.target.value)}
                  placeholder="18000"
                />
              </div>
            </div>

            {apercu && (
              <div className="rounded-lg border border-or/40 bg-or/5 p-3 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Montant brut ({bacs} × {formatFc(clientChoisi!.typeClient.prixParBac)})</span>
                  <span>{formatFc(apercu.montantBrut)}</span>
                </div>
                {apercu.avanceUtilisee > 0 && (
                  <div className="flex justify-between text-terracotta">
                    <span>Avance utilisée</span>
                    <span>− {formatFc(apercu.avanceUtilisee)}</span>
                  </div>
                )}
                <div className="mt-1 flex justify-between border-t pt-1 font-semibold">
                  <span>Montant à percevoir</span>
                  <span>{formatFc(apercu.montantAPercevoir)}</span>
                </div>
                {apercu.dette > 0 && (
                  <div className="flex justify-between font-medium text-terracotta">
                    <span>Dette</span>
                    <span>{formatFc(apercu.dette)}</span>
                  </div>
                )}
                {apercu.avanceGeneree > 0 && (
                  <div className="flex justify-between font-medium text-or">
                    <span>Avance générée</span>
                    <span>+ {formatFc(apercu.avanceGeneree)}</span>
                  </div>
                )}
                <div className="flex justify-between text-muted-foreground">
                  <span>Nouvelle avance du client</span>
                  <span>{formatFc(apercu.nouvelleAvance)}</span>
                </div>
              </div>
            )}

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
                Enregistrer la commande
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialogue nouveau client */}
      <Dialog open={dialogClient} onOpenChange={setDialogClient}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nouveau client</DialogTitle>
            <DialogDescription>La qualité détermine le prix par bac et la commission.</DialogDescription>
          </DialogHeader>
          <form onSubmit={soumettreClient} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="client-nom">Nom</Label>
              <Input id="client-nom" value={nomClient} onChange={(e) => setNomClient(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="client-tel">Téléphone (optionnel)</Label>
                <Input id="client-tel" value={telClient} onChange={(e) => setTelClient(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="client-qualite">Qualité</Label>
                <NativeSelect
                  id="client-qualite"
                  value={qualiteClient}
                  onChange={(e) => setQualiteClient(e.target.value)}
                >
                  <option value="">— Choisir —</option>
                  {typesData?.typeClients.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nom} ({formatFc(t.prixParBac)}/bac)
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>

            {erreurClient && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurClient}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogClient(false)}>
                Annuler
              </Button>
              <Button type="submit" variant="cta" disabled={creerClient.isPending}>
                Créer le client
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
