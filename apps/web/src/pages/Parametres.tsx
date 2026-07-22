import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Globe, Pencil, Plus, Store, Trash2, Wheat } from "lucide-react";
import {
  formatFc,
  LANGUE_LABELS,
  LANGUES,
  type Langue,
  type ParametresBoutiqueDTO,
  type TypeClientDTO,
} from "@lomoto/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
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

export function ParametresPage() {
  const queryClient = useQueryClient();

  // --- Types de clients (Qualité) -------------------------------------------
  const { data: typeClientsData } = useQuery({
    queryKey: ["type-clients"],
    queryFn: () => api<{ typeClients: TypeClientDTO[] }>("/api/type-clients"),
  });
  const typeClients = typeClientsData?.typeClients ?? [];

  const [dialogQualite, setDialogQualite] = useState(false);
  const [qualiteEditee, setQualiteEditee] = useState<TypeClientDTO | null>(null);
  const [nomQualite, setNomQualite] = useState("");
  const [prixParBac, setPrixParBac] = useState("");
  const [commissionParBac, setCommissionParBac] = useState("");
  const [erreurQualite, setErreurQualite] = useState<string | null>(null);

  function ouvrirQualite(t: TypeClientDTO | null) {
    setQualiteEditee(t);
    setNomQualite(t?.nom ?? "");
    setPrixParBac(t ? String(t.prixParBac) : "");
    setCommissionParBac(t ? String(t.commissionParBac) : "0");
    setErreurQualite(null);
    setDialogQualite(true);
  }

  const sauverQualite = useMutation({
    mutationFn: () => {
      const corps = {
        nom: nomQualite.trim(),
        prixParBac: Number(prixParBac),
        commissionParBac: Number(commissionParBac || 0),
      };
      return qualiteEditee
        ? api(`/api/type-clients/${qualiteEditee.id}`, { method: "PUT", body: JSON.stringify(corps) })
        : api("/api/type-clients", { method: "POST", body: JSON.stringify(corps) });
    },
    onSuccess: () => {
      setDialogQualite(false);
      queryClient.invalidateQueries({ queryKey: ["type-clients"] });
    },
    onError: (e) => setErreurQualite(e instanceof Error ? e.message : "Enregistrement impossible"),
  });

  const supprimerQualite = useMutation({
    mutationFn: (id: string) => api(`/api/type-clients/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["type-clients"] }),
    onError: (e) => alert(e instanceof Error ? e.message : "Suppression impossible"),
  });

  // --- Paramètres boutique + seuil + langue ---------------------------------
  const { data: parametresData } = useQuery({
    queryKey: ["parametres"],
    queryFn: () => api<{ parametres: ParametresBoutiqueDTO }>("/api/parametres"),
  });

  const [seuil, setSeuil] = useState("");
  const [boutiqueNom, setBoutiqueNom] = useState("");
  const [boutiqueAdresse, setBoutiqueAdresse] = useState("");
  const [boutiqueContact, setBoutiqueContact] = useState("");
  const [langueDefaut, setLangueDefaut] = useState<Langue>("FR");
  const [erreurParams, setErreurParams] = useState<string | null>(null);
  const [succesParams, setSuccesParams] = useState(false);

  useEffect(() => {
    const p = parametresData?.parametres;
    if (!p) return;
    setSeuil(String(p.seuilAlerteTransaction));
    setBoutiqueNom(p.boutiqueNom);
    setBoutiqueAdresse(p.boutiqueAdresse);
    setBoutiqueContact(p.boutiqueContact);
    setLangueDefaut(p.langueDefaut);
  }, [parametresData]);

  const enregistrerParams = useMutation({
    mutationFn: () =>
      api<{ parametres: ParametresBoutiqueDTO }>("/api/parametres", {
        method: "PUT",
        body: JSON.stringify({
          seuilAlerteTransaction: Number(seuil),
          boutiqueNom: boutiqueNom.trim(),
          boutiqueAdresse: boutiqueAdresse.trim(),
          boutiqueContact: boutiqueContact.trim(),
          langueDefaut,
        }),
      }),
    onSuccess: () => {
      setErreurParams(null);
      setSuccesParams(true);
      queryClient.invalidateQueries({ queryKey: ["parametres"] });
    },
    onError: (e) => {
      setSuccesParams(false);
      setErreurParams(e instanceof Error ? e.message : "Enregistrement impossible");
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-bold text-marine dark:text-creme">Paramètres</h1>
        <p className="mt-1 text-muted-foreground">
          Réglages de la boutique — réservés à l'Administrateur.
        </p>
      </div>

      {/* Types de clients / Qualités */}
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Types de clients (Qualité)</CardTitle>
            <CardDescription>
              Prix et commission par bac (en Fc). Une modification s'applique aux commandes futures — les
              commandes existantes gardent leurs montants figés.
            </CardDescription>
          </div>
          <Button variant="cta" onClick={() => ouvrirQualite(null)}>
            <Plus className="h-4 w-4" />
            Qualité
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead className="text-right">Prix / bac</TableHead>
                <TableHead className="text-right">Commission / bac</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {typeClients.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.nom}</TableCell>
                  <TableCell className="text-right font-semibold text-marine dark:text-or">{formatFc(t.prixParBac)}</TableCell>
                  <TableCell className="text-right">{t.commissionParBac > 0 ? formatFc(t.commissionParBac) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => ouvrirQualite(t)} aria-label={`Modifier ${t.nom}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-terracotta hover:text-terracotta"
                      onClick={() => confirm(`Supprimer la qualité ${t.nom} ?`) && supprimerQualite.mutate(t.id)}
                      aria-label={`Supprimer ${t.nom}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {typeClients.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                    Aucune qualité définie.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Réglages boutique */}
      <Card>
        <CardHeader>
          <CardTitle>Boutique & alertes</CardTitle>
          <CardDescription>Informations de la boutique, seuil d'alerte et langue par défaut.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSuccesParams(false);
              enregistrerParams.mutate();
            }}
            className="space-y-5"
          >
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-marine dark:text-creme">
                <Store className="h-4 w-4 text-or" />
                Informations boutique
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="boutique-nom">Nom</Label>
                  <Input id="boutique-nom" value={boutiqueNom} onChange={(e) => setBoutiqueNom(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="boutique-contact">Contact</Label>
                  <Input id="boutique-contact" value={boutiqueContact} onChange={(e) => setBoutiqueContact(e.target.value)} placeholder="Téléphone, e-mail…" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="boutique-adresse">Adresse</Label>
                  <Input id="boutique-adresse" value={boutiqueAdresse} onChange={(e) => setBoutiqueAdresse(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="seuil" className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-or" />
                  Seuil d'alerte transaction (Fc)
                </Label>
                <Input id="seuil" type="number" min="1" step="1" value={seuil} onChange={(e) => setSeuil(e.target.value)} required />
                <p className="text-xs text-muted-foreground">
                  Au-delà de ce montant, une vente ou un règlement notifie le DG (pris en compte dès la
                  transaction suivante).
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="langue" className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-or" />
                  Langue par défaut
                </Label>
                <NativeSelect id="langue" value={langueDefaut} onChange={(e) => setLangueDefaut(e.target.value as Langue)}>
                  {LANGUES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUE_LABELS[l]}
                    </option>
                  ))}
                </NativeSelect>
                <p className="text-xs text-muted-foreground">
                  Point de configuration — la traduction des libellés arrive dans une prochaine version.
                </p>
              </div>
            </div>

            {erreurParams && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurParams}
              </p>
            )}
            {succesParams && (
              <p className="rounded-md bg-or/10 px-3 py-2 text-sm font-medium text-terracotta dark:text-or">
                ✓ Paramètres enregistrés.
              </p>
            )}
            <Button type="submit" variant="cta" disabled={enregistrerParams.isPending}>
              Enregistrer les paramètres
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Renvoi vers le catalogue Produits (édité sur sa propre page) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Wheat className="h-4 w-4 text-or" />
            Catalogue produits
          </CardTitle>
          <CardDescription>
            Les prix et taxes des produits se gèrent sur la page Produits (accessible aussi au DG en lecture).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/produits">
              <Wheat className="h-4 w-4" />
              Ouvrir le catalogue produits
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Dialog qualité */}
      <Dialog open={dialogQualite} onOpenChange={setDialogQualite}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sauverQualite.mutate();
            }}
            className="space-y-4"
          >
            <DialogHeader>
              <DialogTitle>{qualiteEditee ? `Modifier ${qualiteEditee.nom}` : "Nouvelle qualité"}</DialogTitle>
              <DialogDescription>Prix et commission par bac, en Francs Congolais.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="qualite-nom">Nom</Label>
                <Input id="qualite-nom" value={nomQualite} onChange={(e) => setNomQualite(e.target.value)} placeholder="Dépositaire, Maman…" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="qualite-prix">Prix / bac (Fc)</Label>
                  <Input id="qualite-prix" type="number" min="0" step="1" value={prixParBac} onChange={(e) => setPrixParBac(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qualite-commission">Commission / bac (Fc)</Label>
                  <Input id="qualite-commission" type="number" min="0" step="1" value={commissionParBac} onChange={(e) => setCommissionParBac(e.target.value)} />
                </div>
              </div>
            </div>
            {erreurQualite && (
              <p role="alert" className="rounded-md bg-terracotta/10 px-3 py-2 text-sm font-medium text-terracotta">
                {erreurQualite}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogQualite(false)}>
                Annuler
              </Button>
              <Button type="submit" variant="cta" disabled={sauverQualite.isPending}>
                Enregistrer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
